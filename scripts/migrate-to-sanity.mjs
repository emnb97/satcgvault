/* ============================================================
   One-time migration: products.json -> Sanity
   Uploads each product's photos into Sanity's asset store and
   creates a product document referencing them, so Omar opens the
   Studio to a fully populated, image-complete catalogue.

   Run once, from the repo root:
     export SANITY_PROJECT_ID="..."
     export SANITY_TOKEN="..."        # Editor-permission token
     node scripts/migrate-to-sanity.mjs

   Safe to re-run: documents use deterministic IDs (product-<sku>),
   so a second run updates rather than duplicates. It will NOT wipe
   anything Omar has since added.
   ============================================================ */
import { readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROJECT = process.env.SANITY_PROJECT_ID;
const TOKEN = process.env.SANITY_TOKEN;

if (!PROJECT || !TOKEN) {
  console.error("Set SANITY_PROJECT_ID and SANITY_TOKEN first. See the runbook.");
  process.exit(1);
}

const client = createClient({
  projectId: PROJECT,
  dataset: process.env.SANITY_DATASET || "production",
  apiVersion: "2024-01-01",
  token: TOKEN,
  useCdn: false
});

const cfg = JSON.parse(await readFile(path.join(ROOT, "data", "products.json"), "utf8"));

/* Upload one local WebP, return the Sanity asset reference. Cached so a
   photo shared between products only uploads once. */
const assetCache = new Map();
async function uploadImage(relUrl, alt) {
  const clean = relUrl.replace(/^\//, "");                 // assets/photos/0374.webp
  if (assetCache.has(clean)) return assetCache.get(clean);
  const abs = path.join(ROOT, clean);
  if (!existsSync(abs)) { console.warn("  ! missing image:", clean); return null; }

  const asset = await client.assets.upload("image", createReadStream(abs), {
    filename: path.basename(abs)
  });
  const ref = {
    _type: "image",
    _key: path.basename(abs, ".webp"),
    asset: { _type: "reference", _ref: asset._id },
    alt: alt || ""
  };
  assetCache.set(clean, ref);
  return ref;
}

let created = 0;
for (const p of cfg.products) {
  process.stdout.write(`- ${p.name} ${p.type} ... `);

  const images = [];
  for (const im of p.images || []) {
    if (im && im.url) {
      const ref = await uploadImage(im.url, im.alt);
      if (ref) images.push({ ...ref, _key: ref._key + "-" + images.length });
    }
  }

  const doc = {
    _id: `product-${p.sku}`,
    _type: "product",
    name: p.name,
    jp: p.jp || "",
    type: p.type,
    slug: { _type: "slug", current: p.slug },
    sku: p.sku,
    code: p.code || "",
    era: p.era || "",
    set: p.set || "",
    category: p.category,
    availability: p.availability || (p.preorder ? "inbound" : "stock"),
    cardsPerPack: p.cardsPerPack || 0,
    language: p.language || "Japanese",
    images,
    pricePence: p.pricePence,
    stock: p.stock ?? 0,
    frozen: false,
    hidden: false,
    preorder: !!p.preorder,
    dispatch: p.dispatch || "",
    rarity: p.rarity || "vault",
    packs: p.packs || 0,
    condition: p.condition || "Factory sealed",
    sealed: p.sealed !== false,
    weightGrams: p.weightGrams || 480,
    summary: p.summary || "",
    detail: p.detail || ""
  };

  await client.createOrReplace(doc);
  created++;
  console.log(`done (${images.length} photo${images.length === 1 ? "" : "s"})`);
}

console.log(`\nMigrated ${created} products into Sanity project ${PROJECT}.`);
console.log("Open the Studio to see them, then set the Netlify env vars to go live from the CMS.");
