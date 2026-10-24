/* ==========================================================================
   article.js - আর্টিকেল দেখানোর অংশ (পাবলিক সাইট ও অ্যাডমিন প্রিভিউ একই কোড ব্যবহার করে,
   তাই প্রিভিউ আর আসল পাতা সবসময় এক রকম দেখায়)।
   ========================================================================== */
import { el, fmtDateTime } from "./ui.js";
import { safeUrl } from "./model.js";

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]।])/g;

export function inlineNodes(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const u = safeUrl(m[0]);
    out.push(u ? el("a", { href: u, target: "_blank", rel: "noopener noreferrer nofollow" }, m[0]) : m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderBody(text) {
  const wrap = el("div", { class: "prose" });
  for (const block of String(text).split(/\n{2,}/)) {
    const b = block.trim();
    if (!b) continue;
    if (b.startsWith("## ")) {
      wrap.append(el("h2", {}, b.slice(3).trim()));
    } else if (b.startsWith("> ")) {
      wrap.append(el("blockquote", {}, inlineNodes(b.split("\n").map((l) => l.replace(/^>\s?/, "")).join(" "))));
    } else {
      const p = el("p");
      b.split("\n").forEach((line, i) => {
        if (i) p.append(el("br"));
        p.append(...inlineNodes(line));
      });
      wrap.append(p);
    }
  }
  return wrap;
}

/**
 * ছবির ফ্রেমিং (non-destructive crop) → CSS। crop = { x, y, zoom } (model.normalizeCrop-এ যাচাই করা)।
 * মূল ছবির ফাইল/ডেটা বদলায় না; শুধু object-position ও scale বদলায়।
 */
export function cropStyle(crop) {
  if (!crop || typeof crop !== "object") return null;
  const x = Number(crop.x), y = Number(crop.y), z = Number(crop.zoom);
  if (![x, y, z].every(Number.isFinite)) return null;
  return `object-position:${x}% ${y}%;transform-origin:${x}% ${y}%;transform:scale(${z})`;
}

/**
 * আর্টিকেলের মূল অংশ।
 * back: "ফিরে যান" বাটন (বা null), categoryNode: ক্যাটেগরির লিংক/লেবেল, actions: নিচের অতিরিক্ত বাটন
 */
export function buildArticle(story, { back = null, categoryNode, actions = [] } = {}) {
  const meta = [story.author && `লেখক: ${story.author}`, story.source && `সূত্র: ${story.source}`].filter(Boolean);
  return el(
    "article",
    { class: "article" },
    back,
    el("div", {}, categoryNode || el("span", { class: "kicker" }, story.category)),
    el("h1", {}, story.title),
    story.summary ? el("p", { class: "standfirst" }, story.summary) : null,
    el(
      "div",
      { class: "byline meta" },
      ...meta.flatMap((m) => [el("span", {}, m), el("span", { class: "sep", "aria-hidden": "true" }, "|")]),
      el("time", { datetime: story.publishedAt.toISOString() }, fmtDateTime(story.publishedAt))
    ),
    story.image
      ? el(
          "figure",
          { class: "article-figure" },
          el("div", { class: "article-frame" }, el("img", { src: story.image, alt: story.title, decoding: "async", fetchpriority: "high", style: cropStyle(story.imageCrop) }))
        )
      : null,
    renderBody(story.content),
    el(
      "div",
      { class: "article-links" },
      story.sourceUrl ? el("a", { class: "btn", href: story.sourceUrl, target: "_blank", rel: "noopener noreferrer" }, "মূল সূত্র দেখুন") : null,
      story.facebookUrl ? el("a", { class: "btn btn-ghost", href: story.facebookUrl, target: "_blank", rel: "noopener noreferrer" }, "Facebook পোস্ট") : null,
      ...actions
    )
  );
}
