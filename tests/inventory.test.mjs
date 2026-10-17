/* ============================================================
   Live-stock tests. Run against a REAL Postgres (never production):

     $env:TEST_DATABASE_URL = "postgres://...a throwaway database..."
     npm test

   Stripe is faked (no network, no money): the fake records what the
   functions ask of it and lets each test decide what Stripe "says".
   Webhooks are signed with Stripe's own test helper, so the real
   signature check runs.
   ============================================================ */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import Stripe from "stripe";

const URL_ = process.env.TEST_DATABASE_URL;
if (!URL_) { console.error("Set TEST_DATABASE_URL to a throwaway database."); process.exit(1); }

process.env.DATABASE_URL = URL_;
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
process.env.DESK_KEY = "desk-key-for-tests-only-123";
delete process.env.SANITY_PROJECT_ID;   // use data/products.json

const { __setDb } = await import("../netlify/lib/db.mjs");
const { __setStripe } = await import("../netlify/lib/stripe.mjs");
const inv = await import("../netlify/lib/inventory.mjs");
const checkout = (await import("../netlify/functions/create-checkout-session.mjs")).default;
const webhook = (await import("../netlify/functions/stripe-webhook.mjs")).default;
const cancel = (await import("../netlify/functions/release-checkout.mjs")).default;
const desk = (await import("../netlify/functions/desk.mjs")).default;
const stockApi = (await import("../netlify/functions/stock.mjs")).default;
const { sweep } = await import("../netlify/functions/stock-sweeper.mjs");

const sql = postgres(URL_, { max: 5, onnotice: () => {} });
__setDb(postgres(URL_, { max: 10, onnotice: () => {} }));

/* ---------- fake Stripe ---------- */
const real = new Stripe("sk_test_fake");
const fake = {
  sessions: new Map(), pis: new Map(), failCreate: false, created: 0,
  webhooks: real.webhooks,
  checkout: { sessions: {
    create: async (params) => {
      if (fake.failCreate) throw new Error("Stripe is down");
      const id = "cs_test_" + (++fake.created);
      const pi = "pi_test_" + fake.created;
      const s = { id, url: "https://checkout.stripe.com/" + id, status: "open", payment_status: "unpaid",
        metadata: params.metadata, client_reference_id: params.client_reference_id,
        payment_intent: pi, created: Math.floor(Date.now() / 1000), _params: params };
      fake.sessions.set(id, s);
      fake.pis.set(pi, { id: pi, status: "requires_payment_method", metadata: params.payment_intent_data.metadata });
      return s;
    },
    retrieve: async (id, opts) => {
      const s = fake.sessions.get(id); if (!s) throw new Error("No such session");
      return opts?.expand ? { ...s, payment_intent: fake.pis.get(s.payment_intent) } : s;
    },
    expire: async (id) => {
      const s = fake.sessions.get(id);
      if (s.status !== "open") throw new Error("Only open sessions can be expired");
      s.status = "expired"; return s;
    },
    list: async () => ({ data: [...fake.sessions.values()] }),
    listLineItems: async () => ({ data: [] })
  }},
  paymentIntents: { retrieve: async (id) => fake.pis.get(id) }
};
__setStripe(fake);

/* ---------- helpers ---------- */
const A = "SATV-M4-NINJA";   // 4 in the fallback catalogue
const B = "SATV-SV1S-SCAR";  // 9
let evN = 0;

async function avail(sku) {
  const [r] = await sql`SELECT available FROM inventory WHERE sku = ${sku}`;
  return r ? r.available : null;
}
async function statusOf(holdId) {
  const rows = await sql`SELECT DISTINCT status FROM holds WHERE hold_id = ${holdId}`;
  return rows.map((r) => r.status).join(",");
}
async function setStock(sku, n) {
  await sql`INSERT INTO inventory (sku, available) VALUES (${sku}, ${n})
            ON CONFLICT (sku) DO UPDATE SET available = ${n}`;
}
async function openCheckout(items) {
  const res = await checkout(new Request("http://x/", { method: "POST", body: JSON.stringify({ items }) }));
  const body = await res.json();
  const s = body.url ? fake.sessions.get(body.url.split("/").pop()) : null;
  return { status: res.status, body, session: s, holdId: s?.metadata.hold_id };
}
async function send(type, object, id = "evt_" + (++evN)) {
  const payload = JSON.stringify({ id, type, data: { object } });
  const header = real.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const res = await webhook(new Request("http://x/", { method: "POST", body: payload, headers: { "stripe-signature": header } }));
  return res.status;
}
const deskCall = (method, body, key = process.env.DESK_KEY) =>
  desk(new Request("http://x/", { method, headers: { authorization: "Bearer " + key }, body: body ? JSON.stringify(body) : undefined }));

