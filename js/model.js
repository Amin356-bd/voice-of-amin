/* ==========================================================================
   model.js - ডেটার নিয়ম (validation, পুরনো ডেটা রূপান্তর, ব্যাকআপ)
   এই ফাইলে Firebase বা DOM নেই, তাই আলাদাভাবে টেস্ট করা যায়।
   ========================================================================== */
import { CATEGORIES, TIMEZONE_OFFSET, DEFAULT_SETTINGS, IMAGE_HARD_LIMIT_BYTES, LOGO_HARD_LIMIT_BYTES } from "./config.js";

export const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
export const BACKUP_APP = "voice-of-amin";
export const BACKUP_VERSION = 1;

const LIMITS = { title: 220, summary: 700, content: 80000, author: 120, source: 160, url: 1000 };
const IMAGE_DATA_RE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;

/* ---------- ছোট সহায়ক ---------- */
export function str(v) {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

export function isHttpUrl(value) {
  const v = str(value);
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** নিরাপদ URL ফেরত দেয়; অবৈধ হলে খালি স্ট্রিং (javascript: ইত্যাদি বাদ) */
export function safeUrl(value) {
  return isHttpUrl(value) ? new URL(str(value)).href : "";
}

export function normalizeCategory(c) {
  const up = str(c).toUpperCase();
  return CATEGORIES.includes(up) ? up : "";
}

/** data: URL-এর আনুমানিক বাইট (base64 → বাইনারি) */
export function dataUrlBytes(dataUrl) {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export function checkImageValue(value, hardLimit = IMAGE_HARD_LIMIT_BYTES) {
  const v = str(value);
  if (!v) return "";
  if (v.startsWith("data:")) {
    if (!IMAGE_DATA_RE.test(v)) return "ছবির ফরম্যাট সমর্থিত নয় (WebP/JPEG/PNG ব্যবহার করুন)।";
    if (dataUrlBytes(v) > hardLimit) return "ছবির সাইজ অনেক বড়। ছোট বা কম্প্রেসড ছবি ব্যবহার করুন।";
    return "";
  }
  if (!isHttpUrl(v)) return "ছবির লিংক সঠিক নয় (https:// দিয়ে শুরু হতে হবে)।";
  return "";
}

/**
 * ছবির ফ্রেমিং (non-destructive crop): মূল ছবি অপরিবর্তিত থাকে; শুধু কোন অংশ দেখানো হবে তা মনে রাখা হয়।
 * x, y = ফোকাস বিন্দু (০-১০০%), zoom = ১-৩ গুণ। ডিফল্ট হলে null (কিছু সংরক্ষিত হয় না)।
 */
export function normalizeCrop(raw) {
  if (!raw || typeof raw !== "object") return null;
  const num = (v, lo, hi, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const x = Math.round(num(raw.x, 0, 100, 50) * 10) / 10;
  const y = Math.round(num(raw.y, 0, 100, 50) * 10) / 10;
  const zoom = Math.round(num(raw.zoom, 1, 3, 1) * 100) / 100;
  return x === 50 && y === 50 && zoom === 1 ? null : { x, y, zoom };
}

/** Date বা ISO/মিলিসেকেন্ড থেকে Date; না পারলে null */
export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v === "number") {
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }
  return null;
}

/* ---------- অ্যাডমিন ফর্ম যাচাই ---------- */
export function buildPublishedAt(dateStr, timeStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "") || !/^\d{2}:\d{2}$/.test(timeStr || "")) return null;
  const d = new Date(`${dateStr}T${timeStr}:00${TIMEZONE_OFFSET}`);
  return isNaN(d) ? null : d;
}

