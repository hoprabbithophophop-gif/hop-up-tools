// 確かめ用の送信止めの印「QA」が、決まりどおりの場面でだけ出るかを実際の画面で確かめる。
// 手元の開発サーバー（いつも送らない）と、本番と同じ組み方の出来上がり（?qa=1 の時だけ送らない）の両方を、
// この台本自身が立てて見る（ポート 5199・5198 を使う。他の確かめがこの2つを使っている間は動かさない）。
// 使い方: どこからでも `node scripts/verify/hai-to-diamond/check-qa-mark.mjs`
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function up(port) {
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { if ((await fetch(`http://localhost:${port}/`)).ok) return true; } catch { /* まだ */ }
  }
  return false;
}
function kill(p) { try { if (process.platform === 'win32') execSync(`taskkill /PID ${p.pid} /F /T`, { stdio: 'ignore' }); else p.kill('SIGTERM'); } catch { /* 止まっている */ } }

const dev = spawn('node', ['node_modules/vite/bin/vite.js', '--port', '5199', '--strictPort'], { stdio: 'ignore', cwd: ROOT });
const prev = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '5198', '--strictPort'], { stdio: 'ignore', cwd: ROOT });
let ng = 0;
try {
  if (!(await up(5199)) || !(await up(5198))) throw new Error('サーバーが立たなかった');
  const browser = await chromium.launch();
  // [説明, 住所, 印が出るべきか]
  const cases = [
    ['開発サーバー・印なしの住所', 'http://localhost:5199/hai-to-diamond', true],
    ['開発サーバー・?submit=1（送る道を試す時）', 'http://localhost:5199/hai-to-diamond?submit=1', false],
    ['開発サーバー・札つきの住所', 'http://localhost:5199/hai-to-diamond/kiyono/2', true],
    ['本番と同じ出来上がり・印なしの住所', 'http://localhost:5198/hai-to-diamond', false],
    ['本番と同じ出来上がり・?qa=1', 'http://localhost:5198/hai-to-diamond?qa=1', true],
    ['本番と同じ出来上がり・札つきの住所に ?qa=1', 'http://localhost:5198/hai-to-diamond/kiyono/2?qa=1', true],
    ['本番と同じ出来上がり・?qa=0', 'http://localhost:5198/hai-to-diamond?qa=0', false],
    ['本番と同じ出来上がり・?submit=1 だけ', 'http://localhost:5198/hai-to-diamond?submit=1', false],
  ];
  for (const [name, url, want] of cases) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 100)));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const opened = await page.waitForFunction(() => document.body.innerText.includes('はじまります'), null, { timeout: 120000 }).then(() => true, () => false);
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const m = document.querySelector('[data-testid="diamond-qa-mark"]');
      if (!m) return { shown: false };
      const b = m.getBoundingClientRect();
      const hit = (o) => o && !(b.right < o.left || b.left > o.right || b.bottom < o.top || b.top > o.bottom);
      const frames = [...document.querySelectorAll('iframe')].map((f) => f.getBoundingClientRect()).filter((f) => f.width > 0);
      const gear = document.querySelector('button[aria-label="表示設定"]')?.getBoundingClientRect();
      return { shown: true, text: m.textContent.trim(), overVideo: frames.some(hit), overGear: !!hit(gear), clickable: getComputedStyle(m).pointerEvents !== 'none' };
    });
    const ok = opened && r.shown === want && (!r.shown || (r.text === 'QA' && !r.overVideo && !r.overGear && !r.clickable)) && !errs.length;
    if (!ok) ng++;
    console.log(`${ok ? '合' : '否'} ${name} ／ 印 ${r.shown ? 'あり' : 'なし'}（欲しいのは ${want ? 'あり' : 'なし'}）${r.shown ? ` ／ 動画と重なる ${r.overVideo} ／ ⚙と重なる ${r.overGear} ／ 押せる ${r.clickable}` : ''}${errs.length ? ' ／ つまずき ' + errs.join('|') : ''}`);
    await page.close();
  }
  await browser.close();
} catch (e) { ng++; console.log('否', String(e)); }
kill(dev); kill(prev);
await new Promise((r) => setTimeout(r, 1500));
for (const port of [5199, 5198]) {
  let still = false;
  try { await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1500) }); still = true; } catch { /* 止まっている */ }
  console.log(still ? `注意: ${port} 番がまだ動いている` : `${port} 番は止まった`);
  if (still) ng++;
}
console.log(ng ? '否' : '合');
process.exit(ng ? 1 : 0);
