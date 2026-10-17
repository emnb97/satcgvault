/* ============================================================
   Scheduled every 10 minutes. The safety net under the webhook.

   Normally Stripe tells us when a checkout expires or a Klarna
   payment settles. This catches what slips through — a webhook
   that was misconfigured or down, or a checkout function that
   died after taking stock but before Stripe opened. It never
   guesses: it asks Stripe what actually happened, then applies
   the same status-guarded moves the webhook would.
   ============================================================ */
import { stripe } from "../lib/stripe.mjs";
import { inventoryEnabled } from "../lib/db.mjs";
import { staleHolds, release, markSold, markPending } from "../lib/inventory.mjs";

export async function sweep() {
  const out = { released: 0, sold: 0, pending: 0, skipped: 0 };
  for (const h of await staleHolds()) {
    try {
      if (!h.session_id) {
        /* Stock taken, Stripe never opened (or we lost the id). Look the
           session up by hold id before assuming nobody paid. */
        const t = Math.floor(new Date(h.created_at).getTime() / 1000);
        const found = await stripe().checkout.sessions.list({ limit: 100, created: { gte: t - 60, lte: t + 300 } });
        const s = (found.data || []).find((x) => x.metadata?.hold_id === h.hold_id);
        if (!s || s.status === "expired") { if ((await release(h.hold_id, "sweeper: checkout never completed")).length) out.released++; }
        else await settle(h, s, out);
        continue;
      }
      const s = await stripe().checkout.sessions.retrieve(h.session_id, { expand: ["payment_intent"] });
      await settle(h, s, out);
    } catch (err) {
      out.skipped++;
      console.error("Sweeper skipped hold", h.hold_id, err.message);
    }
  }
  return out;
}

async function settle(h, s, out) {
  if (s.status === "expired") {
    if ((await release(h.hold_id, "sweeper: checkout expired", s.id)).length) out.released++;
  } else if (s.status === "complete" && s.payment_status === "paid") {
    await markSold(h.hold_id); out.sold++;
  } else if (s.status === "complete") {
    const pi = s.payment_intent;
    const state = typeof pi === "object" && pi ? pi.status : null;
    if (state === "canceled" || state === "requires_payment_method") {
      if ((await release(h.hold_id, "sweeper: payment failed", s.id)).length) out.released++;
    } else if (h.status === "held") {
      await markPending(h.hold_id); out.pending++;
    } else out.skipped++;              // still settling — leave it
  } else {
    out.skipped++;                     // still open — leave it
  }
}

export default async () => {
  if (!inventoryEnabled() || !process.env.STRIPE_SECRET_KEY) return new Response("off");
  const out = await sweep();
  if (out.released || out.sold || out.pending || out.skipped) console.log("Sweeper:", out);
  return new Response(JSON.stringify(out));
};

export const config = { schedule: "*/10 * * * *" };