export function validateStoryInput(raw) {
  const errors = {};
  const data = {
    title: str(raw.title),
    category: normalizeCategory(raw.category),
    summary: str(raw.summary),
    content: String(raw.content ?? "").replace(/\r\n/g, "\n").trim(),
    author: str(raw.author),
    source: str(raw.source),
    sourceUrl: str(raw.sourceUrl),
    facebookUrl: str(raw.facebookUrl),
    image: str(raw.image),
    imageCrop: null,
    featured: !!raw.featured,
    publishedAt: buildPublishedAt(raw.date, raw.time)
  };
  data.imageCrop = data.image ? normalizeCrop(raw.imageCrop) : null;

  if (!data.title) errors.title = "শিরোনাম লিখুন।";
  else if (data.title.length > LIMITS.title) errors.title = `শিরোনাম সর্বোচ্চ ${LIMITS.title} অক্ষরের হতে পারবে।`;

  if (!data.category) errors.category = "ক্যাটেগরি বেছে নিন (VOICE, TREND বা INSIGHT)।";

  if (!data.summary) errors.summary = "সারসংক্ষেপ লিখুন।";
  else if (data.summary.length > LIMITS.summary) errors.summary = `সারসংক্ষেপ সর্বোচ্চ ${LIMITS.summary} অক্ষরের হতে পারবে।`;

  if (!data.content) errors.content = "পূর্ণ লেখা (article) লিখুন।";
  else if (data.content.length > LIMITS.content) errors.content = "লেখা অনেক বড়; ছোট করুন বা ভাগ করুন।";

  if (data.author.length > LIMITS.author) errors.author = "লেখকের নাম অনেক বড়।";
  if (data.source.length > LIMITS.source) errors.source = "সোর্সের নাম অনেক বড়।";

  for (const f of ["sourceUrl", "facebookUrl"]) {
    if (data[f]) {
      if (data[f].length > LIMITS.url || !isHttpUrl(data[f])) errors[f] = "সঠিক লিংক দিন (https:// দিয়ে শুরু)।";
      else data[f] = safeUrl(data[f]);
    }
  }

  if (!data.publishedAt) errors.date = "প্রকাশের তারিখ ও সময় সঠিকভাবে দিন।";

  const imgErr = checkImageValue(data.image);
  if (imgErr) errors.image = imgErr;

  return { ok: Object.keys(errors).length === 0, errors, data };
}

/* ---------- খসড়া (Draft): শুধু শিরোনাম বাধ্যতামূলক, বাকি শিথিল ---------- */
function lenientData(raw) {
  const d = {
    title: str(raw.title),
    category: normalizeCategory(raw.category) || "TREND",
    summary: str(raw.summary),
    content: String(raw.content ?? "").replace(/\r\n/g, "\n").trim(),
    author: str(raw.author),
    source: str(raw.source),
    sourceUrl: str(raw.sourceUrl),
    facebookUrl: str(raw.facebookUrl),
    image: str(raw.image),
    featured: !!raw.featured,
    publishedAt: buildPublishedAt(raw.date, raw.time) || new Date()
  };
  d.imageCrop = d.image ? normalizeCrop(raw.imageCrop) : null;
  return d;
}

export function validateDraftInput(raw) {
  const errors = {};
  const data = lenientData(raw);
  if (!data.title) errors.title = "খসড়ার জন্যও একটি শিরোনাম দিন।";
  else if (data.title.length > LIMITS.title) errors.title = `শিরোনাম সর্বোচ্চ ${LIMITS.title} অক্ষরের হতে পারবে।`;
  if (data.summary.length > LIMITS.summary) errors.summary = `সারসংক্ষেপ সর্বোচ্চ ${LIMITS.summary} অক্ষরের হতে পারবে।`;
  if (data.content.length > LIMITS.content) errors.content = "লেখা অনেক বড়; ছোট করুন বা ভাগ করুন।";
  if (data.author.length > LIMITS.author) errors.author = "লেখকের নাম অনেক বড়।";
  if (data.source.length > LIMITS.source) errors.source = "সোর্সের নাম অনেক বড়।";
  for (const f of ["sourceUrl", "facebookUrl"]) {
    if (data[f]) {
      if (data[f].length > LIMITS.url || !isHttpUrl(data[f])) errors[f] = "সঠিক লিংক দিন (https:// দিয়ে শুরু)।";
      else data[f] = safeUrl(data[f]);
    }
  }
  const imgErr = checkImageValue(data.image);
  if (imgErr) errors.image = imgErr;
  return { ok: Object.keys(errors).length === 0, errors, data };
}

