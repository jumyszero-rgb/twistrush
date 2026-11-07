// TWIST RUSH：読み込んだ絵・曲・声をスマホに残す（2回目から速く開く）
// v2：読み込みに失敗したときや、ログイン画面などへ飛ばされたときは、その結果を絵として使わない
const CACHE = 'tr-assets-v2';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('tr-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// ちゃんと読めた（同じサイトの、飛ばされていない、200の）ものだけ
const okRes = r => r && r.ok && r.status === 200 && r.type === 'basic' && !r.redirected;
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;            // サーバー（api.twistrush.com）などはそのまま
  if (req.headers.has('range')) return;                                         // 曲や動画の途中読みはそのまま
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    // ゲーム本体：いつも新しいものを取りに行く。電波がないときだけ残してあるもの
    e.respondWith(fetch(req).then(r => { if (okRes(r)) { const c = r.clone(); caches.open('tr-page').then(ca => ca.put('/', c)); } return r; })
      .catch(() => caches.open('tr-page').then(ca => ca.match('/')).then(r => r || fetch(req))));
    return;
  }
  if (!/^\/(img|bgm|voice|video)\//.test(url.pathname)) return;
  // 絵・曲・声：残してあればすぐ使い、裏で新しくしておく。残していないときは、ふつうに読む
  e.respondWith(caches.open(CACHE).then(ca => ca.match(req)).then(hit => {
    const net = fetch(req).then(r => { if (okRes(r)) caches.open(CACHE).then(ca => ca.put(req, r.clone())).catch(() => {}); return r; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }).catch(() => fetch(req)));
});
