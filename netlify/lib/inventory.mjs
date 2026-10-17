/* ============================================================
   Live inventory — every way stock can move, in one place.

   The rule that stops two people buying the last box:

     UPDATE inventory SET available = available - qty
      WHERE sku = $1 AND available >= qty

   Postgres runs that as one indivisible step. If two checkouts
   race for the last unit, one UPDATE matches a row and the other
   matches nothing — and "matched nothing" is our out-of-stock.

   Every status change on `holds` is guarded by its current status
   (WHERE status IN (...)), so Stripe retrying a webhook, or the
   sweeper and a webhook arriving together, can never move the
   same stock twice.
   ============================================================ */
import { db } from "./db.mjs";

export class OutOfStock extends Error {
  constructor(sku, available, requested) {
    super(`Only ${available} of ${sku} available (asked for ${requested})`);
    this.sku = sku;
    this.available = available;
    this.requested = requested;
  }
}

/* Merge duplicate SKUs and sort, so two baskets touching the same
   SKUs always lock rows in the same order (no deadlocks). */
function tidy(items) {
  const merged = new Map();
  for (const { sku, qty } of items) merged.set(sku, (merged.get(sku) || 0) + qty);
  return [...merged].map(([sku, qty]) => ({ sku, qty })).sort((a, b) => a.sku.localeCompare(b.sku));
}

async function log(tx, sku, delta, after, reason, ref = null) {
  await tx`INSERT INTO stock_log (sku, delta, available_after, reason, ref)
           VALUES (${sku}, ${delta}, ${after}, ${reason}, ${ref})`;
}

/* ---------- opening stock ------------------------------------
   A SKU that exists in Sanity but not here yet gets a row, using
   Sanity's "Opening stock" figure. Existing rows are never touched:
   once a SKU is in Postgres, Postgres is the truth for it. */
export async function ensureRows(products) {
  const rows = products
    .filter((p) => p && p.sku)
    .map((p) => ({ sku: p.sku, available: Math.max(0, parseInt(p.stock, 10) || 0) }));
  if (!rows.length) return [];
  const sql = db();
  const created = await sql`
    INSERT INTO inventory ${sql(rows, "sku", "available")}
    ON CONFLICT (sku) DO NOTHING
    RETURNING sku, available`;
  for (const r of created) {
    await log(sql, r.sku, r.available, r.available, "opening stock from Sanity");
  }
  return created;
}

/* ---------- checkout opened ---------------------------------- */
export async function reserve(holdId, items, expiresAt) {
  const lines = tidy(items);
  return db().begin(async (tx) => {
    for (const { sku, qty } of lines) {
      const [row] = await tx`
        UPDATE inventory SET available = available - ${qty}, updated_at = now()
         WHERE sku = ${sku} AND available >= ${qty}
        RETURNING available`;
      if (!row) {
        const [cur] = await tx`SELECT available FROM inventory WHERE sku = ${sku}`;
        throw new OutOfStock(sku, cur ? cur.available : 0, qty); // rolls back every line
      }
      await tx`INSERT INTO holds (hold_id, sku, qty, expires_at)
               VALUES (${holdId}, ${sku}, ${qty}, ${expiresAt})`;
      await log(tx, sku, -qty, row.available, "checkout opened", holdId);
    }
    return lines;
  });
}

export async function attachSession(holdId, sessionId) {
  await db()`UPDATE holds SET session_id = ${sessionId}, updated_at = now() WHERE hold_id = ${holdId}`;
}

/* ---------- unpaid: give the stock back ----------------------- */
export async function release(holdId, reason, ref = null) {
  return db().begin(async (tx) => {
    const rows = await tx`
      UPDATE holds SET status = 'released', updated_at = now()
       WHERE hold_id = ${holdId} AND status IN ('held', 'pending')
      RETURNING sku, qty`;
    for (const { sku, qty } of rows) {
      const [inv] = await tx`
        UPDATE inventory SET available = available + ${qty}, updated_at = now()
         WHERE sku = ${sku} RETURNING available`;
      await log(tx, sku, qty, inv.available, reason, ref || holdId);
    }
    return rows;
  });
}

/* ---------- checkout finished, money still settling ------------
   Klarna / Clearpay / bank debits. Stock stays out of inventory. */
export async function markPending(holdId) {
  return db().begin(async (tx) => {
    const moved = await tx`
      UPDATE holds SET status = 'pending', updated_at = now()
       WHERE hold_id = ${holdId} AND status = 'held' RETURNING sku`;
    if (moved.length) return { ok: true, oversold: [] };
    return retakeIfReleased(tx, holdId, "pending");
  });
}

/* ---------- paid ---------------------------------------------- */
export async function markSold(holdId) {
  return db().begin(async (tx) => {
    const moved = await tx`
      UPDATE holds SET status = 'sold', updated_at = now()
       WHERE hold_id = ${holdId} AND status IN ('held', 'pending') RETURNING sku`;
    if (moved.length) return { ok: true, oversold: [] };
    return retakeIfReleased(tx, holdId, "sold");
  });
}

/* A payment arrived for stock we had already handed back. Stripe
   should never allow this (an expired session cannot be paid), but
   if timing ever produces it we take the stock again if it's there,
   and shout loudly if it isn't — never silently. */
