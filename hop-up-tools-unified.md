# hop-up-tools 統合指示書（Claude Code 向け）

> **このファイルが唯一の正（Single Source of Truth）。**
> 以前の `hop-up-tools-handover.md`、`fc_deadline_tool_instructions.md`、`hop-up-tools-architecture.md` の内容はすべてここに統合済み。矛盾がある場合はこのファイルを優先すること。

---

## 1. プロジェクト概要

ハロプロファン向け Web ツール群を **1 つのアプリ・1 つのドメイン** で提供する。

| 項目 | 値 |
|------|-----|
| リポジトリ | `hoprabbithophophop-gif/hop-up-tools`（GitHub プライベート） |
| ホスティング | Cloudflare Pages（静的サイト・無料プラン） |
| ドメイン | `hop-up-tools.pages.dev` |
| フレームワーク | **Vite + React + TypeScript**（全ツール共通） |
| スタイリング | Tailwind CSS |
| ルーティング | React Router（パスでツールを切り替え） |
| DB | Supabase（**1 プロジェクトを全ツールで共有**） |
| ドメイン方針 | `hop-up-tools.pages.dev` のまま（カスタムドメイン取得しない） |

---

## 2. 確定済みアーキテクチャ

### 2.1 構成の選定理由

| 決定 | 理由 |
|------|------|
| Next.js → Vite + React | サーバー処理ゼロ。SSR フレームワーク不要。Cloudflare アダプター問題の根本解消 |
| Workers → Pages | 静的サイトなのでリクエスト無制限・完全無料。Workers の 10 万/日制限を回避 |
| 独立型 → 統合型 | ドメイン統一優先（`hop-up-tools.pages.dev` 1 つで全ツール提供） |
| OGP 画像生成 | 削除済み・復活しない（Workers 無料枠の CPU 制限に抵触するため） |

### 2.2 リポジトリ構成

```
hop-up-tools/
├── package.json              ← 1 つの Vite + React プロジェクト
├── vite.config.ts
├── tailwind.config.ts
├── index.html
├── public/
│   └── _redirects            ← SPA 用リダイレクト（後述）
├── src/
│   ├── main.tsx
│   ├── App.tsx               ← React Router でルーティング
│   ├── pages/
│   │   ├── TopPage.tsx       ← / （ツール一覧・ポータル）
│   │   ├── profile/
│   │   │   ├── ProfilePage.tsx       ← /profile（プロフ帳メーカー）
│   │   │   ├── SlugPage.tsx          ← /p/:slug（短縮 URL 表示）
│   │   │   └── components/
│   │   └── fc-ticket/
│   │       ├── FcTicketPage.tsx      ← /fc-ticket（締切リマインダー）
│   │       └── components/
│   │   └── youtube/
│   │       ├── YouTubePage.tsx       ← /youtube（Phase 3）
│   │       └── components/
│   ├── components/           ← 共通コンポーネント
│   ├── lib/
│   │   ├── supabase.ts       ← lazy 初期化パターン（既存流用）
│   │   ├── slug.ts
│   │   └── ics.ts            ← .ics ファイル生成
│   └── assets/
├── gas/                      ← GAS スクレイパー（デプロイ対象外）
│   ├── upfc-scraper.js
│   └── elineup-scraper.js   ← v2
├── docs/                     ← ドキュメント類（デプロイ対象外）
└── README.md
```

### 2.3 ルーティング

| パス | ページ | 説明 |
|------|--------|------|
| `/` | TopPage | ツール一覧ポータル |
| `/profile` | ProfilePage | プロフ帳メーカー（メイン UI） |
| `/p/:slug` | SlugPage | 短縮 URL 表示 |
| `/fc-ticket` | FcTicketPage | FC 締切リマインダー |
| `/youtube` | YouTubePage | YouTube 情報集約（Phase 3） |
| `/privacy` | PrivacyPage | プライバシーポリシー |
| `/terms` | TermsPage | 利用規約 |

### 2.4 SPA リダイレクト設定

`public/_redirects`:
```
/*    /index.html   200
```
→ React Router のクライアントサイドルーティングを有効化。直リンクで 404 にならないようにする。

---

## 3. 非機能要件

### 3.1 コスト：$0

- Cloudflare Pages Free：リクエスト無制限、帯域無制限、商用利用 OK（AdSense 可）
- Supabase Free：**1 プロジェクトを全ツールで共有**。短縮 URL + FC 締切 + YouTube キャッシュすべて同一 DB。Free tier の制限（500MB ストレージ、50K MAU）は当面十分
- GAS：Google アカウントがあれば無料
- ドメイン：`hop-up-tools.pages.dev`（Cloudflare 提供サブドメイン。独自ドメインは取得しない）

