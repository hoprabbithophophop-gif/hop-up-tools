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
// 石の向きは「傾き3段 × 1回転32段階」の96通り。落ちている💎も積もった💎も同じ絵を使う。
// 本物は立体なので「絵ごと回す」ことができず、どちらも
// 「石を回した絵を、回さずに貼る」形に揃えてある。
import { hexToRgb, paintFacets } from "./gemFacets";
import { startBake, prepareGemRenderer, type BakeJob } from "./gemRenderer";

/** 石を1回転させる時の段階数。落ちている💎が回るので、粗いと回転がカクつく */
export const SPIN_STEPS = 32;
/** 石の傾きの段（度）。石の軸をカメラ側へ何度倒すかを何通りか焼いておき、
 *  💎ごとにどれか1つを持たせる。1通りだけだとどの💎も同じ横顔で飛ぶ（Hop指摘 2026-09-10）。
 *  浅い＝ほぼ真横から見た三角、深い＝上の平らな面（テーブル）がこちらを向く【仮】 */
export const TILTS_DEG = [12, 34, 62];
/** 傾きの段の数。💎ごとにこの中から1つ選ぶ */
export const TILT_ROWS = TILTS_DEG.length;
/** 焼く絵の総数。傾きの段ごとに1回転ぶん持つ */
export const STONE_STEPS = SPIN_STEPS * TILT_ROWS;
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
      const ang = ((i % SPIN_STEPS) / SPIN_STEPS) * Math.PI * 2;
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
    job = startBake(hexOf(rgb), SPIN_STEPS, STONE_PX, TILTS_DEG);
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
 *  「はじめる」を押す前や、押した直後の再生が始まったあとに呼ぶ想定 */
export function requestStoneSprites(rgb: [number, number, number]) {
  const key = keyOf(rgb);
  if (realCache.has(key) || givenUp.has(key) || waiting.has(key)) return;
  waiting.add(key);
  queue.push(rgb);
  schedule();
}

/** 色（hex）を指定して焼くよう頼む */
export function requestStoneSpritesByHex(hex: string) {
  requestStoneSprites(hexToRgb(hex));
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

/** 積もった山も降っている💎も、この段階数で向きを丸めて絵を選ぶ。
 *  row は💎ごとに持っている傾きの段。段ごとに SPIN_STEPS 枚ずつ並んでいる */
export function stoneIndex(ang: number, row = 0): number {
  const spin = ((Math.round((ang / (Math.PI * 2)) * SPIN_STEPS) % SPIN_STEPS) + SPIN_STEPS) % SPIN_STEPS;
  const r = ((row % TILT_ROWS) + TILT_ROWS) % TILT_ROWS;
  return r * SPIN_STEPS + spin;
}
