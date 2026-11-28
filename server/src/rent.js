// 酒場のキャラ貸し借り（2026-11-28 本人）
//   「酒場では、キャラの貸し借りができるようにすると面白いかもしれない。強さによって必要な街コインが必要。貸し出ししてても自分でも使える。
//    貸し出して使ってもらえたら、使ってもらった回数に応じて、経験値ポッドを取得可能。借りたものはチームに編成可能。成長はしない。貸し出し登録したら時のステータスが有効」
//   ・貸す：自分のキャラを登録（登録したときのLV・★・進化・ステータスで固定）。枠は3つまで（ゲーム側で酒場のLvまで）
//   ・借りる：ほかの人の登録から（2026-11-28 本人「借りるキャラは一覧で出そう」：ランダム30件 → 強い順に最大300件の一覧）。同じ人の同じ枠は1日1回、1日10回まで。街コインはゲーム側で払う
//   ・使ってもらった回数ぶん、貸した人が経験値ポットを受け取れる
export const RENT_SLOTS = 3, RENT_DAY_MAX = 10;
export const RENT_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS rent ( owner TEXT NOT NULL, slot INTEGER NOT NULL, cid TEXT NOT NULL, lv INTEGER NOT NULL, star INTEGER NOT NULL DEFAULT 0, evo INTEGER NOT NULL DEFAULT 0, st TEXT NOT NULL, pow INTEGER NOT NULL, rid TEXT NOT NULL DEFAULT '', uses INTEGER NOT NULL DEFAULT 0, unpaid INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, PRIMARY KEY (owner, slot) )",
  "CREATE INDEX IF NOT EXISTS idx_rent_rid ON rent(rid)",
  "CREATE TABLE IF NOT EXISTS rent_use ( day TEXT NOT NULL, borrower TEXT NOT NULL, owner TEXT NOT NULL, slot INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (day, borrower, owner, slot) )",
];
const powOf = st => Math.round(st[0] * 3 + st[1] * 4 + st[2] * 3 + st[3] * 2);   // ゲームの statPow と同じ
const dayOf = t => new Date((t + 9 * 3600) * 1000).toISOString().slice(0, 10);      // 日本時間の日付
// 相手のアカウントIDは見せない：登録ごとの番号（rid）で借りる
const newRid = () => [...crypto.getRandomValues(new Uint8Array(9))].map(v => v.toString(16).padStart(2, '0')).join('');
const row = r => ({ rid: r.rid, slot: r.slot, cid: r.cid, lv: r.lv, star: r.star, evo: r.evo, st: JSON.parse(r.st), pow: r.pow, name: r.name || '', uses: r.uses, at: r.created_at });

export async function rentHome(env, me, now) {
  const mine = (await env.DB.prepare('SELECT * FROM rent WHERE owner = ? ORDER BY slot').bind(me.id).all()).results || [];
  const list = (await env.DB.prepare('SELECT r.*, a.name FROM rent r JOIN accounts a ON a.id = r.owner WHERE r.owner != ? AND a.banned = 0 ORDER BY r.pow DESC LIMIT 300').bind(me.id).all()).results || [];
  const used = (await env.DB.prepare('SELECT r.rid FROM rent_use u JOIN rent r ON r.owner = u.owner AND r.slot = u.slot WHERE u.day = ? AND u.borrower = ?').bind(dayOf(now), me.id).all()).results || [];
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM rent_use WHERE day = ? AND borrower = ?').bind(dayOf(now), me.id).first()) || { n: 0 };
  return { mine: mine.map(r => Object.assign(row(r), { unpaid: r.unpaid })), list: list.map(row), used: used.map(u => u.rid), today: n.n, dayMax: RENT_DAY_MAX };
}

export async function rentAct(env, me, act, b, now) {
  const slot = Math.floor(Number(b.slot));
  if (act === 'put') {
    if (!(slot >= 0 && slot < RENT_SLOTS)) return { error: '枠がちがいます' };
    const cid = String(b.cid || '').slice(0, 40), lv = Math.floor(Number(b.lv)), star = Math.floor(Number(b.star) || 0), evo = Math.floor(Number(b.evo) || 0);
    const st = Array.isArray(b.st) ? b.st.slice(0, 4).map(v => Math.floor(Number(v))) : [];
    if (!/^[\w-]+$/.test(cid) || !(lv >= 1 && lv <= 200) || !(star >= 0 && star <= 20) || !(evo >= 0 && evo <= 2) || st.length !== 4 || st.some(v => !(v >= 0 && v <= 200000))) return { error: 'キャラの情報がおかしいです' };
    const old = await env.DB.prepare('SELECT cid, unpaid FROM rent WHERE owner = ? AND slot = ?').bind(me.id, slot).first();
    await env.DB.prepare('INSERT INTO rent (owner, slot, cid, lv, star, evo, st, pow, rid, uses, unpaid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?) ON CONFLICT(owner, slot) DO UPDATE SET cid = excluded.cid, lv = excluded.lv, star = excluded.star, evo = excluded.evo, st = excluded.st, pow = excluded.pow, rid = excluded.rid, uses = 0, created_at = excluded.created_at')
      .bind(me.id, slot, cid, lv, star, evo, JSON.stringify(st), powOf(st), newRid(), old ? old.unpaid : 0, now).run();
    return { ok: true };
  }
  if (act === 'del') { const r = await env.DB.prepare('SELECT unpaid FROM rent WHERE owner = ? AND slot = ?').bind(me.id, slot).first();
    if (r && r.unpaid > 0) return { error: '先に経験値ポットを受け取ってください' };
    await env.DB.prepare('DELETE FROM rent WHERE owner = ? AND slot = ?').bind(me.id, slot).run(); return { ok: true }; }
  if (act === 'use') {
    const r = await env.DB.prepare('SELECT * FROM rent WHERE rid = ?').bind(String(b.rid || '')).first();
    if (!r) return { error: 'もう貸し出されていません（入れかわったかも）' };
    const owner = r.owner, slot = r.slot;
    if (owner === me.id) return { error: '自分のキャラは借りられません' };
    const day = dayOf(now), n = await env.DB.prepare('SELECT COUNT(*) AS n FROM rent_use WHERE day = ? AND borrower = ?').bind(day, me.id).first();
    if (n && n.n >= RENT_DAY_MAX) return { error: '今日はもう' + RENT_DAY_MAX + '回借りました' };
    try { await env.DB.prepare('INSERT INTO rent_use (day, borrower, owner, slot, created_at) VALUES (?, ?, ?, ?, ?)').bind(day, me.id, owner, slot, now).run(); }
    catch (_) { return { error: 'このキャラは今日もう借りました' }; }
    await env.DB.prepare('UPDATE rent SET uses = uses + 1, unpaid = unpaid + 1 WHERE owner = ? AND slot = ?').bind(owner, slot).run();
    const a = await env.DB.prepare('SELECT name FROM accounts WHERE id = ?').bind(owner).first();
    return { ok: true, unit: Object.assign(row(r), { name: (a && a.name) || '' }) };
  }
  if (act === 'claim') {
    const r = await env.DB.prepare('SELECT COALESCE(SUM(unpaid), 0) AS n FROM rent WHERE owner = ?').bind(me.id).first();
    const n = (r && r.n) || 0; if (n > 0) await env.DB.prepare('UPDATE rent SET unpaid = 0 WHERE owner = ?').bind(me.id).run();
    return { ok: true, n };
  }
  return { error: 'ない操作です' };
}
