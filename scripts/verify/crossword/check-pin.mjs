// 作る画面で語を動かして固定する（Hop 決定 2026-10-05・案A）の組み立て側を、本物の engine.ts のまま動かして確かめる。
// (a) 固定した語が指定の座標のまま出来上がる (b) 残りの語はその周りに組まれる
// (c) 動かした先が置けない座標なら拒否される（validatePlacement・その語自身を除いた盤で）(d) 固定を外すと普通の組み立てに戻る
// ts は Node の node:module の stripTypeScriptTypes で型だけ外し、一時置き場に .mjs として書いて読み込む（論理は写さない）。
// 使い方: node scripts/verify/crossword/check-pin.mjs（引数なし。通信しない・保存しない）
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { ROOT, outDir } from './_lib.mjs';

const dir = outDir('check-pin');
for (const name of ['types', 'engine']) {
  const src = readFileSync(path.join(ROOT, 'src', 'lib', 'crossword', `${name}.ts`), 'utf8');
  writeFileSync(path.join(dir, `${name}.mjs`), stripTypeScriptTypes(src).replace(/from '\.\/(types)'/g, "from './$1.mjs'"));
}
const e = await import(pathToFileURL(path.join(dir, 'engine.mjs')).href + `?t=${Date.now()}`);
const { tryPlaceAll, shuffleByLength, generateMonteCarloSteps, generateMaximizedPuzzle, createPuzzleSearch, buildGrid, validatePlacement, canMoveTo, moveItem, isConnected } = e;

let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};
const W = (w) => ({ id: w, question: '', answer: Array.from(w) });
const P = (w, direction, startX, startY) => ({ ...W(w), uuid: `u-${w}`, direction, startX, startY, length: Array.from(w).length, pinned: true });
const WORDS = ['ハマグチ', 'マツリ', 'リズム', 'チカラ', 'グミ', 'ツバサ', 'ムラサキ'];
const items = WORDS.map(W);
const same = (a, b) => a.direction === b.direction && a.startX === b.startX && a.startY === b.startY;
// 置いた順（並びの順）に、それより前の語に対して置ける条件を通るか
const othersValid = (placed) => placed.every((it, i) => it.pinned || validatePlacement(it, placed.slice(0, i)));

// (a)(b) 1つ固定: マツリ を縦 (7, 4) に
const pin = P('マツリ', 'vertical', 7, 4);
let keep = 0, around = 0, valid = 0, conn = 0;
const N = 200;
for (let r = 0; r < N; r++) {
  const placed = tryPlaceAll(shuffleByLength(items), true, [pin]);
  const got = placed.find((p) => p.id === 'マツリ');
  if (got && same(got, pin) && got.pinned) keep++;
  if (placed.length > 1) around++;
  if (othersValid(placed)) valid++;
  if (isConnected(placed)) conn++;
}
check(keep === N, `(a) 固定した語は、試行 ${N}回とも指定の座標 (7,4)・縦のまま ${keep}/${N}`);
check(around === N && valid === N && conn === N, `(b) 残りの語は固定の周りに組まれ（${around}/${N}）、どれも置ける条件を通り（${valid}/${N}）、盤は1つにつながる（${conn}/${N}）`);
const mx = generateMaximizedPuzzle(items, 50, [pin]);
check(same(mx.find((p) => p.id === 'マツリ'), pin), `(a) 50回組む方でも固定の座標のまま（${mx.length}語）`);
let mcKeep = 0, mcSteps = 0;
for (const st of generateMonteCarloSteps(items, 50, [pin])) {
  if (st.isLast) continue;
  mcSteps++;
  if (same(st.placed.find((p) => p.id === 'マツリ'), pin)) mcKeep++;
}
check(mcSteps === 50 && mcKeep === 50, `(a) 演出の50回でも、どの回も固定の座標のまま ${mcKeep}/${mcSteps}`);
const s = createPuzzleSearch(items, 300, undefined, [pin]);
while (!s.finished()) s.step(30);
check(same(s.best().find((p) => p.id === 'マツリ'), pin), `(a) 本気の探索でも固定の座標のまま（${s.best().length}語・試行 ${s.attempts()}回）`);
// 組み上がった盤（buildGrid は左上を 0 にそろえる）でも、固定どうしの位置の差は変わらない
const pin2 = P('ハマグチ', 'horizontal', 6, 4); // マツリ の マ (7,4) と交わる
const placed2 = tryPlaceAll(shuffleByLength(items), true, [pin, pin2]);
const g = buildGrid(placed2);
const a1 = g.items.find((i) => i.id === 'マツリ'), a2 = g.items.find((i) => i.id === 'ハマグチ');
check(a1.startX - a2.startX === 1 && a1.startY - a2.startY === 0 && a1.pinned && a2.pinned, `(a) 2つ固定して組み上げた盤でも、固定どうしの位置の差はそのまま（差 ${a1.startX - a2.startX},${a1.startY - a2.startY}）・印も残る`);