async function retakeIfReleased(tx, holdId, status) {
  const rows = await tx`
    SELECT sku, qty, status FROM holds WHERE hold_id = ${holdId} FOR UPDATE`;
  if (!rows.length) return { ok: false, unknown: true, oversold: [] };
  const released = rows.filter((r) => r.status === "released");
  if (!released.length) return { ok: true, already: rows[0].status, oversold: [] };

  const oversold = [];
  for (const { sku, qty } of released) {
    const [inv] = await tx`
      UPDATE inventory SET available = available - ${qty}, updated_at = now()
       WHERE sku = ${sku} AND available >= ${qty} RETURNING available`;
    if (inv) {
      await log(tx, sku, -qty, inv.available, "paid after release — re-taken", holdId);
    } else {
      const [cur] = await tx`SELECT available FROM inventory WHERE sku = ${sku}`;
      await log(tx, sku, 0, cur ? cur.available : null, `OVERSOLD by ${qty} — check stock`, holdId);
      oversold.push({ sku, qty });
    }
  }
  await tx`UPDATE holds SET status = ${status}, updated_at = now()
           WHERE hold_id = ${holdId} AND status = 'released'`;
  return { ok: true, oversold };
}

/* ---------- full refund: back on the shelf -------------------- */
export async function refundRestock(holdId, ref = null) {
  return db().begin(async (tx) => {
    const rows = await tx`
      UPDATE holds SET status = 'refunded', updated_at = now()
       WHERE hold_id = ${holdId} AND status = 'sold'
      RETURNING sku, qty`;
    for (const { sku, qty } of rows) {
      const [inv] = await tx`
        UPDATE inventory SET available = available + ${qty}, updated_at = now()
         WHERE sku = ${sku} RETURNING available`;
      await log(tx, sku, qty, inv.available, "refunded — restocked", ref || holdId);
    }
    return rows;
  });
}

/* ---------- stock desk (Omar) -------------------------------- */
export class DeskError extends Error {}

export async function adjust(sku, delta, note) {
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 10000) throw new DeskError("Enter a whole number.");
  return db().begin(async (tx) => {
    const [inv] = await tx`
      UPDATE inventory SET available = available + ${delta}, updated_at = now()
       WHERE sku = ${sku} AND available + ${delta} >= 0
      RETURNING available`;
    if (!inv) {
      const [cur] = await tx`SELECT available FROM inventory WHERE sku = ${sku}`;
      throw new DeskError(cur ? `Only ${cur.available} available — can't remove ${-delta}.` : "Unknown SKU.");
    }
    await log(tx, sku, delta, inv.available, delta > 0 ? "received (desk)" : "removed (desk)", note || null);
    return inv.available;
  });
}

export async function setCount(sku, count, note) {
  if (!Number.isInteger(count) || count < 0 || count > 10000) throw new DeskError("Enter a whole number, 0 or more.");
  return db().begin(async (tx) => {
    const [cur] = await tx`SELECT available FROM inventory WHERE sku = ${sku} FOR UPDATE`;
    if (!cur) throw new DeskError("Unknown SKU.");
    if (cur.available === count) return count;
    await tx`UPDATE inventory SET available = ${count}, updated_at = now() WHERE sku = ${sku}`;
    await log(tx, sku, count - cur.available, count, "count set (desk)", note || null);
    return count;
  });
}

/* ---------- reads --------------------------------------------- */
export async function availableMap() {
  const rows = await db()`SELECT sku, available FROM inventory`;
  return Object.fromEntries(rows.map((r) => [r.sku, r.available]));
}

export async function snapshot() {
  return db()`
    SELECT i.sku, i.available, i.updated_at,
           COALESCE(SUM(h.qty) FILTER (WHERE h.status = 'held'), 0)::int    AS held,
           COALESCE(SUM(h.qty) FILTER (WHERE h.status = 'pending'), 0)::int AS pending,
           COALESCE(SUM(h.qty) FILTER (WHERE h.status = 'sold'
                    AND h.updated_at > now() - interval '30 days'), 0)::int  AS sold30
      FROM inventory i LEFT JOIN holds h ON h.sku = i.sku
     GROUP BY i.sku ORDER BY i.sku`;
}

export async function recentLog(limit = 40) {
  return db()`SELECT at, sku, delta, available_after, reason, ref
                FROM stock_log ORDER BY id DESC LIMIT ${limit}`;
}

/* Holds the sweeper should look at: checkouts past their expiry that
   Stripe never told us about, and BNPL payments settling for a day+. */
export async function staleHolds() {
  return db()`
    SELECT hold_id, MAX(session_id) AS session_id, MIN(status) AS status, MIN(created_at) AS created_at
      FROM holds
     WHERE (status = 'held'    AND expires_at < now() - interval '5 minutes')
        OR (status = 'pending' AND updated_at < now() - interval '1 day')
     GROUP BY hold_id
     LIMIT 50`;
}

/* ---------- webhook receipts ---------------------------------- */
export async function eventSeen(id) {
  const [row] = await db()`SELECT 1 FROM stripe_events WHERE event_id = ${id}`;
  return Boolean(row);
}
export async function recordEvent(id, type) {
  await db()`INSERT INTO stripe_events (event_id, type) VALUES (${id}, ${type}) ON CONFLICT DO NOTHING`;
}
