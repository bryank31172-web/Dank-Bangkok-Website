const VERSION = "dank-pwa-v2";
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const IMAGE_CACHE = `${VERSION}-images`;

const PRECACHE = [
  "/",
  "/checkout",
  "/offline.html",
  "/manifest.webmanifest",
  "/pwa-client.js",
  "/favicon.svg",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/qr.js",
  "/i18n.js"
];

const NEVER_CACHE = [
  /^\/api\//,
  /^\/checkout(?:\/|$)/,
  /^\/staff(?:\.html|\/|$)/,
  /^\/pos(?:\.html|\/|$)/,
  /^\/customer-display(?:\.html|\/|$)/,
  /^\/analytics(?:\.html|\/|$)/
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => !key.startsWith(VERSION)).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some(pattern => pattern.test(url.pathname))) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (request.destination === "image") {
    event.respondWith(cacheFirst(request, IMAGE_CACHE, 80));
    return;
  }

  if (["script", "style", "font"].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return (await caches.match(request)) || (await caches.match("/offline.html"));
  }
}

async function cacheFirst(request, cacheName, maxEntries) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
    await trimCache(cacheName, maxEntries);
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then(response => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || (await network) || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  while (keys.length > maxEntries) {
    await cache.delete(keys.shift());
  }
}
