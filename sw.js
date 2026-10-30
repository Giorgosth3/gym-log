// Offline support: keeps the app's own files and libraries cached so it opens at the gym with no signal.
// Your workout data is cached separately by Firebase and syncs when you're back online.
const CACHE = "gymlog-v9";
const SHELL = ["./", "index.html", "app.js", "backend.js", "firebase-config.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png"];
const LIB_HOSTS = ["www.gstatic.com", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const own = url.origin === location.origin;
  const lib = LIB_HOSTS.includes(url.hostname) && !url.pathname.includes("/__/");
  if (!own && !lib) return; // never touch sign-in or database traffic
  if (own) {
    // Network first so updates arrive; fall back to cache offline.
    e.respondWith(fetch(req, { cache: "no-cache" }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
  } else {
    // Libraries and fonts are versioned: cache first.
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
