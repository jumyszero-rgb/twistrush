// ===== オートバトル（オフライン対戦）=====
// ほかの人の「防衛チーム」と自動で戦う。戦闘はサーバーで計算し、記録（ログ）を返す。ゲーム側はそれを見せるだけ
// 1日3回まで。報酬は交換専用の「アリーナコイン」（賭けには使えない）
import { medalGive, medalOf } from './vs.js';
// 報酬は対戦メダル（オンライン対戦と同じ交換所で使う）。upset＝戦闘力が上の相手に勝ったときの上乗せ
export const ARENA = { tries: 3, win: 20, lose: 5, upset: 10 };
const TZ = 9 * 3600;
const dayKey = t => { const d = new Date((t + TZ) * 1000); return d.toISOString().slice(0, 10); };
const clampN = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));
const TYPES = ['hp', 'atk', 'def', 'spd'];
// タイプの相性（強い相手に1.12倍、弱い相手に0.9倍）：攻撃→体力→防御→スピード→攻撃
const BEATS = { atk: 'hp', hp: 'def', def: 'spd', spd: 'atk' };

// 端末から届いたチームを、使える形に整える（数字の上限つき）
export function cleanTeam(t) {
  if (!Array.isArray(t)) return null;
  const out = t.slice(0, 4).map(u => {
    const sk = s => s ? { nm: String(s.nm || '').slice(0, 24), dmg: clampN(s.dmg, 0, 80), heal: clampN(s.heal, 0, 120), buf: clampN(s.buf, 0, 60), deb: clampN(s.deb, 0, 60), crit: clampN(s.crit, 0, 60) } : null;
    return { id: String(u.id || '').slice(0, 16), g: String(u.g || 'N').slice(0, 2), ty: TYPES.includes(u.ty) ? u.ty : 'hp', lv: clampN(u.lv, 1, 150), st: (Array.isArray(u.st) ? u.st : [10, 10, 10, 10]).slice(0, 4).map(v => clampN(v, 1, 3000)), sp: sk(u.sp), og: sk(u.og) };
  });
  return out.length ? out : null;
}
// 戦闘力：ステータスと技の強さから出す目安（マッチングに使う）
export function powerOf(team) {
  let p = 0;
  for (const u of team) {
    const [h, a, d, s] = u.st;
    p += h * 3 + a * 4 + d * 3 + s * 2;
    for (const k of [u.sp, u.og]) if (k) p += (k.dmg * 6 + k.heal * 3 + k.buf * 4 + k.deb * 4 + k.crit * 5) * (1 + u.lv / 60);
  }
  return Math.round(p);
}
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- 自動戦闘 ----------
// 行動ゲージ制：スピードの分だけゲージがたまり、100で行動。通常攻撃でチャージがたまり、必殺技（3回）・奥義（6回、リーダーだけ）を撃つ
// バランスが効くように：回復・防御・スロウ・攻撃アップ、タイプの相性、チームのバランス（タイプが散っているほど少し強い）
export function simulate(teamA, teamB, seed) {
  const R = rng(seed), log = [];
  const mk = (team, side) => {
    const kinds = new Set(team.map(u => u.ty)).size, bal = 1 + (kinds - 1) * 0.04;      // 4タイプそろうと+12%
    return team.map((u, i) => ({ side, i, ty: u.ty, lead: i === 0, mhp: Math.round(u.st[0] * 12 * bal), hp: Math.round(u.st[0] * 12 * bal),
      atk: u.st[1] * bal, def: u.st[2] * bal, spd: Math.max(5, u.st[3]), g: R() * 60, ch: 0, sp: u.sp, og: u.og, ab: 1, db: 1, slowT: 0, dead: false }));
  };
  const A = mk(teamA, 0), B = mk(teamB, 1), all = A.concat(B);
  const foes = u => (u.side ? A : B).filter(x => !x.dead), pals = u => (u.side ? B : A).filter(x => !x.dead);
  const typeMul = (a, d) => BEATS[a.ty] === d.ty ? 1.12 : BEATS[d.ty] === a.ty ? 0.9 : 1;
  const hit = (a, d, mult, tag) => {
    const base = a.atk * a.ab * (a.atk * a.ab / (a.atk * a.ab + d.def * d.db)) * 3.0;
    const dmg = Math.max(1, Math.round(base * mult * typeMul(a, d) * (0.9 + R() * 0.2)));
    d.hp = Math.max(0, d.hp - dmg);
    const ev = [d.side, d.i, -dmg]; if (d.hp <= 0 && !d.dead) { d.dead = true; ev.push('ko'); }
    return ev;
  };
  const target = (u) => { const f = foes(u); if (!f.length) return null;
    // 相性のいい相手と、体力の少ない相手をねらいやすい
    return f.map(x => [x, (BEATS[u.ty] === x.ty ? 1.4 : 1) * (1.6 - x.hp / x.mhp) * (0.7 + R() * 0.6)]).sort((p, q) => q[1] - p[1])[0][0]; };
  const useSkill = (u, s, kind) => {
    const ev = { t: kind, s: [u.side, u.i], nm: s.nm, to: [] };
    const f = foes(u), pl = pals(u);
    if (s.dmg > 0 && f.length) {                         // 攻撃：相手全体に（強い技ほど大きい）
      const m = (kind === 'og' ? 0.9 : 0.55) * (0.6 + s.dmg / 20) / Math.sqrt(f.length);
      f.forEach(d => ev.to.push(hit(u, d, m)));
    }
    if (s.crit > 0 && foes(u).length) {                  // クリティカル：いちばん体力の多い相手に、最大HPの％
      const d = foes(u).sort((p, q) => q.hp - p.hp)[0], dmg = Math.round(d.mhp * s.crit / 100 * 0.35);
      d.hp = Math.max(0, d.hp - dmg); const e = [d.side, d.i, -dmg, 'crit']; if (d.hp <= 0 && !d.dead) { d.dead = true; e.push('ko'); } ev.to.push(e);
    }
    if (s.heal > 0) pl.forEach(x => { const h = Math.round(x.mhp * Math.min(0.45, s.heal / 100 * 0.6)); const was = x.hp; x.hp = Math.min(x.mhp, x.hp + h); if (x.hp > was) ev.to.push([x.side, x.i, x.hp - was]); });
    if (s.buf > 0) { const k = 1 + Math.min(0.5, s.buf / 60); pals(u).forEach(x => { x.ab = Math.max(x.ab, k); x.db = Math.max(x.db, k); x.bufT = 4; }); ev.buf = Math.round((k - 1) * 100); }
    if (s.deb > 0) { const k = Math.min(50, s.deb * 1.4); foes(u).forEach(x => { x.g -= k; x.slowT = 3; }); ev.deb = k; }
    return ev;
  };
  let turns = 0;
  while (turns < 400 && foes(A[0]).length && foes(B[0]).length) {
    // いちばん早くゲージが100になる人が動く
    let next = null, need = Infinity;
    for (const u of all) if (!u.dead) { const n = (100 - u.g) / u.spd; if (n < need) { need = n; next = u; } }
    for (const u of all) if (!u.dead) u.g += u.spd * Math.max(0, need);
    const u = next; u.g = 0; turns++;
    if (u.bufT && --u.bufT <= 0) { u.ab = 1; u.db = 1; }
    u.ch++;
    let ev;
    if (u.lead && u.og && u.ch >= 6) { ev = useSkill(u, u.og, 'og'); u.ch = 0; }
    else if (u.sp && u.ch % 3 === 0) ev = useSkill(u, u.sp, 'sp');
    else { const d = target(u); if (!d) break; ev = { t: 'at', s: [u.side, u.i], to: [hit(u, d, 1)] }; }
    log.push(ev);
  }
  const left = side => (side ? B : A).reduce((s, x) => s + x.hp / x.mhp, 0);
  const aliveA = A.some(x => !x.dead), aliveB = B.some(x => !x.dead);
  const win = aliveA && !aliveB ? 0 : aliveB && !aliveA ? 1 : (left(0) >= left(1) ? 0 : 1);
  return { win, log, hp: [A.map(x => x.mhp), B.map(x => x.mhp)], left: [left(0), left(1)].map(v => Math.round(v * 100) / 100) };
}

