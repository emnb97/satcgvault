/* ============================================================
   POST /.netlify/functions/stripe-webhook
   Stripe calls this. It is the only trustworthy signal that an
   order is paid — the browser redirect is not, because a shopper
   can close the tab or visit the success URL directly.

   Set STRIPE_WEBHOOK_SECRET from the Stripe Dashboard endpoint.
   ============================================================ */
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async (request) => {
  const signature = request.headers.get("stripe-signature");
  const raw = await request.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Signature check failed:", err.message);
    return new Response("Invalid signature", { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;

      /* Klarna and Clearpay settle asynchronously. Do not pack anything
         until payment_status is "paid" — otherwise a declined BNPL
         application can leave you shipping goods you were never paid for. */
      if (session.payment_status !== "paid") {
        console.log("Session complete but not yet paid:", session.id);
        break;
      }

      const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 50 });
      console.log("PAID ORDER", {
        id: session.id,
        email: session.customer_details?.email,
        total: session.amount_total,
        method: session.payment_method_types,
        lines: items.data.map((l) => `${l.quantity} × ${l.description}`)
      });

      /* TODO when a database is added:
         - write the order row
         - decrement stock
         - send the dispatch email
         Until then, orders are worked from the Stripe Dashboard. */
      break;
    }

    case "checkout.session.async_payment_succeeded":
      console.log("Delayed payment cleared:", event.data.object.id);
      break;

    case "checkout.session.async_payment_failed":
      console.log("Delayed payment failed — do not dispatch:", event.data.object.id);
      break;

    case "charge.dispute.created":
      /* Attach the packing photograph and any unboxing video here. */
      console.log("CHARGEBACK OPENED:", event.data.object.id);
      break;
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

export const config = { path: "/api/stripe-webhook" };
