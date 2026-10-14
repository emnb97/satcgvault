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
