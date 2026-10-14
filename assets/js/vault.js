/* ============================================================
   S&A TCG VAULT — site script
   Vanilla, no dependencies, ~7KB. Deferred, never blocks render.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- storage shim ----------------------------------
     Uses localStorage where available; silently degrades to an
     in-memory store in private mode or sandboxed previews. */
  var mem = {};
  var store = {
    get: function (k) {
      try { return window.localStorage.getItem(k); } catch (e) { return mem[k] || null; }
    },
    set: function (k, v) {
      try { window.localStorage.setItem(k, v); } catch (e) { mem[k] = v; }
    }
  };

  var CART_KEY = "satv.cart.v1";
  var CONSENT_KEY = "satv.consent.v1";

  /* ---------- helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function gbp(pence) { return "£" + (pence / 100).toFixed(2); }

  function toast(msg) {
    var t = $("#toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg;
    t.setAttribute("data-show", "true");
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.setAttribute("data-show", "false"); }, 2600);
  }

  /* ---------- cart ---------- */
  var Cart = {
    read: function () {
      try { return JSON.parse(store.get(CART_KEY)) || []; } catch (e) { return []; }
    },
    write: function (items) {
      store.set(CART_KEY, JSON.stringify(items));
      Cart.paint();
      document.dispatchEvent(new CustomEvent("cart:change", { detail: items }));
    },
    add: function (item) {
      var items = Cart.read();
      var hit = null;
      for (var i = 0; i < items.length; i++) { if (items[i].sku === item.sku) { hit = items[i]; break; } }
      if (hit) { hit.qty = Math.min(hit.qty + item.qty, item.max || 99); }
      else { items.push(item); }
      Cart.write(items);
      toast(item.name + " added to bag");
    },
    setQty: function (sku, qty) {
      var items = Cart.read().map(function (i) { if (i.sku === sku) { i.qty = qty; } return i; })
        .filter(function (i) { return i.qty > 0; });
      Cart.write(items);
    },
    remove: function (sku) {
      Cart.write(Cart.read().filter(function (i) { return i.sku !== sku; }));
    },
    count: function () {
      return Cart.read().reduce(function (n, i) { return n + i.qty; }, 0);
    },
    subtotal: function () {
      return Cart.read().reduce(function (n, i) { return n + i.qty * i.price; }, 0);
    },
    paint: function () {
      var n = Cart.count();
      $$("[data-cart-count]").forEach(function (el) {
        el.textContent = n;
        el.setAttribute("data-empty", n === 0 ? "true" : "false");
      });
    }
  };
  window.VaultCart = Cart;

  /* ---------- mega-menu (Shop panel) --------------------------
     Desktop: opens on hover and on click/focus (keyboard-safe).
     Mobile: the trigger toggles an in-flow accordion. */
  function initMegaMenu() {
    var shop = $(".nav__shop");
    if (!shop) return;
    var trigger = $(".nav__trigger", shop);
    var isDesktop = function () { return window.matchMedia("(min-width: 901px) and (hover: hover)").matches; };

    function open() { shop.setAttribute("data-open", "true"); trigger.setAttribute("aria-expanded", "true"); }
    function close() { shop.setAttribute("data-open", "false"); trigger.setAttribute("aria-expanded", "false"); }
    function toggle() { shop.getAttribute("data-open") === "true" ? close() : open(); }

    trigger.addEventListener("click", function (e) { e.preventDefault(); toggle(); });

    // Desktop hover, with a close delay so a brief cursor slip off the panel
    // doesn't snap it shut before you reach an option.
    var closeTimer = null;
    function cancelClose() { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } }
    function delayedClose() { cancelClose(); closeTimer = setTimeout(close, 280); }
    shop.addEventListener("mouseenter", function () { if (isDesktop()) { cancelClose(); open(); } });
    shop.addEventListener("mouseleave", function () { if (isDesktop()) delayedClose(); });

    // Close on outside click / Escape
    document.addEventListener("click", function (e) { if (!shop.contains(e.target)) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

    // A link click closes the panel (so the shop page shows cleanly)
    $$(".mega a", shop).forEach(function (a) {
      a.addEventListener("click", function () { close(); closeNav(); });
    });

    // Mobile: "Back to menu" closes the shop layer but keeps the nav open
    var back = $("#mega-back");
    if (back) back.addEventListener("click", function (e) { e.preventDefault(); close(); });
  }

  // Close the main nav overlay (used when a shop link is tapped on mobile)
  function closeNav() {
    var nav = $("#nav"), burger = $("#burger");
    if (nav) nav.setAttribute("data-open", "false");
    if (burger) burger.setAttribute("aria-expanded", "false");
    document.body.classList.remove("nav-locked");
  }

  /* ---------- nav ---------- */
  function initNav() {
    var b = $("#burger"), nav = $("#nav");
    if (!b || !nav) return;
    b.addEventListener("click", function () {
      var open = nav.getAttribute("data-open") === "true";
      nav.setAttribute("data-open", String(!open));
      b.setAttribute("aria-expanded", String(!open));
      document.body.classList.toggle("nav-locked", !open);
      // closing the burger also closes the shop layer if it was open
      if (open) {
        var shop = $(".nav__shop");
        if (shop) shop.setAttribute("data-open", "false");
      }
    });
  }

  /* ---------- cookie consent ----------------------------------
     No non-essential script is loaded until consent is granted.
     Analytics hook lives in window.VaultConsent.onGrant. */
  function initConsent() {
    var bar = $("#consent");
    if (!bar) return;
    var saved = store.get(CONSENT_KEY);
    // Once a choice (or dismissal) is stored, the banner never shows again.
    if (saved) { if (saved === "all") grant(); return; }

    setTimeout(function () { bar.setAttribute("data-show", "true"); }, 600);

    function decide(value) {
      store.set(CONSENT_KEY, value);
      bar.setAttribute("data-show", "false");
      if (value === "all") grant();
    }
    function grant() {
      document.dispatchEvent(new CustomEvent("consent:granted"));
      if (typeof window.loadAnalytics === "function") window.loadAnalytics();
    }
    var a = $("#consent-all"), e = $("#consent-essential"), x = $("#consent-dismiss");
    if (a) a.addEventListener("click", function () { decide("all"); });
    if (e) e.addEventListener("click", function () { decide("essential"); });
    // Dismiss = essential only, remembered, never shown again
    if (x) x.addEventListener("click", function () { decide("essential"); });
  }

  /* ---------- product detail ---------- */
  function initPDP() {
    var form = $("#pdp-form");
    if (!form) return;

    var thumbs = $$("#thumbs button"), main = $("#shot");
    thumbs.forEach(function (btn) {
      btn.addEventListener("click", function () {
        thumbs.forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
        btn.setAttribute("aria-pressed", "true");
        var img = $("img", btn);
        if (main && img) { main.src = img.src; main.alt = img.alt; }
      });
    });

    var input = $("#qty");
    $$("[data-step]", form).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var next = parseInt(input.value, 10) + parseInt(btn.getAttribute("data-step"), 10);
        input.value = Math.max(1, Math.min(next, parseInt(input.max, 10) || 99));
      });
    });

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var d = form.dataset;
      Cart.add({
        sku: d.sku,
        name: d.name,
        price: parseInt(d.price, 10),
        image: d.image,
        url: d.url,
        max: parseInt(d.stock, 10) || 99,
        qty: parseInt(input.value, 10) || 1
      });
    });
  }

  /* ---------- shop filters ---------- */
  function initShop() {
    var root = $("#shop-grid");
    if (!root) return;
    /* Give each card its true plate height so the hover scan bar
       travels the full photo rather than a guessed distance. */
    $$(".card__plate", root).forEach(function (pl) {
      var set = function () { pl.style.setProperty("--plate-h", pl.offsetHeight + "px"); };
      set();
      if (pl.querySelector("img")) pl.querySelector("img").addEventListener("load", set);
    });
    var cards = $$("[data-product]", root);
    var q = $("#q"), sort = $("#sort"), out = $("#result-count");
    var chips = $$(".chip");
    var active = new Set();   // type/category filters
    var activeEra = null;      // single active era (null = all)
    var eraLabel = $("#era-active");

    function apply() {
      var term = (q && q.value || "").toLowerCase().trim();
      var shown = 0;
      cards.forEach(function (c) {
        var hay = c.getAttribute("data-search");
        var cat = c.getAttribute("data-category");
        var era = c.getAttribute("data-era");
        var matchText = !term || hay.indexOf(term) > -1;
        var matchCat = active.size === 0 || active.has(cat);
        var matchEra = !activeEra || era === activeEra;
        var ok = matchText && matchCat && matchEra;
        c.classList.toggle("hidden", !ok);
        if (ok) shown++;
      });
      if (out) out.textContent = shown + (shown === 1 ? " product" : " products");

      if (sort && sort.value !== "default") {
        var vis = cards.slice().sort(function (a, b) {
          var pa = +a.getAttribute("data-price"), pb = +b.getAttribute("data-price");
          if (sort.value === "low") return pa - pb;
          if (sort.value === "high") return pb - pa;
          return a.getAttribute("data-name").localeCompare(b.getAttribute("data-name"));
        });
        vis.forEach(function (c) { root.appendChild(c); });
      }
    }

    // Era selection (from the mega-menu or the era filter row)
    function selectEra(slug, name) {
      activeEra = slug || null;
      $$("[data-era-filter]").forEach(function (el) {
        el.setAttribute("aria-pressed", String(el.getAttribute("data-era-filter") === slug));
      });
      if (eraLabel) {
        eraLabel.textContent = slug ? name : "";
        eraLabel.classList.toggle("hidden", !slug);
      }
      apply();
    }
    window.VaultSelectEra = selectEra;

    $$("[data-era-filter]").forEach(function (el) {
      el.addEventListener("click", function (ev) {
        ev.preventDefault();
        var slug = el.getAttribute("data-era-filter");
        // toggle off if already active
        if (slug === activeEra) selectEra(null, "");
        else selectEra(slug, el.textContent.trim());
      });
    });
    var clearEra = $("#era-clear");
    if (clearEra) clearEra.addEventListener("click", function () { selectEra(null, ""); var es=$("#era-select"); if(es) es.value=""; });

    // Era dropdown on the shop page
    var eraSelect = $("#era-select");
    if (eraSelect) eraSelect.addEventListener("change", function () {
      var opt = eraSelect.options[eraSelect.selectedIndex];
      selectEra(eraSelect.value || null, eraSelect.value ? opt.text : "");
    });

    if (q) q.addEventListener("input", apply);
    if (sort) sort.addEventListener("change", apply);
    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        var v = chip.getAttribute("data-filter");
        var on = chip.getAttribute("aria-pressed") === "true";
        chip.setAttribute("aria-pressed", String(!on));
        if (on) active.delete(v); else active.add(v);
        apply();
      });
    });

    // Deep links: /shop.html?c=booster-box and /shop.html?q=M6
    var params = new URLSearchParams(location.search);
    var term = params.get("q");
    if (term && q) { q.value = term; }
    var pre = params.get("c");
    if (pre) {
      var target = chips.filter(function (c) { return c.getAttribute("data-filter") === pre; })[0];
      if (target) target.click();
    }
    var preEra = params.get("era");
    if (preEra) {
      var es = $("#era-select");
      if (es) es.value = preEra;
      var label = es && es.value ? es.options[es.selectedIndex].text : preEra;
      selectEra(preEra, label);
    }
    apply();
  }

  /* ---------- cart page ---------- */
  function initCartPage() {
    var host = $("#cart-lines");
    if (!host) return;

    function render() {
      var items = Cart.read();
      if (!items.length) {
        host.innerHTML = '<div style="border-top:2px solid var(--sumi);padding-top:1.5rem"><h3>Your bag is empty</h3><p class="muted">Nothing reserved yet.</p><p style="margin-top:1.25rem"><a class="btn" href="/shop.html">See the catalogue</a></p></div>';
        $("#cart-summary").classList.add("hidden");
        return;
      }
      $("#cart-summary").classList.remove("hidden");
      host.innerHTML = items.map(function (i) {
        return '<div class="line" data-sku="' + i.sku + '">' +
          '<img src="' + i.image + '" alt="" width="84" height="84" loading="lazy">' +
          '<div><h3><a href="' + i.url + '" style="text-decoration:none">' + i.name + '</a></h3>' +
          '<p class="meta" style="margin:0">' + i.sku + ' · ' + gbp(i.price) + ' each</p>' +
          '<div class="qty" style="margin-top:.5rem"><button type="button" data-d="-1" aria-label="Decrease quantity">−</button>' +
          '<input type="text" inputmode="numeric" value="' + i.qty + '" aria-label="Quantity" readonly>' +
          '<button type="button" data-d="1" aria-label="Increase quantity">+</button></div></div>' +
          '<div style="text-align:right"><div class="price">' + gbp(i.price * i.qty) + '</div>' +
          '<button type="button" class="chip" data-remove style="margin-top:.5rem">Remove</button></div></div>';
      }).join("");

      var sub = Cart.subtotal();
      var ship = sub >= 5000 || sub === 0 ? 0 : 399;
      $("#sum-sub").textContent = gbp(sub);
      $("#sum-ship").textContent = ship === 0 ? "Free" : gbp(ship);
      $("#sum-total").textContent = gbp(sub + ship);
      var bnpl = $("#bnpl-msg");
      if (bnpl) {
        bnpl.textContent = sub >= 3000
          ? "Klarna and Clearpay appear at checkout where the order qualifies, subject to their own approval."
          : "";
      }
    }

    host.addEventListener("click", function (ev) {
      var line = ev.target.closest("[data-sku]");
      if (!line) return;
      var sku = line.getAttribute("data-sku");
      if (ev.target.hasAttribute("data-remove")) { Cart.remove(sku); render(); return; }
      var d = ev.target.getAttribute("data-d");
      if (d) {
        var cur = Cart.read().filter(function (i) { return i.sku === sku; })[0];
        if (cur) { Cart.setQty(sku, Math.max(0, cur.qty + parseInt(d, 10))); render(); }
      }
    });

    /* Checkout hand-off. The browser never sees a price it can change:
       we send SKU + qty only, and the function re-prices server-side. */
    var go = $("#checkout");

    /* Reset the checkout button whenever the page is shown — including when
       restored from the back-forward cache after cancelling on Stripe. The
       bfcache preserves the disabled "Opening..." state otherwise, leaving a
       dead button. persisted === true means we came back via bfcache. */
    function resetCheckout() {
      if (go) { go.disabled = false; go.textContent = "Checkout"; }
    }
    window.addEventListener("pageshow", function (e) {
      if (e.persisted) { resetCheckout(); render(); }
    });

    if (go) go.addEventListener("click", function () {
      var items = Cart.read().map(function (i) { return { sku: i.sku, qty: i.qty }; });
      if (!items.length) return;
      go.disabled = true;
      go.textContent = "Opening secure checkout…";
      fetch("/.netlify/functions/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: items })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data && data.url) { window.location.href = data.url; }
          else { throw new Error(data && data.error || "No session returned"); }
        })
        .catch(function (err) {
          go.disabled = false;
          go.textContent = "Checkout";
          toast("Checkout is unavailable right now. " + (err.message || ""));
        });
    });

    render();
  }

  /* ---------- loupe ------------------------------------------
     A real inspection tool, not an effect. "Verify the seal
     yourself" is the whole proposition, and a static thumbnail
     cannot support it. Hold over any lit plate and it magnifies
     the point under the pointer; drag to inspect on touch. */
  function initLoupe() {
    $$("[data-loupe-plate]").forEach(function (plate) {
      var img = $("img", plate);
      if (!img) return;

      var lens = document.createElement("div");
      lens.className = "loupe";
      lens.setAttribute("aria-hidden", "true");
      plate.appendChild(lens);

      var ZOOM = 2.6, SIZE = 190, box = null;

      function measure() { box = plate.getBoundingClientRect(); }

      function paint(clientX, clientY) {
        if (!box) measure();
        var x = clientX - box.left;
        var y = clientY - box.top;
        if (x < 0 || y < 0 || x > box.width || y > box.height) { return hide(); }

        plate.setAttribute("data-loupe", "on");
        lens.style.backgroundImage = "url('" + img.currentSrc + "')";
        lens.style.backgroundSize = (box.width * ZOOM) + "px " + (box.height * ZOOM) + "px";
        lens.style.backgroundPosition =
          (-x * ZOOM + SIZE / 2) + "px " + (-y * ZOOM + SIZE / 2) + "px";
        lens.style.left = (x - SIZE / 2) + "px";
        lens.style.top = (y - SIZE / 2) + "px";
      }

      function hide() { plate.setAttribute("data-loupe", "off"); }

      plate.addEventListener("pointerenter", measure);
      plate.addEventListener("pointermove", function (ev) {
        if (ev.pointerType === "touch") return;
        paint(ev.clientX, ev.clientY);
      });
      plate.addEventListener("pointerleave", hide);

      // Touch: press and drag to inspect, rather than hijacking a tap.
      plate.addEventListener("touchstart", function (ev) {
        measure();
        paint(ev.touches[0].clientX, ev.touches[0].clientY);
      }, { passive: true });
      plate.addEventListener("touchmove", function (ev) {
        paint(ev.touches[0].clientX, ev.touches[0].clientY);
      }, { passive: true });
      plate.addEventListener("touchend", hide);

      window.addEventListener("resize", measure, { passive: true });
      window.addEventListener("scroll", function () { box = null; }, { passive: true });
    });
  }

  /* ---------- opening sequence -------------------------------
     Built here rather than in the HTML. The previous version shipped
     two black panels in the markup, so any script failure left them
     sitting over the page — which is exactly what went wrong. Now no
     script means no curtain, and the page is simply there.

     SVG and CSS rather than Lottie: Lottie is roughly 250KB of
     JavaScript to play what this does in about 3KB, and this site is
     being sold on speed. */
  function initIntro() {
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || store.get("satv.intro.v2")) return;
    store.set("satv.intro.v2", String(Date.now()));

    var intro = document.createElement("div");
    intro.className = "intro";
    intro.id = "intro";
    intro.setAttribute("aria-hidden", "true");
    intro.innerHTML =
      '<div class="intro__panel intro__panel--t"></div>' +
      '<div class="intro__panel intro__panel--b"></div>' +
      '<div class="intro__core">' +
        '<svg class="mech" viewBox="0 0 200 200" aria-hidden="true">' +
          '<g class="mech__ring" fill="none" stroke="#3a3a42" stroke-width="2">' +
            '<polygon points="100,14 174,57 174,143 100,186 26,143 26,57"/>' +
            '<polygon points="100,30 160,65 160,135 100,170 40,135 40,65" stroke="#26262b"/>' +
          '</g>' +
          '<g class="mech__ring mech__ring--b" fill="none" stroke="#4a4a54" stroke-width="1.5">' +
            '<polygon points="100,44 152,74 152,126 100,156 48,126 48,74" stroke-dasharray="5 9"/>' +
          '</g>' +
          '<g class="mech__lug" fill="#e8402a">' +
            '<rect x="95" y="8" width="10" height="18" rx="1"/>' +
            '<rect x="95" y="174" width="10" height="18" rx="1"/>' +
            '<rect x="14" y="86" width="18" height="10" rx="1" transform="rotate(-30 23 91)"/>' +
            '<rect x="168" y="104" width="18" height="10" rx="1" transform="rotate(-30 177 109)"/>' +
          '</g>' +
          '<g class="mech__sweep">' +
            '<path d="M100 100 L100 40" stroke="#e8402a" stroke-width="1.5" opacity=".5" stroke-linecap="round"/>' +
          '</g>' +
          '<g class="mech__core">' +
            '<polygon points="100,72 124,86 124,114 100,128 76,114 76,86" fill="#e8402a"/>' +
          '</g>' +
        '</svg>' +
        '<p class="intro__word">開錠</p>' +
        '<p class="intro__sub">S&amp;A TCG VAULT</p>' +
      '</div>' +
      '<button class="intro__skip" type="button">SKIP</button>';

    document.body.appendChild(intro);
    document.body.setAttribute("data-intro", "running");

    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      intro.setAttribute("data-open", "true");
      document.body.removeAttribute("data-intro");
      setTimeout(function () { intro.remove(); }, 3200);
    }

    /* 3.9s, not 2.35s. The lock lands at 1.7s and 開錠 finishes
       arriving at 4s. The doors now wait until 5.2s, which gives the
       wordmark well over a second on screen by itself before anything
       moves. Long for an intro, which is exactly why it runs once per
       visit and why SKIP is visible from the first second. */
    var timer = setTimeout(finish, 5200);

    // Never trap anyone behind an animation: a visible button, plus Escape.
    var skip = $(".intro__skip", intro);
    if (skip) skip.addEventListener("click", function () { clearTimeout(timer); finish(); });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { clearTimeout(timer); finish(); }
    }, { once: true });

    // Belt and braces: if anything above stalls, open anyway.
    setTimeout(finish, 9500);
  }

  /* ---------- cursor ------------------------------------------
     Follows with a little lag so it feels weighted rather than
     glued on, and names the action under it. Pointer devices only;
     touch keeps the real cursor and loses nothing. */
  function initCursor() {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    /* The custom cursor only earns its place where there are labelled
       targets to name. On a page with none it is pure decoration — the
       "gimmick" feeling — so it is not created at all. */
    if (!$("[data-cursor]")) return;

    var dot = document.createElement("div");
    dot.className = "cursor";
    dot.setAttribute("aria-hidden", "true");
    dot.innerHTML = '<span class="cursor__label"></span>';
    document.body.appendChild(dot);
    document.documentElement.classList.add("has-cursor");

    var label = $(".cursor__label", dot);
    var tx = window.innerWidth / 2, ty = window.innerHeight / 2, cx = tx, cy = ty;

    document.addEventListener("pointermove", function (ev) { tx = ev.clientX; ty = ev.clientY; });

    (function loop() {
      cx += (tx - cx) * 0.18;
      cy += (ty - cy) * 0.18;
      dot.style.transform = "translate(" + cx.toFixed(1) + "px," + cy.toFixed(1) + "px)";
      requestAnimationFrame(loop);
    })();

    document.addEventListener("pointerover", function (ev) {
      var host = ev.target.closest("[data-cursor]");
      if (host) {
        label.textContent = host.getAttribute("data-cursor");
        dot.setAttribute("data-mode", "label");
      } else {
        label.textContent = "";
        dot.setAttribute("data-mode", "idle");
      }
    });
  }

  /* ---------- verification scanner ---------------------------
     The hero interaction. Drag the line down the display and the
     verification record writes itself onto the box as the scan
     passes: seal state, shrink film, carton, arrival date.

     It demonstrates itself once, then resets and asks. An interaction
     nobody realises is there is the same as no interaction, so the
     grip pulses and the label stays put until the visitor has
     actually grabbed it — and only then does it get out of the way. */
  function initScanner() {
    var scan = $("#scan");
    if (!scan) return;

    var host = scan.parentElement;
    var rows = $$(".scan__row", host);
    var y = 8, touched = false;

    function place(pct) {
      y = Math.max(4, Math.min(96, pct));
      host.style.setProperty("--y", y + "%");
      rows.forEach(function (row) {
        row.setAttribute("data-lit", String(y >= parseFloat(row.getAttribute("data-at"))));
      });
    }

    function touch() {
      if (touched) return;
      touched = true;
      scan.setAttribute("data-touched", "true");
    }

    function fromEvent(clientY) {
      var b = host.getBoundingClientRect();
      place(((clientY - b.top) / b.height) * 100);
    }

    var dragging = false;
    scan.addEventListener("pointerdown", function (ev) {
      dragging = true; touch();
      scan.setPointerCapture(ev.pointerId);
      fromEvent(ev.clientY);
    });
    scan.addEventListener("pointermove", function (ev) {
      if (dragging) { fromEvent(ev.clientY); return; }
      if (ev.pointerType === "mouse" && touched) fromEvent(ev.clientY);
    });
    scan.addEventListener("pointerup", function () { dragging = false; });
    scan.addEventListener("pointercancel", function () { dragging = false; });
    scan.addEventListener("click", touch);

    scan.setAttribute("tabindex", "0");
    scan.setAttribute("role", "slider");
    scan.setAttribute("aria-label", "Drag to run the verification scan down the display");
    scan.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown") { ev.preventDefault(); touch(); place(y + 8); }
      if (ev.key === "ArrowUp") { ev.preventDefault(); touch(); place(y - 8); }
    });
    scan.addEventListener("focus", touch);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      place(96); touch(); return;
    }

    /* Demonstrate, then reset and hand it over. Showing the result and
       leaving it there would answer the question before the visitor
       has had the chance to ask it themselves. */
    place(4);
    var delay = document.body.getAttribute("data-intro") === "running" ? 5900 : 900;
    setTimeout(function () {
      if (touched) return;
      var t0 = null;
      requestAnimationFrame(function down(now) {
        if (t0 === null) t0 = now;
        var k = Math.min((now - t0) / 1700, 1);
        place(4 + (1 - Math.pow(1 - k, 3)) * 92);
        if (k < 1 && !touched) requestAnimationFrame(down);
        else if (!touched) setTimeout(reset, 900);
      });
    }, delay);

    function reset() {
      if (touched) return;
      var t0 = null, from = y;
      requestAnimationFrame(function up(now) {
        if (t0 === null) t0 = now;
        var k = Math.min((now - t0) / 700, 1);
        place(from + (18 - from) * (1 - Math.pow(1 - k, 3)));
        if (k < 1 && !touched) requestAnimationFrame(up);
      });
    }
  }

  /* ---------- reveals -----------------------------------------
     One observer, one class, unobserved once fired. Content is
     never left hidden if the observer does not run. */
  function initReveals() {
    var targets = $$("[data-reveal]");
    if (!targets.length) return;

    if (!("IntersectionObserver" in window) ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      targets.forEach(function (el) { el.setAttribute("data-seen", "true"); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.setAttribute("data-seen", "true");
        io.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

    targets.forEach(function (el) { io.observe(el); });

    /* Failsafe: nothing that carries content may stay hidden. If the
       observer has not fired for an element within 1.2s (odd viewport,
       file:// quirks, a stalled load), reveal it outright. */
    setTimeout(function () {
      targets.forEach(function (el) {
        if (el.getAttribute("data-seen") !== "true") el.setAttribute("data-seen", "true");
      });
    }, 1200);
  }

  /* The hero is above the fold, so it should not wait for a scroll.
     It waits for the curtain instead, then arrives as one piece. */
  function initHeroLines() {
    var head = $("#hero-head");
    if (!head) return;
    var delay = document.body.getAttribute("data-intro") === "running" ? 2350 : 180;
    setTimeout(function () { head.setAttribute("data-seen", "true"); }, delay);
  }

  /* ---------- route -------------------------------------------
     Replaces the old scroll-filled chain. That was four paragraphs in
     boxes that happened to have a line above them; this is something
     you operate. Pick a stop and the plane flies to it, the panel
     changes, and the manifest on the right rewrites itself.

     Proper tablist semantics, so arrow keys work and a screen reader
     announces it as the set of related panels it actually is. */
  function initRoute() {
    var root = $("#route");
    if (!root) return;

    var stops = $$(".route__stop", root);
    var panels = $$(".route__detail", root);
    var flown = $("#route-flown");
    var path = $("#route-path");
    var plane = $("#route-plane");
    var facts = $("#route-facts");

    var FACTS = [
      { origin: "Licensed distributor, Tokyo", hands: "Supplier only", time: "Day 0", seal: "<em>Unbroken</em>", proof: "Supplier manifest" },
      { origin: "In the air", hands: "Carrier only", time: "Day 1–3", seal: "<em>Unbroken</em>", proof: "Airway bill" },
      { origin: "Manchester M2", hands: "Us", time: "Day 4", seal: "<em>Verified</em>", proof: "Arrival photographs" },
      { origin: "Your address", hands: "Courier", time: "Day 5", seal: "<em>Unbroken</em>", proof: "Packing photograph" }
    ];

    var len = path && path.getTotalLength ? path.getTotalLength() : 1000;
    if (flown) flown.style.setProperty("--len", len);

    function select(i, focus) {
      stops.forEach(function (b, n) {
        var on = n === i;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
      });
      panels.forEach(function (pane, n) { pane.hidden = n !== i; });

      var t = stops.length > 1 ? i / (stops.length - 1) : 1;
      if (flown) flown.style.setProperty("--progress", t.toFixed(3));

      if (plane && path && path.getPointAtLength) {
        /* Land exactly on the point, and take the heading from just
           BEHIND it — reading ahead breaks at the end of the path,
           where "ahead" clamps to the same point and the angle
           collapses. Behind always exists. */
        var here = Math.min(Math.max(len * t, 0), len);
        var at = path.getPointAtLength(here);
        var behind = path.getPointAtLength(Math.max(here - 8, 0));
        var deg = Math.atan2(at.y - behind.y, at.x - behind.x) * 180 / Math.PI + 90;
        plane.setAttribute("transform",
          "translate(" + at.x.toFixed(2) + "," + at.y.toFixed(2) + ") rotate(" + deg.toFixed(1) + ")");
      }

      if (facts) {
        var f = FACTS[i];
        /* Drop, rewrite, re-raise: the rows re-animate in on every
           selection, so the panel reads as live instrumentation
           rather than static text that happens to change. */
        facts.setAttribute("data-lit", "false");
        var ref = document.getElementById("route-ref");
        if (ref) ref.textContent = "LEG 0" + (i + 1) + " / 04";
        setTimeout(function () {
          Object.keys(f).forEach(function (k) {
            var cell = $('[data-fact="' + k + '"]', facts);
            if (cell) cell.innerHTML = f[k];
          });
          facts.setAttribute("data-lit", "true");
        }, 80);
      }
      if (focus) stops[i].focus();
    }

    stops.forEach(function (b, i) {
      b.addEventListener("click", function () { select(i); });
      b.addEventListener("keydown", function (ev) {
        if (ev.key === "ArrowRight") { ev.preventDefault(); select((i + 1) % stops.length, true); }
        if (ev.key === "ArrowLeft") { ev.preventDefault(); select((i - 1 + stops.length) % stops.length, true); }
      });
    });

    select(0);

    /* Walk it once, the first time it comes into view, so a visitor
       who never clicks still sees that it is four stops and not one. */
    if (!("IntersectionObserver" in window) ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var walked = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting || walked) return;
        walked = true;
        io.disconnect();
        var i = 0;
        var timer = setInterval(function () {
          i++;
          if (i > 2) { clearInterval(timer); select(0); return; }
          select(i);
        }, 900);
        root.addEventListener("click", function () { clearInterval(timer); }, { once: true });
      });
    }, { threshold: 0.35 });
    io.observe(root);
  }

  /* ---------- provenance verify tablist ---------------------
     Pick a verification step; the panel and its animated scene
     swap in. Real tablist semantics — arrow keys, screen-reader
     announced. Auto-advances once through the steps on first view
     so a visitor sees there are four, then hands over. */
  function initVerify() {
    var root = $("#verify");
    if (!root) return;
    var tabs = $$(".verify__tab", root);
    var panels = $$(".verify__panel", root);

    function select(i, focus) {
      tabs.forEach(function (t, n) {
        t.setAttribute("aria-selected", String(n === i));
        t.tabIndex = n === i ? 0 : -1;
      });
      panels.forEach(function (pane, n) { pane.hidden = n !== i; });
      if (focus) tabs[i].focus();
    }

    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { select(i); stop(); });
      t.addEventListener("keydown", function (ev) {
        if (ev.key === "ArrowRight" || ev.key === "ArrowDown") { ev.preventDefault(); select((i + 1) % tabs.length, true); stop(); }
        if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") { ev.preventDefault(); select((i - 1 + tabs.length) % tabs.length, true); stop(); }
      });
    });

    select(0);

    var timer = null, stopped = false;
    function stop() { stopped = true; if (timer) clearInterval(timer); }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting || stopped || timer) return;
          var i = 0;
          timer = setInterval(function () {
            if (stopped) return;
            i++;
            if (i >= tabs.length) { clearInterval(timer); timer = null; select(0); return; }
            select(i);
          }, 2600);
        });
      }, { threshold: 0.4 });
      io.observe(root);
    }
    root.addEventListener("pointerdown", stop, { once: true });
  }

  /* ---------- category preview --------------------------------
     The category list shows what it leads to. A different gesture
     again: no click, no drag, just the row you are pointing at. */
  function initPeek() {
    var index = $("#cat-index");
    if (!index) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    var img = $("#peek-img");
    var peek = $(".index__peek", index);
    if (!img || !peek) return;

    $$("a[data-peek]", index).forEach(function (row) {
      row.addEventListener("pointerenter", function () {
        img.src = row.getAttribute("data-peek");
        peek.style.top = (row.offsetTop - 44) + "px";
        index.setAttribute("data-peek", "true");
      });
    });
    index.addEventListener("pointerleave", function () { index.setAttribute("data-peek", "false"); });
  }

  /* ---------- arrival ledger --------------------------------
     A horizontal strip that only moves when the visitor moves it:
     drag, wheel, arrow keys or the two buttons. The photographs
     pan inside their frames as it travels, so depth comes from
     the input already being given rather than from page scroll. */
  function initLedger() {
    var strip = $("#ledger-strip");
    if (!strip) return;

    var rail = $("#ledger-seen");
    var prev = $("#ledger-prev");
    var next = $("#ledger-next");
    var records = $$(".record", strip);
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var frame = null;

    function step() {
      return records.length ? records[0].getBoundingClientRect().width : 300;
    }

    function paint() {
      frame = null;
      var max = strip.scrollWidth - strip.clientWidth;
      var t = max > 0 ? strip.scrollLeft / max : 0;

      if (rail) {
        var visible = strip.clientWidth / strip.scrollWidth;
        rail.style.width = Math.max(visible * 100, 8) + "%";
        rail.style.left = (t * (100 - Math.max(visible * 100, 8))) + "%";
      }
      if (prev) prev.disabled = strip.scrollLeft < 8;
      if (next) next.disabled = strip.scrollLeft > max - 8;

      if (reduce) return;
      // Pan each photograph against its frame by how far off-centre it sits.
      var mid = strip.clientWidth / 2;
      records.forEach(function (rec) {
        var b = rec.getBoundingClientRect();
        var s = strip.getBoundingClientRect();
        var offset = ((b.left + b.width / 2) - (s.left + mid)) / s.width;
        var img = $("img", rec);
        if (img) img.style.setProperty("--pan", (-8 + offset * -6).toFixed(2) + "%");
      });
    }

    function schedule() { if (!frame) frame = requestAnimationFrame(paint); }
    strip.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    if (prev) prev.addEventListener("click", function () { strip.scrollBy({ left: -step(), behavior: "smooth" }); });
    if (next) next.addEventListener("click", function () { strip.scrollBy({ left: step(), behavior: "smooth" }); });

    strip.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowRight") { ev.preventDefault(); strip.scrollBy({ left: step(), behavior: "smooth" }); }
      if (ev.key === "ArrowLeft") { ev.preventDefault(); strip.scrollBy({ left: -step(), behavior: "smooth" }); }
    });

    // Pointer drag, without stealing a click from anything inside.
    var down = false, startX = 0, startScroll = 0, moved = 0;
    strip.addEventListener("pointerdown", function (ev) {
      if (ev.pointerType === "touch") return; // native touch scrolling is better
      down = true; moved = 0;
      startX = ev.clientX; startScroll = strip.scrollLeft;
      strip.setAttribute("data-drag", "true");
    });
    strip.addEventListener("pointermove", function (ev) {
      if (!down) return;
      var dx = ev.clientX - startX;
      moved = Math.abs(dx);
      strip.scrollLeft = startScroll - dx;
    });
    function release() {
      if (!down) return;
      down = false;
      strip.removeAttribute("data-drag");
    }
    strip.addEventListener("pointerup", release);
    strip.addEventListener("pointerleave", release);
    strip.addEventListener("click", function (ev) { if (moved > 6) ev.preventDefault(); }, true);

    paint();
  }

  /* ---------- vault readout ---------------------------------
     Reads the same live endpoint the stock counts use, so the
     masthead figure and the catalogue can never disagree. */
  function initReadout() {
    var host = $("#readout");
    if (!host || !window.VAULT_STOCK_ENDPOINT) return;
    fetch(window.VAULT_STOCK_ENDPOINT, { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (map) {
        if (!map) return;
        var skus = Object.keys(map);
        var held = skus.filter(function (k) { return map[k] > 0; }).length;
        var units = skus.reduce(function (n, k) { return n + map[k]; }, 0);
        host.innerHTML =
          '<span class="readout__dot"></span>Vault: <b>' + held + '</b> lots held, <b>' +
          units + '</b> units on the shelf';
      })
      .catch(function () { host.remove(); });
  }

  /* ---------- catalogue keyboard shortcut ---------- */
  function initShortcut() {
    var q = $("#q");
    if (!q) return;
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "/" || ev.metaKey || ev.ctrlKey) return;
      var t = ev.target.tagName;
      if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
      ev.preventDefault();
      q.focus();
      q.select();
    });
  }

  /* ---------- live stock -----------------------------------
     Pages are static, so the stock number baked into the HTML
     can be minutes old. If a CMS endpoint is configured we
     refresh the numbers on load. Fails silently if not. */
  function initLiveStock() {
    var nodes = $$("[data-live-stock]");
    if (!nodes.length || !window.VAULT_STOCK_ENDPOINT) return;
    fetch(window.VAULT_STOCK_ENDPOINT, { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (map) {
        if (!map) return;
        nodes.forEach(function (el) {
          var sku = el.getAttribute("data-live-stock");
          if (!(sku in map)) return;
          var n = map[sku];
          el.textContent = n > 0 ? n + " in the vault" : "Sold out";
          el.setAttribute("data-level", n === 0 ? "none" : n <= 5 ? "low" : "ok");
          var form = $("#pdp-form");
          if (form && form.dataset.sku === sku) {
            var submit = $("button[type=submit]", form);
            if (n === 0 && submit) { submit.disabled = true; submit.textContent = "Sold out"; }
          }
        });
      })
      .catch(function () { /* static numbers stand */ });
  }

  /* ---------- boot ---------- */
  function boot() {
    initIntro();
    initCursor();
    initScanner();
    initReveals();
    initHeroLines();
    Cart.paint();
    initNav();
    initMegaMenu();
    initConsent();
    initPDP();
    initShop();
    initCartPage();
    initLiveStock();
    initLoupe();
    initReadout();
    initShortcut();
    initRoute();
    initPeek();
    initVerify();
    initLedger();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
})();
