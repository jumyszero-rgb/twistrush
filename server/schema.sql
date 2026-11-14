-- TWIST RUSH サーバー（アカウント・セーブ・ゴールドコイン・ランキング）
-- 何度流しても大丈夫（IF NOT EXISTS）

-- アカウント（1人1行）
CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY,          -- ランダムなID（外には出さない）
  name        TEXT NOT NULL DEFAULT '',  -- ランキングに出す名前
  created_at  INTEGER NOT NULL,
  last_login  INTEGER NOT NULL,
  banned      INTEGER NOT NULL DEFAULT 0
);

-- ログインに使った外部アカウント（Google・LINE・Microsoft…）。1つのアカウントに複数つなげられる
CREATE TABLE IF NOT EXISTS identities (
  provider    TEXT NOT NULL,             -- 'google' | 'line' | 'microsoft'
  sub         TEXT NOT NULL,             -- そのサービスでの利用者ID
  account_id  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (provider, sub)
);
CREATE INDEX IF NOT EXISTS idx_ident_account ON identities(account_id);

-- セーブデータ（持ちキャラ・チーム・ストーリーの記録・シルバーコインなど。ゴールドコインは入れない）
CREATE TABLE IF NOT EXISTS saves (
  account_id  TEXT PRIMARY KEY,
  rev         INTEGER NOT NULL,          -- 保存のたびに+1（古い端末からの上書きを防ぐ）
  data        TEXT NOT NULL,             -- JSON
  device      TEXT NOT NULL DEFAULT '',  -- 最後に保存した端末（表示用）
  updated_at  INTEGER NOT NULL
);

-- ゴールドコインの残高（どこで買ったか別に持つ。返金のときにその分だけ引くため）
--   source: 'free'（配布）| 'web'（Stripe）| 'google'（Google Play）| 'apple'（App Store）
CREATE TABLE IF NOT EXISTS wallet (
  account_id  TEXT NOT NULL,
  source      TEXT NOT NULL,
  balance     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, source)
);

-- ゴールドコインの出入りの記録（すべて残す。同じ ref は2回処理しない）
CREATE TABLE IF NOT EXISTS ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  TEXT NOT NULL,
  source      TEXT NOT NULL,
  delta       INTEGER NOT NULL,          -- 増えたら＋、使ったら−
  reason      TEXT NOT NULL,             -- 'purchase' | 'spend:gacha' | 'refund' | 'grant' など
  ref         TEXT NOT NULL,             -- 購入番号や、端末が作った一意の番号
  created_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_ref ON ledger(account_id, ref, source);
CREATE INDEX IF NOT EXISTS idx_ledger_time ON ledger(created_at);

-- ランキング（ログインした人だけ載る）
CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  player     TEXT NOT NULL,             -- accounts.id
  name       TEXT NOT NULL,
  mode       TEXT NOT NULL,             -- 'sixty' | 'rank'
  score      INTEGER NOT NULL,
  blocks     INTEGER NOT NULL DEFAULT 0,
  dur        INTEGER NOT NULL DEFAULT 0,
  ver        TEXT NOT NULL DEFAULT '',
  log        TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_mode_time  ON scores(mode, created_at);
