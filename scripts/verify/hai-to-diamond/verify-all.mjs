// 灰toダイヤモンドの「機械で確かめられる行」を、全部まとめて1回で回す。
// 使い方: どこからでも `npm run verify:hai-to-diamond`（package.json 経由）、
//         または `node scripts/verify/hai-to-diamond/verify-all.mjs` を直接叩いてもよい。
// 曲は再生しない（このページには確かめ用の送信止めが無く、曲を通すと本番の累計の記録を汚すため）。
// 再生中の動きを手で確かめる時は、住所に ?qa=1 を付ける（確かめ用の送信止め）。
// 手元に開発サーバーを立てる確かめが複数あり、ポートがぶつからないよう順番を空けて回し、終わったら必ず止める。
import { spawnSync, spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const script = (name) => path.join(SCRIPT_DIR, name);

const PREVIEW = process.env.PREVIEW || 'https://feature-hai-to-diamond.hop-up-tools.pages.dev';
const PROD = process.env.PROD || 'https://hop-up-tools.pages.dev';
const PORT = 5199;
const sha = execSync('git rev-parse --short=7 HEAD', { cwd: ROOT }).toString().trim();
const results = [];

function run(name, paperLine, cmd, args, opts = {}) {
  const t0 = Date.now();
  const exec = () => spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32', timeout: opts.timeout ?? 240000, cwd: ROOT });
  let r = exec();
  // 外の住所へ読みに行く確かめは、通信が一時的に途切れただけで否になる。否の時は10秒おいて1回だけやり直す
  // （2026-09-20 に、回している途中の通信の途切れで4本まとめて否になった。単体で回し直すと全部合だった）
  if (r.status !== 0 && opts.net) {
    console.log(`   ${name}: 否。通信の途切れかもしれないので10秒おいてやり直す`);
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},10000)']);
    r = exec();
  }
  const out = ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/).filter(Boolean);
  const ok = r.status === 0;
  results.push({ name, paperLine, ok, sec: ((Date.now() - t0) / 1000).toFixed(1), tail: out.slice(-(opts.tail ?? 2)).join(' ｜ ') });
  console.log(`${ok ? '合' : '否'} ${name}（${results.at(-1).sec}秒）`);
  if (!ok) console.log('   ' + out.slice(-8).join('\n   '));
  return ok;
}

console.log(`== 灰toダイヤモンドの確かめ一式 ／ 手元の版 ${sha} ／ プレビュー ${PREVIEW} ／ 本番 ${PROD}\n`);

run('札の読み取り・弾き方・42枚の在りか・最初の色・シェアの札・色の控え', 'シェアのリンクに付く絵／札つきの住所／42枚／色の控え／最初の色',
  'node', [script('test-card-tag.mjs')]);
run('見返し中は選んでいる色の星だけが瞬く（部品を単体で動かす）', '星空になった後の行',
  'node', [script('test-sky-spark.mjs')]);
run('ビルドが通る', '確かめ方の行', 'npm', ['run', 'build'], { tail: 1 });
run('プレビューの看板のタグと絵42枚の配られ方', '札つきの住所の行', 'node', [script('check-card-meta.mjs'), PREVIEW], { net: true });
run('本番の看板のタグと絵42枚の配られ方', '札つきの住所の行', 'node', [script('check-card-meta.mjs'), PROD], { net: true });
run(`プレビューの入口の右下に版番号 v.${sha}`, '入口の行（main 以外の枝では右下に版番号）',
  'node', [script('check-version-badge.mjs'), PREVIEW, `v.${sha}`], { tail: 1, net: true });
run('本番の入口にお知らせのリンクが無い・題字と副題はある', '入口の行', 'node', [script('check-entry.mjs'), PROD], { tail: 1, net: true });
run('本番のほかのページがブラウザで開ける', '（灰toダイヤモンドの外。巻き込みが無いことの確かめ）', 'node', [script('check-other-pages.mjs'), PROD], { tail: 6, net: true });

// 石のオレンジの読み替え: 手元の開発サーバーが要る
console.log(`\n手元の開発サーバーを ${PORT} 番に立てる…`);
const vite = spawn('node', [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { stdio: 'ignore', cwd: ROOT });
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try { const res = await fetch(`http://localhost:${PORT}/`); up = res.ok; } catch { /* まだ */ }
}
if (up) {
  run('石として描くオレンジは #df6f00 で焼いた絵と1点も違わない（96コマ）・赤と黄は読み替わらない', '石として描かれるオレンジの行',
    'node', [script('check-stone-override.mjs')], { tail: 1 });
  run('手元の入口の右下に v.dev', '入口の行', 'node', [script('check-version-badge.mjs'), `http://localhost:${PORT}`, 'v.dev'], { tail: 1 });
} else {
  results.push({ name: '開発サーバーが立たなかった', paperLine: '石のオレンジの行', ok: false, sec: '-', tail: '' });
  console.log('否 開発サーバーが立たなかった');
}
// 立てた開発サーバーを必ず止める（Windows は子の木ごと）
try { if (process.platform === 'win32') execSync(`taskkill /PID ${vite.pid} /F /T`, { stdio: 'ignore' }); else vite.kill('SIGTERM'); } catch { /* 既に止まっている */ }
await new Promise((r) => setTimeout(r, 1200));
let still = false;
try { await fetch(`http://localhost:${PORT}/`, { signal: AbortSignal.timeout(1500) }); still = true; } catch { /* 止まっている */ }
console.log(still ? `注意: ${PORT} 番の開発サーバーがまだ動いている` : `開発サーバーは止まった`);

// 確かめ用の送信止めの印「QA」: この台本自身が手元の開発サーバー(5199)とpreview(5198)を立てて確かめるので、
// verify-all が自分の開発サーバーを止めたあと（上の still 確認のあと）に回す
if (!still) {
  run('確かめ用の送信止めの印「QA」が決まりどおりの場面でだけ出る', '確かめ用の送信止めの行',
    'node', [script('check-qa-mark.mjs')], { tail: 10, timeout: 300000 });
} else {
  results.push({ name: '確かめ用の送信止めの印「QA」の確かめを見送った', paperLine: '確かめ用の送信止めの行', ok: false, sec: '-', tail: `${PORT}番が空かなかったため` });
  console.log('否 確かめ用の送信止めの印「QA」の確かめを見送った（ポートが空かなかった）');
}

const ng = results.filter((r) => !r.ok);
console.log('\n== まとめ');
for (const r of results) console.log(`${r.ok ? '合' : '否'}｜${r.name}｜紙: ${r.paperLine}｜${r.tail}`);
console.log(`\n確かめ ${results.length}本 ／ 合 ${results.length - ng.length} ／ 否 ${ng.length}${still ? ' ／ 開発サーバーが残っている' : ''}`);
console.log('この一式が確かめていないもの: 再生中と曲の終わりの動き（曲を通すと本番の累計を汚すため動かしていない）／X で看板が実際にどう出るか');
process.exit(ng.length || still ? 1 : 0);
