/* ==========================================================================
   firebase.js - Firebase Authentication + Firestore (modular SDK, CDN)
   এই ফাইল ডেটা পড়া/লেখার সব কাজ করে। আসল নিরাপত্তা Firestore Rules-এ।
   ========================================================================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, where, orderBy, limit, startAfter, getCountFromServer, serverTimestamp, Timestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

import { ADMIN_EMAIL, firebaseConfig, CATEGORIES, PAGE_SIZE, DEFAULT_SETTINGS } from "./config.js";
import { coerceStory, coerceSettings, makeBackup } from "./model.js";

let app = null;
let auth = null;
let db = null;

/* ---------- সূচনা ---------- */
export function configLooksValid() {
  const text = JSON.stringify(firebaseConfig);
  return !!firebaseConfig.apiKey && !/PASTE_|YOUR_/i.test(text);
}

export function initFirebase() {
  if (db) return;
  if (!configLooksValid()) {
    const e = new Error("Firebase config missing");
    e.code = "voa/config-missing";
    throw e;
  }
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

/* ---------- ডেটা ভার্সন ও ক্যাশ ---------- */
let dataVersion = 0;
export const getDataVersion = () => dataVersion;
const storyCache = new Map();
let settingsCache = null;

function touch() {
  dataVersion++;
  storyCache.clear();
}

/* ---------- ত্রুটির বার্তা (মানুষের পড়ার মতো) ---------- */
export function friendlyError(err) {
  const code = err?.code || "";
  const msg = String(err?.message || "");
  const map = {
    "voa/config-missing": "Firebase কনফিগারেশন বসানো হয়নি। js/config.js ফাইলে firebaseConfig পূরণ করুন।",
    "voa/not-admin": "এই কাজ শুধু অনুমোদিত অ্যাডমিন করতে পারবেন। আবার সাইন ইন করুন।",
    "permission-denied": "অনুমতি নেই (permission denied)। অ্যাডমিন ইমেইল ও Firestore Rules ঠিক আছে কিনা দেখুন।",
    unavailable: "সার্ভারের সাথে যোগাযোগ করা যাচ্ছে না। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।",
    "deadline-exceeded": "সময় শেষ হয়ে গেছে। ইন্টারনেট ধীর হতে পারে; আবার চেষ্টা করুন।",
    "resource-exhausted": "Firebase-এর বিনামূল্যের সীমা (quota) শেষ হয়ে থাকতে পারে। কিছুক্ষণ পরে চেষ্টা করুন।",
    "failed-precondition": "ডেটাবেসের একটি ইনডেক্স দরকার। README-এর ইনডেক্স অংশ দেখুন।",
    "invalid-argument": /size|large|exceed/i.test(msg)
      ? "ডেটা অনেক বড় (Firestore-এ প্রতিটি গল্প সর্বোচ্চ প্রায় ১ MB)। ছবি ছোট করুন।"
      : "পাঠানো ডেটা সঠিক নয়।",
    "not-found": "ডেটা পাওয়া যায়নি।",
    "auth/popup-blocked": "ব্রাউজার লগইন পপআপ আটকে দিয়েছে। এই সাইটের জন্য পপআপ অনুমতি দিয়ে আবার চেষ্টা করুন।",
    "auth/popup-closed-by-user": "লগইন উইন্ডো বন্ধ করে দেওয়া হয়েছে। আবার চেষ্টা করুন।",
    "auth/cancelled-popup-request": "আগের লগইন অনুরোধ বাতিল হয়েছে। আবার চেষ্টা করুন।",
    "auth/network-request-failed": "ইন্টারনেট সংযোগে সমস্যা। সংযোগ দেখে আবার চেষ্টা করুন।",
    "auth/unauthorized-domain": "এই ডোমেইন Firebase-এ অনুমোদিত নয়। Firebase Console > Authentication > Settings > Authorized domains-এ সাইটের হোস্টনেম যোগ করুন।",
    "auth/operation-not-allowed": "Firebase-এ Google Sign-In চালু করা হয়নি। Authentication > Sign-in method থেকে Google চালু করুন।",
    "auth/too-many-requests": "অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।",
    "auth/internal-error": "লগইনে অভ্যন্তরীণ সমস্যা হয়েছে। পরে আবার চেষ্টা করুন।"
  };
  if (map[code]) return map[code];
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "ইন্টারনেট সংযোগ নেই।";
  return "কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।";
}
/* ---------- Authentication ---------- */
export function isAdminUser(user) {
  return (
    !!user &&
    user.emailVerified === true &&
    typeof user.email === "string" &&
    user.email.trim().toLowerCase() === ADMIN_EMAIL.trim().toLowerCase()
  );
}

export function watchAuth(callback, onError) {
  return onAuthStateChanged(auth, callback, onError);
}

export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export function logout() {
  return signOut(auth);
}

export function currentUser() {
  return auth?.currentUser || null;
}

function requireAdmin() {
  if (!isAdminUser(auth?.currentUser)) {
    const e = new Error("not admin");
    e.code = "voa/not-admin";
    throw e;
  }
}

/* ---------- গল্প পড়া ---------- */
function toStory(snap) {
  const r = coerceStory(snap.data(), snap.id);
  if (r.error) {
    console.warn("[VOA] গল্প বাদ দেওয়া হলো:", r.error);
    return null;
  }
  storyCache.set(r.story.id, r.story);
  return r.story;
}

const storiesCol = () => collection(db, "stories");

/**
 * Pager: LATEST (category = null) বা নির্দিষ্ট ক্যাটেগরির গল্প পাতা ধরে আনে।
 * ক্যাটেগরির জন্য কম্পোজিট ইনডেক্স না থাকলে নিজে থেকেই ক্লায়েন্ট-সাইড বিকল্পে চলে যায়।
 */
class StoryPager {
  constructor(category, pageSize) {
    this.category = category;
    this.pageSize = pageSize;
    this.items = [];
    this.done = false;
    this.loading = false;
    this.version = dataVersion;
    this._cursor = null;
    this._mode = "server";
    this._pool = null;
    this._offset = 0;
  }

  async loadMore() {
    if (this.done || this.loading) return [];
    this.loading = true;
    try {
      let batch;
      if (this._mode === "server") {
        try {
          batch = await this._serverPage();
        } catch (e) {
          if (this.category && e?.code === "failed-precondition") {
            console.warn("[VOA] কম্পোজিট ইনডেক্স নেই; সাময়িক বিকল্পে চলছে। README-তে ইনডেক্স তৈরির নিয়ম দেখুন।", e);
            this._mode = "client";
            batch = await this._clientPage();
          } else {
            throw e;
          }
        }
      } else {
        batch = await this._clientPage();
      }
      this.items.push(...batch);
      return batch;
    } finally {
      this.loading = false;
    }
  }

  async _serverPage() {
    const parts = [];
    if (this.category) parts.push(where("category", "==", this.category));
    parts.push(orderBy("publishedAt", "desc"));
    if (this._cursor) parts.push(startAfter(this._cursor));
    parts.push(limit(this.pageSize));
    const snap = await getDocs(query(storiesCol(), ...parts));
    if (snap.docs.length) this._cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < this.pageSize) this.done = true;
    return snap.docs.map(toStory).filter(Boolean);
  }

  async _clientPage() {
    if (!this._pool) {
      const snap = await getDocs(query(storiesCol(), where("category", "==", this.category)));
      this._pool = snap.docs.map(toStory).filter(Boolean).sort((a, b) => b.publishedAt - a.publishedAt);
    }
    const batch = this._pool.slice(this._offset, this._offset + this.pageSize);
    this._offset += batch.length;
    if (this._offset >= this._pool.length) this.done = true;
    return batch;
  }
}