### 3.2 保守性

- アダプターライブラリ不要（`vite build` → 静的ファイルを Pages に置くだけ）
- deprecated ライブラリへの依存なし
- フレームワークのバージョンアップによる破壊リスク最小

### 3.3 パフォーマンス

- 全処理がクライアントサイド。CDN エッジ配信で高速
- Vite のビルドは Next.js より軽量

### 3.4 SEO

- `/p/:slug` が SSR でなくなるため、検索エンジンがプロフィール内容を直接読めない
- ハロプロファン同士の X シェアが主用途なので、検索流入は不要。影響なし

---

## 4. ツール①：プロフ帳メーカー（hello-profile）

### 4.1 機能概要

- ブラウザ上でハロプロ推しプロフ帳を作成・シェアする
- 短縮 URL 経由で X にシェア

### 4.2 技術詳細

- Supabase：短縮 URL の保存・取得（`short_urls` テーブル）
- `lz-string`：既存の圧縮 URL との互換性維持
- Supabase `anon key` はブラウザから直接使用（公開前提のキー。RLS で保護）

### 4.3 Next.js → Vite 移行時の変換ポイント

| 変更箇所 | Before (Next.js) | After (Vite + React) |
|----------|-------------------|----------------------|
| ディレクティブ | `"use client"` | 削除（全部クライアント） |
| ルーティング | `app/profile/page.tsx` | React Router `/profile` |
| 動的ルート | `app/p/[slug]/page.tsx` | React Router `/p/:slug` |
| ナビゲーション | `next/navigation` | `react-router-dom` |
| 画像 | `next/image` | `<img>` |
| 環境変数 | `process.env.NEXT_PUBLIC_*` | `import.meta.env.VITE_*` |
| サーバーコンポーネント | `/p/[slug]` でサーバー取得 | `useEffect` + `useState` でブラウザから取得 |

### 4.4 未対応（別途対応）

- Supabase RLS INSERT ポリシーの修正
- v1 改善（メンカラー対応、推し脳マップ修正等）→ kaleidora_profile_v1_instructions.md 参照

---

## 5. ツール②：FC 締切リマインダー（fc-ticket）

### 5.1 機能概要

UPFC の FC 情報と e-LineUP!Mall のグッズ販売締切を「うっかり見逃す」のを防ぐツール。

- ユーザー登録不要
- 締切ごとに 📅 カレンダー登録ボタン（`.ics` ファイル生成）
- iOS / Android / PC すべて対応

### 5.2 Supabase テーブル設計

#### テーブル①: `fc_news`（記事本体）

```sql
CREATE TABLE fc_news (
  uid         text PRIMARY KEY,
  title       text NOT NULL,
  category    text CHECK (category IN ('コンサート', 'イベント', '配信', 'グッズ', 'その他')),
  detail_url  text,
  scraped_at  timestamptz DEFAULT now()
);
```

#### テーブル②: `fc_deadlines`（締切一覧）

```sql
CREATE TABLE fc_deadlines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  news_uid    text REFERENCES fc_news(uid) ON DELETE CASCADE,
  type        text CHECK (type IN (
                'apply_start', 'apply_end', 'result',
                'payment', 'sale_start', 'sale_end', 'other'
              )),
  label       text,
  deadline_at timestamptz,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_fc_deadlines_deadline_at ON fc_deadlines(deadline_at);
CREATE INDEX idx_fc_deadlines_news_uid    ON fc_deadlines(news_uid);
```

#### `type` の種類

| type | 用途 |
|------|------|
| apply_start | 申込開始 |
| apply_end | 申込締切 |
| result | 当落確認開始 |
| payment | 入金締切 |
| sale_start | 販売開始（グッズ・配信） |
| sale_end | 販売終了（グッズ・配信） |
| other | その他 |

#### RLS / 認証

- GAS → `service_role` キー（スクリプトプロパティに設定）
- フロント → `anon` キー + RLS で SELECT のみ許可

### 5.3 スクレイピング（GAS）

#### 対象①: UPFC

- URL: `https://www.upfc.jp/helloproject/news_list.php?@rst=all`
- 取得: 公演タイトル、申込開始/締切、当落確認、入金締切
- ログイン必須ページは対象外

#### 対象②: e-LineUP!Mall（v2）

- URL: `https://www.elineupmall.com/helloproject-fc-b/hello-project/`
- 取得: 商品名、販売開始/締切、お届け予定
- 正規表現でパース可能（パターン確認済み）

#### GAS 処理フロー

