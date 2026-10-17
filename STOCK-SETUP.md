# Live stock — setup and how it works

> **Also in this release (no setup needed):**
> - Delivery is charged at **£3.99, free over £50**, matching the bag page and the
>   delivery policy. It used to charge £4.99, free only over £75. Change it in one
>   place: `data/products.json`.
> - The bag now empties after a paid order.
> - The scroll-reveal animations work. They were designed in, but were blocked by
>   the CSP until a hash was added to `netlify.toml`. The build log now warns if
>   any inline script would be blocked.

## What changed, in one paragraph

Stock used to be a number Omar typed into Sanity, and nothing changed it when
something sold. Now a small Postgres database (Neon, free tier) holds the live
count for every SKU. When a shopper opens checkout, their units are taken out
of that count in one indivisible step — if two people go for the last box, one
gets it and the other is told it's just sold out. If they don't pay (they back
out, the 30-minute checkout expires, or Klarna/Clearpay declines) the units go
back by themselves. A full refund puts them back too. Sanity still owns
everything else: name, price, photos, availability, freeze, hide.

## The rules (for you and Omar)

| Thing | Where it lives |
|---|---|
| How many can be bought right now | **Postgres** — changed on the Stock desk, `/vault-desk.html` |
| Name, price, photos, description, availability, freeze, hide | **Sanity**, as before |
| A brand-new line's first stock figure | Sanity's **Opening stock** field — read once, the first time the line goes on sale |

After a line has gone on sale, editing Sanity's "Opening stock" does nothing.
Restocks, damage, and stock counts go through the Stock desk.

## Order of operations

Do these in order. Nothing changes for shoppers until step 5.

### 1. Push the code

The code is written so that **without `DATABASE_URL`, checkout behaves exactly
as it does today**. Pushing first is safe.

```powershell
cd C:\dev\satcgvault
# (unzip satcgvault-repo.zip here first, as usual)
Remove-Item -Force -ErrorAction SilentlyContinue sanity\.sanity -Recurse
Remove-Item -Force -ErrorAction SilentlyContinue sanity\package-lock.json, sanity\sanity.cli.js
git remote add origin https://github.com/emnb97/satcgvault
git branch -M main
git push -u origin main --force
```

The changes are already committed inside the zip, so there's nothing to `git add`.

The Trustpilot review button goes live with this push (see the end of this file).

### 2. Create the Neon database (5 minutes)

1. Go to **neon.tech** and sign up. Use an account Omar can own, or transfer it to him later.
2. **Create project.** Name: `satcgvault`. Postgres version: the default.
   Region: **AWS Europe (London)** if offered, otherwise Frankfurt.
3. On the project dashboard, click **Connect**.
   - Turn **Connection pooling ON**. This matters: the host name must contain `-pooler`.
   - Copy the connection string. It looks like:
     `postgresql://neondb_owner:npg_XXXX@ep-something-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
4. Keep it somewhere private. It's a password.

### 3. Check Omar's numbers in Sanity, then seed the database

The seed copies each line's **current Sanity stock** into Postgres as its
starting figure. So first, ask Omar to check those numbers match his shelf.
Do this at a quiet time.

```powershell
cd C:\dev\satcgvault
npm install
$env:DATABASE_URL = "postgresql://...paste the pooled string..."
$env:SANITY_PROJECT_ID = "fiay3p8h"
npm run db:setup
Remove-Item Env:DATABASE_URL
```

- `npm install` pulls in the new `postgres` driver.
- `$env:...` sets a variable for this PowerShell window only, so nothing is written to disk.
- `npm run db:setup` creates the tables and prints a table of every SKU and its starting count.
- The last line clears the password from the window.

It's safe to run again. It never overwrites a count that already exists.

**If `npm run db:setup` won't run** (for example, a network or PowerShell problem), the
tables can be made by hand instead. In Neon, open **SQL Editor**, paste the whole of
`db/schema.sql`, and press **Run**. The stock figures then fill themselves in from
Sanity the first time Omar opens the Stock desk, or the first time each line is put
in a basket. Check them on the desk before you announce anything.

### 4. Netlify environment variables

**Site configuration → Environment variables → Add a variable**, once for each:

| Key | Value | Notes |
|---|---|---|
| `DATABASE_URL` | the pooled Neon string | Tick **Contains secret values**. Scopes: **All** (builds need it too) |
| `DESK_KEY` | a long random key, see below | Tick secret. This is Omar's password for the Stock desk |
| `NETLIFY_BUILD_HOOK` | *(optional)* see below | Lets the desk's "Refresh shop pages" button work |

To generate a 32-character desk key in PowerShell:

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
```

Give the key to Omar privately, not over Instagram DMs. The desk refuses any key shorter than 16 characters.

To get a build hook, go to **Site configuration → Build & deploy → Build hooks → Add build hook**.
Name it `Stock desk`, branch `main`, and paste the URL it gives you as `NETLIFY_BUILD_HOOK`.
Live counts update without it, but it re-bakes "Sold out" labels into the pages and Google's stock data.

