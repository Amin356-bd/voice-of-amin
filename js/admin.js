/* ==========================================================================
   admin.js - /admin: Google Sign-In, ADMIN_EMAIL যাচাই, ড্যাশবোর্ড
   এখানকার সব যাচাই শুধু ব্যবহারকারীর সুবিধার জন্য; আসল নিরাপত্তা Firestore Rules-এ।
   ========================================================================== */
import { CATEGORIES, SITE_URL, LOGO_HARD_LIMIT_BYTES, IMAGE_TARGET_BYTES } from "./config.js";
import {
  $$, el, clear, toast, confirmDialog, downloadFile, readFileText, compressImage, formatBytes, toBn,
  fmtDateTime, zoneDateInput, zoneTimeInput, debounce
} from "./ui.js";
import { validateStoryInput, validateDraftInput, previewStory, normalizeCrop, validateSettingsInput, parseBackup, isHttpUrl, checkImageValue, dataUrlBytes } from "./model.js";
import { buildArticle, cropStyle } from "./article.js";

export async function mountAdmin(ctx) {
  const { root } = ctx;
  let destroyed = false;
  let unsubscribe = null;
  let redirectTimer = null;
  let fb = null;
  let user = null;
  let handling = false;
  let denied = false;
  let tab = "dashboard";
  let dirty = false;
  let editing = null;          // সম্পাদনাধীন গল্প (null = নতুন)
  let listState = null;        // গল্পের তালিকার অবস্থা

  const alive = () => !destroyed && ctx.isCurrent();
  const guard = (fn) => (...a) => (alive() ? fn(...a) : undefined);
  const say = (msg, type = "error") => toast(msg, type);
  const fail = (e, fallback) => {
    console.error("[VOA admin]", e);
    say(fb?.friendlyError ? fb.friendlyError(e) : fallback || "সমস্যা হয়েছে।");
  };

  const shell = el("div", { class: "adm-root" });
  clear(root).append(shell);
  const show = (...nodes) => clear(shell).append(...nodes);

  /* ------------------------------------------------------------------
     স্ক্রিন: লোডিং / ত্রুটি / লগইন / অ্যাক্সেস অস্বীকৃত
     ------------------------------------------------------------------ */
  const logoImg = () => el("img", { class: "adm-logo", src: ctx.getSettings().logoLight || ctx.href("assets/logo-black.png"), alt: "Voice Of Amin (VOA) লোগো", width: 900, height: 380 });
  const authCard = (...kids) => el("div", { class: "adm-auth" }, el("div", { class: "adm-auth-card" }, logoImg(), ...kids));
  const homeLink = () => el("a", { class: "adm-back", href: ctx.href(""), "data-link": "" }, "← পাবলিক সাইটে ফিরুন");

  show(authCard(el("p", { class: "adm-muted", role: "status" }, "লোড হচ্ছে...")));

  fb = await ctx.getFirebase();
  if (!alive()) return { destroy() { destroyed = true; } };
  if (!fb) {
    const err = ctx.getFbError();
    show(
      authCard(
        el("h1", {}, "Admin চালু করা যায়নি"),
        el("p", { class: "adm-error", role: "alert" }, err?.code === "voa/config-missing" ? "Firebase কনফিগারেশন বসানো হয়নি। js/config.js ফাইলে firebaseConfig পূরণ করুন।" : "Firebase সংযোগ চালু হয়নি। ইন্টারনেট সংযোগ দেখে পাতাটি রিলোড করুন।"),
        el("button", { type: "button", class: "btn", onClick: () => location.reload() }, "রিলোড করুন"),
        homeLink()
      )
    );
    return { destroy() { destroyed = true; } };
  }

  function showLogin(message = "", type = "error") {
    const msg = el("p", { class: type === "error" ? "adm-error" : "adm-muted", role: message ? "alert" : null, id: "login-msg" }, message);
    const btn = el("button", { type: "button", class: "btn adm-google" }, "Google দিয়ে সাইন ইন করুন");
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = "সাইন ইন হচ্ছে...";
      msg.textContent = "";
      try {
        const u = await fb.loginWithGoogle();
        await handleAuth(u);
      } catch (e) {
        console.error("[VOA admin] login", e);
        if (!alive()) return;
        const text = fb.friendlyError(e);
        msg.className = "adm-error";
        msg.setAttribute("role", "alert");
        msg.textContent = text;
        btn.disabled = false;
        btn.textContent = "Google দিয়ে সাইন ইন করুন";
      }
    });
    show(
      authCard(
        el("h1", {}, "Admin Login"),
        el("p", { class: "adm-muted" }, "এই অংশ শুধু সাইটের অনুমোদিত অ্যাডমিনের জন্য।"),
        btn,
        msg,
        homeLink()
      )
    );
    document.title = "Admin Login | Voice Of Amin";
  }

  function showDenied(email) {
    denied = true;
    show(
      authCard(
        el("h1", {}, "Access denied"),
        el("p", { class: "adm-error", role: "alert" }, `এই Google account${email ? ` (${email})` : ""}-এর অ্যাডমিন অ্যাক্সেস নেই। আপনাকে সাইন আউট করা হয়েছে।`),
        el("p", { class: "adm-muted" }, "কিছুক্ষণের মধ্যে হোমপেজে নিয়ে যাওয়া হবে।"),
        el("a", { class: "btn", href: ctx.href(""), "data-link": "" }, "এখনই হোমপেজে যান")
      )
    );
    redirectTimer = setTimeout(() => alive() && ctx.navigate("", { replace: true }), 5000);
  }

  async function handleAuth(u) {
    if (!alive() || handling) return;
    if (!u) {
      user = null;
      if (!denied) showLogin();
      return;
    }
    if (user && user.uid === u.uid) return;
    handling = true;
    try {
      if (fb.isAdminUser(u)) {
        user = u;
        openDashboard();
      } else {
        const email = u.email || "";
        user = null;
        try { await fb.logout(); } catch (e) { console.warn(e); }
        if (alive()) showDenied(email);
      }
    } finally {
      handling = false;
    }
  }

  try {
    unsubscribe = fb.watchAuth(
      (u) => { handleAuth(u); },
      (e) => { console.error(e); if (alive()) showLogin(fb.friendlyError(e)); }
    );
  } catch (e) {
    console.error(e);
    showLogin(fb.friendlyError(e));
  }

  /* ------------------------------------------------------------------
     ড্যাশবোর্ডের কাঠামো ও ট্যাব
     ------------------------------------------------------------------ */
  const TABS = [
    ["dashboard", "ড্যাশবোর্ড"],
    ["stories", "গল্পসমূহ"],
    ["edit", "নতুন গল্প"],
    ["settings", "সাইট সেটিংস"],
    ["backup", "ব্যাকআপ"]
  ];
  let content = null;
  let tabButtons = {};

  function openDashboard() {
    document.title = "Admin | Voice Of Amin";
    tabButtons = {};
    const nav = el(
      "nav",
      { class: "adm-tabs", "aria-label": "অ্যাডমিন মেনু" },
      TABS.map(([key, label]) => {
        const b = el("button", { type: "button", class: "adm-tab", "data-tab": key, onClick: () => { if (key === "edit") editing = null; switchTab(key); } }, label);
        tabButtons[key] = b;
        return b;
      }),
      el("button", { type: "button", class: "adm-tab adm-tab-out", onClick: doLogout }, "লগআউট")
    );
    content = el("div", { class: "adm-panel", id: "adm-content", tabindex: "-1" });
    show(
      el(
        "div",
        { class: "adm" },
        el(
          "header",
          { class: "adm-bar" },
          logoImg(),
          el("div", { class: "adm-bar-info" }, el("strong", {}, "Admin"), el("span", { class: "adm-muted" }, user.email)),
          el("a", { class: "adm-link", href: ctx.href(""), "data-link": "" }, "সাইট দেখুন")
        ),
        nav,
        content
      )
    );
    renderTab(tab);
  }

  async function switchTab(key, force = false) {
    if (!force && dirty) {
      const ok = await confirmDialog({ title: "সংরক্ষণ করা হয়নি", message: "ফর্মে করা পরিবর্তন সংরক্ষিত হয়নি। ছেড়ে গেলে হারিয়ে যাবে।", confirmText: "ছেড়ে যান", cancelText: "থাকুন", danger: true });
      if (!ok || !alive()) return;
    }
    dirty = false;
    tab = key;
    renderTab(key);
    content.focus({ preventScroll: false });
  }

  function renderTab(key) {
    for (const [k, b] of Object.entries(tabButtons)) {
      b.classList.toggle("is-active", k === key);
      if (k === key) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
    tabButtons.edit.textContent = editing && key === "edit" ? "গল্প সম্পাদনা" : "নতুন গল্প";
    clear(content);
    if (key === "dashboard") renderDashboard();
    else if (key === "stories") renderStories();
    else if (key === "edit") renderEditor();
    else if (key === "settings") renderSettings();
    else if (key === "backup") renderBackup();
  }

  async function doLogout() {
    if (dirty) {
      const ok = await confirmDialog({ title: "লগআউট করবেন?", message: "সংরক্ষণ না করা পরিবর্তন হারিয়ে যাবে।", confirmText: "লগআউট", danger: true });
      if (!ok) return;
    }
    dirty = false;
    try {
      await fb.logout();
    } catch (e) {
      fail(e);
      return;
    }
    user = null;
    ctx.navigate("", { replace: true });
  }

  /* ------------------------------------------------------------------
     সহায়ক: ফর্ম ফিল্ড
     ------------------------------------------------------------------ */
  let uid = 0;
  function field({ label, name, type = "text", value = "", help = "", required = false, maxlength, rows, options, placeholder = "", autocomplete = "off" }) {
    const id = `f-${name}-${++uid}`;
    let input;
    if (type === "textarea") input = el("textarea", { id, name, rows: rows || 4, maxlength, placeholder });
    else if (type === "select") input = el("select", { id, name }, options.map(([v, l]) => el("option", { value: v }, l)));
    else input = el("input", { id, name, type, maxlength, placeholder, autocomplete, inputmode: type === "url" ? "url" : null });
    input.value = value ?? "";
    if (required) input.setAttribute("required", "");
    const err = el("p", { class: "field-error", id: `${id}-err`, role: "alert" });
    const helpNode = help ? el("p", { class: "field-help", id: `${id}-help` }, help) : null;
    input.setAttribute("aria-describedby", [helpNode && helpNode.id, err.id].filter(Boolean).join(" "));
    input.addEventListener("input", () => { dirty = true; setErr(""); });
    const setErr = (m) => {
      err.textContent = m || "";
      if (m) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    };
    const wrap = el("div", { class: "field" }, el("label", { for: id }, label, required ? el("span", { class: "req", "aria-hidden": "true" }, " *") : null), input, helpNode, err);
    return { wrap, input, setErr };
  }

  function checkboxField({ label, name, checked = false, help = "" }) {
    const id = `f-${name}-${++uid}`;
    const input = el("input", { id, name, type: "checkbox", checked });
    input.addEventListener("change", () => (dirty = true));
    return { wrap: el("div", { class: "field field-check" }, input, el("label", { for: id }, label), help ? el("p", { class: "field-help" }, help) : null), input };
  }

  /** ছবি বাছাই: ফাইল (কম্প্রেস হয়) বা লিংক। গল্পের ছবিতে non-destructive ফ্রেমিংও আছে। */
  function imagePicker({ label, value = "", kind = "story", dark = false, crop = null }) {
    const id = `img-${++uid}`;
    let val = value;
    const isLogo = kind === "logo";
    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
    const fresh = () => ({ x: 50, y: 50, zoom: 1 });
    let cr = crop ? { x: crop.x, y: crop.y, zoom: crop.zoom } : fresh();
    const preview = el("div", { class: "img-preview" + (dark ? " is-dark" : "") });
    const info = el("p", { class: "field-help", role: "status", "aria-live": "polite" });
    const err = el("p", { class: "field-error", role: "alert" });
    const file = el("input", { id, type: "file", accept: isLogo ? "image/png,image/webp,image/jpeg" : "image/*" });
    const url = el("input", { type: "url", inputmode: "url", placeholder: "https://...", "aria-label": `${label} - ছবির লিংক`, autocomplete: "off" });
    const removeBtn = el("button", { type: "button", class: "btn btn-ghost btn-sm" }, isLogo ? "অফিসিয়াল লোগোতে ফিরুন" : "ছবি সরান");

    /* ---- ফ্রেমিং (শুধু গল্পের ছবিতে) ---- */
    const cropBox = el("div", { class: "crop", hidden: true });
    const cropImg = el("img", { alt: "ফ্রেমিং ঠিক করার ছবি", draggable: "false" });
    const marker = el("span", { class: "crop-marker", "aria-hidden": "true" });
    const wrap = el("div", { class: "crop-wrap", title: "ছবির যে অংশ দেখাতে চান সেখানে ক্লিক করুন বা টেনে আনুন" }, cropImg, marker);
    const mkRange = (name, lab, min, max, step) => {
      const rid = `${id}-${name}`;
      const input = el("input", { id: rid, type: "range", min, max, step });
      const out = el("output", { for: rid });
      return { input, out, row: el("div", { class: "crop-row" }, el("label", { for: rid }, lab), input, out) };
    };
    const rx = mkRange("x", "অনুভূমিক ফোকাস", 0, 100, 0.5);
    const ry = mkRange("y", "উল্লম্ব ফোকাস", 0, 100, 0.5);
    const rz = mkRange("z", "জুম", 1, 3, 0.05);
    const frames = [["hero", "১৬:৯ (প্রধান খবর)"], ["card", "১৬:১০ (কার্ড)"], ["avatar", "১:১ (Voice)"]].map(([k, l]) => {
      const im = el("img", { alt: "" });
      return { im, node: el("figure", { class: `crop-frame crop-${k}` }, el("div", { class: "crop-frame-box" }, im), el("figcaption", {}, l)) };
    });
    const resetCrop = el("button", { type: "button", class: "btn btn-ghost btn-sm" }, "ফ্রেমিং রিসেট");
    cropBox.append(
      el("p", { class: "field-help" }, "ফ্রেমিং: মূল ছবি অপরিবর্তিত থাকে, ছবি কাটা হয় না। শুধু কোন অংশ দেখানো হবে তা ঠিক হয়; পরে যেকোনো সময় বদলানো যায়।"),
      wrap, rx.row, ry.row, rz.row,
      el("div", { class: "crop-frames", role: "group", "aria-label": "বিভিন্ন ফ্রেমে প্রিভিউ" }, frames.map((f) => f.node)),
      resetCrop
    );

    function paintCrop() {
      marker.style.left = `${cr.x}%`;
      marker.style.top = `${cr.y}%`;
      rx.input.value = cr.x; ry.input.value = cr.y; rz.input.value = cr.zoom;
      rx.out.textContent = `${toBn(Math.round(cr.x))}%`;
      ry.out.textContent = `${toBn(Math.round(cr.y))}%`;
      rz.out.textContent = `${toBn(Number(cr.zoom).toFixed(2))}×`;
      const css = cropStyle(normalizeCrop(cr)) || "";
      for (const f of frames) f.im.style.cssText = css;
    }
    const touchCrop = () => { dirty = true; paintCrop(); };
    rx.input.addEventListener("input", () => { cr.x = clamp(Number(rx.input.value), 0, 100); touchCrop(); });
    ry.input.addEventListener("input", () => { cr.y = clamp(Number(ry.input.value), 0, 100); touchCrop(); });
    rz.input.addEventListener("input", () => { cr.zoom = clamp(Number(rz.input.value), 1, 3); touchCrop(); });
    resetCrop.addEventListener("click", () => { cr = fresh(); touchCrop(); });
    let dragging = false;
    const fromPointer = (ev) => {
      const r = cropImg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      cr.x = Math.round(clamp(((ev.clientX - r.left) / r.width) * 100, 0, 100) * 10) / 10;
      cr.y = Math.round(clamp(((ev.clientY - r.top) / r.height) * 100, 0, 100) * 10) / 10;
      touchCrop();
    };
    wrap.addEventListener("pointerdown", (ev) => { dragging = true; try { wrap.setPointerCapture(ev.pointerId); } catch { /* পুরনো ব্রাউজার */ } fromPointer(ev); ev.preventDefault(); });
    wrap.addEventListener("pointermove", (ev) => dragging && fromPointer(ev));
    const stopDrag = () => { dragging = false; };
    wrap.addEventListener("pointerup", stopDrag);
    wrap.addEventListener("pointercancel", stopDrag);

    function paint() {
      clear(preview);
      if (val) preview.append(el("img", { src: val, alt: `${label} প্রিভিউ`, onError: () => { err.textContent = "ছবিটি লোড হচ্ছে না; লিংক বা ফাইল পরীক্ষা করুন."; } }));
      else preview.append(el("span", { class: "adm-muted" }, isLogo ? "অফিসিয়াল লোগো ব্যবহার হচ্ছে" : "কোনো ছবি নেই"));
      url.value = isHttpUrl(val) ? val : "";
      removeBtn.hidden = !val;
      if (val.startsWith("data:")) info.textContent = `সংরক্ষিত ছবি: ${formatBytes(dataUrlBytes(val))}`;
      else if (val) info.textContent = "ছবির লিংক ব্যবহার হচ্ছে।";
      else info.textContent = "";
      cropBox.hidden = isLogo || !val;
      if (!isLogo && val) {
        if (cropImg.getAttribute("src") !== val) {
          cropImg.src = val;
          for (const f of frames) f.im.src = val;
        }
        paintCrop();
      }
    }

    file.addEventListener("change", async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      err.textContent = "";
      info.textContent = "ছবি ছোট (কম্প্রেস) করা হচ্ছে...";
      file.disabled = true;
      try {
        const r = await compressImage(f, isLogo ? { maxEdge: 800, targetBytes: 120 * 1024, hardLimit: LOGO_HARD_LIMIT_BYTES, keepPng: true } : {});
        if (!alive()) return;
        val = r.dataUrl;
        cr = fresh();
        dirty = true;
        paint();
        info.textContent = `ছবি প্রস্তুত: ${r.width}×${r.height}px, ${formatBytes(r.bytes)} (মূল ফাইল ${formatBytes(r.inputBytes)})`;
        r.notes.forEach((n) => say(n, "warn"));
      } catch (e) {
        console.error(e);
        err.textContent = e.message || "ছবি প্রসেস করা যায়নি।";
        say(err.textContent, "error");
        info.textContent = "";
      } finally {
        file.disabled = false;
        file.value = "";
      }
    });
    url.addEventListener("change", () => {
      const v = url.value.trim();
      err.textContent = "";
      if (!v) val = val.startsWith("data:") ? val : "";
      else if (!isHttpUrl(v)) err.textContent = "ছবির লিংক সঠিক নয় (https:// দিয়ে শুরু করুন)।";
      else if (v !== val) { val = v; cr = fresh(); }
      dirty = true;
      paint();
    });
    removeBtn.addEventListener("click", () => {
      val = "";
      cr = fresh();
      err.textContent = "";
      dirty = true;
      paint();
    });

    const node = el(
      "div",
      { class: "field" },
      el("label", { for: id }, label),
      preview,
      file,
      el("p", { class: "field-help" }, isLogo ? "PNG (স্বচ্ছ ব্যাকগ্রাউন্ডসহ) ভালো। খালি রাখলে অফিসিয়াল লোগো ব্যবহার হবে।" : `JPG/PNG/WebP দিন; ছবি স্বয়ংক্রিয়ভাবে ছোট করে WebP/JPEG বানানো হয় (লক্ষ্য ≈ ${formatBytes(IMAGE_TARGET_BYTES)})। বড় ছবি Firestore-এ রাখা যায় না।`),
      isLogo ? null : el("div", { class: "field-inline" }, el("span", { class: "adm-muted" }, "অথবা লিংক:"), url),
      info,
      err,
      removeBtn,
      cropBox
    );
    paint();
    return { node, get: () => val, getCrop: () => (val && !isLogo ? normalizeCrop(cr) : null), setError: (m) => (err.textContent = m || "") };
  }

  /* ------------------------------------------------------------------
     ট্যাব: ড্যাশবোর্ড
     ------------------------------------------------------------------ */
  async function renderDashboard() {
    const statsBox = el("div", { class: "stat-grid", "aria-live": "polite" }, Array.from({ length: 6 }, () => el("div", { class: "stat skel" })));
    const recent = el("div", {}, el("p", { class: "adm-muted" }, "লোড হচ্ছে..."));
    const legacyBox = el("div");
    clear(content).append(
      el("h1", { class: "adm-h" }, "ড্যাশবোর্ড"),
      statsBox,
      legacyBox,
      el("div", { class: "adm-actions" }, el("button", { type: "button", class: "btn", onClick: () => { editing = null; switchTab("edit"); } }, "নতুন গল্প যোগ করুন"), el("button", { type: "button", class: "btn btn-ghost", onClick: () => switchTab("stories") }, "সব গল্প দেখুন")),
      el("h2", { class: "adm-h2" }, "সর্বশেষ গল্প"),
      recent
    );
    try {
      const [c, pager] = await Promise.all([fb.countStories(), Promise.resolve(fb.createPager(null, 5))]);
      const items = await pager.loadMore();
      if (!alive() || tab !== "dashboard") return;
      clear(statsBox).append(
        stat("মোট গল্প", c.total),
        stat("VOICE", c.byCategory.VOICE),
        stat("TREND", c.byCategory.TREND),
        stat("INSIGHT", c.byCategory.INSIGHT),
        stat("Featured", c.featured),
        stat("খসড়া", c.drafts || 0)
      );
      if (c.legacy > 0) {
        const b = el("button", { type: "button", class: "btn btn-sm" }, "এখনই আপগ্রেড করুন");
        b.addEventListener("click", () => runMigration(b));
        legacyBox.append(el("div", { class: "adm-notice", role: "status" }, el("p", {}, `${toBn(c.legacy)}টি গল্প পুরনো সাইটের ফরম্যাটে আছে, তাই নতুন সাইটে দেখা যাচ্ছে না। আপগ্রেড করলে ডেটা মুছবে না; শুধু নতুন ফরম্যাটে রূপান্তর হবে।`), b));
      }
      clear(recent);
      if (!items.length) recent.append(el("p", { class: "adm-muted" }, "এখনো কোনো গল্প নেই। প্রথম গল্পটি যোগ করুন।"));
      else recent.append(el("ul", { class: "adm-list" }, items.map((s) => storyRow(s, { compact: true }))));
    } catch (e) {
      if (!alive()) return;
      fail(e);
      clear(statsBox).append(el("p", { class: "adm-error" }, fb.friendlyError(e)));
      clear(recent);
    }
  }

  const stat = (label, n) => el("div", { class: "stat" }, el("div", { class: "stat-n" }, toBn(n)), el("div", { class: "stat-l" }, label));

  async function runMigration(btn) {
    const ok = await confirmDialog({ title: "পুরনো গল্প আপগ্রেড", message: "পুরনো ফরম্যাটের গল্পগুলো নতুন ফরম্যাটে লিখে দেওয়া হবে। কোনো গল্প মুছবে না। এগিয়ে যাবেন?", confirmText: "আপগ্রেড করুন" });
    if (!ok) return;
    btn.disabled = true;
    btn.textContent = "আপগ্রেড হচ্ছে...";
    try {
      const r = await fb.migrateLegacyStories((d, t) => (btn.textContent = `আপগ্রেড হচ্ছে ${toBn(d)}/${toBn(t)}`));
      say(`${toBn(r.migrated)}টি গল্প আপগ্রেড হয়েছে${r.skipped ? `, ${toBn(r.skipped)}টি বাদ গেছে (ব্রাউজার কনসোল দেখুন)` : ""}।`, "success");
      if (alive()) renderTab(tab);
    } catch (e) {
      fail(e);
      btn.disabled = false;
      btn.textContent = "আবার চেষ্টা করুন";
    }
  }

  /* ------------------------------------------------------------------
     ট্যাব: গল্পসমূহ
     ------------------------------------------------------------------ */
  function storyRow(s, { compact = false } = {}) {
    const row = el("li", { class: "adm-row", "data-id": s.id });
    const refresh = () => {
      clear(row).append(
        el(
          "div",
          { class: "adm-row-main" },
          el("div", {}, el("span", { class: `badge badge-${s.category.toLowerCase()}` }, s.category), s.featured ? el("span", { class: "badge badge-feat" }, "FEATURED") : null),
          el("strong", { class: "adm-row-title" }, s.title),
          el("div", { class: "adm-muted" }, [fmtDateTime(s.publishedAt), s.author].filter(Boolean).join(" · "))
        ),
        el(
          "div",
          { class: "adm-row-actions" },
          el("button", { type: "button", class: "btn btn-ghost btn-sm", "aria-label": `এডিট: ${s.title}`, onClick: () => { editing = s; switchTab("edit", true); } }, "এডিট"),
          compact ? null : el("button", { type: "button", class: "btn btn-ghost btn-sm", "aria-pressed": String(!!s.featured), "aria-label": `${s.featured ? "Featured বাদ দিন" : "Featured করুন"}: ${s.title}`, onClick: (e) => toggleFeatured(s, e.currentTarget, refresh) }, s.featured ? "Featured বাদ" : "Featured করুন"),
          el("a", { class: "btn btn-ghost btn-sm", href: ctx.href(`article/${encodeURIComponent(s.id)}`), "data-link": "", "aria-label": `দেখুন: ${s.title}` }, "দেখুন"),
          compact ? null : el("button", { type: "button", class: "btn btn-ghost btn-sm", "aria-label": `খসড়ায় নিন: ${s.title}`, onClick: () => unpublish(s, row) }, "খসড়ায় নিন"),
          compact ? null : el("button", { type: "button", class: "btn btn-danger btn-sm", "aria-label": `মুছুন: ${s.title}`, onClick: () => removeStory(s, row) }, "মুছুন")
        )
      );
    };
    refresh();
    return row;
  }

  function draftRow(s) {
    const row = el("li", { class: "adm-row", "data-id": s.id, "data-draft": "" });
    clear(row).append(
      el(
        "div",
        { class: "adm-row-main" },
        el("div", {}, el("span", { class: "badge badge-draft" }, "DRAFT"), el("span", { class: `badge badge-${s.category.toLowerCase()}` }, s.category)),
        el("strong", { class: "adm-row-title" }, s.title),
        el("div", { class: "adm-muted" }, `সংরক্ষিত: ${fmtDateTime(s.updatedAt || s.publishedAt)}${s.author ? ` · ${s.author}` : ""}`)
      ),
      el(
        "div",
        { class: "adm-row-actions" },
        el("button", { type: "button", class: "btn btn-ghost btn-sm", "aria-label": `খসড়া এডিট: ${s.title}`, onClick: () => { editing = { ...s, _draft: true }; switchTab("edit", true); } }, "এডিট"),
        el("button", { type: "button", class: "btn btn-ghost btn-sm", "aria-label": `প্রিভিউ: ${s.title}`, onClick: () => openPreview(previewStory(draftToRaw(s))) }, "প্রিভিউ"),
        el("button", { type: "button", class: "btn btn-sm", "aria-label": `প্রকাশ করুন: ${s.title}`, onClick: () => quickPublish(s, row) }, "প্রকাশ করুন"),
        el("button", { type: "button", class: "btn btn-danger btn-sm", "aria-label": `খসড়া মুছুন: ${s.title}`, onClick: () => removeDraft(s, row) }, "মুছুন")
      )
    );
    return row;
  }

  const draftToRaw = (s, now = false) => ({
    title: s.title, category: s.category, summary: s.summary, content: s.content, author: s.author, source: s.source,
    date: zoneDateInput(now ? new Date() : s.publishedAt), time: zoneTimeInput(now ? new Date() : s.publishedAt),
    sourceUrl: s.sourceUrl, facebookUrl: s.facebookUrl, image: s.image, imageCrop: s.imageCrop, featured: s.featured
  });

  async function toggleFeatured(s, btn, refresh) {
    btn.disabled = true;
    try {
      await fb.setFeatured(s.id, !s.featured);
      s.featured = !s.featured;
      say(s.featured ? "Featured করা হয়েছে।" : "Featured বাদ দেওয়া হয়েছে।", "success");
      if (alive()) refresh();
    } catch (e) {
      fail(e);
      btn.disabled = false;
    }
  }

  async function removeStory(s, row) {
    const ok = await confirmDialog({ title: "গল্প মুছবেন?", message: `"${s.title}" স্থায়ীভাবে মুছে যাবে। এটি ফেরানো যাবে না।`, confirmText: "মুছে ফেলুন", danger: true });
    if (!ok || !alive()) return;
    const btns = $$("button", row);
    btns.forEach((b) => (b.disabled = true));
    try {
      await fb.deleteStory(s.id);
      say("গল্পটি মুছে ফেলা হয়েছে।", "success");
      if (listState) listState.items = listState.items.filter((x) => x.id !== s.id);
      row.remove();
    } catch (e) {
      fail(e);
      btns.forEach((b) => (b.disabled = false));
    }
  }

  async function unpublish(s, row) {
    const ok = await confirmDialog({ title: "খসড়ায় নেবেন?", message: `"${s.title}" পাবলিক সাইট থেকে সরে গিয়ে খসড়ায় যাবে। পরে আবার প্রকাশ করা যাবে; কিছু মুছবে না।`, confirmText: "খসড়ায় নিন" });
    if (!ok || !alive()) return;
    const btns = $$("button", row);
    btns.forEach((b) => (b.disabled = true));
    try {
      await fb.unpublishStory(s);
      say("গল্পটি খসড়ায় নেওয়া হয়েছে।", "success");
      if (listState) { listState.items = listState.items.filter((x) => x.id !== s.id); listState.drafts = null; }
      row.remove();
    } catch (e) {
      fail(e);
      btns.forEach((b) => (b.disabled = false));
    }
  }

  async function removeDraft(s, row) {
    const ok = await confirmDialog({ title: "খসড়া মুছবেন?", message: `"${s.title}" খসড়াটি স্থায়ীভাবে মুছে যাবে।`, confirmText: "মুছে ফেলুন", danger: true });
    if (!ok || !alive()) return;
    const btns = $$("button", row);
    btns.forEach((b) => (b.disabled = true));
    try {
      await fb.deleteDraft(s.id);
      say("খসড়া মুছে ফেলা হয়েছে।", "success");
      if (listState && listState.drafts) listState.drafts = listState.drafts.filter((x) => x.id !== s.id);
      row.remove();
    } catch (e) {
      fail(e);
      btns.forEach((b) => (b.disabled = false));
    }
  }

  /** তালিকা থেকে দ্রুত প্রকাশ: প্রকাশের সময় = এখন */
  async function quickPublish(s, row) {
    const v = validateStoryInput(draftToRaw(s, true));
    if (!v.ok) {
      say(`খসড়াটি অসম্পূর্ণ: ${Object.values(v.errors)[0]} এডিটরে গিয়ে পূরণ করুন।`, "warn");
      editing = { ...s, _draft: true };
      switchTab("edit", true);
      return;
    }
    const ok = await confirmDialog({ title: "এখনই প্রকাশ করবেন?", message: `"${s.title}" এখনকার সময়ে প্রকাশিত হবে এবং LATEST ও ${s.category}-এ দেখা যাবে।`, confirmText: "প্রকাশ করুন" });
    if (!ok || !alive()) return;
    const btns = $$("button", row);
    btns.forEach((b) => (b.disabled = true));
    try {
      await fb.publishFromForm(s.id, v.data);
      say("গল্প প্রকাশিত হয়েছে।", "success");
      if (listState) { listState.drafts = (listState.drafts || []).filter((x) => x.id !== s.id); listState.pager = null; }
      row.remove();
    } catch (e) {
      fail(e);
      btns.forEach((b) => (b.disabled = false));
    }
  }

  function renderStories() {
    if (!listState) listState = { view: "published", cat: "", q: "", pager: null, items: [], drafts: null };
    const st = listState;
    const search = el("input", { type: "search", id: "story-search", placeholder: "শিরোনাম, লেখক বা সারসংক্ষেপ খুঁজুন", value: st.q, autocomplete: "off" });
    const catSel = el("select", { id: "story-cat" }, [["", "সব ক্যাটেগরি"], ...CATEGORIES.map((c) => [c, c])].map(([v, l]) => el("option", { value: v, selected: v === st.cat }, l)));
    const listBox = el("ul", { class: "adm-list" });
    const note = el("p", { class: "adm-muted", role: "status", "aria-live": "polite" });
    const moreBtn = el("button", { type: "button", class: "btn btn-ghost" }, "আরও লোড করুন");
    const seg = el("div", { class: "seg", role: "group", "aria-label": "গল্পের ধরন" });
    const segBtn = (view, label) => {
      const b = el("button", { type: "button", class: "seg-btn", "aria-pressed": String(st.view === view) }, label);
      b.addEventListener("click", () => { if (st.view !== view) { st.view = view; renderStories(); } });
      return b;
    };
    seg.append(segBtn("published", "প্রকাশিত"), segBtn("drafts", "খসড়া"));

    clear(content).append(
      el("h1", { class: "adm-h" }, "গল্পসমূহ"),
      seg,
      el(
        "div",
        { class: "adm-toolbar" },
        el("div", { class: "field" }, el("label", { for: "story-search" }, "খুঁজুন"), search),
        el("div", { class: "field" }, el("label", { for: "story-cat" }, "ক্যাটেগরি"), catSel),
        el("button", { type: "button", class: "btn", onClick: () => { editing = null; switchTab("edit"); } }, "নতুন গল্প")
      ),
      note,
      listBox,
      el("div", { class: "more" }, moreBtn)
    );

    const matches = (s) => {
      const q = st.q.trim().toLowerCase();
      return !q || [s.title, s.summary, s.author, s.source].join(" ").toLowerCase().includes(q);
    };
    const paint = () => {
      if (st.view === "drafts") {
        moreBtn.hidden = true;
        const shown = (st.drafts || []).filter((s) => matches(s) && (!st.cat || s.category === st.cat));
        clear(listBox).append(...shown.map(draftRow));
        note.textContent = !st.drafts ? "লোড হচ্ছে..." : !st.drafts.length ? "কোনো খসড়া নেই। নতুন গল্প লিখে \"খসড়া সংরক্ষণ\" চাপলে এখানে আসবে।" : !shown.length ? "কিছু পাওয়া যায়নি।" : "";
        return;
      }
      const shown = st.items.filter(matches);
      clear(listBox).append(...shown.map((s) => storyRow(s)));
      moreBtn.hidden = !st.pager || st.pager.done;
      if (!st.items.length && st.pager && st.pager.done) note.textContent = "কোনো গল্প নেই।";
      else if (st.q.trim() && !shown.length) note.textContent = st.pager && !st.pager.done ? "লোড হওয়া গল্পে মেলেনি; আরও লোড করে দেখুন।" : "কিছু পাওয়া যায়নি।";
      else note.textContent = st.pager && !st.pager.done && st.q.trim() ? "শুধু এখন পর্যন্ত লোড হওয়া গল্পে খোঁজা হচ্ছে।" : "";
    };
    const load = async (reset) => {
      if (reset || !st.pager) {
        st.pager = fb.createPager(st.cat || null, 20);
        st.items = [];
      }
      moreBtn.disabled = true;
      moreBtn.textContent = "লোড হচ্ছে...";
      try {
        const batch = await st.pager.loadMore();
        st.items.push(...batch);
      } catch (e) {
        if (alive()) fail(e);
      } finally {
        if (alive() && tab === "stories" && st.view === "published") {
          moreBtn.disabled = false;
          moreBtn.textContent = "আরও লোড করুন";
          paint();
        }
      }
    };
    const loadDrafts = async () => {
      paint();
      try {
        st.drafts = await fb.fetchDrafts();
      } catch (e) {
        if (alive()) fail(e);
        st.drafts = st.drafts || [];
        note.textContent = `খসড়া পড়া যায়নি: ${fb.friendlyError(e)} (Firestore Rules-এ drafts অংশ যোগ করেছেন?)`;
        return;
      }
      if (alive() && tab === "stories" && st.view === "drafts") paint();
    };
    search.addEventListener("input", debounce(() => { st.q = search.value; paint(); }, 200));
    catSel.addEventListener("change", () => {
      st.cat = catSel.value;
      if (st.view === "published") load(true);
      else paint();
    });
    moreBtn.addEventListener("click", () => load(false));

    if (st.view === "drafts") {
      if (st.drafts) paint();
      else loadDrafts();
    } else if (st.pager && st.items.length && st.pager.version === fb.getDataVersion()) {
      paint();
    } else {
      st.pager = null;
      note.textContent = "লোড হচ্ছে...";
      load(true);
    }
  }

  /* ------------------------------------------------------------------
     প্রিভিউ: আসল পাতার একই কোড, মোবাইল/ডেস্কটপ ফ্রেমে (কিছু সংরক্ষণ বা প্রকাশ হয় না)
     ------------------------------------------------------------------ */
  function openPreview(story) {
    const previous = document.activeElement;
    const article = buildArticle(story, { categoryNode: el("span", { class: "kicker" }, story.category), actions: [] });
    const html =
      `<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<base href="${ctx.href("")}"><link rel="stylesheet" href="css/style.css"></head>` +
      `<body data-mode="public"><div class="wrap page">${article.outerHTML}</div></body></html>`;
    const frame = el("iframe", { class: "preview-frame", title: "প্রিভিউ", sandbox: "allow-same-origin", srcdoc: html });
    const mobileBtn = el("button", { type: "button", class: "btn btn-ghost btn-sm", "aria-pressed": "true" }, "মোবাইল");
    const desktopBtn = el("button", { type: "button", class: "btn btn-ghost btn-sm", "aria-pressed": "false" }, "ডেস্কটপ");
    const closeBtn = el("button", { type: "button", class: "btn btn-sm" }, "প্রিভিউ বন্ধ করুন");
    const setMode = (mobile) => {
      frame.classList.toggle("is-mobile", mobile);
      mobileBtn.setAttribute("aria-pressed", String(mobile));
      desktopBtn.setAttribute("aria-pressed", String(!mobile));
    };
    mobileBtn.addEventListener("click", () => setMode(true));
    desktopBtn.addEventListener("click", () => setMode(false));
    const overlay = el(
      "div",
      { class: "preview-overlay", role: "dialog", "aria-modal": "true", "aria-label": "গল্পের প্রিভিউ" },
      el("div", { class: "preview-bar" }, el("strong", {}, "প্রিভিউ"), el("span", { class: "adm-muted" }, "এটি এখনো প্রকাশিত হয়নি"), el("div", { class: "preview-modes" }, mobileBtn, desktopBtn), closeBtn),
      el("div", { class: "preview-stage" }, frame)
    );
    const close = () => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      document.body.classList.remove("modal-open");
      previous?.focus?.();
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
    };
    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", onKey, true);
    document.body.classList.add("modal-open");
    document.body.append(overlay);
    setMode(true);
    closeBtn.focus();
  }

  /* ------------------------------------------------------------------
     ট্যাব: নতুন গল্প / এডিট / খসড়া
     ------------------------------------------------------------------ */
  function renderEditor() {
    const s = editing;
    const wasDraft = !!(s && s._draft);
    let draftId = wasDraft ? s.id : null;
    const editingPublished = !!s && !wasDraft;
    const now = new Date();
    const f = {
      title: field({ label: "শিরোনাম", name: "title", value: s?.title, required: true, maxlength: 220 }),
      category: field({ label: "ক্যাটেগরি", name: "category", type: "select", value: s?.category || "TREND", required: true, options: CATEGORIES.map((c) => [c, c]) }),
      summary: field({ label: "সারসংক্ষেপ", name: "summary", type: "textarea", rows: 3, value: s?.summary, required: true, maxlength: 700, help: "হোমপেজ, কার্ড ও সার্চ রেজাল্টে দেখানো হয়।" }),
      content: field({ label: "পূর্ণ লেখা", name: "content", type: "textarea", rows: 14, value: s?.content, required: true, help: "অনুচ্ছেদ আলাদা করতে একটি ফাঁকা লাইন দিন। \"## \" দিয়ে শুরু হলে উপশিরোনাম, \"> \" দিয়ে শুরু হলে উদ্ধৃতি। https:// লিংক নিজে থেকেই ক্লিকযোগ্য হয়।" }),
      author: field({ label: "লেখক", name: "author", value: s ? s.author : ctx.getSettings().founder, maxlength: 120 }),
      source: field({ label: "সোর্স (নাম)", name: "source", value: s?.source, maxlength: 160, placeholder: "যেমন: প্রথম আলো, Facebook" }),
      date: field({ label: "প্রকাশের তারিখ", name: "date", type: "date", value: zoneDateInput(s?.publishedAt || now), required: true }),
      time: field({ label: "প্রকাশের সময়", name: "time", type: "time", value: zoneTimeInput(s?.publishedAt || now), required: true }),
      sourceUrl: field({ label: "মূল সূত্রের লিংক", name: "sourceUrl", type: "url", value: s?.sourceUrl, placeholder: "https://..." }),
      facebookUrl: field({ label: "Facebook লিংক", name: "facebookUrl", type: "url", value: s?.facebookUrl, placeholder: "https://facebook.com/..." })
    };
    const featured = checkboxField({ label: "Featured (হোমপেজের প্রধান খবর)", name: "featured", checked: !!s?.featured, help: "একাধিক Featured থাকলে সবচেয়ে নতুনটি প্রধান খবর হয়।" });
    const picker = imagePicker({ label: "প্রধান ছবি", value: s?.image || "", crop: s?.imageCrop || null });
    const submit = el("button", { type: "submit", class: "btn" }, editingPublished ? "আপডেট করুন" : "প্রকাশ করুন");
    const draftBtn = editingPublished ? null : el("button", { type: "button", class: "btn btn-ghost" }, "খসড়া সংরক্ষণ");
    const previewBtn = el("button", { type: "button", class: "btn btn-ghost" }, "প্রিভিউ");
    const nowBtn = el("button", { type: "button", class: "btn btn-ghost btn-sm" }, "এখনকার সময় বসান");
    const formMsg = el("p", { class: "field-error", role: "alert" });
    let busy = false;
    const setBusy = (v, label) => {
      busy = v;
      for (const b of [submit, draftBtn, previewBtn].filter(Boolean)) b.disabled = v;
      if (label) label.textContent = label.dataset.label;
    };

    const readRaw = () => ({
      title: f.title.input.value, category: f.category.input.value, summary: f.summary.input.value, content: f.content.input.value,
      author: f.author.input.value, source: f.source.input.value, date: f.date.input.value, time: f.time.input.value,
      sourceUrl: f.sourceUrl.input.value, facebookUrl: f.facebookUrl.input.value,
      image: picker.get(), imageCrop: picker.getCrop(), featured: featured.input.checked
    });
    const showErrors = (errors) => {
      for (const [k, fld] of Object.entries(f)) fld.setErr(errors[k] || "");
      picker.setError(errors.image || "");
    };

    nowBtn.addEventListener("click", () => {
      const d = new Date();
      f.date.input.value = zoneDateInput(d);
      f.time.input.value = zoneTimeInput(d);
      dirty = true;
    });
    previewBtn.addEventListener("click", () => openPreview(previewStory(readRaw())));

    if (draftBtn) {
      draftBtn.dataset.label = "খসড়া সংরক্ষণ";
      draftBtn.addEventListener("click", async () => {
        if (busy) return;
        formMsg.textContent = "";
        const v = validateDraftInput(readRaw());
        showErrors(v.errors);
        if (!v.ok) {
          formMsg.textContent = "খসড়া রাখতে অন্তত একটি সঠিক শিরোনাম দিন; লাল লেখাগুলো দেখুন।";
          (f.title.input.getAttribute("aria-invalid") ? f.title.input : null)?.focus();
          return;
        }
        setBusy(true);
        draftBtn.textContent = "সংরক্ষণ হচ্ছে...";
        try {
          draftId = await fb.saveDraft(draftId, v.data);
          dirty = false;
          if (listState) listState.drafts = null;
          say("খসড়া সংরক্ষিত হয়েছে। পাবলিক সাইটে দেখা যাবে না।", "success");
        } catch (e) {
          fail(e);
          formMsg.textContent = `${fb.friendlyError(e)} (খসড়ার জন্য Firestore Rules-এ drafts অংশ যোগ করতে হয়।)`;
        } finally {
          setBusy(false, draftBtn);
        }
      });
    }

    const form = el(
      "form",
      { class: "adm-form", novalidate: "", "aria-label": editingPublished ? "গল্প সম্পাদনা" : wasDraft ? "খসড়া সম্পাদনা" : "নতুন গল্প" },
      f.title.wrap, f.category.wrap, f.summary.wrap, f.content.wrap,
      el("div", { class: "grid-2" }, f.author.wrap, f.source.wrap),
      el("div", { class: "grid-2" }, f.date.wrap, f.time.wrap),
      el("div", { class: "field-inline" }, el("p", { class: "field-help" }, "সময় বাংলাদেশ সময় (Asia/Dhaka) ধরা হয়। খসড়া পরে প্রকাশ করলে সময় বদলাতে ভুলবেন না।"), nowBtn),
      el("div", { class: "grid-2" }, f.sourceUrl.wrap, f.facebookUrl.wrap),
      picker.node,
      featured.wrap,
      formMsg,
      el("div", { class: "adm-actions" }, submit, draftBtn, previewBtn, el("button", { type: "button", class: "btn btn-ghost", onClick: () => switchTab("stories") }, "বাতিল"))
    );
    submit.dataset.label = editingPublished ? "আপডেট করুন" : "প্রকাশ করুন";

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (busy) return;
      formMsg.textContent = "";
      const v = validateStoryInput(readRaw());
      showErrors(v.errors);
      if (!v.ok) {
        formMsg.textContent = "কিছু তথ্য ঠিক নেই; লাল লেখাগুলো দেখুন।";
        const firstKey = Object.keys(f).find((k) => v.errors[k]);
        if (firstKey) f[firstKey].input.focus();
        return;
      }
      setBusy(true);
      submit.textContent = "সংরক্ষণ হচ্ছে...";
      try {
        if (draftId) await fb.publishFromForm(draftId, v.data);
        else await fb.saveStory(s ? s.id : null, v.data);
        say(editingPublished ? "গল্প আপডেট হয়েছে।" : "গল্প প্রকাশিত হয়েছে। এটি LATEST ও নিজের ক্যাটেগরিতে দেখা যাবে।", "success");
        dirty = false;
        editing = null;
        if (listState) { listState.pager = null; listState.drafts = null; listState.view = "published"; }
        if (alive()) switchTab("stories", true);
      } catch (e) {
        fail(e);
        formMsg.textContent = fb.friendlyError(e);
      } finally {
        if (submit.isConnected) setBusy(false, submit);
        else busy = false;
      }
    });

    clear(content).append(el("h1", { class: "adm-h" }, editingPublished ? "গল্প সম্পাদনা" : wasDraft ? "খসড়া সম্পাদনা" : "নতুন গল্প"), form);
    dirty = false;
  }

  /* ------------------------------------------------------------------
     ট্যাব: সাইট সেটিংস
     ------------------------------------------------------------------ */
  async function renderSettings() {
    clear(content).append(el("h1", { class: "adm-h" }, "সাইট সেটিংস"), el("p", { class: "adm-muted", role: "status" }, "লোড হচ্ছে..."));
    let s;
    try {
      s = await fb.getSettings({ strict: true });
    } catch (e) {
      if (alive()) {
        fail(e);
        clear(content).append(el("h1", { class: "adm-h" }, "সাইট সেটিংস"), el("p", { class: "adm-error" }, fb.friendlyError(e)), el("button", { type: "button", class: "btn", onClick: () => renderTab("settings") }, "আবার চেষ্টা করুন"));
      }
      return;
    }
    if (!alive() || tab !== "settings") return;

    const f = {
      brandName: field({ label: "ব্র্যান্ডের নাম", name: "brandName", value: s.brandName, required: true, maxlength: 80 }),
      tagline: field({ label: "ট্যাগলাইন", name: "tagline", value: s.tagline, maxlength: 120 }),
      founder: field({ label: "প্রতিষ্ঠাতা", name: "founder", value: s.founder, maxlength: 120 }),
      aboutTitle: field({ label: "About শিরোনাম", name: "aboutTitle", value: s.aboutTitle, maxlength: 120 }),
      aboutDescription: field({ label: "About বর্ণনা", name: "aboutDescription", type: "textarea", rows: 5, value: s.aboutDescription, help: "অনুচ্ছেদ আলাদা করতে ফাঁকা লাইন দিন।" }),
      footerDescription: field({ label: "ফুটার বর্ণনা", name: "footerDescription", type: "textarea", rows: 2, value: s.footerDescription }),
      trendIntro: field({ label: "TREND পরিচিতি", name: "trendIntro", type: "textarea", rows: 2, value: s.trendIntro }),
      voiceIntro: field({ label: "VOICE পরিচিতি", name: "voiceIntro", type: "textarea", rows: 2, value: s.voiceIntro }),
      insightIntro: field({ label: "INSIGHT পরিচিতি", name: "insightIntro", type: "textarea", rows: 2, value: s.insightIntro }),
      facebookUrl: field({ label: "Facebook পেজের লিংক", name: "facebookUrl", type: "url", value: s.facebookUrl, placeholder: "https://facebook.com/...", help: "খালি রাখলে সাইটে দেখানো হবে না।" }),
      whatsappUrl: field({ label: "WhatsApp / যোগাযোগের লিংক", name: "whatsappUrl", type: "url", value: s.whatsappUrl, placeholder: "https://wa.me/...", help: "খালি রাখলে সাইটে দেখানো হবে না।" })
    };
    const logoLight = imagePicker({ label: "লোগো (সাদা ব্যাকগ্রাউন্ডের জন্য)", value: s.logoLight, kind: "logo" });
    const logoDark = imagePicker({ label: "লোগো (কালো ব্যাকগ্রাউন্ডের জন্য)", value: s.logoDark, kind: "logo", dark: true });
    const submit = el("button", { type: "submit", class: "btn" }, "সেটিংস সংরক্ষণ করুন");
    const msg = el("p", { class: "field-error", role: "alert" });
    let saving = false;
    const form = el(
      "form",
      { class: "adm-form", novalidate: "", "aria-label": "সাইট সেটিংস" },
      f.brandName.wrap, f.tagline.wrap, f.founder.wrap, f.aboutTitle.wrap, f.aboutDescription.wrap, f.footerDescription.wrap,
      f.trendIntro.wrap, f.voiceIntro.wrap, f.insightIntro.wrap, f.facebookUrl.wrap, f.whatsappUrl.wrap,
      el("h2", { class: "adm-h2" }, "লোগো (ঐচ্ছিক)"),
      el("p", { class: "adm-muted" }, "ডিফল্টভাবে আপনার অফিসিয়াল VOA লোগো ব্যবহার হয়। নিতান্ত দরকার না হলে এটি বদলাবেন না।"),
      logoLight.node, logoDark.node, msg,
      el("div", { class: "adm-actions" }, submit)
    );
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (saving) return;
      msg.textContent = "";
      const raw = { ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.input.value])), logoLight: logoLight.get(), logoDark: logoDark.get() };
      const v = validateSettingsInput(raw);
      for (const [k, fld] of Object.entries(f)) fld.setErr(v.errors[k] || "");
      for (const [k, p] of [["logoLight", logoLight], ["logoDark", logoDark]]) {
        const e = checkImageValue(raw[k], LOGO_HARD_LIMIT_BYTES);
        if (e) { p.setError(e); v.ok = false; }
      }
      if (!v.ok) {
        msg.textContent = "কিছু তথ্য ঠিক নেই; লাল লেখাগুলো দেখুন।";
        return;
      }
      saving = true;
      submit.disabled = true;
      submit.textContent = "সংরক্ষণ হচ্ছে...";
      try {
        const saved = await fb.saveSettings(v.data);
        dirty = false;
        ctx.onSettingsChanged(saved);
        say("সেটিংস সংরক্ষিত হয়েছে। পাবলিক সাইটে নতুন তথ্য দেখা যাবে।", "success");
      } catch (e) {
        fail(e);
        msg.textContent = fb.friendlyError(e);
      } finally {
        saving = false;
        submit.disabled = false;
        submit.textContent = "সেটিংস সংরক্ষণ করুন";
      }
    });
    clear(content).append(el("h1", { class: "adm-h" }, "সাইট সেটিংস"), form);
    dirty = false;
  }

  /* ------------------------------------------------------------------
     ট্যাব: ব্যাকআপ / রিস্টোর
     ------------------------------------------------------------------ */
  function stamp() {
    return `${zoneDateInput().replace(/-/g, "")}-${zoneTimeInput().replace(":", "")}`;
  }

  function buildSitemap(stories) {
    const base = SITE_URL.replace(/\/+$/, "");
    const esc = (t) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
    const fixed = [["", "daily", "1.0"], ["latest", "hourly", "0.9"], ["voice", "daily", "0.8"], ["trend", "daily", "0.8"], ["insight", "daily", "0.8"], ["about", "monthly", "0.5"]];
    const rows = fixed.map(([p, freq, pr]) => `  <url>\n    <loc>${esc(`${base}/${p}`)}</loc>\n    <changefreq>${freq}</changefreq>\n    <priority>${pr}</priority>\n  </url>`);
    for (const s of stories) {
      const d = (s.updatedAt || s.publishedAt).toISOString();
      rows.push(`  <url>\n    <loc>${esc(`${base}/article/${encodeURIComponent(s.id)}`)}</loc>\n    <lastmod>${d}</lastmod>\n    <priority>0.7</priority>\n  </url>`);
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
  }

  function renderBackup() {
    const out = el("p", { class: "adm-muted", role: "status", "aria-live": "polite" });
    const exportBtn = el("button", { type: "button", class: "btn" }, "ব্যাকআপ ডাউনলোড (JSON)");
    const sitemapBtn = el("button", { type: "button", class: "btn btn-ghost" }, "sitemap.xml তৈরি করুন");
    const migrateBtn = el("button", { type: "button", class: "btn btn-ghost" }, "পুরনো গল্প আপগ্রেড করুন");
    const file = el("input", { id: "backup-file", type: "file", accept: "application/json,.json" });
    const importMsg = el("p", { class: "adm-muted", role: "status", "aria-live": "polite" });

    exportBtn.addEventListener("click", async () => {
      exportBtn.disabled = true;
      exportBtn.textContent = "ব্যাকআপ তৈরি হচ্ছে...";
      try {
        const data = await fb.exportBackup();
        downloadFile(`voice-of-amin-backup-${stamp()}.json`, JSON.stringify(data, null, 2));
        out.textContent = `${toBn(data.stories.length)}টি গল্প, ${toBn((data.drafts || []).length)}টি খসড়া ও সেটিংস ডাউনলোড হয়েছে। ফাইলটি নিরাপদ জায়গায় রাখুন।`;
        say("ব্যাকআপ ডাউনলোড হয়েছে।", "success");
      } catch (e) {
        fail(e);
      } finally {
        exportBtn.disabled = false;
        exportBtn.textContent = "ব্যাকআপ ডাউনলোড (JSON)";
      }
    });

    sitemapBtn.addEventListener("click", async () => {
      sitemapBtn.disabled = true;
      try {
        const stories = await fb.fetchAllStories();
        downloadFile("sitemap.xml", buildSitemap(stories), "application/xml");
        out.textContent = `sitemap.xml তৈরি হয়েছে (${toBn(stories.length)}টি গল্পসহ)। এটি GitHub-এ আপনার রিপোজিটরির মূল ফোল্ডারে sitemap.xml হিসেবে আপলোড করুন।`;
      } catch (e) {
        fail(e);
      } finally {
        sitemapBtn.disabled = false;
      }
    });

    migrateBtn.addEventListener("click", () => runMigration(migrateBtn));

    file.addEventListener("change", async () => {
      const f = file.files && file.files[0];
      file.value = "";
      if (!f) return;
      importMsg.className = "adm-muted";
      importMsg.textContent = "ফাইল যাচাই হচ্ছে...";
      let parsed;
      try {
        if (f.size > 40 * 1024 * 1024) throw new Error("ফাইল অনেক বড় (৪০ MB-এর বেশি)।");
        parsed = parseBackup(await readFileText(f));
      } catch (e) {
        importMsg.className = "adm-error";
        importMsg.textContent = `অবৈধ ব্যাকআপ: ${e.message}`;
        say("ব্যাকআপ ফাইলটি অবৈধ।", "error");
        return;
      }
      if (!alive()) return;
      importMsg.textContent = "";

      const mergeBox = checkboxField({ label: "সেটিংসও রিস্টোর করুন", name: "imp-settings", checked: !!parsed.settings });
      const replaceBox = checkboxField({ label: "বর্তমান সব গল্প মুছে শুধু ব্যাকআপের গল্প রাখুন (ঝুঁকিপূর্ণ)", name: "imp-replace", checked: false });
      if (!parsed.settings) mergeBox.input.disabled = true;
      const details = el(
        "div",
        {},
        el("p", {}, `ব্যাকআপে ${toBn(parsed.stories.length)}টি গল্প ও ${toBn((parsed.drafts || []).length)}টি খসড়া পাওয়া গেছে।`),
        parsed.problems.length ? el("p", { class: "adm-error" }, `${toBn(parsed.problems.length)}টি এন্ট্রি বাদ যাবে: ${parsed.problems.slice(0, 3).join(" ")}`) : null,
        parsed.imagesDropped ? el("p", { class: "adm-error" }, `${toBn(parsed.imagesDropped)}টি গল্পের ছবি বড় বা অবৈধ, তাই ছবি ছাড়া ফেরত আসবে।`) : null,
        el("p", {}, "ডিফল্ট: মার্জ। একই ID-এর গল্প ব্যাকআপের তথ্য দিয়ে বদলে যাবে; বাকি গল্প অক্ষত থাকবে।")
      );
      const extra = el("div", { class: "modal-checks" }, mergeBox.wrap, replaceBox.wrap);
      const ok = await confirmDialog({ title: "ব্যাকআপ রিস্টোর করবেন?", message: details, extra, confirmText: "রিস্টোর করুন", danger: true });
      if (!ok || !alive()) return;

      const replace = replaceBox.input.checked;
      if (replace) {
        const sure = await confirmDialog({ title: "সম্পূর্ণ প্রতিস্থাপন", message: "ব্যাকআপে নেই এমন সব গল্প স্থায়ীভাবে মুছে যাবে। আপনি কি নিশ্চিত?", confirmText: "হ্যাঁ, মুছে প্রতিস্থাপন করুন", danger: true });
        if (!sure || !alive()) return;
      }
      file.disabled = true;
      importMsg.textContent = "রিস্টোর শুরু হচ্ছে...";
      try {
        const r = await fb.importBackup({
          stories: parsed.stories,
          drafts: parsed.drafts || [],
          settings: mergeBox.input.checked ? parsed.settings : null,
          replace,
          onProgress: (d, t) => (importMsg.textContent = `লেখা হচ্ছে ${toBn(d)}/${toBn(t)}...`)
        });
        if (parsed.settings && mergeBox.input.checked) ctx.onSettingsChanged(await fb.getSettings());
        importMsg.className = "adm-muted";
        importMsg.textContent = `রিস্টোর সম্পন্ন: ${toBn(r.written)}টি গল্প/খসড়া লেখা হয়েছে${r.removed ? `, ${toBn(r.removed)}টি মুছেছে` : ""}।`;
        say("রিস্টোর সম্পন্ন হয়েছে।", "success");
        if (listState) listState.pager = null;
      } catch (e) {
        fail(e);
        importMsg.className = "adm-error";
        importMsg.textContent = `রিস্টোর সম্পূর্ণ হয়নি: ${fb.friendlyError(e)} (কিছু গল্প লেখা হয়ে থাকতে পারে; আবার চেষ্টা করলে নিরাপদ।)`;
      } finally {
        file.disabled = false;
      }
    });

    clear(content).append(
      el("h1", { class: "adm-h" }, "ব্যাকআপ / রিস্টোর"),
      el("section", { class: "adm-card" }, el("h2", { class: "adm-h2" }, "ব্যাকআপ নিন"), el("p", { class: "adm-muted" }, "সব গল্প, খসড়া (ছবিসহ) ও সাইট সেটিংস একটি JSON ফাইলে ডাউনলোড হবে। নিয়মিত ব্যাকআপ রাখুন।"), el("div", { class: "adm-actions" }, exportBtn)),
      el("section", { class: "adm-card" }, el("h2", { class: "adm-h2" }, "ব্যাকআপ থেকে রিস্টোর"), el("p", { class: "adm-muted" }, "আগে ডাউনলোড করা JSON ফাইল বেছে নিন। যাচাইয়ের পর নিশ্চিত করতে বলা হবে; কিছুই নিঃশব্দে ওভাররাইট হবে না।"), el("label", { for: "backup-file", class: "adm-label" }, "ব্যাকআপ ফাইল (.json)"), file, importMsg),
      el("section", { class: "adm-card" }, el("h2", { class: "adm-h2" }, "sitemap.xml"), el("p", { class: "adm-muted" }, "সার্চ ইঞ্জিনের জন্য সব গল্পের লিংকসহ sitemap তৈরি করে ডাউনলোড করুন; তারপর GitHub-এ আপলোড করুন।"), el("div", { class: "adm-actions" }, sitemapBtn)),
      el("section", { class: "adm-card" }, el("h2", { class: "adm-h2" }, "পুরনো সাইটের গল্প আপগ্রেড"), el("p", { class: "adm-muted" }, "আগের index.html থেকে Firestore-এ সেভ হওয়া গল্প নতুন সাইটে না দেখালে এটি চালান। কোনো ডেটা মুছবে না।"), el("div", { class: "adm-actions" }, migrateBtn)),
      out
    );
  }

  return {
    destroy() {
      destroyed = true;
      clearTimeout(redirectTimer);
      try { unsubscribe?.(); } catch (e) { console.warn(e); }
    }
  };
}
