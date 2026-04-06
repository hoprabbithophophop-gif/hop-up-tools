/**
 * デモシナリオ定義
 *
 * 全シナリオの開始地点: トップページ (/)
 * unlockDemo('hop-up-record-2026') → recordDemo('シナリオ名') の順で実行
 */

import type { DemoScenario } from './demoRecorder';

/**
 * YouTube チェック デモ（横型 1280x720 / YouTube・X用）
 *
 * ストーリー:
 * 1. トップページ → YouTube チェックへ遷移
 * 2. "サブスク解禁されたことだし…" で共感を掴む
 * 3. 検索ボックスに「胸に響く歌詞発表会」を入力
 * 4. ハロ！ステの該当回が一覧で出てくる
 * 5. 動画カードをクリック → モーダル表示
 * 6. Share パネルを開く
 */
export const youtubeDemoScenario: DemoScenario = {
  name: 'YouTube チェック デモ',
  width: 1280,
  height: 720,
  actions: [
    // === Act 1: トップページ — 共感テロップ ===
    { delay: 1500, type: 'telopp', data: 'サブスク解禁されたことだし…' },
    { delay: 2500, type: 'telopp', data: 'ハロ！ステの胸に響いた歌詞発表会を見返したい' },
    { delay: 2500, type: 'telopp', data: 'けど、どの回に収録されてたっけ？' },
    { delay: 2500, type: 'telopp', data: 'そんな時にこのツール！' },
    { delay: 2000, type: 'click',  data: { selector: 'a[href="/youtube"]' } },

    // === Act 2: 検索 ===
    { delay: 1500, type: 'clearTelopp' },
    { delay: 500,  type: 'telopp', data: '検索ワードにチャプタータイトルを入力すれば…' },
    { delay: 1000, type: 'focus',  data: { selector: '[data-demo-id="search-input"]' } },
    { delay: 500,  type: 'type',   data: { selector: '[data-demo-id="search-input"]', text: '胸に響いた歌詞発表会' } },

    // === Act 3: 検索結果を見せる (デバウンス500ms + 通信待ち) ===
    { delay: 2000, type: 'clearTelopp' },
    { delay: 300,  type: 'pageScroll', data: 500 },
    { delay: 800,  type: 'telopp', data: '収録されている回が一覧で出てくる！' },
    { delay: 2500, type: 'clearTelopp' },

    // === Act 4: 動画を開く ===
    { delay: 500,  type: 'telopp', data: '気になった回をクリック' },
    { delay: 1500, type: 'click',  data: { selector: '[data-demo-id="result-card"]' } },

    // === Act 5: チャプターリストで確認 ===
    { delay: 1500, type: 'clearTelopp' },
    { delay: 500,  type: 'telopp', data: 'チャプターリストを確認' },
    { delay: 1000, type: 'hover',  data: { selector: '[data-demo-id="chapter-gyoshi"]' } },
    { delay: 1500, type: 'telopp', data: '「胸に響いた歌詞発表会」がある！' },
    { delay: 2000, type: 'telopp', data: 'タイトルをタップすればその場面から再生できる' },
    { delay: 2500, type: 'clearTelopp' },

    // === Act 6: チャプター時間指定シェア ===
    { delay: 500,  type: 'telopp', data: 'シェア時にチャプターで時間指定もできる' },
    { delay: 1000, type: 'click',  data: { selector: '[data-demo-id="share-btn"]' } },
    { delay: 1000, type: 'click',  data: { selector: '[data-demo-id="chapter-gyoshi-btn"]' } },
    { delay: 800,  type: 'telopp', data: '再生時間つき URL をそのままポスト' },
    { delay: 1000, type: 'hover',  data: { selector: '[data-demo-id="share-copy-btn"]' } },
    { delay: 2500, type: 'clearTelopp' },

    // === 締め ===
    { delay: 1000, type: 'wait' },
  ],
};

/**
 * YouTube チェック デモ（縦型 412x915 / TikTok用・短縮版）
 */
