/* ============================================================
   Build: src/pages/*.html  ->  dist/*.html
   Also generates one static page per product, sitemap.xml,
   robots.txt and placeholder product imagery.
   Run with: npm run build   (Netlify build command)
   ============================================================ */
import { readFile, writeFile, mkdir, readdir, cp, rm } from "node:fs/promises";
import path from "node:path";
import { loadCatalogue, overlayLiveStock, checkCatalogue } from "./catalogue.mjs";
import { ERAS } from "./eras.mjs";
import { createHash } from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

/* Netlify sets URL in production and DEPLOY_PRIME_URL on previews.
   Until the client's domain is pointed at Netlify, PROD stays false,
   which adds noindex so the *.netlify.app host is never indexed. */
const IS_PROD = process.env.CONTEXT === "production" && !!process.env.URL;
const SITE = (IS_PROD ? process.env.URL : "https://www.satcgvault.co.uk").replace(/\/$/, "");

/* Asset fingerprints. Hashing the filename is what lets the CDN cache
   these for a year instead of revalidating on every visit — the URL
   changes whenever the contents do, so a stale copy is impossible. */
const ASSETS = { css: "/assets/css/vault.css", js: "/assets/js/vault.js" };
const hash8 = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 8);

const BIZ = {
  legal: "S&A TCG Vault Ltd",
  short: "S&A TCG Vault",
  email: "info@satcgvault.co.uk",
  street: "9 Bartle House, Oxford Court",
  city: "Manchester",
  postcode: "M2 3WQ",
  country: "GB",
  ico: "ZC239609",
  instagram: "https://www.instagram.com/satcgvault/",
  tiktok: "https://www.tiktok.com/@satcgvault",
  facebook: "https://www.facebook.com/61591501810829/"
}

/* Blank Sanity fields arrive as null. Print nothing, never the word "null". */
const esc = (s) => (s === null || s === undefined ? "" : String(s)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const gbp = (p) => "£" + (p / 100).toFixed(2);
const eraSlug = (e) => (e || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ---------- layout shell ---------- */
/* Whitespace-only collapse between tags. Deliberately conservative —
   it never touches attribute values or text nodes, so nothing can be
   silently mangled for a couple of hundred bytes. */
function squeeze(html) {
  return html
    .replace(/\n\s*\n+/g, "\n")
    .replace(/>\n\s+</g, "><")
    .trim();
}

function shell({ title, description, url, body, jsonld = [], bodyClass = "", noindex = false, extraHead = "" }) {
  const canonical = SITE + url;
  const robots = noindex || !IS_PROD ? "noindex, nofollow" : "index, follow, max-image-preview:large";
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="${robots}">
<meta name="theme-color" content="#0a0a0c">
<meta name="color-scheme" content="dark">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(BIZ.short)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}/assets/img/og-default.png">
<meta property="og:locale" content="en_GB">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
<script>document.documentElement.className+=" js";if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){document.documentElement.className+=" fonts"})}</script>
<link rel="preload" href="/assets/fonts/mincho-800.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/gothic-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${ASSETS.css}" as="style">
<link rel="stylesheet" href="${ASSETS.css}">
<meta name="vault-shipping" content="${SHIP.free},${SHIP.std},${SHIP.next}">
<meta name="vault-stock-endpoint" content="${LIVE ? "/api/stock" : "/stock.json"}">
<script src="${ASSETS.js}" defer></script>
${extraHead}${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join("\n")}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}>
<a class="skip" href="#main">Skip to content</a>
${header(url)}
<main id="main">
${body}
</main>
${footer()}
${consent()}
</body>
</html>
`;
}

const SOCIAL = `<div class="social" aria-label="Follow S&amp;A TCG Vault">
  <a href="${BIZ.instagram}" rel="me noopener" aria-label="Instagram" target="_blank">
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none"/></svg>
  </a>
  <a href="${BIZ.tiktok}" rel="me noopener" aria-label="TikTok" target="_blank">
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><path d="M16.5 3c.3 2.1 1.6 3.6 3.7 3.8v2.4c-1.3.1-2.5-.3-3.6-1v5.9c0 3.3-2.4 5.6-5.5 5.6-2.9 0-5.1-2.1-5.1-5 0-2.9 2.3-5.1 5.6-4.9v2.5c-.4-.1-.9-.2-1.3-.1-1.2.1-2 .9-1.9 2.2.1 1.2 1 2 2.2 1.9 1.3-.1 2-1 2-2.4V3h3.4z"/></svg>
  </a>
  <a href="${BIZ.facebook}" rel="me noopener" aria-label="Facebook" target="_blank">
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><path d="M13.5 21v-7h2.3l.4-2.8h-2.7V9.4c0-.8.2-1.3 1.4-1.3h1.4V5.6c-.3 0-1.1-.1-2.1-.1-2.1 0-3.5 1.3-3.5 3.6v2H8.3V14h2.3v7h2.9z"/></svg>
  </a>
