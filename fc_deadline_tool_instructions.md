# ハロプロFC締切リマインダー — Claude Code 開発指示書

## プロジェクト概要

UPFC の FC 情報（コンサート・イベント・グッズ・配信・SP ポイントプレゼント等）と  
e-LineUP!Mall のグッズ販売締切を **「うっかり見逃す」のを防ぐ** Web ツール。

- ユーザー登録不要
- メインの忘れ防止手段は **カレンダー登録ボタン（1 締切 = 1 ボタン）**
- `.ics` ファイル生成で iOS / Android / PC すべて対応
- ホスティング: **Cloudflare Pages**（`hop-up-tools.pages.dev`）

---

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| スクレイピング | Google Apps Script (GAS) |
| DB | Supabase（PostgreSQL） |
| フロント | 未定（軽量でOK。静的サイト or React 等） |
| ホスティング | Cloudflare Pages |
| カレンダー連携 | .ics ファイル生成（iCalendar 形式） |

### ホスティングに関する注意事項

- **Cloudflare Pages の無料プランは商用利用 OK**（AdSense 広告を貼って問題なし）
- 商用利用 NG なのは **Vercel の Hobby プラン**。混同しないこと
- **GitHub リポジトリはプライベートで OK**（Cloudflare Pages はプライベートリポジトリと連携可能）
- ソースコードを公開する必要は一切ない

### 環境変数のルール

- `.env` ファイルは **絶対に git に commit しない**（`.gitignore` 必須）
- `.env` ファイルはローカル開発用のみ。本番にアップロードしない
- 本番フロントの環境変数: **Cloudflare Pages ダッシュボード** → Settings → Environment variables で設定
- GAS の環境変数: **スクリプトプロパティ** で設定（`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`）
- Supabase 側での環境変数設定は不要

### Supabase MCP（Claude Code 連携）

Supabase 公式の MCP サーバーを使えば、Claude Code から直接 Supabase を操作できる（テーブル作成、SQL 実行、スキーマ管理等）。ダッシュボードを手動操作する必要がなくなる。

**セットアップ手順:**

1. プロジェクトルートに `.mcp.json` を作成:
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
2. `<YOUR_PROJECT_REF>` を Supabase ダッシュボード → Settings → Project ID で確認して置き換える
3. Claude Code を起動して `/mcp` を実行 → ブラウザで Supabase 認証フローが走る
4. 認証完了後、Claude Code から「テーブル作って」等の指示で操作可能

**公式ドキュメント:** https://supabase.com/docs/guides/getting-started/mcp

**セキュリティ注意:**
- 本番データには接続しない（開発プロジェクトに限定）
- read_only モードの活用を推奨（URL に `&read_only=true` を追加）
- `.mcp.json` に機密情報は含まれないが、`.gitignore` に入れておくと安全

---

## Supabase テーブル設計

### テーブル①: `fc_news`（記事本体）

```sql
CREATE TABLE fc_news (
  uid         text PRIMARY KEY,  -- UPFCの@uid
  title       text NOT NULL,
  category    text CHECK (category IN ('コンサート', 'イベント', '配信', 'グッズ', 'その他')),
  detail_url  text,
  scraped_at  timestamptz DEFAULT now()
);
```

### テーブル②: `fc_deadlines`（締切一覧）

```sql
CREATE TABLE fc_deadlines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  news_uid    text REFERENCES fc_news(uid) ON DELETE CASCADE,
  type        text CHECK (type IN (
                'apply_start', 'apply_end', 'result',
                'payment', 'sale_start', 'sale_end', 'other'
              )),
  label       text,       -- 表示用ラベル（例：「申込締切」「入金締切」）
  deadline_at timestamptz,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_fc_deadlines_deadline_at ON fc_deadlines(deadline_at);
CREATE INDEX idx_fc_deadlines_news_uid    ON fc_deadlines(news_uid);
```

### `type` の種類

| type | 用途 |
|------|------|
| apply_start | 申込開始 |
| apply_end | 申込締切 |
| result | 当落確認開始 |
| payment | 入金締切 |
| sale_start | 販売開始（グッズ・配信） |
| sale_end | 販売終了（グッズ・配信） |
| other | その他 |