export const youtubeTikTokScenario: DemoScenario = {
  name: 'YouTube チェック デモ (TikTok)',
  width: 412,
  height: 915,
  actions: [
    // トップ → YouTube
    { delay: 1000, type: 'telopp', data: 'ハロプロ動画をまとめてチェック' },
    { delay: 2000, type: 'click',  data: { selector: 'a[href="/youtube"]' } },

    // グループフィルター
    { delay: 2000, type: 'clearTelopp' },
    { delay: 500,  type: 'click',  data: { selector: '[data-demo-id="filter-tab-group"]' } },
    { delay: 800,  type: 'telopp', data: 'グループで絞り込める' },
    { delay: 1000, type: 'click',  data: { selector: '[data-demo-id="filter-chip-beyooooonds"]' } },
    { delay: 500,  type: 'click',  data: { selector: '[data-demo-id="filter-tab-group"]' } },
    { delay: 500,  type: 'clearTelopp' },

    // 動画を開く
    { delay: 2000, type: 'telopp', data: '動画をタップ' },
    { delay: 1000, type: 'click',  data: { selector: '[data-demo-id="pick-card"]' } },
    { delay: 1500, type: 'clearTelopp' },

    // Share
    { delay: 500,  type: 'telopp', data: 'シェアもかんたん' },
    { delay: 1200, type: 'click',  data: { selector: '[data-demo-id="share-btn"]' } },
    { delay: 2500, type: 'clearTelopp' },

    // 締め
    { delay: 800,  type: 'wait' },
  ],
};

// ─── サンプルテキスト（FCデモ用） ───────────────────────────
// UpfcDummyPreview のダミーフォーマットに準じたサンプル
// ユーザー提供の形式: ステータス行 → タイトル行 → (入金完了日行)
const FC_DEMO_TEXT = `抽選前
モーニング娘。'26 岡村ほまれバースデーイベント
入金待ち
Juice=Juice Concert 2026 UP TO 11 MORE！ MORE！`;

/**
 * FC 締切リマインダー デモ（横型 1280x720 / YouTube・X用）
 *
 * ストーリー:
 * 1. 「当選したのに入金期限を忘れた…」で共感を掴む
 * 2. テキストエリアにUPFCテキストが入っている状態を見せる
 * 3. 「締切を確認」→ Result 画面で Action Required が並ぶ
 * 4. 「カレンダーに追加」→ Google / Yahoo / Apple 選択肢
 * 5. 締め
 *
 * ※ setLocalStorage アクションで localStorage に事前データを仕込み、
 *   ページ遷移時に FcTicketPage が自動的にテキストエリアを復元する
 */
export const fcTicketDemoScenario: DemoScenario = {
  name: 'FC 締切リマインダー デモ',
  width: 1280,
  height: 720,
  actions: [
    // === Act 0: テキスト入力欄を空にしてからスタート ===
    { delay: 0, type: 'setLocalStorage', data: { key: 'fc-input-text', value: '' } },

    // === Act 1: トップページ (5s) ===
    { delay: 1500, type: 'telopp', data: '当選したのに入金期限を忘れた…' },
    { delay: 3000, type: 'telopp', data: 'そんな経験、ありませんか？' },
    { delay: 2500, type: 'click',  data: { selector: 'a[href="/fc-ticket"]' } },

    // === Act 2: Input 画面 — ヘルプモーダルでコピー範囲を提示 ===
    { delay: 2000, type: 'clearTelopp' },
    { delay: 500,  type: 'telopp', data: '公式ファンクラブのマイページを開いて' },
    { delay: 1500, type: 'click',  data: { selector: '[data-demo-id="help-btn"]' } },
    { delay: 800,  type: 'telopp', data: 'この範囲をすべてコピー' },
    { delay: 500,  type: 'hover',  data: { selector: '[data-demo-id="upfc-preview"]' } },
    { delay: 2000, type: 'click',  data: { selector: '[data-demo-id="help-close-btn"]' } },
    { delay: 500,  type: 'clearTelopp' },

    // === Act 3: コピペを演出 ===
    { delay: 300,  type: 'telopp', data: '公式ファンクラブのマイページからコピーして' },
    { delay: 1500, type: 'paste',  data: { selector: '[data-demo-id="upfc-textarea"]', text: FC_DEMO_TEXT } },
    { delay: 1000, type: 'telopp', data: 'ペーストするだけ' },
    { delay: 1500, type: 'clearTelopp' },
    { delay: 500,  type: 'click',  data: { selector: '[data-demo-id="analyze-btn"]' } },

    // === Act 4: Result 画面 (10s) ===
    { delay: 1500, type: 'telopp', data: 'Action Required が目に飛び込む' },
    { delay: 3000, type: 'clearTelopp' },
    { delay: 500,  type: 'telopp', data: '入金期限はいつ？一目でわかる' },
    { delay: 3000, type: 'clearTelopp' },

    // === Act 5: カレンダーに追加 (8s) ===
    { delay: 500,  type: 'telopp', data: 'カレンダーへワンクリックで登録' },
    { delay: 1500, type: 'click',  data: { selector: '[data-demo-id="add-calendar-btn"]' } },
    { delay: 1000, type: 'clearTelopp' },
    { delay: 300,  type: 'telopp', data: 'Google / Yahoo / Apple で選べる' },
    { delay: 800,  type: 'hover',  data: { selector: '[data-demo-id="google-cal-btn"]' } },
    { delay: 2500, type: 'clearTelopp' },

    // === 締め ===
    { delay: 1000, type: 'telopp', data: '締切を見逃さない' },
    { delay: 2500, type: 'clearTelopp' },
    { delay: 500,  type: 'wait' },

    // デモ用テキストを後片付け
    { delay: 0, type: 'setLocalStorage', data: { key: 'fc-input-text', value: '' } },
  ],
};

