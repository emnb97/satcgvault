# Deploying — read this first

The last three failed deploys were all the same thing: `package.json` was not at
the repository root, so `npm run build` had nothing to run. This log line is the tell:

```
❯ Config file   /opt/build/repo/netlify.toml     ← found this
npm error path  /opt/build/repo/package.json     ← but not this, beside it
```

`netlify.toml` and `package.json` **must sit next to each other** at the repo root.

## The reliable way (this zip is already set up for it)

This archive is a git repository with the correct layout committed. From the unzipped
folder:

```bash
# 1. Point it at your empty GitHub repo
git remote add origin https://github.com/<you>/satcgvault.git
git branch -M main
git push -u origin main

# 2. In Netlify: Add new site → Import from Git → pick the repo.
#    netlify.toml sets everything. Do not override build settings in the UI.

# 3. Add environment variables (Site configuration → Environment variables):
#    STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
#    (and SANITY_PROJECT_ID etc. once the CMS is connected — see CMS-SETUP.md)
```

That is it. `package.json` is at the root of this repo, so the ENOENT cannot recur.

## Before every push

```bash
npm run doctor
```

It checks Node version, lockfile drift, the publish directory and that every required
file is present — the things that actually stop a Netlify build, in the order Netlify
hits them.

## If you are committing by hand instead

Make sure these end up at the repository root, not inside a subfolder:

```
package.json   package-lock.json   netlify.toml
assets/   data/   netlify/   sanity/   scripts/   src/
```

A quick check after pushing — this must list package.json with no folder prefix:

```bash
git ls-files | grep -v / | grep package.json
```

If it prints `satcgvault/package.json`, the project is one level too deep. Either move
everything up a level, or set `base = "satcgvault"` in netlify.toml.

## Drag-and-drop previews are different

`satcgvault-preview.zip` is the already-built `dist/` for dropping on
app.netlify.com/drop. That is for a quick look only — it has no build step, so Stripe
checkout and the forms do not work. Git deployment is the real thing.
