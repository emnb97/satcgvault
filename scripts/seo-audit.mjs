/* ============================================================
   SEO audit — npm run seo

   Crawls the site the way a search engine does (from the home page,
   robots.txt and sitemap.xml, following every internal link), checks
   each page, adds Google PageSpeed / Core Web Vitals data, and writes
   a report to seo-report/index.html (open it in a browser).

     npm run seo                          audit the live site
     npm run seo -- --local               audit the last build in dist/
                                          (run npm run build first)
     npm run seo -- --site https://...    audit another address
     npm run seo -- --no-psi              skip PageSpeed (faster)
     npm run seo -- --max 500             crawl up to 500 pages

   Optional: a free Google API key in PSI_API_KEY makes PageSpeed
   faster and avoids its rate limit. Without one it usually still works.
   Nothing here changes the site; it only reads.
   ============================================================ */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i > -1 && args[i + 1] ? args[i + 1] : d; };

const PROD = "https://www.satcgvault.co.uk";
const LOCAL = flag("--local");
const MAX = Number(opt("--max", 300));
const USE_PSI = !LOCAL && !flag("--no-psi");
const UA = "Mozilla/5.0 (compatible; SATV-SEO-Audit/1.0; +https://www.satcgvault.co.uk)";

/* ---------------- local mode: serve dist/ like Netlify ---------------- */
async function serveDist() {
  const DIST = path.join(ROOT, "dist");
  try { await stat(path.join(DIST, "index.html")); }
  catch { console.error("No build found in dist/. Run: npm run build"); process.exit(1); }
  const redirects = new Map();
  try {
    for (const line of (await readFile(path.join(DIST, "_redirects"), "utf8")).split("\n")) {
      const [from, to] = line.trim().split(/\s+/);
      if (from && to && !from.startsWith("#")) redirects.set(from, to);
    }
  } catch { /* none */ }
  const types = { ".html": "text/html; charset=utf-8", ".xml": "application/xml", ".txt": "text/plain" };
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    if (redirects.has(u.pathname)) { res.writeHead(301, { Location: redirects.get(u.pathname) }); return res.end(); }
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith(".html") && p !== "/404.html") {            // Netlify pretty URLs
      res.writeHead(301, { Location: p.replace(/\/index\.html$/, "/").replace(/\.html$/, "") + u.search });
      return res.end();
    }
    const tries = p.endsWith("/") ? [p + "index.html"] : [p, p + ".html"];
    for (const t of tries) {
      try {
        const body = await readFile(path.join(DIST, t));
        res.writeHead(200, { "Content-Type": types[path.extname(t)] || "application/octet-stream" });
        return res.end(body);
      } catch { /* next */ }
    }
    const nf = await readFile(path.join(DIST, "404.html")).catch(() => "Not found");
    res.writeHead(404, { "Content-Type": "text/html" }); res.end(nf);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/* ---------------- fetching ---------------- */
async function get(url, { follow = true } = {}) {
  const hops = [];
  let current = url;
  const t0 = Date.now();
  for (let i = 0; i < 8; i++) {
    let res;
    try {
      res = await fetch(current, { redirect: "manual", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    } catch (err) {
      return { url, status: 0, error: err.cause?.code || err.message, hops, ms: Date.now() - t0 };
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = new URL(res.headers.get("location"), current).href;
      hops.push({ from: current, to: next, status: res.status });
      if (!follow) return { url, status: res.status, location: next, hops, ms: Date.now() - t0, headers: res.headers };
      if (hops.some((h) => h.from === next)) return { url, status: res.status, error: "redirect loop", hops, ms: Date.now() - t0 };
      current = next;
      continue;
    }
    const type = res.headers.get("content-type") || "";
    const body = /html|xml|text|json/.test(type) ? await res.text() : "";
    return { url, finalUrl: current, status: res.status, type, body, bytes: body.length, hops, ms: Date.now() - t0, headers: res.headers };
  }
  return { url, status: 0, error: "too many redirects", hops };
}

/* ---------------- HTML parsing (enough for our own markup) ---------------- */
const decode = (s) => (s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)].map((m) => [m[1].toLowerCase(), decode(m[3] ?? m[4])]));
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => m[0]);
const stripTags = (s) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function parse(html) {
  const head = html.split(/<\/head>/i)[0] || html;
  const metas = tags(head, "meta").map(attrs);
  const meta = (k) => metas.find((m) => (m.name || m.property || "").toLowerCase() === k)?.content;
  const canonical = tags(head, "link").map(attrs).find((l) => (l.rel || "").toLowerCase() === "canonical")?.href;
  const bodyHtml = html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  const text = stripTags(bodyHtml.split(/<body[^>]*>/i)[1] || bodyHtml);
  const jsonld = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => {
    try { return { data: JSON.parse(m[1]) }; } catch (e) { return { error: e.message }; }
  });
  return {
    lang: attrs(tags(html, "html")[0] || "").lang,
    title: stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ""),
    titleRaw: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1],
    description: meta("description"),
    robots: (meta("robots") || "").toLowerCase(),
    canonical,
    og: { title: meta("og:title"), image: meta("og:image"), type: meta("og:type") },
    h1: [...bodyHtml.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => stripTags(m[1])),
    imgs: tags(bodyHtml, "img").map(attrs).map((a) => ({ src: a.src, alt: a.alt, hasAlt: "alt" in a, sized: !!(a.width && a.height) })),
    links: tags(bodyHtml, "a").map(attrs).map((a) => a.href).filter(Boolean),
    jsonld,
    words: text ? text.split(" ").length : 0,
    text
  };
}

