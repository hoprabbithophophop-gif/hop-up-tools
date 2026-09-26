// 原石の版（/hai-to-diamond/stone【仮】）を、3つの画面の大きさで場面ごとに撮って確かめる台本。
//
// 使い方: `node scripts/verify/hai-to-diamond/shoot-stone-scenes.mjs [住所]`
//   住所を省略すると、手元の開発サーバー（この台本が 5199 番で自分で立てて自分で止める）を見る。
//   手元の開発サーバーはいつも記録を送らない。外の住所を渡した時は必ず ?qa=1 を付ける（送信止め）。
// 写真の置き場: 環境変数 VERIFY_OUT があればそこ、無ければ端末の一時置き場 hai-to-diamond-verify/stone-scenes/。
//
// 見る物:
//  - 3つの画面: スマホ縦（390×844）・スマホ横（844×390）・PC（1280×800）
//  - 入口 → 再生（YouTube の操作の口から始める）→ 各区切りの終わりの少し手前へ飛んで撮る → 完成の瞬間 → 降り注ぎ → 山
//  - 機械で見られる事: 動画の上に DOM の要素が重なっていないか／色えらびが画面の中に収まっているか／
//    ページのつまずき（pageerror）が無いか／canvas が動画の裏（重ね順）にあるか
//  - 絵の中身（原石の形・削れ方・山が見切れていないか・文字のはみ出し）は写真を人（作り手）が見る
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = path.join(process.env.VERIFY_OUT || path.join(os.tmpdir(), 'hai-to-diamond-verify'), 'stone-scenes');
mkdirSync(OUT, { recursive: true });
const PORT = 5199;
const argBase = process.argv[2] ? process.argv[2].replace(/\/+$/, '') : null;
const BASE = argBase ?? `http://localhost:${PORT}`;
const PATH = '/hai-to-diamond/stone';

/** 住所の組み立ては必ずここを通す。確かめ用の送信止め ?qa=1 を1か所で付ける */
function url() {
  const u = new URL(BASE + PATH);
  u.searchParams.set('qa', '1');
  return u.toString();
}

/** 撮る場面。時刻は区切りの終わりの 1.5 秒手前（区切りの終わりの景色）。完成・降り注ぎは別に */
const SCENES = [
  // 頭サビは、飛んでから撮るまでの約1.6秒を見込んで 27.3 秒へ飛ぶ＝撮る時に透けの山（28.9秒付近）に当たる
  ['01-intro', 25.5], ['02-head-chorus', 27.3], ['03-prelude', 54.5], ['04-verse-a', 84.5], ['05-verse-b', 100.5],
  ['06-chorus', 130.5], ['07-interlude', 145.5], ['08-verse-a2', 160.5], ['09-verse-b2', 176.5],
  ['10-rap', 191.5], ['11-epiano', 206.5], ['12-complete', 213.5], ['13-final-chorus', 240], ['14-outro', 268.5],
  ['15-rain', 273], ['16-pile', 279],
];
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
/** 撮る画面。SE（375×667）は一番狭い端末として縦横とも入れる。
 *  reduceMotion=true の枠は、端末の覚え書きに「動きを減らす」を入れて開き、3場面だけ撮る */
const SCREENS = [
  ['phone-portrait', { viewport: { width: 390, height: 844 }, hasTouch: true, userAgent: IPHONE_UA, isMobile: true }],
  ['phone-landscape', { viewport: { width: 844, height: 390 }, hasTouch: true, userAgent: IPHONE_UA, isMobile: true }],
  ['se-portrait', { viewport: { width: 375, height: 667 }, hasTouch: true, userAgent: IPHONE_UA, isMobile: true }],
  ['se-landscape', { viewport: { width: 667, height: 375 }, hasTouch: true, userAgent: IPHONE_UA, isMobile: true }],
  ['pc', { viewport: { width: 1280, height: 800 }, hasTouch: false }],
  ['phone-portrait-reduce-motion', { viewport: { width: 390, height: 844 }, hasTouch: true, userAgent: IPHONE_UA, isMobile: true, reduceMotion: true }],
];
const REDUCED_SCENES = new Set(['06-chorus', '12-complete', '16-pile']);

