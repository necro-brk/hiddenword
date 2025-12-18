// DEPLOY_CHECK_123

const CACHE_NAME = "hiddenword-v1";

const ASSETS = [
  "/hiddenword/",
  "/hiddenword/index.html",
  "/hiddenword/style.css",
  "/hiddenword/script.js",
  "/hiddenword/words_tr.js",
  "/hiddenword/manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request);
    })
  );
});
