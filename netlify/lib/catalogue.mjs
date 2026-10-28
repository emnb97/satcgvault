/* ============================================================
   The catalogue as the functions see it: Sanity live when
   SANITY_PROJECT_ID is set (so a price change or a freeze takes
   effect without a rebuild), else data/products.json.

   data/products.json travels with the bundle via included_files
   in netlify.toml. A bundled function does not sit where its
   source did, so several paths are tried; first one wins.
   ============================================================ */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  join(process.cwd(), "data", "products.json"),
  join(HERE, "data", "products.json"),
  join(HERE, "..", "..", "data", "products.json"),
  join(HERE, "..", "..", "..", "data", "products.json")
];

let fallback = { currency: "GBP", freeShippingThresholdPence: 5000, standardShippingPence: 599, nextDayShippingPence: 699, products: [] };
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

/* Cached for a minute so a burst of checkouts doesn't hammer the CMS. */
let cache = null, cachedAt = 0;
export async function catalogueNow() {
  if (!process.env.SANITY_PROJECT_ID) return fallback;
  if (cache && Date.now() - cachedAt < 60_000) return cache;

  const q = `*[_type == "product" && !hidden && availability != "hidden"]{ "sku": sku, name, pricePence, stock, frozen, weightGrams, freeGift, era,
    availability, "set": set, "type": type, language, condition, "slug": slug.current }`;
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

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra }
  });
}

/* ---------- weights (for international postage bands) ----------
   A product's own "Shipping weight" in Sanity wins. Without one, a
   typical weight for its type is used, so a single card isn't charged
   as if it weighed as much as a booster box. Keep in step with
   scripts/catalogue.mjs. */
export const TYPE_WEIGHT = {
  "Booster Box": 480, "High Class Box": 450, "Elite Trainer Box": 900, "Blister Pack": 120,
  "Single Card": 20, "Twin Set": 250, "Special Set": 500, "Mystery Pouch": 60,
  "Display Case": 350, "Accessory": 300
};
export const weightOf = (p) => (p.weightGrams > 0 ? p.weightGrams : (TYPE_WEIGHT[p.type] ?? 480));

/* ---------- the free gift ----------------------------------------
   The product Omar ticks "Free gift with orders over £50" on in Sanity.
   Frozen, teaser or hidden products are never given away. */
export const findGift = (products) =>
  products.find((p) => p.freeGift && !p.frozen && (p.availability || "stock") !== "sourced") || null;
export const giftLabel = (p) =>
  p && (p.type === "Mystery Pouch" || p.era === "Mystery Pouches" || /mystery/i.test(p.name)) ? "mystery pouch" : "gift";
