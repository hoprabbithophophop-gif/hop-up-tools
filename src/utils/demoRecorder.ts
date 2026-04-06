/**
 * DemoRecorder - 自動デモ録画システム（ポップアップウィンドウ方式）
 *
 * MediaRecorder API でブラウザ内録画。
 * 使い方:
 * 1. DevTools コンソールで unlockDemo('hop-up-record-2026') を実行
 * 2. recordDemo() または recordDemo('シナリオ名') を実行
 * 3. 指定サイズのポップアップが開く
 * 4. 画面共有ダイアログで「ウィンドウ」からポップアップを選択
 * 5. シナリオが自動実行 → 完了後ファイルが自動ダウンロード
 */

export interface DemoAction {
  delay: number;
  type:
    | 'telopp'
    | 'clearTelopp'
    | 'click'
    | 'hover'
    | 'wait'
    | 'pageScroll'
    | 'type'
    | 'focus'
    | 'narration'
    | 'setLocalStorage'
    | 'paste';
  data?:
    | string
    | number
    | { selector: string }
    | { selector: string; text: string }
    | { src: string }
    | { key: string; value: string };
}

export interface DemoScenario {
  name: string;
  width: number;
  height: number;
  actions: DemoAction[];
}

class DemoRecorderService {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private isRecording = false;
  private cursorElement: HTMLDivElement | null = null;
  // DOM 操作の対象ウィンドウ（ポップアップ使用時はそちらに切り替える）
  private targetWin: Window & typeof globalThis = window as Window & typeof globalThis;

  /** DOM 操作対象のウィンドウを切り替える（ポップアップ録画時に使用） */
  setTargetWindow(win: Window & typeof globalThis): void {
    this.targetWin = win;
  }

  async startRecording(): Promise<boolean> {
    try {
      this.createVisualCursor();

      console.log('📹 画面共有ダイアログが開きます');
      console.log('👉 「ウィンドウ」タブからポップアップウィンドウを選択してください');
      console.log('🔊 音声も録音するなら「タブの音声を共有」にチェック');

      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' },
        audio: true,
      });

      this.recordedChunks = [];

