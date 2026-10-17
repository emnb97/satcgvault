/* ============================================================
   GET /api/stock  ->  { "SKU": available, ... }

   The live number every page reads on load (window.VAULT_STOCK_
   ENDPOINT). Netlify's CDN holds each answer for 15 seconds, so a
   TikTok rush of a thousand page views costs the database a few
   queries, not a thousand. Checkout never trusts this number — it
   takes stock with its own atomic UPDATE.
   ============================================================ */
import { inventoryEnabled } from "../lib/db.mjs";
import { availableMap } from "../lib/inventory.mjs";

export default async () => {
  if (!inventoryEnabled()) return new Response("{}", { status: 404 });
  try {
    const map = await availableMap();
    return new Response(JSON.stringify(map), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Netlify-CDN-Cache-Control": "public, s-maxage=15, stale-while-revalidate=30"
      }
    });
  } catch (err) {
    console.error("Stock read failed:", err.message);
    return new Response("{}", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
};

export const config = { path: "/api/stock" };