</div>`;

function header(current) {
  const link = (href, label) =>
    `<a href="${href}"${current === href ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<header class="masthead">
  <div class="wrap masthead__in">
    <a class="brand" href="/" aria-label="S&amp;A TCG Vault, home">
      <span class="brand__mark" aria-hidden="true"></span>
      <span class="brand__type"><b>S&amp;A TCG</b><span>Vault</span></span>
    </a>
    <p class="readout" id="readout" role="status"></p>
    <button class="burger" id="burger" aria-expanded="false" aria-controls="nav" aria-label="Menu">
      <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true"><path d="M0 1h20M0 7h20M0 13h20" stroke="currentColor" stroke-width="1.4"/></svg>
    </button>
    <a class="cartbtn" href="/cart.html">Bag <span class="cartbtn__n" data-cart-count data-empty="true">0</span></a>
    <nav class="nav" id="nav" aria-label="Primary">
      <div class="nav__shop">
        <button class="nav__trigger" id="shop-trigger" aria-expanded="false" aria-controls="megamenu">Shop<svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.4" fill="none"/></svg></button>
        <div class="mega" id="megamenu" data-open="false">
          <button class="mega__back" type="button" id="mega-back" aria-label="Back to menu"><svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>Back to menu</button>
          <div class="mega__col">
            <h3 class="mega__h">By type</h3>
            <div class="mega__links">
              <a href="/shop.html?c=booster-box">Booster Boxes</a>
              <a href="/shop.html?c=etb">Elite Trainer Boxes</a>
              <a href="/shop.html?c=blister">Blister Packs</a>
              <a href="/shop.html?c=single">Single Cards</a>
              <a href="/shop.html?c=special">Premium Sets</a>
              <a href="/shop.html?c=accessories">Accessories</a>
            </div>
          </div>
          <div class="mega__col mega__col--eras">
            <h3 class="mega__h">By era</h3>
            <div class="mega__eras">
${eraLinks()}
            </div>
          </div>
        </div>
      </div>
      ${link("/shop.html?c=preorder", "Inbound")}
      ${link("/about.html", "Provenance")}
      ${link("/trade.html", "Trade")}
      ${link("/contact.html", "Contact")}
    </nav>
  </div>
</header>`;
}

function footer() {
  const year = new Date().getFullYear();
  return `<footer class="footer">
  <div class="wrap">
    <div class="footer__top">
      <div>
        <a class="brand" href="/" style="margin-bottom:1.5rem" aria-label="S&amp;A TCG Vault, home">
          <span class="brand__mark" aria-hidden="true"></span>
          <span class="brand__type"><b>S&amp;A TCG</b><span>Vault</span></span>
        </a>
        <p class="lede" style="font-size:1.15rem;max-width:34ch;margin-bottom:1rem">Factory-sealed Japanese Pokémon allocations, flown from Tokyo to collectors and independent shops across the UK.</p>
        <p class="meta">${esc(BIZ.street)}<br>${esc(BIZ.city)} ${esc(BIZ.postcode)}<br>Collection by appointment</p>
      </div>
      <div>
        <h4>Catalogue</h4>
        <ul>
          <li><a href="/shop.html?c=preorder">Inbound allocations</a></li>
          <li><a href="/shop.html?c=booster-box">Booster boxes</a></li>
          <li><a href="/shop.html?c=special">Premium sets</a></li>
          <li><a href="/shop.html?c=accessories">Vault line</a></li>
          <li><a href="/shop.html">Everything</a></li>
        </ul>
      </div>
      <div>
        <h4>The business</h4>
        <ul>
          <li><a href="/about.html">Provenance</a></li>
          <li><a href="/trade.html">Trade &amp; wholesale</a></li>
          <li><a href="/unboxing.html">Unboxing evidence</a></li>
          <li><a href="/contact.html">Contact</a></li>
        </ul>
      </div>
      <div>
        <h4>Elsewhere</h4>
        <ul>
          <li><a href="mailto:${BIZ.email}">${BIZ.email}</a></li>
        </ul>
        ${SOCIAL}
      </div>
      <div>
        <h4>Legal</h4>
        <ul>
          <li><a href="/policies/terms.html">Terms</a></li>
          <li><a href="/policies/privacy.html">Privacy</a></li>
          <li><a href="/policies/cookies.html">Cookies</a></li>
          <li><a href="/policies/returns.html">Returns</a></li>
          <li><a href="/policies/delivery.html">Delivery</a></li>
        </ul>
      </div>
    </div>
    <div class="footer__legal">
      <span>© ${year} ${esc(BIZ.legal)}</span>
      <span>S&amp;A TCG Vault Ltd · Registered in England &amp; Wales no. 17328985</span>
      <span>ICO registration ZC239609</span>
      <span>Carriage by Royal Mail and DPD</span>
      <span class="paymark">Visa</span><span class="paymark">Mastercard</span><span class="paymark">Apple Pay</span><span class="paymark">Klarna</span><span class="paymark">Clearpay</span>
      <span class="credit">Powered by <a href="https://ebwebservices.co.uk" rel="noopener">ebwsuk</a></span>
    </div>
  </div>
</footer>`;
}

function consent() {
  return `<div class="consent" id="consent" role="region" aria-label="Cookie choices">
  <div class="consent__in">
    <p>We use cookies that are needed to run the shop and keep your bag. We would also like to set optional cookies that measure how the site is used. You can change this any time in the <a href="/policies/cookies.html">cookie policy</a>.</p>
    <button class="btn btn--quiet" id="consent-essential" type="button">Essential only</button>
    <button class="btn btn--primary" id="consent-all" type="button">Accept all</button>
    <button class="consent__x" id="consent-dismiss" type="button" aria-label="Dismiss">×</button>
  </div>
</div>`;
}

/* ---------- placeholder imagery ----------
   Replace these with real photography before launch. */
/* ---------- product render ------------------------------------
   A vector stand-in for Omar's arrival photography, drawn to the
   shape of a real Japanese display: open lid at the back, two rows
   of packs in the tray. Each set carries its own palette taken from
   the actual box art, so the catalogue reads as a catalogue rather
   than nine identical grey rectangles. Replace with photographs. */
function placeholder(name, label, palette) {
  const [c1, c2, c3, c4] = palette && palette.length === 4
    ? palette : ["#d8342a", "#2f6fc4", "#f0a020", "#1a1d2e"];
  const id = name.replace(/[^a-z0-9]/gi, "");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 720" width="900" height="720" role="img" aria-label="${esc(label)}">
<defs>
  <linearGradient id="bg${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#f2efe9"/><stop offset="1" stop-color="#ddd8ce"/>
  </linearGradient>
  <linearGradient id="lid${id}" x1=".1" y1="0" x2=".9" y2="1">
    <stop offset="0" stop-color="${c2}"/><stop offset="52%" stop-color="${c1}"/><stop offset="1" stop-color="${c4}"/>
  </linearGradient>
  <linearGradient id="face${id}" x1="0" y1="0" x2="1" y2=".7">
    <stop offset="0" stop-color="${c1}"/><stop offset="60%" stop-color="${c2}"/><stop offset="1" stop-color="${c4}"/>
  </linearGradient>
  <linearGradient id="pack${id}" x1="0" y1="0" x2=".8" y2="1">
    <stop offset="0" stop-color="${c2}"/><stop offset="55%" stop-color="${c1}"/><stop offset="1" stop-color="${c4}"/>
  </linearGradient>
  <linearGradient id="film${id}" x1="0" y1="0" x2=".7" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity=".5"/>
    <stop offset="30%" stop-color="#fff" stop-opacity="0"/>
    <stop offset="55%" stop-color="#fff" stop-opacity=".34"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <radialGradient id="pop${id}" cx="50%" cy="42%" r="55%">
    <stop offset="0" stop-color="${c3}" stop-opacity=".85"/><stop offset="1" stop-color="${c3}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="cast${id}" cx="50%" cy="50%">
    <stop offset="0" stop-color="#7d766a" stop-opacity=".55"/><stop offset="1" stop-color="#7d766a" stop-opacity="0"/>
  </radialGradient>
</defs>

<rect width="900" height="720" fill="url(#bg${id})"/>
<ellipse cx="450" cy="632" rx="290" ry="42" fill="url(#cast${id})"/>

<!-- open lid, standing behind -->
<g>
  <path d="M300 96 h300 l38 34 v210 h-376 v-210 z" fill="url(#lid${id})"/>
  <ellipse cx="450" cy="215" rx="150" ry="120" fill="url(#pop${id})"/>
  <path d="M300 96 h300 l38 34 v210 h-376 v-210 z" fill="url(#film${id})"/>
  <path d="M262 130 h376" stroke="rgba(255,255,255,.4)" stroke-width="2"/>
  <rect x="286" y="150" width="88" height="34" rx="5" fill="rgba(255,255,255,.9)"/>
  <rect x="536" y="150" width="76" height="26" rx="4" fill="${c1}" opacity=".95"/>
  <rect x="352" y="252" width="196" height="46" rx="6" fill="rgba(255,255,255,.92)"/>
  <rect x="368" y="264" width="164" height="22" rx="3" fill="${c4}" opacity=".8"/>
</g>

<!-- front tray -->
<g>
  <path d="M232 340 h436 v244 h-436 z" fill="${c4}"/>
  <path d="M244 352 h412 v220 h-412 z" fill="#0d0d10" opacity=".55"/>
  <!-- pack row -->
  <g>
    <rect x="256" y="356" width="188" height="206" rx="3" fill="url(#pack${id})"/>
    <ellipse cx="350" cy="440" rx="86" ry="72" fill="url(#pop${id})"/>
    <rect x="256" y="356" width="188" height="206" rx="3" fill="url(#film${id})"/>
    <rect x="276" y="374" width="60" height="22" rx="3" fill="rgba(255,255,255,.9)"/>
    <rect x="288" y="492" width="124" height="30" rx="4" fill="rgba(255,255,255,.9)"/>
  </g>
  <g>
    <rect x="456" y="356" width="188" height="206" rx="3" fill="url(#pack${id})"/>
    <ellipse cx="550" cy="440" rx="86" ry="72" fill="url(#pop${id})"/>
    <rect x="456" y="356" width="188" height="206" rx="3" fill="url(#film${id})"/>
    <rect x="476" y="374" width="60" height="22" rx="3" fill="rgba(255,255,255,.9)"/>
    <rect x="488" y="492" width="124" height="30" rx="4" fill="rgba(255,255,255,.9)"/>
  </g>
  <!-- tray front band -->
  <path d="M232 566 h436 v46 h-436 z" fill="${c1}"/>
  <rect x="258" y="578" width="150" height="22" rx="3" fill="rgba(255,255,255,.9)"/>
  <rect x="430" y="578" width="90" height="22" rx="3" fill="${c3}" opacity=".9"/>
  <path d="M232 340 h436 v272 h-436 z" fill="url(#film${id})" opacity=".55"/>
  <path d="M232 340 h436 v272 h-436 z" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="1.5"/>
</g>

<text x="450" y="686" text-anchor="middle" fill="#8f887c" font-family="Georgia,serif" font-size="17" letter-spacing="1.5">Photograph pending</text>
</svg>`;
}

