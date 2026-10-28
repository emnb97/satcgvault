/* ============================================================
   POST /api/stripe-webhook
   Stripe calls this. It is the only trustworthy signal that an
   order is paid — the browser redirect is not, because a shopper
   can close the tab or visit the success URL directly.

   Events (all must be ticked on the endpoint in the Stripe Dashboard):
     checkout.session.completed               paid -> sold, BNPL -> pending
     checkout.session.async_payment_succeeded pending -> sold
     checkout.session.async_payment_failed    pending -> released
     checkout.session.expired                 held -> released (abandoned)
     charge.refunded                          full refund: sold -> refunded, restocked
     charge.dispute.created                   logged only

   If anything here throws, we answer 500 and Stripe retries for up
   to three days. Every stock move is guarded by its current status,
   so a retry can never move the same units twice.
   ============================================================ */
import { stripe } from "../lib/stripe.mjs";
import { inventoryEnabled } from "../lib/db.mjs";
import {
  markSold, markPending, release, refundRestock, eventSeen, recordEvent
} from "../lib/inventory.mjs";

export default async (request) => {
  const signature = request.headers.get("stripe-signature");
  const raw = await request.text();

  let event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Signature check failed:", err.message);
    return new Response("Invalid signature", { status: 400 });
  }

  const live = inventoryEnabled();

  try {
    if (live && await eventSeen(event.id)) return ok({ duplicate: true });
    await handle(event, live);
    if (live) await recordEvent(event.id, event.type);
  } catch (err) {
    console.error(`Webhook ${event.type} ${event.id} failed — Stripe will retry:`, err);
    return new Response("Processing failed", { status: 500 });
  }
  return ok();
};

async function handle(event, live) {
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const holdId = obj.metadata?.hold_id;

      /* Klarna and Clearpay settle asynchronously. Do not pack anything
         until payment_status is "paid" — otherwise a declined BNPL
         application can leave you shipping goods you were never paid for.
         The stock stays out of inventory while it settles. */
      if (obj.payment_status !== "paid") {
        console.log("Session complete but not yet paid — stock held:", obj.id);
        if (live && holdId) report(await markPending(holdId), obj.id);
        break;
      }

      if (live && holdId) report(await markSold(holdId), obj.id);
      await logOrder(obj);
      break;
    }

    case "checkout.session.async_payment_succeeded": {
      const holdId = obj.metadata?.hold_id;
      console.log("Delayed payment cleared:", obj.id);
      if (live && holdId) report(await markSold(holdId), obj.id);
      await logOrder(obj);
      break;
    }

    case "checkout.session.async_payment_failed": {
      const holdId = obj.metadata?.hold_id;
      console.log("Delayed payment failed — do not dispatch:", obj.id);
      if (live && holdId) await release(holdId, "payment failed (Klarna/Clearpay/bank)", obj.id);
      break;
    }

    case "checkout.session.expired": {
      const holdId = obj.metadata?.hold_id;
      if (live && holdId) {
        const back = await release(holdId, "checkout abandoned", obj.id);
        if (back.length) console.log("Abandoned checkout, stock returned:", obj.id, back);
      }
      break;
    }

    case "charge.refunded": {
      /* Only a FULL refund puts stock back. A partial refund is usually
         goodwill (a dented box, late post) and the item has gone.
         Set RESTOCK_ON_REFUND=off to make every refund manual. */
      if (!live || !obj.refunded || process.env.RESTOCK_ON_REFUND === "off") {
        console.log("Refund — no automatic restock:", obj.id, `${obj.amount_refunded}/${obj.amount}`);
        break;
      }
      if (!obj.payment_intent) break;
      const pi = await stripe().paymentIntents.retrieve(
        typeof obj.payment_intent === "string" ? obj.payment_intent : obj.payment_intent.id
      );
      const holdId = pi.metadata?.hold_id;
      if (!holdId) { console.log("Refund for an order placed before live stock — restock by hand:", obj.id); break; }
      const back = await refundRestock(holdId, obj.id);
      console.log("Full refund, restocked:", obj.id, back);
      break;
    }

    case "charge.dispute.created":
      /* Attach the packing photograph and any unboxing video here. */
      console.log("CHARGEBACK OPENED:", obj.id);
      break;
  }
}

function report(result, sessionId) {
  if (result?.unknown) console.log("No stock hold for this session (placed before live stock):", sessionId);
  if (result?.oversold?.length) {
    console.error("ACTION NEEDED — OVERSOLD. Paid for units no longer in stock:", sessionId, result.oversold);
  }
}

/* Stripe can't limit a US address to mainland states, so check after
   payment. Alaska, Hawaii, territories and military mail aren't covered by
   the US rates: shout so Omar refunds or contacts the buyer before posting. */
const NOT_MAINLAND = new Set(["AK", "HI", "PR", "GU", "VI", "AS", "MP", "UM", "AA", "AE", "AP", "FM", "MH", "PW"]);
function checkUsAddress(session) {
  const a = session.shipping_details?.address || session.collected_information?.shipping_details?.address;
  if (a?.country === "US" && NOT_MAINLAND.has(String(a.state || "").toUpperCase())) {
    console.error("ACTION NEEDED — US order to a non-mainland address (" + a.state + "). Refund or contact the buyer before posting:", session.id);
    return false;
  }
  return true;
}

async function logOrder(session) {
  checkUsAddress(session);
  const items = await stripe().checkout.sessions.listLineItems(session.id, { limit: 50 });
  console.log("PAID ORDER", {
    id: session.id,
    email: session.customer_details?.email,
    total: session.amount_total,
    destination: session.metadata?.destination || "GB",
    freeGift: session.metadata?.gift_sku || null,
    delivery: session.shipping_cost?.amount_total,   // which service: see the payment in Stripe
    method: session.payment_method_types,
    lines: items.data.map((l) => `${l.quantity} × ${l.description}`)
  });
}

export { checkUsAddress };

function ok(extra = {}) {
  return new Response(JSON.stringify({ received: true, ...extra }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
}

export const config = { path: "/api/stripe-webhook" };
