/* ============================================================
   npm run db:setup  — run ONCE when the database is first created.
   Safe to re-run: creates tables only if missing, and seeds stock
   only for SKUs that aren't in the database yet. It never
   overwrites a live count.

   PowerShell:
     $env:DATABASE_URL = "postgresql://...neon pooled string..."
     $env:SANITY_PROJECT_ID = "fiay3p8h"
     npm run db:setup
   ============================================================ */
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { loadCatalogue } from "./catalogue.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. In PowerShell:  $env:DATABASE_URL = \"postgresql://...\"");
  process.exit(1);
}

const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete("channel_binding");
if (!["localhost", "127.0.0.1"].includes(url.hostname)) url.searchParams.set("sslmode", "require");
const sql = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => {} });

try {
  await sql.unsafe(await readFile(path.join(ROOT, "db", "schema.sql"), "utf8"));
  console.log("Tables ready.");

  const { products } = await loadCatalogue();
  const rows = products.filter((p) => p.sku && !p.sourced)
    .map((p) => ({ sku: p.sku, available: Math.max(0, parseInt(p.stock, 10) || 0) }));
  const created = rows.length ? await sql`
    INSERT INTO inventory ${sql(rows, "sku", "available")}
    ON CONFLICT (sku) DO NOTHING RETURNING sku, available` : [];
  for (const r of created) {
    await sql`INSERT INTO stock_log (sku, delta, available_after, reason)
              VALUES (${r.sku}, ${r.available}, ${r.available}, 'opening stock from Sanity')`;
  }

  const all = await sql`SELECT sku, available FROM inventory ORDER BY sku`;
  console.log(`Seeded ${created.length} new line(s); ${all.length - created.length} already existed and were left alone.\n`);
  console.table(all);
} catch (err) {
  console.error("Setup failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