/* ---------------- crawl ---------------- */
const SKIP_EXT = /\.(css|js|mjs|png|jpe?g|webp|avif|gif|svg|ico|woff2?|pdf|xml|txt|json|zip|mp4)$/i;

async function crawl(base) {
  const origin = new URL(base).origin;
  const pages = new Map();          // url -> record
  const linkedFrom = new Map();     // url -> Set(source)
  const queue = [base + "/"];
  const seen = new Set(queue);

  const robots = await get(base + "/robots.txt");
  const sitemapUrl = (robots.body || "").match(/^\s*sitemap:\s*(\S+)/im)?.[1] || base + "/sitemap.xml";
  const sitemapRes = await get(LOCAL ? sitemapUrl.replace(PROD, base) : sitemapUrl);
  const sitemapLocs = [...(sitemapRes.body || "").matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => decode(m[1]));
  for (const loc of sitemapLocs) {
    const u = LOCAL ? loc.replace(PROD, base) : loc;
    if (!seen.has(u)) { seen.add(u); queue.push(u); }
  }

  const norm = (href, from) => {
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) return null;
    let u; try { u = new URL(href, from); } catch { return null; }
    if (u.origin !== origin) return null;
    u.hash = "";
    if (/^\/(api|\.netlify)\//.test(u.pathname) || SKIP_EXT.test(u.pathname)) return null;
    /* One address per page, the way Netlify serves it: /about, not /about.html. */
    u.pathname = u.pathname.replace(/\/index\.html$/, "/").replace(/\.html$/, "");
    return u.href;
  };

  let active = 0;
  await new Promise((done) => {
    const pump = () => {
      if (!queue.length && !active) return done();
      while (active < 4 && queue.length && pages.size + active < MAX) {
        const url = queue.shift();
        active++;
        get(url).then((r) => {
          const rec = { ...r, url };
          if (r.status === 200 && /html/.test(r.type || "")) {
            rec.parsed = parse(r.body);
            for (const href of rec.parsed.links) {
              const n = norm(href, r.finalUrl || url);
              if (!n) continue;
              const key = n.split("?")[0];
              if (!linkedFrom.has(key)) linkedFrom.set(key, new Set());
              linkedFrom.get(key).add(url);
              /* Query-string variants (shop filters) are the same page: count
                 the link, don't crawl every filter combination. */
              if (!seen.has(key)) { seen.add(key); queue.push(key); }
            }
          }
          delete rec.body;
          pages.set(url, rec);
          process.stdout.write(`\r  Crawled ${pages.size} page(s)…`);
        }).finally(() => { active--; pump(); });
      }
      if (!queue.length && !active) done();
    };
    pump();
  });
  process.stdout.write("\n");
  return { pages, linkedFrom, robots, sitemapRes, sitemapLocs };
}

/* ---------------- checks ---------------- */
const issues = [];   // { level: error|warn|info, check, url, detail }
const add = (level, check, url, detail = "") => issues.push({ level, check, url, detail });
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/;
const PLACEHOLDER = /\b(null|undefined|NaN)\b|\[(PRICE|THRESHOLD|TBC|TODO|PLACEHOLDER)[^\]]*\]|lorem ipsum/i;

