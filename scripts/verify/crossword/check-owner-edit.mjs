// 組み直しの受付係（/api/crossword-owner-get・/api/crossword-update）を確かめる（Hop 決定 2026-10-05）。
//  (a) 形の悪い本文 → 400（owner-get・update とも）
//  (b) 無い番号＋適当な合言葉 → 404 not_found（owner-get。update は本文が正しい形でも 404）
//  (c) 大きさ超え → 413（owner-get は 8192 バイト超・update は 450000 バイト超）
//  (d) 本物の問題での通し。targets.json に ownerPuzzleId と ownerKey があるときだけ流す（無ければ飛ばす）
//      owner-get で中身が戻る → 同じ中身で update → owner-get で書き換わったのを見る
//      ownerPlayedPuzzleId と ownerPlayedKey もあれば、遊ばれた後の問題の update が 409 already_played になるのを見る
// 本番の棚への影響: (a)〜(c) は何も書き換えない（rate_limit_log に数えが1時間残るだけ）。
//   (d) は ownerPuzzleId の問題を、同じ中身（題名の末尾だけ入れ替え）で書き換える。シェア画像は送らない
// 使い方: node scripts/verify/crossword/check-owner-edit.mjs [サイト]（省略時は targets.json）
import { randomBytes } from 'node:crypto';
import { BASE_DEFAULT, TARGETS } from './_lib.mjs';

const BASE = process.argv[2] || BASE_DEFAULT;
let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};
const post = async (p, body) => {
  const res = await fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, j };
};
const randKey = () => randomBytes(32).toString('hex');
// 存在しない番号（8字。毎回でたらめ）
const randId = () => randomBytes(6).toString('base64url').slice(0, 8);

// 形の正しい、保存と同じ本文（ジャンルはその他・リンクのヒント）
const samplePuzzle = {
  title: '確かめ用',
  genre: 'other',
  tags: [],
  isBeginner: false,
  body: {
    version: 1,
    width: 3,
    height: 3,
    clues: [
      { clueIndex: 1, direction: 'horizontal', startX: 0, startY: 0, clue: 'ネコ', answer: ['ネ', 'コ'], hint: { kind: 'link', url: 'https://example.com/' } },
      { clueIndex: 2, direction: 'vertical', startX: 1, startY: 0, clue: 'コイ', answer: ['コ', 'イ'], hint: { kind: 'link', url: 'https://example.com/' } },
    ],
  },
};

// (c) 大きさ（先に流す。数えに入る前に断られる）
{
  const big = JSON.stringify({ id: randId(), key: randKey(), pad: 'x'.repeat(8200) });
  const r = await post('/api/crossword-owner-get', big);
  check(r.status === 413, `(c) crossword-owner-get に ${Buffer.byteLength(big)} バイト → ${r.status}`);
  const huge = JSON.stringify({ id: randId(), key: randKey(), pad: 'x'.repeat(450001) });
  const u = await post('/api/crossword-update', huge);
  check(u.status === 413, `(c) crossword-update に ${Buffer.byteLength(huge)} バイト → ${u.status}`);
}

// (a) 形の悪い本文
{
  const r1 = await post('/api/crossword-owner-get', '{not json');
  check(r1.status === 400, `(a) owner-get に JSON でない本文 → ${r1.status}`);
  const r2 = await post('/api/crossword-owner-get', { id: 'short', key: 'x' });
  check(r2.status === 400, `(a) owner-get に番号・合言葉の形が違う本文 → ${r2.status}`);
  const r3 = await post('/api/crossword-update', { id: randId(), key: randKey(), puzzle: { ...samplePuzzle, title: '' } });
  check(r3.status === 400, `(a) update に題名が空の本文 → ${r3.status}`);
  const r4 = await post('/api/crossword-update', { id: randId(), key: randKey(), puzzle: { ...samplePuzzle, body: { ...samplePuzzle.body, clues: samplePuzzle.body.clues.map((c) => ({ ...c, answer: ['猫'] })) } } });
  check(r4.status === 400, `(a) update に答えがカタカナでない本文 → ${r4.status}`);
}

// (b) 無い番号＋適当な合言葉
{
  const r = await post('/api/crossword-owner-get', { id: randId(), key: randKey() });
  check(r.status === 404 && r.j?.reason === 'not_found', `(b) owner-get に無い番号 → ${r.status} ${r.j?.reason ?? ''}`);
  const u = await post('/api/crossword-update', { id: randId(), key: randKey(), puzzle: samplePuzzle });
  check(u.status === 404 && u.j?.reason === 'not_found', `(b) update に無い番号（本文は正しい形） → ${u.status} ${u.j?.reason ?? ''}`);
}

// (d) 本物の問題での通し
if (!TARGETS.ownerPuzzleId || !TARGETS.ownerKey) {
  console.log('飛ばす (d): targets.json に ownerPuzzleId と ownerKey が無い（作った端末の合言葉の控えが要る）');
} else {
  const id = TARGETS.ownerPuzzleId;
  const key = TARGETS.ownerKey;
  const g = await post('/api/crossword-owner-get', { id, key });
  check(g.status === 200 && g.j?.ok === true && Array.isArray(g.j?.answers), `(d) owner-get で中身が戻る → ${g.status}`);
  if (g.status === 200 && g.j?.puzzle) {
    const p = g.j.puzzle;
    const clues = p.body.clues.map(({ length, ...c }, i) => ({ ...c, answer: g.j.answers[i] }));
    const stamp = `確${Date.now() % 10000}`;
    const title = `${String(p.title).replace(/ 確\d+$/, '').slice(0, 50)} ${stamp}`;
    const body = { version: 1, width: p.body.width, height: p.body.height, clues, ...(p.body.creatorName ? { creatorName: p.body.creatorName } : {}) };
    const u = await post('/api/crossword-update', { id, key, puzzle: { title, genre: p.genre, tags: p.tags, isBeginner: p.is_beginner, body } });
    check(u.status === 200 && u.j?.ok === true, `(d) update で書き換え → ${u.status} ${u.j?.reason ?? ''}`);
    const g2 = await post('/api/crossword-owner-get', { id, key });
    check(g2.j?.puzzle?.title === title, `(d) 書き換わった題名が戻る → ${g2.j?.puzzle?.title}`);
  }
  if (TARGETS.ownerPlayedPuzzleId && TARGETS.ownerPlayedKey) {
    const gp = await post('/api/crossword-owner-get', { id: TARGETS.ownerPlayedPuzzleId, key: TARGETS.ownerPlayedKey });
    if (gp.status === 200 && gp.j?.puzzle) {
      const p = gp.j.puzzle;
      const clues = p.body.clues.map(({ length, ...c }, i) => ({ ...c, answer: gp.j.answers[i] }));
      const u = await post('/api/crossword-update', {
        id: TARGETS.ownerPlayedPuzzleId,
        key: TARGETS.ownerPlayedKey,
        puzzle: { title: p.title, genre: p.genre, tags: p.tags, isBeginner: p.is_beginner, body: { version: 1, width: p.body.width, height: p.body.height, clues } },
      });
      check(u.status === 409 && u.j?.reason === 'already_played', `(d) 遊ばれた後の問題の update → ${u.status} ${u.j?.reason ?? ''}`);
    } else {
      check(false, `(d) 遊ばれた後の問題の中身が読めない → ${gp.status}`);
    }
  } else {
    console.log('飛ばす (d) の 409: targets.json に ownerPlayedPuzzleId と ownerPlayedKey が無い');
  }
}

console.log(fail ? `NG ${fail}件` : '全部 OK');
process.exit(fail ? 1 : 0);
