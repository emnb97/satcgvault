# Direction: the catalogue, not the vault

## What I threw out and why

The previous build was a near-black slab with a hot accent, expanded caps, bordered
panel grids and a holofoil trick. Every one of those is a default rather than a choice
— and every competing Japanese-import TCG site in the UK looks like it, because the
category has collectively decided that "collectible" means "dark and neon".

Two specific problems beyond the sameness:

1. **Dark backgrounds swallow the product.** Japanese booster displays are already
   saturated red, gold and blue. Photographed on black they turn into mush. The single
   most valuable asset this business has is Omar's arrival photography, and the old
   design was actively working against it.
2. **The brand claim was in the copy but not the design.** "We photograph everything
   on arrival so you never have to take our word for it" is a claim about *evidence*.
   The design said "we are a tech company with a security aesthetic."

## Where this one starts instead

An auction catalogue. Sealed Japanese boxes are documented lots with provenance,
a condition report and a photograph — that is literally what they are, and it is how
Sotheby's, Phillips and every serious collectibles house presents goods. It elevates
the product, it foregrounds the photography, and it makes the verification story
structural rather than decorative.

## Red and black, reconsidered

The brief says red and black. It does not say dark interface — that was my assumption.

Red and black on paper is the oldest version of that pairing, and in this case it is
also the authentic one: sumi ink black, shu vermillion, and a cool paper stock. It is
the palette of the hanko seal, of Japanese print, of the flag. It ties directly to
where the product comes from, and it lets the photography carry the page.

- `--paper  #f1efec` — cool, slightly grey. Not a warm cream.
- `--sumi   #14120f` — ink black for text
- `--shu    #cf2a20` — vermillion, used for the seal and almost nothing else
- `--ai     #26364f` — indigo, the traditional third, for the trade section only

## Type

**Shippori Mincho** for display. A Japanese Mincho that draws Latin and Japanese in
the same voice — so "Storm Emeralda" and 「封印」 sit together as one typeface rather
than a Western font with Japanese bolted on. That is the Tokyo-to-Manchester idea
expressed in the type itself.

**Zen Kaku Gothic New** for interface and body. Also bilingual, plain, workmanlike.

Two families, both covering both scripts. No expanded grotesque caps anywhere.

## The one bold element

The hanko. A vermillion seal, carved white, stamped once in the hero and appearing
small against every lot Omar has personally photographed on arrival. It is the mark
of verification, it is unmistakably Japanese, and it is the only place red appears at
any size. Everything else is quiet.

## Deliberately absent

Bordered card grids. Hairline-boxed panels. Numbered `01 02 03` markers. Scrolling
marquees. Big-numeral stat rows. Uppercase tracked-out eyebrow labels. Gradient
washes. `→` glued to button text. Accent-coloured words inside headlines. Any of the
devices that turned up in both this site and EB Web Services.

## Motion

One moment: the seal stamps down once on load, and stops. Nothing else moves unless
the visitor does something. Reduced-motion honoured.

---

# Revision: darkening without the default

The client wants dark. The risk is that "dark" means the near-black slab with one
bright accent — the exact default this direction was built to escape. Two decisions
keep it clear of that.

## 1. Warm ground, not tech black

`#16130f` is urushi lacquer: a brown-black with red in it. The usual near-black is
blue-toned (`#0a0a0f` and relatives), and a hot accent on a cold ground reads as a
signal light — a warning LED. Vermillion on a warm ground reads as pigment on
lacquer, which is what it actually is.

The accent stayed `#d33a26`, lifted a fraction for legibility on dark but still an
earth red. It was never allowed to become `#ff2233`.

## 2. Dark page, lit plates

The reason for going light in the first place was that black backgrounds swallow
Japanese booster displays — they are already saturated red, gold and blue.

So the page is dark and the photographs are not. Every product sits on a light plate
(`#e7e3db`) inset into the ground with a hairline and a deep soft shadow, the way an
object sits under gallery lighting. The client gets the dark site; the product keeps
the light background it needs. The plates are the only bright surfaces on the page,
which makes them the thing your eye goes to.

Text stays warm bone (`#ece7dd`) rather than pure white — white on near-black is
harsh and is part of what makes the default look cheap.

# Interactivity, earned

Three additions. Each does a job; none is an effect looking for a home.

**The loupe.** Hold over any plate and it magnifies the point under your pointer at
2.6×, drawn from the original photograph. On touch, press and drag.

This is the piece I care about. "Verify the seal yourself" is the entire proposition,
and a static thumbnail cannot support it — you are asking someone to spend £119 on
the strength of a photograph they cannot examine. A collector inspecting a sealed box
in person reaches for a loupe. This is that gesture, and it turns the brand claim into
something the visitor does rather than something they read. The old holofoil tilt was
a trick with no argument behind it; this is the opposite.

