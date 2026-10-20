// 組み直しの受付係（/api/crossword-owner-get・/api/crossword-update）を確かめる（Hop 決定 2026-10-05）。
//  (a) 形の悪い本文 → 400（owner-get。update は番号・合言葉の形が悪ければ 400）
//      update は重い検査の前に合言葉を照らすので、合言葉が合わなければ本文の形に関係なく 404 not_found
//      （本文の形の悪さで 400 になるのを見るのは、本物の合言葉がある (d) で）
//  (b) 無い番号＋適当な合言葉 → 404 not_found（owner-get・update とも。update は本文の形に関係なく 404）
//  (c) 大きさ超え → 413（owner-get は 8192 バイト超・update は 450000 バイト超）
//  (d) 問題での通し。受付係のコードを手元で動かし、作り物の棚に置いた問題で確かめる（_localFunctions.mjs）。
//      本番にもプレビューにも問題を置かない・書き換えない（2026-10-19 Hop「本番環境から見える形で検収用パズル登録を二度とするな」）
//      owner-get で中身が戻る → 同じ中身で update → owner-get で書き換わったのを見る（送ったジャンルが other でも棚には hello で書く。2026-10-20）
//      合う合言葉で、交わるマスの字が食い違う本文の update → 400（棚は書き換わらない）
//      遊ばれた後の問題の update が 409 already_played・合わない合言葉は 404・隠れた問題は 404
// 本番の棚への影響: (a)〜(c) は何も書き換えない（rate_limit_log に数えが1時間残るだけ）。(d) は本番にもプレビューにも通信しない
// 使い方: node scripts/verify/crossword/check-owner-edit.mjs [サイト]（省略時は targets.json）
import { randomBytes } from 'node:crypto';
import { BASE_DEFAULT } from './_lib.mjs';
import { openFunctions, fakeShelf, callFunction } from './_localFunctions.mjs';

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
  const r3 = await post('/api/crossword-update', { id: 'short', key: 'x', puzzle: samplePuzzle });
  check(r3.status === 400, `(a) update に番号・合言葉の形が違う本文 → ${r3.status}`);
  const r4 = await post('/api/crossword-update', { id: randId(), key: randKey(), puzzle: { ...samplePuzzle, title: '' } });
  check(r4.status === 404 && r4.j?.reason === 'not_found', `(a) update に合わない合言葉＋題名が空の本文 → 合言葉が先に照らされて ${r4.status} ${r4.j?.reason ?? ''}`);
}

// (b) 無い番号＋適当な合言葉
{
  const r = await post('/api/crossword-owner-get', { id: randId(), key: randKey() });
  check(r.status === 404 && r.j?.reason === 'not_found', `(b) owner-get に無い番号 → ${r.status} ${r.j?.reason ?? ''}`);
  const u = await post('/api/crossword-update', { id: randId(), key: randKey(), puzzle: samplePuzzle });
  check(u.status === 404 && u.j?.reason === 'not_found', `(b) update に無い番号（本文は正しい形） → ${u.status} ${u.j?.reason ?? ''}`);
}

// (d) 問題での通し（手元の受付係＋作り物の棚。本番にもプレビューにも通信しない）
{
  const fns = await openFunctions();
  try {
    const ownerGet = (await fns.load('functions/api/crossword-owner-get.ts')).onRequestPost;
    const update = (await fns.load('functions/api/crossword-update.ts')).onRequestPost;
    const shelf = fakeShelf();
    const id = 'LocalOw1';
    const key = randKey();
    shelf.addPuzzle({ id, key, title: '確かめ用', width: 3, height: 3, clues: samplePuzzle.body.clues });
    const playedId = 'LocalOw2';
    const playedKey = randKey();
    shelf.addPuzzle({ id: playedId, key: playedKey, title: '遊ばれた確かめ用', play_count: 3, width: 3, height: 3, clues: samplePuzzle.body.clues });
    const hiddenId = 'LocalOw3';
    const hiddenKey = randKey();
    shelf.addPuzzle({ id: hiddenId, key: hiddenKey, title: '隠れた確かめ用', is_hidden: true, width: 3, height: 3, clues: samplePuzzle.body.clues });
    const call = (handler, body) => callFunction(handler, shelf, { body });

    const g = await call(ownerGet, { id, key });
    check(g.status === 200 && g.j?.ok === true && Array.isArray(g.j?.answers), `(d) owner-get で中身が戻る → ${g.status}`);
    if (g.status === 200 && g.j?.puzzle) {
      const p = g.j.puzzle;
      const clues = p.body.clues.map(({ length, ...c }, i) => ({ ...c, answer: g.j.answers[i] }));
      const title = `確かめ用 確${Date.now() % 10000}`;
      const body = { version: 1, width: p.body.width, height: p.body.height, clues };
      const u = await call(update, { id, key, puzzle: { title, genre: p.genre, tags: p.tags, isBeginner: p.is_beginner, body } });
      check(u.status === 200 && u.j?.ok === true, `(d) update で書き換え → ${u.status} ${u.j?.reason ?? ''}`);
      const g2 = await call(ownerGet, { id, key });
      check(g2.j?.puzzle?.title === title, `(d) 書き換わった題名が戻る → ${g2.j?.puzzle?.title}`);
      // ジャンルはハロプロだけ（Hop 決定 2026-10-20）。受付係は送られたジャンル（ここでは元の問題の other）を見ず hello で書く
      check(p.genre === 'other' && shelf.puzzles.get(id).genre === 'hello', `(d) 送ったジャンル ${p.genre} でも棚には hello で書く → ${shelf.puzzles.get(id).genre}`);
      // 交わるマスの字が食い違う本文（1語目と同じ位置・同じ向きに、別の字の語を重ねる）
      const c0 = clues[0];
      const clash = { ...c0, clueIndex: c0.clueIndex + 1000, answer: c0.answer.map((ch) => (ch === 'ア' ? 'イ' : 'ア')) };
      const bad = await call(update, { id, key, puzzle: { title: '食い違い', genre: p.genre, tags: p.tags, isBeginner: p.is_beginner, body: { ...body, clues: [...clues, clash] } } });
      check(bad.status === 400 && bad.j?.reason === 'bad_request', `(d) 合う合言葉＋字が食い違う本文の update → ${bad.status} ${bad.j?.reason ?? ''}`);
      check(shelf.puzzles.get(id).title === title, '(d) 食い違う本文では棚は書き換わらない');
    }
    const played = await call(update, { id: playedId, key: playedKey, puzzle: samplePuzzle });
    check(played.status === 409 && played.j?.reason === 'already_played', `(d) 遊ばれた後の問題の update → ${played.status} ${played.j?.reason ?? ''}`);
    const wrong = await call(update, { id, key: randKey(), puzzle: samplePuzzle });
    check(wrong.status === 404 && wrong.j?.reason === 'not_found', `(d) 合わない合言葉の update → ${wrong.status} ${wrong.j?.reason ?? ''}`);
    const hiddenGet = await call(ownerGet, { id: hiddenId, key: hiddenKey });
    check(hiddenGet.status === 404 && hiddenGet.j?.reason === 'not_found', `(d) 隠れた問題は合う合言葉でも owner-get が 404 → ${hiddenGet.status} ${hiddenGet.j?.reason ?? ''}`);
    check(shelf.outside.length === 0, `(d) 外への通信は無い${shelf.outside.length ? `（${shelf.outside[0]}）` : ''}`);
  } finally {
    await fns.close();
  }
}

console.log(fail ? `NG ${fail}件` : '全部 OK');
process.exit(fail ? 1 : 0);
