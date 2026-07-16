# Supabase・GitHub Pages セットアップ

この手順は、AI Study StudioをGitHub Pagesで公開し、会社のMicrosoft Entra IDアカウントでログインした利用者ごとに学習履歴をSupabaseへ保存するためのものです。

## 事前確認

SupabaseとGitHubは社外SaaSです。作業を始める前に、自社の情報セキュリティ・法務・M365管理者へ次を確認してください。

- Supabase Authへ社員の識別情報（ユーザーID、メールアドレス等）を渡すこと
- Supabase Databaseへクイズの回答履歴・復習対象・設定を保存すること
- GitHub Pagesへクイズサイトと問題データを公開すること
- 保存リージョン、保持期間、退職者のデータ削除、監査、インシデント対応
- PDFや問題データを社外公開してよいこと。不要なPDFや内部資料はPagesの公開対象へ含めないこと

承認されない場合は、この構成を採用せず、社内で承認済みのM365／Azure基盤を使用してください。

> [!IMPORTANT]
> `requireSignIn: true`は画面を隠すクライアント側のUI制御です。GitHub Pagesに配置したHTML・JavaScript・問題データ・PDFへの直接アクセスを認証で保護するものではありません。教材を一般公開できない場合は、GitHub Enterprise Cloudのアクセス制御付きPagesを利用できるか確認するか、SharePoint／Azure Static Web Appsなど認証付きの公開先へ切り替えてください。

## 1. Supabaseプロジェクトを作成する

1. Supabaseで新しいプロジェクトを作成します。
2. Project URL（`https://<project-ref>.supabase.co`）を控えます。
3. Project SettingsのAPI Keysから、`sb_publishable_...`で始まるPublishable keyを控えます。
4. Secret keyや旧`service_role` keyは取得・配置しません。これらはRLSを迂回するため、ブラウザ、GitHub、`supabase-config.js`へ置いてはいけません。

参考: [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)

## 2. データベースを作成する

1. Supabase DashboardのSQL Editorを開きます。
2. [`supabase/schema.sql`](supabase/schema.sql)を貼り付けて実行します。
3. Table Editorで`public.quiz_progress`を開き、RLSが有効であることを確認します。
4. Policiesで、`authenticated`ロールに本人行だけを許可するSELECT・INSERT・UPDATE・DELETEの4ポリシーがあることを確認します。

このテーブルは`user_id`を主キーにした1ユーザー1行構成です。現在の学習履歴オブジェクトを`progress` JSONB列へ保存し、更新時刻はトリガーがデータベース時刻で更新します。

参考: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)

## 3. Microsoft Entra IDにアプリを登録する

1. Azure PortalでMicrosoft Entra ID → App registrations → New registrationを開きます。
2. Supported account typesは、原則として「この組織ディレクトリ内のアカウントのみ」（シングルテナント）を選びます。
3. PlatformはWebを選び、Redirect URIへ次を登録します。

   ```text
   https://<project-ref>.supabase.co/auth/v1/callback
   ```

   これはSupabase AuthのコールバックURLです。GitHub PagesのURLではありません。

4. Application (client) IDとDirectory (tenant) IDを控えます。
5. Certificates & secretsでClient secretを作成し、`Value`を安全な場所へ控えます。Secret IDではありません。
6. シークレットの有効期限と更新担当者を管理台帳へ記録します。

Supabase公式は、Microsoftから未検証メールドメインが返るケースへの対策として、EntraアプリのOptional claimsへ`xms_edov`を追加することも推奨しています。組織のEntra管理者と確認のうえ設定してください。

