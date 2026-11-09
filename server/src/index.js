import { arenaHome, arenaSetDefense, arenaFight } from './arena.js';
import { Lobby, Room, MEDAL, MEDAL_SHOP, VS_KINDS, medalOf, medalDaily, medalTake, vsTop, vsRewards, vsClaim } from './vs.js';
export { Lobby, Room };
// TWIST RUSH サーバー（Cloudflare Workers + D1）
//   ・ログイン（Google／LINE／Microsoft）  ・セーブの保存と読み込み
//   ・ゴールドコインの残高（Web・Android・iOSで共通）  ・ランキング（ゲスト登録でも載る）
// テーブルは最初のアクセスで自動で作る。SESSION_SECRET を入れていなければ、署名用の秘密もデータベースに自動で作る
// 時刻はすべて UNIX秒（UTC）。

const enc = new TextEncoder(), dec = new TextDecoder();
const nowSec = () => Math.floor(Date.now() / 1000);
const SESSION_DAYS = 90;                    // ログイン状態が続く日数
const SAVE_MAX_BYTES = 400 * 1024;          // セーブ1件の上限
const GOLD_SOURCES = ['free', 'web', 'google', 'apple'];   // どこで手に入れたか
const PAID_SOURCES = ['web', 'google', 'apple'];           // 買ったゴールド（購入ごとに期限つきで持つ）
const GOLD_DAYS = 180;                                     // 買ったゴールドの有効期間（購入から180日）
const GUEST_PER_IP_DAY = 20;                // 同じ場所から1日に作れるゲストの数
// テーブル（schema.sql と同じ。何度流しても大丈夫）
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS accounts ( id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, last_login INTEGER NOT NULL, banned INTEGER NOT NULL DEFAULT 0 )",
  "CREATE TABLE IF NOT EXISTS identities ( provider TEXT NOT NULL, sub TEXT NOT NULL, account_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (provider, sub) )",
  "CREATE INDEX IF NOT EXISTS idx_ident_account ON identities(account_id)",
  "CREATE TABLE IF NOT EXISTS saves ( account_id TEXT PRIMARY KEY, rev INTEGER NOT NULL, data TEXT NOT NULL, device TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL )",
  "CREATE TABLE IF NOT EXISTS wallet ( account_id TEXT NOT NULL, source TEXT NOT NULL, balance INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (account_id, source) )",
  "CREATE TABLE IF NOT EXISTS ledger ( id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, source TEXT NOT NULL, delta INTEGER NOT NULL, reason TEXT NOT NULL, ref TEXT NOT NULL, created_at INTEGER NOT NULL )",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_ref ON ledger(account_id, ref, source)",
  "CREATE INDEX IF NOT EXISTS idx_ledger_time ON ledger(created_at)",
  "CREATE TABLE IF NOT EXISTS scores ( id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT NOT NULL, name TEXT NOT NULL, mode TEXT NOT NULL, score INTEGER NOT NULL, blocks INTEGER NOT NULL DEFAULT 0, dur INTEGER NOT NULL DEFAULT 0, ver TEXT NOT NULL DEFAULT '', log TEXT, created_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_scores_mode_time ON scores(mode, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_scores_mode_score ON scores(mode, score DESC)",
  "CREATE INDEX IF NOT EXISTS idx_scores_player ON scores(player, created_at)",
  "CREATE TABLE IF NOT EXISTS meta ( k TEXT PRIMARY KEY, v TEXT NOT NULL )",
  "CREATE TABLE IF NOT EXISTS guest_log ( ip TEXT NOT NULL, t INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_guest_log ON guest_log(ip, t)",
  "CREATE TABLE IF NOT EXISTS reward_claims ( account_id TEXT NOT NULL, month TEXT NOT NULL, mode TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (account_id, month, mode) )",
  "CREATE TABLE IF NOT EXISTS medals ( account_id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0, daily TEXT NOT NULL DEFAULT '' )",
  "CREATE TABLE IF NOT EXISTS medal_log ( id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, delta INTEGER NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_medal_log ON medal_log(account_id, created_at)",
  "CREATE TABLE IF NOT EXISTS ratings ( account_id TEXT NOT NULL, kind TEXT NOT NULL, rate INTEGER NOT NULL, win INTEGER NOT NULL DEFAULT 0, lose INTEGER NOT NULL DEFAULT 0, draw INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (account_id, kind) )",
  "CREATE INDEX IF NOT EXISTS idx_ratings ON ratings(kind, rate DESC)",
  "CREATE TABLE IF NOT EXISTS ratings_month ( account_id TEXT NOT NULL, kind TEXT NOT NULL, month TEXT NOT NULL, rate INTEGER NOT NULL, games INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (account_id, kind, month) )",
  "CREATE INDEX IF NOT EXISTS idx_ratings_month ON ratings_month(kind, month, rate DESC)",
  "CREATE TABLE IF NOT EXISTS defense ( account_id TEXT PRIMARY KEY, team TEXT NOT NULL, power INTEGER NOT NULL, updated_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_defense_power ON defense(power)",
  "CREATE TABLE IF NOT EXISTS arena ( account_id TEXT PRIMARY KEY, coins INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 1000, win INTEGER NOT NULL DEFAULT 0, lose INTEGER NOT NULL DEFAULT 0, day TEXT NOT NULL DEFAULT '', tries INTEGER NOT NULL DEFAULT 0 )",
  "CREATE TABLE IF NOT EXISTS arena_log ( id INTEGER PRIMARY KEY AUTOINCREMENT, defender TEXT NOT NULL, attacker TEXT NOT NULL, attacker_name TEXT NOT NULL, attacker_cc TEXT NOT NULL DEFAULT '', win INTEGER NOT NULL, created_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_arena_log ON arena_log(defender, created_at)",
  "CREATE TABLE IF NOT EXISTS gold_lots ( id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, source TEXT NOT NULL, amount INTEGER NOT NULL, left_n INTEGER NOT NULL, bought_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ref TEXT NOT NULL DEFAULT '' )",
  "CREATE INDEX IF NOT EXISTS idx_gold_lots ON gold_lots(account_id, expires_at)"
  ];