export function createPager(category = null, pageSize = PAGE_SIZE) {
  return new StoryPager(category, pageSize);
}

export async function fetchFeatured(max = 10) {
  const snap = await getDocs(query(storiesCol(), where("featured", "==", true), limit(max)));
  return snap.docs.map(toStory).filter(Boolean).sort((a, b) => b.publishedAt - a.publishedAt);
}

export async function fetchStory(id) {
  if (storyCache.has(id)) return storyCache.get(id);
  const snap = await getDoc(doc(db, "stories", id));
  if (!snap.exists()) return null;
  return toStory(snap);
}

export function getCachedStory(id) {
  return storyCache.get(id) || null;
}

/* ---------- সেটিংস ---------- */
export async function getSettings({ strict = false } = {}) {
  if (settingsCache && !strict) return settingsCache;
  try {
    const snap = await getDoc(doc(db, "settings", "site"));
    settingsCache = coerceSettings(snap.exists() ? snap.data() : {});
  } catch (e) {
    if (strict) throw e;
    console.warn("[VOA] সেটিংস পড়া যায়নি; ডিফল্ট ব্যবহার হচ্ছে।", e);
    return coerceSettings({});
  }
  return settingsCache;
}

export async function saveSettings(data) {
  requireAdmin();
  const clean = coerceSettings(data);
  await setDoc(doc(db, "settings", "site"), { ...clean, updatedAt: serverTimestamp() });
  settingsCache = clean;
  touch();
  return clean;
}

