# SEO audit

`npm run seo` crawls the live site like a search engine and writes a report to
`seo-report/index.html` — open it in a browser. It only reads; it never changes anything.

| Command | What it does |
|---|---|
| `npm run seo` | Audit the live site, including Google PageSpeed / Core Web Vitals (takes a few minutes) |
| `npm run seo -- --no-psi` | Same, without PageSpeed (about a minute) |
| `npm run seo -- --local` | Audit the last local build in `dist/` (run `npm run build` first) |

**What it checks:** every page reachable from the home page, robots.txt and the sitemap — status
codes, broken links, redirect chains, canonical tags, titles and descriptions (length, duplicates,
repeated words), H1s, placeholder or "null" text, invisible copy-paste characters, image alt text,
product structured data, share images, noindex/sitemap conflicts, orphan pages, http→https and
apex→www redirects, real 404s, and Google Lighthouse scores for the home, shop and a product page.

**Health score:** −6 for each *kind* of "fix now" problem, −2 for each "improve", however many
pages it affects. Fixing one template can move it a lot.

**Optional:** a free Google API key (Google Cloud → enable *PageSpeed Insights API* → Credentials)
in `$env:PSI_API_KEY` avoids PageSpeed rate limits.

**What it can't see:** whether Google has indexed the pages and which searches show them. For that,
use Google Search Console (submit `https://www.satcgvault.co.uk/sitemap.xml`) and Bing Webmaster Tools.

The build log's **Catalogue check** is the companion to this: it lists product-data problems for Omar
to fix in Sanity (wrong types, Japanese names on the wrong product, old eras, messy web addresses).
