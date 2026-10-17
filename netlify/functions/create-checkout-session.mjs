/* ============================================================
   POST /.netlify/functions/create-checkout-session
   Body: { items: [{ sku, qty }] }
   Returns: { url }  — or 409 { error, sku, available } when short

   The browser sends SKUs and quantities only. Prices and freeze
   state come from the catalogue (Sanity live, else products.json),
   so a user editing local storage cannot change what they pay.

   STOCK. With DATABASE_URL set, the units are taken out of the
   Postgres inventory *before* Stripe is opened — atomically, all
   lines or none. The hold id rides on the Stripe session, and the
   webhook (or, as a backstop, the sweeper) settles it:
     paid            -> sold
     BNPL settling   -> pending (stock stays out)
     expired/failed  -> released back to inventory
   Without DATABASE_URL, this falls back to the old Sanity check.
   ============================================================ */
import { randomUUID } from "node:crypto";
import { stripe } from "../lib/stripe.mjs";
import { catalogueNow, json } from "../lib/catalogue.mjs";
import { inventoryEnabled } from "../lib/db.mjs";
import { ensureRows, reserve, attachSession, release, OutOfStock } from "../lib/inventory.mjs";

const SITE = process.env.URL || process.env.DEPLOY_PRIME_URL || "http://localhost:8888";
const MAX_LINES = 20;
const MAX_QTY = 12;
/* Stripe's minimum session lifetime is 30 minutes. A minute's margin
   so a slow request never asks for 29:59 and gets refused. */
const HOLD_MINUTES = 31;

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!process.env.STRIPE_SECRET_KEY) return json({ error: "Payments are not configured yet." }, 503);

  let payload;
  try { payload = await request.json(); } catch { return json({ error: "Bad request" }, 400); }

  const requested = Array.isArray(payload?.items) ? payload.items.slice(0, MAX_LINES) : [];
  if (!requested.length) return json({ error: "Your bag is empty." }, 400);

  const catalogue = await catalogueNow();
  const live = inventoryEnabled();

  const line_items = [];
  const holdLines = [];
  const products = [];
  let subtotal = 0;

  for (const row of requested) {
    const product = catalogue.products.find((p) => p.sku === row.sku);
    if (!product) return json({ error: `We no longer stock ${row.sku}.`, sku: row.sku, available: 0 }, 409);
    if (product.frozen) return json({ error: `${product.name} is temporarily unavailable.` }, 409);
    if (product.availability === "sourced") return json({ error: `${product.name} isn't on sale yet.` }, 409);

    const qty = Math.max(1, Math.min(parseInt(row.qty, 10) || 1, MAX_QTY));
    /* Without the database, Sanity's number is the only check we have. */
    if (!live && product.stock < qty) {
      return json({ error: `Only ${product.stock} of ${product.name} left.`, sku: product.sku, available: product.stock }, 409);
    }

    products.push(product);
    holdLines.push({ sku: product.sku, qty });
    subtotal += product.pricePence * qty;
    line_items.push({
      quantity: qty,
      price_data: {
        currency: "gbp",
        unit_amount: product.pricePence,
        product_data: {
          name: product.name,
          description: [product.type, product.set, product.language].filter(Boolean).join(" · "),
          metadata: { sku: product.sku, slug: product.slug }
        }
      }
    });
  }

  /* ---- take the stock ---- */
  const holdId = randomUUID();
  const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000);
  if (live) {
    try {
      await ensureRows(products);
      await reserve(holdId, holdLines, expiresAt);
    } catch (err) {
      if (err instanceof OutOfStock) {
        const name = products.find((p) => p.sku === err.sku)?.name || err.sku;
        return json({
          error: err.available > 0
            ? `Only ${err.available} of ${name} left — your bag has been updated.`
            : `${name} has just sold out — it's been taken out of your bag.`,
          sku: err.sku,
          available: err.available
        }, 409);
      }
      /* Database unreachable: refuse rather than sell stock we can't
         account for. Sealed allocations can't be magicked up later. */
      console.error("Inventory unavailable:", err.message);
      return json({ error: "Checkout is briefly unavailable. Please try again in a minute." }, 503);
    }
  }

  const shipping = subtotal >= catalogue.freeShippingThresholdPence ? 0 : catalogue.standardShippingPence;
  const freeOver = "£" + (catalogue.freeShippingThresholdPence / 100).toFixed(0);

  try {
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items,
      currency: "gbp",
      /* Payment methods are switched on in the Stripe Dashboard, not here.
         Leaving this to dynamic payment methods lets Stripe show Klarna and
         Clearpay only when the basket and the shopper actually qualify. */
      automatic_tax: { enabled: false },
      billing_address_collection: "required",
      shipping_address_collection: { allowed_countries: ["GB"] },
      phone_number_collection: { enabled: true },
      shipping_options: [{
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: shipping === 0 ? `Tracked 48 — free over ${freeOver}` : "Tracked 48",
          fixed_amount: { amount: shipping, currency: "gbp" },
          delivery_estimate: {
            minimum: { unit: "business_day", value: 2 },
            maximum: { unit: "business_day", value: 3 }
          }
        }
      }],
      consent_collection: { terms_of_service: "required" },
      custom_text: {
        terms_of_service_acceptance: {
          message: `I agree to the [terms and conditions](${SITE}/policies/terms.html), [returns policy](${SITE}/policies/returns.html) and [privacy policy](${SITE}/policies/privacy.html).`
        },
        submit: { message: "We film every parcel as we pack it. Please film yours as you open it." }
      },
      /* The hold id travels on the session (for checkout.session.*
         events) and on the PaymentIntent (for refunds, which arrive
         as charge events with no session attached). */
      client_reference_id: holdId,
      metadata: { hold_id: holdId },
      payment_intent_data: { metadata: { hold_id: holdId } },
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      success_url: `${SITE}/order-confirmed.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE}/checkout-cancelled.html?hold=${holdId}`
    });

    if (live) {
      /* If this write fails the hold still carries no session id; the
         sweeper releases it after expiry, and a payment in the meantime
         is still matched by the hold id in the session metadata. */
      try { await attachSession(holdId, session.id); }
      catch (err) { console.error("Could not attach session to hold:", holdId, err.message); }
    }
    return json({ url: session.url });
  } catch (err) {
    console.error("Stripe session failed:", err.message);
    if (live) {
      try { await release(holdId, "checkout failed to open"); }
      catch (e) { console.error("Release after Stripe failure failed (sweeper will retry):", holdId, e.message); }
    }
    return json({ error: "We could not open checkout. Please try again." }, 502);
  }
};