/* ---------- অ্যাডমিন: গল্প লেখা ---------- */
function writable(story, { creating }) {
  const out = {
    title: story.title,
    category: story.category,
    summary: story.summary,
    content: story.content,
    author: story.author || "",
    source: story.source || "",
    sourceUrl: story.sourceUrl || "",
    facebookUrl: story.facebookUrl || "",
    image: story.image || "",
    imageCrop: story.image && story.imageCrop ? story.imageCrop : null,
    featured: !!story.featured,
    publishedAt: Timestamp.fromDate(story.publishedAt),
    updatedAt: serverTimestamp()
  };
  if (creating) out.createdAt = story.createdAt ? Timestamp.fromDate(story.createdAt) : serverTimestamp();
  return out;
}

/** id = null হলে নতুন গল্প। validateStoryInput().data পাঠাতে হবে। */
export async function saveStory(id, data) {
  requireAdmin();
  const creating = !id;
  const ref = creating ? doc(storiesCol()) : doc(db, "stories", id);
  await setDoc(ref, writable(data, { creating }), { merge: true });
  touch();
  return ref.id;
}

export async function deleteStory(id) {
  requireAdmin();
  await deleteDoc(doc(db, "stories", id));
  touch();
}

export async function setFeatured(id, value) {
  requireAdmin();
  await setDoc(doc(db, "stories", id), { featured: !!value, updatedAt: serverTimestamp() }, { merge: true });
  touch();
}

/* ---------- অ্যাডমিন: খসড়া (আলাদা `drafts` collection; পাবলিকে কখনো দেখা যায় না) ---------- */
const draftsCol = () => collection(db, "drafts");

function toDraft(snap) {
  const r = coerceStory(snap.data(), snap.id);
  if (r.error) {
    console.warn("[VOA] খসড়া বাদ দেওয়া হলো:", r.error);
    return null;
  }
  return r.story;
}

/** id = null হলে নতুন খসড়া। validateDraftInput().data পাঠাতে হবে। */
export async function saveDraft(id, data) {
  requireAdmin();
  const creating = !id;
  const ref = creating ? doc(draftsCol()) : doc(db, "drafts", id);
  await setDoc(ref, writable(data, { creating }), { merge: true });
  touch();
  return ref.id;
}

export async function fetchDrafts() {
  requireAdmin();
  const snap = await getDocs(draftsCol());
  return snap.docs
    .map(toDraft)
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || b.publishedAt) - (a.updatedAt || a.publishedAt));
}

export async function deleteDraft(id) {
  requireAdmin();
  await deleteDoc(doc(db, "drafts", id));
  touch();
}

/** খসড়া (বা নতুন ফর্ম) প্রকাশ: stories-এ লেখা + খসড়া মোছা, একটি atomic batch-এ */
export async function publishFromForm(draftId, data) {
  requireAdmin();
  const id = draftId || doc(storiesCol()).id;
  const batch = writeBatch(db);
  batch.set(doc(db, "stories", id), writable(data, { creating: true }));
  if (draftId) batch.delete(doc(db, "drafts", draftId));
  await batch.commit();
  touch();
  return id;
}

