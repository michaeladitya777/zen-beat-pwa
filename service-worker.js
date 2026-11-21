const CACHE_NAME = 'zenbeat-cache-v8';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './assets/audio/theme-menu.mp3',
  './assets/audio/songs/hujan-sore.mp3',
  './assets/audio/songs/pulang-tenggo.mp3',
  './assets/audio/songs/kopi-sachet.mp3',
  './assets/audio/sfx/tap.mp3',
  './assets/audio/sfx/perfect.mp3',
  './assets/audio/sfx/slide.mp3',
  './assets/audio/sfx/miss.mp3',
  './assets/audio/sfx/score-tick.mp3',
  './assets/audio/bgm/clear.mp3',
  './assets/audio/bgm/gameover.mp3'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Gunakan Promise.allSettled agar instalasi SW tidak gagal jika sebagian MP3 belum diunggah
      return Promise.allSettled(
        ASSETS_TO_CACHE.map((url) => cache.add(url))
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
