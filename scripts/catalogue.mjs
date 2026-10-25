/* ============================================================
   Catalogue source.

   If SANITY_PROJECT_ID is set, products come from the CMS and
   Omar's edits go live on the next build. If it isn't, we fall
   back to data/products.json so the site always builds — during
   development, or if Sanity is ever unreachable mid-deploy.
   ============================================================ */
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const CONSIGN_QUERY = `*[_type == "consignment" && !hidden] | order(date desc){
  "ref": ref, "date": date, origin, lines, cartons, note,
  "image": image.asset->url, "alt": image.alt
}`;

const QUERY = `*[_type == "product" && !hidden && availability != "hidden"] | order(
  coalesce(orderRank, "zzz") asc, name asc
){
  "sku": sku,
  "slug": slug.current,
  name, jp, type, code, set, era, language, category, availability,
  packs, cardsPerPack, condition, sealed, preorder, rarity, frozen,
  pricePence, stock, dispatch, weightGrams, summary, detail,
  "images": images[]{ "url": asset->url, "thumb": asset->url, alt }
}`;

export async function loadCatalogue() {
  const local = JSON.parse(await readFile(path.join(ROOT, "data", "products.json"), "utf8"));
  const projectId = process.env.SANITY_PROJECT_ID;

  if (!projectId) {
    console.log("Catalogue: data/products.json (no SANITY_PROJECT_ID set)");
    return { ...local, products: local.products.map(normalise) };
  }

  const dataset = process.env.SANITY_DATASET || "production";
  const url = `https://${projectId}.apicdn.sanity.io/v2024-01-01/data/query/${dataset}?query=${encodeURIComponent(QUERY)}`;

  try {
    const res = await fetch(url, {
      headers: process.env.SANITY_READ_TOKEN
        ? { Authorization: `Bearer ${process.env.SANITY_READ_TOKEN}` }
        : {}
    });
    if (!res.ok) throw new Error(`Sanity returned ${res.status}`);
    const { result } = await res.json();
    if (!Array.isArray(result) || !result.length) throw new Error("Empty result");

    // Fetch arrival-ledger records too.
    let consignments = local.consignments || [];
    try {
      const cUrl = `https://${projectId}.apicdn.sanity.io/v2024-01-01/data/query/${dataset}?query=${encodeURIComponent(CONSIGN_QUERY)}`;
      const cRes = await fetch(cUrl, process.env.SANITY_READ_TOKEN ? { headers: { Authorization: `Bearer ${process.env.SANITY_READ_TOKEN}` } } : {});
      const cJson = await cRes.json();
      if (Array.isArray(cJson.result) && cJson.result.length) {
        consignments = cJson.result.map((c) => ({
          ...c,
          image: c.image ? `${c.image}?w=800&h=640&fit=crop&auto=format&q=78` : null
        }));
      }
    } catch { /* keep local consignments */ }

    console.log(`Catalogue: Sanity CMS (${result.length} products, ${consignments.length} consignments)`);
    return { ...local, products: result.map(normalise), consignments };
  } catch (err) {
    /* Never fail a deploy because the CMS blinked. Build the last
       known-good catalogue and make the reason loud in the log. */
    console.warn(`Catalogue: Sanity unavailable (${err.message}) — using data/products.json`);
    return { ...local, products: local.products.map(normalise) };
  }
}

function normalise(p) {
  const avail = p.availability || "stock";
  return {
    ...p,
    availability: avail,
    preorder: avail === "inbound" || !!p.preorder,
    sourced: avail === "sourced",
    packs: p.packs || 0,
    stock: p.frozen ? 0 : (p.stock ?? 0),
    frozen: !!p.frozen,
    rarity: p.rarity || "vault",
    condition: p.condition || "Factory sealed",
    sealed: p.sealed !== false,
    weightGrams: p.weightGrams || 480,
    /* Sanity's image CDN does format conversion and resizing on the
       fly, so we ask for AVIF at the size we actually render. */
    images: (p.images || []).map((im) => {
      const isSanity = im.url && im.url.includes("cdn.sanity.io");
      return {
        url: !im.url ? null : isSanity ? `${im.url}?w=1000&h=1000&fit=max&auto=format&q=80` : im.url,
        thumb: !im.thumb && !im.url ? null : isSanity ? `${(im.thumb||im.url)}?w=480&h=600&fit=crop&auto=format&q=78` : (im.thumb || im.url),
        alt: im.alt || `${p.name} ${p.type}`
      };
    })
  };
}

