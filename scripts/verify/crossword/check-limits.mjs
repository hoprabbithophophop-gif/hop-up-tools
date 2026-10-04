// 受付係の上限が本物で効くかを確かめる（紙: 「自分の問題・守り」のセキュリティ監査の行と「解く」の回を始める上限の行）。
//  (a) /api/crossword-delete: 形は正しいが合言葉の違う本文を送り続けると、21回目までに 429 too_many（同じ接続元で1時間20回）
//  (b) /api/crossword-play start: 同じ問題で送り続けると、301回目までに 429（同じ接続元で1時間300回）
//  (c) 本文の大きさ: crossword-play に 9000 バイト超 → 413、crossword-save に 450001 バイト超 → 413
// 本番の棚への影響: (a) は消さない（合言葉は毎回でたらめな64字なので合わない。問題は棚にあるので絵にも触らない）。
//   (b) は 1回ごとに空の回（crossword_plays）が1行でき、最大300行。何もしていない回は1日で片付く。
//   全体ブレーキ（1時間3000件）には届かない数だけ送る。
// 注意: (b) のあと1時間は、この回線から回を始められない（Hop の Chrome で解いても「混み合っています」）。
//   だから (b) は --start-limit を付けた時だけ流す。既定（run-all.mjs から引数なし）では (a) と (c) だけ。
//   run-all.mjs でもこの台本は最後に流す（(a) の削除の上限も1時間残るため）。
// 使い方: node scripts/verify/crossword/check-limits.mjs [サイト] [問題の番号] [--start-limit]（省略時は targets.json）
import { randomBytes } from 'node:crypto';
import { BASE_DEFAULT, ID_DEFAULT } from './_lib.mjs';

const START_LIMIT = process.argv.includes('--start-limit');
const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const BASE = pos[0] || BASE_DEFAULT;
const ID = pos[1] || ID_DEFAULT;
let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (p, body) => {
  const res = await fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, j };
};

// (c) 先に大きさ（回を使わない）
{
  const big = JSON.stringify({ action: 'start', puzzleId: ID, pad: 'x'.repeat(9000) });
  const r = await post('/api/crossword-play', big);
  check(r.status === 413, `(c) crossword-play に ${Buffer.byteLength(big)} バイト → ${r.status}`);
  const huge = JSON.stringify({ pad: 'x'.repeat(450001) });
  const s = await post('/api/crossword-save', huge);
  check(s.status === 413, `(c) crossword-save に ${Buffer.byteLength(huge)} バイト → ${s.status}`);
}

// (a) 削除の連投。記録の書き込みは返事の後に行われるので、少し間をあけて順に送る
{
  let at = null;
  let deleted = false;
  const seen = [];
  for (let i = 1; i <= 21; i++) {
    const r = await post('/api/crossword-delete', JSON.stringify({ id: ID, key: randomBytes(32).toString('hex') }));
    seen.push(r.status);
    if (r.j?.deleted === true) { deleted = true; break; }
    if (r.status === 429) { at = { i, reason: r.j?.reason }; break; }
    await sleep(400);
  }
  check(!deleted, '(a) 違う合言葉で消えることは無い');
  check(at !== null && at.reason === 'too_many', `(a) 21回目までに 429 too_many: ${at ? `${at.i}回目に ${at.reason}` : '来なかった'}（返事 ${seen.join(',')}）`);
}

// (b) 回を始める連投。上限の数え方は返事の後に記録されるので、順に少し間をあけて送る
if (!START_LIMIT) {
  console.log('飛ばす (b): 回を始める上限（300/時）は同じ数え方の削除の上限（21回目で429）で確かめている。流すと1時間この回線から遊べなくなるため既定では飛ばす。流すなら node scripts/verify/crossword/check-limits.mjs --start-limit');
} else {
  let at = null;
  let made = 0;
  const other = {};
  for (let i = 1; i <= 301; i++) {
    const r = await post('/api/crossword-play', JSON.stringify({ action: 'start', puzzleId: ID }));
    if (r.status === 200 && r.j?.ok) made++;
    else if (r.status === 429) { at = { i, reason: r.j?.reason }; break; }
    else other[r.status] = (other[r.status] || 0) + 1;
    await sleep(150);
  }
  console.log(`   (b) 本番に作った空の回: ${made}行（1日で片付く）${Object.keys(other).length ? ' ／ そのほかの返事 ' + JSON.stringify(other) : ''}`);
  check(at !== null && at.reason === 'too_many', `(b) 301回目までに 429 too_many: ${at ? `${at.i}回目に ${at.reason}` : '来なかった'}`);
}

console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