1. `UrlFetchApp.fetch()` で HTML 取得
2. パースして締切情報を抽出
3. `fc_news` に UPSERT
4. `fc_deadlines` に UPSERT
5. GAS トリガーで定期実行（1 日 1 回 or 12 時間ごと）

#### GAS 環境変数（スクリプトプロパティ）

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

### 5.4 フロント仕様

- 締切が近い順にタイムライン表示（本日 → 明日 → 以降）
- 各締切に 📅 カレンダー追加ボタン
- 緊急度の色分け：本日=赤、明日=黄、3 日以内=オレンジ、それ以降=通常
- `.ics` ファイルに含める情報：
  - `SUMMARY`: タイトル + 締切ラベル
  - `DTSTART` / `DTEND`: 締切日時
  - `DESCRIPTION`: detail_url へのリンク
  - `VALARM`: 1 日前 + 1 時間前

### 5.5 MVP（最低限公開ライン）

1. UPFC スクレイピング → Supabase にデータが入る
2. フロントで締切一覧がタイムライン表示される
3. 各締切に .ics ダウンロードボタンがある
4. Cloudflare Pages にデプロイされている
5. プライバシーポリシー・利用規約ページがある（AdSense 審査用）

### 5.6 MVP に含めない（v2 以降）

- e-LineUP!Mall スクレイピング
- 通知方法の選択 UI（カレンダー / メール）
- Amazon アソシエイト連携
- SP ポイントプレゼントの手動登録 UI
- category フィルタ
- ユーザーアカウント機能

### 5.7 GAS デプロイ手順

GAS スクレイパーのコードはリポジトリの `gas/` に置くが、GAS へのデプロイは **clasp**（Google Apps Script CLI）を使う。

#### 初回セットアップ

```bash
# clasp インストール
npm install -g @google/clasp

# Google アカウントでログイン
clasp login

# GAS プロジェクトを作成（または既存にリンク）
cd gas/
clasp create --title "hop-up-tools-scraper" --type standalone
# → .clasp.json が生成される（scriptId が記録される）
```

#### デプロイ

```bash
cd gas/
clasp push          # ローカル → GAS にアップロード
clasp open          # ブラウザで GAS エディタを開く（トリガー設定用）
```

#### トリガー設定（GAS エディタで手動）

1. `clasp open` でエディタを開く
2. 左メニュー「トリガー」→「トリガーを追加」
3. 関数: `main`（またはエントリポイント関数名）
4. 実行頻度: 12 時間ごと or 1 日 1 回

#### ファイル構成

```
gas/
├── .clasp.json       ← clasp 設定（scriptId）。.gitignore に追加
├── appsscript.json   ← GAS マニフェスト
├── upfc-scraper.js   ← UPFC スクレイパー
└── elineup-scraper.js ← e-LineUP!Mall スクレイパー（v2）
```

#### 注意

- `.clasp.json` は `.gitignore` に追加（scriptId を公開しない）
- スクリプトプロパティ（`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`）は GAS エディタ → プロジェクトの設定 → スクリプトプロパティで手動設定
- GAS のコードは現時点で未着手（Phase 2 で開発）

---

## 6. ツール③：YouTube 情報集約（youtube-hub）— Phase 3

### 6.1 機能概要

ハロプロ関連の公式 YouTube チャンネルの動画を横断的に検索・閲覧できるツール。

- ユーザー登録不要
- 複数の公式チャンネルの動画を一元的に表示
- グループ別フィルタ（モーニング娘。、アンジュルム、BEYOOOOONDS 等）
- 動画種別フィルタ（MV、ライブ映像、その他）

### 6.2 対象チャンネル

| チャンネル | 内容 |
|-----------|------|
| ハロプロ公式（Hello! Project Station） | MV、ライブ映像、企画動画 |
| アップフロント公式（UP-FRONT CHANNEL） | グループ横断のプロモーション |
| 各グループ公式サブチャンネル | グループ個別のコンテンツ |

※ 具体的なチャンネル ID は開発時に調査

### 6.3 技術方針（暫定）

- YouTube Data API v3 でチャンネルの動画一覧を取得
- API クォータ対策：GAS で定期取得 → Supabase にキャッシュ、フロントは Supabase から読む（fc-ticket と同じパターン）
- or クォータが足りるなら、フロントから直接 API を叩く（シンプル）
- 詳細設計は Phase 3 開始時に決定

### 6.4 フロント仕様（暫定）

- 新着動画一覧（全チャンネル横断）
- グループ別フィルタ
- 動画種別フィルタ（MV / ライブ / その他）
- サムネイル + タイトル + 公開日の一覧表示
- クリックで YouTube に遷移（埋め込み再生はしない）

