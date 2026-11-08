// ===== オンライン対戦（2人）・対戦メダル・対戦レート =====
// 部屋は Durable Object（Room）。マッチングと部屋番号は Lobby（1つだけ）が持つ
// 対戦メダル：お金では買えない、対戦専用のコイン。毎日もらえて、賭けに使い、ショップでアイテムと交換する

export const MEDAL = {
  first: 300,                 // はじめての人
  daily: 100,                 // 毎日（日本時間で日が変わったら）
  bets: [0, 10, 50, 100],     // 賭けられる額（0＝賭けない）
};
// メダルで交換できるもの（ゲームの更新なしで変えられる）
export const MEDAL_SHOP = [
  { k: 'refresh30', price: 40 },
  { k: 'refresh50', price: 70 },
  { k: 'refresh80', price: 110 },
  { k: 'refresh100', price: 140 },
  { k: 'slow', price: 90 },
  { k: 'star3', price: 90 },
  { k: 'star6', price: 180 },
  { k: 'charm', price: 200 },
  { k: 'pot_N', price: 300 },
  { k: 'pot_R', price: 900 },
];
export const VS_KINDS = ['simple', 'chara'];
export const VS_LIMIT_SEC = 180;           // 3分たったら、カラーHPのいちばん高い色が低い方の勝ち
const RATE_START = 1000, RATE_K = 32;
const TZ = 9 * 3600;
const dayKey = t => { const d = new Date((t + TZ) * 1000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); };

export async function medalOf(env, id) {
  const r = await env.DB.prepare('SELECT balance, daily FROM medals WHERE account_id = ?').bind(id).first();
  return r || null;
}
// 毎日のメダル（はじめての人は多め）。もらった数を返す
export async function medalDaily(env, id, t) {
  const today = dayKey(t), cur = await medalOf(env, id);
  if (!cur) {
    await env.DB.prepare('INSERT OR IGNORE INTO medals (account_id, balance, daily) VALUES (?, ?, ?)').bind(id, MEDAL.first, today).run();
    await medalLog(env, id, MEDAL.first, 'first', t);
    return MEDAL.first;
  }
  if (cur.daily === today) return 0;
  const r = await env.DB.prepare('UPDATE medals SET balance = balance + ?, daily = ? WHERE account_id = ? AND daily <> ?').bind(MEDAL.daily, today, id, today).run();
  if (!r.meta.changes) return 0;
  await medalLog(env, id, MEDAL.daily, 'daily', t);
  return MEDAL.daily;
}
export const medalLog = (env, id, delta, reason, t) => env.DB.prepare('INSERT INTO medal_log (account_id, delta, reason, created_at) VALUES (?, ?, ?, ?)').bind(id, delta, reason, t).run();
// 減らす（足りなければ false）
export async function medalTake(env, id, n, reason, t) {
  if (!n) return true;
  const r = await env.DB.prepare('UPDATE medals SET balance = balance - ? WHERE account_id = ? AND balance >= ?').bind(n, id, n).run();
  if (!r.meta.changes) return false;
  await medalLog(env, id, -n, reason, t);
  return true;
}
export async function medalGive(env, id, n, reason, t) {
  if (!n) return;
  await env.DB.prepare('INSERT INTO medals (account_id, balance, daily) VALUES (?, ?, \'\') ON CONFLICT(account_id) DO UPDATE SET balance = balance + excluded.balance').bind(id, n).run();
  await medalLog(env, id, n, reason, t);
}
export async function rateOf(env, id, kind) {
  const r = await env.DB.prepare('SELECT rate, win, lose, draw FROM ratings WHERE account_id = ? AND kind = ?').bind(id, kind).first();
  return r || { rate: RATE_START, win: 0, lose: 0, draw: 0 };
}
async function rateSave(env, id, kind, rate, res, t) {
  const w = res === 'win' ? 1 : 0, l = res === 'lose' ? 1 : 0, d = res === 'draw' ? 1 : 0;
  await env.DB.prepare('INSERT INTO ratings (account_id, kind, rate, win, lose, draw, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, kind) DO UPDATE SET rate = excluded.rate, win = win + excluded.win, lose = lose + excluded.lose, draw = draw + excluded.draw, updated_at = excluded.updated_at')
    .bind(id, kind, rate, w, l, d, t).run();
}
export async function vsTop(env, kind, me) {
  const { results } = await env.DB.prepare('SELECT r.account_id AS id, a.name, r.rate, r.win, r.lose FROM ratings r JOIN accounts a ON a.id = r.account_id WHERE r.kind = ? ORDER BY r.rate DESC, r.updated_at ASC LIMIT 50').bind(kind).all();
  const top = (results || []).map((x, i) => ({ rank: i + 1, name: x.name, rate: x.rate, win: x.win, lose: x.lose, me: !!(me && x.id === me) }));
  let mine = null;
  if (me) {
    const r = await rateOf(env, me, kind);
    const above = await env.DB.prepare('SELECT COUNT(*) AS c FROM ratings WHERE kind = ? AND rate > ?').bind(kind, r.rate).first();
    mine = Object.assign({ rank: r.win + r.lose + r.draw ? (above.c || 0) + 1 : null }, r);
  }
  return { kind, top, me: mine };
}