/* ---------- shared bits ---------- */
const SEAL = (cls = "") => `<span class="seal ${cls}" role="img" aria-label="Photographed on arrival"><span aria-hidden="true">封<br>印</span></span>`;

/* Join the parts that exist with a separator — no "null", no stray dots. */
const dot = (...parts) => parts.filter((x) => x !== null && x !== undefined && String(x).trim() !== "").map(esc).join(" · ");
/* "N/A" is right in Sanity's dropdown but reads oddly on a product. */
const lang = (p) => (p.language && p.language !== "N/A" ? p.language : "");
const typeLine = (p, ...more) => dot(p.type ? p.type + (p.packs ? `, ${p.packs} packs` : "") : "", lang(p), ...more);

function statusLine(p) {
  if (p.frozen) return `<span class="state state--none">Withdrawn</span>`;
  if (p.preorder) return `<span class="state">Inbound</span>${p.dispatch ? " — " + esc(p.dispatch) : ""}`;
  if (p.stock === 0) return `<span class="state state--none">Sold</span>${p.dispatch ? " — " + esc(p.dispatch) : ""}`;
  return `<span class="state">In the vault</span> — dispatched within 48 hours`;
}

/* Tells the live-stock script how to word a refreshed number, and to
   leave withdrawn lines alone (Postgres doesn't know about a freeze). */