// ---------- 小さな道具 ----------
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const randId = (n = 16) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const listOf = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

function corsHeaders(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allow = listOf(env.ALLOW_ORIGINS);
  const ok = allow.includes('*') || allow.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? (origin || '*') : (allow[0] || ''),
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
const json = (env, req, obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(env, req) },
});
const fail = (env, req, msg, status = 400) => json(env, req, { error: msg }, status);

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function aesKey(secret) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('state:' + secret));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
// ログイン状態の札（署名つき）
async function makeSession(env, accountId) {
  const body = b64u(enc.encode(JSON.stringify({ a: accountId, e: nowSec() + SESSION_DAYS * 86400, v: 1 })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(body));
  return body + '.' + b64u(sig);
}
async function readSession(env, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET), unb64u(sig), enc.encode(body));
  if (!ok) return null;
  try { const p = JSON.parse(dec.decode(unb64u(body))); return p.e > nowSec() ? p : null; } catch (e) { return null; }
}
// ログインの途中で持ち回る情報（暗号化して外に出す）
async function sealState(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env.SESSION_SECRET), enc.encode(JSON.stringify(obj)));
  return b64u(iv) + '.' + b64u(ct);
}
async function openState(env, s) {
  try {
    const [iv, ct] = String(s || '').split('.');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await aesKey(env.SESSION_SECRET), unb64u(ct));
    const o = JSON.parse(dec.decode(pt));
    return o.exp > nowSec() ? o : null;
  } catch (e) { return null; }
}
const jwtPayload = t => { try { return JSON.parse(dec.decode(unb64u(String(t).split('.')[1]))); } catch (e) { return null; } };
function cleanName(s) {
  const t = String(s || '').replace(/[\r\n\t<>]/g, ' ').trim().slice(0, 12);
  return t || 'ななし';
}

// ---------- ログインのサービス ----------
const PROVIDERS = {
  google: {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid profile',
    id: env => env.GOOGLE_CLIENT_ID, secret: env => env.GOOGLE_CLIENT_SECRET,
    iss: iss => iss === 'https://accounts.google.com' || iss === 'accounts.google.com',
  },
  line: {
    auth: 'https://access.line.me/oauth2/v2.1/authorize',
    token: 'https://api.line.me/oauth2/v2.1/token',
    scope: 'openid profile',
    id: env => env.LINE_CHANNEL_ID, secret: env => env.LINE_CHANNEL_SECRET,
    iss: iss => iss === 'https://access.line.me',
  },
  microsoft: {
    auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'openid profile',
    id: env => env.MS_CLIENT_ID, secret: env => env.MS_CLIENT_SECRET,
    iss: iss => /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]+\/v2\.0$/.test(iss),
  },
};

function returnOk(env, ret) {
  try { const u = new URL(ret); return listOf(env.RETURN_ORIGINS).includes(u.origin); } catch (e) { return false; }
}
const callbackUrl = (req, p) => new URL('/auth/' + p + '/callback', req.url).toString();
const backTo = (ret, params) => Response.redirect(ret.split('#')[0] + '#' + new URLSearchParams(params).toString(), 302);

async function authStart(env, req, p) {
  const url = new URL(req.url), ret = url.searchParams.get('ret') || '';
  if (!returnOk(env, ret)) return new Response('戻り先が許可されていません', { status: 400 });
  const link = url.searchParams.get('link') || '';           // 今のアカウントに、別のログイン方法をつなげるとき
  if (p === 'dev') {
    if (env.DEV_LOGIN !== '1') return new Response('not found', { status: 404 });
    const sub = (url.searchParams.get('sub') || 'tester').slice(0, 40);
    return finishLogin(env, req, 'dev', sub, 'テスト' + sub.slice(0, 6), ret, link);
  }
  const P = PROVIDERS[p]; if (!P || !P.id(env)) return new Response('このログインはまだ使えません', { status: 404 });
  const verifier = randId(32), nonce = randId(16);
  const challenge = b64u(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
  const state = await sealState(env, { p, ret, v: verifier, n: nonce, link, exp: nowSec() + 600 });
  const q = new URLSearchParams({
    response_type: 'code', client_id: P.id(env), redirect_uri: callbackUrl(req, p), scope: P.scope,
    state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
  });
  if (p === 'google') q.set('prompt', 'select_account');
  return Response.redirect(P.auth + '?' + q.toString(), 302);
}

async function authCallback(env, req, p) {
  const url = new URL(req.url);
  const st = await openState(env, url.searchParams.get('state'));
  if (!st || st.p !== p) return new Response('ログインの有効期限が切れました。もう一度やり直してください', { status: 400 });
  if (url.searchParams.get('error')) return backTo(st.ret, { tr_error: 'cancel' });
  const P = PROVIDERS[p];
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: callbackUrl(req, p),
    client_id: P.id(env), client_secret: P.secret(env), code_verifier: st.v,
  });
  const r = await fetch(P.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const tok = await r.json().catch(() => ({}));
  // 受け取りはこのサーバーから相手のサーバーへ直接（TLS）なので、中身の確認は期限・宛先・発行元・nonce で行う
  const idt = tok.id_token && jwtPayload(tok.id_token);
  if (!r.ok || !idt) return backTo(st.ret, { tr_error: 'token' });
  const aud = Array.isArray(idt.aud) ? idt.aud : [idt.aud];
  if (!aud.includes(P.id(env)) || !P.iss(idt.iss) || idt.exp < nowSec() || (idt.nonce && idt.nonce !== st.n) || !idt.sub)
    return backTo(st.ret, { tr_error: 'verify' });
  return finishLogin(env, req, p, String(idt.sub), idt.name || '', st.ret, st.link);
}

