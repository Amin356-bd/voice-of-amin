/* ==========================================================================
   ui.js - নিরাপদ DOM সহায়ক, তারিখ/সময়, টোস্ট, ডায়ালগ, ছবি কম্প্রেশন
   ডেটা কখনো innerHTML দিয়ে বসানো হয় না; সবই textContent / DOM node।
   ========================================================================== */
import {
  TIMEZONE, IMAGE_MAX_EDGE, IMAGE_TARGET_BYTES, IMAGE_HARD_LIMIT_BYTES, IMAGE_WARN_INPUT_BYTES
} from "./config.js";

/* ---------- DOM ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "value" || key === "checked" || key === "disabled" || key === "selected") node[key] = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/* ---------- বাংলা সংখ্যা ও তারিখ ---------- */
const BN = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
export const toBn = (n) => String(n).replace(/\d/g, (d) => BN[d]);

const dateFmt = new Intl.DateTimeFormat("bn-BD", { timeZone: TIMEZONE, day: "numeric", month: "long", year: "numeric" });
const shortDateFmt = new Intl.DateTimeFormat("bn-BD", { timeZone: TIMEZONE, day: "numeric", month: "short" });
const weekdayFmt = new Intl.DateTimeFormat("bn-BD", { timeZone: TIMEZONE, weekday: "long" });
const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIMEZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
});

function zoneParts(d) {
  const o = {};
  for (const p of partsFmt.formatToParts(d)) o[p.type] = p.value;
  return o;
}

export const fmtDate = (d) => (d ? dateFmt.format(d) : "");
export const fmtShortDate = (d) => (d ? shortDateFmt.format(d) : "");
export const fmtWeekday = (d) => weekdayFmt.format(d);

/** যেমন "রাত ১০:৩০" */
export function fmtTime(d) {
  if (!d) return "";
  const p = zoneParts(d);
  const h = Number(p.hour);
  const period = h < 4 ? "রাত" : h < 6 ? "ভোর" : h < 12 ? "সকাল" : h < 15 ? "দুপুর" : h < 18 ? "বিকেল" : h < 20 ? "সন্ধ্যা" : "রাত";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${period} ${toBn(h12)}:${toBn(p.minute)}`;
}

export const fmtDateTime = (d) => (d ? `${fmtDate(d)}, ${fmtTime(d)}` : "");

export function relTime(d) {
  if (!d) return "";
  const diff = Date.now() - d.getTime();
  if (diff < 0) return fmtDate(d);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "এইমাত্র";
  if (min < 60) return `${toBn(min)} মিনিট আগে`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${toBn(hr)} ঘণ্টা আগে`;
  return fmtDate(d);
}

/** অ্যাডমিন ফর্মের জন্য: নির্ধারিত টাইমজোনে YYYY-MM-DD ও HH:MM */
export function zoneDateInput(d = new Date()) {
  const p = zoneParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}
export function zoneTimeInput(d = new Date()) {
  const p = zoneParts(d);
  return `${p.hour}:${p.minute}`;
}

export function formatBytes(n) {
  if (n < 1024) return `${toBn(n)} B`;
  if (n < 1048576) return `${toBn(Math.round(n / 1024))} KB`;
  return `${toBn((n / 1048576).toFixed(1))} MB`;
}

/* ---------- টোস্ট (aria-live) ---------- */
export function toast(message, type = "info", ms = 5200) {
  let box = $("#toasts");
  if (!box) {
    box = el("div", { id: "toasts", class: "toasts", "aria-live": "polite", "aria-atomic": "false" });
    document.body.append(box);
  }
  const node = el("div", { class: `toast toast-${type}`, role: type === "error" ? "alert" : "status" }, message);
  box.append(node);
  const remove = () => node.remove();
  node.addEventListener("click", remove);
  if (ms) setTimeout(remove, ms);
  return remove;
}

/* ---------- ডায়ালগ ---------- */
export function confirmDialog({ title, message, confirmText = "নিশ্চিত করুন", cancelText = "বাতিল", danger = false, extra = null }) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const titleId = "dlg-" + Math.random().toString(36).slice(2, 8);
    const done = (v) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      document.body.classList.remove("modal-open");
      previous?.focus?.();
      resolve(v);
    };
    const cancelBtn = el("button", { type: "button", class: "btn btn-ghost", onClick: () => done(false) }, cancelText);
    const okBtn = el("button", { type: "button", class: `btn ${danger ? "btn-danger" : "btn-primary"}`, onClick: () => done(true) }, confirmText);
    const overlay = el(
      "div",
      { class: "modal-overlay", onClick: (e) => e.target === overlay && done(false) },
      el(
        "div",
        { class: "modal", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
        el("h2", { id: titleId, class: "modal-title" }, title),
        el("div", { class: "modal-body" }, typeof message === "string" ? el("p", {}, message) : message, extra),
        el("div", { class: "modal-actions" }, cancelBtn, okBtn)
      )
    );
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(false);
      } else if (e.key === "Tab") {
        const f = [cancelBtn, ...$$("input,select,textarea", overlay), okBtn].filter((x) => !x.disabled);
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.classList.add("modal-open");
    document.body.append(overlay);
    (danger ? cancelBtn : okBtn).focus();
  });
}

