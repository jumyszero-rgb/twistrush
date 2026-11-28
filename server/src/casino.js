// カジノ：全員で見た戻りの調整（2026-11-28 本人「ギャンブルってさ負ける人いれば勝てる人もいると思うんだよね。なのでそのアカウントというより全体で見て考えたら？」
//   → 「全体の戻りで95%に調整」を選んだ）
//   ・ゲームはスロットを回すたびに、かけた額と戻った額を送る（日ごとに合計）
//   ・直近3日の全員の合計で「戻り」を出し、95%より低ければ当たりやすく、高ければ当たりにくくする「運（luck）」を返す（0.85〜1.15）
//   ・かけ金の合計が少ないうち（10万シルバー未満）は 1（ふつう）
export const CASINO_RTP = 0.95;
export const CASINO_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS casino_day ( day TEXT PRIMARY KEY, bet INTEGER NOT NULL DEFAULT 0, pay INTEGER NOT NULL DEFAULT 0, n INTEGER NOT NULL DEFAULT 0 )",
  // 今日のハイスコア（2026-11-28 本人「今日のハイスコア的なものを載せておけばもどりも良くなる」）：1人1日1種類で一番いいものだけ
  "CREATE TABLE IF NOT EXISTS casino_top ( day TEXT NOT NULL, kind TEXT NOT NULL, account_id TEXT NOT NULL, val INTEGER NOT NULL, info TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY (day, kind, account_id) )",
];
const TOP_MAX = { slot: 5000 * 200, hl: 5000 * 3000 };
export async function casinoTop(env, now) {
  const day = dayOf(now), out = {};
  for (const k of Object.keys(TOP_MAX)) out[k] = ((await env.DB.prepare('SELECT t.val, t.info, a.name FROM casino_top t JOIN accounts a ON a.id = t.account_id WHERE t.day = ? AND t.kind = ? AND a.banned = 0 ORDER BY t.val DESC LIMIT 5').bind(day, k).all()).results || []).map(r => ({ v: r.val, i: r.info, name: r.name || '？' }));
  return out;
}
export async function casinoTopPost(env, me, b, now) {
  const k = String(b.kind || ''), v = Math.floor(Number(b.val)), info = String(b.info || '').slice(0, 30);
  if (!TOP_MAX[k] || !(v >= 1 && v <= TOP_MAX[k])) return { error: '数字がおかしいです' };
  await env.DB.prepare('INSERT INTO casino_top (day, kind, account_id, val, info, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(day, kind, account_id) DO UPDATE SET val = excluded.val, info = excluded.info, created_at = excluded.created_at WHERE excluded.val > casino_top.val').bind(dayOf(now), k, me.id, v, info, now).run();
  return { ok: true, top: await casinoTop(env, now) };
}
const dayOf = t => new Date((t + 9 * 3600) * 1000).toISOString().slice(0, 10);
export async function casinoLuck(env, now) {
  const from = dayOf(now - 2 * 86400);
  const r = await env.DB.prepare('SELECT COALESCE(SUM(bet), 0) AS bet, COALESCE(SUM(pay), 0) AS pay, COALESCE(SUM(n), 0) AS n FROM casino_day WHERE day >= ?').bind(from).first();
  const bet = (r && r.bet) || 0, pay = (r && r.pay) || 0, rtp = bet ? pay / bet : CASINO_RTP;
  const luck = bet < 100000 ? 1 : Math.max(0.85, Math.min(1.15, 1 + (CASINO_RTP - rtp) * 3));
  return { luck: Math.round(luck * 1000) / 1000, rtp: Math.round(rtp * 1000) / 1000, n: (r && r.n) || 0, top: await casinoTop(env, now) };
}
export async function casinoLog(env, me, b, now) {
  const n = Math.floor(Number(b.n) || 1), bet = Math.floor(Number(b.bet)), pay = Math.floor(Number(b.pay));
  if (!(n >= 1 && n <= 50) || !(bet >= 1 && bet <= 5000 * n) || !(pay >= 0 && pay <= bet * 200)) return { error: '数字がおかしいです' };
  await env.DB.prepare('INSERT INTO casino_day (day, bet, pay, n) VALUES (?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET bet = bet + excluded.bet, pay = pay + excluded.pay, n = n + excluded.n').bind(dayOf(now), bet, pay, n).run();
  return Object.assign({ ok: true }, await casinoLuck(env, now));
}
