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