**The vault readout.** A live line in the masthead — lots held, units on the shelf —
read from the same `stock.json` the catalogue counts use, so the two can never
disagree. Technical texture that happens to be true.

**`/` to search.** Focuses the catalogue search from anywhere. Costs nothing, and
anyone who buys cards online several times a week will find it.

## Still absent

Everything on the original list, plus: no glow, no gradient washes, no uppercase
tracked labels, no scroll-triggered reveals, no parallax. The hanko still stamps once
on load and nothing else moves on its own.

---

# Third pass: the banned devices, reintroduced on different terms

The list of things I'd ruled out was a blunt instrument. None of those devices is bad
in itself — they went on the list because both this site and EB Web Services were
reaching for them in exactly the same way. The fix is not abstinence, it's giving each
one a different job. The reference site is now used as a map of where *not* to put
them.

| Device | On the reference site | Here |
|---|---|---|
| **Marquee** | Horizontal strip of tech-stack words looping past you. Decorative, ambient, no information. | The arrival ledger. Same horizontal-strip DNA, opposite job: finite, factual, and it only moves when the visitor moves it — drag, wheel, arrow keys or buttons. |
| **Numbered markers** | `01 02 03 04` set large in grey, labelling four capability blocks that aren't a sequence. Also numbered nav items and section eyebrows. | Auction lot numbers. Small, tabular, vermillion, sitting in the metadata line — a real reference a trade customer quotes back on the phone. |
| **Glow** | — | The plates are lit surfaces, so light bounces off them onto the ground around. The halo is plate-cream, not accent-coloured. Light behaves like light. |
| **Gradient wash** | Overlay gradients over hero imagery. | One vertical falloff across the entire page ground, under 3% luminance end to end, as if a single lamp hangs above the room. No coloured blob anywhere. |
| **Uppercase tracked labels** | Eyebrows above section headings. | Never above a heading. Set vertically up the edge of a plate, the way a reference is stencilled on the side of a shipping crate. |
| **Scroll reveal** | Elements fade up in sequence as you scroll. | Nothing fades in. One rail fills across the chain of custody in proportion to how far the section has travelled, and each marker latches as it's passed. Progress, not entrance — and it works because the content genuinely is a journey. |
| **Parallax** | Background moving slower than foreground on scroll. | Inside the ledger only. Photographs pan against their frames as the strip is dragged, so depth comes from the input the visitor is already giving rather than from page scroll. |

## The rule I'm working to

A device earns its place when it is doing a job the content actually has. The loupe
exists because people need to inspect seals. The lot numbers exist because trade
customers need something to quote. The ledger scrolls sideways because there are more
consignments than fit, and it doesn't autoplay because nobody needs to be shown a
consignment they didn't ask for.

When the same devices are applied without that test, two unrelated businesses end up
with the same website — which is exactly what happened.

---

# Fourth pass: the brand mark, and the opening

The logo arrived and it changed the palette. That hexagon is `#e8402a` on true
black — brighter and more graphic than the lacquer red I'd been using, so the
ground went from warm brown-black to `#0a0a0c` and the accent went to the logo's
own red. The brand should set the palette, not the other way round.

## The hexagon is now structural

It appears as: the masthead mark, the arrival seal (封印, carved white), the chain
markers, the index bullets, the loupe aperture, and the cursor.

It is deliberately **not** used to mask product photographs. Clipping the corners
off a box someone is about to spend £215 on is design getting in front of the sale.
The plates stay rectangular; the geometry lives in everything around them.

## The opening

Two black panels part vertically around the mark, which draws in, counts to 100,
then leaves through the gap it opened. The hero headline arrives line by line from
behind its own edge as the curtain clears.

Two rules on it, both non-negotiable:

- **Once per visit**, stored client-side. A returning customer who sits through a
  curtain on every page load does not feel special, they feel delayed.
- **Escape skips it**, and reduced-motion never sees it. An animation you cannot
  get out of is an obstacle wearing a costume.

## The cursor

A hexagon that follows with a little lag, so it reads as weighted rather than
glued on. Over a plate it says INSPECT — the one verb this entire business turns
on — over a lot it says VIEW LOT, over a consignment it says CONSIGNMENT. It is
pointer-devices-only and reduced-motion drops it; touch keeps the native cursor
and loses nothing, because every affordance it names is also visible in the layout.

## Reveals, in a different direction