/* ---------- ফাইল ডাউনলোড ---------- */
export function downloadFile(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const a = el("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 800);
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("ফাইল পড়া যায়নি।"));
    r.readAsText(file);
  });
}

/* ---------- ছবি কম্প্রেশন ---------- */
const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("ছবি পড়া যায়নি।"));
    r.readAsDataURL(blob);
  });

const canvasBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));

async function loadBitmap(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* নিচের বিকল্পে যাবে */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("ছবিটি খোলা যায়নি।"));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

/**
 * ছবিকে ছোট করে WebP (না পারলে JPEG) বানায়। ঐচ্ছিক: { maxEdge, targetBytes, hardLimit, keepPng }
 * ফেরত: { dataUrl, bytes, width, height, inputBytes, notes: [] }
 */
export async function compressImage(file, opts = {}) {
  const maxEdge = opts.maxEdge || IMAGE_MAX_EDGE;
  const target = opts.targetBytes || IMAGE_TARGET_BYTES;
  const hard = opts.hardLimit || IMAGE_HARD_LIMIT_BYTES;
  const notes = [];

  if (!file || !/^image\/(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.type)) {
    throw new Error("শুধু ছবির ফাইল (JPG, PNG, WebP) দিন। SVG সমর্থিত নয়।");
  }
  if (file.size > 30 * 1024 * 1024) throw new Error("ফাইল অনেক বড় (৩০ MB-এর বেশি)।");
  if (file.size > IMAGE_WARN_INPUT_BYTES) notes.push("ফাইলটি অনেক বড় ছিল; ছোট করে সংরক্ষণ করা হয়েছে। পরেরবার WebP/JPEG ব্যবহার করুন।");

  const bmp = await loadBitmap(file);
  const srcW = bmp.width, srcH = bmp.height;
  let scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const wantAlpha = !!opts.keepPng || /png|webp|gif/i.test(file.type);

  let best = null;
  for (let round = 0; round < 5; round++) {
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!wantAlpha || opts.keepPng === false) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bmp, 0, 0, w, h);

    if (opts.keepPng) {
      const blob = await canvasBlob(canvas, "image/png");
      best = { blob, w, h };
      if (blob.size <= target || round === 4) break;
      scale *= 0.8;
      continue;
    }

    for (const q of [0.82, 0.74, 0.66, 0.58, 0.5]) {
      let blob = await canvasBlob(canvas, "image/webp", q);
      if (!blob || blob.type !== "image/webp") {
        // ব্রাউজার WebP এনকোড করতে পারে না → JPEG (স্বচ্ছতা সাদা করা হবে)
        if (wantAlpha) {
          const c2 = document.createElement("canvas");
          c2.width = w; c2.height = h;
          const x2 = c2.getContext("2d");
          x2.fillStyle = "#fff"; x2.fillRect(0, 0, w, h); x2.drawImage(canvas, 0, 0);
          blob = await canvasBlob(c2, "image/jpeg", q);
        } else {
          blob = await canvasBlob(canvas, "image/jpeg", q);
        }
      }
      best = { blob, w, h };
      if (blob.size <= target) break;
    }
    if (best.blob.size <= target) break;
    scale *= 0.82;
  }
  bmp.close?.();

  if (!best?.blob) throw new Error("ছবি প্রসেস করা যায়নি। অন্য ছবি দিন।");
  if (best.blob.size > hard) {
    throw new Error(`ছবিটি কম্প্রেস করেও ${formatBytes(best.blob.size)} থেকে গেছে; সীমা ${formatBytes(hard)}। সহজ/ছোট ছবি দিন।`);
  }
  if (best.blob.size > target) notes.push(`ছবির সাইজ ${formatBytes(best.blob.size)}; ওয়েবসাইট ধীর হতে পারে। সম্ভব হলে ছোট ছবি দিন।`);

  return {
    dataUrl: await blobToDataUrl(best.blob),
    bytes: best.blob.size,
    width: best.w,
    height: best.h,
    inputBytes: file.size,
    notes
  };
}