### 5. Deploy

**Deploys → Trigger deploy → Clear cache and deploy site.** In the deploy log, look for:

```
Stock: live from Postgres (N SKUs)
```

From this deploy on, Postgres is the gate at checkout.

### 6. Stripe — add two webhook events

In the **Stripe Dashboard** (Live mode), go to **Developers → Webhooks**, open the
endpoint ending `/api/stripe-webhook`, then **… → Update details → Select events**.
Make sure all six are ticked:

- `checkout.session.completed` (already there)
- `checkout.session.async_payment_succeeded` (already there)
- `checkout.session.async_payment_failed` (already there)
- `charge.dispute.created` (already there)
- **`checkout.session.expired`** (new: abandoned checkouts return their stock)
- **`charge.refunded`** (new: full refunds restock)

The webhook secret doesn't change.

### 7. Redeploy Sanity Studio

The "Stock on hand" field is now labelled **Opening stock (new lines only)**, so
Omar isn't misled into thinking it's the live count.

```powershell
cd C:\dev\satcgvault\sanity
'import { defineCliConfig } from "sanity/cli"; export default defineCliConfig({ api: { projectId: "fiay3p8h", dataset: "production" } })' | Out-File -Encoding utf8 sanity.cli.js
npx sanity deploy
```

If it fails at the end with `uploadSchema is not a function`, run
`npm install sanity@latest` and then `npx sanity deploy` again.

### 8. Check it works (no money needed)

1. Open `https://www.satcgvault.co.uk/api/stock`. You should see `{"SKU": number, ...}`.
2. Open `/vault-desk.html`, enter the desk key, and note one line's count.
3. In another tab, add that product to the bag and press **Checkout**.
   On the desk, refresh: the count drops by one and shows "1 in checkout".
4. On Stripe's page press **←** to go back. Refresh the desk: the count is back.
5. *(Optional, costs a few pence in fees.)* Buy the cheapest line, check it shows
   as sold on the desk, then fully refund it in Stripe and watch it come back.

## How each situation is handled

| What happens | Stock |
|---|---|
| Shopper opens checkout | Taken out at once (all basket lines or none) |
| Pays by card / Apple Pay / Google Pay | Stays out; marked sold |
| Pays by Klarna / Clearpay, still settling | Stays out ("settling" on the desk) |
| Klarna / Clearpay approves | Marked sold |
| Klarna / Clearpay declines | Back in stock |
| Backs out of Stripe | Back in stock straight away |
| Closes the tab | Back in stock when the 30-minute checkout expires |
| Full refund | Back in stock |
| Partial refund | Not restocked. Usually goodwill, and the item has gone. Adjust on the desk if needed |
| Chargeback | Not restocked; logged |
| Database unreachable | Checkout refuses ("briefly unavailable") rather than overselling |
| Webhook fails | Stripe retries for 3 days; the 10-minute sweeper also checks with Stripe |

To make every refund manual, set `RESTOCK_ON_REFUND` = `off` in Netlify.

### If you ever see "OVERSOLD"

This should never happen. It would need Stripe to accept a payment after we'd
already released the stock and someone else bought it. If it does, the desk log
shows a red **OVERSOLD** line and the Netlify function log says
`ACTION NEEDED`. Omar contacts that buyer. The count never goes below zero.

## Files

- `db/schema.sql` — the four tables
- `netlify/lib/inventory.mjs` — every stock move; read this first
- `netlify/functions/create-checkout-session.mjs` — takes stock, opens Stripe
- `netlify/functions/stripe-webhook.mjs` — settles it
- `netlify/functions/stock-sweeper.mjs` — every 10 min, the safety net
- `netlify/functions/release-checkout.mjs` — instant release when a shopper backs out
- `netlify/functions/stock.mjs` — `/api/stock`, the live numbers pages show
- `netlify/functions/desk.mjs` + `src/pages/vault-desk.html` — the Stock desk
- `tests/inventory.test.mjs` — 32 tests. Run against a **throwaway** database
  (never the live one; it wipes the tables):
  `$env:TEST_DATABASE_URL = "postgresql://..."; npm test`

## Trustpilot

Omar's TrustBox is the **Review Collector**: a "Review us on Trustpilot" button
on the provenance page. It shows no rating or review count, so it can't look
empty, and it's live from step 1.

- **Turn it off:** set `TRUSTPILOT_LIVE` = `off` in Netlify, then redeploy. The page
  then makes no request to Trustpilot at all.
- **Show reviews later:** once there's a healthy handful, pick a display TrustBox
  (Mini, Micro Star, Carousel) in Trustpilot Business. Set `TRUSTPILOT_TEMPLATE_ID`
  and `TRUSTPILOT_HEIGHT` to that template's values in Netlify, and change the
  section copy in `trustpilot()` in `scripts/build.mjs`.
- The CSP in `netlify.toml` already allows `widget.trustpilot.com` (scripts,
  iframe, connections).
