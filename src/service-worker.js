/* Service worker van Reismannetje (wordt door src/sw.js geserveerd op /sw.js, met de versie ingevuld).
   - App-schil (/, stijl, script) eerst van het netwerk, bij geen verbinding uit de cache: zo heb je altijd
     de nieuwste versie, en opent de app ook offline.
   - Lettertype, Leaflet, plaatjes en uploads: eerst uit de cache (die veranderen niet).
   - /api, /go en deellinks nooit uit de cache (privé en altijd actueel).
   - Pushmeldingen tonen, tenzij de app al open en zichtbaar is. */
const VERSION = '__VERSION__';
const CACHE = `reismannetje-${VERSION}`;
const SHELL = ['/', '/css/style.css', '/js/app.js', '/vendor/inter/index.css', '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js', '/img/logo.svg', '/img/reismannetje.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('reismannetje-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const NEVER = /^\/(api|go|og|reis|reizen|stem|join|reset|healthz)(\/|$)/;
const STATIC = /^\/(vendor|img|uploads)\//;

async function networkFirst(req, fallbackUrl) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(fallbackUrl || req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(fallbackUrl || req);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || NEVER.test(url.pathname)) return;
  if (req.mode === 'navigate') {
    // De app zelf (/ met #route) uit de cache als er geen netwerk is; andere pagina's gewoon via het netwerk.
    if (url.pathname === '/') e.respondWith(networkFirst(req, '/'));
    return;
  }
  if (STATIC.test(url.pathname)) { e.respondWith(cacheFirst(req)); return; }
  if (SHELL.includes(url.pathname) || url.pathname === '/data/bestemmingen.json') e.respondWith(networkFirst(req));
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (open.some((c) => c.visibilityState === 'visible' && c.focused)) return; // je zit er al in
    await self.registration.showNotification(data.title || 'Reismannetje', {
      body: data.body || '',
      icon: '/img/icon-192.png',
      badge: '/img/icon-192.png',
      tag: data.tag,
      renotify: !!data.tag,
      data: { url: data.url || '/' },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((c) => new URL(c.url).origin === self.location.origin);
    if (win) { await win.focus(); return win.navigate(target).catch(() => {}); }
    return self.clients.openWindow(target);
  })());
});