// ---------- ロビー：ランダム対戦の待ち合わせと、部屋番号 ----------
export class Lobby {
  constructor(state, env) { this.state = state; this.env = env; this.wait = {}; this.codes = {}; }
  async fetch(req) {
    const b = await req.json(), t = Math.floor(Date.now() / 1000);
    for (const k in this.codes) if (this.codes[k].exp < t) delete this.codes[k];
    for (const k in this.wait) if (this.wait[k].exp < t) delete this.wait[k];
    const res = o => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
    if (b.op === 'quick') {                     // 同じ種類・同じ賭け額で待っている人がいればそこへ。いなければ自分が待つ
      const key = b.kind + ':' + b.bet, w = this.wait[key];
      if (w && w.player !== b.player) { delete this.wait[key]; return res({ room: w.room, host: false }); }
      const room = 'q' + crypto.randomUUID();
      this.wait[key] = { room, player: b.player, exp: t + 90 };
      return res({ room, host: true });
    }
    if (b.op === 'cancel') {
      for (const k in this.wait) if (this.wait[k].room === b.room) delete this.wait[k];
      for (const k in this.codes) if (this.codes[k].room === b.room) delete this.codes[k];
      return res({ ok: true });
    }
    if (b.op === 'create') {                    // 部屋番号（4けた）を作る。10分で消える
      let code = '';
      for (let i = 0; i < 50 && (!code || this.codes[code]); i++) code = String(1000 + Math.floor(Math.random() * 9000));
      if (this.codes[code]) return res({ error: '部屋がいっぱいです。少し待ってください' });
      const room = 'c' + crypto.randomUUID();
      this.codes[code] = { room, kind: b.kind, bet: b.bet, player: b.player, exp: t + 600 };
      return res({ code, room });
    }
    if (b.op === 'join') {
      const c = this.codes[b.code];
      if (!c) return res({ error: 'その番号の部屋はありません' });
      if (c.player === b.player) return res({ error: '自分の部屋には入れません' });
      delete this.codes[b.code];
      return res({ room: c.room, kind: c.kind, bet: c.bet });
    }
    return res({ error: 'op' });
  }
}