/** প্রিভিউর জন্য: কোনো ত্রুটিতে থামে না; অবৈধ অংশ বাদ দিয়ে দেখনযোগ্য গল্প বানায় */
export function previewStory(raw) {
  const d = lenientData(raw);
  return {
    id: "preview",
    ...d,
    title: d.title || "(শিরোনাম এখনো দেওয়া হয়নি)",
    sourceUrl: safeUrl(d.sourceUrl),
    facebookUrl: safeUrl(d.facebookUrl),
    image: checkImageValue(d.image) ? "" : d.image,
    imageCrop: checkImageValue(d.image) ? null : d.imageCrop,
    createdAt: null,
    updatedAt: null
  };
}

/* ---------- Firestore/ব্যাকআপ থেকে আসা গল্প (নতুন ও পুরনো সাইটের ফরম্যাট) ---------- */
/**
 * raw: Firestore ডকুমেন্টের ডেটা বা ব্যাকআপের এক এন্ট্রি।
 * পুরনো index.html-এর ফিল্ড (cat, body, meta, date, createdAt সংখ্যা) ও সমর্থিত।
 * ফেরত: স্বাভাবিকীকৃত গল্প, অথবা { error } যদি ব্যবহারযোগ্য না হয়।
 */
export function coerceStory(raw, id) {
  if (!raw || typeof raw !== "object") return { error: "গল্পটি অবৈধ।" };
  const storyId = str(id ?? raw.id);
  if (!ID_RE.test(storyId)) return { error: `অবৈধ ID: "${storyId.slice(0, 40)}"` };

  const legacy = raw.category == null && raw.cat != null;
  const category = normalizeCategory(raw.category ?? raw.cat);
  const title = str(raw.title);
  if (!title) return { error: `"${storyId}": শিরোনাম নেই।` };
  if (!category) return { error: `"${storyId}": ক্যাটেগরি অবৈধ।` };

  let source = str(raw.source);
  let sourceUrl = str(raw.sourceUrl);
  if (legacy && isHttpUrl(source) && !sourceUrl) {
    sourceUrl = source;
    source = "";
  }

  const publishedAt = toDate(raw.publishedAt) || toDate(raw.createdAt) || toDate(raw.updatedAt);
  if (!publishedAt) return { error: `"${storyId}": প্রকাশের সময় নেই।` };

  const image = str(raw.image);
  const imgErr = checkImageValue(image);

  return {
    story: {
      id: storyId,
      title,
      category,
      summary: str(raw.summary),
      content: String(raw.content ?? raw.body ?? "").replace(/\r\n/g, "\n").trim(),
      author: str(raw.author ?? raw.meta),
      source,
      sourceUrl: safeUrl(sourceUrl),
      facebookUrl: safeUrl(raw.facebookUrl),
      image: imgErr ? "" : image,
      imageCrop: imgErr || !image ? null : normalizeCrop(raw.imageCrop),
      featured: raw.featured === true,
      publishedAt,
      createdAt: toDate(raw.createdAt),
      updatedAt: toDate(raw.updatedAt)
    },
    imageDropped: !!imgErr && !!image
  };
}

/* ---------- সাইট সেটিংস ---------- */
export function coerceSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const pick = (...vals) => {
    for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
    return "";
  };
  const d = DEFAULT_SETTINGS;
  const logoOk = (v) => {
    const s = str(v);
    return s && !checkImageValue(s, LOGO_HARD_LIMIT_BYTES) ? s : "";
  };
  return {
    brandName: pick(r.brandName, r.name) || d.brandName,
    tagline: pick(r.tagline) || d.tagline,
    founder: pick(r.founder) || d.founder,
    aboutTitle: pick(r.aboutTitle) || d.aboutTitle,
    aboutDescription: pick(r.aboutDescription, r.about) || d.aboutDescription,
    footerDescription: pick(r.footerDescription, r.footerLabel) || d.footerDescription,
    trendIntro: pick(r.trendIntro) || d.trendIntro,
    voiceIntro: pick(r.voiceIntro) || d.voiceIntro,
    insightIntro: pick(r.insightIntro) || d.insightIntro,
    facebookUrl: safeUrl(pick(r.facebookUrl, r.facebook)),
    whatsappUrl: safeUrl(pick(r.whatsappUrl, r.whatsapp)),
    logoLight: logoOk(r.logoLight ?? r.logo),
    logoDark: logoOk(r.logoDark)
  };
}

