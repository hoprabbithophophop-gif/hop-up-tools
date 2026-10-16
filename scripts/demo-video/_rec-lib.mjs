// クロスワードの使い方の動画を撮る台本で共通に使う物。
// 390×844 の画面を Playwright の録画で撮り、押した所に丸を出す（指の代わり）。字幕や声は入れない。
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const VIEW = { width: 390, height: 844 };

// 押した所に出す丸。画面の一番上に重ね、押せない（下の画面の操作を邪魔しない）
const tapMarker = () => {
  const add = () => {
    document.addEventListener(
      'pointerdown',
      (e) => {
        const d = document.createElement('div');
        d.style.cssText = `position:fixed;left:${e.clientX - 22}px;top:${e.clientY - 22}px;width:44px;height:44px;border-radius:50%;background:rgba(0,0,0,0.25);border:2px solid rgba(0,0,0,0.55);pointer-events:none;z-index:2147483647;transition:opacity .5s, transform .5s;`;
        document.body.appendChild(d);
        requestAnimationFrame(() => {
          d.style.opacity = '0';
          d.style.transform = 'scale(1.4)';
        });
        setTimeout(() => d.remove(), 600);
      },
      true,
    );
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
  else add();
};

export async function openRecorder(dir, { headless = true } = {}) {
  mkdirSync(dir, { recursive: true });
  // 手元の Chrome を使う（Playwright の Chromium だと YouTube のプレイヤーが黒い四角のまま映る）
  const browser = await chromium.launch({ headless, channel: 'chrome' });
  const ctx = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: 2,
    hasTouch: false,
    locale: 'ja-JP',
    recordVideo: { dir, size: VIEW }, // 録画は画面と同じ大きさ。2倍への拡大は mp4 に書き出す時に行う
  });
  await ctx.addInitScript(tapMarker);
  // 公式の画像を動画に写さない（CLAUDE.md の法的注意「公式の文章・画像は転載しない」）。
  // YouTube の見本画像とプレイヤーは、録画の時だけ一面の薄い灰色に塗る。題名の文字はそのまま
  await ctx.addInitScript(() => {
    const css = 'img[src*="ytimg.com"], iframe[src*="youtube"] { filter: brightness(0) invert(0.88) !important; }';
    const put = () => {
      const s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
    };
    if (document.head) put();
    else document.addEventListener('DOMContentLoaded', put);
  });
  const page = await ctx.newPage();
  // 場面の区切りの時刻（録画の始まりからの秒）。テロップを出す時刻に使う
  const t0 = Date.now();
  const steps = [];
  const mark = (key) => steps.push({ key, t: (Date.now() - t0) / 1000 });
  return { browser, ctx, page, steps, mark };
}

// 録画を閉じて webm を名前つきで置く
export async function closeRecorder({ browser, ctx, page, steps, mark }, dir, name) {
  mark('end');
  writeFileSync(path.join(dir, `${name}.steps.json`), JSON.stringify(steps, null, 1));
  const v = page.video();
  await ctx.close();
  await browser.close();
  const src = v ? await v.path() : null;
  const dst = path.join(dir, `${name}.webm`);
  if (src) renameSync(src, dst);
  return dst;
}

export const wait = (page, ms) => page.waitForTimeout(ms);

// 見えるようにゆっくり画面を動かす（要素を画面のまん中あたりへ）
export async function scrollTo(page, locator, block = 'center') {
  await locator.evaluate((el, b) => el.scrollIntoView({ behavior: 'smooth', block: b }), block);
  await page.waitForTimeout(700);
}

// 人が打つくらいの速さで字を入れる
export async function typeSlow(page, locator, text, delay = 110) {
  await scrollTo(page, locator);
  await locator.click();
  await locator.pressSequentially(text, { delay });
  await page.waitForTimeout(300);
}

export async function tap(page, locator, after = 500) {
  await scrollTo(page, locator);
  await locator.click();
  await page.waitForTimeout(after);
}

export { readdirSync };