async function finishLogin(env, req, p, sub, name, ret, link) {
  const t = nowSec();
  const found = await env.DB.prepare('SELECT account_id FROM identities WHERE provider = ? AND sub = ?').bind(p, sub).first();
  let accountId = found && found.account_id, isNew = false;
  if (link) {                                                 // つなげる：今のアカウントに追加
    const s = await readSession(env, link);
    if (!s) return backTo(ret, { tr_error: 'link' });
    if (accountId && accountId !== s.a) return backTo(ret, { tr_error: 'used' });   // ほかのアカウントで使われている
    if (!accountId) await env.DB.prepare('INSERT INTO identities (provider, sub, account_id, created_at) VALUES (?, ?, ?, ?)').bind(p, sub, s.a, t).run();
    accountId = s.a;
  } else if (!accountId) {                                    // はじめて：アカウントを作る
    accountId = randId(12); isNew = true;
    await env.DB.batch([
      env.DB.prepare('INSERT INTO accounts (id, name, created_at, last_login) VALUES (?, ?, ?, ?)').bind(accountId, cleanName(name), t, t),
      env.DB.prepare('INSERT INTO identities (provider, sub, account_id, created_at) VALUES (?, ?, ?, ?)').bind(p, sub, accountId, t),
    ]);
  }
  const acc = await env.DB.prepare('SELECT banned FROM accounts WHERE id = ?').bind(accountId).first();
  if (!acc || acc.banned) return backTo(ret, { tr_error: 'banned' });
  await env.DB.prepare('UPDATE accounts SET last_login = ? WHERE id = ?').bind(t, accountId).run();
  return backTo(ret, { tr_token: await makeSession(env, accountId), tr_new: isNew ? '1' : '0', tr_p: p });
}

