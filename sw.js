/* ==============================================================
   Service Worker — Deen - Islamic Hub
   ==============================================================
   আপডেট দেওয়ার নিয়ম (খুবই গুরুত্বপূর্ণ):
   প্রতিবার অ্যাপের কোনো ফাইল পরিবর্তন করে নতুন করে Netlify-তে
   ডিপ্লয় করার সময়, নিচের CACHE_VERSION নম্বরটা এক করে বাড়িয়ে দিন
   (যেমন 'v1' থেকে 'v2')। এটা না বাড়ালে ব্যবহারকারীর ফোনে পুরনো
   ক্যাশ করা ফাইলই দেখাতে থাকবে, নতুন পরিবর্তন দেখা যাবে না।
   ============================================================== */
var CACHE_VERSION = 'v8';
var CACHE_NAME = 'deen-islamic-hub-' + CACHE_VERSION;

var APP_SHELL = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './quran-arabic.json',
  './tafsir.json',
  './notify-tone.wav'
];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(APP_SHELL);
    })
  );
  // নতুন SW ইনস্টল হওয়ার সাথে সাথেই সক্রিয় হওয়ার জন্য অপেক্ষা করবে (ব্যবহারকারী
  // পেজ রিফ্রেশ/পুনরায় খোলার পর activate হবে, skipWaiting বার্তা পেলে সাথে সাথেই)
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE_NAME; })
            .map(function(k){ return caches.delete(k); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

// পেজ থেকে skipWaiting বার্তা পাঠালে সাথে সাথে নতুন ভার্সন সক্রিয় করবে
self.addEventListener('message', function(event){
  if(event.data === 'SKIP_WAITING') self.skipWaiting();
});

/* ================= WEB PUSH: স্ক্রিন অফ / অ্যাপ বন্ধ থাকলেও নোটিফিকেশন =================
   সার্ভারের check-waqt ফাংশন প্রতি মিনিটে চেক করে ওয়াক্ত শুরু হলে এখানে একটা
   push ইভেন্ট পাঠায় — এই কোডটা ব্রাউজার/অ্যান্ড্রয়েড OS নিজে চালায়, অ্যাপ খোলা
   না থাকলেও, স্ক্রিন অফ থাকলেও। তাই এখানেই সিস্টেম নোটিফিকেশন দেখানো হয়। */
self.addEventListener('push', function(event){
  var data = {};
  try{ data = event.data ? event.data.json() : {}; }catch(e){}
  var title = data.title || 'Deen - Islamic Hub';
  var body = data.body || 'ওয়াক্ত শুরু হয়েছে';
  var opts = {
    body: body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    vibrate: [200, 100, 200, 100, 400],
    tag: 'waqt-notify',
    renotify: true,
    // silent:false — কারণ এবার অ্যাপ বন্ধ/স্ক্রিন-অফ অবস্থায় custom wav টোন বাজানোর
    // কোনো জাভাস্ক্রিপ্ট চলে না, তাই ফোনের নিজস্ব নোটিফিকেশন সাউন্ডটাই বাজতে দেওয়া হচ্ছে।
    silent: false
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

// নোটিফিকেশনে ট্যাপ করলে অ্যাপ খুলে দেবে (আগে থেকে কোনো ট্যাব খোলা থাকলে সেটাতেই ফোকাস করবে)
self.addEventListener('notificationclick', function(event){
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({type:'window', includeUncontrolled:true}).then(function(clientList){
      for(var i=0;i<clientList.length;i++){
        var c = clientList[i];
        if('focus' in c) return c.focus();
      }
      if(self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});

self.addEventListener('fetch', function(event){
  var url = event.request.url;

  // নামাজের সময়, হিজরি তারিখ ইত্যাদি লাইভ API — সবসময় নেটওয়ার্ক থেকে আনার
  // চেষ্টা করবে (সবচেয়ে সঠিক/আপ-টু-ডেট তথ্যের জন্য), নেট না থাকলে ক্যাশ থেকে
  if(url.indexOf('api.aladhan.com') !== -1){
    event.respondWith(
      fetch(event.request).then(function(res){
        var resClone = res.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, resClone); });
        return res;
      }).catch(function(){ return caches.match(event.request); })
    );
    return;
  }

  // বাকি সব ফাইল (অ্যাপের নিজস্ব HTML/CSS/JS/আইকন): আগে ক্যাশ থেকে দ্রুত দেখাবে,
  // পাশাপাশি ব্যাকগ্রাউন্ডে নতুন ভার্সন থাকলে পরের বারের জন্য ক্যাশ আপডেট করে রাখবে
  event.respondWith(
    caches.match(event.request).then(function(cached){
      var networkFetch = fetch(event.request).then(function(res){
        if(res && res.status === 200 && event.request.method === 'GET'){
          var resClone = res.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, resClone); });
        }
        return res;
      }).catch(function(){ return cached; });
      return cached || networkFetch;
    })
  );
});