Nothing fades up from below — that is the tell. Content is uncovered by a
`clip-path` wipe travelling the way the eye already is, which reads as a shutter
opening rather than a card floating in. Headlines come line by line from behind
their own edge. The hero does not wait for a scroll it will never get; it waits
for the curtain.

## Product renders

Rebuilt from the real Mega Era lineup — 30th Celebration (M6a), Mega Brave (M1L),
Mega Symphonia (M1S), Munikisu Zero (M3), Ninja Spinner (M4), Abyss Eye (M5), plus
Scarlet and Violet ex. Each render carries its own four-colour palette taken from
the actual box art, drawn as a real display: open lid behind, two rows of packs in
the tray. Nine sets now read as nine sets rather than nine grey rectangles.

They remain placeholders. Omar's arrival photographs replace them, and the loupe
is only as good as what it magnifies — shoot at 2000px on the long edge with the
seal in focus, or magnifying will show mush and undermine the exact claim it exists
to prove.

---

# Fifth pass: the bug, the type, the mechanism, the speed

## What went wrong

The opening sequence shipped two black panels in the HTML, waiting for JavaScript
to move them. Any failure — a script error, a blocked file, a slow parse — and the
page was buried under its own curtain. That is a bad pattern and it was my mistake.

Everything that hides content is now gated on a `js` class set by one inline line in
the head, and the curtain is built in JavaScript rather than shipped in markup. No
script means no curtain, no clipped reveals, just the page. There is also a 6-second
failsafe that opens the doors regardless.

## Type

The old pairing fell back to Georgia when the webfont failed, which is why it read as
plain. Replaced with **Shippori Mincho B1 at 800** for display — heavy Mincho with
high stroke contrast is precisely how Japanese anime title cards and Pokémon set logos
are set, so it reads as the genre rather than as a Western serif. **Yuji Syuku**, a
brush face, carries the Japanese accents and the 封印 seal. **Zen Kaku Gothic New**
stays for interface and body.

## Japanese pattern work

- **Asanoha 麻の葉** behind the provenance section. The hemp-leaf pattern is built from
  hexagons, which makes it the right texture for this brand rather than merely a nice
  one — it is the logo mark repeated to infinity.
- **Concentration lines 集中線** radiating behind the hero product. Straight out of
  manga: strokes that throw all attention at whatever is at the centre. Used once.
  Twice would be noise.
- **Seigaiha 青海波** wave crests as the divider into the trade block.

## The hero: scanner, not loupe

The loupe magnifies a photograph. That is the right tool on a product page, where
there is real photography to magnify, and it stays there.

It is the wrong tool on a homepage, where the job is to show a stranger in four
seconds what "we check every box" means. So the hero now runs a **verification scan**:
drag the line down the display and the record writes itself onto the box as the scan
passes — outer seal intact, shrink film unbroken, carton CN-2608, landed 26 Aug 2026.
It plays once by itself so the idea lands unprompted, then hands over. Arrow keys work.

## The opening, rebuilt

No percentage counter. A vault mechanism: two hexagonal rings counter-rotate, four
lugs drive home, the core locks, 開錠 appears and the doors part.

**Not Lottie.** Lottie is roughly 250KB of JavaScript to play what this does in about
3KB of inline SVG and CSS, on a site whose entire pitch is speed. If Omar later wants
something a motion designer has authored frame by frame, that is the moment to pay the
250KB — not before.

## Speed

| | Before | After |
|---|---|---|
| CSS | 41.5kB | 28.9kB minified, **6.2kB brotli** |
| JS | 29.2kB | 16.0kB minified, **5.0kB brotli** |
| Homepage HTML | — | **5.4kB brotli** |
| **Critical path** | — | **18kB** total |

- esbuild minifies CSS and JS at build time.
- Both filenames now carry a content hash, so `netlify.toml` caches them
  `immutable` for a year. A changed file is a changed URL; a stale copy is impossible.
- HTML whitespace collapsed between tags only — never inside attributes or text, so
  nothing can be silently mangled for the sake of a few hundred bytes.
- `background-attachment: fixed` removed. It forces a full repaint on every scroll
  frame and is one of the most reliable ways to make a mobile page feel cheap.

---

# Sixth pass: three corrections

## Intro timing was wrong

The lock landed at 1.7s and 開錠 finished arriving at 2.9s, but the whole thing
finished at 2.35s — so the word was wiped off screen a few frames after it appeared.
The panels also carried a 2.15s transition delay, which stacked on top and made the
sequencing impossible to reason about.

Now: mechanism runs to 2.2s, 開錠 arrives at 2.05s, the wordmark at 2.3s, everything
**holds for a full second**, and the doors part at 3.9s with a 0.42s delay. Total
around 5 seconds, once per visit.