/* ---------- live stock overlay ---------------------------------
   With DATABASE_URL set, Postgres owns how many of each SKU can be
   bought. The pages are baked with that number so a rebuild always
   matches checkout; the browser then refreshes it from /api/stock.
   SKUs Postgres hasn't seen yet keep Sanity's opening figure. A
   database hiccup never fails a deploy — it just bakes Sanity's. */
export async function overlayLiveStock(products) {
  if (!process.env.DATABASE_URL) return { live: false };
  try {
    const { default: postgres } = await import("postgres");
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.delete("channel_binding");
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) url.searchParams.set("sslmode", "require");
    const sql = postgres(url.toString(), { max: 1, connect_timeout: 8, prepare: false, onnotice: () => {} });
    const rows = await sql`SELECT sku, available FROM inventory`;
    await sql.end({ timeout: 2 });
    const map = Object.fromEntries(rows.map((r) => [r.sku, r.available]));
    let n = 0;
    for (const p of products) {
      if (p.frozen || !(p.sku in map)) continue;
      p.stock = map[p.sku];
      n++;
    }
    console.log(`Stock: live from Postgres (${n} SKUs)`);
    return { live: true };
  } catch (err) {
    console.warn(`Stock: Postgres unavailable at build (${err.message}) — baking Sanity figures`);
    return { live: true };   // runtime endpoint still live; checkout still gated
  }
}

/* ---------- catalogue check ------------------------------------
   Prints a to-do list in the build log: products a customer would
   see with something missing or contradictory. It never fails the
   build — it's a list for Omar to work through in Sanity.
   Keep TYPE_CATEGORIES in step with the warning in
   sanity/schemas/product.js. */
export const TYPE_CATEGORIES = {
  "Booster Box": ["booster-box", "special", "preorder"],
  "High Class Box": ["booster-box", "special", "preorder"],
  "Elite Trainer Box": ["etb", "preorder"],
  "Blister Pack": ["blister", "preorder"],
  "Single Card": ["single"],
  "Twin Set": ["special", "preorder"],
  "Special Set": ["special", "preorder"],
  "Mystery Pouch": ["special", "preorder"],
  "Display Case": ["accessories"],
  "Accessory": ["accessories"]
};
const NO_SET = new Set(["Display Case", "Accessory"]);

export function checkCatalogue(products) {
  const issues = [];
  const add = (p, msg) => issues.push(`  ${p.name || "(no name)"} [${p.sku || "no SKU"}]: ${msg}`);
  const seen = new Map();
  for (const p of products) {
    const key = `${(p.name || "").trim().toLowerCase()}|${p.type}`;
    if (seen.has(key)) add(p, `same name and type as ${seen.get(key)} — duplicate?`);
    else seen.set(key, p.sku);
    if (!p.images || !p.images.length) add(p, "no photograph — showing a drawn placeholder");
    if (!p.category) add(p, "no shop category — won't appear under any filter");
    else if (TYPE_CATEGORIES[p.type] && !TYPE_CATEGORIES[p.type].includes(p.category)) {
      add(p, `type "${p.type}" filed under category "${p.category}"`);
    }
    if (!TYPE_CATEGORIES[p.type]) add(p, `unrecognised product type "${p.type ?? ""}"`);
    if (!NO_SET.has(p.type)) {
      if (!p.code) add(p, "no set code");
      if (!p.set) add(p, "no series");
    }
    if (!p.language) add(p, "no language");
    if (!p.summary) add(p, "no short description");
    if (!p.dispatch && p.availability !== "sourced") add(p, "no dispatch line");
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === "string" && /^(null|undefined|\[.*\])$/i.test(v.trim())) add(p, `field "${k}" contains "${v}"`);
    }
  }
  if (issues.length) console.log(`Catalogue check: ${issues.length} thing(s) for Omar to fix in Sanity:\n${issues.join("\n")}`);
  else console.log("Catalogue check: all products complete");
  return issues;
}
