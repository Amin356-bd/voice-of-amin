# Voice Of Amin (VOA) - ওয়েবসাইট

TREND • VOICE • INSIGHT - GitHub Pages + Firebase (Google Sign-In + Firestore) দিয়ে চলা স্বাধীন সম্পাদকীয় সাইট।
কোনো সার্ভার, Node.js বা PHP লাগে না।

## ফাইল কাঠামো

```
index.html          মূল পাতা (সব রুট এখান দিয়েই চলে)
404.html            GitHub Pages-এ সরাসরি /trend, /article/xyz, /admin খুললে কাজ করার জন্য (বদলাবেন না)
css/style.css       পাবলিক সাইটের স্টাইল
css/admin.css       অ্যাডমিন স্টাইল (শুধু /admin-এ লোড হয়)
js/config.js        ★ আপনাকে শুধু এই ফাইল বদলাতে হবে (ADMIN_EMAIL, Firebase config, SITE_URL)
js/firebase.js      Firebase Auth + Firestore
js/model.js         ডেটা যাচাই, ব্যাকআপ নিয়ম
js/ui.js            সাহায্যকারী (তারিখ, ছবি কম্প্রেশন, ডায়ালগ)
js/app.js           পাবলিক সাইট ও রাউটার
js/admin.js         অ্যাডমিন প্যানেল
fonts/              UNBangla Regular/Bold (আপনার দেওয়া ফন্ট)
assets/             অফিসিয়াল VOA লোগো (সাদা/কালো), OG ছবি, আইকন
firestore.rules     ★ Firestore Security Rules (Firebase Console-এ পেস্ট করতে হবে)
robots.txt, sitemap.xml
```

## আপনাকে কোথায় কী বদলাতে হবে (৩টি জিনিস)

| # | কী | কোথায় |
|---|----|--------|
| 1 | **ADMIN_EMAIL** | `js/config.js` **এবং** `firestore.rules` (দুই জায়গায় একই ইমেইল) |
| 2 | **Firebase config** | `js/config.js` → `firebaseConfig` |
| 3 | **SITE_URL / GitHub Pages ঠিকানা** | `js/config.js` → `SITE_URL`; এবং `index.html`, `sitemap.xml`, `robots.txt`-এ একই ঠিকানা (Find & Replace করুন) |

> আপনার পুরনো `index.html` থেকে নিয়ে আমি এই মানগুলো আগে থেকেই বসিয়ে রেখেছি:
> ইমেইল `aminulibrahim356@gmail.com`, Firebase প্রজেক্ট `voice-of-amin`, সাইট `https://amin356-bd.github.io/voice-of-amin`।
> ভুল থাকলে উপরের জায়গাগুলোতে ঠিক করে নিন।

## ধাপে ধাপে সেটআপ

### ১. Firebase প্রজেক্ট তৈরি
1. https://console.firebase.google.com খুলুন, Google account দিয়ে ঢুকুন।
2. **Add project** চাপুন, নাম দিন (যেমন `voice-of-amin`)। Analytics বন্ধ রাখলেও চলবে।

### ২. Google Authentication চালু
1. বাম মেনু: **Build > Authentication > Get started**।
2. **Sign-in method** ট্যাবে **Google** বেছে **Enable** করুন, সাপোর্ট ইমেইল দিন, **Save**।

### ৩. Authorized domain যোগ (খুব জরুরি)
1. **Authentication > Settings > Authorized domains**।
2. **Add domain** চাপুন এবং দিন: `amin356-bd.github.io` (শুধু হোস্টনেম; `https://` বা `/voice-of-amin` ছাড়া)।
3. না করলে লগইনে `auth/unauthorized-domain` ত্রুটি আসবে।

### ৪. Firestore ডেটাবেস তৈরি
1. **Build > Firestore Database > Create database**।
2. মোড: **Production mode**, লোকেশন বেছে নিন (যেমন `asia-south1`), **Enable**।

### ৫. Security Rules বসান
1. Firestore Database > **Rules** ট্যাব।
2. `firestore.rules` ফাইলের **পুরো লেখা** পেস্ট করুন। ফাইলের ভেতরের ইমেইল আপনার অ্যাডমিন ইমেইলের সাথে মিলিয়ে নিন।
3. **Publish** চাপুন।

নিয়ম সংক্ষেপে: সবাই গল্প ও সেটিংস **পড়তে** পারে; **লিখতে/মুছতে** পারে শুধু যাচাইকৃত অ্যাডমিন ইমেইল। `allow write: if true` কোথাও নেই।

### ৬. Firebase Web App config নিন
1. Project settings (গিয়ার আইকন) > **General** > **Your apps** > **Web (`</>`)**।
2. অ্যাপের নাম দিয়ে Register করুন; দেখানো `firebaseConfig`-এর মানগুলো `js/config.js`-এ বসান।
3. **কখনো service-account private key** কোনো ফাইলে দেবেন না।

### ৭. ADMIN_EMAIL ও SITE_URL
`js/config.js` খুলে ঠিক করুন:
```js
export const ADMIN_EMAIL = "আপনার-gmail@gmail.com";
export const SITE_URL = "https://YOUR_GITHUB_PAGES_HOSTNAME/voice-of-amin";
```

