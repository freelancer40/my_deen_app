/* ==============================================================
   check-waqt — netlify.toml-এ schedule = "* * * * *" অনুযায়ী প্রতি মিনিটে
   Netlify নিজেই এই ফাংশন চালায়। এটা:
     ১) push-subs স্টোরে জমা থাকা সবার লোকেশন/মাযহাব অনুযায়ী গ্রুপ করে
        Aladhan API থেকে আজকের নামাজের সময় আনে — প্রতিটা শহরের জন্য দিনে
        মাত্র একবারই আনা হয় (prayer-times-cache স্টোরে ২৪ ঘণ্টা ক্যাশ করা
        থাকে), তাই প্রতি মিনিটে চললেও বাইরের API কল বা কম্পিউট সময় বাড়ে না —
        Netlify ক্রেডিট সাশ্রয়ের জন্য এটা জরুরি,
     ২) এখন (বাংলাদেশ সময়, UTC+6) কোনো ওয়াক্ত শুরু হচ্ছে কিনা মেলায়,
     ৩) মিললে ও আজকে এই ওয়াক্তের জন্য আগে না পাঠানো হয়ে থাকলে সেই
        ব্যবহারকারীকে Web Push নোটিফিকেশন পাঠায় — অ্যাপ বন্ধ থাকলে বা
        স্ক্রিন অফ থাকলেও এই নোটিফিকেশন আসবে, কারণ এটা ব্রাউজারের
        Service Worker-এর 'push' ইভেন্ট দিয়ে দেখানো হয়, পেজের জাভাস্ক্রিপ্ট
        চলার উপর নির্ভর করে না।
   ============================================================== */
const { connectLambda, getStore } = require('@netlify/blobs');
const webpush = require('web-push');

var BASE_METHOD = 3, BASE_SCHOOL = 0; // index.html-এর সাথে অভিন্ন
var TUNE = '0,0,0,0,0,0,0,4,0'; // Imsak,Fajr,Sunrise,Dhuhr,Asr,Maghrib,Sunset,Isha,Midnight
// প্রতি মিনিটে ফাংশন চলে, কিন্তু Netlify-র শিডিউল সামান্য দেরিতে ট্রিগার হতে
// পারে বলে ২ মিনিটের জানালা রাখা হলো (নিরাপত্তার জন্য), যাতে কোনো মিনিট মিস
// হয়ে গেলেও পরের রানেই সেই ওয়াক্তের নোটিফিকেশন ঠিকই চলে যায়।
var CHECK_WINDOW_MIN = 2;
// একই শহর+মাযহাবের জন্য দিনে একবার আনা সময় কতক্ষণ ক্যাশে থাকবে
var CACHE_TTL_HOURS = 24;

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function dhakaNow() {
  // বাংলাদেশে কোনো DST নেই, সবসময় UTC+6 — তাই সহজভাবে যোগ করাই যথেষ্ট ও নির্ভরযোগ্য।
  var d = new Date(Date.now() + 6 * 60 * 60 * 1000);
  return {
    dateStrForApi: pad2(d.getUTCDate()) + '-' + pad2(d.getUTCMonth() + 1) + '-' + d.getUTCFullYear(),
    dedupeKey: d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()),
    nowMin: d.getUTCHours() * 60 + d.getUTCMinutes()
  };
}

function parseHHMM(raw) {
  var t = String(raw).split(' ')[0].split(':');
  return parseInt(t[0], 10) * 60 + parseInt(t[1], 10);
}

async function fetchJson(url) {
  var res = await fetch(url);
  return res.json();
}

// একটি শহরের আজকের ৫ ওয়াক্ত (মিনিট-অফ-ডে) — client-side fetchPrayerTimes()-এর
// সাথে অভিন্ন লজিক: school=0 বেসলাইন থেকে সব, হানাফি হলে শুধু Asr আলাদা কল দিয়ে override।
async function fetchCityWaqtMinutesFromApi(city, madhab, dateStr) {
  var base = 'https://api.aladhan.com/v1/timingsByCity/' + dateStr +
    '?city=' + encodeURIComponent(city) + '&country=Bangladesh&method=' + BASE_METHOD +
    '&school=' + BASE_SCHOOL + '&tune=' + TUNE;
  var data = await fetchJson(base);
  if (!data || data.code !== 200 || !data.data || !data.data.timings) return null;
  var t = data.data.timings;

  var asrMin = parseHHMM(t.Asr);
  if (madhab !== 'salafi') {
    try {
      var hanafiUrl = 'https://api.aladhan.com/v1/timingsByCity/' + dateStr +
        '?city=' + encodeURIComponent(city) + '&country=Bangladesh&method=' + BASE_METHOD + '&school=1';
      var hd = await fetchJson(hanafiUrl);
      if (hd && hd.code === 200 && hd.data && hd.data.timings && hd.data.timings.Asr) {
        asrMin = parseHHMM(hd.data.timings.Asr);
      }
    } catch (e) { /* ব্যর্থ হলে বেসলাইন আসরই থাকবে */ }
  }

  return {
    'ফজর': parseHHMM(t.Fajr),
    'যোহর': parseHHMM(t.Dhuhr),
    'আসর': asrMin,
    'মাগরিব': parseHHMM(t.Maghrib),
    'এশা': parseHHMM(t.Isha)
  };
}