// ---------- データベース ----------
export async function arenaOf(env, id, t) {
  let r = await env.DB.prepare('SELECT coins, points, win, lose, day, tries FROM arena WHERE account_id = ?').bind(id).first();
  if (!r) { await env.DB.prepare('INSERT OR IGNORE INTO arena (account_id, coins, points, win, lose, day, tries) VALUES (?, 0, 1000, 0, 0, ?, 0)').bind(id, dayKey(t)).run(); r = { coins: 0, points: 1000, win: 0, lose: 0, day: dayKey(t), tries: 0 }; }
  if (r.coins > 0) {                         // 前のアリーナコインは対戦メダルに移す（1枚＝1枚）
    const m = await env.DB.prepare('UPDATE arena SET coins = 0 WHERE account_id = ? AND coins = ?').bind(id, r.coins).run();
    if (m.meta.changes) await medalGive(env, id, r.coins, 'arena-coin', t);
    r.coins = 0;
  }
  if (r.day !== dayKey(t)) r.tries = 0;
  r.left = Math.max(0, ARENA.tries - r.tries);
  return r;
}
export async function arenaHome(env, me, t) {
  const a = await arenaOf(env, me.id, t);
  const def = await env.DB.prepare('SELECT team, power FROM defense WHERE account_id = ?').bind(me.id).first();
  const pw = def ? def.power : 0;
  // 戦闘力が近い人を3人（少し上・同じくらい・少し下）
  const pick = async (lo, hi) => (await env.DB.prepare('SELECT d.account_id AS id, a.name, a.country AS cc, d.team, d.power FROM defense d JOIN accounts a ON a.id = d.account_id WHERE d.account_id <> ? AND d.power BETWEEN ? AND ? ORDER BY RANDOM() LIMIT 3').bind(me.id, lo, hi).all()).results || [];
  let c = pw ? await pick(Math.round(pw * 0.8), Math.round(pw * 1.25)) : [];
  if (c.length < 3) { const more = (await env.DB.prepare('SELECT d.account_id AS id, a.name, a.country AS cc, d.team, d.power FROM defense d JOIN accounts a ON a.id = d.account_id WHERE d.account_id <> ? ORDER BY ABS(d.power - ?) LIMIT 6').bind(me.id, pw).all()).results || [];
    for (const x of more) if (c.length < 3 && !c.some(y => y.id === x.id)) c.push(x); }
  const logs = (await env.DB.prepare('SELECT attacker_name AS name, attacker_cc AS cc, win, created_at AS at FROM arena_log WHERE defender = ? ORDER BY created_at DESC LIMIT 10').bind(me.id).all()).results || [];
  const md = await medalOf(env, me.id);
  return { medals: md ? md.balance : 0, points: a.points, win: a.win, lose: a.lose, left: a.left, tries: ARENA.tries, power: pw, defense: def ? JSON.parse(def.team) : null,
    cands: c.map(x => ({ id: x.id, name: x.name, cc: x.cc || '', power: x.power, team: JSON.parse(x.team) })), logs, reward: ARENA };
}
export async function arenaSetDefense(env, me, team, t) {
  const tm = cleanTeam(team); if (!tm) return { error: 'チームがありません' };
  const pw = powerOf(tm);
  await env.DB.prepare('INSERT INTO defense (account_id, team, power, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET team = excluded.team, power = excluded.power, updated_at = excluded.updated_at').bind(me.id, JSON.stringify(tm), pw, t).run();
  return { ok: true, power: pw };
}
export async function arenaFight(env, me, b, t) {
  const a = await arenaOf(env, me.id, t);
  if (a.left <= 0) return { error: '今日の挑戦は終わりました（1日' + ARENA.tries + '回）' };
  const tm = cleanTeam(b.team); if (!tm) return { error: 'チームがありません' };
  const op = await env.DB.prepare('SELECT d.team, d.power, a.name, a.country AS cc FROM defense d JOIN accounts a ON a.id = d.account_id WHERE d.account_id = ?').bind(String(b.opp || '')).first();
  if (!op || String(b.opp) === me.id) return { error: 'その相手はいません' };
  const ot = JSON.parse(op.team), myPw = powerOf(tm), seed = Math.floor(Math.random() * 2 ** 31);
  const r = simulate(tm, ot, seed), won = r.win === 0;
  const coin = won ? ARENA.win + (op.power > myPw * 1.05 ? ARENA.upset : 0) : ARENA.lose;
  const dp = won ? 12 : -8;
  const today = dayKey(t);
  await env.DB.batch([
    env.DB.prepare('UPDATE arena SET points = MAX(0, points + ?), win = win + ?, lose = lose + ?, tries = CASE WHEN day = ? THEN tries + 1 ELSE 1 END, day = ? WHERE account_id = ?').bind(dp, won ? 1 : 0, won ? 0 : 1, today, today, me.id),
    env.DB.prepare('INSERT INTO arena_log (defender, attacker, attacker_name, attacker_cc, win, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(String(b.opp), me.id, me.name, me.cc || '', won ? 0 : 1, t),
  ]);
  await medalGive(env, me.id, coin, won ? 'arena-win' : 'arena-lose', t);
  const after = await arenaOf(env, me.id, t), md = await medalOf(env, me.id);
  return { ok: true, win: won, coin, points: after.points, medals: md ? md.balance : 0, left: after.left, myPower: myPw, opp: { name: op.name, cc: op.cc || '', power: op.power, team: ot }, me: tm, battle: r };
}
