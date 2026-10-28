/* ============================================================
   POST /.netlify/functions/create-checkout-session
   Body: { items: [{ sku, qty }], destination?: "GB" | "US" }
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
import { catalogueNow, json, weightOf, findGift, giftLabel } from "../lib/catalogue.mjs";
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

  /* Where it's going. UK unless the bag says the United States; anything
     else is refused rather than guessed. */
  const destination = payload?.destination === "US" ? "US" : "GB";
  if (payload?.destination && !["GB", "US"].includes(payload.destination)) {
    return json({ error: "We deliver to the UK and the mainland United States." }, 400);
  }
  const intl = destination === "US" ? catalogue.international?.US : null;
  if (destination === "US" && !intl) return json({ error: "US delivery isn't available right now." }, 409);

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

    products.push({ ...product, qty });
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

  /* ---- US postage band: by weight, packed ---- */
  const packaging = catalogue.packagingGrams ?? 150;
  const paidGrams = products.reduce((g, p) => g + weightOf(p) * p.qty, 0) + packaging;
  let usBand = null;
  if (intl) {
    usBand = intl.bands.find((b) => paidGrams <= b.maxGrams);
    if (!usBand) {
      const max = intl.bands[intl.bands.length - 1].maxGrams / 1000;
      return json({ error: `US orders can weigh up to ${max} kg packed (this one is about ${(paidGrams / 1000).toFixed(1)} kg). Email info@satcgvault.co.uk for a quote on a larger order.` }, 409);
    }
  }

  /* ---- free gift over the offer threshold ----
     One of the product ticked "Free gift" in Sanity, taken from its real
     stock alongside the order. If there are none left, or it would push a
     US parcel past the heaviest band, the order goes ahead without it.
     The band is priced on the paid items only, so a free gift never moves
     a shopper into a dearer band. */
  const offer = catalogue.offer || {};
  let gift = null;
  if (offer.enabled !== false && subtotal >= (offer.thresholdPence ?? 5000)) {
    const g = findGift(catalogue.products);
    const fits = !intl || paidGrams + weightOf(g || {}) <= intl.bands[intl.bands.length - 1].maxGrams;
    if (g && fits && (live || g.stock > 0)) gift = g;
  }

  /* ---- take the stock ---- */
  const holdId = randomUUID();
  const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000);
  if (live) {
    try {
      await ensureRows(gift ? [...products, gift] : products);
      try {
        await reserve(holdId, gift ? [...holdLines, { sku: gift.sku, qty: 1 }] : holdLines, expiresAt);
      } catch (err) {
        /* Gift sold out (or the gift is the very thing that's short): try
           again without it, so the gift can never block a real order. */
        if (!(gift && err instanceof OutOfStock)) throw err;
        gift = null;
        await reserve(holdId, holdLines, expiresAt);
      }
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

  /* Delivery (data/products.json): Royal Mail Tracked 48, free over the
     threshold; Royal Mail Tracked 24 for next working day, always charged.
     The shopper picks one on Stripe's page; Tracked 48 is listed first, so
     it's the default. */
  if (gift) {
    line_items.push({
      quantity: 1,
      price_data: {
        currency: "gbp",
        unit_amount: 0,
        product_data: {
          name: `Free gift: ${gift.name}`,
          description: `Free ${giftLabel(gift)} with orders over £${((offer.thresholdPence ?? 5000) / 100).toFixed(0)}`,
          metadata: { sku: gift.sku, slug: gift.slug, gift: "true" }
        }
      }
    });
  }

  const free48 = subtotal >= catalogue.freeShippingThresholdPence;
  const freeOver = "£" + (catalogue.freeShippingThresholdPence / 100).toFixed(0);
  const nextDay = catalogue.nextDayShippingPence ?? 699;

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
      shipping_address_collection: { allowed_countries: [destination] },
      phone_number_collection: { enabled: true },
      shipping_options: intl ? [{
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: `${intl.service} — USA, up to ${usBand.maxGrams / 1000} kg`,
          fixed_amount: { amount: usBand.pence, currency: "gbp" },
          delivery_estimate: {
            minimum: { unit: "business_day", value: intl.minDays },
            maximum: { unit: "business_day", value: intl.maxDays }
          }
        }
      }] : [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            display_name: free48 ? `Royal Mail Tracked 48 — free over ${freeOver}` : "Royal Mail Tracked 48",
            fixed_amount: { amount: free48 ? 0 : catalogue.standardShippingPence, currency: "gbp" },
            delivery_estimate: {
              minimum: { unit: "business_day", value: 2 },
              maximum: { unit: "business_day", value: 3 }
            }
          }
        },
        {
          shipping_rate_data: {
            type: "fixed_amount",
            display_name: "Royal Mail Tracked 24 — next working day",
            fixed_amount: { amount: nextDay, currency: "gbp" },
            delivery_estimate: {
              minimum: { unit: "business_day", value: 1 },
              maximum: { unit: "business_day", value: 1 }
            }
          }
        }
      ],
      consent_collection: { terms_of_service: "required" },
      custom_text: {
        terms_of_service_acceptance: {
          message: `I agree to the [terms and conditions](${SITE}/policies/terms.html), [returns policy](${SITE}/policies/returns.html) and [privacy policy](${SITE}/policies/privacy.html).`
        },
        submit: { message: "We film every parcel as we pack it. Please film yours as you open it." },
        ...(intl ? { shipping_address: { message: "Mainland United States only — we can't deliver to Alaska, Hawaii, US territories or military (APO/FPO) addresses." } } : {})
      },
      /* The hold id travels on the session (for checkout.session.*
         events) and on the PaymentIntent (for refunds, which arrive
         as charge events with no session attached). */
      client_reference_id: holdId,
      metadata: { hold_id: holdId, destination, ...(gift ? { gift_sku: gift.sku } : {}) },
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
