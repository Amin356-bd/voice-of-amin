/* ==========================================================================
   app.js - পাবলিক সাইট: রাউটার (History API), হোম, লিস্ট, আর্টিকেল, About, SEO
   /admin রুটে admin.js আলাদাভাবে লোড হয় (শুধু দরকার হলে)।
   ========================================================================== */
import { SITE_URL, CATEGORIES, PAGE_SIZE } from "./config.js";
import { $, $$, el, clear, toast, relTime, fmtDate, fmtDateTime, fmtWeekday, toBn } from "./ui.js";
import { coerceSettings, isHttpUrl } from "./model.js";
import { buildArticle, cropStyle } from "./article.js";

const BASE = window.__VOA_BASE || "/";
const SITE = SITE_URL.replace(/\/+$/, "");
const main = $("#main");

let fb = null;          // Firebase মডিউল (ব্যর্থ হলে null)
let fbError = null;
let settings = coerceSettings({});
let renderToken = 0;
let adminHandle = null;
let firstRender = true;

const pagers = new Map();
const previews = new Map();

/* ======================================================================
   Firebase লোড (ধীরে, ব্যর্থ হলে সাইট ভেঙে পড়ে না)
   ====================================================================== */
const fbReady = (async () => {
  try {
    const mod = await import("./firebase.js");
    mod.initFirebase();
    fb = mod;
    settings = await mod.getSettings();
    applySettings();
  } catch (e) {
    fbError = e;
    console.error("[VOA] Firebase চালু করা যায়নি:", e);
  }
})();

/* ======================================================================
   URL ও লিংক সহায়ক
   ====================================================================== */
const href = (path = "") => BASE + path;
const link = (path, props = {}, ...kids) => el("a", { href: href(path), "data-link": "", ...props }, ...kids);

function currentRoute() {
  let p = location.pathname;
  p = p.startsWith(BASE) ? p.slice(BASE.length) : p.replace(/^\//, "");
  p = p.replace(/index\.html$/i, "");
  const parts = p.split("/").filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  return { name: (parts[0] || "").toLowerCase(), id: parts[1] || "", parts };
}

const depth = () => (history.state && history.state.depth) || 0;

function navigate(path = "", { replace = false } = {}) {
  const url = href(path);
  if (location.pathname === url && !location.search && !replace) {
    render({ scrollTop: true });
    return;
  }
  history.replaceState({ ...(history.state || {}), y: window.scrollY }, "");
  const state = { depth: replace ? depth() : depth() + 1 };
  history[replace ? "replaceState" : "pushState"](state, "", url);
  render({ scrollTop: true });
}

document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest("a[data-link]");
  if (!a || (a.target && a.target !== "_self")) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith(BASE)) return;
  e.preventDefault();
  navigate(url.pathname.slice(BASE.length));
});

window.addEventListener("popstate", () => render({ restore: true }));

/* ======================================================================
   SEO: meta, canonical, Open Graph, JSON-LD
   ====================================================================== */
function setTag(selector, create, attr, value) {
  let node = $(selector);
  if (!node) {
    node = create();
    document.head.append(node);
  }
  node.setAttribute(attr, value);
}
const metaName = (name, v) => setTag(`meta[name="${name}"]`, () => el("meta", { name }), "content", v);
const metaProp = (prop, v) => setTag(`meta[property="${prop}"]`, () => el("meta", { property: prop }), "content", v);

function setMeta({ title = "", description = "", path = "", image = "", type = "website", noindex = false }) {
  const full = title ? `${title} | ${settings.brandName}` : `${settings.brandName} | ${settings.tagline}`;
  const desc = (description || settings.aboutDescription).replace(/\s+/g, " ").slice(0, 200);
  const url = `${SITE}/${path}`;
  const img = image && isHttpUrl(image) ? image : `${SITE}/assets/og-image.png`;
  document.title = full;
  metaName("description", desc);
  metaName("robots", noindex ? "noindex,nofollow" : "index,follow,max-image-preview:large");
  setTag('link[rel="canonical"]', () => el("link", { rel: "canonical" }), "href", url);
  metaProp("og:title", full);
  metaProp("og:description", desc);
  metaProp("og:url", url);
  metaProp("og:type", type);
  metaProp("og:image", img);
  metaProp("og:site_name", settings.brandName);
  metaName("twitter:card", "summary_large_image");
  metaName("twitter:title", full);
  metaName("twitter:description", desc);
  metaName("twitter:image", img);
}