CREATE INDEX IF NOT EXISTS idx_scores_mode_score ON scores(mode, score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_player     ON scores(player, created_at);

-- サーバーの設定（署名用の秘密の文字列など。SESSION_SECRET を入れていないときに自動で作る）
CREATE TABLE IF NOT EXISTS meta (
  k  TEXT PRIMARY KEY,
  v  TEXT NOT NULL
);

-- ゲスト登録の記録（同じ場所から大量に作られないように）
CREATE TABLE IF NOT EXISTS guest_log (
  ip  TEXT NOT NULL,
  t   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guest_log ON guest_log(ip, t);

-- 月間ランキングのごほうびを受け取った記録（同じ月・同じモードは1回だけ）
CREATE TABLE IF NOT EXISTS reward_claims (
  account_id  TEXT NOT NULL,
  month       TEXT NOT NULL,             -- '2026-11'
  mode        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (account_id, month, mode)
);

-- 対戦メダル（お金では買えない、対戦専用のコイン）
CREATE TABLE IF NOT EXISTS medals (
  account_id  TEXT PRIMARY KEY,
  balance     INTEGER NOT NULL DEFAULT 0,
  daily       TEXT NOT NULL DEFAULT ''      -- 最後に毎日のメダルをもらった日（日本時間 'YYYY-MM-DD'）
);
CREATE TABLE IF NOT EXISTS medal_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  TEXT NOT NULL,
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL,             -- 'first' | 'daily' | 'bet' | 'win' | 'draw' | 'buy:〜'
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_medal_log ON medal_log(account_id, created_at);

-- 対戦レート（シンプル対戦・キャラ対戦で別）
CREATE TABLE IF NOT EXISTS ratings (
  account_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,             -- 'simple' | 'chara'
  rate        INTEGER NOT NULL,
  win         INTEGER NOT NULL DEFAULT 0,
  lose        INTEGER NOT NULL DEFAULT 0,
  draw        INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (account_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_ratings ON ratings(kind, rate DESC);

-- 月ごとの対戦レート（ランダム対戦だけ。月の終わりのレートと、その月の試合数）
CREATE TABLE IF NOT EXISTS ratings_month (
  account_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  month       TEXT NOT NULL,             -- '2026-11'
  rate        INTEGER NOT NULL,
  games       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, kind, month)
);
CREATE INDEX IF NOT EXISTS idx_ratings_month ON ratings_month(kind, month, rate DESC);

-- オートバトル：防衛チーム（ほかの人の対戦相手になる）
CREATE TABLE IF NOT EXISTS defense (
  account_id  TEXT PRIMARY KEY,
  team        TEXT NOT NULL,             -- JSON（4人ぶんのステータスと技の強さ）
  power       INTEGER NOT NULL,          -- 戦闘力
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_defense_power ON defense(power);
-- オートバトル：アリーナコイン（交換専用）・ポイント・1日の挑戦回数
CREATE TABLE IF NOT EXISTS arena (
  account_id  TEXT PRIMARY KEY,
  coins       INTEGER NOT NULL DEFAULT 0,
  points      INTEGER NOT NULL DEFAULT 1000,
  win         INTEGER NOT NULL DEFAULT 0,
  lose        INTEGER NOT NULL DEFAULT 0,
  day         TEXT NOT NULL DEFAULT '',
  tries       INTEGER NOT NULL DEFAULT 0
);
-- オートバトル：防衛の記録（だれに挑まれて、勝ったか）
CREATE TABLE IF NOT EXISTS arena_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  defender       TEXT NOT NULL,
  attacker       TEXT NOT NULL,
  attacker_name  TEXT NOT NULL,
  attacker_cc    TEXT NOT NULL DEFAULT '',
  win            INTEGER NOT NULL,       -- 1＝防衛成功
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_arena_log ON arena_log(defender, created_at);

-- 買ったゴールドコイン（購入ごと）。購入から180日で期限切れ。使うときは期限の近いものから減る
CREATE TABLE IF NOT EXISTS gold_lots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  TEXT NOT NULL,
  source      TEXT NOT NULL,             -- 'web' | 'google' | 'apple'
  amount      INTEGER NOT NULL,          -- 買った数
  left_n      INTEGER NOT NULL,          -- 残り
  bought_at   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  ref         TEXT NOT NULL DEFAULT ''   -- 購入番号
);
CREATE INDEX IF NOT EXISTS idx_gold_lots ON gold_lots(account_id, expires_at);

-- 毎日の利用者（端末ごとの乱数ID。チャレンジを始める目安：1日500人）
CREATE TABLE IF NOT EXISTS daily_active ( day TEXT NOT NULL, did TEXT NOT NULL, PRIMARY KEY (day, did) );

-- キャラの人気投票（月ごと）
CREATE TABLE IF NOT EXISTS votes ( month TEXT NOT NULL, account_id TEXT NOT NULL, cid TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (month, account_id, cid) );
CREATE INDEX IF NOT EXISTS idx_votes_month ON votes(month, cid);
CREATE TABLE IF NOT EXISTS vote_free ( account_id TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (account_id, day) );
CREATE TABLE IF NOT EXISTS vote_refs ( ref TEXT PRIMARY KEY, account_id TEXT NOT NULL, n INTEGER NOT NULL, created_at INTEGER NOT NULL );
