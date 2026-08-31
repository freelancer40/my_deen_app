/* ==============================================================
   Service Worker — Deen - Islamic Hub
   ==============================================================
   আপডেট দেওয়ার নিয়ম (খুবই গুরুত্বপূর্ণ):
   প্রতিবার অ্যাপের কোনো ফাইল পরিবর্তন করে নতুন করে Netlify-তে
   ডিপ্লয় করার সময়, নিচের CACHE_VERSION নম্বরটা এক করে বাড়িয়ে দিন
   (যেমন 'v1' থেকে 'v2')। এটা না বাড়ালে ব্যবহারকারীর ফোনে পুরনো
   ক্যাশ করা ফাইলই দেখাতে থাকবে, নতুন পরিবর্তন দেখা যাবে না।
   ============================================================== */
var CACHE_VERSION = 'v34';
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
  // cache.addAll() হলো all-or-nothing — APP_SHELL-এর ৮টা ফাইলের মধ্যে একটাও যদি
  // (দুর্বল সিগন্যাল বা সাময়িক ৪০৪-এর কারণে) ফেচ ব্যর্থ হয়, তাহলে পুরো install-ই
  // ব্যর্থ হয়ে যায় এবং একটা ফাইলও ক্যাশ হয় না — প্রথমবার ইনস্টলের সময় এমন হলে
  // ক্যাশ চিরস্থায়ীভাবে খালি থেকে যায় (ঠিক এই খালি-ক্যাশ অবস্থাই আগের ERR_FAILED
  // সমস্যার মূল কারণ হতে পারে, বিশেষত দুর্বল সংযোগে)। তাই এখানে প্রতিটা ফাইল
  // আলাদাভাবে ক্যাশ করা হচ্ছে যাতে একটার ব্যর্থতা বাকিগুলোকে না আটকায়; index.html
  // (সবচেয়ে জরুরি ফাইল) ক্যাশ হলেই install সফল ধরা হবে।
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return Promise.all(APP_SHELL.map(function(url){
        return cache.add(url).catch(function(err){
          console.warn('SW install: cache করতে ব্যর্থ —', url, err);
        });
      })).then(function(){
        return cache.match('./index.html');
      }).then(function(shellCached){
        if(!shellCached) throw new Error('index.html cache করা যায়নি — install বাতিল');
      });
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

/* ================= বাগ ফিক্স: pushsubscriptionchange হ্যান্ডেল করা হচ্ছিল না =================
   ব্রাউজার/OS নিজে থেকেই মাঝে মাঝে (মেয়াদ শেষ হলে, নিরাপত্তার কারণে কী রোটেট
   হলে ইত্যাদি) পুরনো push subscription বাতিল করে — এটা ব্যবহারকারী কিছু না করা
   সত্ত্বেও ঘটতে পারে। এই ইভেন্টটা এতদিন এই ফাইলে হ্যান্ডেলই করা হতো না, ফলে
   এমনটা ঘটলে সার্ভারের push-subs স্টোরে পুরনো (এখন অকেজো) subscription-ই থেকে
   যেত এবং check-waqt.js প্রতি মিনিটে সেটাতেই পাঠানোর চেষ্টা করে ব্যর্থ হতো —
   ব্যবহারকারী নিজে অ্যাপ খুলে আবার পারমিশন/টগল না ছুঁলে ব্যাকগ্রাউন্ড
   নোটিফিকেশন স্থায়ীভাবে বন্ধ হয়ে যেত, অথচ অ্যাপের সেটিংসে "চালু"-ই দেখাতো।
   এখন এই ইভেন্ট এলে সাথে সাথেই নতুন subscription তৈরি করে সার্ভারে নিজে থেকেই
   জমা দিয়ে দেওয়া হচ্ছে (পেজ খোলা থাকুক বা না থাকুক), যাতে চুপচাপ ব্যর্থ না হয়। */
