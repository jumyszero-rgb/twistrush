// TWIST RUSH：読み込んだ絵・曲・声をスマホに残す（2回目から速く開く）
const CACHE = 'tr-assets-v1';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('tr-') && k !== CACHE && k !== 'tr-page').map(k => caches.delete(k)))).then(() => self.clients.claim())));
const okRes = r => r && r.ok && r.status === 200 && r.type === 'basic';
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;            // サーバー（api.twistrush.com）などはそのまま
  if (req.headers.has('range')) return;                                         // 曲や動画の途中読みはそのまま
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    // ゲーム本体：いつも新しいものを取りに行く。電波がないときだけ残してあるもの
    e.respondWith(fetch(req).then(r => { if (okRes(r)) { const c = r.clone(); caches.open('tr-page').then(ca => ca.put('/', c)); } return r; })
      .catch(() => caches.open('tr-page').then(ca => ca.match('/')).then(r => r || Response.error())));
    return;
  }
  if (!/^\/(img|bgm|voice|video)\//.test(url.pathname)) return;
  // 絵・曲・声：残してあればすぐ使い、裏で新しくしておく
  e.respondWith(caches.open(CACHE).then(ca => ca.match(req).then(hit => {
    const net = fetch(req).then(r => { if (okRes(r)) ca.put(req, r.clone()); return r; }).catch(() => hit);
    if (hit) { e.waitUntil(net); return hit; }
    return net;
  })));
});