### RLS / 認証

- GAS はサーバーサイドなので **service_role キー** を使用
- GAS のスクリプトプロパティに以下を設定：
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_KEY`
- フロントからの READ は anon キー + RLS で SELECT のみ許可

---

## スクレイピング仕様

### 対象①: UPFC（FC先行チケット締切情報）

- **対象 URL**: `https://www.upfc.jp/helloproject/news_list.php?@rst=all`
- **取得する情報**: 公演タイトル、申込開始日時、申込締切日時、当落確認日時、入金締切日時
- **category**: `'コンサート'` / `'イベント'` / `'配信'` 等
- **ページ構造**: 要解析（開発ステップ2で確認）
- **注意**: ログイン必須ページは対象外

### 対象②: e-LineUP!Mall（グッズ販売締切情報）

- **対象 URL**: `https://www.elineupmall.com/helloproject-fc-b/hello-project/`
- **取得する情報**: 商品名/イベント名、販売開始日時、受付締切日時、お届け予定
- **category**: `'グッズ'`
- **ページ構造（確認済み）**:
  ```
  ★2026年3月通信販売
  販売開始日：2026年3月2日（月）18:00
  受付締切日：2026年3月27日（金）23:59
  商品お届け予定：2026年5月下旬予定
  ```
- **パース方法**: 正規表現で抽出可能（パターンが綺麗）

### GAS スクリプトの処理フロー

1. 対象ページを `UrlFetchApp.fetch()` で取得
2. HTML をパースして締切情報を抽出
3. `fc_news` に記事を UPSERT
4. `fc_deadlines` に各締切を UPSERT
5. GAS のトリガーで定期実行（1日1回 or 12時間ごと）

---

## フロント仕様

### 表示形式

- **締切が近い順にタイムライン表示**（本日 → 明日 → 以降）
- 各締切に 📅 **カレンダー追加ボタン** を 1 つずつ配置
- 緊急度を色で表示：
  - 本日 = 赤
  - 明日 = 黄
  - 3日以内 = オレンジ or 緑
  - それ以降 = 通常色
- category ごとのフィルタ機能（コンサート / イベント / グッズ 等）

### カレンダー追加（.ics 生成）

- ボタン押下で `.ics` ファイルを生成・ダウンロード
- .ics に含める情報：
  - `SUMMARY`: 記事タイトル + 締切ラベル（例:「モーニング娘。コンサート 申込締切」）
  - `DTSTART` / `DTEND`: 締切日時
  - `DESCRIPTION`: detail_url へのリンク
  - `VALARM`: 締切の1日前と1時間前にリマインダー
- iOS / Android / PC（Outlook, Mac カレンダー, Google カレンダー）すべて対応

### SP ポイントプレゼント（手動登録）

- UPFC 内の SP ポイントプレゼントはログイン必須のため自動スクレイピング対象外
- ユーザーが手動で締切を登録できる UI を用意
- 登録した締切にも同様に 📅 カレンダー追加ボタンを表示
- `category='その他'`、`type='apply_end'` or `'other'` で登録

---

## MVP（最低限公開ライン）

以下が動けば v1 として公開する：

1. ✅ UPFC のスクレイピングが動いて Supabase にデータが入る（チケット申込締切が本体）
2. ✅ フロントで締切一覧がタイムライン表示される
3. ✅ 各締切に .ics ダウンロードボタンがある
4. ✅ Cloudflare Pages にデプロイされている
5. ✅ プライバシーポリシー・利用規約ページがある（AdSense 審査用）

### AdSense 審査用の法的ページ

MVP 公開と同時に AdSense 審査に出す。審査通過には以下が必要：

**プライバシーポリシー（必須）**
- Cookie の使用（Google AdSense による広告配信）
- Google アナリティクスによるアクセス解析（導入する場合）
- .ics ファイル生成時にユーザーデータを収集・保存しないこと
- 第三者への個人情報提供は行わないこと
- スクレイピングで取得した情報の取り扱いについて

**利用規約（必須）**
- 本ツールは非公式であり、UPFC / e-LineUP!Mall / Hello! Project とは無関係
- 締切情報の正確性は保証しない（スクレイピングのタイムラグ等）
- .ics ファイルによるカレンダー登録は自己責任
- 免責事項（締切を逃した場合の責任は負わない）

