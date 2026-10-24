/* ==========================================================================
   VOICE OF AMIN (VOA) - কনফিগারেশন
   এই ফাইলই একমাত্র জায়গা যেখানে আপনাকে মান বদলাতে হবে।
   ========================================================================== */

/* -------------------------------------------------------------------------
   1) ADMIN_EMAIL  ← শুধু এই Google account অ্যাডমিন হতে পারবে।
   ⚠ firestore.rules ফাইলেও একই ইমেইল বসাতে হবে (সেটাই আসল নিরাপত্তা)।
   ------------------------------------------------------------------------- */
export const ADMIN_EMAIL = "aminulibrahim356@gmail.com";

/* -------------------------------------------------------------------------
   2) FIREBASE কনফিগারেশন  ← Firebase Console > Project settings > Your apps
   (এগুলো Web App config; এটি গোপন চাবি নয়। Service-account key কখনোই এখানে দেবেন না।)
   ------------------------------------------------------------------------- */
export const firebaseConfig = {
  apiKey: "AIzaSyDs7IKQqVTKh8FHtySds12edw504a2gHk",
  authDomain: "voice-of-amin.firebaseapp.com",
  projectId: "voice-of-amin",
  storageBucket: "voice-of-amin.firebasestorage.app",
  messagingSenderId: "365336074615",
  appId: "1:365336074615:web:5e9a6f0fab5c06eb24a972"
};

/* -------------------------------------------------------------------------
   3) SITE_URL  ← আপনার চূড়ান্ত GitHub Pages ঠিকানা (শেষে / ছাড়া)
   উদাহরণ: https://YOUR_GITHUB_PAGES_HOSTNAME/voice-of-amin
   ⚠ sitemap.xml ও robots.txt ফাইলেও একই ঠিকানা বসাতে হবে (README দেখুন)।
   ------------------------------------------------------------------------- */
export const SITE_URL = "https://amin356-bd.github.io/voice-of-amin";

/* ---- সাধারণ সেটিং (সাধারণত বদলাতে হয় না) ---------------------------- */
export const TIMEZONE = "Asia/Dhaka";        // তারিখ/সময় দেখানোর টাইমজোন
export const TIMEZONE_OFFSET = "+06:00";     // অ্যাডমিন ফর্মে দেওয়া সময় এই অফসেটে ধরা হয়

export const CATEGORIES = ["VOICE", "TREND", "INSIGHT"];   // LATEST ক্যাটেগরি নয়
export const CATEGORY_LABEL = { VOICE: "VOICE", TREND: "TREND", INSIGHT: "INSIGHT" };
export const PAGE_SIZE = 12;                 // একবারে কতগুলো গল্প লোড হবে

/* ছবির সীমা: Firestore-এর প্রতিটি ডকুমেন্ট সর্বোচ্চ ~১ MB, তাই ছবি ছোট রাখা হয় */
export const IMAGE_MAX_EDGE = 1280;          // px (লম্বা দিক)
export const IMAGE_TARGET_BYTES = 170 * 1024;   // কম্প্রেস করার লক্ষ্য
export const IMAGE_HARD_LIMIT_BYTES = 650 * 1024; // এর বেশি হলে সেভ হবে না
export const LOGO_HARD_LIMIT_BYTES = 200 * 1024;
export const IMAGE_WARN_INPUT_BYTES = 4 * 1024 * 1024; // বড় ফাইল দিলে সতর্কবার্তা

/* ব্র্যান্ডের ডিফল্ট লেখা (অ্যাডমিন > সাইট সেটিংস থেকে বদলানো যায়) */
export const DEFAULT_SETTINGS = {
  brandName: "VOICE OF AMIN",
  tagline: "TREND • VOICE • INSIGHT",
  founder: "Md. Aminul Islam",
  aboutTitle: "VOICE OF AMIN",
  aboutDescription:
    "Voice Of Amin একটি স্বাধীন সম্পাদকীয় প্ল্যাটফর্ম, যেখানে ট্রেন্ড, ভয়েস ও ইনসাইট নিয়ে কাজ করা হয়।",
  footerDescription:
    "একটি স্বাধীন সম্পাদকীয় প্ল্যাটফর্ম। ট্রেন্ড, ভয়েস ও ইনসাইট।",
  trendIntro: "আলোচনায় থাকা বিষয়, ঘটনা, অগ্রগতি ও জনস্বার্থসংশ্লিষ্ট প্রবণতা।",
  voiceIntro: "বক্তব্য, কণ্ঠস্বর, গুরুত্বপূর্ণ দৃষ্টিভঙ্গি ও উদ্ধৃত অবস্থান।",
  insightIntro: "বিশ্লেষণ, প্রেক্ষাপট, ব্যাখ্যা ও গভীর বোঝাপড়া।",
  facebookUrl: "",
  whatsappUrl: "",
  logoLight: "",   // ঐচ্ছিক: সাদা ব্যাকগ্রাউন্ডের জন্য নিজের লোগো (খালি = অফিসিয়াল লোগো)
  logoDark: ""     // ঐচ্ছিক: কালো ব্যাকগ্রাউন্ডের জন্য নিজের লোগো
};
