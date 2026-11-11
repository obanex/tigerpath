// TigerPath service worker: app shell works offline, map tiles you've viewed are cached.
const APP = 'tigerpath-app-v1';
const TILES = 'tigerpath-tiles-v1';
const MAX_TILES = 1500;
const TILE_HOSTS = /(basemaps\.cartocdn\.com|tile\.openstreetmap\.org|server\.arcgisonline\.com)$/;

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
  if (req.method !== 'GET') return;
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
