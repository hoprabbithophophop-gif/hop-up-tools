# hop-up-tools 引継ぎ資料

## プロジェクト概要

複数のWebツールをひとつのリポジトリにまとめて管理・デプロイするモノレポ構成。

```
hop-up-tools/          ← GitHubリポジトリ & Cloudflareプロジェクト名
├── hello-profile/     ← ツールその1（これから移植）
├── other-tool/        ← ツールその2以降
└── README.md
```

---

## 完了済みの作業

### Cloudflare
- `hello-profile` プロジェクトを削除済み
- `hop-up-tools` という名前で新しいプロジェクトを作成済み
  - GitHub連携：`hoprabbithophophop-gif/hop-up-tools` リポジトリと接続済み

### GitHub
- `hoprabbithophophop-gif/hop-up-tools` リポジトリを新規作成済み（README.mdのみ）

---

## 現状・残課題

### ビルドエラーについて
Cloudflare側でビルドが失敗しているが、これは**リポジトリにコードがまだないため**（README.mdのみ）。
現在の設定では `npx wrangler deploy` がデプロイコマンドになっているが、**ツールの内容に合わせて変更が必要**。

### 次にやること
1. `hello-profile` のコードを `hop-up-tools` リポジトリの `hello-profile/` ディレクトリに移植
2. プロジェクトの構成に合わせてビルドコマンド・デプロイコマンドを設定
   - 静的サイトなら：ビルドコマンドは各ツールに合わせて設定、デプロイコマンドは不要（Pagesの場合）
   - Workerなら：`wrangler.toml` を追加して `npx wrangler deploy` のまま

---

## アカウント情報

| 項目 | 値 |
|------|-----|
| Cloudflareアカウント | Hop.rabbit.hophophop@gmail.com |
| CloudflareアカウントID | `18bc496e1954d5930158593c0cdec70d` |
| GitHubアカウント | `hoprabbithophophop-gif` |
| GitHubリポジトリ | `hoprabbithophophop-gif/hop-up-tools` |
| Cloudflareプロジェクト名 | `hop-up-tools` |

---

## 参考リンク

- Cloudflare Workers & Pages: https://dash.cloudflare.com/18bc496e1954d5930158593c0cdec70d/workers-and-pages
- GitHubリポジトリ: https://github.com/hoprabbithophophop-gif/hop-up-tools