// ---------- 部屋：2人をつないで、攻撃を中継し、勝ち負けを決める ----------
export class Room {
  constructor(state, env) { this.state = state; this.env = env; this.ps = []; this.phase = 'wait'; this.cfg = null; this.timer = null; }
  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 400 });
    const u = new URL(req.url), me = JSON.parse(u.searchParams.get('_me') || 'null');
    if (!me) return new Response('no player', { status: 401 });
    const pair = new WebSocketPair(), ws = pair[1];
    ws.accept();
    const send = (w, o) => { try { w.send(JSON.stringify(o)); } catch (e) {} };
    if (this.phase !== 'wait' || this.ps.length >= 2 || this.ps.some(p => p.id === me.id)) {
      send(ws, { t: 'err', m: this.ps.some(p => p.id === me.id) ? '同じアカウントどうしでは対戦できません' : 'この部屋は始まっています' }); ws.close(1000, 'full');
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (!this.cfg) this.cfg = { kind: VS_KINDS.includes(me.kind) ? me.kind : 'simple', bet: MEDAL.bets.includes(me.bet) ? me.bet : 0, room: me.room };
    const p = { id: me.id, name: me.name, ws, team: me.team || null, st: [0, 0, 0, 0, 0], sc: 0, alive: true };
    this.ps.push(p);
    ws.addEventListener('message', ev => this.onMsg(p, ev.data));
    ws.addEventListener('close', () => this.onClose(p));
    ws.addEventListener('error', () => this.onClose(p));
    if (this.ps.length === 1) send(ws, { t: 'wait', kind: this.cfg.kind, bet: this.cfg.bet });
    else await this.begin();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  send(p, o) { try { p.ws.send(JSON.stringify(o)); } catch (e) {} }
  async begin() {
    const env = this.env, t = Math.floor(Date.now() / 1000), [a, b] = this.ps, bet = this.cfg.bet;
    // 賭け：始める前に2人から預かる。足りなければ始めない
    if (bet) {
      const okA = await medalTake(env, a.id, bet, 'bet', t);
      const okB = okA && await medalTake(env, b.id, bet, 'bet', t);
      if (!okA || !okB) {
        if (okA) await medalGive(env, a.id, bet, 'bet:back', t);
        const who = !okA ? a : b;
        this.ps.forEach(x => { this.send(x, { t: 'err', m: x === who ? '対戦メダルが足りません' : '相手の対戦メダルが足りませんでした' }); try { x.ws.close(1000, 'bet'); } catch (e) {} });
        this.phase = 'done'; return;
      }
    }
    this.pot = bet * 2; this.cfg.games = (this.cfg.games || 0) + 1;
    const ra = await rateOf(env, a.id, this.cfg.kind), rb = await rateOf(env, b.id, this.cfg.kind);
    a.rate = ra.rate; b.rate = rb.rate;
    this.phase = 'play'; this.t0 = Date.now() + 3500;
    const seed = Math.floor(Math.random() * 2 ** 31);
    this.ps.forEach((p, i) => { const o = this.ps[1 - i]; this.send(p, { t: 'start', kind: this.cfg.kind, bet, seed, limit: VS_LIMIT_SEC, wait: 3500, me: { rate: p.rate }, opp: { name: o.name, rate: o.rate, team: o.team } }); });
    this.timer = setTimeout(() => this.timeUp(), 3500 + VS_LIMIT_SEC * 1000 + 1500);
  }
  onMsg(p, raw) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const o = this.ps.find(x => x !== p); if (!o) return;
    if (this.phase === 'done' && m.t === 'again') {         // 再戦の申し込み。2人そろったら始める
      p.again = true; this.send(o, { t: 'again' });
      if (o.again) { this.ps.forEach(x => { x.again = false; x.st = [0, 0, 0, 0, 0]; x.sc = 0; }); this.begin(); }
      return;
    }
    if (this.phase !== 'play') return;
    if (m.t === 'st') { if (Array.isArray(m.s)) p.st = m.s.slice(0, 5).map(v => Math.max(0, Math.min(30, +v || 0))); p.sc = Math.max(0, +m.sc || 0); this.send(o, { t: 'st', s: p.st, sc: p.sc, g: String(m.g || '').slice(0, 36) }); }
    else if (m.t === 'atk' && Array.isArray(m.d)) this.send(o, { t: 'atk', d: m.d.slice(0, 5).map(v => Math.max(0, Math.min(30, +v || 0))), n: Math.min(99, +m.n || 0) });
    else if (m.t === 'fx') this.send(o, { t: 'fx', k: String(m.k || '').slice(0, 16), v: +m.v || 0, nm: String(m.nm || '').slice(0, 30) });
    else if (m.t === 'lose') this.finish(o, p, 'out');
  }
  onClose(p) {
    if (p.gone) return; p.gone = true;
    if (this.phase === 'wait') { this.ps = this.ps.filter(x => x !== p); this.lobbyCancel(); return; }
    const o = this.ps.find(x => x !== p);
    if (this.phase === 'play') { if (o) this.finish(o, p, 'left'); }
    else if (o) this.send(o, { t: 'left' });                // 結果画面で相手が帰った（再戦できない）
    this.phase = 'closed';
  }
  lobbyCancel() { try { this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby')).fetch('https://lobby/', { method: 'POST', body: JSON.stringify({ op: 'cancel', room: this.cfg && this.cfg.room }) }); } catch (e) {} }
  timeUp() {
    if (this.phase !== 'play') return;
    const [a, b] = this.ps, ma = Math.max(...a.st), mb = Math.max(...b.st);
    if (ma !== mb) return this.finish(ma < mb ? a : b, ma < mb ? b : a, 'time');
    if (a.sc !== b.sc) return this.finish(a.sc > b.sc ? a : b, a.sc > b.sc ? b : a, 'time');
    this.finish(null, null, 'time');
  }
  async finish(win, lose, why) {
    if (this.phase !== 'play') return;
    this.phase = 'done'; clearTimeout(this.timer);
    const env = this.env, t = Math.floor(Date.now() / 1000), kind = this.cfg.kind, bet = this.cfg.bet;
    const out = {};
    if (win) {
      const ew = 1 / (1 + Math.pow(10, (lose.rate - win.rate) / 400)), d = Math.max(1, Math.round(RATE_K * (1 - ew)));
      out[win.id] = { res: 'win', delta: d, rate: win.rate + d, medal: this.pot };
      out[lose.id] = { res: 'lose', delta: -d, rate: Math.max(0, lose.rate - d), medal: -bet };
      if (this.pot) await medalGive(env, win.id, this.pot, 'win', t);
    } else {
      this.ps.forEach(p => { out[p.id] = { res: 'draw', delta: 0, rate: p.rate, medal: 0 }; });
      for (const p of this.ps) if (bet) await medalGive(env, p.id, bet, 'draw', t);
    }
    for (const p of this.ps) await rateSave(env, p.id, kind, out[p.id].rate, out[p.id].res, t);
    for (const p of this.ps) {
      const m = await medalOf(env, p.id);
      this.send(p, Object.assign({ t: 'end', why, medals: m ? m.balance : 0 }, out[p.id]));
    }
  }
}