// 固定どうしがつながらない時: 固定は固定のまま置き、置けた語が最多を探す。つながっていないことが分かる
const far = P('ツバサ', 'horizontal', 30, 30);
const placed3 = generateMaximizedPuzzle(items, 50, [pin, far]);
check(same(placed3.find((p) => p.id === 'ツバサ'), far) && same(placed3.find((p) => p.id === 'マツリ'), pin), `固定どうしがつながらない形でも、両方とも固定の座標のまま置く（${placed3.length}語）`);
check(!isConnected(placed3), '固定どうしがつながらない盤は「つながっていない」と分かる');
check(isConnected(tryPlaceAll(shuffleByLength(items))), '固定の無い盤は「つながっている」');

// (c) 動かした先の確かめ
const board = buildGrid([
  { ...W('ハマグチ'), uuid: 'h', direction: 'horizontal', startX: 0, startY: 0, length: 4 },
  { ...W('マツリ'), uuid: 'm', direction: 'vertical', startX: 1, startY: 0, length: 3 },
  { ...W('リズム'), uuid: 'r', direction: 'horizontal', startX: 1, startY: 2, length: 3 },
]);
const bi = board.items;
console.log(`(c) 盤 幅${board.width}×高さ${board.height}: ハマグチ 横(0,0)・マツリ 縦(1,0)・リズム 横(1,2)`);
check(canMoveTo(bi, 'm', 1, 0, board.width, board.height), '(c) 今の場所はその語自身を除いた盤で確かめるので置ける（自分と重なって弾かれない）');
check(!validatePlacement({ ...bi.find((i) => i.uuid === 'm') }, bi), '    （その語自身を含めた盤で確かめると弾かれる。除いて確かめている証拠）');
check(!canMoveTo(bi, 'm', 2, 0, board.width, board.height), '(c) マツリ を (2,0) へ: マ と グ がぶつかるので拒否');
check(!canMoveTo(bi, 'r', 0, 2, board.width, board.height), '(c) リズム を (0,2) へ: ズ と マツリ の リ がぶつかるので拒否');
check(!canMoveTo(bi, 'm', -1, 0), '(c) マツリ を枠の外 (-1,0) へ: どの語とも交わらないので拒否（枠の外かどうかでは断らない）');