### ৮. GitHub-এ আপলোড
1. github.com-এ রিপোজিটরি তৈরি করুন: নাম **`voice-of-amin`** (Public)।
2. এই প্রজেক্টের **ভেতরের সব ফাইল ও ফোল্ডার** (ফোল্ডারটি নিজে নয়) রিপোজিটরির মূলে আপলোড করুন (**Add file > Upload files**)।
   `index.html` ও `404.html` যেন সরাসরি মূল ফোল্ডারে থাকে।

### ৯. GitHub Pages চালু
1. Repository > **Settings > Pages**।
2. **Source: Deploy from a branch**, **Branch: `main`**, **Folder: `/ (root)`**, **Save**।
3. ১-২ মিনিট পরে সাইট `https://amin356-bd.github.io/voice-of-amin/` ঠিকানায় চালু হবে।

### ১০. Admin-এ ঢোকা
1. `https://amin356-bd.github.io/voice-of-amin/admin` খুলুন (এটি **বুকমার্ক** করে রাখুন)। পাবলিক সাইটে কোনো Admin বাটন নেই।
2. **Google দিয়ে সাইন ইন করুন** চাপুন, অ্যাডমিন Gmail বেছে নিন।
3. অন্য কোনো Gmail হলে "Access denied" দেখাবে, সাথে সাথে সাইন আউট হবে।

### ১১. গল্প যোগ / এডিট / মোছা
- **নতুন গল্প**: শিরোনাম, ক্যাটেগরি (VOICE/TREND/INSIGHT), সারসংক্ষেপ, পূর্ণ লেখা, তারিখ-সময়, ছবি দিয়ে **প্রকাশ করুন**। গল্প নিজে থেকে **LATEST**-এ এবং নিজের ক্যাটেগরিতে আসে।
- **এডিট/মোছা/Featured**: **গল্পসমূহ** ট্যাবে প্রতিটি গল্পের পাশে বাটন আছে। মোছার আগে নিশ্চিত করতে বলা হয়।
- লেখায় ফাঁকা লাইন = নতুন অনুচ্ছেদ; `## ` দিয়ে শুরু = উপশিরোনাম; `> ` দিয়ে শুরু = উদ্ধৃতি।
- **ছবি**: আপলোড করা ছবি স্বয়ংক্রিয়ভাবে ছোট করে WebP/JPEG বানানো হয় (Firebase Storage লাগে না)। বড় ফাইল হলে সতর্কবার্তা দেখায়; খুব বড় হলে সেভ হয় না। বিকল্প: ছবির https লিংক দিন।
- **সাইট সেটিংস**: ব্র্যান্ড, ট্যাগলাইন, About, ফুটার, সেকশন পরিচিতি, Facebook/WhatsApp লিংক। খালি ফিল্ড সাইটে লুকানো থাকে।

### ১২. ব্যাকআপ / রিস্টোর
- **ব্যাকআপ ডাউনলোড (JSON)**: সব গল্প ও সেটিংস। নিয়মিত নিন।
- **রিস্টোর**: ফাইল বাছার পর যাচাই হয়, কী হবে তা দেখিয়ে নিশ্চিত করতে বলে। ডিফল্ট মার্জ; "সম্পূর্ণ প্রতিস্থাপন" আলাদা সতর্কতার পর।
- **পুরনো গল্প আপগ্রেড**: আগের `index.html` দিয়ে Firestore-এ সেভ হওয়া গল্প নতুন সাইটে না দেখালে চালান (ড্যাশবোর্ডেও নোটিশ আসে)।
- **sitemap.xml তৈরি**: গল্পের লিংকসহ sitemap ডাউনলোড করে রিপোজিটরিতে বদলে দিন।

### ১২ক. খসড়া, প্রিভিউ ও ছবির ফ্রেমিং (নতুন)

- **খসড়া:** এডিটরে "খসড়া সংরক্ষণ" চাপলে লেখা আলাদা `drafts` কালেকশনে যায়; পাবলিক সাইটে কখনো দেখা যায় না। গল্প তালিকায় "প্রকাশিত / খসড়া" বাটনে দুটো আলাদা দেখা যায়। খসড়া থেকে "প্রকাশ করুন" দিলে একই ধাপে (atomic) গল্প তৈরি হয় ও খসড়া মুছে যায়। প্রকাশিত গল্প "খসড়ায় নিন" দিলে পাবলিক থেকে সরে খসড়ায় ফেরে।
- **প্রিভিউ:** সংরক্ষণ বা প্রকাশ ছাড়াই "প্রিভিউ" বাটনে আসল আর্টিকেল-পাতার মতো দেখা যায় (মোবাইল/ডেস্কটপ)। এটি সুরক্ষিত sandbox-এ চলে।
- **ছবির ফ্রেমিং:** ছবি আপলোডের পর ছবির ওপর ক্লিক/টেনে ফোকাস ঠিক করুন এবং জুম দিন। মূল ছবি কাটা বা বদলানো হয় না; শুধু কোন অংশ দেখাবে তা (x, y, zoom) সংরক্ষণ হয়। "রিসেট" দিলে আগের অবস্থা।
- ⚠ **জরুরি:** নতুন `firestore.rules` আবার Firebase Console > Firestore > Rules-এ পেস্ট করে **Publish** করুন, নইলে খসড়া সংরক্ষণ হবে না (বাকি সাইট ঠিকভাবেই চলবে)।