function setPageLd(obj) {
  const node = $("#ld-page");
  if (node) node.textContent = obj ? JSON.stringify(obj) : "";
}

function updateSiteLd() {
  const node = $("#ld-site");
  if (!node) return;
  const org = {
    "@type": "Organization",
    "@id": `${SITE}/#org`,
    name: settings.brandName,
    alternateName: "VOA",
    url: `${SITE}/`,
    logo: `${SITE}/assets/logo-black.png`
  };
  if (settings.founder) org.founder = { "@type": "Person", name: settings.founder };
  if (settings.facebookUrl) org.sameAs = [settings.facebookUrl];
  const site = {
    "@type": "WebSite",
    "@id": `${SITE}/#website`,
    name: settings.brandName,
    url: `${SITE}/`,
    inLanguage: "bn",
    publisher: { "@id": `${SITE}/#org` }
  };
  node.textContent = JSON.stringify({ "@context": "https://schema.org", "@graph": [org, site] });
}

/* ======================================================================
   সেটিংস প্রয়োগ (হেডার/ফুটার)
   ====================================================================== */
function applySettings() {
  $("#brand-logo").src = settings.logoLight || href("assets/logo-black.png");
  $("#footer-logo").src = settings.logoDark || href("assets/logo-white.png");
  $("#topbar-tagline").textContent = settings.tagline;
  $("#footer-desc").textContent = settings.footerDescription;
  $("#footer-copy").textContent = `© ${toBn(new Date().getFullYear())} ${settings.brandName}`;
  $("#footer-founder").textContent = settings.founder ? `Founder & Creator: ${settings.founder}` : "";

  const list = $("#footer-social-list");
  clear(list);
  const items = [
    settings.facebookUrl && ["Facebook পেজ", settings.facebookUrl],
    settings.whatsappUrl && ["WhatsApp / যোগাযোগ", settings.whatsappUrl]
  ].filter(Boolean);
  for (const [label, url] of items) {
    list.append(el("li", {}, el("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, label)));
  }
  $("#footer-social").hidden = items.length === 0;
  updateSiteLd();
}

function setActiveNav(name) {
  for (const a of $$("[data-nav]")) {
    if (a.dataset.nav === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

/* ======================================================================
   সাধারণ UI অংশ
   ====================================================================== */
function commit(token, ...nodes) {
  if (token !== renderToken) return false;
  clear(main);
  main.append(...nodes);
  return true;
}

function mediaTile(story, { eager = false } = {}) {
  const tile = el("div", { class: "media" + (story.image ? "" : " noimg"), "aria-hidden": "true" });
  const placeholder = () => {
    tile.classList.add("noimg");
    clear(tile).append(el("img", { src: href("assets/logo-white.png"), alt: "", loading: "lazy" }));
  };
  if (story.image) {
    tile.append(
      el("img", {
        src: story.image, alt: "", decoding: "async", style: cropStyle(story.imageCrop),
        loading: eager ? "eager" : "lazy", fetchpriority: eager ? "high" : null,
        onError: placeholder
      })
    );
  } else {
    tile.append(el("img", { src: href("assets/logo-white.png"), alt: "", loading: "lazy" }));
  }
  return tile;
}

function storyCard(s) {
  return link(
    `article/${encodeURIComponent(s.id)}`,
    { class: "card" },
    mediaTile(s),
    el("span", { class: "kicker" }, s.category),
    el("h3", { class: "card-title" }, s.title),
    s.summary ? el("p", { class: "card-sum" }, s.summary) : null,
    el("div", { class: "meta" }, relTime(s.publishedAt))
  );
}

function stateBox({ title, text, actions = [] }) {
  return el("div", { class: "wrap" }, el("div", { class: "state", role: "status" }, el("h1", {}, title), text ? el("p", {}, text) : null, ...actions));
}

function errorState(err, retry) {
  const friendly = (fb && fb.friendlyError ? fb.friendlyError(err) : null) || "কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।";
  const msg = fbError
    ? fbError.code === "voa/config-missing"
      ? "Firebase কনফিগারেশন বসানো হয়নি। js/config.js ফাইল দেখুন।"
      : "ডেটাবেস সংযোগ চালু করা যায়নি। ইন্টারনেট সংযোগ দেখে পাতাটি রিলোড করুন।"
    : friendly;
  return stateBox({
    title: "লোড করা যায়নি",
    text: msg,
    actions: [el("button", { type: "button", class: "btn", onClick: () => (fbError ? location.reload() : retry()) }, fbError ? "রিলোড করুন" : "আবার চেষ্টা করুন")]
  });
}

function skeletonGrid(n = 6) {
  return el("div", { class: "grid", "aria-hidden": "true" }, Array.from({ length: n }, () => el("div", {}, el("div", { class: "skel skel-card" }), el("div", { class: "skel skel-line" }), el("div", { class: "skel skel-line", style: "width:70%" }))));
}

/* ======================================================================
   ডেটা সহায়ক (ক্যাশসহ pager)
   ====================================================================== */
function getPager(cat) {
  const key = cat || "LATEST";
  let p = pagers.get(key);
  if (!p || p.version !== fb.getDataVersion()) {
    p = fb.createPager(cat, PAGE_SIZE);
    pagers.set(key, p);
  }
  return p;
}

function getPreview(cat) {
  let p = previews.get(cat);
  if (!p || p.version !== fb.getDataVersion()) {
    p = fb.createPager(cat, 4);
    previews.set(cat, p);
  }
  return p;
}

/* ======================================================================
   ভিউ: হোম
   ====================================================================== */
async function homeView(token) {
  setMeta({ title: "", description: settings.aboutDescription, path: "" });
  setPageLd(null);
  commit(token, el("div", { class: "wrap" }, el("div", { class: "skel skel-hero" }), skeletonGrid(3)));
  await fbReady;
  if (!fb) return void commit(token, errorState(fbError));

  const latest = getPager(null);
  if (!latest.items.length && !latest.done) await latest.loadMore();
  if (token !== renderToken) return;

  if (!latest.items.length) {
    return void commit(
      token,
      stateBox({
        title: "এখনো কোনো গল্প প্রকাশিত হয়নি",
        text: "নতুন লেখা প্রকাশিত হলে এখানে দেখা যাবে। কিছুক্ষণ পরে আবার দেখুন।",
        actions: [link("about", { class: "btn btn-ghost" }, "আমাদের সম্পর্কে")]
      })
    );
  }

  let featured = [];
  try { featured = await fb.fetchFeatured(5); } catch (e) { console.warn("[VOA] ফিচার্ড পড়া যায়নি", e); }
  const hero = featured[0] || latest.items[0];
  const rest = latest.items.filter((s) => s.id !== hero.id);
  const rail = rest.slice(0, 4);
  let gridItems = rest.slice(4, 10);
  if (gridItems.length > 3) gridItems = gridItems.slice(0, gridItems.length - (gridItems.length % 3)); // গ্রিডে একা কার্ড এড়াতে

  const catItems = {};
  await Promise.all(
    CATEGORIES.map(async (cat) => {
      const have = latest.items.filter((s) => s.category === cat);
      if (have.length >= 4 || latest.done) {
        catItems[cat] = have.slice(0, 4);
        return;
      }
      try {
        const pv = getPreview(cat);
        if (!pv.items.length && !pv.done) await pv.loadMore();
        catItems[cat] = pv.items.slice(0, 4);
      } catch (e) {
        console.warn("[VOA] বিভাগ পড়া যায়নি", cat, e);
        catItems[cat] = have.slice(0, 4);
      }
    })
  );
  if (token !== renderToken) return;

  const nodes = [];

  /* ফিচার্ড + সর্বশেষ র‍্যাইল */
  nodes.push(
    el(
      "section",
      { class: "wrap hero" + (rail.length ? "" : " no-rail"), "aria-label": "প্রধান খবর" },
      link(
        `article/${encodeURIComponent(hero.id)}`,
        { class: "lead" },
        mediaTile(hero, { eager: true }),
        el(
          "div",
          { class: "lead-body" },
          el("span", { class: "kicker" }, `${hero.featured ? "FEATURED • " : ""}${hero.category}`),
          el("h2", { class: "lead-title" }, hero.title),
          hero.summary ? el("p", { class: "lead-sum" }, hero.summary) : null,
          el("div", { class: "meta" }, [hero.author || hero.source, relTime(hero.publishedAt)].filter(Boolean).join(" · "))
        )
      ),
      rail.length
        ? el(
            "aside",
            { class: "latest-rail", "aria-label": "সর্বশেষ" },
            el("h2", { class: "rail-title" }, "LATEST"),
            ...rail.map((s) =>
              link(`article/${encodeURIComponent(s.id)}`, { class: "rail-item" }, el("span", { class: "kicker" }, s.category), el("h3", {}, s.title), el("div", { class: "meta" }, relTime(s.publishedAt)))
            )
          )
        : null
    )
  );

  /* সর্বশেষ গ্রিড */
  if (gridItems.length) {
    nodes.push(
      el(
        "section",
        { class: "wrap section", "aria-labelledby": "h-latest" },
        sectionHead("LATEST", "সব ক্যাটেগরির নতুন গল্প", "latest", "h-latest"),
        el("div", { class: "grid" }, gridItems.map(storyCard))
      )
    );
  }

  /* TREND */
  if (catItems.TREND.length) {
    nodes.push(
      el(
        "section",
        { class: "wrap section", "aria-labelledby": "h-trend" },
        sectionHead("TREND", settings.trendIntro, "trend", "h-trend"),
        el(
          "div",
          { class: "trend-list" },
          catItems.TREND.map((s, i) =>
            link(`article/${encodeURIComponent(s.id)}`, { class: "trend-item" }, el("span", { class: "trend-num", "aria-hidden": "true" }, toBn(String(i + 1).padStart(2, "0"))), el("div", {}, el("h3", {}, s.title), el("div", { class: "meta" }, relTime(s.publishedAt))))
          )
        )
      )
    );
  }

  /* VOICE */
  if (catItems.VOICE.length) {
    nodes.push(
      el(
        "section",
        { class: "wrap section", "aria-labelledby": "h-voice" },
        sectionHead("VOICE", settings.voiceIntro, "voice", "h-voice"),
        el(
          "div",
          { class: "voice-grid" },
          catItems.VOICE.map((s) =>
            link(
              `article/${encodeURIComponent(s.id)}`,
              { class: "voice-card" },
              el("span", { class: "voice-mark", "aria-hidden": "true" }, "“"),
              el("h3", {}, s.title),
              el(
                "div",
                { class: "voice-foot" },
                s.image ? el("span", { class: "voice-avatar" }, el("img", { src: s.image, alt: "", loading: "lazy", decoding: "async", style: cropStyle(s.imageCrop) })) : null,
                el("div", { class: "meta" }, [s.author || s.source, relTime(s.publishedAt)].filter(Boolean).join(" · "))
              )
            )
          )
        )
      )
    );
  }

  /* INSIGHT */
  if (catItems.INSIGHT.length) {
    nodes.push(
      el(
        "section",
        { class: "band-dark", "aria-labelledby": "h-insight" },
        el("div", { class: "wrap section" }, sectionHead("INSIGHT", settings.insightIntro, "insight", "h-insight"), el("div", { class: "grid" }, catItems.INSIGHT.slice(0, 3).map(storyCard)))
      )
    );
  }

  commit(token, ...nodes);
}

function sectionHead(title, intro, path, id) {
  return el("div", { class: "section-head" }, el("h2", { id }, title), intro ? el("p", {}, intro) : null, link(path, { class: "link-arrow", "aria-label": `${title} - সব দেখুন` }, "সব দেখুন →"));
}

/* ======================================================================
   ভিউ: LATEST ও ক্যাটেগরি লিস্ট
   ====================================================================== */
async function listView(token, cat) {
  const label = cat || "LATEST";
  const intro = { VOICE: settings.voiceIntro, TREND: settings.trendIntro, INSIGHT: settings.insightIntro }[cat] || "সব ক্যাটেগরির সর্বশেষ প্রকাশিত গল্প, নতুন থেকে পুরনো ক্রমে।";
  setMeta({ title: label, description: intro, path: label.toLowerCase() });
  setPageLd(null);

  const head = el("div", { class: "page-head" }, el("span", { class: "kicker" }, cat ? "CATEGORY" : "FEED"), el("h1", {}, label), el("p", {}, intro));
  const body = el("div", { class: "wrap page" }, head, skeletonGrid(6));
  commit(token, body);

  await fbReady;
  if (!fb) return void commit(token, errorState(fbError));

  const pager = getPager(cat);
  try {
    if (!pager.items.length && !pager.done) await pager.loadMore();
  } catch (e) {
    console.error(e);
    return void commit(token, errorState(e, () => render()));
  }
  if (token !== renderToken) return;

  clear(body).append(head);
  if (!pager.items.length) {
    body.append(el("div", { class: "state" }, el("h2", {}, cat ? "এই বিভাগে এখনো কোনো গল্প নেই" : "এখনো কোনো গল্প প্রকাশিত হয়নি"), el("p", {}, "নতুন লেখা প্রকাশিত হলে এখানে দেখা যাবে।"), link("", { class: "btn btn-ghost" }, "হোমপেজে ফিরুন")));
    return;
  }
  const grid = el("div", { class: "grid" }, pager.items.map(storyCard));
  const moreWrap = el("div", { class: "more" });
  const moreBtn = el("button", { type: "button", class: "btn btn-ghost" }, "আরও দেখুন");
  moreBtn.addEventListener("click", async () => {
    if (pager.loading) return;
    moreBtn.disabled = true;
    moreBtn.textContent = "লোড হচ্ছে...";
    try {
      const batch = await pager.loadMore();
      if (token !== renderToken) return;
      grid.append(...batch.map(storyCard));
      if (!batch.length) toast("আর কোনো গল্প নেই।", "info");
    } catch (e) {
      console.error(e);
      toast(fb.friendlyError(e), "error");
    } finally {
      moreBtn.disabled = false;
      moreBtn.textContent = "আরও দেখুন";
      moreWrap.hidden = pager.done;
    }
  });
  moreWrap.append(moreBtn);
  moreWrap.hidden = pager.done;
  body.append(grid, moreWrap);
}

/* ======================================================================
   ভিউ: আর্টিকেল
   ====================================================================== */
async function shareStory(story) {
  const url = location.href;
  try {
    if (navigator.share) {
      await navigator.share({ title: story.title, text: story.summary || story.title, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast("লিংক কপি হয়েছে।", "success");
  } catch (e) {
    if (e && e.name === "AbortError") return;
    toast("লিংক কপি করা যায়নি। ঠিকানা বার থেকে কপি করুন।", "warn");
  }
}

async function articleView(token, id) {
  setMeta({ title: "লোড হচ্ছে...", path: `article/${id}`, noindex: true });
  setPageLd(null);
  commit(token, el("div", { class: "wrap page" }, el("div", { class: "article" }, el("div", { class: "skel skel-line", style: "height:40px;width:90%" }), el("div", { class: "skel skel-hero" }))));
  await fbReady;
  if (!fb) return void commit(token, errorState(fbError));

  let story;
  try {
    story = await fb.fetchStory(id);
  } catch (e) {
    console.error(e);
    return void commit(token, errorState(e, () => render()));
  }
  if (token !== renderToken) return;
  if (!story) {
    setMeta({ title: "গল্প পাওয়া যায়নি", path: `article/${id}`, noindex: true });
    return void commit(token, stateBox({ title: "গল্পটি পাওয়া যায়নি", text: "লিংকটি ভুল হতে পারে অথবা গল্পটি সরিয়ে ফেলা হয়েছে।", actions: [link("latest", { class: "btn" }, "সর্বশেষ গল্প দেখুন")] }));
  }

  setMeta({ title: story.title, description: story.summary || story.content, path: `article/${encodeURIComponent(story.id)}`, image: story.image, type: "article" });
  setPageLd(articleLd(story));

  const back = el("button", { type: "button", class: "back-link", onClick: () => (depth() > 0 ? history.back() : navigate(story.category.toLowerCase(), { replace: true })) }, "← ফিরে যান");
  const article = buildArticle(story, {
    back,
    categoryNode: link(story.category.toLowerCase(), { class: "kicker" }, story.category),
    actions: [el("button", { type: "button", class: "btn btn-ghost", onClick: () => shareStory(story) }, "শেয়ার করুন")]
  });

  const page = el("div", { class: "wrap page" }, article);
  commit(token, page);

  /* সম্পর্কিত গল্প (ধীরে লোড) */
  try {
    const pv = getPreview(story.category);
    if (!pv.items.length && !pv.done) await pv.loadMore();
    const related = pv.items.filter((s) => s.id !== story.id).slice(0, 3);
    if (token === renderToken && related.length) {
      page.append(el("section", { class: "related", "aria-labelledby": "h-related" }, el("div", { class: "section-head" }, el("h2", { id: "h-related" }, "আরও পড়ুন")), el("div", { class: "grid" }, related.map(storyCard))));
    }
  } catch (e) {
    console.warn("[VOA] সম্পর্কিত গল্প আনা যায়নি", e);
  }
}

function articleLd(s) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: s.title.slice(0, 110),
    description: s.summary || undefined,
    datePublished: s.publishedAt.toISOString(),
    dateModified: (s.updatedAt || s.publishedAt).toISOString(),
    articleSection: s.category,
    inLanguage: "bn",
    mainEntityOfPage: `${SITE}/article/${encodeURIComponent(s.id)}`,
    author: s.author ? { "@type": "Person", name: s.author } : { "@id": `${SITE}/#org` },
    publisher: { "@id": `${SITE}/#org` }
  };
  if (isHttpUrl(s.image)) ld.image = [s.image];
  if (s.sourceUrl) ld.isBasedOn = s.sourceUrl;
  return ld;
}

/* ======================================================================
   ভিউ: About
   ====================================================================== */
function aboutView(token) {
  setMeta({ title: "ABOUT", description: settings.aboutDescription, path: "about" });
  setPageLd(null);

  const defs = [
    ["VOICE", settings.voiceIntro],
    ["TREND", settings.trendIntro],
    ["INSIGHT", settings.insightIntro],
    ["LATEST", "সব বিভাগের সর্বশেষ প্রকাশিত গল্প, নতুন থেকে পুরনো ক্রমে।"]
  ];
  const contacts = [
    settings.facebookUrl && ["Facebook পেজ", settings.facebookUrl],
    settings.whatsappUrl && ["WhatsApp / যোগাযোগ", settings.whatsappUrl]
  ].filter(Boolean);

  commit(
    token,
    el(
      "div",
      { class: "wrap page" },
      el("div", { class: "page-head" }, el("span", { class: "kicker" }, "ABOUT"), el("h1", {}, settings.aboutTitle), el("p", {}, settings.tagline)),
      el(
        "div",
        { class: "about-grid" },
        el("div", {}, ...settings.aboutDescription.split(/\n{2,}/).map((t) => el("p", { class: "about-text" }, t)), el("dl", { class: "cat-defs" }, defs.map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, v))))),
        el(
          "aside",
          { "aria-label": "প্রতিষ্ঠাতা" },
          settings.founder ? el("div", { class: "about-card" }, el("h2", {}, "FOUNDER & CREATOR"), el("p", { class: "big" }, settings.founder)) : null,
          contacts.length
            ? el("div", { class: "about-card", style: "margin-top:28px" }, el("h2", {}, "যোগাযোগ"), el("div", { class: "contact-links" }, contacts.map(([label, url]) => el("a", { class: "btn btn-ghost", href: url, target: "_blank", rel: "noopener noreferrer" }, label))))
            : null
        )
      )
    )
  );
}

/* ======================================================================
   ভিউ: ৪০৪
   ====================================================================== */
function notFoundView(token) {
  setMeta({ title: "পাতা পাওয়া যায়নি", path: "", noindex: true });
  setPageLd(null);
  commit(token, stateBox({ title: "পাতাটি পাওয়া যায়নি", text: "আপনি যে ঠিকানাটি খুঁজছেন তা নেই বা সরানো হয়েছে।", actions: [link("", { class: "btn" }, "হোমপেজে ফিরুন")] }));
}

/* ======================================================================
   ভিউ: /admin (আলাদা মডিউল, দরকার হলেই লোড)
   ====================================================================== */
function loadCss(path) {
  const id = "css-" + path.replace(/\W/g, "-");
  if (document.getElementById(id)) return Promise.resolve();
  return new Promise((resolve) => {
    const l = el("link", { rel: "stylesheet", href: href(path), id });
    l.onload = l.onerror = () => resolve();
    document.head.append(l);
  });
}

async function adminView(token) {
  setMeta({ title: "Admin", path: "admin", noindex: true });
  setPageLd(null);
  commit(token, el("div", { class: "wrap" }, el("div", { class: "state" }, el("h1", {}, "লোড হচ্ছে..."))));
  try {
    await loadCss("css/admin.css");
    const mod = await import("./admin.js");
    if (token !== renderToken) return;
    adminHandle = await mod.mountAdmin({
      root: main,
      isCurrent: () => token === renderToken,
      getFirebase: async () => {
        await fbReady;
        return fb;
      },
      getFbError: () => fbError,
      navigate,
      href,
      getSettings: () => settings,
      onSettingsChanged: (s) => {
        settings = s;
        applySettings();
      }
    });
  } catch (e) {
    console.error(e);
    commit(token, errorState(e, () => render()));
  }
}

function teardownAdmin() {
  try { adminHandle?.destroy?.(); } catch (e) { console.warn(e); }
  adminHandle = null;
}

/* ======================================================================
   মূল render
   ====================================================================== */
async function render({ scrollTop = false, restore = false } = {}) {
  const token = ++renderToken;
  teardownAdmin();
  const r = currentRoute();
  const isAdmin = r.name === "admin";
  document.body.dataset.mode = isAdmin ? "admin" : "public";
  setActiveNav(r.name);
  main.setAttribute("aria-busy", "true");

  try {
    if (r.name === "") await homeView(token);
    else if (r.name === "latest") await listView(token, null);
    else if (["voice", "trend", "insight"].includes(r.name)) await listView(token, r.name.toUpperCase());
    else if (r.name === "about") aboutView(token);
    else if (r.name === "article" && r.id) await articleView(token, r.id);
    else if (isAdmin) await adminView(token);
    else notFoundView(token);
  } catch (e) {
    console.error("[VOA] render ত্রুটি:", e);
    if (token === renderToken) commit(token, errorState(e, () => render()));
  } finally {
    if (token === renderToken) main.setAttribute("aria-busy", "false");
  }
  if (token !== renderToken) return;

  if (restore) window.scrollTo(0, (history.state && history.state.y) || 0);
  else if (scrollTop) window.scrollTo(0, 0);
  if (!firstRender && !isAdmin) main.focus({ preventScroll: true });
  firstRender = false;
}

/* ======================================================================
   শুরু
   ====================================================================== */
function boot() {
  history.scrollRestoration = "manual";
  if (!history.state || history.state.depth == null) history.replaceState({ ...(history.state || {}), depth: 0 }, "");

  const now = new Date();
  $("#topbar-date").textContent = `${fmtWeekday(now)}, ${fmtDate(now)}`;
  $("#topbar-date").setAttribute("datetime", now.toISOString().slice(0, 10));
  $("#footer-copy").textContent = `© ${toBn(now.getFullYear())} ${settings.brandName}`;

  const banner = $("#offline-banner");
  const syncOnline = () => (banner.hidden = navigator.onLine !== false);
  window.addEventListener("online", syncOnline);
  window.addEventListener("offline", syncOnline);
  syncOnline();

  let shown = false;
  window.addEventListener("unhandledrejection", (ev) => {
    console.error("[VOA] unhandled:", ev.reason);
    if (!shown) {
      shown = true;
      toast("একটি অপ্রত্যাশিত ত্রুটি হয়েছে। প্রয়োজনে পাতাটি রিফ্রেশ করুন।", "error");
    }
  });

  render();
}

boot();
