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
  // ②対戦のさそい：部屋番号を相手に届ける。status：'wait'＝返事待ち／'no'＝ことわられた（さそった人がまだ見ていない）
  "CREATE TABLE IF NOT EXISTS finv ( id INTEGER PRIMARY KEY AUTOINCREMENT, from_id TEXT NOT NULL, to_id TEXT NOT NULL, room TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_finv_to ON finv(to_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_finv_from ON finv(from_id, status)",
];
export const FINV_SEC = 180;                         // さそいの有効時間（秒）。さそわれた人は、画面に出てから60秒のあいだに返事（2026-11-24 本人）
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
  if (op === 'invite') {                                // ②対戦にさそう（部屋はさそう人が先に作っておく）
    const room = String(b.room || '').replace(/\D/g, ''), kind = b.kind === 'chara' ? 'chara' : 'simple';
    if (room.length !== 4) return { error: '部屋が作れませんでした' };
    if (!(await has(me.id, other, 'ok'))) return { error: 'フレンドにだけさそえます' };
    await env.DB.batch([
      env.DB.prepare('DELETE FROM finv WHERE from_id = ? OR created_at < ?').bind(me.id, t - 3600),
      env.DB.prepare("INSERT INTO finv (from_id, to_id, room, kind, status, created_at) VALUES (?, ?, ?, ?, 'wait', ?)").bind(me.id, other, room, kind, t)]);
    return { ok: true, sec: FINV_SEC };
  }
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
  env.DB.prepare('DELETE FROM finv WHERE from_id = ? OR to_id = ?').bind(id, id),
];

// ゲームを開いているあいだ、15秒ごとに見に来る（さそい・ことわられた知らせ・赤い丸の数）
export async function friendPoll(env, me, t) {
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then(r => r.results || []);
  const inv = await q("SELECT i.id AS id, i.room AS room, i.kind AS kind, i.created_at AS t, a.name AS name, c.code AS code FROM finv i JOIN accounts a ON a.id = i.from_id JOIN fcode c ON c.account_id = i.from_id WHERE i.to_id = ? AND i.status = 'wait' AND i.created_at >= ? ORDER BY i.id DESC LIMIT 3", me.id, t - FINV_SEC);
  const no = await q("SELECT i.id AS id, i.room AS room, a.name AS name FROM finv i JOIN accounts a ON a.id = i.to_id WHERE i.from_id = ? AND i.status = 'no'", me.id);
  if (no.length) await env.DB.prepare("DELETE FROM finv WHERE from_id = ? AND status = 'no'").bind(me.id).run();
  const req = await env.DB.prepare("SELECT COUNT(*) AS n FROM friends WHERE b = ? AND status = 'req'").bind(me.id).first();
  const last = await env.DB.prepare('SELECT MAX(id) AS id FROM fmsg WHERE to_id = ?').bind(me.id).first();
  return { inv, no, req: (req && req.n) || 0, lastMsg: (last && last.id) || 0, sec: FINV_SEC };
}
// さそいへの返事：ok＝受ける（部屋番号で入るのはゲームの側）／ことわる
export async function friendAnswer(env, me, b) {
  const id = Math.floor(+b.id);
  if (b.ok) await env.DB.prepare('DELETE FROM finv WHERE id = ? AND to_id = ?').bind(id, me.id).run();
  else await env.DB.prepare("UPDATE finv SET status = 'no' WHERE id = ? AND to_id = ? AND status = 'wait'").bind(id, me.id).run();
  return { ok: true };
}
// さそった人が部屋をやめたとき
export const friendInviteCancel = (env, me) => env.DB.prepare('DELETE FROM finv WHERE from_id = ?').bind(me.id).run();