async function up(port) {
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { if ((await fetch(`http://localhost:${port}/`)).ok) return true; } catch { /* まだ */ }
  }
  return false;
}
function kill(p) { try { if (process.platform === 'win32') execSync(`taskkill /PID ${p.pid} /F /T`, { stdio: 'ignore' }); else p.kill('SIGTERM'); } catch { /* 止まっている */ } }

/** YouTube の操作の口へ命令を送る（自動のブラウザで再生を始められる唯一の道） */
const cmd = (page, func, args = []) => page.evaluate(([f, a]) => {
  document.querySelector('iframe')?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: f, args: a }), '*');
}, [func, args]);

/** 動画の矩形に重なっている DOM の要素（iframe 自身とその祖先、透明で押せない印は除く）を数える */
const overlapCheck = (page) => page.evaluate(() => {
  const iframe = document.querySelector('iframe');
  if (!iframe) return { video: null, over: ['iframe無し'] };
  const v = iframe.getBoundingClientRect();
  const ancestors = new Set();
  for (let e = iframe; e; e = e.parentElement) ancestors.add(e);
  const over = [];
  for (const el of document.querySelectorAll('body *')) {
    if (ancestors.has(el)) continue;
    if (el.closest('iframe')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    if (el.tagName === 'CANVAS' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const ix = Math.min(r.right, v.right) - Math.max(r.left, v.left);
    const iy = Math.min(r.bottom, v.bottom) - Math.max(r.top, v.top);
    if (ix <= 0 || iy <= 0) continue;
    // 器（親の枠）は透明で中身が無ければ「重なり」に数えない。文字か背景か枠線を持つ物だけ
    const hasBg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none' || cs.borderStyle !== 'none';
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasBg && !hasText) continue;
    // 後ろに隠れている物（重ね順が iframe より下）は重なっていても見えない。
    // 真ん中の点で一番手前にあるのが iframe 側なら見えていない
    const top = document.elementFromPoint(Math.max(r.left, v.left) + ix / 2, Math.max(r.top, v.top) + iy / 2);
    if (top && (top === iframe || ancestors.has(top))) continue;
    over.push(`${el.tagName.toLowerCase()}${el.dataset.testid ? '[' + el.dataset.testid + ']' : ''}:${(el.textContent || '').trim().slice(0, 20)}`);
  }
  return { video: { x: v.left, y: v.top, w: v.width, h: v.height }, over };
});

/** 色えらびの💎が画面の縁で切れていないか。隣のページの💎は横に丸ごと外にあるのが正しいので、
 *  「一部だけ画面に掛かっている」物だけを切れていると数える。上下は必ず収まっていること */
const buttonsInView = (page) => page.evaluate(() => {
  const els = [...document.querySelectorAll('[data-diamond-color-id]')];
  const W = innerWidth, H = innerHeight;
  let shown = 0, cut = 0;
  for (const e of els) {
    const r = e.getBoundingClientRect();
    if (r.width === 0) continue;
    const overlapsX = r.right > 0 && r.left < W;
    if (!overlapsX) continue;                      // 隣のページ（横に丸ごと外）
    // 隣のページの💎は薄く縁から半分のぞかせる作り（今の版と同じ）で、横に切れているのが正しい。
    // 横の切れは「いま選んでいる💎」だけ見て、上下の切れは全部見る
    shown++;
    const selected = e.getAttribute('aria-pressed') === 'true';
    if (r.top < 0 || r.bottom > H || (selected && (r.left < 0 || r.right > W))) cut++;
  }
  return { n: shown, out: cut };
});

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
let ng = 0;

const dev = argBase ? null : spawn('node', ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', cwd: ROOT });
let browser = null;
try {
  if (dev && !(await up(PORT))) throw new Error('開発サーバーが立たなかった');
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--mute-audio'] });
  for (const [screen, allOpts] of SCREENS) {
    const { reduceMotion, ...opts } = allOpts;
    const ctx = await browser.newContext(opts);
    if (reduceMotion) {
      // 設定の覚え書き（DiamondSettingsSheet.tsx の鍵と形）に「動きを減らす」を入れてから開く
      await ctx.addInitScript(() => {
        try { localStorage.setItem('hai_to_diamond:settings', JSON.stringify({ crowd: 'full', reduceMotion: true, colorLayout: 'pages', scene: 'mirrorball' })); } catch { /* 無視 */ }
      });
    }
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    await page.goto(url(), { waitUntil: 'domcontentloaded' });
    const ready = await page.waitForFunction(() => document.body.innerText.includes('はじまります'), null, { timeout: 120000 }).then(() => true, () => false);
    if (!ready) { ng++; log(`否 ${screen}: 入口が出なかった`); await ctx.close(); continue; }
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `${screen}-00-entry.png`) });
    {
      const o = await overlapCheck(page);
      log(`${o.over.length ? '否' : '合'} ${screen} 入口: 動画に重なる要素 ${o.over.length ? o.over.join(' / ') : '無し'}`);
      if (o.over.length) ng++;
    }
    const mark = await page.evaluate(() => document.querySelector('[data-testid="diamond-qa-mark"]')?.textContent?.trim() ?? null);
    if (mark !== 'QA') { ng++; log(`否 ${screen}: 送信止めの印が無い（再生を始めない）`); await ctx.close(); continue; }
    await cmd(page, 'playVideo');
    const started = await page.waitForSelector('[data-diamond-color-id]', { state: 'visible', timeout: 40000 }).then(() => true, () => false);
    if (!started) { ng++; log(`否 ${screen}: 再生が始まらなかった（色えらびが出ない）`); await ctx.close(); continue; }
    await page.waitForTimeout(1500);
    // 自分の💎を数回押す（自分の面の印と削りかすを見るため）
    for (let i = 0; i < 4; i++) {
      const id = ['nishida', 'eguchi', 'kojima', 'nishida'][i];
      // 触れる端末は tap、PC は click（tap は hasTouch の無い画面では効かない）
      if (opts.hasTouch) await page.tap(`[data-diamond-color-id="${id}"]`).catch(() => {});
      else await page.click(`[data-diamond-color-id="${id}"]`).catch(() => {});
      await page.waitForTimeout(500);
    }
    for (const [name, t] of SCENES) {
      if (reduceMotion && !REDUCED_SCENES.has(name)) continue;
      await cmd(page, 'seekTo', [t, true]);
      await page.waitForTimeout(name === '12-complete' ? 900 : 1600);
      await page.screenshot({ path: path.join(OUT, `${screen}-${name}.png`) });
      const o = await overlapCheck(page);
      const b = await buttonsInView(page);
      const bad = o.over.length > 0 || b.out > 0;
      if (bad) ng++;
      log(`${bad ? '否' : '合'} ${screen} ${name}(${t}s): 動画に重なる要素 ${o.over.length ? o.over.join(' / ') : '無し'} ／ 色えらび 見えている${b.n}個のうち縁で切れている ${b.out}`);
    }
    const zc = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      const f = document.querySelector('iframe');
      if (!c || !f) return null;
      const r = f.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top === f || f.contains(top) ? 'iframeが手前' : (top?.tagName ?? '?') + 'が手前';
    });
    log(`${zc === 'iframeが手前' ? '合' : '否'} ${screen} 重ね順: 動画の真ん中で一番手前にあるのは ${zc}`);
    if (zc !== 'iframeが手前') ng++;
    log(`${errors.length ? '否' : '合'} ${screen} つまずき: ${errors.length ? errors.join(' | ') : '無し'}`);
    if (errors.length) ng++;
    await ctx.close();
  }
} catch (e) {
  ng++;
  log('否 ' + String(e));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (dev) {
    kill(dev);
    await new Promise((r) => setTimeout(r, 1500));
    let still = false;
    try { await fetch(`http://localhost:${PORT}/`, { signal: AbortSignal.timeout(1500) }); still = true; } catch { /* 止まっている */ }
    log(still ? `注意: ${PORT} 番がまだ動いている` : `${PORT} 番は止まった`);
    if (still) ng++;
  }
}
log(`写真: ${OUT}`);
log(ng ? '否' : '合');
process.exit(ng ? 1 : 0);