Because it is longer, there is now a visible **SKIP** button bottom-right as well as
Escape. Any animation over about three seconds needs a way out that does not require
guessing at a keyboard shortcut.

## The scanner needed asking, not hinting

A small line of text at the bottom of the plate is not an invitation, and an
interaction nobody notices is the same as no interaction.

There is now a **hexagonal grip** sitting on the scan line with a pulsing ring, and a
**DRAG TO VERIFY** label pinned beside it. Both stay until the visitor actually grabs
it, and only then get out of the way.

The autoplay also changed. It used to sweep down and stop at the bottom with every
row lit, which answered the question before anyone had a chance to ask it. It now
demonstrates, pauses, and **returns to the top with the rows unlit** — so what the
visitor sees is a tool that has shown them what it does and is waiting.

The corner label no longer repeats the instruction. It carries the record instead:
`Arrival record · CN-2608 · 26 Aug 2026`.

## Fonts

Moved from Bunny to Google Fonts directly:

```
Shippori Mincho B1  400 / 700 / 800   display
Yuji Syuku          400               Japanese accents, 封印, 開錠
Zen Kaku Gothic New 400 / 500 / 700   interface and body
```

`preconnect` to both `fonts.googleapis.com` and `fonts.gstatic.com` — the second one
matters, because that is where the font files actually come from and without it the
browser pays a fresh DNS and TLS handshake at exactly the wrong moment. CSP in
`netlify.toml` updated to match.

The fallback stack now runs through Hiragino Mincho, Yu Mincho and Noto Serif JP
before it reaches anything generic, so a blocked request degrades to something still
Japanese rather than to Times New Roman.

---

# Seventh pass: fonts fixed for good, and interaction variety

## Fonts are now self-hosted

Google Fonts never reliably loaded — a CSP, a blocked request, a sandboxed preview,
and the whole page fell back to Times. Chasing that with `preconnect` tweaks was
treating a symptom.

The families now ship with the site. Pulled from npm via Fontsource and subset with
fonttools to the 85 Japanese characters the project actually uses:

| | Before | After |
|---|---|---|
| Yuji Syuku (Japanese) | 3,506 kB | **32 kB** |
| Shippori Mincho B1 (Japanese) | 1,945 kB | **21 kB** |
| Zen Kaku Gothic New (Japanese) | ~1,700 kB | **11 kB** |
| Latin cuts, five weights | — | 90 kB total |

Latin and Japanese split by `unicode-range`, so an English-speaking visitor never
downloads a kanji they will not see. The two faces above the fold are preloaded,
everything is cached `immutable`, and there is now **no third-party font request at
all** — which also removes Google as a processor from the privacy policy, and that
matters for section 8 of the brief.

## Variety, not one gesture repeated

Four sections that all reveal on scroll is one idea used four times. Each section now
asks for something different:

| Section | Gesture |
|---|---|
| Hero | Drag the scan line down the display |
| Route | Pick a stop — click or arrow keys |
| Arrival ledger | Drag the strip sideways |
| Categories | Point at a row and it previews the lot |
| Catalogue | Hover — and the only place the labelled cursor appears |
| Product page | Hold over the photograph to magnify |

## "How a box reaches you" rebuilt

It was four paragraphs in boxes with a line that filled on scroll: small grey type,
nothing to do, nothing to read comfortably.

It is now a **route**. A flight path from Tokyo to Manchester with four waypoints;
pick one and the plane flies to it, the panel changes, and the manifest beside it
rewrites — origin, hands on the carton, elapsed days, seal state, what evidence
exists at that point. Body copy went from 0.875rem grey to 1.06rem at proper
contrast. It walks itself through the first three stops when it first comes into
view, then stops and waits.

Built as a real `tablist`: arrow keys move between stops and a screen reader
announces it as the set of related panels it is.

## The cursor pulled back

It was labelling plates, ledger records and lots — everywhere, which made it
wallpaper. It now appears on catalogue items only, where "View lot" is genuinely
telling you something. Everywhere else the native cursor does its job.

## Intro, slower again

The mechanism now runs to 2.9s, the core locks at 2.5s, 開錠 finishes arriving at
4s and the doors do not move until **5.2s** — well over a second of the wordmark
sitting still by itself. That is long for an intro, which is exactly why it runs
once per visit and why SKIP is on screen from the first second.

## Legibility sweep

Tertiary text lifted from `#6f6f78` to `#86868f`, body copy in section intros, lot
listings, arrival records and the argument block all moved up a step in size and
contrast. Grey-on-black at 0.875rem looks refined in a mockup and is hard work on
a real screen.
