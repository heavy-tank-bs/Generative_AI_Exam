# AI Study Studio

`データソース` フォルダ内の「AI基礎講座」PDFをもとにした四択クイズサイトです。未ログイン時は端末内へ保存し、Microsoft 365でログインするとSupabase経由で端末間同期できます。

## 起動方法

1. このフォルダで`python -m http.server 8080`を実行します。
2. ブラウザで`http://localhost:8080/`を開きます。
3. 出題数（5問・10問・20問・全問）を選びます。
4. 必要に応じて「問題をシャッフル」をON/OFFします（初期値はON）。
5. 学習したい章の「この章をはじめる」を押します。

サイトの利用にパッケージのインストールは不要です。Supabaseのプレースホルダーが未設定の場合は、ログインUIを表示せず従来どおりローカル保存だけで動作します。

Supabase、会社のMicrosoft Entra ID、GitHub Pagesを使う場合は、[Supabase・GitHub Pages セットアップ](SUPABASE_SETUP.md)を参照してください。

## 学習履歴について

- 回答数、ベスト正答率、間違えた問題は、まずブラウザの `localStorage` に自動保存されます。
- Microsoft 365でログイン中は、ユーザー専用のローカルキャッシュとSupabaseへ同期します。
- 初回ログイン時にクラウド履歴がなければ、既存のローカル履歴をそのアカウントへ移行します。
- ログアウトすると匿名用履歴へ切り替わり、別ユーザーのキャッシュは画面に表示しません。
- 間違えた問題は各章の「復習」または「まとめて復習」から再挑戦できます。
- 復習モードで正解すると、その問題は復習リストから外れます。
- 同じMicrosoft 365アカウントでログインすれば、別端末でもクラウド履歴を読み込めます。
- 「学習履歴をリセット」から全履歴を削除できます。

## ファイル構成

- `index.html`: 画面構造
- `styles.css`: レスポンシブデザイン
- `app.js`: 出題、採点、画面遷移、ユーザー別ローカル保存
- `cloud-sync.js`: Supabase Auth、クラウド読込・遅延保存、ログイン・ログアウト
- `supabase-config.js`: 公開可能なProject URL・Publishable key設定
- `supabase/schema.sql`: 学習履歴テーブル、権限、RLSポリシー
- `SUPABASE_SETUP.md`: Entra ID・Supabase・GitHub Pagesの設定手順
- `.nojekyll`: GitHub Pagesで静的ファイルをそのまま配信するための設定
- `data/chapter-*.js`: 第1〜6章・各25問のクイズデータ
- `データソース/`: ローカル参照用PDF（GitHub管理対象外）

## 問題データの検証（任意）

Node.jsがある環境では、次のコマンドで全150問の件数・ID・選択肢・正解index・出典ページを検証できます。

```powershell
node tests/validate-data.cjs
```

`npm install` 後は、次のコマンドでブラウザE2Eも実行できます。

```powershell
npm run test:e2e
npm run test:cloud
```
