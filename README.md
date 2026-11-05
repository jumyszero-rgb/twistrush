# TWIST RUSH（Web版）

https://twistrush.com で公開するゲーム本体。Cloudflare Pages がこのリポジトリから自動で公開する。

- `index.html` … ゲーム本体（スマホ専用。パソコンで開くとQRコードの案内が出る）
- `img/` `bgm/` `voice/` `video/` … 絵・曲・声・動画
- `_headers` … Cloudflare Pages のキャッシュ設定
- `manifest.webmanifest` `sw.js` `img/app/` … アプリ化（ホーム画面に追加して全画面で遊ぶ）の設定・アイコン

このリポジトリに push すると、1〜2分で twistrush.com が新しくなる。

## はじめての設定（1回だけ）

1. Cloudflare のダッシュボード →「Workers & Pages」→「作成」→「Pages」→「Git に接続」
2. GitHub の `jumyszero-rgb/twistrush` を選ぶ
3. ビルドの設定
   - フレームワーク：なし
   - ビルドコマンド：空のまま
   - 出力ディレクトリ：`/`
4. 「保存してデプロイ」
5. できた Pages のプロジェクト →「カスタムドメイン」→ `twistrush.com` を追加（同じCloudflareのドメインなので自動でつながる）
6. `www.twistrush.com` も追加しておく

## 更新

Claude がこのリポジトリに push する。手で直したときは、ふつうに commit して push すればいい。

## サーバー

ログイン・セーブ・ランキングのサーバーは別（`twistrush-server`、住所は https://api.twistrush.com）。