var VAPID_PUBLIC_KEY = 'BKUqgs4vb9kXk0DfQ5ToQceUyt904_v2VGGBDXH-n2STS2AqqenpVHP2dyt_8pGq6kY7E-jeC_LcZIopQXIEgqw';
function urlBase64ToUint8Array(base64String){
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = atob(base64);
  var outputArray = new Uint8Array(rawData.length);
  for(var i=0;i<rawData.length;i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}
self.addEventListener('pushsubscriptionchange', function(event){
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    }).then(function(newSub){
      // পুরনো লোকেশন/মাযহাব তথ্য আগে থেকেই page (subscribeToPush) ক্যাশে
      // রেখে দেয় ('push-user-info' নামে), যাতে SW একাই (পেজ খোলা না থাকলেও)
      // সঠিক তথ্যসহ পুনরায় সাবস্ক্রাইব করতে পারে।
      return caches.match('/push-user-info').then(function(res){
        return res ? res.json() : {};
      }).then(function(info){
        var body = Object.assign({subscription: newSub.toJSON()}, info || {});
        return fetch('/.netlify/functions/save-subscription', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(body)
        });
      });
    }).catch(function(err){
      console.warn('pushsubscriptionchange: পুনরায় সাবস্ক্রাইব ব্যর্থ —', err);
    })
  );
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
        if(res && res.status === 200){
          var resClone = res.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, resClone); });
        }
        return res;
      }).catch(function(){
        return caches.match(event.request).then(function(cached){
          return cached || Response.error();
        });
      })
    );
    return;
  }

  // এই অ্যাপের নিজের ডোমেইনের বাইরের যেকোনো রিকোয়েস্ট (যেমন "মুদ্রিত কুরআন"-এর
  // পৃষ্ঠা-মোডের জন্য GitHub থেকে আনা madani-muhsaf.json) — এখানে হাতই দেওয়া হবে
  // না, স্বাভাবিকভাবে সরাসরি নেটওয়ার্কে চলে যাবে। আগে এসব রিকোয়েস্টও নিচের
  // app-shell fallback লজিকে ধরা পড়ে যেত: GitHub থেকে JSON আনতে সাময়িকভাবে
  // ব্যর্থ হলে (স্লো নেট/সাময়িক ব্লক) সেই ব্যর্থতার বদলে ভুলবশত index.html-এর
  // HTML রিটার্ন হতো, আর সেটাকে JSON হিসেবে পার্স করতে গিয়ে ভেঙে যেত — ফলে
  // "পৃষ্ঠা" ট্যাবে কোনো আয়াত/পৃষ্ঠাই দেখা যেত না।
  if(url.indexOf(self.location.origin) !== 0){
    return;
  }

  // বাকি সব ফাইল (অ্যাপের নিজস্ব HTML/CSS/JS/আইকন): আগে ক্যাশ থেকে দ্রুত দেখাবে,
  // পাশাপাশি ব্যাকগ্রাউন্ডে নতুন ভার্সন থাকলে পরের বারের জন্য ক্যাশ আপডেট করে রাখবে।
  //
  // গুরুত্বপূর্ণ: এখানে index.html fallback শুধু আসল পেজ-নেভিগেশন রিকোয়েস্টের
  // (mode === 'navigate') জন্যই প্রযোজ্য, অন্য কোনো (script/json/img ইত্যাদি)
  // রিকোয়েস্ট ব্যর্থ হলে সেটা সত্যিই ব্যর্থ হবে — যাতে অ্যাপের নিজস্ব এরর-হ্যান্ডলিং
  // (যেমন "ইন্টারনেট সংযোগ পরীক্ষা করুন" মেসেজ) সঠিকভাবে কাজ করে।
  event.respondWith(
    caches.match(event.request).then(function(cached){
      var networkFetch = fetch(event.request).then(function(res){
        if(res && res.status === 200 && event.request.method === 'GET'){
          var resClone = res.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, resClone); });
        }
        return res;
      }).catch(function(){
        if(event.request.mode === 'navigate'){
          return caches.match('./index.html').then(function(shellFallback){
            if(shellFallback) return shellFallback;
            return new Response(
              '<!doctype html><meta charset="utf-8"><body style="background:#08150f;color:#eee;font-family:sans-serif;padding:40px;text-align:center;">ইন্টারনেট সংযোগ পাওয়া যায়নি। সংযোগ ঠিক হলে আবার চেষ্টা করুন।</body>',
              {status: 200, headers: {'Content-Type': 'text/html; charset=utf-8'}}
            );
          });
        }
        return Response.error();
      });
      return cached || networkFetch;
    })
  );
});