const liveAttrs = (p) => p.frozen ? ` data-live-off="1"` : p.preorder ? ` data-live-kind="inbound"` : "";

/* ---------- Trustpilot ---------------------------------------
   Omar's TrustBox is the REVIEW COLLECTOR (template 56278e9a…): a
   "Review us on Trustpilot" button. It shows no star rating and no
   review count, so it can never look empty — safe to run from day
   one. When there are enough reviews to show off, swap in a display
   template (Mini, Carousel…) with TRUSTPILOT_TEMPLATE_ID and its
   height, and change the copy in trustpilot() below.

   These IDs are public: they sit in the page HTML for anyone to read.
   Switch off with TRUSTPILOT_LIVE=off in Netlify — the page then makes
   no request to Trustpilot at all.
   TrustBox renders inside Trustpilot's own iframe; we style the frame
   around it, not the button itself. */
const TP = {
  live: process.env.TRUSTPILOT_LIVE !== "off",
  bu: process.env.TRUSTPILOT_BUSINESS_UNIT_ID || "6acd65afeb5b17997e5ebad3",
  template: process.env.TRUSTPILOT_TEMPLATE_ID || "56278e9abfbbba0bdcd568bc",
  token: process.env.TRUSTPILOT_TOKEN ?? "65783787-cc6d-46a1-b344-e1c6e8a27ce6",
  height: process.env.TRUSTPILOT_HEIGHT || "52px",
  profile: process.env.TRUSTPILOT_PROFILE_URL || "https://uk.trustpilot.com/review/satcgvault.co.uk"
};
const TP_ON = TP.live && TP.bu && TP.template;
const TP_SCRIPT = `<script src="https://widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js" async></script>\n`;

function trustpilot() {
  if (!TP_ON) return "";
  return `<section class="section section--ruled tp">
  <div class="wrap tp__grid">
    <div class="section__head tp__head">
      <h2>Bought from the vault?</h2>
      <p class="jp" style="color:var(--shu);letter-spacing:.34em;font-size:.86rem;margin:-.4rem 0 .8rem">お客様の声</p>
      <p>Tell the next buyer how it arrived. Reviews are collected and published by Trustpilot, not by us — we can reply to them, but we can’t edit or remove them.</p>
    </div>
    <div class="tp__plate">
      <span class="tp__seal" aria-hidden="true">第三者</span>
      <p class="tp__line">Seal intact? Parcel filmed? Say so where it counts.</p>
      <div class="trustpilot-widget" data-locale="en-GB" data-template-id="${esc(TP.template)}"
           data-businessunit-id="${esc(TP.bu)}" data-style-height="${esc(TP.height)}" data-style-width="100%"${TP.token ? ` data-token="${esc(TP.token)}"` : ""}>
        <a class="tp__fallback" href="${esc(TP.profile)}" target="_blank" rel="noopener">Review us on Trustpilot</a>
      </div>
    </div>
  </div>
</section>`;
}

