# ハロプロ プロフィール帳メーカー

## プロジェクト概要
ハロプロファン向けプロフィールカード作成ツール。ブラウザ上でプロフィールを入力し、2種類のテンプレート（推し脳マップ / プロフィール帳）でプレビュー、OGP画像としてXでシェアできる。

## 技術スタック
- Next.js (App Router) + TypeScript + Tailwind CSS
- ホスティング: Cloudflare Pages
- データ保存: localStorage（サーバーにユーザーデータを送らない）
- OGP画像生成: @vercel/og または satori（将来実装）

## 実装済みファイル構成
```
src/
  types/profile.ts              - 型定義（OshiMember, FreeItem, ProfileData 等）
  data/groups.ts                - HELLO_GROUPS（グループ名・カラー）
  data/members.ts               - ALL_MEMBERS, PRESET_COLORS, FREE_SUGGESTIONS
  lib/colorUtils.ts             - isLight / darken / dc / parseRanked
  components/profile/
    BrainPreview.tsx            - 推し脳マップSVGワードクラウド
    ColorPicker.tsx             - カラーピッカー
    MemberSelector.tsx          - メンバー検索・選択
    TemplateA.tsx               - テンプレートA（推し脳マップ）
    TemplateB.tsx               - テンプレートB（プロフィール帳）
  app/
    page.tsx                    - /profile へリダイレクト
    profile/page.tsx            - メイン（HelloProfileMaker, "use client"）
    layout.tsx                  - Zen Maru Gothic 読み込み、日本語メタデータ
```

プロトタイプ `hello-profile-v6.jsx` はリポジトリルートに残置（参照用）。

## グループカラー（公式サイトのアーティストページ背景色から取得）
- モーニング娘。'26: #E5457D
- アンジュルム: #FF85AD
- Juice=Juice: #FF9900
- つばきファクトリー: #787FDC
- BEYOOOOONDS: #ba3cb8
- OCHA NORMA: #41b06c
- ロージークロニクル: #bf3b3b
- ハロプロ研修生: #33D6AD

## メンバーカラー
BEYOOOOONDSは正確。他グループは要修正（BEYOFANのメンバーカラー一覧を参照）。

## デザイン方針
- ハロヲタは年齢層高めなのでフォントサイズ最低14px（0.875rem）
- 入力フォーム: 全要素14px以上
- テンプレートカード: 主要テキスト14px以上、補助ラベルは12px以上
- 推し脳マップ: 200%設定時は最大120px（通常の2倍）、長い名前は2行折り返し
- テンプレートのレイアウト: 固定項目3割、自由項目7割
- メンバーカラーが明るい色（黄色等）の場合は暗めの縁取りで可読性確保

## BrainPreviewの仕様（重要）
- 配置判定: 中心点が楕円内にあるかのみチェック（4隅チェックは廃止）
  → 廃止理由: 大きいフォントの文字幅が楕円径を超えると4隅チェックが永遠に通らず2位以降が消える
- フォントサイズ: 通常max60px, percent>100のメンバーはmax120px
- 長い名前（楕円幅75%超）は自動2行折り返し（`<tspan>`）
- ランダム配置1500回試行 → 失敗時グリッドスキャンフォールバック（必ず配置）

## テンプレート
1. 推し脳マップ (TemplateA) - 左に脳シルエット＋ワードクラウド、右にプロフィール
2. プロフィール帳 (TemplateB) - 「こんにちは！わたしは〇〇っていいます」の語りかけ形式
   - ヘッダー高さ: `minHeight: "28%"` で固定高さをやめてコンテンツに合わせる
   - 挨拶文は選択式＋自由入力に変更予定

## 入力フロー
- メンバー追加: フルネーム検索→選択→呼び名入力→確定ボタン→次のメンバー追加可能
- 自由項目: 候補から選択 or オリジナル作成、TOP3系は自動で順位入力欄、確定ボタン付き
- ニックネーム検索対応（BEYOOOOONDS分は実装済み、他グループ追加必要）

## 法的注意
- 「脳内メーカー」は使わない（商標リスク）→「推し脳マップ」
- 公式の文章・画像は転載しない
- メンバーカラー等の事実データのみ使用
- 公式へのリンク必須

## 今後の実装予定（優先度順）
- [ ] Playwright MCP でブラウザ目視確認（設定方法: ~/.claude/settings.json に追加）
- [ ] メンカラ全グループ正確に修正（BEYOFANのメンカラ一覧参照）
- [ ] プロフィール帳の挨拶文パターン（選択式＋自由入力）
- [ ] OGP画像生成（@vercel/og または satori）
- [ ] AdSense設置
- [ ] 独自ドメイン取得・設定
- [ ] Cloudflare Pages デプロイ設定
