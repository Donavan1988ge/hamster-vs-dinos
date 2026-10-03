/*
 * Hamster vs. Cyber-Dinos — offline service worker.
 * - index.html / navigations: network-first (new deploys show up immediately), cache fallback offline
 * - hashed Vite bundles (assets/*-<hash>.js|css): cache-first (immutable)
 * - other same-origin files (sprites, sounds, icons): cache-first + background refresh
 * Bump CACHE_VERSION to drop old caches.
 */
const CACHE_VERSION = "v1";
const CACHE = `hvd-${CACHE_VERSION}`;
const PRECACHE = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/favicon-32.png"];
const HASHED = /-[A-Za-z0-9_-]{8,}\.(?:js|css)$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE).catch(() => { /* partial precache is fine */ }))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("hvd-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isHtml(req, url) {
  return req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("/index.html");
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(req)) || (await cache.match("index.html")) || (await cache.match("./"));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req, event, refresh) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const fetchAndStore = () => fetch(req).then((res) => {
    if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
    return res;
  });
  if (!hit) return fetchAndStore();
  if (refresh) event.waitUntil(fetchAndStore().catch(() => {}));   // stale-while-revalidate
  return hit;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // leaderboard API etc. → straight to the network
  if (isHtml(req, url)) { event.respondWith(networkFirst(req)); return; }
  const immutable = HASHED.test(url.pathname);
  event.respondWith(cacheFirst(req, event, !immutable));
});
