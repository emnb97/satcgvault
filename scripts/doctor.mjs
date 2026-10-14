/* ============================================================
   npm run doctor
   Checks the things that actually break Netlify deploys, in the
   order Netlify hits them. Run it locally before pushing.
   ============================================================ */
import { readFile, access } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); failed++; };
const warn = (m) => console.log(`  warn  ${m}`);
let failed = 0;

console.log("\nChecking this project the way Netlify will.\n");

const [maj, min] = process.versions.node.split(".").map(Number);
if (maj > 20 || (maj === 20 && min >= 11)) ok(`Node ${process.versions.node}`);
else bad(`Node ${process.versions.node} — needs 20.11 or newer for import.meta.dirname`);

let pkg, lock;
try {
  pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  ok("package.json readable");
} catch { bad("package.json missing or invalid — is the project at the repo root?"); }

try {
  lock = JSON.parse(await readFile(path.join(ROOT, "package-lock.json"), "utf8"));
  ok(`package-lock.json present (v${lock.lockfileVersion})`);
} catch { bad("package-lock.json missing — npm ci cannot run without it. Run npm install and commit it."); }

if (pkg && lock) {
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const locked = lock.packages?.[""] ?? {};
  const inLock = Object.keys({ ...locked.dependencies, ...locked.devDependencies });
  const drift = declared.filter((d) => !inLock.includes(d));
  if (drift.length) bad(`lockfile is out of date, missing: ${drift.join(", ")} — run npm install and commit`);
  else ok("package.json and lockfile agree");

  if (pkg.devDependencies && Object.keys(pkg.devDependencies).length) {
    warn("devDependencies present — some Netlify configs set NODE_ENV=production and skip them. Anything the build needs belongs in dependencies.");
  }
}

for (const f of ["netlify.toml", "data/products.json", "assets/css/vault.css",
                 "assets/js/vault.js", "src/pages/index.html",
                 "netlify/functions/create-checkout-session.mjs"]) {
  try { await access(path.join(ROOT, f)); ok(f); }
  catch { bad(`${f} missing`); }
}

try {
  const toml = await readFile(path.join(ROOT, "netlify.toml"), "utf8");
  if (/publish\s*=\s*"dist"/.test(toml)) ok('publish = "dist"');
  else bad("netlify.toml publish directory is not dist");
} catch { /* already reported */ }

console.log(failed ? `\n${failed} problem(s). Fix these before pushing.\n`
                   : "\nNothing here will stop a deploy.\n");
process.exit(failed ? 1 : 0);
