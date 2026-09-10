// 💎の絵（スプライト）の置き場と、焼く順番の采配。
//
// 落ちてくる💎と積もった💎は、毎フレーム面を塗り直すのではなく、
// 「石の向きごとに一度だけ描いた絵」を貼って出している。ここはその絵を配る窓口。
//
// 絵は2通りある。
//   本物   … gemRenderer.ts が屈折・全反射・分散まで計算して焼いた絵。焼くのに時間がかかる
//   代わり … 今までの平らな面の絵（gemFacets.ts）。すぐ作れる
//
// 配り方の決めごと
//   1. 頼まれた色の本物がまだ無ければ、その場では代わりの絵を返す。
//      待たせない＝💎が消えたり画面が固まったりしない
//   2. 本物は裏で少しずつ焼く。焼き上がった瞬間に、次のフレームから本物へ入れ替わる
//   3. 焼いている途中の中途半端な絵は絶対に外へ出さない（貼る時に穴が開くのを防ぐ）
//   4. 焼くのに失敗した色は、その色だけ諦めて代わりの絵を使い続ける。焼き直しはしない
//
// 石の向きは「飛び方の通り道4本 × 24コマ」の96通り。落ちている💎も積もった💎も同じ絵を使う。
// 本物は立体なので「絵ごと回す」ことができず、どちらも
// 「石を回した絵を、回さずに貼る」形に揃えてある。
import { hexToRgb, paintFacets } from "./gemFacets";
import { startBake, prepareGemRenderer, type BakeJob, type Pose } from "./gemRenderer";

// ── 飛び方の通り道 ──────────────────────────────────────────
// 石の向きは3つの軸で決まるが、全部の組み合わせを焼くと3万枚を超えて手に負えない。
// 一方、画面の中で寝かせる軸だけは焼いた絵をそのまま回して貼れるのでタダ。
// そこで残る2軸（倒す角と、その軸のまわりに回る角）を格子で焼くのではなく、
// 「倒しながら回る動き」を何通りかのパラパラ漫画にして、その通り道の上だけを焼く（Hop案 2026-09-10）。
// 枚数は「通り道の数 × コマ数」で済み、格子より少ない枚数で本物の転がりになる。
/** 通り道1本あたりのコマ数。1周してぴったり元へ戻るので、つなぎ目は出ない */
export const TUMBLE_FRAMES = 24;
/** 飛び方の通り道。tilt0=倒す角の真ん中、amp=そこから上下に振る幅、turns=1周する間に何回まわるか、
 *  phase=振り始める位置。倒す角は 0度＝ほぼ真横から見た三角、90度＝上の平らな面がこちらを向く、
 *  90度を越えると裏（尖った側）が見える【仮】 */
const TUMBLE_PATHS_DEF = [
  { tilt0: 40, amp: 38, turns: 1, phase: 0 },
  { tilt0: 58, amp: 52, turns: 2, phase: Math.PI / 2 },
  { tilt0: 30, amp: 28, turns: 2, phase: Math.PI },
  { tilt0: 72, amp: 44, turns: 1, phase: Math.PI * 1.5 },
] as const;
/** 通り道の数。💎ごとにこの中から1本を抽選する */
export const TUMBLE_PATHS = TUMBLE_PATHS_DEF.length;
/** 焼く絵の総数 */
export const STONE_STEPS = TUMBLE_PATHS * TUMBLE_FRAMES;

