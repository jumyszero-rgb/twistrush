// フレンド（2026-11-24 本人：①フレンドID・申請・承認。チャットはなし、決まったひとことを選んで送れる）
//   ・1人1つ、8けたの「フレンドID」（中の番号とは別。人に見せてよい）
//   ・申請 → 相手が「承認」か「ことわる」。おたがいに申請していたら、そのままフレンド
//   ・フレンドは50人まで。出している申請は20件まで。外す・ブロックができる
//   ・ひとこと：決まった文（番号）だけ送れる。同じ相手には10秒に1回、1人に届くのは新しい50件まで
export const FRIEND_MAX = 50, FREQ_MAX = 20, FMSG_GAP = 10, FMSG_KEEP = 50;
export const FMSG_N = 16;                           // ひとことの数（文はゲームの側に持つ。ここでは番号の範囲だけ見る）

export const FRIEND_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS fcode ( account_id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE )",
  "CREATE TABLE IF NOT EXISTS friends ( a TEXT NOT NULL, b TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (a, b) )",
  "CREATE INDEX IF NOT EXISTS idx_friends_b ON friends(b, status)",
  "CREATE TABLE IF NOT EXISTS fblock ( a TEXT NOT NULL, b TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (a, b) )",
  "CREATE TABLE IF NOT EXISTS fmsg ( id INTEGER PRIMARY KEY AUTOINCREMENT, from_id TEXT NOT NULL, to_id TEXT NOT NULL, m INTEGER NOT NULL, created_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_fmsg_to ON fmsg(to_id, id)",
];
// friends の status：'ok'＝フレンド（a→b と b→a の2行）／'req'＝a から b への申請（1行）

const rnd8 = () => { const a = crypto.getRandomValues(new Uint32Array(1))[0] % 90000000; return String(10000000 + a); };
export async function fcodeOf(env, id) {
  const r = await env.DB.prepare('SELECT code FROM fcode WHERE account_id = ?').bind(id).first();
  if (r) return r.code;
  for (let i = 0; i < 8; i++) {
    const code = rnd8();
    try { await env.DB.prepare('INSERT INTO fcode (account_id, code) VALUES (?, ?)').bind(id, code).run(); return code; } catch (_) {}
  }
  throw new Error('code');
}
const idOfCode = async (env, code) => { const r = await env.DB.prepare('SELECT account_id FROM fcode WHERE code = ?').bind(String(code || '').replace(/\D/g, '')).first(); return r ? r.account_id : null; };
const cnt = async (env, sql, ...b) => { const r = await env.DB.prepare(sql).bind(...b).first(); return (r && r.n) || 0; };

// 一覧（フレンド・届いた申請・出した申請・ブロック・ひとこと）
export async function friendHome(env, me) {
  const code = await fcodeOf(env, me.id);
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then(r => r.results || []);
  const card = "a.name AS name, c.code AS code, a.last_login AS seen, (SELECT MAX(rate) FROM ratings r WHERE r.account_id = a.id) AS rate";
  const friends = await q(`SELECT ${card}, f.created_at AS since FROM friends f JOIN accounts a ON a.id = f.b JOIN fcode c ON c.account_id = f.b WHERE f.a = ? AND f.status = 'ok' ORDER BY a.last_login DESC`, me.id);
  const incoming = await q(`SELECT ${card}, f.created_at AS t FROM friends f JOIN accounts a ON a.id = f.a JOIN fcode c ON c.account_id = f.a WHERE f.b = ? AND f.status = 'req' ORDER BY f.created_at DESC`, me.id);
  const outgoing = await q(`SELECT ${card}, f.created_at AS t FROM friends f JOIN accounts a ON a.id = f.b JOIN fcode c ON c.account_id = f.b WHERE f.a = ? AND f.status = 'req' ORDER BY f.created_at DESC`, me.id);
  const blocked = await q(`SELECT a.name AS name, c.code AS code FROM fblock k JOIN accounts a ON a.id = k.b JOIN fcode c ON c.account_id = k.b WHERE k.a = ?`, me.id);
  const msgs = await q(`SELECT m.id AS id, m.m AS m, m.created_at AS t, a.name AS name, c.code AS code FROM fmsg m JOIN accounts a ON a.id = m.from_id JOIN fcode c ON c.account_id = m.from_id WHERE m.to_id = ? ORDER BY m.id DESC LIMIT ?`, me.id, FMSG_KEEP);
  return { code, name: me.name, friends, incoming, outgoing, blocked, msgs, max: FRIEND_MAX };
}

