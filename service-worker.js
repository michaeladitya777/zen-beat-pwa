const CACHE_NAME = 'zenbeat-v200';
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/audio/songs/songs.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // Satu per satu agar satu file gagal tidak membatalkan seluruh precache
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(CORE_ASSETS.map((url) => cache.add(url).catch(() => {})))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// File audio besar tidak disimpan di Cache Storage: lagu sudah disimpan app.js di IndexedDB.
const isAudio = (url) => /\.(mp3|wav|ogg|m4a)(\?|$)/i.test(url);

// Network-first: ambil versi terbaru saat online, pakai cache saat offline.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;

  const sameOrigin = req.url.startsWith(self.location.origin);

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && sameOrigin && !isAudio(req.url)) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