/**
 * FC 締切リマインダー デモ（縦型 412x915 / TikTok用・短縮版）
 */
export const fcTicketMobileScenario: DemoScenario = {
  name: 'FC 締切リマインダー デモ (Mobile)',
  width: 412,
  height: 915,
  actions: [
    // === Act 0: テキスト入力欄を空にしてからスタート ===
    { delay: 0, type: 'setLocalStorage', data: { key: 'fc-input-text', value: '' } },

    // === Act 1: トップページ ===
    { delay: 1500, type: 'telopp', data: '当選したのに入金期限を忘れた…' },
    { delay: 3000, type: 'telopp', data: 'そんな経験ありませんか？' },
    { delay: 2000, type: 'click',  data: { selector: 'a[href="/fc-ticket"]' } },

    // === Act 2: ヘルプモーダルでコピー範囲を提示 ===
    { delay: 2000, type: 'clearTelopp' },
    { delay: 500,  type: 'telopp', data: '公式ファンクラブのマイページを開いて' },
    { delay: 1500, type: 'click',  data: { selector: '[data-demo-id="help-btn"]' } },
    { delay: 800,  type: 'telopp', data: 'この範囲をすべてコピー' },
    { delay: 500,  type: 'hover',  data: { selector: '[data-demo-id="upfc-preview"]' } },
    { delay: 2000, type: 'click',  data: { selector: '[data-demo-id="help-close-btn"]' } },
    { delay: 500,  type: 'clearTelopp' },

    // === Act 3: コピペ ===
    { delay: 300,  type: 'telopp', data: 'マイページからコピーして' },
    { delay: 1500, type: 'paste',  data: { selector: '[data-demo-id="upfc-textarea"]', text: FC_DEMO_TEXT } },
    { delay: 1000, type: 'telopp', data: 'ペーストするだけ' },
    { delay: 1500, type: 'clearTelopp' },
    { delay: 500,  type: 'click',  data: { selector: '[data-demo-id="analyze-btn"]' } },

    // === Act 4: Result 画面 ===
    { delay: 1500, type: 'telopp', data: 'Action Required が目に飛び込む' },
    { delay: 3000, type: 'clearTelopp' },
    { delay: 500,  type: 'telopp', data: '入金期限が一目でわかる' },
    { delay: 2500, type: 'clearTelopp' },

    // === Act 5: カレンダーに追加 ===
    { delay: 500,  type: 'telopp', data: 'カレンダーへワンタップで登録' },
    { delay: 1500, type: 'click',  data: { selector: '[data-demo-id="add-calendar-btn"]' } },
    { delay: 800,  type: 'clearTelopp' },
    { delay: 300,  type: 'telopp', data: 'Google / Yahoo / Apple で選べる' },
    { delay: 800,  type: 'hover',  data: { selector: '[data-demo-id="google-cal-btn"]' } },
    { delay: 2500, type: 'clearTelopp' },

    // === 締め ===
    { delay: 500,  type: 'wait' },

    // デモ用テキストを後片付け
    { delay: 0, type: 'setLocalStorage', data: { key: 'fc-input-text', value: '' } },
  ],
};