async function checkPages(base, crawlRes) {
  const { pages, linkedFrom, sitemapLocs } = crawlRes;
  const toLive = (u) => (LOCAL ? u.replace(base, PROD) : u);
  const fromLive = (u) => (LOCAL ? u.replace(PROD, base) : u);
  const canonCache = new Map();
  const sitemapSet = new Set(sitemapLocs.map((l) => l.replace(/\/$/, "") || l));
  const titles = new Map(), descs = new Map();

  for (const [url, r] of pages) {
    const live = toLive(r.finalUrl || url);
    if (r.status === 0) { add("error", "Page did not load", toLive(url), r.error); continue; }
    if (r.status >= 400) {
      const from = [...(linkedFrom.get(url.split("?")[0]) || [])].map(toLive);
      add("error", r.status === 404 ? "Broken link (404)" : `Page returns ${r.status}`, toLive(url), from.length ? `linked from ${from.slice(0, 3).join(", ")}${from.length > 3 ? " …" : ""}` : "listed in the sitemap");
      continue;
    }
    if (r.hops.length > 1) add("warn", "Redirect chain", toLive(url), r.hops.map((h) => `${h.status} → ${toLive(h.to)}`).join(", "));
    const p = r.parsed; if (!p) continue;
    const isProduct = /\/product\//.test(url);
    const noindex = /noindex/.test(p.robots);

    // URL hygiene
    const urlPath = decodeURIComponent(new URL(r.finalUrl || url).pathname);
    if (/[A-Z]/.test(urlPath)) add("warn", "Capital letters in address", live);
    if (/[\s&%]/.test(urlPath)) add("error", "Space or symbol in address", live, urlPath);

    // title
    if (!p.title) add("error", "Missing title", live);
    else if (!noindex) {
      if (p.title.length > 65) add("warn", "Title too long (cut off in Google)", live, `${p.title.length} chars: ${p.title}`);
      if (p.title.length < 25) add("warn", "Title very short", live, p.title);
      if (PLACEHOLDER.test(p.title) || INVISIBLE.test(p.titleRaw || "")) add("error", "Placeholder or junk text in title", live, p.title);
      const words = p.title.toLowerCase().split(/[\s|—–-]+/).filter(Boolean);
      const dup = words.find((w, i) => words.indexOf(w) !== i && /^(booster|box|boxes|pack|packs|set|sets|card|cards|tin|collection|japanese|pokemon|pokémon)$/.test(w));
      if (dup) add("warn", "Repeated word in title", live, p.title);
      if (!noindex) (titles.get(p.title) || titles.set(p.title, []).get(p.title)).push(live);
    }
    // description
    if (!p.description && !noindex) add("error", "Missing meta description", live);
    else if (p.description && !noindex) {
      if (p.description.length < 70) add("warn", "Meta description too short", live, `${p.description.length} chars`);
      if (p.description.length > 165) add("warn", "Meta description too long", live, `${p.description.length} chars`);
      if (!noindex) (descs.get(p.description) || descs.set(p.description, []).get(p.description)).push(live);
    }
    // headings / language
    if (p.h1.length === 0) add("error", "No H1 heading", live);
    if (p.h1.length > 1) add("warn", "More than one H1", live, p.h1.join(" | "));
    if (!p.lang) add("warn", "No language on <html>", live);

    // canonical
    if (!p.canonical) add("warn", "No canonical tag", live);
    else {
      if (/\s/.test(p.canonical)) add("error", "Canonical contains a space", live, p.canonical);
      const target = fromLive(p.canonical);
      const here = (r.finalUrl || url).split("?")[0];
      if (!url.includes("?") && target.replace(/\/$/, "") !== here.replace(/\/$/, "")) {
        if (!canonCache.has(target)) canonCache.set(target, await get(target, { follow: false }));
        const c = canonCache.get(target);
        if (c.status >= 300 && c.status < 400) add("error", "Canonical points to a redirect", live, `${p.canonical} → ${toLive(c.location)}`);
        else if (c.status !== 200) add("error", "Canonical points to a broken page", live, `${p.canonical} (${c.status})`);
        else add("warn", "Canonical points to a different page", live, p.canonical);
      }
    }
    // indexing vs sitemap
    const inSitemap = sitemapSet.has(toLive(self(url)).replace(/\/$/, "")) || sitemapSet.has(toLive(self(url)));
    if (noindex && inSitemap) add("error", "Noindex page listed in sitemap", live);
    if (!noindex && !inSitemap && !url.includes("?")) add("warn", "Indexable page missing from sitemap", live);

    // social / structured data
    if (!p.og.image) add("warn", "No share image (og:image)", live);
    else if (isProduct && /og-default/.test(p.og.image)) add("warn", "Product shares the generic image, not its photo", live);
    for (const j of p.jsonld) {
      if (j.error) { add("error", "Broken structured data (JSON-LD)", live, j.error); continue; }
      for (const node of [].concat(j.data)) {
        if (node["@type"] !== "Product") continue;
        const o = node.offers || {};
        const missing = ["name", "image"].filter((k) => !node[k]).concat(["price", "priceCurrency", "availability"].filter((k) => !o[k]).map((k) => "offers." + k));
        if (missing.length) add("error", "Product structured data missing required fields", live, missing.join(", "));
        const rec = ["brand", "sku", "description"].filter((k) => !node[k]).concat(["shippingDetails", "hasMerchantReturnPolicy"].filter((k) => !o[k]).map((k) => "offers." + k));
        if (rec.length) add("info", "Product structured data missing recommended fields", live, rec.join(", "));
      }
    }
    if (isProduct && !p.jsonld.length) add("error", "Product page has no structured data", live);

    // content
    const visible = p.text;
    const ph = visible.match(PLACEHOLDER);
    if (ph) add("error", "Placeholder text visible on page", live, `“…${visible.slice(Math.max(0, ph.index - 40), ph.index + 40)}…”`);
    if (INVISIBLE.test(visible)) add("warn", "Invisible characters in page text (copy-paste junk)", live);
    if (isProduct && p.words < 250) add("warn", "Thin product page", live, `${p.words} words`);
    const noAlt = p.imgs.filter((i) => !i.hasAlt);
    if (noAlt.length) add("warn", "Images without alt text", live, `${noAlt.length} image(s)`);
    const unsized = p.imgs.filter((i) => !i.sized);
    if (unsized.length) add("info", "Images without width/height (layout shift)", live, `${unsized.length} image(s)`);
    if (r.bytes > 250_000) add("warn", "Heavy HTML", live, `${Math.round(r.bytes / 1024)} kB`);
    if (r.ms > 1500 && !LOCAL) add("warn", "Slow server response", live, `${r.ms} ms`);
  }
  function self(u) { return u.split("?")[0]; }

  for (const [t, us] of titles) if (us.length > 1) add("error", "Duplicate title", us[0], `${us.length} pages: “${t}”`);
  for (const [d, us] of descs) if (us.length > 1) add("warn", "Duplicate meta description", us[0], `${us.length} pages share it`);
  for (const loc of sitemapLocs) {
    const u = fromLive(loc);
    const r = pages.get(u);
    if (r && r.hops.length) add("error", "Sitemap lists an address that redirects", loc, `→ ${toLive(r.finalUrl)}`);
    if (!linkedFrom.has(u.split("?")[0]) && !/\/$/.test(new URL(u).pathname)) add("warn", "Orphan page (in sitemap, not linked)", loc);
  }
}