### 6.5 ルーティング

| パス | 説明 |
|------|------|
| `/youtube` | YouTube 情報集約メインページ |

---

## 6. 収益化方針

1. **AdSense**：MVP 公開と同時に審査申請（Cloudflare Pages 無料プランは商用利用 OK）
2. **Amazon アソシエイト**：v2 以降（helloproject.com/news 連携とセット）
3. **有料機能**：ユーザー数が十分になってから

### AdSense 審査に必要なページ

- **プライバシーポリシー**: Cookie 使用、アクセス解析、データ非収集の明記
- **利用規約**: 非公式ツールの明記、情報の正確性非保証、免責事項
- **お問い合わせ**: 連絡先フォーム or メールアドレス

---

## 7. 環境変数

### フロント（Cloudflare Pages ダッシュボードで設定）

| 変数名 | 用途 |
|--------|------|
| `VITE_SUPABASE_URL` | Supabase プロジェクト URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon キー（公開前提） |

### GAS（スクリプトプロパティで設定）

| 変数名 | 用途 |
|--------|------|
| `SUPABASE_URL` | Supabase プロジェクト URL |
| `SUPABASE_SERVICE_KEY` | Supabase service_role キー（非公開） |

### ルール

- `.env` は絶対に git に commit しない（`.gitignore` 必須）
- `.env` はローカル開発用のみ
- `.clasp.json` も `.gitignore` に追加（GAS の scriptId を公開しない）
- `.mcp.json` も `.gitignore` に追加

---

## 8. Cloudflare Pages デプロイ設定

| 項目 | 値 |
|------|-----|
| プロジェクト名 | `hop-up-tools` |
| GitHub リポジトリ | `hoprabbithophophop-gif/hop-up-tools` |
| ビルドコマンド | `npm run build` |
| 出力ディレクトリ | `dist` |
| ルートディレクトリ | `/`（リポジトリルート） |

---

## 9. 開発順序

### Phase 1: hello-profile 移行

1. Vite + React + TypeScript + Tailwind プロジェクト初期化
2. React Router セットアップ
3. 既存の Next.js コードを移植（変換ポイントは §4.3 参照）
4. ローカルで動作確認
5. Cloudflare Pages にデプロイ

### Phase 2: fc-ticket MVP

1. Supabase テーブル作成（§5.2）
2. UPFC ページ構造の解析
3. GAS スクレイパー開発（§5.3）
4. フロント開発（§5.4）
5. 法的ページ作成（プライバシーポリシー・利用規約）
6. デプロイ・公開
7. AdSense 審査申請

### Phase 3: 改善・拡張

1. **YouTube 情報集約ツール開発**（§6）
2. e-LineUP!Mall スクレイピング追加
3. category フィルタ等の UX 改善
4. hello-profile v1 改善（メンカラー対応等）— デザイン確定後に着手

---

## 10. アカウント情報

| 項目 | 値 |
|------|-----|
| Cloudflare アカウント | Hop.rabbit.hophophop@gmail.com |
| Cloudflare アカウント ID | `18bc496e1954d5930158593c0cdec70d` |
| GitHub アカウント | `hoprabbithophophop-gif` |
| GitHub リポジトリ | `hoprabbithophophop-gif/hop-up-tools` |
| Cloudflare プロジェクト名 | `hop-up-tools` |

---

## 11. Supabase MCP（Claude Code 連携）

Claude Code から直接 Supabase を操作する場合、`.mcp.json` をプロジェクトルートに作成：

```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=<YOUR_PROJECT_REF>"
    }
  }
}
```

- `<YOUR_PROJECT_REF>` は Supabase ダッシュボード → Settings → Project ID
- Claude Code 起動後 `/mcp` → ブラウザ認証
- 本番データには接続しない（開発プロジェクト限定）
- `.mcp.json` は `.gitignore` に追加

---

## 12. 廃止・無効化するもの

| 対象 | アクション |
|------|-----------|
| `@cloudflare/next-on-pages` | 削除済み（deprecated） |
| `@opennextjs/cloudflare` | 削除（Vite 移行により不要） |
| `@vercel/og` | 削除済み（OGP 画像生成廃止） |
| Next.js 関連全般 | 削除（`next`, `eslint-config-next` 等） |
| `wrangler.toml` | 削除（Workers 不使用） |
| `open-next.config.ts` | 削除（OpenNext 不使用） |
| 旧 Cloudflare `hello-profile` プロジェクト | 削除済み |
| `hello-profile.pages.dev` ドメイン | 廃止（誰にも共有していないため移行不要） |