/**
 * FC 気になる公演 → カレンダー登録 デモ（横型 1280x720）
 *
 * ストーリー:
 * ①「横アリのホテルプランっていつ締切だっけ？」
 * ②「まだ予定が調整できてないから…」
 * ③「申込締切、カレンダーに登録しなきゃ」
 * ④ 気になる公演セクションへ → BEYOOOOONDSで絞り込む
 * ⑤ 気になるに追加ボタンをタップ
 * ⑥ カレンダーに予定の追加が簡単！
 */
export const fcTicketWatchlistScenario: DemoScenario = {
  name: 'FC 気になる公演 → カレンダー登録 デモ',
  width: 1280,
  height: 720,
  actions: [
    // デモ前に watchlist をクリア（ホテルプランが未登録の状態から始める）
    { delay: 0, type: 'setLocalStorage', data: { key: 'fc-watchlist', value: '[]' } },
    { delay: 0, type: 'setLocalStorage', data: { key: 'fc-applied',   value: '[]' } },
    { delay: 0, type: 'setLocalStorage', data: { key: 'fc-paid',      value: '[]' } },

    // === Act 1: トップページ — 共感テロップ ===
    { delay: 1500, type: 'telopp', data: '横アリのホテルプランっていつ締切だっけ？' },
    { delay: 3000, type: 'telopp', data: 'まだ予定が調整できてないから…' },
    { delay: 2500, type: 'click',  data: { selector: 'a[href="/fc-ticket"]' } },

    // === Act 2: カレンダータブへ ===
    { delay: 1500, type: 'clearTelopp' },
    { delay: 500,  type: 'telopp', data: '「気になる公演」から探せる' },
    { delay: 1500, type: 'click',  data: { selector: '[data-demo-id="nav-calendar"]' } },

    // === Act 3: 気になる公演セクション → BEYOOOOONDSで絞り込む ===
    { delay: 1500, type: 'clearTelopp' },
    { delay: 300,  type: 'pageScroll', data: 900 },
    { delay: 800,  type: 'click',  data: { selector: '[data-demo-id="watchlist-filter-beyooooonds"]' } },
    { delay: 800,  type: 'telopp', data: 'BEYOOOOONDSで絞り込むと…' },
    { delay: 2000, type: 'clearTelopp' },

    // === Act 5: 気になるに追加 ===
    { delay: 500,  type: 'telopp', data: 'ホテルプランが見つかった！気になるに追加' },
    { delay: 1500, type: 'click',  data: { selector: '[data-demo-id="watchlist-beyo-hotel-add-btn"]' } },
    { delay: 1000, type: 'clearTelopp' },

    // === Act 6: カレンダー登録プロンプト ===
    { delay: 300,  type: 'telopp', data: '申込締切、カレンダーに登録！' },
    { delay: 2000, type: 'clearTelopp' },
    { delay: 300,  type: 'telopp', data: 'Google / Yahoo / Apple — 好きなカレンダーに追加できる' },
    { delay: 1000, type: 'hover',  data: { selector: '[data-demo-id="watchlist-google-cal-btn"]' } },
    { delay: 2500, type: 'clearTelopp' },

    // === 締め ===
    { delay: 500,  type: 'telopp', data: '締切を見逃さない' },
    { delay: 2500, type: 'clearTelopp' },
    { delay: 500,  type: 'wait' },

    // 後片付け
    { delay: 0, type: 'setLocalStorage', data: { key: 'fc-watchlist', value: '[]' } },
  ],
};

export const demoScenarios = {
  youtubeDemo:          youtubeDemoScenario,
  youtubeTikTok:        youtubeTikTokScenario,
  fcTicketDemo:         fcTicketDemoScenario,
  fcTicketMobile:       fcTicketMobileScenario,
  fcTicketWatchlist:    fcTicketWatchlistScenario,
};

export default demoScenarios;