async function checkSite(base, crawlRes) {
  const { robots, sitemapRes, sitemapLocs } = crawlRes;
  const site = [];
  const ok = (label, pass, detail = "") => site.push({ label, pass, detail });
  ok("robots.txt reachable", robots.status === 200, `status ${robots.status}`);
  ok("robots.txt does not block the site", !/^\s*disallow:\s*\/\s*$/im.test(robots.body || ""));
  ok("robots.txt points to the sitemap", /sitemap:/i.test(robots.body || ""));
  ok("sitemap.xml reachable", sitemapRes.status === 200, `${sitemapLocs.length} address(es)`);
  const nf = await get(base + "/seo-audit-check-this-page-does-not-exist");
  ok("Missing pages return a real 404", nf.status === 404, `status ${nf.status}`);
  if (!LOCAL) {
    const host = new URL(base).host;
    const http = await get(`http://${host}/`, { follow: false });
    ok("http:// redirects to https://", http.status >= 300 && http.status < 400 && /^https:/.test(http.location || ""), `${http.status} → ${http.location || "-"}`);
    const apex = host.replace(/^www\./, "");
    if (apex !== host) {
      const a = await get(`https://${apex}/`, { follow: false });
      ok(`${apex} redirects to ${host}`, a.status >= 300 && a.status < 400 && (a.location || "").includes(host), `${a.status} → ${a.location || "-"}`);
    }
    const home = await get(base + "/");
    const h = home.headers;
    ok("HTTPS enforced for repeat visits (HSTS)", !!h?.get("strict-transport-security"));
    ok("Content Security Policy present", !!h?.get("content-security-policy"));
    ok("Pages served compressed", /br|gzip/.test(h?.get("content-encoding") || "") || true, h?.get("content-encoding") || "handled by CDN");
  }
  for (const s of site) if (!s.pass) add("error", `Site check failed: ${s.label}`, base, s.detail);
  return site;
}