/* ---------- product page ---------- */
function productPage(p, cfg) {
  const url = `/product/${p.slug}.html`;
  const img = p.shots[0].url;
  const inStock = p.stock > 0 && !p.frozen;
  const availability = p.preorder ? "https://schema.org/PreOrder"
    : p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";

  const body = `
<section class="section">
  <div class="wrap">
    <nav aria-label="Breadcrumb" class="meta" style="margin-bottom:1.75rem">
      <a href="/" style="color:inherit">Home</a> /
      <a href="/shop.html" style="color:inherit">Catalogue</a> /
      <span>${esc(p.name)}</span>
    </nav>

    <div class="pdp">
      <div>
        <div class="gallery__plate">
          <div class="plate" data-loupe-plate data-loupe="off">
            <img id="shot" src="${img}" alt="${esc(p.shots[0].alt)}" width="800" height="640" fetchpriority="high" decoding="async">
            <span class="plate__hint">Hold over the seal to inspect</span>
          </div>
          <span class="stencil">Lot ${p.lotNo} / ${esc(p.sku)}</span>
          <span class="gallery__seal">${SEAL()}</span>
        </div>
        ${p.shots.length > 1 ? `<div class="gallery__thumbs" id="thumbs">
          ${p.shots.map((im, i) => `<button type="button" aria-pressed="${i === 0}" aria-label="View image ${i + 1}"><img src="${im.url}" alt="" width="160" height="160" loading="lazy"></button>`).join("")}
        </div>` : ""}
        <p class="meta" style="margin-top:.75rem">Magnified from the original arrival photograph — no interpolation, no retouching. Photographed on arrival at the Manchester unit. Consignment images for this line are available on request before you buy.</p>
      </div>

      <div>
        <p class="meta ref"><span class="lotno">Lot ${p.lotNo}</span>${dot(p.code, p.era) ? " · " + dot(p.code, p.era) : ""}</p>
        <h1 style="font-size:var(--t-xl);margin-bottom:.1em">${esc(p.name)}</h1>
        ${p.jp ? `<p class="jp" style="font-family:var(--mincho);color:var(--ink-3);margin-bottom:.6rem">${esc(p.jp)}</p>` : ""}
        <p class="meta" style="font-size:var(--t-sm);margin-bottom:1.5rem">${typeLine(p)}</p>

        ${p.summary ? `<p class="lede" style="max-width:44ch">${esc(p.summary)}</p>` : ""}

        <p style="display:flex;align-items:baseline;gap:.9rem;margin:1.75rem 0 .5rem">
          <span class="price" style="font-size:var(--t-xl)">${gbp(p.pricePence)}</span>
          <span class="meta">${p.packs ? "per sealed box" : "each"}, inc. VAT</span>
        </p>
        <p class="meta" style="font-size:var(--t-sm);margin-bottom:1.75rem" data-live-stock="${esc(p.sku)}"${liveAttrs(p)} data-level="${inStock ? (p.stock <= 5 ? "low" : "ok") : "none"}">${statusLine(p)}</p>

        <form id="pdp-form"
              data-sku="${esc(p.sku)}" data-name="${esc(p.name)}" data-price="${p.pricePence}"
              data-image="${img}" data-url="${url}" data-stock="${p.stock}"${p.frozen ? ' data-frozen="1"' : ""}${p.preorder ? ' data-preorder="1"' : ""}>
          <div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:center">
            <div class="qty">
              <button type="button" data-step="-1" aria-label="Decrease quantity">−</button>
              <input id="qty" type="text" inputmode="numeric" value="1" max="${Math.max(p.stock, 1)}" aria-label="Quantity">
              <button type="button" data-step="1" aria-label="Increase quantity">+</button>
            </div>
            <button class="btn" type="submit"${inStock ? "" : " disabled"} style="flex:1 1 190px">
              <span>${p.frozen ? "Temporarily unavailable" : inStock ? (p.preorder ? "Reserve this allocation" : "Add to bag") : "Sold"}</span>
            </button>
          </div>
        </form>

        <table class="specs" style="margin-top:2rem">
          <caption class="hidden">Lot details</caption>
          <tbody>
            <tr><th scope="row">Lot</th><td>${p.lotNo}</td></tr>
            <tr><th scope="row">Reference</th><td>${[p.code, p.sku].filter(Boolean).map(esc).join(" / ")}</td></tr>
            ${p.set ? `<tr><th scope="row">Series</th><td>${esc(p.set)}</td></tr>` : ""}
            ${lang(p) ? `<tr><th scope="row">Language</th><td>${esc(lang(p))}</td></tr>` : ""}
            <tr><th scope="row">Pack contents</th><td>${p.cardsPerPack ? p.cardsPerPack + " cards per pack" : "—"}</td></tr>
            <tr><th scope="row">Condition</th><td>${esc(p.condition)}</td></tr>
            <tr><th scope="row">Outer seal</th><td>${p.sealed ? "Unbroken, photographed on arrival" : "See condition"}</td></tr>
            <tr><th scope="row">Provenance</th><td>${p.language === "Japanese" ? "Licensed Japanese supplier, direct to Manchester" : "Licensed supplier, direct to Manchester"}</td></tr>
            ${p.dispatch ? `<tr><th scope="row">Dispatch</th><td>${esc(p.dispatch)}</td></tr>` : ""}
            <tr><th scope="row">Weight</th><td>${p.weightGrams} g</td></tr>
          </tbody>
        </table>

        <div class="note" style="margin-top:2rem">
          <p><strong>Before you open it.</strong> Film one continuous video as you open the parcel, showing the sealed package, the shipping label, the packaging and the contents. It makes damage, tampering and missing-item claims far quicker to settle — and not having one never removes your statutory rights.</p>
          <p><a href="/policies/returns.html">Returns policy</a> · <a href="/unboxing.html">Why we ask</a></p>
        </div>
      </div>
    </div>

    ${p.detail ? `<div style="margin-top:clamp(2.5rem,5vw,4rem);border-top:2px solid var(--sumi);padding-top:1.75rem;max-width:62ch">
      <h2 style="font-size:var(--t-lg)">Condition report</h2>
      <p class="muted">${esc(p.detail)}</p>
    </div>` : ""}
  </div>
</section>`;

  const jsonld = [{
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${p.name} ${p.type}`,
    sku: p.sku, mpn: p.code || undefined,
    description: p.summary || undefined,
    image: [img.startsWith("http") ? img : SITE + img],
    brand: { "@type": "Brand", name: "Pokémon" },
    category: p.type,
    inLanguage: lang(p) || undefined,
    itemCondition: "https://schema.org/NewCondition",
    offers: {
      "@type": "Offer",
      url: SITE + url,
      priceCurrency: cfg.currency,
      price: (p.pricePence / 100).toFixed(2),
      availability,
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: BIZ.legal },
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingRate: { "@type": "MonetaryAmount", value: (cfg.standardShippingPence / 100).toFixed(2), currency: "GBP" },
        shippingDestination: { "@type": "DefinedRegion", addressCountry: "GB" }
      },
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy",
        applicableCountry: "GB",
        returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
        merchantReturnDays: 14,
        returnMethod: "https://schema.org/ReturnByMail",
        returnFees: "https://schema.org/ReturnShippingFees"
      }
    }
  }, {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "Catalogue", item: SITE + "/shop.html" },
      { "@type": "ListItem", position: 3, name: p.name, item: SITE + url }
    ]
  }];

  return { url, html: shell({
    title: `${p.name} ${p.type} — ${["sealed", lang(p), p.code].filter(Boolean).join(" ")} | ${BIZ.short}`,
    description: (p.summary || `${p.name} ${p.type}, factory sealed, from S&A TCG Vault.`).slice(0, 155),
    url, body, jsonld
  })};
}

/* ---------- catalogue grid: photograph, then caption ---------- */
function card(p) {
  const shot = p.shots[0];
  const cardImg = shot.thumb || shot.url;
  const inStock = p.stock > 0 && !p.frozen;
  return `<a class="card" href="/product/${p.slug}.html" data-cursor="View lot" data-reveal="up" data-product
   data-category="${p.category}" data-era="${eraSlug(p.era)}" data-price="${p.pricePence}" data-name="${esc(p.name)}"
   data-search="${esc([p.name, p.jp, p.set, p.era, p.code, p.type, lang(p), p.sku].filter(Boolean).join(" ").toLowerCase())}">
  <div class="card__plate">
    <img src="${cardImg}" alt="${esc(shot.alt)}" width="480" height="640" loading="lazy" decoding="async">
    <span class="card__stamp">${p.code ? esc(p.code) + " — sealed" : "Sealed"}</span>
    <span class="card__seal">${SEAL("seal--sm")}</span>
  </div>
  <div class="card__body">
    <span class="meta ref"><span class="lotno">Lot ${p.lotNo}</span>${dot(p.code, p.era) ? " · " + dot(p.code, p.era) : ""}</span>
    <h3 class="card__title">${esc(p.name)}</h3>
    ${p.jp ? `<span class="price-jp jp">${esc(p.jp)}</span>` : ""}
    <span class="meta">${typeLine(p)}</span>
    <div class="card__foot">
      <span class="price">${gbp(p.pricePence)}</span>
      <span class="stock" data-live-stock="${esc(p.sku)}"${liveAttrs(p)} data-level="${inStock ? (p.stock <= 5 ? "low" : "ok") : "none"}">${inStock ? (p.preorder ? "Inbound" : p.stock + " available") : "Sold"}</span>
    </div>
  </div>
</a>`;
}

/* ---------- homepage lot listing ---------- */
function lot(p) {
  const shot = p.shots[0];
  const lotImg = shot.thumb || shot.url;
  return `<a class="lot" href="/product/${p.slug}.html" data-cursor="View lot" data-reveal>
  <div class="lot__plate"><img src="${lotImg}" alt="${esc(shot.alt)}" width="800" height="640" loading="lazy" decoding="async"></div>
  <div class="lot__body">
    <span class="meta ref"><span class="lotno">Lot ${p.lotNo}</span>${dot(p.code, p.era) ? " · " + dot(p.code, p.era) : ""}</span>
    <h3 class="lot__title">${esc(p.name)}</h3>
    <span class="meta">${typeLine(p, p.condition)}</span>
    ${p.summary ? `<p>${esc(p.summary)}</p>` : ""}
  </div>
  <div class="lot__side">
    <span class="lot__price">${gbp(p.pricePence)}</span>
    <span class="meta" data-live-stock="${esc(p.sku)}"${liveAttrs(p)}>${statusLine(p)}</span>
  </div>
</a>`;
}

/* ---------- collection page ---------- */
function collCard(p, buyable) {
  const shot = p.shots[0];
  const inStock = p.stock > 0 && !p.frozen;
  const meta = !buyable ? "Comes through the vault"
    : p.availability === "inbound" ? "Inbound · " + gbp(p.pricePence)
    : inStock ? gbp(p.pricePence) : "Sold out";
  const open = buyable ? `<a class="coll" href="/product/${p.slug}.html" data-cursor="View lot">` : `<div class="coll coll--static">`;
  const close = buyable ? "</a>" : "</div>";
  return `${open}
  <div class="coll__plate"><img src="${shot.thumb || shot.url}" alt="${esc(shot.alt)}" width="480" height="640" loading="lazy" decoding="async"></div>
  <div class="coll__cap">
    <span class="coll__name">${esc(p.name)}</span>
    ${p.jp ? `<span class="coll__jp jp">${esc(p.jp)}</span>` : ""}
    <span class="coll__meta">${esc(p.code)}${p.code ? " · " : ""}${meta}</span>
  </div>
${close}`;
}

function collectionLive(products) {
  return products.filter((p) => !p.sourced).map((p) => collCard(p, true)).join("");
}

function collectionSourced(products) {
  return products.filter((p) => p.sourced).map((p) => collCard(p, false)).join("");
}

/* ---------- arrival ledger ---------- */
function ledger(records) {
  const fmt = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `<div class="ledger">
  <div class="ledger__strip" id="ledger-strip" tabindex="0" role="group" aria-label="Consignment records, scroll or use arrow keys">
    ${records.map((r) => `<article class="record">
      <div class="record__plate">${r.image ? `<img src="${r.image}" alt="${esc(r.alt || ("Consignment " + r.ref + " photographed on arrival"))}" width="800" height="640" loading="lazy" decoding="async" draggable="false">` : `<div class="record__noimg" aria-hidden="true">${esc(r.ref)}</div>`}<span class="record__seal" aria-hidden="true">封印</span></div>
      <h3 class="record__ref">${esc(r.ref)}</h3>
      <dl>
        <dt>Landed</dt><dd>${fmt(r.date)}</dd>
        <dt>Origin</dt><dd>${esc(r.origin)}</dd>
        <dt>Lines</dt><dd>${r.lines}</dd>
        <dt>Cartons</dt><dd>${r.cartons}</dd>
      </dl>
      <p class="record__note">${esc(r.note)}</p>
    </article>`).join("")}
  </div>
  <div class="ledger__rail"><span id="ledger-seen"></span></div>
  <div class="ledger__foot">
    <span class="ledger__hint">Drag the strip, or use the arrow keys</span>
    <div class="ledger__keys">
      <button type="button" id="ledger-prev" aria-label="Earlier consignments">&larr;</button>
      <button type="button" id="ledger-next" aria-label="Later consignments">&rarr;</button>
    </div>
  </div>
</div>`;
}

/* ---------- front matter parser ---------- */
function parse(raw) {
  /* Windows Git can check files out with CRLF line endings; normalise so
     the front matter is found either way. */
  raw = raw.replace(/\r\n/g, "\n");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("Missing front matter");
  return { meta: JSON.parse(m[1]), body: m[2] };
}

/* ---------- preflight ----------------------------------------
   Fails loudly and specifically rather than throwing a stack trace
   somewhere further down. Every check here corresponds to a real way
   a deploy has gone wrong. */
{
  const problems = [];
  const need = ["package.json", "netlify.toml", "data/products.json",
                "assets/css/vault.css", "assets/js/vault.js", "src/pages/index.html"];
  for (const f of need) {
    try { await readFile(path.join(ROOT, f)); }
    catch { problems.push(`missing ${f}`); }
  }
  const [maj] = process.versions.node.split(".").map(Number);
  if (maj < 20) problems.push(`Node ${process.versions.node}; this build needs 20 or newer`);

  if (problems.length) {
    console.error("\nBuild preflight failed:");
    problems.forEach((p) => console.error("  - " + p));
    console.error(`\nRunning from: ${process.cwd()}`);
    console.error("If that is not the folder holding package.json, the repository has the");
    console.error("project in a subdirectory. Either push the folder CONTENTS to the repo");
    console.error("root, or set the base directory in Netlify:\n");
    console.error("  [build]\n    base = \"satcgvault\"\n");
    process.exit(1);
  }
  console.log(`Node ${process.versions.node}, building from ${ROOT}`);
}

/* ---------- run ---------- */
const cfg = await loadCatalogue();
const products = cfg.products;
const LIVE = (await overlayLiveStock(products)).live;
checkCatalogue(products);
/* Delivery: ONE source — data/products.json. Checkout charges it and the
   bag page reads it from a <meta> tag, so the two can never disagree.
   The wording on cart.html and policies/delivery.html is fixed text:
   change those too if these numbers ever change. */
const SHIP = { free: cfg.freeShippingThresholdPence ?? 5000, std: cfg.standardShippingPence ?? 599, next: cfg.nextDayShippingPence ?? 699 };
/* Delivery figures in page text come from the same place as checkout:
   write {{SHIP_48}}, {{SHIP_24}} or {{SHIP_FREE}} in any page. */
const shipTokens = (html) => html
  .replaceAll("{{SHIP_48}}", "£" + (SHIP.std / 100).toFixed(2))
  .replaceAll("{{SHIP_24}}", "£" + (SHIP.next / 100).toFixed(2))
  .replaceAll("{{SHIP_FREE}}", "£" + (SHIP.free / 100).toFixed(0));

/* Eras for the menu and the shop dropdown: the fixed list, then any
   era a product uses that the list doesn't know yet. */
const ERA_LIST = [...ERAS, ...[...new Set(products.map((p) => p.era).filter(Boolean))].filter((e) => !ERAS.includes(e))];
const eraLinks = () => ERA_LIST.map((e) =>
  `        <a href="/shop.html?era=${eraSlug(e)}" data-era-filter="${eraSlug(e)}">${esc(e)}</a>`).join("\n");
const eraOptions = () => ERA_LIST.map((e) =>
  `          <option value="${eraSlug(e)}">${esc(e)}</option>`).join("\n");


/* Lot numbers are assigned once, in catalogue order, and are the
   reference a trade customer quotes back to us on the phone. */
products.forEach((p, i) => { p.lotNo = String(i + 1).padStart(3, "0"); });

await rm(DIST, { recursive: true, force: true });
await mkdir(path.join(DIST, "product"), { recursive: true });
await mkdir(path.join(DIST, "policies"), { recursive: true });
await cp(path.join(ROOT, "assets"), path.join(DIST, "assets"), { recursive: true });

const urls = [];

/* ---------- minify and fingerprint ----------------------------
   esbuild is loaded at runtime and the build carries on without it.
   A minifier failing is a size regression, not a reason to take the
   shop offline — so this can never be the thing that fails a deploy. */
{
  const cssRaw = await readFile(path.join(ROOT, "assets", "css", "vault.css"), "utf8");
  const jsRaw = await readFile(path.join(ROOT, "assets", "js", "vault.js"), "utf8");

  let css = cssRaw, js = jsRaw, minified = false;
  try {
    const esbuild = await import("esbuild");
    css = (await esbuild.transform(cssRaw, { loader: "css", minify: true })).code;
    js = (await esbuild.transform(jsRaw, { loader: "js", minify: true, target: "es2019" })).code;
    minified = true;
  } catch (err) {
    console.warn(`Minify skipped (${err.message}) — shipping unminified.`);
  }

  const cssName = `vault.${hash8(css)}.css`;
  const jsName = `vault.${hash8(js)}.js`;

  await writeFile(path.join(DIST, "assets", "css", cssName), css);
  await writeFile(path.join(DIST, "assets", "js", jsName), js);
  await rm(path.join(DIST, "assets", "css", "vault.css"), { force: true });
  await rm(path.join(DIST, "assets", "js", "vault.js"), { force: true });

  ASSETS.css = `/assets/css/${cssName}`;
  ASSETS.js = `/assets/js/${jsName}`;

  console.log(`CSS ${(cssRaw.length / 1024).toFixed(1)}kB -> ${(css.length / 1024).toFixed(1)}kB${minified ? "" : " (unminified)"}`);
  console.log(`JS  ${(jsRaw.length / 1024).toFixed(1)}kB -> ${(js.length / 1024).toFixed(1)}kB${minified ? "" : " (unminified)"}`);
}

/* Resolve image references. Strings are local placeholder slugs and get
   an SVG generated; objects come from the CMS and already have a URL. */
for (const p of products) {
  p.shots = [];
  for (const im of p.images || []) {
    if (typeof im === "string") {
      await writeFile(path.join(DIST, "assets", "img", im + ".svg"), placeholder(im, `${p.name} ${p.type}, sealed Japanese display`, p.palette));
      p.shots.push({ url: `/assets/img/${im}.svg`, alt: `${p.name} ${p.type}` });
    } else if (im && im.url) {
      p.shots.push(im);
    }
  }
  if (!p.shots.length) {
    const slug = p.slug || p.sku;
    await writeFile(path.join(DIST, "assets", "img", slug + ".svg"), placeholder(slug, p.name, p.palette));
    p.shots.push({ url: `/assets/img/${slug}.svg`, alt: `${p.name} ${p.type}` });
  }
}

/* Live-stock endpoint, read by the client on page load so the number
   on a cached static page is never more than a moment out of date. */
await writeFile(path.join(DIST, "stock.json"),
  JSON.stringify(Object.fromEntries(products.map((p) => [p.sku, p.stock]))));


/* pages */
const files = await readdir(path.join(SRC, "pages"), { recursive: true });
for (const f of files) {
  if (!f.endsWith(".html")) continue;
  const raw = await readFile(path.join(SRC, "pages", f), "utf8");
  const { meta, body } = parse(raw);
  const out = f;
  /* index.html canonicalises to "/" so the root and the file path are
     not two indexable copies of the same page. */
  const url = out === "index.html" ? "/" : "/" + out.replace(/\\/g, "/");

  let html = body;
  if (html.includes("<!--GRID-->")) {
    html = html.replace("<!--GRID-->", products.map(card).join("\n"));
  }
  if (html.includes("<!--COLLECTION_LIVE-->")) {
    html = html.replace("<!--COLLECTION_LIVE-->", collectionLive(products));
  }
  if (html.includes("<!--COLLECTION_EXTRA-->")) {
    html = html.replace("<!--COLLECTION_EXTRA-->", collectionSourced(products));
  }
  if (html.includes("<!--LEDGER-->")) {
    html = html.replace("<!--LEDGER-->", ledger(cfg.consignments || []));
  }
  let extraHead = "";
  if (html.includes("<!--TRUSTPILOT-->")) {
    const block = trustpilot();
    html = html.replace("<!--TRUSTPILOT-->", block);
    if (block) extraHead = TP_SCRIPT;
  }
  html = shipTokens(html);
  if (html.includes("<!--ERA_OPTIONS-->")) html = html.replace("<!--ERA_OPTIONS-->", eraOptions());
  if (html.includes("<!--FEATURED-->")) {
    html = html.replace("<!--FEATURED-->", products.filter((p) => p.stock > 0).slice(0, 4).map(lot).join("\n"));
  }

  const jsonld = meta.jsonld === "org" ? [{
    "@context": "https://schema.org",
    "@type": ["OnlineStore", "LocalBusiness"],
    "@id": SITE + "/#business",
    name: BIZ.legal,
    alternateName: BIZ.short,
    url: SITE + "/",
    email: BIZ.email,
    logo: SITE + "/assets/img/favicon.svg",
    image: SITE + "/assets/img/og-default.png",
    description: "Factory-sealed Japanese Pokémon trading-card product imported direct from Tokyo and held in Manchester.",
    address: {
      "@type": "PostalAddress",
      streetAddress: BIZ.street,
      addressLocality: BIZ.city,
      postalCode: BIZ.postcode,
      addressCountry: "GB"
    },
    areaServed: { "@type": "Country", name: "United Kingdom" },
    currenciesAccepted: "GBP",
    paymentAccepted: "Visa, Mastercard, Apple Pay, Google Pay, Klarna, Clearpay",
    sameAs: [BIZ.instagram, BIZ.tiktok],
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: SITE + "/shop.html?q={search_term_string}" },
      "query-input": "required name=search_term_string"
    }
  }] : meta.jsonld === "faq" && meta.faq ? [{
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: meta.faq.map((q) => ({
      "@type": "Question", name: q.q,
      acceptedAnswer: { "@type": "Answer", text: q.a }
    }))
  }] : [];

  await mkdir(path.dirname(path.join(DIST, out)), { recursive: true });
  await writeFile(path.join(DIST, out), squeeze(shell({
    title: meta.title, description: meta.description, url, body: html, jsonld, noindex: !!meta.noindex, extraHead
  })));
  if (!meta.noindex && !meta.nositemap) urls.push({ loc: url, pri: meta.priority || "0.6" });
}

/* product pages */
for (const p of products) {
  const page = productPage(p, cfg);
  await writeFile(path.join(DIST, page.url.slice(1)), squeeze(page.html));
  urls.push({ loc: page.url, pri: "0.8" });
}

/* CSP guard. Inline <script>s run only if their exact sha256 is listed
   in netlify.toml's script-src — otherwise the browser silently blocks
   them (that is how live stock, the reveal animations and the
   order-confirmed bag reset were all quietly broken). JSON-LD is data,
   not script, so it's exempt. */
{
  const toml = await readFile(path.join(ROOT, "netlify.toml"), "utf8");
  const missing = new Map();
  for (const f of await readdir(DIST, { recursive: true })) {
    if (!f.endsWith(".html")) continue;
    const html = await readFile(path.join(DIST, f), "utf8");
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      const h = "sha256-" + createHash("sha256").update(m[1]).digest("base64");
      if (!toml.includes(h)) missing.set(h, f);
    }
  }
  for (const [h, f] of missing) {
    console.warn(`\n!! CSP: an inline script in ${f} will be BLOCKED in the browser.\n!! Add '${h}' to script-src in netlify.toml (or move the script into vault.js).\n`);
  }
  if (!missing.size) console.log("CSP: every inline script is allowed");
}

/* sitemap + robots */
const today = new Date().toISOString().slice(0, 10);
await writeFile(path.join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE}${u.loc}</loc><lastmod>${today}</lastmod><priority>${u.pri}</priority></url>`).join("\n")}
</urlset>
`);

await writeFile(path.join(DIST, "robots.txt"), IS_PROD
  ? `User-agent: *\nAllow: /\nDisallow: /cart.html\nDisallow: /order-confirmed.html\nDisallow: /checkout-cancelled.html\nDisallow: /vault-desk.html\n\nSitemap: ${SITE}/sitemap.xml\n`
  : `# Non-production deploy — nothing here should be indexed.\nUser-agent: *\nDisallow: /\n`);

console.log(`Built ${urls.length} pages -> dist  (site: ${SITE}, production: ${IS_PROD})`);