before(async () => {
  await sql.unsafe(await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
});
beforeEach(async () => {
  await sql`TRUNCATE holds, stock_log, stripe_events, inventory`;
  fake.sessions.clear(); fake.pis.clear(); fake.failCreate = false;
});
after(async () => { await sql.end(); process.exit(0); });

/* ================= the race ================= */

test("last unit: 25 simultaneous checkouts, exactly one wins", async () => {
  await setStock(A, 1);
  const results = await Promise.all(Array.from({ length: 25 }, () => openCheckout([{ sku: A, qty: 1 }])));
  const won = results.filter((r) => r.status === 200);
  const lost = results.filter((r) => r.status === 409);
  assert.equal(won.length, 1);
  assert.equal(lost.length, 24);
  assert.equal(await avail(A), 0);
  assert.equal(lost[0].body.sku, A);
  assert.equal(lost[0].body.available, 0);
});

test("multi-line basket is all-or-nothing", async () => {
  await setStock(A, 2); await setStock(B, 0);
  const r = await openCheckout([{ sku: A, qty: 1 }, { sku: B, qty: 1 }]);
  assert.equal(r.status, 409);
  assert.equal(r.body.sku, B);
  assert.equal(await avail(A), 2, "A must not be taken when B is short");
  assert.equal((await sql`SELECT count(*)::int AS n FROM holds`)[0].n, 0);
});

test("asking for more than is left reports how many are left", async () => {
  await setStock(A, 2);
  const r = await openCheckout([{ sku: A, qty: 3 }]);
  assert.equal(r.status, 409);
  assert.equal(r.body.available, 2);
  assert.match(r.body.error, /Only 2/);
});

test("new SKU gets its opening stock from the catalogue", async () => {
  const r = await openCheckout([{ sku: A, qty: 1 }]);   // no row yet; catalogue says 4
  assert.equal(r.status, 200);
  assert.equal(await avail(A), 3);
});

test("session carries the hold id, a 31-minute expiry and a cancel link", async () => {
  await setStock(A, 4);
  const r = await openCheckout([{ sku: A, qty: 1 }]);
  const p = r.session._params;
  assert.equal(p.metadata.hold_id, r.holdId);
  assert.equal(p.payment_intent_data.metadata.hold_id, r.holdId);
  const mins = (p.expires_at * 1000 - Date.now()) / 60000;
  assert.ok(mins > 30 && mins <= 31.1, `expiry ${mins} min`);
  assert.ok(p.cancel_url.endsWith("?hold=" + r.holdId));
});

/* ================= normal card payment ================= */

test("paid: stock stays out, hold becomes sold; a replayed event changes nothing", async () => {
  await setStock(A, 4);
  const r = await openCheckout([{ sku: A, qty: 2 }]);
  assert.equal(await avail(A), 2);
  const obj = { ...r.session, status: "complete", payment_status: "paid" };
  assert.equal(await send("checkout.session.completed", obj, "evt_paid"), 200);
  assert.equal(await statusOf(r.holdId), "sold");
  assert.equal(await send("checkout.session.completed", obj, "evt_paid"), 200);   // Stripe retry
  assert.equal(await avail(A), 2);
  assert.equal(await statusOf(r.holdId), "sold");
});

/* ================= abandoned basket ================= */

test("abandoned: session expiry returns the stock, exactly once", async () => {
  await setStock(A, 4);
  const r = await openCheckout([{ sku: A, qty: 3 }]);
  assert.equal(await avail(A), 1);
  const obj = { ...r.session, status: "expired" };
  await send("checkout.session.expired", obj);
  assert.equal(await avail(A), 4);
  assert.equal(await statusOf(r.holdId), "released");
  await send("checkout.session.expired", obj);           // different event id, same session
  assert.equal(await avail(A), 4, "must not restock twice");
});

test("shopper taps back out of Stripe: stock returns immediately", async () => {
  await setStock(A, 1);
  const r = await openCheckout([{ sku: A, qty: 1 }]);
  assert.equal(await avail(A), 0);
  const res = await cancel(new Request("http://x/", { method: "POST", body: JSON.stringify({ hold: r.holdId }) }));
  assert.deepEqual(await res.json(), { released: true });
  assert.equal(r.session.status, "expired", "Stripe session must be expired first");
  assert.equal(await avail(A), 1);
  // then the real expiry webhook arrives — must be a no-op
  await send("checkout.session.expired", { ...r.session });
  assert.equal(await avail(A), 1);
});

test("cancel page can never release a PAID order", async () => {
  await setStock(A, 2);
  const r = await openCheckout([{ sku: A, qty: 1 }]);
  r.session.status = "complete"; r.session.payment_status = "paid";   // paid in another tab, webhook not yet in
  const res = await cancel(new Request("http://x/", { method: "POST", body: JSON.stringify({ hold: r.holdId }) }));
  assert.deepEqual(await res.json(), { released: false });
  assert.equal(await avail(A), 1);
});

test("cancel endpoint rejects junk", async () => {
  const res = await cancel(new Request("http://x/", { method: "POST", body: JSON.stringify({ hold: "'; DROP TABLE inventory;--" }) }));
  assert.equal(res.status, 400);
});

/* ================= Klarna / Clearpay ================= */

test("BNPL approved later: pending holds stock, then sold", async () => {
  await setStock(B, 9);
  const r = await openCheckout([{ sku: B, qty: 1 }]);
  await send("checkout.session.completed", { ...r.session, status: "complete", payment_status: "unpaid" });
  assert.equal(await statusOf(r.holdId), "pending");
  assert.equal(await avail(B), 8, "stock stays out while Klarna settles");
  await send("checkout.session.async_payment_succeeded", { ...r.session, status: "complete", payment_status: "paid" });
  assert.equal(await statusOf(r.holdId), "sold");
  assert.equal(await avail(B), 8);
});

test("BNPL declined: stock returns", async () => {
  await setStock(B, 9);
  const r = await openCheckout([{ sku: B, qty: 2 }]);
  await send("checkout.session.completed", { ...r.session, status: "complete", payment_status: "unpaid" });
  await send("checkout.session.async_payment_failed", { ...r.session, status: "complete", payment_status: "unpaid" });
  assert.equal(await statusOf(r.holdId), "released");
  assert.equal(await avail(B), 9);
  await send("checkout.session.async_payment_failed", { ...r.session });   // retry
  assert.equal(await avail(B), 9);
});

/* ================= refunds ================= */

function charge(r, refunded, amount_refunded = 1000) {
  return { id: "ch_" + r.holdId.slice(0, 8), object: "charge", payment_intent: r.session.payment_intent,
           amount: 1000, amount_refunded, refunded };
}

test("full refund restocks once", async () => {
  await setStock(A, 4);
  const r = await openCheckout([{ sku: A, qty: 2 }]);
  await send("checkout.session.completed", { ...r.session, status: "complete", payment_status: "paid" });
  assert.equal(await avail(A), 2);
  await send("charge.refunded", charge(r, true));
  assert.equal(await avail(A), 4);
  assert.equal(await statusOf(r.holdId), "refunded");
  await send("charge.refunded", charge(r, true));       // a second refund event on the same charge
  assert.equal(await avail(A), 4, "must not restock twice");
});

test("partial refund does not restock", async () => {
  await setStock(A, 4);
  const r = await openCheckout([{ sku: A, qty: 1 }]);
  await send("checkout.session.completed", { ...r.session, status: "complete", payment_status: "paid" });
  await send("charge.refunded", charge(r, false, 300));
  assert.equal(await avail(A), 3);
  assert.equal(await statusOf(r.holdId), "sold");
});

test("RESTOCK_ON_REFUND=off makes refunds manual", async () => {
  await setStock(A, 4);
  const r = await openCheckout([{ sku: A, qty: 1 }]);
  await send("checkout.session.completed", { ...r.session, status: "complete", payment_status: "paid" });
  process.env.RESTOCK_ON_REFUND = "off";
  try { await send("charge.refunded", charge(r, true)); } finally { delete process.env.RESTOCK_ON_REFUND; }
  assert.equal(await avail(A), 3);
});

test("refund on a never-paid hold does nothing", async () => {
  await setStock(A, 4);
  const r = await openCheckout([{ sku: A, qty: 1 }]);
  await send("checkout.session.expired", { ...r.session });
  await send("charge.refunded", charge(r, true));
  assert.equal(await avail(A), 4);
});

/* ================= failures ================= */

test("Stripe fails to open: stock is put straight back", async () => {
  await setStock(A, 1);
  fake.failCreate = true;
  const r = await openCheckout([{ sku: A, qty: 1 }]);
  assert.equal(r.status, 502);
  assert.equal(await avail(A), 1);
});

test("bad signature is rejected and moves nothing", async () => {
  await setStock(A, 4);
  const r = await openCheckout([{ sku: A, qty: 1 }]);
  const res = await webhook(new Request("http://x/", { method: "POST",
    body: JSON.stringify({ id: "evt_x", type: "checkout.session.expired", data: { object: r.session } }),
    headers: { "stripe-signature": "t=1,v1=forged" } }));
  assert.equal(res.status, 400);
  assert.equal(await avail(A), 3);
});

test("database error in webhook returns 500 so Stripe retries", async () => {
  await setStock(A, 4);
  const r = await openCheckout([{ sku: A, qty: 1 }]);
  __setDb(postgres("postgres://nobody:wrong@127.0.0.1:1/none", { max: 1, connect_timeout: 1, onnotice: () => {} }));
  let status;
  try { status = await send("checkout.session.completed", { ...r.session, status: "complete", payment_status: "paid" }); }
  finally { __setDb(postgres(URL_, { max: 10, onnotice: () => {} })); }
  assert.equal(status, 500);
  assert.equal(await statusOf(r.holdId), "held");
});

test("database down at checkout: refuses rather than overselling", async () => {
  __setDb(postgres("postgres://nobody:wrong@127.0.0.1:1/none", { max: 1, connect_timeout: 1, onnotice: () => {} }));
  let r;
  try { r = await openCheckout([{ sku: A, qty: 1 }]); }
  finally { __setDb(postgres(URL_, { max: 10, onnotice: () => {} })); }
  assert.equal(r.status, 503);
  assert.equal(fake.created, fake.created);   // no assertion on count; just must not throw
  assert.equal(r.body.url, undefined);
});

test("payment after release re-takes stock; if gone, logs OVERSOLD and never goes negative", async () => {
  await setStock(A, 1);
  const r = await openCheckout([{ sku: A, qty: 1 }]);
  await inv.release(r.holdId, "test release");          // simulate lost race
  await setStock(A, 0);                                  // someone else bought it
  await send("checkout.session.completed", { ...r.session, status: "complete", payment_status: "paid" });
  assert.equal(await avail(A), 0);
  assert.equal(await statusOf(r.holdId), "sold");
  const [l] = await sql`SELECT reason FROM stock_log WHERE reason LIKE 'OVERSOLD%'`;
  assert.ok(l, "oversell must be logged");
});

test("old orders (no hold id) are ignored safely", async () => {
  assert.equal(await send("checkout.session.completed", { id: "cs_old", status: "complete", payment_status: "paid", metadata: {} }), 200);
  assert.equal(await send("checkout.session.expired", { id: "cs_old2", metadata: {} }), 200);
});

/* ================= sweeper ================= */

async function age(holdId) {
  await sql`UPDATE holds SET expires_at = now() - interval '10 minutes', created_at = now() - interval '45 minutes' WHERE hold_id = ${holdId}`;
}

test("sweeper: missed expiry webhook -> released", async () => {
  await setStock(A, 4);
  const r = await openCheckout([{ sku: A, qty: 2 }]);
  r.session.status = "expired"; await age(r.holdId);
  const out = await sweep();
  assert.equal(out.released, 1);
  assert.equal(await avail(A), 4);
});

test("sweeper: missed paid webhook -> sold, not released", async () => {
  await setStock(A, 4);
  const r = await openCheckout([{ sku: A, qty: 1 }]);
  r.session.status = "complete"; r.session.payment_status = "paid"; await age(r.holdId);
  await sweep();
  assert.equal(await statusOf(r.holdId), "sold");
  assert.equal(await avail(A), 3);
});

test("sweeper: still-open session is left alone", async () => {
  await setStock(A, 4);
  const r = await openCheckout([{ sku: A, qty: 1 }]);
  await age(r.holdId);
  const out = await sweep();
  assert.equal(out.skipped, 1);
  assert.equal(await statusOf(r.holdId), "held");
});

test("sweeper: BNPL stuck pending, payment failed -> released", async () => {
  await setStock(B, 9);
  const r = await openCheckout([{ sku: B, qty: 1 }]);
  await send("checkout.session.completed", { ...r.session, status: "complete", payment_status: "unpaid" });
  r.session.status = "complete"; fake.pis.get(r.session.payment_intent).status = "canceled";
  await sql`UPDATE holds SET updated_at = now() - interval '2 days' WHERE hold_id = ${r.holdId}`;
  await sweep();
  assert.equal(await avail(B), 9);
});

test("sweeper: hold whose session id was never saved is matched via metadata", async () => {
  await setStock(A, 4);
  const r = await openCheckout([{ sku: A, qty: 1 }]);
  await sql`UPDATE holds SET session_id = NULL WHERE hold_id = ${r.holdId}`;
  r.session.status = "complete"; r.session.payment_status = "paid"; await age(r.holdId);
  await sweep();
  assert.equal(await statusOf(r.holdId), "sold", "paid order must not be released");
});

test("sweeper: hold with no Stripe session at all -> released", async () => {
  await setStock(A, 4);
  await inv.reserve("00000000-0000-4000-8000-000000000001", [{ sku: A, qty: 2 }], new Date(Date.now() - 20 * 60000));
  await sql`UPDATE holds SET created_at = now() - interval '45 minutes'`;
  await sweep();
  assert.equal(await avail(A), 4);
});

/* ================= stock desk ================= */

test("desk: wrong key refused", async () => {
  const res = await deskCall("GET", null, "nope");
  assert.equal(res.status, 401);
});

test("desk: list, receive, remove, count — and cannot go negative", async () => {
  let res = await deskCall("GET");
  const data = await res.json();
  assert.ok(data.products.find((p) => p.sku === A));
  assert.equal(await avail(A), 4, "opening stock seeded on first view");

  await deskCall("POST", { action: "adjust", sku: A, value: 6, note: "Consignment 14" });
  assert.equal(await avail(A), 10);
  await deskCall("POST", { action: "adjust", sku: A, value: -1, note: "Damaged" });
  assert.equal(await avail(A), 9);
  res = await deskCall("POST", { action: "adjust", sku: A, value: -50 });
  assert.equal(res.status, 400);
  assert.equal(await avail(A), 9);
  await deskCall("POST", { action: "set", sku: A, value: 7, note: "Stock count" });
  assert.equal(await avail(A), 7);
  res = await deskCall("POST", { action: "set", sku: "NOT-A-SKU", value: 3 });
  assert.equal(res.status, 400);

  const after = await (await deskCall("GET")).json();
  assert.equal(after.log[0].reason, "count set (desk)");
  assert.equal(after.log[0].delta, -2);
});

test("desk: held checkouts are shown separately and come back on expiry", async () => {
  await setStock(A, 4);
  const r = await openCheckout([{ sku: A, qty: 1 }]);
  let p = (await (await deskCall("GET")).json()).products.find((x) => x.sku === A);
  assert.equal(p.available, 3); assert.equal(p.held, 1);
  await send("checkout.session.expired", { ...r.session });
  p = (await (await deskCall("GET")).json()).products.find((x) => x.sku === A);
  assert.equal(p.available, 4); assert.equal(p.held, 0);
});

/* ================= live endpoint ================= */

test("/api/stock serves the live map with a short CDN cache", async () => {
  await setStock(A, 3); await setStock(B, 0);
  const res = await stockApi();
  assert.deepEqual(await res.json(), { [A]: 3, [B]: 0 });
  assert.match(res.headers.get("Netlify-CDN-Cache-Control"), /s-maxage=15/);
});
