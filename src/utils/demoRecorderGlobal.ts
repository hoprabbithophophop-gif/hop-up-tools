/**
 * デモ録画のグローバル関数を登録（ポップアップウィンドウ方式）
 *
 * 使い方:
 * 1. DevTools コンソールで:
 *      unlockDemo('hop-up-record-2026')
 *      recordDemo()                  // youtubeDemo（デフォルト）
 *      recordDemo('fcTicketMobile')  // スマホ版
 * 2. 指定サイズのポップアップが自動で開く
 * 3. 画面共有ダイアログで「ウィンドウ」からポップアップを選択
 * 4. シナリオが自動実行 → 完了後ファイルが自動ダウンロード
 */

import { demoRecorder } from './demoRecorder';
import { demoScenarios } from './demoScenarios';

const DEMO_SECRET_KEY = 'hop-up-record-2026';

declare global {
  interface Window {
    unlockDemo: (key: string) => void;
    recordDemo?: (scenarioName?: string) => Promise<void>;
  }
}

async function recordDemo(scenarioName: string = 'youtubeDemo'): Promise<void> {
  const scenario = demoScenarios[scenarioName as keyof typeof demoScenarios];

  if (!scenario) {
    console.error(`シナリオが見つかりません: ${scenarioName}`);
    console.log('利用可能なシナリオ:', Object.keys(demoScenarios).join(', '));
    return;
  }

  console.log(`🎬 シナリオ "${scenario.name}" を開始します`);

  // 正しいサイズのポップアップウィンドウを開く
  const features = [
    `width=${scenario.width}`,
    `height=${scenario.height}`,
    'left=100',
    'top=100',
    'toolbar=0',
    'location=0',
    'menubar=0',
    'scrollbars=0',
    'status=0',
  ].join(',');

  const popup = window.open('/', 'hop-up-demo', features) as (Window & typeof globalThis) | null;
  if (!popup) {
    console.error('❌ ポップアップがブロックされました。アドレスバーのポップアップ許可ボタンを押してください。');
    return;
  }

  console.log(`📐 ポップアップを ${scenario.width} x ${scenario.height} で開きました。読み込みを待機中...`);

  // ポップアップの読み込みを待機（React 初期化含む）
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      try {
        if (popup.document.readyState === 'complete') {
          clearInterval(check);
          setTimeout(resolve, 2000); // React 初期化の追加待機
        }
      } catch {
        // クロスオリジンエラーは無視
      }
    }, 100);
    setTimeout(() => { clearInterval(check); resolve(); }, 10000); // フォールバック
  });

  console.log('✅ ポップアップ読み込み完了');

  // DOM 操作対象をポップアップに切り替え
  demoRecorder.setTargetWindow(popup);

  // 録画開始（オープナー側で getDisplayMedia → ユーザーがポップアップを選択）
  const started = await demoRecorder.startRecording();
  if (!started) {
    console.error('❌ 録画開始に失敗しました');
    demoRecorder.setTargetWindow(window as Window & typeof globalThis);
    return;
  }

  await new Promise((r) => setTimeout(r, 1000));

  // ポップアップ内でシナリオを実行
  await demoRecorder.runScenario(scenario);

  demoRecorder.stopRecording();

  // DOM 操作対象をオープナーに戻す
  demoRecorder.setTargetWindow(window as Window & typeof globalThis);
}

function unlockDemo(key: string): void {
  if (key === DEMO_SECRET_KEY) {
    window.recordDemo = recordDemo;
    console.log('✅ recordDemo がアンロックされました！');
    console.log('📝 利用可能なシナリオ:', Object.keys(demoScenarios).join(', '));
    console.log('▶️  使い方: recordDemo() または recordDemo("fcTicketMobile")');
  }
}

if (typeof window !== 'undefined') {
  window.unlockDemo = unlockDemo;
}

export { recordDemo, unlockDemo };
