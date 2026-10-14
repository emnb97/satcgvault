/* ============================================================
   One-time migration: consignments from products.json -> Sanity
   Run once:
     export SANITY_PROJECT_ID="fiay3p8h"
     export SANITY_TOKEN="your-editor-token"
     node scripts/migrate-consignments.mjs
   Safe to re-run: uses fixed IDs (consignment-<ref>), updates not duplicates.
   ============================================================ */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@sanity/client";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROJECT = process.env.SANITY_PROJECT_ID;
const TOKEN = process.env.SANITY_TOKEN;
if (!PROJECT || !TOKEN) { console.error("Set SANITY_PROJECT_ID and SANITY_TOKEN first."); process.exit(1); }

const client = createClient({
  projectId: PROJECT, dataset: process.env.SANITY_DATASET || "production",
  apiVersion: "2024-01-01", token: TOKEN, useCdn: false
});

const cfg = JSON.parse(await readFile(path.join(ROOT, "data", "products.json"), "utf8"));
const records = cfg.consignments || [];

let n = 0;
for (const r of records) {
  const id = "consignment-" + String(r.ref).replace(/[^a-zA-Z0-9]/g, "");
  await client.createOrReplace({
    _id: id,
    _type: "consignment",
    ref: r.ref,
    date: r.date,
    origin: r.origin || "Tokyo",
    lines: r.lines || 0,
    cartons: r.cartons || 0,
    note: r.note || "",
    hidden: false
    // Note: photos are NOT migrated — add a photo to each record in the Studio.
    // Until then the ledger shows a tidy reference-number placeholder, not a broken image.
  });
  n++;
  console.log(`- ${r.ref} (${r.date}) ... done`);
}
console.log(`\nMigrated ${n} consignments into Sanity. Add a photo to each in the Studio.`);