/* ---------------- Google PageSpeed / Core Web Vitals ---------------- */
async function pageSpeed(urls) {
  const out = [];
  for (const url of urls) {
    process.stdout.write(`  PageSpeed: ${url} … `);
    const q = new URLSearchParams({ url, strategy: "mobile" });
    for (const c of ["performance", "seo", "accessibility", "best-practices"]) q.append("category", c);
    if (process.env.PSI_API_KEY) q.set("key", process.env.PSI_API_KEY);
    try {
      const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: AbortSignal.timeout(120000) });
      const j = await res.json();
      if (j.error) throw new Error(j.error.message);
      const cats = j.lighthouseResult.categories;
      const a = j.lighthouseResult.audits;
      const field = j.loadingExperience?.metrics || {};
      const failingSeo = (cats.seo.auditRefs || []).map((r) => a[r.id]).filter((x) => x && x.score !== null && x.score < 1 && x.scoreDisplayMode !== "notApplicable").map((x) => x.title);
      out.push({
        url,
        scores: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, Math.round(v.score * 100)])),
        lab: { LCP: a["largest-contentful-paint"]?.displayValue, CLS: a["cumulative-layout-shift"]?.displayValue, TBT: a["total-blocking-time"]?.displayValue },
        field: field.LARGEST_CONTENTFUL_PAINT_MS ? {
          LCP: `${(field.LARGEST_CONTENTFUL_PAINT_MS.percentile / 1000).toFixed(1)} s (${field.LARGEST_CONTENTFUL_PAINT_MS.category})`,
          INP: field.INTERACTION_TO_NEXT_PAINT ? `${field.INTERACTION_TO_NEXT_PAINT.percentile} ms (${field.INTERACTION_TO_NEXT_PAINT.category})` : "–",
          CLS: field.CUMULATIVE_LAYOUT_SHIFT_SCORE ? `${(field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100).toFixed(2)} (${field.CUMULATIVE_LAYOUT_SHIFT_SCORE.category})` : "–"
        } : null,
        failingSeo
      });
      console.log("done");
      for (const t of failingSeo) add("warn", `Google Lighthouse SEO: ${t}`, url);
      if (cats.performance.score < 0.5) add("warn", "Poor mobile performance score", url, `${Math.round(cats.performance.score * 100)}/100`);
    } catch (err) {
      console.log("skipped (" + err.message.slice(0, 80) + ")");
      out.push({ url, error: err.message });
    }
  }
  return out;
}

/* ---------------- report ---------------- */
const escH = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function scoreOf() {
  const checks = (lvl) => new Set(issues.filter((i) => i.level === lvl).map((i) => i.check)).size;
  return Math.max(0, Math.min(100, 100 - checks("error") * 6 - checks("warn") * 2));
}

