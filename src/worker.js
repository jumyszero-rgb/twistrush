// テスト期間だけの「合言葉」ゲート
// Cloudflare Workers の変数（シークレット）TESTER_PASS に合言葉を入れると有効になる（消すと誰でも入れる状態に戻る）
// 合言葉はコードに書かない（リポジトリが公開のため）。合言葉を変えると、前の合言葉で入った人ももう一度入力が必要になる
const COOKIE = 'tr_gate';
const DAYS = 30;

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

function page(ret, wrong) {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow">
<title>TWIST RUSH テスト版</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 30%,#3b2566,#140b2a);font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;color:#fff;padding:16px;box-sizing:border-box}
.card{width:min(360px,100%);background:rgba(20,10,40,.85);border:2px solid #ffd24a;border-radius:20px;padding:24px 20px;text-align:center;box-shadow:0 0 30px rgba(255,210,74,.35)}
h1{margin:0 0 4px;font-size:28px;font-style:italic;color:#fff4b8;text-shadow:0 0 10px #ff9d00}
p{margin:6px 0 16px;color:#d8ccf0;font-size:14px;line-height:1.6}
input{width:100%;box-sizing:border-box;font-size:18px;padding:12px;border-radius:12px;border:2px solid #7a5cff;background:#1b1230;color:#fff;text-align:center}
button{margin-top:12px;width:100%;font-size:17px;font-weight:900;padding:12px;border:0;border-radius:12px;background:linear-gradient(#ffd24a,#ff9d2a);color:#3a2000}
.ng{color:#ff7a9a;font-weight:800;margin-top:10px}
</style></head><body><form class="card" method="post" action="/__gate">
<h1>TWIST RUSH</h1><p>テスト版です。<br>お知らせした「合言葉」を入れてください。</p>
<input name="p" type="password" autocomplete="current-password" placeholder="合言葉" autofocus required>
<input type="hidden" name="r" value="${esc(ret)}">
<button type="submit">はじめる</button>
${wrong ? '<div class="ng">合言葉がちがいます</div>' : ''}
</form></body></html>`;
  return new Response(html, {status: wrong ? 401 : 200, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}

async function gate(ctx) {
  const pass = ctx.env && ctx.env.TESTER_PASS;
  if (!pass) return ctx.next();                       // 合言葉が設定されていなければ、ゲートなし
  const url = new URL(ctx.request.url);
  const want = await sha('twistrush:' + pass);

  if (url.pathname === '/__gate' && ctx.request.method === 'POST') {
    const f = await ctx.request.formData();
    const p = String(f.get('p') || '').trim();
    let ret = String(f.get('r') || '/');
    if (!ret.startsWith('/') || ret.startsWith('//')) ret = '/';
    if (await sha('twistrush:' + p) === want) {
      return new Response(null, {status: 303, headers: {
        Location: ret,
        'Set-Cookie': `${COOKIE}=${want}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`,
        'Cache-Control': 'no-store'}});
    }
    await new Promise(r => setTimeout(r, 800));        // 総当たり対策で少し待たせる
    return page(ret, true);
  }

  const ck = (ctx.request.headers.get('Cookie') || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
  if (ck && ck.slice(COOKIE.length + 1) === want) return ctx.next();

  // 画像・音などはページを返さず「入れません」だけ返す
  const accept = ctx.request.headers.get('Accept') || '';
  if (!accept.includes('text/html')) return new Response('locked', {status: 401, headers: {'Cache-Control': 'no-store'}});
  return page(url.pathname + url.search, false);
}

// Workers（静的アセットつき）の入口：すべてのリクエストをここで受けて、通すときは静的ファイルを返す
export default {
  async fetch(request, env) {
    // 確認用：合言葉の仕組みが動いているか（合言葉そのものは出さない）
    if (new URL(request.url).pathname === '/__gate_status')
      return new Response('worker: ok\ngate: ' + (env && env.TESTER_PASS ? 'on（合言葉あり）' : 'off（TESTER_PASS が見つからない）') + '\n', {headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'}});
    return gate({request, env, next: () => env.ASSETS.fetch(request)});
  },
};