### ১৩. পরে সাইট আপডেট
GitHub-এ ফাইল বদলে (Upload বা ফাইল এডিট) Commit করুন; ১-২ মিনিটে লাইভ হয়। গল্প যোগ-এডিটে GitHub ছুঁতে হয় না; সবই Admin থেকে।

## ঐচ্ছিক: ইনডেক্স (গল্প অনেক হলে)
ক্যাটেগরি পাতা (VOICE/TREND/INSIGHT) ডিফল্টে ইনডেক্স ছাড়াই চলে। গল্প শতাধিক হলে দ্রুত করতে
Firestore > **Indexes > Composite > Add index**: Collection `stories`, ফিল্ড `category` (Ascending), `publishedAt` (Descending)।

## জানা সীমাবদ্ধতা (সৎভাবে)
- **Facebook শেয়ার কার্ড**: Facebook-এর ক্রলার JavaScript চালায় না, তাই যেকোনো গল্পের লিংক শেয়ার করলে সাধারণ সাইটের কার্ড (লোগো ও সাধারণ বর্ণনা) দেখাবে, গল্পের নিজস্ব শিরোনাম/ছবি নয়। এটি সার্ভারবিহীন সাইটের সীমা।
- **SEO**: Google JavaScript চালায়, তবে GitHub Pages-এ সরাসরি ডিপ-লিংক 404.html হয়ে আসে; ইনডেক্সিং ধীর বা অসম্পূর্ণ হতে পারে। কাস্টম ডোমেইন ও Search Console সাহায্য করে।
- **robots.txt** শুধু ডোমেইনের মূলে কাজ করে; `github.io/voice-of-amin/` প্রজেক্ট সাইটে সার্চ ইঞ্জিন এটি পড়ে না। `/admin` পাতায় অবশ্য `noindex` দেওয়া আছে।
- ছবি Firestore-এ রাখা হয় (সর্বোচ্চ ≈ ৬৫০ KB প্রতি ছবি); অনেক ছবির সাইট ধীর হতে পারে। ভবিষ্যতে Firebase Storage যোগ করা যাবে।

## টেস্ট চেকলিস্ট
**পাবলিক**
- [ ] হোমপেজ লোড হয়; গল্প না থাকলে "এখনো কোনো গল্প প্রকাশিত হয়নি" দেখায়
- [ ] LATEST, VOICE, TREND, INSIGHT, ABOUT ঠিকমতো খোলে; বর্তমান পাতা মেনুতে চিহ্নিত
- [ ] গল্পে ক্লিক করলে আর্টিকেল খোলে; ফিরে যান/ব্রাউজার ব্যাক কাজ করে
- [ ] পাতা রিফ্রেশ ও সরাসরি লিংক (যেমন `/trend`) কাজ করে
- [ ] বাংলা ফন্ট ঠিক দেখায়; ৩৬০px মোবাইলে সাইডওয়ে স্ক্রল নেই

**অ্যাডমিন**
- [ ] `/admin` -> Google সাইন ইন দেখায়; পাবলিক হোমে Admin বাটন নেই
- [ ] অ্যাডমিন Gmail -> ড্যাশবোর্ড; অন্য Gmail -> "Access denied" + সাইন আউট
- [ ] নতুন গল্প সেভ -> LATEST ও সঠিক ক্যাটেগরিতে আসে
- [ ] এডিট সেভ থাকে; মোছার আগে নিশ্চিতকরণ; Featured বদলায়
- [ ] সেটিংস বদলালে পাবলিক সাইটে আপডেট হয়
- [ ] ব্যাকআপ ডাউনলোড ও রিস্টোর কাজ করে
- [ ] লগআউট -> পাবলিক সাইটে ফেরে
- [ ] অন্য ডিভাইসে একই ডেটা দেখা যায়

## সমস্যা হলে
| সমস্যা | সমাধান |
|--------|--------|
| `auth/unauthorized-domain` | ধাপ ৩: Authorized domains-এ `amin356-bd.github.io` যোগ করুন |
| `permission-denied` | ধাপ ৫: Rules Publish করেছেন কিনা এবং ইমেইল মিলছে কিনা দেখুন |
| লগইন পপআপ খোলে না | ব্রাউজারে পপআপ অনুমতি দিন |
| "Firebase কনফিগারেশন বসানো হয়নি" | `js/config.js`-এ `firebaseConfig` পূরণ করুন |
| `/trend` সরাসরি খুললে ফাঁকা | `404.html` রিপোজিটরির মূলে আছে কিনা দেখুন |
| পুরনো গল্প দেখা যাচ্ছে না | Admin > ব্যাকআপ > "পুরনো গল্প আপগ্রেড করুন" |
