# Reply to Omar — technical disclosure for S&A TCG Vault Ltd

*Draft. Read it through, change the voice to yours, fill the gaps marked **[confirm]**,
and send. It answers all fifteen sections so he can write the policies against the real
setup rather than guesses.*

---

Hi Omar,

Thanks for putting it all in one place — it makes this much easier to answer properly.
One thing up front, because it changes several of your answers, then everything else in
your order.

## The hosting change

The site is **not** hosted on IONOS. It's hosted on **Netlify**, and I'd recommend we keep
it that way. Here's why, and what it means for you.

The site is built as static files — no WordPress, no PHP, no server-side application
sitting there waiting to be attacked. Netlify serves those files from a global CDN, which
is where most of the speed you're paying for comes from. IONOS shared hosting would be
slower and would give us a server to patch and secure for no benefit.

What this changes for you:

- **You keep the domain and business email at IONOS.** Nothing moves. We only point the
  web records at Netlify and leave your mail records completely alone.
- **There is no server to break into**, because there's no application server running.
- **Netlify replaces IONOS in your privacy policy** as the hosting processor.
- The Netlify account will be **created in your name**, so it sits under the company's
  control alongside the domain and the email.

If you'd rather stay on IONOS, say so now rather than later — it's a different build.

---

## 1. Website and hosting

| | |
|---|---|
| Host | Netlify (CDN-hosted static site with serverless functions) |
| Where the site is stored | Netlify's global CDN. The source code lives in a private Git repository. |
| Where customer data is stored | **Nowhere on our side.** Order data lives in your Stripe account. Contact-form messages live in your Netlify account. |
| Database system | **None.** The site has no database — see section 3. |
| Backups | The Git repository *is* the backup. Every change is versioned and any previous version can be restored in about a minute. Order data is backed up by Stripe as part of their service. |
| Backup retention | Indefinite for the code. Stripe keeps transaction records for at least seven years. |
| HTTPS/SSL | Yes — automatic, free, auto-renewing, with HTTPS forced and HSTS enabled. |
| Security | See section 9. |
| Your access | Yes. Full source code, the Netlify account, the Stripe account. All in your name. |

## 2. Performance

All done, and it's the reason for the architecture rather than an afterthought:

- No framework, no jQuery, no page builder. About 8KB of JavaScript on the whole site.
- One CSS file, one JS file, both cached hard at the CDN edge.
- Every product page is generated as a real static HTML file at build time, so there's no
  database query or server render between the click and the page.
- Images will be served as AVIF/WebP with correct dimensions and lazy loading below the fold.
- Zero third-party scripts. Nothing from Google, Meta or anyone else is loaded.
- Checkout is Stripe's own page, which is one of the fastest and most tested in the world.

Tested on real Android and iPhone hardware before launch, not just a desktop simulator.

## 3. E-commerce and checkout

- **Payment provider: Stripe**, and only Stripe.
- **Customer accounts: no.** There is deliberately no account system at launch. That means
  no password database and no customer records for us to lose. If you want accounts later
  it's a straightforward addition, but it changes your privacy obligations, so it's worth
  doing on purpose rather than by default.