/** প্রকাশিত গল্প খসড়ায় ফেরত নেওয়া (পাবলিক সাইট থেকে সরে যায়); atomic */
export async function unpublishStory(story) {
  requireAdmin();
  const batch = writeBatch(db);
  batch.set(doc(db, "drafts", story.id), writable(story, { creating: true }));
  batch.delete(doc(db, "stories", story.id));
  await batch.commit();
  touch();
}

/* ---------- অ্যাডমিন: পরিসংখ্যান (সার্ভার-গণনা, ছবি ডাউনলোড হয় না) ---------- */
export async function countStories() {
  requireAdmin();
  const count = async (q) => (await getCountFromServer(q)).data().count;
  const [total, ordered, featured, drafts, ...perCat] = await Promise.all([
    count(storiesCol()),
    count(query(storiesCol(), orderBy("publishedAt"))),
    count(query(storiesCol(), where("featured", "==", true))),
    count(draftsCol()).catch(() => 0),   // Rules এখনো আপডেট না হলে ০ দেখাবে, বাকি সব চলবে
    ...CATEGORIES.map((c) => count(query(storiesCol(), where("category", "==", c))))
  ]);
  const byCategory = {};
  CATEGORIES.forEach((c, i) => (byCategory[c] = perCat[i]));
  return { total, featured, drafts, byCategory, legacy: Math.max(0, total - ordered) };
}

export async function fetchAllStories() {
  requireAdmin();
  const snap = await getDocs(storiesCol());
  return snap.docs.map(toStory).filter(Boolean).sort((a, b) => b.publishedAt - a.publishedAt);
}

/* ---------- ব্যাকআপ / রিস্টোর / পুরনো ডেটা আপগ্রেড ---------- */
export async function exportBackup() {
  const [stories, settings] = await Promise.all([fetchAllStories(), getSettings({ strict: true })]);
  let drafts = [];
  try {
    drafts = await fetchDrafts();
  } catch (e) {
    console.warn("[VOA] খসড়া ব্যাকআপে যায়নি (Rules আপডেট করেছেন?)", e);
  }
  return makeBackup(stories, settings, drafts);
}

async function inChunks(items, size, worker, onProgress) {
  let done = 0;
  for (let i = 0; i < items.length; i += size) {
    const part = items.slice(i, i + size);
    await Promise.all(part.map(worker));
    done += part.length;
    onProgress?.(done, items.length);
  }
}

export async function importBackup({ stories, drafts = [], settings, replace, onProgress }) {
  requireAdmin();
  let removed = 0;
  if (replace) {
    const keep = new Set(stories.map((s) => s.id));
    const snap = await getDocs(storiesCol());
    const doomed = snap.docs.filter((d) => !keep.has(d.id));
    await inChunks(doomed, 5, (d) => deleteDoc(d.ref));
    removed = doomed.length;
  }
  await inChunks(
    stories,
    5,
    (s) => setDoc(doc(db, "stories", s.id), writable(s, { creating: true })),
    onProgress
  );
  if (drafts.length) {
    await inChunks(drafts, 5, (s) => setDoc(doc(db, "drafts", s.id), writable(s, { creating: true })));
  }
  if (settings) {
    await setDoc(doc(db, "settings", "site"), { ...coerceSettings(settings), updatedAt: serverTimestamp() });
    settingsCache = null;
  }
  touch();
  return { written: stories.length, drafts: drafts.length, removed };
}

/** পুরনো index.html-এ সেভ করা গল্পগুলোকে নতুন ফরম্যাটে রূপান্তর করে */
export async function migrateLegacyStories(onProgress) {
  requireAdmin();
  const snap = await getDocs(storiesCol());
  const todo = snap.docs.filter((d) => typeof d.data().publishedAt?.toDate !== "function");
  let migrated = 0;
  let skipped = 0;
  await inChunks(
    todo,
    5,
    async (d) => {
      const r = coerceStory(d.data(), d.id);
      if (r.error) {
        skipped++;
        console.warn("[VOA] আপগ্রেড বাদ:", r.error);
        return;
      }
      await setDoc(d.ref, writable(r.story, { creating: true }));
      migrated++;
    },
    onProgress
  );
  touch();
  return { migrated, skipped };
}

export { DEFAULT_SETTINGS };
