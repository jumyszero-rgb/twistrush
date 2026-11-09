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
  { k: 'gticket', price: 150 },
  { k: 'gticket_hi', price: 2000 },
  { k: 'stampot', price: 200 },          // スタミナポット（スタミナ+50）
];
// ポットはここには並べない（アイテムガチャとゴールドの秘密のショップだけ）
export const VS_KINDS = ['simple', 'chara'];
export const VS_LIMIT_SEC = 180;           // 3分たったら、カラーHPのいちばん高い色が低い方の勝ち
const RATE_START = 1000, RATE_K = 32;
// 月間レートランキングのプレゼント（ランダム対戦だけで決まる。部屋番号の対戦はレートが動かない）
// 前の月に5戦以上した人を、その月の終わりのレートで並べる。キャラ対戦はシンプル対戦の半分くらい
export const VS_MIN_GAMES = 5;
export const VS_REWARDS = {
  simple: [
    { upTo: 1,   label: '1位',       items: { gticket_hi: 3, refresh100: 3, star9: 1, stampot: 5 } },
    { upTo: 3,   label: '2〜3位',    items: { gticket_hi: 2, refresh80: 3, star6: 1, stampot: 4 } },
    { upTo: 10,  label: '4〜10位',   items: { gticket_hi: 1, refresh50: 3, star3: 2, stampot: 3 } },
    { upTo: 50,  label: '11〜50位',  items: { gticket: 3, refresh30: 3, slow: 1, stampot: 2 } },
    { upTo: 100, label: '51〜100位', items: { gticket: 1, refresh30: 2, stampot: 1 } },
    { upTo: 0,   label: '参加賞',    items: { refresh30: 1, stampot: 1 } },
  ],
  chara: [
    { upTo: 1,   label: '1位',       items: { gticket_hi: 2, refresh100: 2, star6: 1, stampot: 3 } },
    { upTo: 3,   label: '2〜3位',    items: { gticket_hi: 1, refresh80: 2, star3: 1, stampot: 2 } },
    { upTo: 10,  label: '4〜10位',   items: { gticket: 3, refresh50: 2, star3: 1, stampot: 2 } },
    { upTo: 50,  label: '11〜50位',  items: { refresh30: 2, stampot: 1 } },
    { upTo: 100, label: '51〜100位', items: { refresh30: 1, stampot: 1 } },
  ],
};
const monthKey = t => { const d = new Date((t + TZ) * 1000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
const prevMonthKey = t => { const d = new Date((t + TZ) * 1000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
async function monthSave(env, id, kind, rate, t) {
  await env.DB.prepare('INSERT INTO ratings_month (account_id, kind, month, rate, games) VALUES (?, ?, ?, ?, 1) ON CONFLICT(account_id, kind, month) DO UPDATE SET rate = excluded.rate, games = games + 1').bind(id, kind, monthKey(t), rate).run();
}
async function monthRank(env, id, kind, month) {
  const r = await env.DB.prepare('SELECT rate, games FROM ratings_month WHERE account_id = ? AND kind = ? AND month = ?').bind(id, kind, month).first();
  if (!r) return null;
  const above = await env.DB.prepare('SELECT COUNT(*) AS c FROM ratings_month WHERE kind = ? AND month = ? AND games >= ? AND rate > ?').bind(kind, month, VS_MIN_GAMES, r.rate).first();
  const total = await env.DB.prepare('SELECT COUNT(*) AS c FROM ratings_month WHERE kind = ? AND month = ? AND games >= ?').bind(kind, month, VS_MIN_GAMES).first();
  return { rate: r.rate, games: r.games, ok: r.games >= VS_MIN_GAMES, rank: r.games >= VS_MIN_GAMES ? (above.c || 0) + 1 : null, total: total.c || 0 };
}
const tierOf = (kind, rank) => VS_REWARDS[kind].find(x => !x.upTo || rank <= x.upTo) || null;
// 先月のプレゼント（まだ受け取っていないもの）
export async function vsRewards(env, id) {
  const t = Math.floor(Date.now() / 1000), month = prevMonthKey(t), out = [];
  for (const kind of VS_KINDS) {
    const m = await monthRank(env, id, kind, month); if (!m || !m.ok) continue;
    const tier = tierOf(kind, m.rank); if (!tier) continue;
    const done = await env.DB.prepare('SELECT 1 FROM reward_claims WHERE account_id = ? AND month = ? AND mode = ?').bind(id, month, 'vs_' + kind).first();
    if (done) continue;
    out.push({ month, kind, rank: m.rank, total: m.total, rate: m.rate, label: tier.label, items: tier.items });
  }
  return out;
}
export async function vsClaim(env, id, kind) {
  const r = (await vsRewards(env, id)).find(x => x.kind === kind); if (!r) return { error: '受け取れるプレゼントがありません' };
  const res = await env.DB.prepare('INSERT OR IGNORE INTO reward_claims (account_id, month, mode, created_at) VALUES (?, ?, ?, ?)').bind(id, r.month, 'vs_' + kind, Math.floor(Date.now() / 1000)).run();
  if (!res.meta.changes) return { error: 'もう受け取りました' };
  return { ok: true, reward: r };
}
export async function vsMonthNow(env, id, kind) { return monthRank(env, id, kind, monthKey(Math.floor(Date.now() / 1000))); }
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
  const { results } = await env.DB.prepare('SELECT r.account_id AS id, a.name, a.country AS cc, r.rate, r.win, r.lose FROM ratings r JOIN accounts a ON a.id = r.account_id WHERE r.kind = ? ORDER BY r.rate DESC, r.updated_at ASC LIMIT 50').bind(kind).all();
  const top = (results || []).map((x, i) => ({ rank: i + 1, name: x.name, cc: x.cc || '', rate: x.rate, win: x.win, lose: x.lose, me: !!(me && x.id === me) }));
  let mine = null;
  if (me) {
    const r = await rateOf(env, me, kind);
    const above = await env.DB.prepare('SELECT COUNT(*) AS c FROM ratings WHERE kind = ? AND rate > ?').bind(kind, r.rate).first();
    mine = Object.assign({ rank: r.win + r.lose + r.draw ? (above.c || 0) + 1 : null }, r);
  }
  return { kind, top, me: mine, prizes: VS_REWARDS[kind], minGames: VS_MIN_GAMES, month: me ? await vsMonthNow(env, me, kind) : null };
}

// ---------- ロビー：ランダム対戦の待ち合わせと、部屋番号 ----------
export class Lobby {
  // 待ち合わせと部屋番号は、保存して持つ（しばらく使われないとメモリから消えるため）
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(req) {
    const b = await req.json(), t = Math.floor(Date.now() / 1000), st = this.state.storage;
    const res = o => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
    const live = async key => { const v = await st.get(key); if (v && v.exp < t) { await st.delete(key); return null; } return v || null; };
    if (b.op === 'quick') {                     // 同じ種類・同じ賭け額で待っている人がいればそこへ。いなければ自分が待つ
      const key = 'w:' + b.kind + ':' + b.bet, w = await live(key);
      if (w && w.player !== b.player) { await st.delete(key); return res({ room: w.room, host: false }); }
      const room = 'q' + crypto.randomUUID();
      await st.put(key, { room, player: b.player, exp: t + 90 });
      return res({ room, host: true });
    }
    if (b.op === 'cancel') {
      const all = await st.list({ limit: 1000 });
      for (const [k, v] of all) if (v && v.room === b.room) await st.delete(k);
      return res({ ok: true });
    }
    if (b.op === 'create') {                    // 部屋番号（4けた）を作る。10分で消える
      let code = '';
      for (let i = 0; i < 50; i++) { const c = String(1000 + Math.floor(Math.random() * 9000)); if (!(await live('c:' + c))) { code = c; break; } }
      if (!code) return res({ error: '部屋がいっぱいです。少し待ってください' });
      const room = 'c' + crypto.randomUUID();
      await st.put('c:' + code, { room, kind: b.kind, bet: b.bet, player: b.player, exp: t + 600 });
      return res({ code, room });
    }
    if (b.op === 'join') {
      const c = await live('c:' + b.code);
      if (!c) return res({ error: 'その番号の部屋はありません（番号を確かめるか、作り直してもらってください）' });
      if (c.player === b.player) return res({ error: '同じアカウントどうしでは対戦できません（別の端末・別の名前で入ってください）' });
      await st.delete('c:' + b.code);
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
    // 待っている間に同じ人がつなぎ直した（スマホで別のアプリを開いた など）：古い方と入れかえる
    const old = this.phase === 'wait' && this.ps.find(p => p.id === me.id);
    if (old) { old.gone = true; try { old.ws.close(1000, 'replaced'); } catch (e) {} this.ps = this.ps.filter(p => p !== old); }
    if (this.phase !== 'wait' || this.ps.length >= 2 || this.ps.some(p => p.id === me.id)) {
      send(ws, { t: 'err', m: this.ps.some(p => p.id === me.id) ? '同じアカウントどうしでは対戦できません' : 'この部屋は始まっています' }); ws.close(1000, 'full');
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (!this.cfg) this.cfg = { kind: VS_KINDS.includes(me.kind) ? me.kind : 'simple', bet: MEDAL.bets.includes(me.bet) ? me.bet : 0, room: me.room };
    const p = { id: me.id, name: me.name, cc: me.cc || '', ws, team: me.team || null, st: [0, 0, 0, 0, 0], sc: 0, alive: true };
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
    this.ps.forEach((p, i) => { const o = this.ps[1 - i]; this.send(p, { t: 'start', kind: this.cfg.kind, bet, seed, limit: VS_LIMIT_SEC, wait: 3500, me: { rate: p.rate, cc: p.cc }, opp: { name: o.name, cc: o.cc, rate: o.rate, team: o.team } }); });
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
    if (this.phase === 'wait') {                         // 部屋番号の部屋は、つなぎ直しを待つ（番号は10分残る）。ランダムは待ち合わせから消す
      this.ps = this.ps.filter(x => x !== p);
      if (!String(this.cfg && this.cfg.room).startsWith('c')) this.lobbyCancel();
      return;
    }
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
    const rated = String(this.cfg.room || '').startsWith('q');   // ランダム対戦だけレートが動く
    if (win) {
      const ew = 1 / (1 + Math.pow(10, (lose.rate - win.rate) / 400)), d = rated ? Math.max(1, Math.round(RATE_K * (1 - ew))) : 0;
      out[win.id] = { res: 'win', delta: d, rate: win.rate + d, medal: this.pot };
      out[lose.id] = { res: 'lose', delta: -d, rate: Math.max(0, lose.rate - d), medal: -bet };
      if (this.pot) await medalGive(env, win.id, this.pot, 'win', t);
    } else {
      this.ps.forEach(p => { out[p.id] = { res: 'draw', delta: 0, rate: p.rate, medal: 0 }; });
      for (const p of this.ps) if (bet) await medalGive(env, p.id, bet, 'draw', t);
    }
    if (rated) for (const p of this.ps) { await rateSave(env, p.id, kind, out[p.id].rate, out[p.id].res, t); await monthSave(env, p.id, kind, out[p.id].rate, t); }
    for (const p of this.ps) out[p.id].rated = rated;
    for (const p of this.ps) {
      const m = await medalOf(env, p.id);
      this.send(p, Object.assign({ t: 'end', why, medals: m ? m.balance : 0 }, out[p.id]));
    }
  }
}
