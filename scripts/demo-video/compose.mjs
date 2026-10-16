// 撮った録画（390×844）を 4:5（1080×1350）の動画に仕上げる。まん中にスマホの画面を高さいっぱいに置く（Hop 決定 2026-10-16）。
// テロップは src/components/TeloppOverlay.tsx（いつものテロップ）と同じ指定で、動画全体を1つの画面とみなして置く。
// 下から80px・幅は文に合わせて伸び縮みし最大で動画の幅の90%。スマホの画面の幅には縛らない（Hop 2026-10-16「いつもは画面上の下側」「スマホの画面幅に合わせないで」）。
// 字の大きさなどはスマホの画面を拡大するのと同じ倍率で描く。
// 使い方: node scripts/demo-video/compose.mjs <create|solve> <出力先>
//   <出力先>/<create|solve>-raw.webm と .steps.json（record-*.mjs が書く）を読み、<出力先>/<create|solve>.mp4 を書く
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const KIND = process.argv[2];
const DIR = process.argv[3];

// 場面ごとのテロップ（文言はクロスワードの文言として私が決めた物。Hop 決定 2026-10-06 の範囲）
// from の場面から、次の場面のテロップが出るまで出す。speed は早送りの倍率
const PLAN = {
  create: [
    { from: 'start', text: 'パズルの作り方' },
    { from: 'title', text: '題名と名前を入れる' },
    { from: 'word', text: '答えとカギを入れる' },
    { from: 'hint', text: 'ヒントの動画を検索して選ぶ' },
    { from: 'add', text: '「リストに追加」で語を足す' },
    { from: 'word2', text: '残りの3語も同じように', speed: 2.5 },
    { from: 'board', text: '同じ字で交わって、盤が組み上がる' },
    { from: 'share', text: '「共有する」で公開できる' },
  ],
  solve: [
    { from: 'start', text: 'ギャラリーから問題を選ぶ' },
    { from: 'help', text: '遊び方を読んで「始める！」' },
    { from: 'skip', text: 'わからないカギは飛ばしてOK' },
    { from: 'type', text: 'カギを押して、文字盤で入れる' },
    { from: 'hint', text: 'ヒントの動画も見られる' },
    { from: 'type2', text: 'カギを押して、文字盤で入れる' },
    { from: 'dakuten', text: '゛゜は字のあとに押す' },
    { from: 'back', text: '交わった字を手がかりに、戻って解く' },
    { from: 'clear', text: '最後のマスで自動の丸付け' },
    { from: 'rank', text: '名前を入れてランキングへ' },
  ],
}[KIND];

const W = 1080;
const H = 1350;
const SCREEN_H = H; // スマホの画面の高さ（4:5 の高さいっぱい）
const SCREEN_W = Math.round((390 / 844) * SCREEN_H / 2) * 2;
const BG = '0xEEEEEE';
const SCALE = SCREEN_H / 844; // スマホの画面を拡大する倍率

const raw = path.join(DIR, `${KIND}-raw.webm`);
const steps = JSON.parse(readFileSync(path.join(DIR, `${KIND}-raw.steps.json`), 'utf8'));
const at = (key) => (key === 'start' ? 0 : steps.find((s) => s.key === key)?.t);
const end = at('end');

// 区間（元の録画の時刻）と、早送り後の時刻への写し方
const segs = PLAN.map((p, i) => ({ ...p, a: at(p.from), b: i + 1 < PLAN.length ? at(PLAN[i + 1].from) : end, speed: p.speed || 1 }));
for (const s of segs) if (s.a === undefined || s.b === undefined) throw new Error(`場面の時刻が無い: ${s.from}`);
let acc = 0;
for (const s of segs) {
  s.oa = acc;
  acc += (s.b - s.a) / s.speed;
  s.ob = acc;
}

// テロップの画像をいつもの形で描く（動画と同じ大きさの透明な画面に描いて、そのまま重ねる）
const tdir = path.join(DIR, `${KIND}-telops`);
mkdirSync(tdir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: Math.round(W / SCALE), height: Math.round(H / SCALE) }, deviceScaleFactor: SCALE });
await page.setContent(`<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Zen+Kurenaido&display=swap" rel="stylesheet">
<style>html,body{margin:0;background:transparent}
#w{position:fixed;bottom:80px;left:0;right:0;display:flex;justify-content:center}
#t{font-family:"Zen Kurenaido",cursive;font-weight:400;background-color:rgba(255,255,255,0.95);color:#1a1a1a;border:3px solid rgba(0,0,0,0.15);box-shadow:0 6px 25px rgba(0,0,0,0.3);max-width:90vw;text-align:center;padding:1rem 2.5rem;border-radius:0.75rem;font-size:1.875rem}</style></head><body><div id="w"><div id="t"></div></div></body></html>`);
await page.evaluate(() => document.fonts.ready);
for (const [i, s] of segs.entries()) {
  await page.evaluate((t) => { document.getElementById('t').textContent = t; }, s.text);
  await page.evaluate(() => document.fonts.ready);
  s.png = path.join(tdir, `${i}.png`);
  await page.screenshot({ path: s.png, omitBackground: true });
}
await browser.close();

// ffmpeg: 区間ごとに切って速さを変えてつなぐ → 画面を縮めて背景に置く → テロップを時刻どおり重ねる
const parts = segs.map((s, i) => `[0:v]trim=start=${s.a}:end=${s.b},setpts=(PTS-STARTPTS)/${s.speed}[v${i}]`).join(';');
const concat = segs.map((_, i) => `[v${i}]`).join('') + `concat=n=${segs.length}:v=1:a=0[cat]`;
const screen = `[cat]fps=30,scale=${SCREEN_W}:${SCREEN_H}:flags=lanczos[scr]`;
const bg = `color=${BG}:s=${W}x${H}:r=30:d=${acc.toFixed(3)}[bg]`;
let chain = `[bg][scr]overlay=(W-w)/2:0:shortest=1[b0]`;
segs.forEach((s, i) => {
  chain += `;[b${i}][${i + 1}:v]overlay=(W-w)/2:0:enable='between(t,${s.oa.toFixed(3)},${s.ob.toFixed(3)})'[b${i + 1}]`;
});
const filter = [parts, concat, screen, bg, chain].join(';');
const out = path.join(DIR, `${KIND}.mp4`);
const args = ['-y', '-v', 'error', '-i', raw, ...segs.flatMap((s) => ['-i', s.png]), '-filter_complex', filter, '-map', `[b${segs.length}]`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out];
writeFileSync(path.join(DIR, `${KIND}-ffmpeg-args.json`), JSON.stringify(args, null, 1));
execFileSync('ffmpeg', args, { stdio: 'inherit' });
console.log(out, `${acc.toFixed(1)}秒`);
