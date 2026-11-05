# ミチノート v0.2 — Web公開の手順

このリポジトリは非公開のまま維持してください。公開するのは `public/` フォルダー内の静的ファイルだけです。バックアップ、DBスキーマ、開発資料をまとめて公開しないでください。

## Vercel を使う場合
1. https://vercel.com/new で GitHub から `tubasa510725-eng/-michinote` をインポート
2. Framework Preset: Other / Root Directory: `.` / Output Directory: `public`
3. Build Command は不要。Deploy を押す
4. 発行された HTTPS の URL を Safari で開く
5. Safari の共有メニューから「ホーム画面に追加」を選ぶ

リポジトリ直下の `vercel.json` にも `public` を指定しています。

## Cloudflare Pages を使う場合
1. https://dash.cloudflare.com/ にログインし、Workers & Pages → Create application → Pages → Connect to Git
2. GitHub のこのリポジトリを選択
3. Production branch: `main`、Build command: `exit 0`、Build output directory: `public`
4. Deploy を実行し、発行された `*.pages.dev` を Safari で開く

## 重要
- 公開 URL は基本的に誰でもアクセスできます。非公開リポジトリとサイトの非公開化は別です。
- この v0.2 の走行履歴・写真は端末のブラウザ内の保存領域に保持されます。サーバーへの同期やアカウント保護はありません。端末・ブラウザを変えてもデータは移行されません。
- iPhoneの画面ロック・バックグラウンド中は GPS 記録の継続を保証しません。
- 初回はインターネット接続が必要で、GPSには位置情報の許可が必要です。
- 走行中にスマホの画面操作をしないでください。
