/* ============================================================
   /api/desk — the stock desk Omar uses to receive and count stock.
   GET  -> every product with live numbers, plus recent stock moves
   POST -> { action: "adjust", sku, value, note }   +N received / -N removed
           { action: "set",    sku, value, note }   count set to N
           { action: "rebuild" }                    refresh the static pages

   Protected by DESK_KEY (Netlify env var). Send it as
   "Authorization: Bearer <key>". Wrong key -> 401 after a pause.
   ============================================================ */
import { createHash, timingSafeEqual } from "node:crypto";
import { inventoryEnabled } from "../lib/db.mjs";
import { catalogueNow, json } from "../lib/catalogue.mjs";
import { ensureRows, snapshot, recentLog, adjust, setCount, DeskError } from "../lib/inventory.mjs";

function authorised(request) {
  const key = process.env.DESK_KEY || "";
  if (key.length < 16) return false;              // refuse a weak or missing key outright
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(key).digest();
  return timingSafeEqual(a, b);
}

export default async (request) => {
  if (!authorised(request)) {
    await new Promise((r) => setTimeout(r, 800));  // slow down guessing
    return json({ error: "Wrong desk key." }, 401);
  }
  if (!inventoryEnabled()) return json({ error: "Live stock is not switched on (DATABASE_URL missing)." }, 503);

  try {
    if (request.method === "GET") return json(await state());

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const note = String(body.note || "").slice(0, 120) || null;
      const value = Number(body.value);

      if (body.action === "rebuild") {
        if (!process.env.NETLIFY_BUILD_HOOK) return json({ error: "No build hook set (NETLIFY_BUILD_HOOK)." }, 400);
        const r = await fetch(process.env.NETLIFY_BUILD_HOOK, { method: "POST" });
        return json({ ok: r.ok, message: r.ok ? "Site refresh started — live in about two minutes." : "Build hook refused." });
      }

      const catalogue = await catalogueNow();
      if (!catalogue.products.some((p) => p.sku === body.sku)) return json({ error: "Unknown SKU." }, 400);

      if (body.action === "adjust") await adjust(body.sku, value, note);
      else if (body.action === "set") await setCount(body.sku, value, note);
      else return json({ error: "Unknown action." }, 400);

      return json(await state());
    }
    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    if (err instanceof DeskError) return json({ error: err.message }, 400);
    console.error("Desk failed:", err);
    return json({ error: "Something went wrong — nothing was changed." }, 500);
  }
};

async function state() {
  const catalogue = await catalogueNow();
  await ensureRows(catalogue.products);
  const rows = Object.fromEntries((await snapshot()).map((r) => [r.sku, r]));
  const products = catalogue.products.map((p) => ({
    sku: p.sku, name: p.name, type: p.type, availability: p.availability || "stock", frozen: !!p.frozen,
    available: rows[p.sku]?.available ?? 0,
    held: rows[p.sku]?.held ?? 0,
    pending: rows[p.sku]?.pending ?? 0,
    sold30: rows[p.sku]?.sold30 ?? 0
  }));
  return { products, log: await recentLog(40), canRebuild: Boolean(process.env.NETLIFY_BUILD_HOOK) };
}

export const config = { path: "/api/desk" };
