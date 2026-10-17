// Buddy's offline helper (a service worker): keeps a copy of the game's files on the phone, so the game opens
// instantly next time and plays without a connection. The page and its code are checked online first (so updates
// arrive at once) and fall back to the saved copy offline; models, sounds, pictures and the three.js library come
// from the saved copy and are refreshed in the background.
const CACHE = 'buddy-files-v1';
const CODE = /\/(index\.html|main\.js|map3d\.js|props\.js|manifest\.webmanifest|assets-list\.json)?$/;
const OTHER_HOSTS = /(^|\.)cdn\.jsdelivr\.net$|(^|\.)unpkg\.com$|(^|\.)fonts\.(googleapis|gstatic)\.com$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const ours = url.origin === self.location.origin;
  if (!ours && !OTHER_HOSTS.test(url.hostname)) return; // (multiplayer and everything else go straight to the network)
  if (req.headers.has('range')) return e.respondWith(ranged(req)); // the music streams in pieces
  if (ours && (req.mode === 'navigate' || CODE.test(url.pathname))) return e.respondWith(networkFirst(req));
  e.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./index.html')) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const refresh = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await refresh) || Response.error();
}

// audio asks for byte ranges: answer from the saved copy when there is one (Safari needs a proper 206 reply)
async function ranged(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req.url, { ignoreSearch: true });
  if (!hit) {
    fetch(req.url).then(res => { if (res.ok) cache.put(req.url, res); }).catch(() => {}); // save the whole file for next time
    return fetch(req);
  }
  const buf = await hit.arrayBuffer(), m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  const start = m && m[1] ? +m[1] : 0, end = m && m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), { status: 206, headers: {
    'Content-Type': hit.headers.get('Content-Type') || 'audio/mpeg', 'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
    'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
}
