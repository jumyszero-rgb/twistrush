# TWIST RUSH サーバー（api.twistrush.com）

Cloudflare Workers ＋ D1（無料枠で動く）。GitHub の `twistrush` リポジトリの `server` フォルダから、push で自動公開される。

## できること

| 機能 | 内容 |
|---|---|
| ランキング | 60秒アタック・エンドレス。今日・今週・今月・全期間（日本時間で区切る） |
| ゲスト登録 | 名前だけでランキングに載る（`GUEST_SIGNUP = "1"` のとき）。本番でログインだけにするときは `"0"` |
| 月間のごほうび | 前の月の順位でアイテム。中身は `src/index.js` の `MONTH_REWARDS` で変える（ゲームの更新はいらない） |
| ログイン | Google・LINE・Microsoft（登録したものだけ使える） |
| オンライン対戦 | 2人。シンプル対戦・キャラ対戦、ランダムと部屋番号（4けた）。部屋は Durable Object（無料プランの SQLite 型） |
| 対戦メダル | お金では買えない対戦専用コイン。はじめて300・毎日100。賭け（0/10/50/100）とメダル交換。数字と交換品は `src/vs.js` |
| 対戦レート | シンプル・キャラで別。勝ち負けで増減（はじめは1000） |
| クラウドセーブ・ゴールドコイン | ログインした人だけ |

テーブルは最初のアクセスで自動で作られる。署名用の秘密（SESSION_SECRET）も、入れていなければデータベースに自動で作る。

## はじめての公開（Cloudflare のダッシュボードで1回だけ）

1. Workers & Pages →「アプリケーションを作成」→「リポジトリをインポート」（Git に接続）
2. `jumyszero-rgb/twistrush` を選ぶ
3. プロジェクト名：`twistrush-server`（`wrangler.jsonc` の name と同じにする）
4. 「詳細設定」→ ルートディレクトリ（パス）：`server`
5. デプロイ

データベース（`twistrush-db`）と、住所 `api.twistrush.com` は自動で作られる。
`https://api.twistrush.com/api/ping` を開いて `{"ok":true,...}` と出れば成功。

## ログインを使うとき（本番）

各サービスの登録のしかたは前の README（twistrush-server.zip）と同じ。戻り先は `https://api.twistrush.com/auth/〇〇/callback`。
ダッシュボードの「変数とシークレット」に、シークレットとして `GOOGLE_CLIENT_ID` などを入れる。