**お問い合わせ**
- 連絡先フォーム or メールアドレス（AdSense 審査で求められることがある）

### MVP に含めない（v2 以降）

- e-LineUP!Mall のグッズ販売締切スクレイピング
- **通知方法の選択 UI（カレンダー / メール）**: ユーザーが締切ごとにカレンダー追加 or メール通知を選べる形式。メール通知にはメールアドレス登録が必要になるため、ユーザー登録機能とセットで検討
- **Amazon アソシエイト連携**: helloproject.com/news の一般流通商品情報をスクレイピングし、Amazon 商品リンクを紐づけ。e-LineUP!Mall の FC 限定/ハロショ限定グッズは Amazon に存在しないため対象外
- SP ポイントプレゼントの手動登録 UI
- category フィルタ
- ユーザーアカウント機能

### 収益化方針

MVP 公開と同時に AdSense 審査に出す（審査に時間がかかるため早めに申請）。  
広告表示自体はトラフィックが安定してから本格運用。  
収益手段は以下の順で段階的に検討：

1. **AdSense**（MVP 公開時に審査申請、承認後に広告掲載）
2. **Amazon アソシエイト**（helloproject.com/news 連携とセット、v2 以降）
3. **メール通知等の有料機能**（ユーザー数が十分になってから）

---

## 開発順序

1. **Supabase セットアップ**: テーブル作成、RLS ポリシー設定
2. **UPFC のページ構造確認**: スクレイピング対象 URL を特定し、HTML 構造を解析
3. **GAS スクレイパー（UPFC）**: スクリプトプロパティ設定 → スクレイピング → Supabase INSERT
4. **フロント**: Supabase から READ → タイムライン表示 → .ics 生成
5. **Cloudflare Pages デプロイ**
6. **動作確認・公開**
7. **(v2) GAS スクレイパー（e-LineUP!Mall）追加**: パターンは確認済み、正規表現で抽出可能

---

## 未確認事項（開発開始前に埋める）

- [x] UPFC のスクレイピング対象 URL → `https://www.upfc.jp/helloproject/news_list.php?@rst=all`
- [x] e-LineUP!Mall のスクレイピング対象 URL → `https://www.elineupmall.com/helloproject-fc-b/hello-project/`
- [ ] Supabase プロジェクト URL
- [ ] ドメイン名（Cloudflare Pages）→ `hop-up-tools.pages.dev` に決定。hello-profile.pages.dev は廃止予定（誰にも共有していないため）。hop-up-tools を統合ポータルとして一本化し、プロフ帳メーカーは v2 で `/profile` 等のパスに移行
- [ ] フロントのフレームワーク選定

---

## 開発ワークフロー: Claude Code リモートコントロール

外出先からでも開発を止めない。Claude Code のリモートコントロール機能を活用する。

### 概要

- 自宅 PC で Claude Code セッションを起動 → QR コード / URL が発行される → スマホで接続
- Claude Code 自体は自宅 PC で実行され、スマホは表示と入力の中継
- ファイル編集の承認、コマンド実行の許可もスマホから操作可能

**必要要件:**
- プラン: Pro / Max / Team / Enterprise（API キーは非対応）
- バージョン: Claude Code v2.1.51 以上（`claude --version` で確認）

### 基本フロー

```bash
# 1. tmux でセッションを作る（PC スリープ/ターミナル閉じ対策）
tmux new -s fc-dev

# 2. プロジェクトフォルダに移動
cd /path/to/fc-deadline-tool

# 3. リモートコントロール起動
claude remote-control
```

→ QR コードが表示される（スペースキーで表示切り替え）。**スマホの Claude app（iOS/Android）でスキャン** or ブラウザで `claude.ai/code` から接続して外出。

セッション内から起動する場合:
```
/remote-control fc-dev
```

### 帰宅後

```bash
# tmux セッションに戻る
tmux attach -t fc-dev
```

### 注意点

- 自宅 PC の電源は入れっぱなし（スリープ禁止）
- tmux or screen を必ず使う（ターミナルが切れてもセッション維持）
- Wi-Fi が切れると再接続が必要になることがある
