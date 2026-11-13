// TigerPath service worker: the app and the self-hosted map work offline once viewed.
const APP = 'tigerpath-app-v6'; // v6: building photo galleries
const TILES = 'tigerpath-tiles-v2'; // v2: drop cached CARTO tiles
const MAX_TILES = 1500;
const TILE_HOSTS = /(tile\.openstreetmap\.org|server\.arcgisonline\.com)$/;

self.addEventListener('install', (e) => { e.waitUntil(caches.open(APP).then((c) => c.addAll(['./', './index.html']))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![APP, TILES].includes(k)).map((k) => caches.delete(k)))));
  self.clients.claim();
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return; // the Cache API can't store partial responses
  const url = new URL(req.url);
  if (TILE_HOSTS.test(url.hostname)) { // cache-first for tiles
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trim(c); }
      return res;
    }));
  } else if (url.origin === location.origin) { // stale-while-revalidate for the app
    e.respondWith(caches.open(APP).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit ?? net;
    }));
  }
});

// Tapping a class reminder opens TigerPath with directions to the class.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url ?? './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) { win.navigate(url).catch(() => {}); return win.focus(); }
    return self.clients.openWindow(url);
  }));
});
