/* ============================================================
   POST /.netlify/functions/create-checkout-session
   Body: { items: [{ sku, qty }] }
   Returns: { url }

   The browser sends SKUs and quantities only. Prices, stock and
   shipping are resolved here from data/products.json, so a user
   editing local storage cannot change what they are charged.
   ============================================================ */
import Stripe from "stripe";
/* Read the same catalogue the build read. Loaded with readFileSync rather
   than a JSON import attribute: the bundler that packages Netlify functions
   is not always the one you tested against, and an import attribute is a
   needless way for a deploy to fail. netlify.toml ships the file via
   included_files. If the CMS is the source of truth, set SANITY_PROJECT_ID
   and this queries it directly so a price change or a freeze takes effect
   immediately, without waiting for a rebuild. */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* The catalogue, loaded from disk rather than through a JSON import
   attribute — the bundler that packages Netlify functions is not always
   the one you tested against, and an import attribute is a needless way
   for a deploy to fail.

   The path is tried in several forms because a bundled function does not
   sit where its source did: included_files land relative to the task
   root, not next to the emitted module. First one that exists wins, and
   if none do the site still deploys and only checkout reports the fault. */
const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  join(process.cwd(), "data", "products.json"),
  join(HERE, "data", "products.json"),
  join(HERE, "..", "..", "data", "products.json"),
  join(HERE, "..", "..", "..", "data", "products.json")
];

let fallback = { currency: "GBP", freeShippingThresholdPence: 7500, standardShippingPence: 499, products: [] };
for (const candidate of CANDIDATES) {
  try {
    if (!existsSync(candidate)) continue;
    fallback = JSON.parse(readFileSync(candidate, "utf8"));
    break;
  } catch { /* try the next one */ }
}
if (!fallback.products.length) {
  console.error("Catalogue not found. Checked:\n" + CANDIDATES.join("\n"));
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const SITE = process.env.URL || process.env.DEPLOY_PRIME_URL || "http://localhost:8888";

const MAX_LINES = 20;
const MAX_QTY = 12;

export default async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return json({ error: "Payments are not configured yet." }, 503);
  }

  const catalogue = await catalogueNow();

  let payload;
  try { payload = await request.json(); } catch { return json({ error: "Bad request" }, 400); }

  const requested = Array.isArray(payload?.items) ? payload.items.slice(0, MAX_LINES) : [];
  if (!requested.length) return json({ error: "Your bag is empty." }, 400);

  const line_items = [];
  let subtotal = 0;

  for (const row of requested) {
    const product = catalogue.products.find((p) => p.sku === row.sku);
    if (!product) return json({ error: `We no longer stock ${row.sku}.` }, 409);
    if (product.frozen) return json({ error: `${product.name} is temporarily unavailable.` }, 409);

    const qty = Math.max(1, Math.min(parseInt(row.qty, 10) || 1, MAX_QTY));
    if (product.stock < qty) {
      return json({ error: `Only ${product.stock} of ${product.name} left.` }, 409);
    }

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

  const shipping = subtotal >= catalogue.freeShippingThresholdPence ? 0 : catalogue.standardShippingPence;

  try {
    const session = await stripe.checkout.sessions.create({
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
          display_name: shipping === 0 ? "Tracked 48 — free over £50" : "Tracked 48",
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
      success_url: `${SITE}/order-confirmed.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE}/checkout-cancelled.html`
    });

    return json({ url: session.url });
  } catch (err) {
    console.error("Stripe session failed:", err.message);
    return json({ error: "We could not open checkout. Please try again." }, 502);
  }
};

/* Live catalogue read, cached for a minute so a burst of checkouts
   doesn't hammer the CMS. Falls back to the built-in file. */
let cache = null, cachedAt = 0;
async function catalogueNow() {
  if (!process.env.SANITY_PROJECT_ID) return fallback;
  if (cache && Date.now() - cachedAt < 60_000) return cache;

  const q = `*[_type == "product" && !hidden]{ "sku": sku, name, pricePence, stock, frozen,
    "set": set, "type": type, language, condition, "slug": slug.current }`;
  const url = `https://${process.env.SANITY_PROJECT_ID}.apicdn.sanity.io/v2024-01-01/data/query/${process.env.SANITY_DATASET || "production"}?query=${encodeURIComponent(q)}`;

  try {
    const res = await fetch(url);
    const { result } = await res.json();
    if (!Array.isArray(result) || !result.length) throw new Error("empty");
    cache = { ...fallback, products: result };
    cachedAt = Date.now();
    return cache;
  } catch {
    return fallback;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