// 枠の外の交わる所へ動かせて、盤が広がり、ほかの語との交わりが保たれる（Hop 決定 2026-10-05）
// 盤 アイウエオ 横(0,0)・オカキ 縦(4,0)（右端）・アサシ 縦(0,0)・サカナ 横(0,1)（アサシ の サ と交わる）
{
  const g = buildGrid([
    { ...W('アイウエオ'), uuid: 'h', direction: 'horizontal', startX: 0, startY: 0, length: 5 },
    { ...W('オカキ'), uuid: 'r', direction: 'vertical', startX: 4, startY: 0, length: 3 },
    { ...W('アサシ'), uuid: 'l', direction: 'vertical', startX: 0, startY: 0, length: 3 },
    { ...W('サカナ'), uuid: 's', direction: 'horizontal', startX: 0, startY: 1, length: 3 },
  ]);
  console.log(`(枠の外) 盤 幅${g.width}×高さ${g.height}。サカナ を右端の オカキ の カ (4,1) と交わる (3,1) へ（右へ1マスはみ出す）`);
  check(canMoveTo(g.items, 's', 3, 1), '(枠の外) 右端の語の先へはみ出す交わる所へは動かせる');
  const mv = moveItem(g.items, 's', 3, 1);
  const g2 = buildGrid(mv);
  const cells = new Map(g2.cells.map((c) => [`${c.x},${c.y}`, c]));
  const r2 = g2.items.find((i) => i.uuid === 'r'), s2 = g2.items.find((i) => i.uuid === 's');
  const cross = cells.get(`${r2.startX},${r2.startY + 1}`);
  check(g2.width === g.width + 1 && g2.height === g.height, `(枠の外) 置いた後は盤が広がる: 幅${g.width}→${g2.width}・高さ${g.height}→${g2.height}`);
  check(cross && cross.value === 'カ' && cross.horizontalItemId === 's' && cross.verticalItemId === 'r', '(枠の外) オカキ と サカナ は カ のマスで交わったまま');
  check(s2.startX === r2.startX - 1 && s2.startY === r2.startY + 1 && s2.pinned === true, '(枠の外) 動かした語に固定の印・ほかの語との位置の差もそのまま');
  check(e.isConnected(g2.items), '(枠の外) 動かした後の盤は1つにつながっている');
  // 上の外へ動かすと、ほかの語の座標が全部ずれる。固定した語どうしの位置の差は守る
  // 盤 アイウエオ 横(0,0)固定・オカキ 縦(4,0)固定・ミウ 縦(2,1)（下にぶら下がる・交わらない）を、ウ が アイウエオ の ウ と交わる (2,-1) へ
  const up = [
    { ...W('アイウエオ'), uuid: 'h', direction: 'horizontal', startX: 0, startY: 0, length: 5, pinned: true },
    { ...W('オカキ'), uuid: 'r', direction: 'vertical', startX: 4, startY: 0, length: 3, pinned: true },
    { ...W('ミウ'), uuid: 'u', direction: 'vertical', startX: 2, startY: 3, length: 2 },
  ];
  const mu = moveItem(up, 'u', 2, -1);
  const g3 = mu && buildGrid(mu);
  const h3 = g3 && g3.items.find((i) => i.uuid === 'h'), r3 = g3 && g3.items.find((i) => i.uuid === 'r');
  check(g3 && h3.startY === 1 && r3.startX - h3.startX === 4 && r3.startY - h3.startY === 0 && h3.pinned && r3.pinned,
    `(枠の外) 上の外へ動かすと盤が上へ広がり、ほかの語の座標が全部1行ずれても、固定した語どうしの位置の差はそのまま（${g3 ? `高さ ${g3.height}・アイウエオ (${h3.startX},${h3.startY})・オカキ (${r3.startX},${r3.startY})` : '動かせない'}）`);
}
check(!canMoveTo(bi, 'r', 0, 1, board.width, board.height), '(c) リズム を (0,1) へ: ツ と ズ がぶつかるので拒否');
// 島を作らない（Hop 決定 2026-10-05）。盤 アイアイア 横(0,0)・アカサ 縦(0,0)・サシス 横(0,2)
const isle = buildGrid([
  { ...W('アイアイア'), uuid: 'h', direction: 'horizontal', startX: 0, startY: 0, length: 5 },
  { ...W('アカサ'), uuid: 'v', direction: 'vertical', startX: 0, startY: 0, length: 3 },
  { ...W('サシス'), uuid: 's', direction: 'horizontal', startX: 0, startY: 2, length: 3 },
]);
const ii = isle.items;
const plain = (it, x, y) => validatePlacement({ ...ii.find((i) => i.uuid === it), startX: x, startY: y }, ii.filter((i) => i.uuid !== it));
check(plain('s', 2, 1) && !canMoveTo(ii, 's', 2, 1, isle.width, isle.height), '(c) サシス を (2,1) へ: 字はぶつからず盤にも収まるが、どの語とも交わらない（島になる）ので拒否');
check(moveItem(ii, 's', 2, 1, isle.width, isle.height) === null, '(c) 交わらない所へは動かさない（元のまま・印も付かない）');
check(plain('v', 4, 0) && !canMoveTo(ii, 'v', 4, 0, isle.width, isle.height), '(c) アカサ を (4,0) へ: アイアイア の ア と交わるが、サシス が離れて島になるので拒否');
check(canMoveTo(ii, 'v', 0, 0, isle.width, isle.height), '(c) アカサ は今の場所なら置ける');
// 固定した語を、別の固定した語と交わらない所へ動かす時も同じ
const pinnedIsle = ii.map((i) => ({ ...i, pinned: true }));
check(!canMoveTo(pinnedIsle, 's', 2, 1, isle.width, isle.height), '(c) 固定した語どうしでも、交わらない所へは動かせない');