- **Collected at checkout** (by Stripe, on Stripe's page): name, email, billing address,
  delivery address, phone number, and payment details.
- **Stored in our database:** nothing — there isn't one. The only thing that touches your
  site is the basket, and that's held in the customer's own browser, not on our server.
  When they press Checkout we send Stripe the product codes and quantities and nothing else.
- **Card details: never.** They are entered on Stripe's page and never pass through our
  site or our server at any point. This keeps you out of scope for the heavier PCI DSS
  requirements, which is worth stating plainly in your policies.
- **Order confirmations:** generated and emailed by Stripe, branded with your logo.
- **Shipping updates:** sent by you from Royal Mail Click & Drop (or your chosen courier)
  when you print the label. **[confirm which courier]**
- **Refunds and cancellations:** issued from the Stripe dashboard in two clicks. The money
  goes back to the original payment method. No code involved.

Product pages already show all ten fields you listed: name, set/series, language,
condition, factory-sealed status, photographs, price, live stock, pre-order status and
expected dispatch date.

## 4. Returns, refunds and unboxing evidence

Built as you specified. The unboxing guidance appears in three places: on every product
page, on the returns policy, and on its own page linked from the footer. The wording says
customers are strongly encouraged to record one continuous video showing the unopened
package, shipping label, packaging and contents, and that we may request it for damage,
tampering, missing product, missing item, incorrect order or other delivery disputes — and
it states clearly that not having a video does not remove statutory rights.

Two practical points you'll need to decide:

1. **Where do these videos go?** They're too big to email. You need an upload link
   (Google Drive or Dropbox is fine) and a decision on how long you keep them, because a
   video of someone's hallway with their address label in shot is personal data and has to
   appear in the privacy policy. **[confirm retention period]**
2. **Your own evidence matters more than theirs.** I've written the site around you
   photographing every parcel with the label attached before it ships. That photograph is
   what wins a chargeback. Get into the habit from day one.

## 5. Privacy and data protection

- **Collected by the website itself:** nothing. No analytics, no tracking, no accounts.
- **Stored in the browser only:** the shopping basket and the cookie choice. Neither ever
  reaches us.
- **Server logs:** Netlify keeps standard access logs (IP, time, user agent) for security.
- **Checkout:** collected by Stripe, listed in section 3.
- **Contact form:** name, email, order number, topic and message. Handled by Netlify Forms,
  stored in your Netlify account and emailed to you.
- **Contact submissions stored?** Yes, in Netlify. Set a retention period. **[confirm]**
- **Customer accounts stored?** None exist.
- **Protection:** HTTPS everywhere, a strict Content Security Policy, no database to
  compromise, and no card data anywhere near us.
- **Automatically sent to external services?** No. Nothing leaves the page until the
  customer chooses to check out or chooses to send a message.

## 6. Cookies, analytics and tracking

Straight answers to your list:

| | |
|---|---|
| Google Analytics | **No** |
| Google Tag Manager | **No** |
| Meta / Facebook Pixel | **No** |
| TikTok Pixel | **No** |
| Other ad pixels | **No** |
| Analytics software | **No** |
| Session / behaviour tracking | **No** |
| CAPTCHA / anti-bot | No CAPTCHA. The contact form uses a hidden honeypot field plus Netlify's own spam filtering, neither of which sets a cookie or calls a third party. |

Full cookie list:

**Strictly necessary (no consent required):**
- `satv.cart.v1` — your basket, stored in your own browser, never sent to us
- `satv.consent.v1` — remembers your cookie choice
- `__stripe_mid` / `__stripe_sid` — set by Stripe on the checkout page for fraud prevention

**Non-essential:** none at launch.

A consent banner is implemented and working. It's built so that if you *do* add anything
later, that thing cannot load until consent is given. Given your TikTok and Instagram
strategy you'll probably want a Meta or TikTok pixel eventually — flag it to me before you
do, because it needs to be wired through the consent mechanism and added to both policies,
and getting that wrong is exactly the kind of thing the ICO acts on.

## 7. Marketing and email

Currently: **automated order and refund emails only, sent by Stripe.**

Not built: newsletter, marketing emails, subscriptions, abandoned-cart emails. No
third-party email marketing provider receives anything.

If you want a mailing list, tell me and I'll add it properly — Mailchimp or Klaviyo would
then become a processor in your privacy policy, with a double opt-in and an unsubscribe
link in every send. Worth doing, worth doing deliberately.

## 8. Third-party services

The complete list. There is nothing else.

| Service | What it does | Does it get customer data? |
|---|---|---|
| Netlify | Hosting, CDN, SSL, contact form | Yes — server logs, and contact-form contents |
| Stripe | Payments, checkout, receipts, refunds | Yes — name, email, addresses, phone, payment details |
| Klarna | Buy now pay later, only if the customer picks it | Yes — as an independent lender, under their own policy |
| Clearpay | Buy now pay later, only if the customer picks it | Yes — as above |
| IONOS | Your domain and business email | Only correspondence you receive |
| **[Courier]** | Delivery | Name, address, contact details |

No plugins. No third-party libraries in the browser. No APIs other than Stripe's.

## 9. Security

- HTTPS/SSL enforced site-wide, with HSTS
- Content Security Policy that blocks any script we haven't explicitly allowed
- `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` set
- No admin login, because there's no CMS to log into — this removes the single most
  commonly attacked thing on a small e-commerce site
- No passwords stored, because there are no accounts
- No database, so no SQL injection surface
- Prices are recalculated on the server at checkout, so a customer editing their browser
  cannot change what they're charged
- Secrets held as environment variables, never in the code
- Netlify's own DDoS protection and edge WAF
- Dependencies: one (the Stripe library). Fewer dependencies, fewer updates, fewer holes.

## 10. SEO

All implemented: clean URLs, unique title tags and meta descriptions per page, correct
single-H1 heading structure, descriptive image alt text, mobile-first layout, XML sitemap,
robots.txt, canonical URLs, and Product / Offer / BreadcrumbList / FAQ structured data so
Google can show price and availability directly in results. Search Console ready.

Two honest caveats:

1. Nothing can be submitted to Google until the domain points at the site. The current
   preview address is deliberately blocked from indexing so it can't compete with your real
   domain later.
2. Technical SEO gets you eligible to rank. It doesn't make you rank. Every other TCG shop
   in the UK is selling the same boxes with the same manufacturer description. **Original
   product copy is what will actually move you**, and that's the one thing I can't generate
   for you convincingly — it needs to sound like someone who handles the product.

## 11. Mobile

Built mobile-first, not desktop-shrunk. Given that most of your traffic will arrive from
TikTok and Instagram, that's the primary target rather than an afterthought. Tested on real
recent Android and iPhone hardware before launch: loading, navigation, images, menus,
buttons, layout at every width, and the full checkout on mobile.

## 12. Legal pages

All six are in place and linked in the footer, and the terms, returns and privacy links
also appear on the Stripe checkout page with a tick-box the customer must accept before
paying. Send me your final wording and I'll drop it straight in — right now they're
structured drafts marked as drafts, and the site shouldn't go live with them as they are.

## 13. Ownership

Yours on completion, all of it: the Git repository containing the full source code, the
Netlify account, the Stripe account, all configuration, and the written handover notes.
The domain and email are already yours.

One thing to be straight with you about: adding a product means editing a data file and
pushing an update. That's a developer job, not a director job. If you want to add products
yourself from a web dashboard, that's a content management system and it's a separate piece
of work — worth discussing, but let's price it separately rather than discover it after launch.

## 14. Testing before launch

Your list is exactly right and all twenty items are on the pre-launch checklist, including
a real end-to-end test purchase with a test card, a test refund, a Klarna and Clearpay
sandbox purchase, and a Lighthouse audit on mobile.

## 15. A few things you need to decide

Not technical questions, but they'll hold up launch if they're left:

1. **VAT.** Are you registered? It changes how prices display and whether Stripe Tax gets
   switched on. Imports from Japan complicate it. Worth ten minutes with an accountant.
2. **ICO registration.** As a company processing customer data you almost certainly need to
   register with the Information Commissioner's Office. It's inexpensive and quick, and the
   registration number goes in the privacy policy.
3. **Courier and packaging spec**, so the delivery policy states real prices and real times.
4. **Mystery boxes, repacks and live breaks.** If you're planning any of these — and with a
   TikTok audience you probably are — tell me before we go live. Stripe, Klarna and Clearpay
   all have rules about random-chance products, and getting a payment account frozen after
   launch is a far worse problem than designing around it now.
5. **Pre-order policy.** You're taking money for stock that doesn't exist yet. That's normal
   in this trade but it carries chargeback risk if a release slips. The site already lets
   customers cancel a pre-order for a full refund before dispatch, which is both the legal
   position and your best defence.

---

Anything above that doesn't match what you had in mind, tell me now rather than after the
policies are written.

Cheers,