/** 焼く姿勢を、通り道の順に並べたもの */
function buildPoses(): Pose[] {
  const out: Pose[] = [];
  for (const p of TUMBLE_PATHS_DEF) {
    for (let i = 0; i < TUMBLE_FRAMES; i++) {
      const t = i / TUMBLE_FRAMES;
      const deg = p.tilt0 + p.amp * Math.sin(t * Math.PI * 2 + p.phase);
      out.push({ tilt: (deg * Math.PI) / 180, spin: t * Math.PI * 2 * p.turns });
    }
  }
  return out;
}
/** 焼く姿勢は毎回同じなので一度だけ作る。枠決めの控えを引く合言葉も一緒に持つ */
let poses: Pose[] | null = null;
const POSE_KEY = "tumble" + TUMBLE_PATHS + "x" + TUMBLE_FRAMES;
function getPoses(): Pose[] {
  return (poses ??= buildPoses());
}
/** 絵の1辺(px)。実際に貼る大きさ（世界座標で最大 size 36 × 2 ≒ 72px）を余裕込みで包む */
export const STONE_PX = 96;
/** 代わりの絵で使う固定の光の向き（左上から）。今までの💎と同じ値 */
export const SPRITE_LIGHT = -Math.PI / 3;

// 裏で焼く時の刻み方。持ち時間ぶんだけ焼いて休む、を繰り返す。
// 1回の持ち時間を長くすると早く焼き上がるが、その間だけ画面がひっかかる
const SLICE_MS = 6;      // 一度に焼き続ける時間の上限【仮】
const SLICE_GAP_MS = 32; // 次の一刻みまで休む時間【仮】

const realCache = new Map<string, HTMLCanvasElement[]>();
const fallbackCache = new Map<string, HTMLCanvasElement[]>();
/** 本物を諦めた色。端末が対応していない／途中で失敗した場合に入る */
const givenUp = new Set<string>();
/** 焼く順番待ちに入っている色 */
const waiting = new Set<string>();
const queue: [number, number, number][] = [];

let job: BakeJob | null = null;
let jobKey = "";
let timer: ReturnType<typeof setTimeout> | 0 = 0;

function keyOf(rgb: [number, number, number]): string {
  return rgb.join(",");
}
function hexOf(rgb: [number, number, number]): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + h(rgb[0]) + h(rgb[1]) + h(rgb[2]);
}

/** 今までの描き方の絵。石を回した絵を向きごとに持つ（貼る時は回さない） */
function buildFallback(rgb: [number, number, number]): HTMLCanvasElement[] {
  const arr: HTMLCanvasElement[] = [];
  // 代わりの絵は平らな絵なので傾きを表せない。段の数だけ同じ並びを繰り返して枚数だけ合わせる
  for (let i = 0; i < STONE_STEPS; i++) {
    const c = document.createElement("canvas");
    c.width = STONE_PX;
    c.height = STONE_PX;
    const cx = c.getContext("2d");
    if (cx) {
      const ang = ((i % TUMBLE_FRAMES) / TUMBLE_FRAMES) * Math.PI * 2;
      cx.translate(STONE_PX / 2, STONE_PX / 2);
      cx.rotate(ang);
      cx.scale((STONE_PX / 2) * 0.95, (STONE_PX / 2) * 0.95);
      paintFacets(cx, rgb, ang, SPRITE_LIGHT);
    }
    arr.push(c);
  }
  return arr;
}

function schedule() {
  if (timer) return;
  if (!job && queue.length === 0) return;
  timer = setTimeout(pump, SLICE_GAP_MS);
}

function pump() {
  timer = 0;
  if (!job) {
    const rgb = queue.shift();
    if (!rgb) return;
    const key = keyOf(rgb);
    if (realCache.has(key) || givenUp.has(key)) {
      waiting.delete(key);
      schedule();
      return;
    }
    job = startBake(hexOf(rgb), STONE_PX, getPoses(), POSE_KEY);
    jobKey = key;
    if (!job) {
      // 端末がこの描き方に対応していない。以後どの色も焼かず、代わりの絵で通す
      givenUp.add(key);
      waiting.delete(key);
      for (const r of queue) givenUp.add(keyOf(r));
      queue.length = 0;
      waiting.clear();
      return;
    }
  }
  try {
    job.advance(SLICE_MS);
  } catch (e) {
    console.warn("[灰toダイヤモンド] " + jobKey + " の宝石を焼けなかった。今までの描き方で出す:", e);
    givenUp.add(jobKey);
    waiting.delete(jobKey);
    job = null;
    schedule();
    return;
  }
  if (job.finished) {
    // 焼き上がった一式を丸ごと差し替える。途中の配列は外に出していないので、
    // 貼る側から見ると「あるフレームを境に絵が本物に変わる」だけになる
    realCache.set(jobKey, job.frames);
    waiting.delete(jobKey);
    job = null;
  }
  schedule();
}