// 置ける動かし先: 7語で組んだ盤で、今の場所以外に置ける所を総当たりで探し、そこへ動かす
let found = null, tried = 0;
for (let r = 0; r < 50 && !found; r++) {
  const g7 = buildGrid(tryPlaceAll(shuffleByLength(items)));
  for (const it of g7.items) {
    for (let x = 0; x < g7.width && !found; x++) for (let y = 0; y < g7.height && !found; y++) {
      if (x === it.startX && y === it.startY) continue;
      tried++;
      if (canMoveTo(g7.items, it.uuid, x, y, g7.width, g7.height)) found = { g7, it, x, y };
    }
    if (found) break;
  }
}
check(Boolean(found), `(c) 置ける動かし先が見つかる: ${found ? `${found.it.answer.join('')} を (${found.it.startX},${found.it.startY}) → (${found.x},${found.y})` : '無し'}（${tried}か所を確かめた）`);
const moved = found && moveItem(found.g7.items, found.it.uuid, found.x, found.y, found.g7.width, found.g7.height);
const mv = moved && moved.find((i) => i.uuid === found.it.uuid);
check(mv && mv.startX === found.x && mv.startY === found.y && mv.pinned === true && moved.filter((i) => i.pinned).length === 1, '(c) 置ける所へ動かすと、その座標に置かれ、動かした語にだけ固定の印が付く');
check(mv && validatePlacement(mv, moved.filter((i) => i !== mv)), '(c) 動かした後の語は、ほかの語に対して置ける条件を通る');
check(moveItem(bi, 'm', 2, 0, board.width, board.height) === null, '(c) 置けない所へは動かさない（元のまま）');

// (d) 固定を外すと普通の組み立てに戻る
let noPin = 0;
for (let r = 0; r < 50; r++) {
  const p = tryPlaceAll(shuffleByLength(items), true, []);
  if (p.every((i) => !i.pinned)) noPin++;
}
let mcNoPin = 0;
for (const st of generateMonteCarloSteps(items, 50, [])) if (!st.isLast && st.placed.every((i) => !i.pinned)) mcNoPin++;
check(noPin === 50 && mcNoPin === 50, `(d) 固定を外した組み立てでは、どの語にも固定の印が無い（${noPin}/50・演出 ${mcNoPin}/50）`);
let moves = 0;
for (let r = 0; r < 100; r++) {
  const m = tryPlaceAll(shuffleByLength(items), true, []).find((p) => p.id === 'マツリ');
  if (m && !same(m, pin)) moves++;
}
check(moves > 0, `(d) 固定を外すと マツリ は (7,4) に縛られない（100回中 ${moves}回は別の場所）`);

console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