参考: [Login with Azure (Microsoft)](https://supabase.com/docs/guides/auth/social-login/auth-azure)

## 4. SupabaseでAzureプロバイダーを設定する

Supabase DashboardのAuthentication → Providers → Azureで次を設定します。

| 項目 | 設定値 |
|---|---|
| Enabled | ON |
| Client ID | EntraのApplication (client) ID |
| Client Secret | Entraで作成したシークレットのValue |
| Azure Tenant URL | `https://login.microsoftonline.com/<tenant-id>` |

`Azure Tenant URL`を既定の`https://login.microsoftonline.com/common`のままにすると、一般のMicrosoftアカウントを受け入れる構成になり得ます。会社限定運用ではDirectory (tenant) IDを使って固定してください。

クライアントのAzureログイン処理では、Supabase公式要件に従い`provider: "azure"`と`scopes: "email"`を指定します。Client Secretをクライアントコードへ渡す必要はありません。

## 5. GitHub PagesのURLをSupabaseへ登録する

公開URLを次の形式で決めます。

```text
https://<github-user-or-org>.github.io/<repository>/
```

Supabase DashboardのAuthentication → URL Configurationで設定します。

| 項目 | 設定例 |
|---|---|
| Site URL | `https://<github-user-or-org>.github.io/<repository>/` |
| Redirect URLs（本番） | 上記と同じ完全なURL |
| Redirect URLs（ローカル開発） | `http://localhost:8080/**` |

- 本番URLはワイルドカードではなく、末尾の`/`を含む正確なURLを登録します。
- Organization Pagesなどリポジトリ名を含まない公開形式では、実際のPages URLに合わせます。
- ログイン処理の`redirectTo`も登録した本番URLまたはローカルURLと一致させます。

参考: [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)

## 6. ブラウザ設定値を差し替える

[`supabase-config.js`](supabase-config.js)のプレースホルダーを差し替えます。

```js
window.SUPABASE_CONFIG = {
  url: "https://<project-ref>.supabase.co",
  publishableKey: "sb_publishable_...",
  requireSignIn: true,
  syncDebounceMs: 750,
};
```

- `url`: SupabaseのProject URL
- `publishableKey`: Publishable keyだけを指定
- `requireSignIn`: 会社アカウントでのログインを必須にする場合は`true`
- `syncDebounceMs`: 連続操作をまとめて保存する待ち時間（ミリ秒）

このファイルはGitHub Pagesから誰でも読めます。Publishable keyは公開クライアント用ですが、RLSが必須です。Secret key、`service_role` key、Entra Client Secretは絶対に記載しないでください。

学習履歴は操作のたびにブラウザのlocalStorageへ保存され、ログイン中はSupabaseへ同期されます。localStorageは暗号化された保管領域ではなく、同じブラウザを操作できる人や開発者ツールから確認できます。回答履歴へ機密情報を含めず、共用端末ではOS／ブラウザの利用者プロファイルを分離してください。

## 7. ローカルで確認する

OAuthのリダイレクトを確認するため、`index.html`を直接開かずHTTPサーバーで起動します。

```powershell
python -m http.server 8080
```

ブラウザで`http://localhost:8080/`を開き、次を確認します。

1. 会社アカウントでログインできる
2. 会社テナント外のMicrosoftアカウントが拒否される
3. 回答後に`quiz_progress`へ本人の行だけが作成される
4. 別ユーザーでは前のユーザーの履歴が表示・取得されない
5. ログアウト後にサイト上からユーザー別履歴を表示できず、Supabaseの本人行を取得できない
6. Secret key、`service_role` key、Entra Client SecretがブラウザのソースやNetworkに存在しない

## 8. GitHub Pagesへ公開する

1. 公開が承認されたファイルだけをGitHubリポジトリへ登録します。
2. GitHubのSettings → Pagesで公開元ブランチとフォルダーを選びます。
3. 公開後、実際のPages URLがSupabaseのSite URL・Redirect URLsと完全一致することを再確認します。
4. 本番URLでログイン、保存、再読込、ログアウト、別ユーザー分離を再テストします。

`supabase-config.js`のPublishable keyを隠すためにGitHub Secretsを使っても、最終的なブラウザ配信物では公開されます。安全性はキーの秘匿ではなく、Publishable key＋最小権限のgrant＋RLSで確保します。

リポジトリ直下の`.nojekyll`はそのまま公開対象に含めてください。また、通常のGitHub Pagesはサイトファイルを公開配信します。リポジトリが非公開でも、利用プランとPages設定によって公開サイトまで非公開になるとは限らないため、公開URLをシークレットウィンドウで確認してください。

この実装は1ユーザー1行を更新する最終書き込み優先（last-write-wins）方式です。同じユーザーが複数端末で同時に回答すると、後から保存された端末の履歴で上書きされる可能性があります。通常は1端末ずつ利用し、厳密な履歴統合が必要になった場合は回答イベントを別テーブルへ保存する方式へ拡張してください。

新旧判定にはブラウザ端末の更新時刻も使用します。社用端末の日時をOSの自動時刻同期で正しく保ってください。また、同じ`github.io`オリジンへこのアプリを複数のリポジトリパスで展開すると、localStorageのキーを共有します。検証環境と本番環境を同一オリジンに並べる場合は、`app.js`の`STORAGE_KEY`と`cloud-sync.js`の`AUTH_STORAGE_KEY`を環境ごとに一意な値へ変更してください。

## 運用チェック

- Entra Client Secretの期限切れ前に更新する
- 退職者・異動者のアクセス停止とSupabaseユーザー／履歴削除手順を決める
- SupabaseとGitHubの管理者アカウントへMFAを設定する
- RLSを無効化しない。テーブル追加時もRLSとgrantをレビューする
- 本番リダイレクトに不要なワイルドカードを残さない
- GitHub Pagesの公開URLから問題データやPDFを直接取得できない前提にしない
- 複数端末での同時回答を避け、同期エラー表示が出た場合は再接続後に再読込して確認する
- 社用端末の自動時刻同期を有効にする
- Supabase・GitHubの契約、リージョン、サブプロセッサー変更を社内規程に沿って定期確認する