/** その色の本物を焼くよう頼んでおく（すぐには焼かない）。
 *  「はじめる」を押す前や、押した直後の再生が始まったあとに呼ぶ想定。
 *  front=true にすると順番待ちの先頭へ割り込む。自分が選んでいる色は真っ先に降るので割り込ませる。
 *  すでに焼いている途中の色は止めない（中途半端な絵を外へ出さないため） */
export function requestStoneSprites(rgb: [number, number, number], front = false) {
  const key = keyOf(rgb);
  if (realCache.has(key) || givenUp.has(key)) return;
  if (waiting.has(key)) {
    if (!front) return;
    const at = queue.findIndex((r) => keyOf(r) === key);
    if (at > 0) queue.unshift(queue.splice(at, 1)[0]);
    return;
  }
  waiting.add(key);
  if (front) queue.unshift(rgb); else queue.push(rgb);
  schedule();
}

/** 色（hex）を指定して焼くよう頼む */
export function requestStoneSpritesByHex(hex: string, front = false) {
  requestStoneSprites(hexToRgb(hex), front);
}

/** 出てくる色ぜんぶを、入口を開いた時点で焼き始める。
 *  1色あたりの実時間が長い（手元のパソコンで約15秒）ので、「はじめる」を押してから頼んでいると
 *  曲が終わるまでに焼き終わらない色が出る。入口は止まっている画面なので、ここで焼いても引っかからない。
 *  順番は渡された並びのまま。自分が選んでいる色は setOwnColor から割り込ませる */
export function requestAllStoneSprites(hexes: readonly string[]) {
  for (const hex of hexes) requestStoneSprites(hexToRgb(hex));
}

/** 描く道具の支度だけ先に済ませる。形の組み立て・環境の描画・計算式の組み上げがここで終わる。
 *  「はじめる」を押した瞬間に重い処理が走らないよう、画面を開いた少し後に一度だけ呼ぶ */
export function warmUpGemRenderer() {
  setTimeout(() => {
    try {
      prepareGemRenderer();
    } catch (e) {
      console.warn("[灰toダイヤモンド] 宝石の支度でつまずいた。今までの描き方で出す:", e);
    }
  }, 0);
}

/** 貼るための絵を1色ぶん受け取る。必ず48枚そろった配列が返る。
 *  本物がまだ無ければ代わりの絵を返し、裏で焼くよう頼んでおく */
export function getStoneSprites(rgb: [number, number, number]): HTMLCanvasElement[] {
  const key = keyOf(rgb);
  const real = realCache.get(key);
  if (real) return real;
  if (!givenUp.has(key)) requestStoneSprites(rgb);
  let fb = fallbackCache.get(key);
  if (!fb) {
    fb = buildFallback(rgb);
    fallbackCache.set(key, fb);
  }
  return fb;
}

/** 積もった山も降っている💎も、この並びから絵を選ぶ。
 *  path は💎ごとに持っている飛び方の通り道、ang はその通り道のどこまで進んだか */
export function stoneIndex(ang: number, path = 0): number {
  const f = ((Math.round((ang / (Math.PI * 2)) * TUMBLE_FRAMES) % TUMBLE_FRAMES) + TUMBLE_FRAMES) % TUMBLE_FRAMES;
  const p = ((path % TUMBLE_PATHS) + TUMBLE_PATHS) % TUMBLE_PATHS;
  return p * TUMBLE_FRAMES + f;
}