// প্রথমে prayer-times-cache স্টোরে আজকের এই শহর+মাযহাবের সময় আছে কিনা দেখে,
// থাকলে সেটাই ব্যবহার করে (কোনো বাইরের API কল ছাড়াই — দ্রুত ও ক্রেডিট-সাশ্রয়ী)।
// না থাকলে/মেয়াদ শেষ হলে তখনই Aladhan-এ কল করে ক্যাশে রেখে দেয়।
async function fetchCityWaqtMinutesCached(cacheStore, city, madhab, dateStr, dedupeKey) {
  var cacheKey = dedupeKey + '_' + madhab + '_' + city;
  try {
    var cached = await cacheStore.get(cacheKey, { type: 'json' });
    if (cached) return cached;
  } catch (e) { /* cache miss হলে নিচে নতুন করে আনবে */ }

  var fresh = await fetchCityWaqtMinutesFromApi(city, madhab, dateStr);
  if (fresh) {
    try { await cacheStore.setJSON(cacheKey, fresh); } catch (e) { /* ক্যাশ লিখতে না পারলেও কাজ চলবে, শুধু পরের মিনিটেও আবার fetch হবে */ }
  }
  return fresh;
}

exports.handler = async function (event) {
  connectLambda(event);

  var VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
  var VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
  var VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY environment variable missing — Site settings > Environment variables এ যোগ করুন।');
    return { statusCode: 500, body: 'VAPID keys not configured' };
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  var subsStore = getStore('push-subs');
  var sentStore = getStore('push-sent-log');
  var cacheStore = getStore('prayer-times-cache');

  var listResult = await subsStore.list();
  var blobs = (listResult && listResult.blobs) || [];
  if (blobs.length === 0) {
    return { statusCode: 200, body: 'no subscribers' };
  }

  var now = dhakaNow();
  var timingsCache = {}; // এই একটা invocation-এর মধ্যে বারবার একই শহর না আনতে (in-memory)
  var sentCount = 0, checkedCount = 0;

  for (var i = 0; i < blobs.length; i++) {
    var id = blobs[i].key;
    var rec;
    try {
      rec = await subsStore.get(id, { type: 'json' });
    } catch (e) { continue; }
    if (!rec || !rec.subscription) continue;
    checkedCount++;

    var city = rec.upazila ? rec.upazila : rec.district_en;
    var madhab = rec.madhab || 'hanafi';
    var groupKey = city + '|' + madhab;

    if (!(groupKey in timingsCache)) {
      var waqts = null;
      try {
        waqts = await fetchCityWaqtMinutesCached(cacheStore, city, madhab, now.dateStrForApi, now.dedupeKey);
        if (!waqts && rec.upazila) {
          // উপজেলা না মিললে জেলা দিয়ে fallback (client-এর মতোই)
          waqts = await fetchCityWaqtMinutesCached(cacheStore, rec.district_en, madhab, now.dateStrForApi, now.dedupeKey);
        }
      } catch (e) {
        waqts = null;
      }
      timingsCache[groupKey] = waqts;
    }
    var cityWaqts = timingsCache[groupKey];
    if (!cityWaqts) continue;

    for (var waqtName in cityWaqts) {
      var diff = now.nowMin - cityWaqts[waqtName];
      if (diff < 0 || diff >= CHECK_WINDOW_MIN) continue; // এই জানালায় শুরু হয়নি

      // আজকে এই ওয়াক্তের জন্য আগেই পাঠানো হয়ে থাকলে বাদ (একই মিনিটে ফাংশন
      // একাধিকবার ট্রিগার হলে বা রিট্রাই হলে ডুপ্লিকেট পুশ ঠেকানোর জন্য)
      var sentRec;
      try { sentRec = await sentStore.get(id, { type: 'json' }); } catch (e) { sentRec = null; }
      if (!sentRec || sentRec.date !== now.dedupeKey) sentRec = { date: now.dedupeKey, waqts: [] };
      if (sentRec.waqts.indexOf(waqtName) !== -1) continue;

      var payload = JSON.stringify({
        title: 'Deen - Islamic Hub',
        body: waqtName + ' শুরু হয়েছে'
      });

      try {
        await webpush.sendNotification(rec.subscription, payload);
        sentCount++;
        sentRec.waqts.push(waqtName);
        await sentStore.setJSON(id, sentRec);
      } catch (err) {
        var code = err && (err.statusCode || err.status);
        if (code === 404 || code === 410) {
          // সাবস্ক্রিপশন আর বৈধ নেই (ব্যবহারকারী অ্যাপ আনইনস্টল করেছে/permission বাতিল করেছে)
          try { await subsStore.delete(id); } catch (e2) {}
          try { await sentStore.delete(id); } catch (e2) {}
        } else {
          console.error('push failed for', id, code, err && err.message);
        }
      }
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ checked: checkedCount, sent: sentCount, nowMin: now.nowMin })
  };
};