export function validateSettingsInput(raw) {
  const errors = {};
  const s = coerceSettings(raw);
  const empty = (k) => !str(raw[k]);
  if (empty("brandName")) errors.brandName = "ব্র্যান্ডের নাম দিন।";
  for (const [field, label] of [["facebookUrl", "Facebook"], ["whatsappUrl", "WhatsApp/যোগাযোগ"]]) {
    const v = str(raw[field]);
    if (v && !isHttpUrl(v)) errors[field] = `${label} লিংক সঠিক নয় (https:// দিয়ে শুরু করুন)।`;
  }
  return { ok: Object.keys(errors).length === 0, errors, data: s };
}

/* ---------- ব্যাকআপ ---------- */
export function storyToBackup(s) {
  const iso = (d) => (toDate(d) ? toDate(d).toISOString() : null);
  return {
    id: s.id,
    title: s.title,
    category: s.category,
    summary: s.summary,
    content: s.content,
    author: s.author,
    source: s.source,
    sourceUrl: s.sourceUrl,
    facebookUrl: s.facebookUrl,
    image: s.image,
    imageCrop: s.imageCrop || null,
    featured: !!s.featured,
    publishedAt: iso(s.publishedAt),
    createdAt: iso(s.createdAt),
    updatedAt: iso(s.updatedAt)
  };
}

export function makeBackup(stories, settings, drafts = []) {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    stories: stories.map(storyToBackup),
    drafts: drafts.map(storyToBackup),
    settings: coerceSettings(settings)
  };
}

/** JSON টেক্সট যাচাই করে {stories, settings, problems, imagesDropped} ফেরত দেয়; মারাত্মক ভুল হলে Error ছোঁড়ে */
export function parseBackup(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("ফাইলটি সঠিক JSON নয়।");
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("ব্যাকআপ ফাইলের কাঠামো সঠিক নয়।");
  if (json.app && json.app !== BACKUP_APP) throw new Error("এটি Voice Of Amin-এর ব্যাকআপ ফাইল নয়।");
  if (json.version != null && Number(json.version) > BACKUP_VERSION) throw new Error("ব্যাকআপটি নতুন ভার্সনের; এই সাইট সেটি পড়তে পারবে না।");
  if (!Array.isArray(json.stories)) throw new Error('ব্যাকআপে "stories" তালিকা নেই।');

  const stories = [];
  const problems = [];
  const seen = new Set();
  let imagesDropped = 0;
  for (const raw of json.stories) {
    const r = coerceStory(raw);
    if (r.error) {
      problems.push(r.error);
      continue;
    }
    if (seen.has(r.story.id)) {
      problems.push(`"${r.story.id}": একই ID দুইবার আছে।`);
      continue;
    }
    seen.add(r.story.id);
    if (r.imageDropped) imagesDropped++;
    stories.push(r.story);
  }
  if (!stories.length && json.stories.length) throw new Error("ব্যাকআপের কোনো গল্পই ব্যবহারযোগ্য নয়। " + problems.slice(0, 3).join(" "));

  const drafts = [];
  if (Array.isArray(json.drafts)) {
    for (const raw of json.drafts) {
      const r = coerceStory(raw);
      if (r.error) problems.push(`খসড়া ${r.error}`);
      else if (!seen.has(`d:${r.story.id}`)) {
        seen.add(`d:${r.story.id}`);
        drafts.push(r.story);
      }
    }
  }

  const settings = json.settings && typeof json.settings === "object" ? coerceSettings(json.settings) : null;
  return { stories, drafts, settings, problems, imagesDropped };
}
