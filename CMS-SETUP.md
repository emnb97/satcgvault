> **Studio deploys (October 2026):** Sanity is now pinned to a tested version (6.18.0) and
> `sanity/sanity.cli.js` is part of the repo. Deploying is just
> `cd sanity`, `npm install`, `npx sanity deploy` — no upgrading or recreating files first.

> **Live stock (October 2026):** stock counts no longer live in Sanity. The "Opening stock"
> field only seeds a brand-new line; after that, Omar receives and counts stock on the
> Stock desk at `/vault-desk.html`, and sales take stock down automatically. See STOCK-SETUP.md.

# Headless CMS — giving Omar control of the catalogue

This answers section 13 of the brief properly. Omar edits products in a browser,
publishing rebuilds the site, and stock numbers update on the live site within
seconds rather than waiting for a deploy.

Nothing about the architecture changes. The site stays static, stays fast, and
still has no customer database.

## Why Sanity rather than the alternatives

| Option | Verdict |
|---|---|
| **Sanity** | Chosen. Free tier covers this catalogue comfortably, the editing UI is genuinely usable by a non-developer, and its image CDN converts to AVIF/WebP and resizes on the fly — which quietly solves the biggest Core Web Vitals risk on a product site. |
| Decap CMS | Free, sits on the Git repo, zero extra services. But every stock change is a Git commit and a full rebuild, and the editor is noticeably clunkier. Reasonable fallback if he wants zero third-party dependencies. |
| Shopify | Honest comparison, since the demo he's already seen is Shopify. It would do all of this out of the box plus payments, inventory and shipping labels. It costs a monthly fee, it's slower, and the storefront is far less distinctive. Worth naming explicitly rather than letting him discover it. |

## What Omar can do from the CMS

- Add a product, with photographs, and it appears on the shop, the sitemap and the homepage
- Change a price — takes effect at checkout immediately, not just on the page
- Set stock on hand; the number on the live site updates without a rebuild
- **Freeze** a line — the page stays live and indexed but nobody can buy. For stock counts, supplier disputes or a pricing error
- **Hide** a line — removed from the site and the sitemap entirely
- Flip something to pre-order and set its dispatch line
- Reorder, retitle, rewrite descriptions

## Setup

1. `npm create sanity@latest` — pick a blank project, note the project ID.
2. Copy `sanity/schemas/product.js` and `sanity/schemas/index.js` into the studio.
3. Deploy the studio: `npx sanity deploy`. Omar gets a URL and his own login.
4. In Netlify, add environment variables:
   - `SANITY_PROJECT_ID`
   - `SANITY_DATASET` (`production`)
   - `SANITY_READ_TOKEN` — only if the dataset is private
5. Add a Netlify **build hook** (Site settings → Build & deploy → Build hooks).
6. In Sanity: API → Webhooks → point at that build hook, trigger on create, update
   and delete of `product`. Publishing now redeploys the site in about 40 seconds.

Once `SANITY_PROJECT_ID` is set the build reads from the CMS. Without it, it reads
`data/products.json`. If Sanity is unreachable mid-deploy the build logs a warning
and uses the last known-good file rather than shipping an empty shop.

## How live stock works

`npm run build` writes `dist/stock.json`, a flat map of SKU to quantity, served
with no-cache headers. Every product card and product page carries a
`data-live-stock` attribute; on load the client fetches that file and corrects the
numbers. Pages stay static and instant, and the stock figure is never stale.

The checkout function reads the catalogue independently and re-prices server-side,
so a price change or a freeze in the CMS takes effect at checkout straight away,
regardless of what any cached page says.

## The honest limitation

There is still no automatic stock decrementing — buying a box does not reduce the
number in Sanity. Two people can buy the last box in the same minute. Fixing that
properly means writing stock movements back from the Stripe webhook into Sanity,
which is a well-defined next step but is extra work and should be scoped separately.

At this catalogue size the practical answer is a small buffer: list 11 when 12 are
on the shelf.

---

## Live setup sequence (Option A — migrate existing catalogue in)

Do these once, on a machine with a terminal and internet.

1. **Create the project** (logs you in via browser, prints a Project ID):
   ```bash
   npm create sanity@latest -- --template clean --create-project "S&A TCG Vault" --dataset production
   ```

2. **Create an Editor token**: sanity.io → your project → API → Tokens → Add token → Editor. Copy it.

3. **Set both as environment variables locally:**
   ```bash
   export SANITY_PROJECT_ID="your-project-id"
   export SANITY_TOKEN="your-editor-token"
   ```

4. **Install and run the migration** from the repo root:
   ```bash
   npm install
   npm run migrate
   ```
   This uploads all product photos into Sanity and creates every product. Safe to
   re-run — it updates rather than duplicates.

5. **Deploy the Studio** (the interface Omar logs into) from the `/sanity` folder:
   ```bash
   cd sanity
   npm install
   SANITY_STUDIO_PROJECT_ID="your-project-id" npx sanity deploy
   ```
   Pick a hostname, e.g. `satcgvault` → Omar logs in at `satcgvault.sanity.studio`.

6. **Add three environment variables in Netlify** (Site configuration → Environment variables):
   `SANITY_PROJECT_ID`, `SANITY_DATASET` = `production`, `SANITY_READ_TOKEN` (a
   read-only token is fine here — create a second Viewer token rather than reusing
   the Editor one).

7. **Add a build hook** (Netlify → Build & deploy → Build hooks) and point a Sanity
   webhook at it (sanity.io → API → Webhooks, trigger on create/update/delete of
   `product`). Now Omar publishing rebuilds the site in ~40 seconds.

### After migration: products.json is now only a fallback

Once `SANITY_PROJECT_ID` is set in Netlify, **Sanity is the source of truth** and the
build reads from it. `data/products.json` is used ONLY if Sanity is unreachable during
a build. Do not keep editing the JSON expecting changes to show — edit in the Studio.
The JSON stays in the repo as a safety net, nothing more.

---

## Availability: the single control for where a product shows

Every product has an **Availability** dropdown in the Studio (Stock & dispatch group):

- **In the vault (buyable now)** — shows in the catalogue and the collection's top tier, fully purchasable.
- **Inbound (pre-order, buyable)** — shows under Inbound and in the catalogue, purchasable as a pre-order.
- **Comes through the vault (teaser only)** — shows ONLY on the collection page's lower tier as "Comes through the vault", not purchasable. For sets sourced to order.
- **Hidden (off the site)** — removed everywhere, including the sitemap.

This is the one switch Omar uses to move a product between states. When a sourced set
actually lands in stock, he changes its Availability from "Comes through the vault" to
"In the vault", sets a price and stock, and it becomes buyable — no developer needed.

Nothing on the site is hardcoded. Catalogue, collection (both tiers), Inbound and the
range are all driven by this field in Sanity.

### Re-run the migration to add the availability field to existing products

The 6 previously-hardcoded "extra" sets are now real products in `data/products.json`
marked `availability: "sourced"`. To push everything (15 products) into Sanity with the
new field, re-run the migration once:

```bash
export SANITY_PROJECT_ID="fiay3p8h"
export SANITY_TOKEN="your-editor-token"
npm run migrate
```

It's safe to re-run — it updates existing products and adds the 6 new sourced ones.
