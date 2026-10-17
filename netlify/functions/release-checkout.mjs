/* ============================================================
   POST /api/release-checkout   Body: { hold }

   Called by the "checkout cancelled" page. When a shopper taps
   back out of Stripe, their units come back straight away instead
   of sitting held for 30 minutes — which matters when the line is
   down to its last box.

   We expire the Stripe session FIRST. Stripe refuses to expire a
   session that has been paid, so a stray call can never release
   stock someone has bought.
   ============================================================ */
import { stripe } from "../lib/stripe.mjs";
import { inventoryEnabled, db } from "../lib/db.mjs";
import { release } from "../lib/inventory.mjs";
import { json } from "../lib/catalogue.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!inventoryEnabled()) return json({ released: false });

  let hold;
  try { ({ hold } = await request.json()); } catch { return json({ error: "Bad request" }, 400); }
  if (!UUID.test(hold || "")) return json({ error: "Bad request" }, 400);

  try {
    const [row] = await db()`SELECT session_id FROM holds WHERE hold_id = ${hold} AND status = 'held' LIMIT 1`;
    if (!row || !row.session_id) return json({ released: false });

    const s = await stripe().checkout.sessions.retrieve(row.session_id);
    if (s.status === "open") await stripe().checkout.sessions.expire(row.session_id);
    else if (s.status !== "expired") return json({ released: false });

    const back = await release(hold, "shopper left checkout", row.session_id);
    return json({ released: back.length > 0 });
  } catch (err) {
    console.error("Release on cancel failed (expiry will catch it):", err.message);
    return json({ released: false });
  }
};

export const config = { path: "/api/release-checkout" };