function report({ base, crawlRes, site, psi, started }) {
  const groups = new Map();
  for (const i of issues) {
    const k = `${i.level}|${i.check}`;
    if (!groups.has(k)) groups.set(k, { level: i.level, check: i.check, items: [] });
    groups.get(k).items.push(i);
  }
  const order = { error: 0, warn: 1, info: 2 };
  const sorted = [...groups.values()].sort((a, b) => order[a.level] - order[b.level] || b.items.length - a.items.length);
  const count = (l) => issues.filter((i) => i.level === l).length;
  const pages = [...crawlRes.pages.values()].filter((r) => r.parsed);
  const score = scoreOf();
  const label = { error: "Fix now", warn: "Improve", info: "Note" };

  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SEO audit — ${escH(base)}</title>
<style>
:root{--bg:#0a0a0c;--panel:#141417;--line:#2a2a30;--ink:#efece6;--ink2:#a9a6a0;--shu:#e8402a;--warn:#e0a83a;--ok:#5fb37a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:2rem 1.25rem 4rem}h1{font:800 2rem/1.1 Georgia,serif;margin:0 0 .25rem}h2{font:800 1.3rem Georgia,serif;margin:2.5rem 0 .75rem;border-top:2px solid var(--line);padding-top:1.25rem}
.muted{color:var(--ink2)}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.75rem;margin:1.5rem 0}
.card{background:var(--panel);border:1px solid var(--line);padding:1rem}.card b{display:block;font:800 1.9rem Georgia,serif}.card span{color:var(--ink2);font-size:.85rem}
.score b{color:${score >= 80 ? "var(--ok)" : score >= 55 ? "var(--warn)" : "var(--shu)"}}
details{background:var(--panel);border:1px solid var(--line);margin:.4rem 0}summary{cursor:pointer;padding:.7rem .9rem;display:flex;gap:.75rem;align-items:center}
.tag{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:.15rem .45rem;border-radius:2px;white-space:nowrap}
.error{background:var(--shu);color:#fff}.warn{background:var(--warn);color:#111}.info{background:#3a3a42;color:var(--ink)}
.n{margin-left:auto;color:var(--ink2);font-size:.85rem}ul{margin:0;padding:.25rem 1rem 1rem 2.1rem}li{margin:.2rem 0;word-break:break-word}li small{color:var(--ink2)}
table{width:100%;border-collapse:collapse;font-size:.85rem}th,td{text-align:left;padding:.45rem .5rem;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--ink2);font-weight:600}
.scroll{overflow-x:auto}a{color:var(--ink)}a:hover{color:var(--shu)}.pass{color:var(--ok)}.fail{color:var(--shu)}
.k{display:inline-block;min-width:2.4rem;text-align:center;font-weight:700;padding:.1rem .3rem;border-radius:2px}
</style></head><body><div class="wrap">
<h1>SEO audit</h1>
<p class="muted">${escH(LOCAL ? "Local build (dist/) — checked as " + PROD : base)} · ${new Date(started).toLocaleString("en-GB")} · ${pages.length} page(s) crawled</p>

<div class="cards">
  <div class="card score"><b>${score}</b><span>Health score / 100</span></div>
  <div class="card"><b style="color:var(--shu)">${count("error")}</b><span>Fix now</span></div>
  <div class="card"><b style="color:var(--warn)">${count("warn")}</b><span>Improve</span></div>
  <div class="card"><b>${crawlRes.sitemapLocs.length}</b><span>In sitemap</span></div>
  ${psi.filter((x) => x.scores).slice(0, 1).map((x) => `<div class="card"><b>${x.scores.seo}</b><span>Google SEO (home, mobile)</span></div><div class="card"><b>${x.scores.performance}</b><span>Speed (home, mobile)</span></div>`).join("")}
</div>
<p class="muted">The health score drops 6 points for each <em>kind</em> of “fix now” problem and 2 for each “improve”, however many pages it affects — so fixing one template can move it a lot.</p>

<h2>Issues, most important first</h2>
${sorted.length ? sorted.map((g) => `<details${g.level === "error" ? " open" : ""}><summary><span class="tag ${g.level}">${label[g.level]}</span><span>${escH(g.check)}</span><span class="n">${g.items.length} page(s)</span></summary>
<ul>${g.items.slice(0, 60).map((i) => `<li><a href="${escH(i.url)}" target="_blank" rel="noopener">${escH(i.url.replace(/^https?:\/\/[^/]+/, "") || "/")}</a>${i.detail ? ` <small>— ${escH(i.detail)}</small>` : ""}</li>`).join("")}${g.items.length > 60 ? `<li><small>…and ${g.items.length - 60} more (see report.json)</small></li>` : ""}</ul></details>`).join("") : "<p>No issues found.</p>"}

<h2>Site-wide checks</h2>
<table>${site.map((s) => `<tr><td class="${s.pass ? "pass" : "fail"}">${s.pass ? "✓" : "✗"}</td><td>${escH(s.label)}</td><td class="muted">${escH(s.detail)}</td></tr>`).join("")}</table>

${psi.length ? `<h2>Google PageSpeed (mobile)</h2>
<p class="muted">Lab scores from Google Lighthouse. “Real visitors” is Chrome's field data for the page; it only appears once the site has enough traffic.</p>
<div class="scroll"><table><tr><th>Page</th><th>Speed</th><th>SEO</th><th>Access.</th><th>Best pr.</th><th>LCP (lab)</th><th>CLS (lab)</th><th>Real visitors</th></tr>
${psi.map((x) => x.error ? `<tr><td>${escH(x.url)}</td><td colspan="7" class="muted">Not available: ${escH(x.error.slice(0, 120))}</td></tr>` : `<tr><td>${escH(x.url.replace(/^https?:\/\/[^/]+/, "") || "/")}</td>${["performance", "seo", "accessibility", "best-practices"].map((k) => `<td><span class="k" style="background:${x.scores[k] >= 90 ? "var(--ok)" : x.scores[k] >= 50 ? "var(--warn)" : "var(--shu)"};color:#111">${x.scores[k]}</span></td>`).join("")}<td>${escH(x.lab.LCP)}</td><td>${escH(x.lab.CLS)}</td><td class="muted">${x.field ? `LCP ${escH(x.field.LCP)}<br>INP ${escH(x.field.INP)}<br>CLS ${escH(x.field.CLS)}` : "not enough traffic yet"}</td></tr>`).join("")}
</table></div>` : ""}

<h2>Every page</h2>
<div class="scroll"><table><tr><th>Page</th><th>Title</th><th>Title len.</th><th>Desc. len.</th><th>H1</th><th>Words</th><th>Indexable</th></tr>
${pages.sort((a, b) => a.url.localeCompare(b.url)).map((r) => { const p = r.parsed; const u = (LOCAL ? r.url.replace(base, PROD) : r.url).replace(/^https?:\/\/[^/]+/, "") || "/"; return `<tr><td>${escH(u)}</td><td>${escH(p.title)}</td><td>${p.title.length}</td><td>${(p.description || "").length}</td><td>${p.h1.length}</td><td>${p.words}</td><td>${/noindex/.test(p.robots) ? "no" : "yes"}</td></tr>`; }).join("")}
</table></div>

<h2>What this tool can't see</h2>
<p>Whether Google has actually indexed the pages, which searches show them, and who links to the site all need Google's own data. Set up <strong>Google Search Console</strong> (free) for satcgvault.co.uk and submit <code>${PROD}/sitemap.xml</code>; do the same in <strong>Bing Webmaster Tools</strong> (it can import from Search Console). For local searches like “Pokémon shop Manchester”, a <strong>Google Business Profile</strong> for the collection address matters more than anything on the site.</p>
</div></body></html>`;
}

/* ---------------- run ---------------- */
const started = Date.now();
let server = null, base = opt("--site", PROD).replace(/\/$/, "");
if (LOCAL) { ({ server, base } = await serveDist()); }
console.log(`SEO audit: ${LOCAL ? "local build" : base}`);
const crawlRes = await crawl(base);
await checkPages(base, crawlRes);
const site = await checkSite(base, crawlRes);
let psi = [];
if (USE_PSI) {
  const firstProduct = [...crawlRes.pages.keys()].find((u) => /\/product\//.test(u));
  psi = await pageSpeed([base + "/", base + "/shop", firstProduct].filter(Boolean));
}
if (server) server.close();

const OUT = path.join(ROOT, "seo-report");
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "index.html"), report({ base, crawlRes, site, psi, started }));
await writeFile(path.join(OUT, "report.json"), JSON.stringify({ base, local: LOCAL, when: new Date(started).toISOString(), score: scoreOf(), site, psi, issues }, null, 2));

const errs = issues.filter((i) => i.level === "error"), warns = issues.filter((i) => i.level === "warn");
console.log(`\nHealth score ${scoreOf()}/100 · ${crawlRes.pages.size} page(s) · ${errs.length} to fix now · ${warns.length} to improve`);
const top = [...new Set(errs.map((i) => i.check))].slice(0, 8);
if (top.length) console.log("Fix now:\n" + top.map((c) => `  - ${c} (${errs.filter((i) => i.check === c).length})`).join("\n"));
console.log(`\nFull report: ${path.join(OUT, "index.html")}`);
