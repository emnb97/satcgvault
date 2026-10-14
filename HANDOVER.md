# S&A TCG Vault — build notes and manual steps

Static site, no framework. `src/pages/*.html` fragments get wrapped in one shell by
`scripts/build.mjs`, which also generates a static page per product, the sitemap and
robots.txt. Output goes to `dist/`. Netlify runs `npm run build` on every push.

```
npm install
npm run build      # -> dist/
npm run dev        # build + netlify dev (functions work locally)
```

Adding a product = one object in `data/products.json` + a photo. Rebuild, push, done.

---

## 1. Accounts and services you actually need

| Service | Purpose | Who owns it | Cost |
|---|---|---|---|
| GitHub | Source code, version history, the real backup | You, transferred to client on completion | Free |
| Netlify | Hosting, CDN, SSL, serverless functions, contact form | Client's own account — **create it in his name from day one** | Free tier is enough to start; Forms cap at 100 submissions/month |
| Stripe | Checkout, cards, Apple/Google Pay, Klarna, Clearpay, receipts, order records | Client (already in progress) | ~1.5% + 20p UK cards; BNPL is higher, check current rates |
| IONOS | Domain + business email | Client (already has it) | Existing |
| Royal Mail Click & Drop + DPD | Labels, tracking | Client | Per label |
| Sanity | Headless CMS — products, prices, stock, freeze. See CMS-SETUP.md | Client | Free at this scale |

**Not needed for launch, needed later:** a Postgres database (Neon or Supabase both have
usable free tiers) once he wants customer accounts or order history in-house. Stock
control is handled by the CMS instead — see CMS-SETUP.md and §6.

---

## 2. Netlify setup

1. Create the site from the Git repo. Netlify reads `netlify.toml`, so build command and
   publish directory are already set. Don't override them in the UI.
2. **Site settings → Environment variables:**
   - `STRIPE_SECRET_KEY` — start with the test key `sk_test_…`
   - `STRIPE_WEBHOOK_SECRET` — from step 3 below
3. **Forms:** enable form detection, then set a notification email on the `contact` form.
   Turn on Akismet spam filtering. The honeypot field (`company-url`) is already wired.
4. **Deploy previews:** leave on. The build adds `noindex` and a blocking `robots.txt`
   to anything that isn't a production deploy, so previews can't get indexed.
5. Custom domain — see §5. Do this last.

## 3. Stripe setup

1. Finish business verification (company number, bank account, director ID). Until this
   is done, live payments will not work no matter what the code does.
2. **Payment methods** → enable: Card, Apple Pay, Google Pay, Link, Klarna, Clearpay.
   The code uses dynamic payment methods, so the dashboard is the only place these are
   switched on. No code change needed to add or remove one.
3. **Branding** (Settings → Branding): logo, icon, brand colour `#d91f26`, accent
   `#08090b`. This is what the Checkout page and the emailed receipts look like.
4. **Customer emails** (Settings → Customer emails): turn on successful payment receipts
   and refund receipts. This is what answers the client's "how are order confirmations
   generated" question — Stripe sends them, not us.
5. **Statement descriptor:** set it to something a customer will recognise, e.g.
   `SA TCG VAULT`. A confusing descriptor is the number-one cause of "I don't recognise
   this charge" chargebacks.
6. **Webhook** (Developers → Webhooks): add endpoint
   `https://<domain>/.netlify/functions/stripe-webhook`, subscribe to
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `charge.dispute.created`.
   Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
7. **Apple Pay domain verification** — only possible once the real domain is live.
   Stripe usually handles it automatically for Checkout; verify it after DNS.
8. Decide on **Stripe Tax**. It's off in the code (`automatic_tax: false`). If the client
   is VAT registered, turn it on and set product tax codes, otherwise prices are treated
   as VAT-inclusive with no breakdown.

Test cards: `4242 4242 4242 4242` for success, `4000 0000 0000 9995` for a decline.
For BNPL, use the Klarna sandbox flow from the redirect page.

## 4. Content you need before launch

- **Real product photography.** Placeholder SVGs are generated at build time; they are
  obviously placeholders. Export at 1600×1200, convert to AVIF + WebP, keep a JPEG
  fallback. Add `<picture>` in `productPage()` and `card()` in `build.mjs`.
- **`/assets/img/og-default.png`** — 1200×630 social share image.
- **`/assets/img/apple-touch-icon.png`** — 180×180.
- **Fonts.** Anybody (display) and Space Grotesk (body) load from **Bunny Fonts**, a
  drop-in Google Fonts mirror that sets no cookies and logs no IPs, so it stays out of the
  privacy policy and out of the consent banner. If you want the last 80ms, download both
  families, drop the `.woff2` files in `/assets/fonts/`, add `@font-face` blocks and remove
  the two `fonts.bunny.net` lines from `shell()` in `build.mjs` and from the CSP.
- **Every `[SQUARE BRACKET]` placeholder.** Search the repo. Company number, registered
  address, VAT number, ICO number, retention periods, courier name.
- **Final legal copy** from the client for all five policy pages. The current pages are
  structured drafts marked as such.

## 5. Domain and DNS (do this last, and carefully)

The client's domain and **business email** are both at IONOS. Moving nameservers to
Netlify without replicating the mail records will take his email down.

Safest route — leave DNS at IONOS, point only the web records:

```
Type    Name    Value
ALIAS   @       apex-loadbalancer.netlify.com     (or A -> 75.2.60.5)
CNAME   www     <site-name>.netlify.app
```

**Do not touch** the existing `MX`, `TXT` (SPF), `_dmarc` or DKIM records.

Then in Netlify: Domain management → add `www.satcgvault.co.uk` as the primary domain,
add the apex as a redirect, and let Netlify issue the Let's Encrypt certificate. Force
HTTPS once the certificate is live.

Pick **one** canonical host (www or apex) and redirect the other. Two indexable hosts is
the fastest way to lose the SEO you just built.

## 6. When to add a database

You don't need one to launch, and not having one is the single strongest thing in the
privacy policy: no customer database means no customer database to breach.

The CMS now covers stock, pricing, freezing and hiding — read CMS-SETUP.md first.

Add Postgres (Neon or Supabase) only when the client wants:

- Customer accounts and order history on the site itself
- Stock that decrements automatically when something sells
- Restock and back-in-stock email lists
- Reporting that Stripe's dashboard won't give him

When that happens: schema for `products`, `orders`, `order_lines`, `stock_movements`,
`customers`. Never store card data — the whole point is that Stripe holds it. Connect via
Netlify Functions with the connection string in an environment variable. Neon's serverless
driver works properly with Netlify's function runtime; a plain `pg` pool does not.

## 7. Pre-launch checklist

- [ ] Lighthouse on mobile: Performance, Accessibility, Best Practices, SEO
- [ ] Real device test: recent iPhone Safari, recent Android Chrome
- [ ] Full test purchase with a test card, end to end, including the confirmation email
- [ ] Test purchase with Klarna and with Clearpay in sandbox
- [ ] Publish a change in Sanity and confirm the site rebuilds and `stock.json` updates
- [ ] Freeze a line in Sanity and confirm checkout refuses it
- [ ] Test a refund from the Stripe dashboard
- [ ] Webhook fires and logs a paid order (check the function log)
- [ ] Contact form arrives in the inbox, honeypot blocks a bot submission
- [ ] Every footer and checkout policy link resolves
- [ ] Cookie banner appears once, remembers the choice
- [ ] 404 page works on a made-up URL
- [ ] `robots.txt` and `sitemap.xml` correct on the live domain
- [ ] `noindex` gone from production pages (automatic, but verify)
- [ ] Google Search Console: verify property, submit sitemap
- [ ] Bing Webmaster Tools: same
- [ ] Client has the GitHub repo, the Netlify account and the Stripe account in his name

## 8. Handover to the client

Section 13 of the brief asks for everything needed to run the site independently. That is:

- The GitHub repository, transferred to his account
- The Netlify site, under his own Netlify login
- The Stripe account, already his
- This document
- A short written note of what "updating a product" means in practice

Plus the Sanity studio, with his own login. That is the piece that lets him run the
catalogue without you — see CMS-SETUP.md.

---

## If the Netlify build fails

**Run `npm run doctor` first.** It checks the things that actually break deploys, in
the order Netlify hits them: Node version, lockfile drift, missing files, publish
directory. It takes a second and rules out most of what follows.

### "non-zero exit code: 2" at the building stage

This is the shell reporting, not the build script — the build script exits 1 with a
readable message when it fails. Exit 2 almost always means the command never got as
far as running. In order of likelihood:

1. **The project is in a subdirectory of the repo.** If the repo root contains
   `satcgvault/package.json` rather than `package.json`, `npm run build` at the root
   finds nothing. Either push the folder *contents* to the repo root, or in Netlify go
   to Site configuration → Build & deploy → Base directory and set it to the folder
   name. This is the most common cause by a distance.
2. **The lockfile is stale.** `npm ci` refuses to install anything `package.json`
   declares that the lockfile does not name. Run `npm install`, commit
   `package-lock.json`, push. `npm run doctor` catches this.
3. **Secrets scanning.** Netlify scans the build output after a successful compile and
   fails the deploy if it believes it has found a credential. `SECRETS_SCAN_OMIT_PATHS`
   in `netlify.toml` already excludes the documentation and `.env.example`; if it fires
   on something else, the log names the file and the variable.
4. **Node version.** `netlify.toml` pins 22. If a `.nvmrc` or a UI setting overrides it
   to something below 20.11, `import.meta.dirname` is undefined and the build throws.

**Read the log from the top.** Netlify prints the failing command immediately before
the exit code, and that line says which of the four it is. The summary at the bottom
never does.


### Other failures

**Checkout returns 500 on a deploy that otherwise looks fine.** The function reads
`data/products.json` from disk, so it must ship with the bundle. That is what
`included_files` in `netlify.toml` is for — if it goes missing, the build passes and
the first customer to press Checkout gets an error.

**Anything else.** Read the deploy log from the top, not the bottom. Netlify prints
the failing command, and exit code 2 is almost always npm rather than the build script.

To reproduce a deploy locally, exactly as Netlify runs it:

```bash
rm -rf node_modules dist
npm ci
CONTEXT=production URL=https://www.satcgvault.co.uk npm run build
```

That last command matters: `CONTEXT=production` is what switches off the `noindex`
tag and writes the real `robots.txt`. Building without it produces a deliberately
unindexable site, which is correct for previews and wrong for launch.
