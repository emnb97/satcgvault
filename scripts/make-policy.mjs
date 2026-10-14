/* Build a styled policy page from a plain-text policy.
   Omar's wording is used verbatim; this only applies the site layout.
   Usage: node scripts/make-policy.mjs <slug> "<Title>" <input.txt> */
import { readFile, writeFile } from "node:fs/promises";

const [slug, title, src] = process.argv.slice(2);
const raw = await readFile(src, "utf8");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* Format: numbered sections separated by blank lines.
   A line "N. Heading" starts a section; "A." / "B." are sub-headings;
   "::item" lines become list items; everything else is a paragraph. */
const lines = raw.split("\n");
let body = "", inList = false;
const closeList = () => { if (inList) { body += "</ul>\n"; inList = false; } };

for (let line of lines) {
  const t = line.trim();
  if (!t) { continue; }

  if (/^\d+\.\s/.test(t)) {
    closeList();
    body += `<h2>${esc(t.replace(/^\d+\.\s*/, ""))}</h2>\n`;
  } else if (/^[A-Z]\.\s/.test(t)) {
    closeList();
    body += `<h3>${esc(t.replace(/^[A-Z]\.\s*/, ""))}</h3>\n`;
  } else if (t.startsWith("::")) {
    if (!inList) { body += "<ul>\n"; inList = true; }
    body += `<li>${esc(t.slice(2).trim())}</li>\n`;
  } else {
    closeList();
    // linkify email + urls lightly
    let p = esc(t)
      .replace(/info@satcgvault\.co\.uk/g, '<a href="mailto:info@satcgvault.co.uk">info@satcgvault.co.uk</a>')
      .replace(/https:\/\/ico\.org\.uk/g, '<a href="https://ico.org.uk" rel="noopener">https://ico.org.uk</a>');
    body += `<p>${p}</p>\n`;
  }
}
closeList();

const meta = {
  privacy: "How S&A TCG Vault Ltd collects, uses, stores and protects your personal information, and your rights under UK data-protection law.",
  terms: "The terms on which S&A TCG Vault Ltd sells sealed Japanese Pokémon trading-card products and accessories through this website."
}[slug] || "";

const page = `---
{"title":"${title} | S&A TCG Vault","description":"${meta}","priority":"0.4"}
---
<section class="section">
  <div class="wrap prose policy">
    <p class="meta ref">${slug === "privacy" ? "Data protection" : "Legal"}</p>
    <h1>${esc(title)}</h1>
    <p class="meta">S&amp;A TCG Vault Ltd · Last updated 10 October 2026</p>
    <nav class="policy__links" aria-label="Related policies">
      <a href="/policies/privacy.html">Privacy</a>
      <a href="/policies/terms.html">Terms</a>
      <a href="/policies/cookies.html">Cookies</a>
      <a href="/policies/returns.html">Returns</a>
      <a href="/policies/delivery.html">Delivery</a>
    </nav>
${body}  </div>
</section>
`;

await writeFile(`src/pages/policies/${slug}.html`, page);
console.log(`Wrote src/pages/policies/${slug}.html (${body.length} chars)`);
