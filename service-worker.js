const CACHE_NAME = "en-marcha-shell-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=5",
  "./app.js?v=5",
  "./supabase-config.js?v=3",
  "./manifest.webmanifest",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

// Prefer the network for application files so a deployed fix is visible immediately.
// Cache only provides an offline fallback; it never replaces a newer published file.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && new URL(event.request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(event.request)) || (event.request.mode === "navigate" ? caches.match("./index.html") : undefined)),
  );
});