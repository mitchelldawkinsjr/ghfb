const CACHE = "ghfb-hub-v5";
const PRECACHE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-32.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "https://cdn.jsdelivr.net/npm/chart.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isHtmlRequest(request, url) {
  if (request.mode === "navigate") return true;
  const path = url.pathname;
  return path.endsWith(".html") || request.destination === "document";
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;

  if (url.origin !== self.location.origin) {
    if (url.hostname.includes("docs.google.com") || url.hostname.includes("googleusercontent.com")) {
      event.respondWith(fetch(request));
      return;
    }
    if (url.hostname === "cdn.jsdelivr.net") {
      event.respondWith(
        caches.match(request).then((cached) => cached || fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        }))
      );
      return;
    }
    return;
  }

  if (isHtmlRequest(request, url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
      return cached || network;
    })
  );
});