      const mimeType = this.getSupportedMimeType();
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
        videoBitsPerSecond: 5_000_000,
      });

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordedChunks.push(e.data);
      };

      this.mediaRecorder.onstop = () => {
        this.saveRecording();
        this.removeVisualCursor();
      };

      this.mediaRecorder.start(100);
      this.isRecording = true;
      console.log('🎬 録画開始');
      return true;
    } catch (err) {
      console.error('録画の開始に失敗:', err);
      this.removeVisualCursor();
      return false;
    }
  }

  stopRecording(): void {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      this.stream?.getTracks().forEach((t) => t.stop());
      console.log('🛑 録画停止');
    }
  }

  async runScenario(scenario: DemoScenario): Promise<void> {
    console.log(`🎬 シナリオ "${scenario.name}" を実行`);
    for (const action of scenario.actions) {
      await this.wait(action.delay);
      await this.executeAction(action);
    }
    console.log('✅ シナリオ完了');
  }

  private async executeAction(action: DemoAction): Promise<void> {
    const win = this.targetWin;
    const doc = win.document;

    switch (action.type) {
      case 'telopp':
        if (typeof win.setTelopp === 'function' && typeof action.data === 'string') {
          win.setTelopp(action.data);
          console.log(`📝 テロップ: "${action.data}"`);
        }
        break;

      case 'clearTelopp':
        if (typeof win.clearTelopp === 'function') {
          win.clearTelopp();
          console.log('📝 テロップクリア');
        }
        break;

      case 'click': {
        if (action.data && typeof action.data === 'object' && 'selector' in action.data) {
          const el = doc.querySelector(action.data.selector) as HTMLElement | null;
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await this.wait(400);
            const rect = el.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            this.moveCursor(x, y);
            await this.wait(300);
            this.showClickEffect();
            el.click();
            console.log(`👆 クリック: ${action.data.selector}`);
          } else {
            console.warn(`⚠️ 要素が見つかりません: ${action.data.selector}`);
          }
        }
        break;
      }

      case 'hover': {
        if (action.data && typeof action.data === 'object' && 'selector' in action.data) {
          const el = doc.querySelector(action.data.selector) as HTMLElement | null;
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await this.wait(400);
            const rect = el.getBoundingClientRect();
            this.moveCursor(rect.left + rect.width / 2, rect.top + rect.height / 2);
            console.log(`👆 ホバー: ${action.data.selector}`);
          }
        }
        break;
      }

      case 'pageScroll':
        if (typeof action.data === 'number') {
          win.scrollTo({ top: action.data, behavior: 'smooth' });
          console.log(`📜 ページスクロール: ${action.data}px`);
        }
        break;

      case 'focus': {
        if (action.data && typeof action.data === 'object' && 'selector' in action.data) {
          const el = doc.querySelector(action.data.selector) as HTMLInputElement | null;
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await this.wait(400);
            const rect = el.getBoundingClientRect();
            this.moveCursor(rect.left + rect.width / 2, rect.top + rect.height / 2);
            await this.wait(200);
            this.showClickEffect();
            el.focus();
            el.click();
            console.log(`🎯 フォーカス: ${action.data.selector}`);
          }
        }
        break;
      }

      case 'type': {
        if (
          action.data &&
          typeof action.data === 'object' &&
          'selector' in action.data &&
          'text' in action.data
        ) {
          const el = doc.querySelector(action.data.selector) as HTMLInputElement | null;
          if (el) {
            el.focus();
            const nativeSetter = Object.getOwnPropertyDescriptor(
              win.HTMLInputElement.prototype,
              'value'
            )?.set;
            const text = action.data.text as string;
            for (let i = 0; i < text.length; i++) {
              const val = text.substring(0, i + 1);
              if (nativeSetter) nativeSetter.call(el, val);
              else el.value = val;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              await this.wait(80);
            }
            el.dispatchEvent(new Event('change', { bubbles: true }));
            console.log(`⌨️ 入力: "${action.data.text}"`);
          }
        }
        break;
      }

      case 'narration': {
        if (action.data && typeof action.data === 'object' && 'src' in action.data) {
          try {
            new Audio(action.data.src).play();
            console.log(`🎤 ナレーション: ${action.data.src}`);
          } catch (e) {
            console.warn(`⚠️ 音声再生エラー:`, e);
          }
        }
        break;
      }

      case 'paste': {
        if (
          action.data &&
          typeof action.data === 'object' &&
          'selector' in action.data &&
          'text' in action.data
        ) {
          const el = doc.querySelector(action.data.selector) as HTMLTextAreaElement | HTMLInputElement | null;
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await this.wait(400);
            const rect = el.getBoundingClientRect();
            this.moveCursor(rect.left + rect.width / 2, rect.top + rect.height / 2);
            await this.wait(200);
            this.showClickEffect();
            el.focus();
            el.click();
            await this.wait(300);

            const nativeSetter =
              el instanceof win.HTMLTextAreaElement
                ? Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')?.set
                : Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set;

            if (nativeSetter) nativeSetter.call(el, action.data.text as string);
            else el.value = action.data.text as string;

            el.dispatchEvent(new Event('input',  { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            console.log(`📋 ペースト: ${(action.data.text as string).slice(0, 30)}…`);
          }
        }
        break;
      }

      case 'setLocalStorage': {
        if (action.data && typeof action.data === 'object' && 'key' in action.data && 'value' in action.data) {
          const { key, value } = action.data as { key: string; value: string };
          win.localStorage.setItem(key, value);
          console.log(`💾 localStorage["${key}"] をセット`);
        }
        break;
      }

      case 'wait':
        break;
    }
  }

  private createVisualCursor(): void {
    if (this.cursorElement) return;
    const el = this.targetWin.document.createElement('div');
    el.id = 'demo-visual-cursor';
    el.style.cssText = `
      position: fixed;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: rgba(255,255,255,0.9);
      border: 2px solid rgba(0,0,0,0.25);
      box-shadow: 0 2px 8px rgba(0,0,0,0.35);
      pointer-events: none;
      z-index: 99998;
      transform: translate(-50%, -50%);
      transition: left 0.2s ease-out, top 0.2s ease-out;
      left: 50%; top: 50%;
    `;
    this.targetWin.document.body.appendChild(el);
    this.cursorElement = el;
  }

  private removeVisualCursor(): void {
    this.cursorElement?.remove();
    this.cursorElement = null;
  }

  private moveCursor(x: number, y: number): void {
    if (!this.cursorElement) return;
    this.cursorElement.style.left = `${x}px`;
    this.cursorElement.style.top = `${y}px`;
  }

  private showClickEffect(): void {
    if (!this.cursorElement) return;
    this.cursorElement.style.transform = 'translate(-50%, -50%) scale(0.7)';
    this.cursorElement.style.background = 'rgba(200,200,200,0.95)';
    setTimeout(() => {
      if (this.cursorElement) {
        this.cursorElement.style.transform = 'translate(-50%, -50%) scale(1)';
        this.cursorElement.style.background = 'rgba(255,255,255,0.9)';
      }
    }, 200);
  }

  // ダウンロードリンクはオープナー側で生成する
  private saveRecording(): void {
    if (!this.recordedChunks.length) {
      console.warn('録画データがありません');
      return;
    }
    const mimeType = this.getSupportedMimeType();
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(this.recordedChunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hop-up-tools-demo_${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log(`💾 録画を保存しました (${ext})`);
  }

  private getSupportedMimeType(): string {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return 'video/webm';
  }

  private wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  get recording(): boolean {
    return this.isRecording;
  }
}

export const demoRecorder = new DemoRecorderService();