// 操作。返り値 {ok} か {error}
export async function friendAct(env, me, op, b, t) {
  const other = await idOfCode(env, b.code);
  if (!other) return { error: 'そのフレンドIDは見つかりませんでした' };
  if (other === me.id) return { error: '自分のフレンドIDです' };
  const has = async (a, bb, st) => !!(await env.DB.prepare('SELECT 1 FROM friends WHERE a = ? AND b = ? AND status = ?').bind(a, bb, st).first());
  const unlink = () => env.DB.batch([
    env.DB.prepare('DELETE FROM friends WHERE a = ? AND b = ?').bind(me.id, other),
    env.DB.prepare('DELETE FROM friends WHERE a = ? AND b = ?').bind(other, me.id)]);
  const link = () => env.DB.batch([
    env.DB.prepare('DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)').bind(me.id, other, other, me.id),
    env.DB.prepare("INSERT INTO friends (a, b, status, created_at) VALUES (?, ?, 'ok', ?)").bind(me.id, other, t),
    env.DB.prepare("INSERT INTO friends (a, b, status, created_at) VALUES (?, ?, 'ok', ?)").bind(other, me.id, t)]);
  const nFriends = id => cnt(env, "SELECT COUNT(*) AS n FROM friends WHERE a = ? AND status = 'ok'", id);
  if (op === 'req') {
    if (await has(me.id, other, 'ok')) return { error: 'もうフレンドです' };
    if (await env.DB.prepare('SELECT 1 FROM fblock WHERE a = ? AND b = ?').bind(me.id, other).first()) return { error: 'ブロックしている相手です。ブロックを外してから申請してください' };
    if (await env.DB.prepare('SELECT 1 FROM fblock WHERE a = ? AND b = ?').bind(other, me.id).first()) return { ok: true, sent: true };   // 相手にブロックされている：知らせずに「送った」ことにする
    if (await nFriends(me.id) >= FRIEND_MAX) return { error: 'フレンドが' + FRIEND_MAX + '人いっぱいです' };
    if (await has(other, me.id, 'req')) {                // 相手からも申請が来ていた → そのままフレンド
      if (await nFriends(other) >= FRIEND_MAX) return { error: '相手のフレンドがいっぱいです' };
      await link(); return { ok: true, linked: true };
    }
    if (await has(me.id, other, 'req')) return { error: 'もう申請しています' };
    if (await cnt(env, "SELECT COUNT(*) AS n FROM friends WHERE a = ? AND status = 'req'", me.id) >= FREQ_MAX) return { error: '出している申請が' + FREQ_MAX + '件あります。返事を待つか、取り消してください' };
    await env.DB.prepare("INSERT INTO friends (a, b, status, created_at) VALUES (?, ?, 'req', ?)").bind(me.id, other, t).run();
    return { ok: true, sent: true };
  }
  if (op === 'accept') {
    if (!(await has(other, me.id, 'req'))) return { error: '申請が見つかりませんでした（取り消されたかもしれません）' };
    if (await nFriends(me.id) >= FRIEND_MAX) return { error: 'フレンドが' + FRIEND_MAX + '人いっぱいです' };
    if (await nFriends(other) >= FRIEND_MAX) return { error: '相手のフレンドがいっぱいです' };
    await link(); return { ok: true };
  }
  if (op === 'decline') { await env.DB.prepare("DELETE FROM friends WHERE a = ? AND b = ? AND status = 'req'").bind(other, me.id).run(); return { ok: true }; }
  if (op === 'cancel') { await env.DB.prepare("DELETE FROM friends WHERE a = ? AND b = ? AND status = 'req'").bind(me.id, other).run(); return { ok: true }; }
  if (op === 'remove') { await unlink(); return { ok: true }; }
  if (op === 'block') {
    await unlink();
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO fblock (a, b, created_at) VALUES (?, ?, ?)').bind(me.id, other, t),
      env.DB.prepare('DELETE FROM fmsg WHERE from_id = ? AND to_id = ?').bind(other, me.id)]);
    return { ok: true };
  }
  if (op === 'unblock') { await env.DB.prepare('DELETE FROM fblock WHERE a = ? AND b = ?').bind(me.id, other).run(); return { ok: true }; }
  if (op === 'msg') {
    const m = Math.floor(+b.m);
    if (!(m >= 0 && m < FMSG_N)) return { error: 'ひとことを選んでください' };
    if (!(await has(me.id, other, 'ok'))) return { error: 'フレンドにだけ送れます' };
    const last = await env.DB.prepare('SELECT created_at FROM fmsg WHERE from_id = ? AND to_id = ? ORDER BY id DESC LIMIT 1').bind(me.id, other).first();
    if (last && t - last.created_at < FMSG_GAP) return { error: '少し待ってから送ってください' };
    await env.DB.prepare('INSERT INTO fmsg (from_id, to_id, m, created_at) VALUES (?, ?, ?, ?)').bind(me.id, other, m, t).run();
    // 古いものは消す（1人に届くのは新しい50件まで）
    await env.DB.prepare('DELETE FROM fmsg WHERE to_id = ? AND id NOT IN (SELECT id FROM fmsg WHERE to_id = ? ORDER BY id DESC LIMIT ?)').bind(other, other, FMSG_KEEP).run();
    return { ok: true };
  }
  return { error: 'not found' };
}

// アカウントを消すとき
export const friendForget = (env, id) => [
  env.DB.prepare('DELETE FROM fcode WHERE account_id = ?').bind(id),
  env.DB.prepare('DELETE FROM friends WHERE a = ? OR b = ?').bind(id, id),
  env.DB.prepare('DELETE FROM fblock WHERE a = ? OR b = ?').bind(id, id),
  env.DB.prepare('DELETE FROM fmsg WHERE from_id = ? OR to_id = ?').bind(id, id),
];
