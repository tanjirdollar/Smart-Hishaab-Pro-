# স্মার্ট হিসাব প্রো — নতুন নিরাপদ সেটআপ (৪টি ধাপ)

## ধাপ ১ — Apps Script আপডেট (আপনার "Ay bay" শিটে)
1. "Ay bay" শিট খুলুন → Extensions → Apps Script।
2. Code.gs-এর সব কোড মুছে এই ফোল্ডারের **Code.gs** পুরোটা বসান → Save।
3. বাঁ পাশে ⚙ Project Settings → **Script properties** → Add:
   - নাম: `SH_SECRET`  মান: `grffrNNJLEPFgp3KQbjTIRdAIwobm2paVVKHYAhXr_4`
4. Deploy → **New deployment** → Web app → Execute as: **Me**, Who has access: **Anyone** → Deploy।
5. যে `/exec` URL পাবেন সেটি কপি করুন (ধাপ ৩-এ লাগবে)।
6. (একবার) এডিটরের উপরের ড্রপডাউন থেকে `auditTotals` বেছে Run দিন → Execution log-এ মোট পাওনা দেখুন। **এটি ১৪,৪১০.৫৪ আসা উচিত।**
7. (একবার) `repairData` Run দিন → এটি ঋণের ডুপ্লিকেট ID (TRX-4225) ঠিক করবে ও খালি ডুপ্লিকেট "Status" হেডার পরিষ্কার করবে। কোনো সারি মোছে না, কোনো অঙ্ক বদলায় না।

## ধাপ ২ — GitHub রিপো আপডেট
এই ZIP-এর সব ফাইল আপনার `Smart-Hishaab-Pro-` রিপোতে বসান (পুরোনো ফাইল ওভাররাইট)।
**মুছে দিন:** `server.ts`, `bun.lock`।

## ধাপ ৩ — Vercel-এ Environment Variables (Settings → Environment Variables)
| নাম | মান |
|---|---|
| APPS_SCRIPT_URL | ধাপ ১-এর /exec URL |
| SH_SECRET | `grffrNNJLEPFgp3KQbjTIRdAIwobm2paVVKHYAhXr_4` |
| ALLOWED_EMAILS | tanjir.dollar@gmail.com |
| FIREBASE_PROJECT_ID | gen-lang-client-0653199198 |
| GEMINI_API_KEY | (AI এন্ট্রি চাইলে) |

## ধাপ ৪ — Firebase-এ ডোমেইন অনুমোদন (ভুলে গেলে Google লগইন কাজ করবে না)
Firebase Console → Authentication → Settings → **Authorized domains** → আপনার Vercel ডোমেইন যোগ করুন।
তারপর Vercel-এ **Redeploy** দিন।

---
## কী কী বাগ ঠিক হয়েছে
- যে কেউ URL জানলে ডেটা পড়তে/লিখতে পারত (ফাঁকা টোকেন গ্রহণ) → এখন Google লগইন + সার্ভার-যাচাই।
- ডিফল্ট পিন 1234 সবসময় চলত, আর পাবলিক `resetPin` লিংক ছিল → দুটোই বাদ।
- অনুমোদিত ইমেইল তালিকা ব্রাউজারে থাকত → এখন সার্ভারে (ALLOWED_EMAILS)।
- একই এন্ট্রি দুইবার সেভ (ডুপ্লিকেট ID) → এখন ID আগে থেকে থাকলে নতুন সারি তৈরি হয় না।
- আপডেটে পাঠানো হয়নি এমন কলাম খালি হয়ে যেত → এখন শুধু বদলানো ঘরগুলো বদলায়।
- দুটি "Status" কলামে ডেটা হারিয়ে যেত → পড়ার সময় ও repairData-তে ঠিক।
- ফান্ড লেনদেন অজানা ফান্ডে লেখা যেত → এখন আটকায়।
- Service Worker আর্থিক ডেটা ক্যাশ করে পুরোনো/অন্যের ডেটা দেখাতে পারত → এখন ক্যাশ নেই।
- Express সার্ভার (server.ts) Vercel-এ চলে না ও কাঁচা পিন সহ proxy ছিল → Vercel Functions।
- Google অ্যাক্সেস টোকেন সার্ভারের মেমরিতে জমা হতো → বাদ।

## জেনে রাখুন
- ছবি Drive-এ "লিংক জানলে দেখা যায়" মোডে থাকে (আগের মতোই), যাতে সব ডিভাইসে দেখা যায়। লিংক অনুমান করা যায় না, কিন্তু কেউ লিংক পেলে দেখতে পারবে।
- অ্যাপ-লক পিন এখন শুধু ডিভাইসের স্ক্রিন-লক; ডেটা সুরক্ষিত রাখে Google লগইন।
- Vercel Function-এ রিকোয়েস্ট সীমা ~৪.৫ MB; অ্যাপ আগে থেকেই ছবি ছোট করে পাঠায়।