// ---------- ログインが必要なAPI ----------
async function who(env, req) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get('Authorization') || '');
  const s = m && await readSession(env, m[1]);
  if (!s) return null;
  const acc = await env.DB.prepare('SELECT id, name, banned, created_at FROM accounts WHERE id = ?').bind(s.a).first();
  return acc && !acc.banned ? acc : null;
}
// ゴールドコインの残高：配ったゴールド（free・期限なし）と、買ったゴールド（購入ごと・購入から180日）を分けて持つ
// 使うときは合わせて使えるが、買ったゴールドの期限が近いものから先に減る
async function expireGold(env, id) {
  const t = nowSec();
  const { results } = await env.DB.prepare('SELECT id, source, left_n FROM gold_lots WHERE account_id = ? AND left_n > 0 AND expires_at <= ?').bind(id, t).all();
  if (!results || !results.length) return;
  const st = [];
  for (const r of results) {
    st.push(env.DB.prepare('UPDATE gold_lots SET left_n = 0 WHERE id = ?').bind(r.id));
    st.push(env.DB.prepare('INSERT INTO ledger (account_id, source, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, r.source, -r.left_n, 'expire', 'lot-' + r.id, t));
  }
  await env.DB.batch(st);
}
async function walletOf(env, id) {
  await expireGold(env, id);
  const t = nowSec();
  const fr = await env.DB.prepare("SELECT balance FROM wallet WHERE account_id = ? AND source = 'free'").bind(id).first();
  const { results } = await env.DB.prepare('SELECT source, SUM(left_n) AS n FROM gold_lots WHERE account_id = ? AND left_n > 0 AND expires_at > ? GROUP BY source').bind(id, t).all();
  const by = {}; GOLD_SOURCES.forEach(k => by[k] = 0);
  by.free = Math.max(0, fr ? fr.balance : 0);
  (results || []).forEach(r => by[r.source] = r.n || 0);
  const paid = PAID_SOURCES.reduce((a, k) => a + by[k], 0);
  const soon = (await env.DB.prepare('SELECT left_n AS n, expires_at AS at FROM gold_lots WHERE account_id = ? AND left_n > 0 AND expires_at > ? ORDER BY expires_at ASC LIMIT 3').bind(id, t).all()).results || [];
  return { total: by.free + paid, free: by.free, paid, by, expiring: soon, days: GOLD_DAYS };
}
// ゴールドコインを増やす（購入・配布）。同じ ref は2回足さない。買ったゴールドは購入ごとに期限つきで持つ
async function addGold(env, id, source, amount, reason, ref) {
  const t = nowSec();
  const res = await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO ledger (account_id, source, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, source, amount, reason, ref, t),
  ]);
  if (!res[0].meta.changes) return false;                     // もう処理済み
  if (PAID_SOURCES.includes(source))
    await env.DB.prepare('INSERT INTO gold_lots (account_id, source, amount, left_n, bought_at, expires_at, ref) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, source, amount, amount, t, t + GOLD_DAYS * 86400, ref).run();
  else
    await env.DB.prepare('INSERT INTO wallet (account_id, source, balance) VALUES (?, ?, ?) ON CONFLICT(account_id, source) DO UPDATE SET balance = balance + excluded.balance').bind(id, 'free', amount).run();
  return true;
}

async function api(env, req, url) {
  const p = url.pathname, M = req.method;
  if (p === '/api/ping') return json(env, req, { ok: true, now: nowSec(), logins: Object.keys(PROVIDERS).filter(k => PROVIDERS[k].id(env)).concat(env.DEV_LOGIN === '1' ? ['dev'] : []) });

  // ランキング一覧はだれでも見られる
  if (p === '/api/top' && M === 'GET') return rankTop(env, req, url);
  if (p === '/api/vs/top' && M === 'GET') { const m = await who(env, req); return json(env, req, await vsTop(env, VS_KINDS.includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : 'simple', m && m.id)); }
  // ゲスト登録：名前だけでアカウントを作る（ランキング用）。あとで Google などをつなげられる
  if (p === '/api/guest' && M === 'POST') {
    if (env.GUEST_SIGNUP === '0') return fail(env, req, 'ゲスト登録は終わりました。ログインしてください', 403);
    const b = await req.json().catch(() => ({}));
    const t = nowSec(), ip = (req.headers.get('CF-Connecting-IP') || 'local').slice(0, 64);
    const c = await env.DB.prepare('SELECT COUNT(*) AS c FROM guest_log WHERE ip = ? AND t > ?').bind(ip, t - 86400).first();
    if (c && c.c >= GUEST_PER_IP_DAY) return fail(env, req, '登録が多すぎます。時間をおいてください', 429);
    const id = randId(12), name = cleanName(b.name);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO accounts (id, name, created_at, last_login, country) VALUES (?, ?, ?, ?, ?)').bind(id, name, t, t, countryOf(req)),
      env.DB.prepare('INSERT INTO identities (provider, sub, account_id, created_at) VALUES (?, ?, ?, ?)').bind('guest', id, id, t),
      env.DB.prepare('INSERT INTO guest_log (ip, t) VALUES (?, ?)').bind(ip, t),
      env.DB.prepare('DELETE FROM guest_log WHERE t < ?').bind(t - 86400 * 2),
    ]);
    return json(env, req, { ok: true, token: await makeSession(env, id), name });
  }

  const me = await who(env, req);
  if (!me) return fail(env, req, 'ログインしてください', 401);

  if (p === '/api/me' && M === 'GET') {
    const { results } = await env.DB.prepare('SELECT provider FROM identities WHERE account_id = ?').bind(me.id).all();
    const sv = await env.DB.prepare('SELECT rev, updated_at, device FROM saves WHERE account_id = ?').bind(me.id).first();
    return json(env, req, { id: me.id, name: me.name, since: me.created_at, logins: (results || []).map(r => r.provider), gold: await walletOf(env, me.id), save: sv ? { rev: sv.rev, updated: sv.updated_at, device: sv.device } : null });
  }
  if (p === '/api/me/name' && M === 'POST') {
    const b = await req.json().catch(() => ({}));
    const name = cleanName(b.name);
    await env.DB.batch([
      env.DB.prepare('UPDATE accounts SET name = ? WHERE id = ?').bind(name, me.id),
      env.DB.prepare('UPDATE scores SET name = ? WHERE player = ?').bind(name, me.id),
    ]);
    return json(env, req, { ok: true, name });
  }
  // アカウントを消す（ストアの決まりで必要）。ゴールドコインの記録は会計のため名前をはずして残す
  if (p === '/api/me' && M === 'DELETE') {
    const b = await req.json().catch(() => ({}));
    if (b.confirm !== 'DELETE') return fail(env, req, '確認の文字が違います');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM identities WHERE account_id = ?').bind(me.id),
      env.DB.prepare('DELETE FROM saves WHERE account_id = ?').bind(me.id),
      env.DB.prepare('DELETE FROM wallet WHERE account_id = ?').bind(me.id),
      env.DB.prepare("UPDATE gold_lots SET account_id = 'deleted' WHERE account_id = ?").bind(me.id),
      env.DB.prepare('DELETE FROM scores WHERE player = ?').bind(me.id),
      env.DB.prepare("UPDATE ledger SET account_id = 'deleted' WHERE account_id = ?").bind(me.id),
      env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(me.id),
    ]);
    return json(env, req, { ok: true });
  }

  // セーブ
  if (p === '/api/save' && M === 'GET') {
    const sv = await env.DB.prepare('SELECT rev, data, updated_at, device FROM saves WHERE account_id = ?').bind(me.id).first();
    return json(env, req, sv ? { rev: sv.rev, data: JSON.parse(sv.data), updated: sv.updated_at, device: sv.device } : { rev: 0, data: null });
  }
  if (p === '/api/save' && M === 'PUT') {
    const raw = await req.text();
    if (raw.length > SAVE_MAX_BYTES) return fail(env, req, 'セーブが大きすぎます', 413);
    let b; try { b = JSON.parse(raw); } catch (e) { return fail(env, req, 'JSONが読めません'); }
    if (!b.data || typeof b.data !== 'object') return fail(env, req, 'data がありません');
    const cur = await env.DB.prepare('SELECT rev, data, updated_at, device FROM saves WHERE account_id = ?').bind(me.id).first();
    const curRev = cur ? cur.rev : 0;
    // ほかの端末が先に保存していたら、上書きせずにサーバーの方を返す（端末側でどちらを使うか決める）
    if (!b.force && Number(b.baseRev) !== curRev) return json(env, req, { conflict: true, rev: curRev, data: cur ? JSON.parse(cur.data) : null, updated: cur ? cur.updated_at : 0, device: cur ? cur.device : '' }, 409);
    const rev = curRev + 1, t = nowSec(), device = String(b.device || '').slice(0, 40), data = JSON.stringify(b.data);
    await env.DB.prepare('INSERT INTO saves (account_id, rev, data, device, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET rev = excluded.rev, data = excluded.data, device = excluded.device, updated_at = excluded.updated_at').bind(me.id, rev, data, device, t).run();
    return json(env, req, { ok: true, rev, updated: t });
  }

  // ゴールドコイン
  if (p === '/api/wallet' && M === 'GET') return json(env, req, await walletOf(env, me.id));
  if (p === '/api/wallet/spend' && M === 'POST') {
    const b = await req.json().catch(() => ({}));
    const amount = Math.floor(Number(b.amount)), reason = String(b.reason || 'spend').slice(0, 24), ref = String(b.ref || '').slice(0, 64);
    if (!(amount > 0 && amount <= 100000)) return fail(env, req, '数が不正です');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(ref)) return fail(env, req, 'ref が不正です');
    const done = await env.DB.prepare('SELECT 1 FROM ledger WHERE account_id = ? AND ref = ? LIMIT 1').bind(me.id, ref).first();
    if (done) return json(env, req, { ok: true, again: true, gold: await walletOf(env, me.id) });   // 同じ支払いを2回しない
    const w = await walletOf(env, me.id);
    if (w.total < amount) return json(env, req, { error: 'ゴールドコインが足りません', gold: w }, 402);
    // 買ったゴールド（期限の近いものから）→ 配ったゴールド の順に減らす
    let left = amount, nLog = 0; const stmts = [], t = nowSec();
    const refN = sfx => (nLog++ ? ref + '-' + sfx : ref);   // 1つ目はそのままの ref（2回払いの確認に使う）。2つ目からは後ろに印
    const lots = (await env.DB.prepare('SELECT id, source, left_n FROM gold_lots WHERE account_id = ? AND left_n > 0 AND expires_at > ? ORDER BY expires_at ASC, id ASC').bind(me.id, t).all()).results || [];
    for (const l of lots) {
      const take = Math.min(left, l.left_n); if (!take) continue;
      stmts.push(env.DB.prepare('UPDATE gold_lots SET left_n = left_n - ? WHERE id = ? AND left_n >= ?').bind(take, l.id, take));
      stmts.push(env.DB.prepare('INSERT INTO ledger (account_id, source, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(me.id, l.source, -take, 'spend:' + reason, refN(l.id), t));
      left -= take; if (!left) break;
    }
    if (left > 0) {
      stmts.push(env.DB.prepare("UPDATE wallet SET balance = balance - ? WHERE account_id = ? AND source = 'free'").bind(left, me.id));
      stmts.push(env.DB.prepare('INSERT INTO ledger (account_id, source, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(me.id, 'free', -left, 'spend:' + reason, refN('free'), t));
    }
    await env.DB.batch(stmts);
    return json(env, req, { ok: true, gold: await walletOf(env, me.id) });
  }

  // テスト用：ゴールドコインを配る（DEV_LOGIN = "1" のときだけ動く）
  if (p === '/api/dev/grant' && M === 'POST' && env.DEV_LOGIN === '1') {
    const b = await req.json().catch(() => ({}));
    const amount = Math.max(1, Math.min(100000, Math.floor(Number(b.amount) || 1000)));
    await addGold(env, me.id, 'free', amount, 'grant:test', 'test-' + randId(8));
    return json(env, req, { ok: true, gold: await walletOf(env, me.id) });
  }

  // ランキングに登録
  if (p === '/api/score' && M === 'POST') { await setCountry(env, req, me.id); return rankPost(env, req, me); }
  // ---- オートバトル（オフライン対戦）----
  if (p === '/api/arena' && M === 'GET') return json(env, req, await arenaHome(env, me, nowSec()));
  if (p.startsWith('/api/arena/') && M === 'POST') {
    const b = await req.json().catch(() => ({})), op = p.slice(11), t = nowSec();
    const me2 = Object.assign({}, me, { cc: (await env.DB.prepare('SELECT country FROM accounts WHERE id = ?').bind(me.id).first() || {}).country || '' });
    const r = op === 'defense' ? await arenaSetDefense(env, me2, b.team, t) : op === 'fight' ? await arenaFight(env, me2, b, t) : { error: 'not found' };
    return r.error ? fail(env, req, r.error, 409) : json(env, req, r);
  }
  // ---- 対戦の月間プレゼント ----
  if (p === '/api/vs/reward' && M === 'GET') return json(env, req, { rewards: await vsRewards(env, me.id) });
  if (p === '/api/vs/reward/claim' && M === 'POST') { const b = await req.json().catch(() => ({})); const r = await vsClaim(env, me.id, String(b.kind || '')); return r.error ? fail(env, req, r.error, 409) : json(env, req, r); }
  // ---- 対戦メダル ----
  if (p === '/api/medal' && M === 'GET') {
    const m = await medalOf(env, me.id), t = nowSec();
    const today = new Date((t + TZ) * 1000).toISOString().slice(0, 10);
    return json(env, req, { balance: m ? m.balance : 0, daily: !m || m.daily !== today, first: !m, firstN: MEDAL.first, dailyN: MEDAL.daily, bets: MEDAL.bets, shop: MEDAL_SHOP });
  }
  if (p === '/api/medal/daily' && M === 'POST') {
    const got = await medalDaily(env, me.id, nowSec()), m = await medalOf(env, me.id);
    return json(env, req, { got, balance: m ? m.balance : 0 });
  }
  if (p === '/api/medal/buy' && M === 'POST') {
    const b = await req.json().catch(() => ({})), it = MEDAL_SHOP.find(x => x.k === b.k);
    if (!it) return fail(env, req, 'その品物はありません');
    if (!await medalTake(env, me.id, it.price, 'buy:' + it.k, nowSec())) return fail(env, req, '対戦メダルが足りません', 402);
    const m = await medalOf(env, me.id);
    return json(env, req, { ok: true, k: it.k, balance: m ? m.balance : 0 });
  }
  // ---- 対戦の相手さがし ----
  if (p.startsWith('/api/vs/') && M === 'POST') {
    const b = await req.json().catch(() => ({})), op = p.slice(8);
    if (!['quick', 'create', 'join', 'cancel'].includes(op)) return fail(env, req, 'not found', 404);
    const kind = VS_KINDS.includes(b.kind) ? b.kind : 'simple', bet = MEDAL.bets.includes(+b.bet) ? +b.bet : 0;
    if ((op === 'quick' || op === 'create') && bet) {
      const m = await medalOf(env, me.id);
      if (!m || m.balance < bet) return fail(env, req, '対戦メダルが足りません', 402);
    }
    const lob = env.LOBBY.get(env.LOBBY.idFromName('lobby'));
    const r = await lob.fetch('https://lobby/', { method: 'POST', body: JSON.stringify({ op, kind, bet, code: String(b.code || ''), room: String(b.room || ''), player: me.id }) });
    const o = await r.json();
    return o.error ? fail(env, req, o.error) : json(env, req, o);
  }
  // 先月の順位のごほうび（見る・受け取る）
  if (p === '/api/reward' && M === 'GET') return json(env, req, { rewards: await monthRewards(env, me.id) });
  if (p === '/api/reward/claim' && M === 'POST') {
    const b = await req.json().catch(() => ({}));
    const r = (await monthRewards(env, me.id)).find(x => x.mode === b.mode);
    if (!r) return fail(env, req, '受け取れるごほうびがありません', 404);
    const res = await env.DB.prepare('INSERT OR IGNORE INTO reward_claims (account_id, month, mode, created_at) VALUES (?, ?, ?, ?)').bind(me.id, r.month, r.mode, nowSec()).run();
    if (!res.meta.changes) return fail(env, req, 'もう受け取りました', 409);
    return json(env, req, { ok: true, reward: r });
  }

  return fail(env, req, 'not found', 404);
}

// ---------- ランキング ----------
const PERIODS = ['day', 'week', 'month', 'all'];
// 今日・今週・今月の区切りは日本時間（RANK_TZ_HOURS で変えられる）
let TZ = 9 * 3600;
function since(period, t) {
  if (period === 'all') return 0;
  return sinceUtc(period, t + TZ) - TZ;
}
function sinceUtc(period, t) {
  const d = new Date(t * 1000);
  if (period === 'day') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
  if (period === 'week') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7) / 1000;
  if (period === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  return 0;
}
async function myRank(env, mode, period, player, t) {
  const from = since(period, t);
  const best = await env.DB.prepare('SELECT MAX(score) AS s FROM scores WHERE mode = ? AND player = ? AND created_at >= ?').bind(mode, player, from).first();
  const s = best && best.s != null ? best.s : null;
  if (s == null) return { best: null, rank: null, total: null };
  const above = await env.DB.prepare('SELECT COUNT(*) AS c FROM (SELECT player, MAX(score) AS m FROM scores WHERE mode = ? AND created_at >= ? GROUP BY player) WHERE m > ?').bind(mode, from, s).first();
  const total = await env.DB.prepare('SELECT COUNT(DISTINCT player) AS c FROM scores WHERE mode = ? AND created_at >= ?').bind(mode, from).first();
  return { best: s, rank: (above.c || 0) + 1, total: total.c || 0 };
}
async function rankTop(env, req, url) {
  const t = nowSec();
  const mode = (url.searchParams.get('mode') || 'sixty').slice(0, 16);
  const period = PERIODS.includes(url.searchParams.get('period')) ? url.searchParams.get('period') : 'day';
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 20)));
  const { results } = await env.DB.prepare('SELECT s.player, s.name, MAX(s.score) AS score, MAX(s.created_at) AS at, (SELECT country FROM accounts a WHERE a.id = s.player) AS cc FROM scores s WHERE s.mode = ? AND s.created_at >= ? GROUP BY s.player ORDER BY score DESC, at ASC LIMIT ?').bind(mode, since(period, t), limit).all();
  const me = await who(env, req);
  return json(env, req, {
    period, mode,
    top: (results || []).map((r, i) => ({ rank: i + 1, name: r.name, cc: r.cc || '', score: r.score, me: !!(me && r.player === me.id) })),
    me: me ? await myRank(env, mode, period, me.id, t) : null,
    // 月間のごほうび（順位ごとの中身）と、今月のいまの順位
    prizes: MONTH_REWARDS.map(x => ({ upTo: x.upTo, label: x.label, items: x.items })),
    month: me ? await myRank(env, mode, 'month', me.id, t) : null,
  });
}
async function rankPost(env, req, me) {
  const t = nowSec();
  const b = await req.json().catch(() => null); if (!b) return fail(env, req, 'JSONが読めません');
  const row = {
    mode: String(b.mode || 'sixty').slice(0, 16), score: Math.floor(Number(b.score)),
    blocks: Math.floor(Number(b.blocks || 0)), dur: Math.floor(Number(b.dur || 0)),
    ver: String(b.ver || '').slice(0, 16), log: b.log ? String(b.log).slice(0, 20000) : null,
  };
  const maxPer = Number(env.MAX_SCORE_PER_BLOCK || 200), minSec = Number(env.MIN_SEC_PER_BLOCK || 0.12);
  if (!Number.isFinite(row.score) || row.score < 0 || row.score > 50000000) return fail(env, req, 'スコアの値が不正です');
  if (row.score > 0 && row.blocks === 0) return fail(env, req, 'ブロックを消さずに得点しています');
  if (row.blocks > 0 && row.score > row.blocks * maxPer) return fail(env, req, 'スコアがブロック数に対して多すぎます');
  if (row.blocks > 0 && row.dur > 0 && row.dur < row.blocks * minSec) return fail(env, req, 'プレイ時間が短すぎます');
  const last = await env.DB.prepare('SELECT created_at FROM scores WHERE player = ? ORDER BY created_at DESC LIMIT 1').bind(me.id).first();
  if (last && t - last.created_at < 10) return fail(env, req, '送信が早すぎます', 429);
  await env.DB.prepare('INSERT INTO scores (player, name, mode, score, blocks, dur, ver, log, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(me.id, me.name, row.mode, row.score, row.blocks, row.dur, row.ver, row.log, t).run();
  // 順位は「今回の点数」で出す（ほかの人の自己ベストと比べる）。自己ベストの順位も別に返す
  const ranks = {};
  for (const pd of PERIODS) {
    const from = since(pd, t), my = await myRank(env, row.mode, pd, me.id, t);
    const above = await env.DB.prepare('SELECT COUNT(*) AS c FROM (SELECT player, MAX(score) AS m FROM scores WHERE mode = ? AND created_at >= ? AND player <> ? GROUP BY player) WHERE m > ?').bind(row.mode, from, me.id, row.score).first();
    ranks[pd] = { rank: (above.c || 0) + 1, total: my.total, best: my.best, bestRank: my.rank };
  }
  return json(env, req, { ok: true, ranks });
}

// ---------- 月間ランキングのごほうび ----------
// 先月（日本時間）の自己ベストの順位で決まる。中身はここで変えられる（ゲームの更新なしで変わる）
const MONTH_REWARDS = [
  { upTo: 1,   label: '1位',       items: { gticket_hi: 3, refresh100: 3, star9: 1, stampot: 5 } },
  { upTo: 3,   label: '2〜3位',    items: { gticket_hi: 2, refresh80: 3, star6: 1, stampot: 4 } },
  { upTo: 10,  label: '4〜10位',   items: { gticket_hi: 1, refresh50: 3, star3: 2, stampot: 3 } },
  { upTo: 50,  label: '11〜50位',  items: { gticket: 3, refresh30: 3, slow: 1, stampot: 2 } },
  { upTo: 100, label: '51〜100位', items: { gticket: 1, refresh30: 2, stampot: 1 } },
  { upTo: 0,   label: '参加賞',    items: { refresh30: 1, stampot: 1 } },          // 0 は「それ以下ぜんぶ」
];
const REWARD_MODES = ['sixty', 'rank'];
function lastMonth(t) {
  const to = since('month', t), from = since('month', to - 1);
  const d = new Date((from + TZ) * 1000);
  return { from, to, key: d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') };
}
async function monthRewards(env, player) {
  const m = lastMonth(nowSec()), out = [];
  for (const mode of REWARD_MODES) {
    const best = await env.DB.prepare('SELECT MAX(score) AS s FROM scores WHERE mode = ? AND player = ? AND created_at >= ? AND created_at < ?').bind(mode, player, m.from, m.to).first();
    if (!best || best.s == null) continue;
    const done = await env.DB.prepare('SELECT 1 FROM reward_claims WHERE account_id = ? AND month = ? AND mode = ?').bind(player, m.key, mode).first();
    if (done) continue;
    const above = await env.DB.prepare('SELECT COUNT(*) AS c FROM (SELECT player, MAX(score) AS b FROM scores WHERE mode = ? AND created_at >= ? AND created_at < ? GROUP BY player) WHERE b > ?').bind(mode, m.from, m.to, best.s).first();
    const total = await env.DB.prepare('SELECT COUNT(DISTINCT player) AS c FROM scores WHERE mode = ? AND created_at >= ? AND created_at < ?').bind(mode, m.from, m.to).first();
    const rank = (above.c || 0) + 1, tier = MONTH_REWARDS.find(x => !x.upTo || rank <= x.upTo);
    out.push({ month: m.key, mode, rank, total: total.c || 0, best: best.s, label: tier.label, items: tier.items });
  }
  return out;
}

// つないだ場所の国（Cloudflare が判定する2文字の国コード。住所などは使わない）
const countryOf = req => { const c = String((req.cf && req.cf.country) || '').toUpperCase(); return /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1' ? c : ''; };
async function setCountry(env, req, id) { const c = countryOf(req); if (c) await env.DB.prepare('UPDATE accounts SET country = ? WHERE id = ? AND country <> ?').bind(c, id, c).run(); return c; }

// ---------- 準備（テーブルを作る・署名用の秘密を用意する）。1つの実行環境につき1回だけ ----------
let ready = null;
// ---------- テスト用のダミー（ランキングがさびしくないように）----------
// DUMMY_RANK="1" のあいだだけ20人ぶん入れる。毎日入れなおすので「今日」「今週」にも出る。
// 公開前に DUMMY_RANK="0" にすると、次に起動したとき全部消える（IDが dummy_ で始まるものだけ）
const DUMMY = [
  ['Sora', 'JP'], ['Mia', 'US'], ['Lucas', 'BR'], ['Haneul', 'KR'], ['Emma', 'FR'], ['Ken', 'JP'], ['Noah', 'CA'], ['Lina', 'DE'],
  ['Arjun', 'IN'], ['Yui', 'JP'], ['Mateo', 'MX'], ['Chloe', 'GB'], ['Ploy', 'TH'], ['Rizky', 'ID'], ['Ana', 'ES'], ['Wei', 'TW'],
  ['Giulia', 'IT'], ['Minh', 'VN'], ['Jack', 'AU'], ['Riko', 'JP'],
];
async function dummyRank(env) {
  const on = String(env.DUMMY_RANK || '0') === '1', del = [
    "DELETE FROM scores WHERE player LIKE 'dummy\\_%' ESCAPE '\\'", "DELETE FROM ratings WHERE account_id LIKE 'dummy\\_%' ESCAPE '\\'",
    "DELETE FROM ratings_month WHERE account_id LIKE 'dummy\\_%' ESCAPE '\\'", "DELETE FROM accounts WHERE id LIKE 'dummy\\_%' ESCAPE '\\'"];
  const t = nowSec(), day = new Date((t + TZ) * 1000).toISOString().slice(0, 10);
  const mk = await env.DB.prepare("SELECT v FROM meta WHERE k = 'dummy_day'").first();
  if (!on) { if (mk) { await env.DB.batch(del.concat("DELETE FROM meta WHERE k = 'dummy_day'").map(q => env.DB.prepare(q))); } return; }
  if (mk && mk.v === day) return;
  const month = new Date((t + TZ) * 1000).toISOString().slice(0, 7), dayStart = t - ((t + TZ) % 86400);
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const q = del.map(x => env.DB.prepare(x));
  DUMMY.forEach(([name, cc], i) => {
    const id = 'dummy_' + String(i + 1).padStart(2, '0'), at = Math.min(t, dayStart + rnd(60, Math.max(120, t - dayStart)));
    q.push(env.DB.prepare('INSERT INTO accounts (id, name, created_at, last_login, banned, country) VALUES (?, ?, ?, ?, 0, ?)').bind(id, name, t, t, cc));
    q.push(env.DB.prepare('INSERT INTO scores (player, name, mode, score, blocks, dur, ver, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, name, 'sixty', rnd(15, 120) * 100, rnd(30, 200), 60, 'dummy', at));
    q.push(env.DB.prepare('INSERT INTO scores (player, name, mode, score, blocks, dur, ver, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, name, 'rank', rnd(30, 400) * 100, rnd(60, 900), rnd(120, 900), 'dummy', at));
    for (const kind of ['simple', 'chara']) {
      const rate = rnd(880, 1420), w = rnd(3, 30), l = rnd(3, 25);
      q.push(env.DB.prepare('INSERT INTO ratings (account_id, kind, rate, win, lose, draw, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)').bind(id, kind, rate, w, l, t));
      q.push(env.DB.prepare('INSERT INTO ratings_month (account_id, kind, month, rate, games) VALUES (?, ?, ?, ?, ?)').bind(id, kind, month, rate, w + l));
    }
  });
  q.push(env.DB.prepare("INSERT INTO meta (k, v) VALUES ('dummy_day', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(day));
  await env.DB.batch(q);
}
function prepared(env) {
  if (!ready) ready = (async () => {
    await env.DB.batch(SCHEMA.map(q => env.DB.prepare(q)));
    // あとから足した列（すでにあればエラーになるので無視）
    for (const q of ["ALTER TABLE accounts ADD COLUMN country TEXT NOT NULL DEFAULT ''"]) { try { await env.DB.prepare(q).run(); } catch (e) {} }
    let secret = env.SESSION_SECRET;
    if (!secret) {
      await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('session_secret', ?)").bind(randId(48)).run();
      secret = (await env.DB.prepare("SELECT v FROM meta WHERE k = 'session_secret'").first()).v;
    }
    if (env.RANK_TZ_HOURS != null && env.RANK_TZ_HOURS !== '') TZ = Number(env.RANK_TZ_HOURS) * 3600;
    try { await dummyRank(env); } catch (e) {}
    return secret;
  })().catch(e => { ready = null; throw e; });
  return ready.then(secret => Object.assign({}, env, { SESSION_SECRET: secret }));
}

// ---------- 対戦の部屋へ（WebSocket）。札は ?t= で受け取る ----------
async function wsRoom(env, req, url) {
  if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
  const s = await readSession(env, url.searchParams.get('t'));
  const acc = s && await env.DB.prepare('SELECT id, name, banned FROM accounts WHERE id = ?').bind(s.a).first();
  if (!acc || acc.banned) return new Response('login', { status: 401 });
  const room = url.pathname.slice(9).replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  if (!room) return new Response('room', { status: 400 });
  let team = null; try { team = JSON.parse(url.searchParams.get('team') || 'null'); } catch (e) {}
  const cc = (await setCountry(env, req, acc.id)) || (await env.DB.prepare('SELECT country FROM accounts WHERE id = ?').bind(acc.id).first() || {}).country || '';
  const me = { id: acc.id, name: acc.name, cc, kind: url.searchParams.get('kind'), bet: +url.searchParams.get('bet') || 0, room, team };
  const u = new URL(req.url); u.searchParams.set('_me', JSON.stringify(me)); u.searchParams.delete('t');
  return env.ROOM.get(env.ROOM.idFromName(room)).fetch(new Request(u.toString(), req));
}

// ---------- 入口 ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(env, req) });
    try {
      env = await prepared(env);
      const m = /^\/auth\/([a-z]+)\/(start|callback)$/.exec(url.pathname);
      if (m) return m[2] === 'start' ? authStart(env, req, m[1]) : authCallback(env, req, m[1]);
      if (url.pathname.startsWith('/ws/room/')) return await wsRoom(env, req, url);
      if (url.pathname.startsWith('/api/')) return await api(env, req, url);
      return new Response('TWIST RUSH server', { status: 200 });
    } catch (e) {
      return fail(env, req, 'サーバーのエラー：' + (e && e.message || e), 500);
    }
  },
};
// addGold() は、あとで Stripe・ストアの購入通知を受けたときに使う
