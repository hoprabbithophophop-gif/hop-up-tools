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
// その後ろに、ミラーボールの席に刺す石だけが使う32通りを足してある。合わせて128通り。
// 本物は立体なので「絵ごと回す」ことができず、どちらも
// 「石を回した絵を、回さずに貼る」形に揃えてある。
import { hexToRgb, paintFacets } from "./gemFacets";
import { startBake, prepareGemRenderer, GEM_FIT, type BakeJob, type Pose } from "./gemRenderer";

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
/** 転がり用に焼く絵の数 */
export const STONE_STEPS = TUMBLE_PATHS * TUMBLE_FRAMES;

// ── 球に刺す石だけの姿勢 ───────────────────────────────────
// ミラーボールの席は「頭の奥行きがこれくらい」という注文で絵を選ぶ。
// 転がり用の96枚から一番近いものを選んでいたが、あの96枚は転がる動きのための並びなので、
// 奥行きが隣どうしの絵でも見た目が全然違う。球が回ると席ごとに絵がぱらぱら差し替わり、
// コマ送りのように見えていた。Hop報告 2026-09-11。
// そこで、回りを0に固定して倒す角だけを変えた並びを別に焼き足す。
// 回りが0なら頭の向きの奥行きはそのまま sin(倒す角) になるので、
// 奥行きから絵を選ぶのも角度を戻すだけで済む。
// 刻むのは奥行きではなく倒す角の方。奥行きを等間隔に刻むと、真正面に近い所で
// 倒す角が急に伸びて、最後の2枚だけ14.6度も離れてしまう。
// 倒す角で等間隔に刻めば、隣どうしはどこでも 2.9度差でそろう
/** 球に刺す石のために焼き足す絵の数【仮】。0枚目が真横＝倒す角0度、最後の1枚が真正面＝倒す角90度 */
export const BALL_STEPS = 32;

/** 焼く姿勢を、通り道の順に並べたもの。後ろに球専用の並びが続く */
function buildPoses(): Pose[] {
  const out: Pose[] = [];
  for (const p of TUMBLE_PATHS_DEF) {
    for (let i = 0; i < TUMBLE_FRAMES; i++) {
      const t = i / TUMBLE_FRAMES;
      const deg = p.tilt0 + p.amp * Math.sin(t * Math.PI * 2 + p.phase);
      out.push({ tilt: (deg * Math.PI) / 180, spin: t * Math.PI * 2 * p.turns });
    }
  }
  for (let k = 0; k < BALL_STEPS; k++) {
    out.push({ tilt: (k / (BALL_STEPS - 1)) * (Math.PI / 2), spin: 0 });
  }
  return out;
}
/** 焼く姿勢は毎回同じなので一度だけ作る。枠決めの控えを引く合言葉も一緒に持つ。
 *  合言葉は並びが変わったら必ず変える。古い並びで測った枠を引いてしまうと石の大きさが揃わない */
let poses: Pose[] | null = null;
const POSE_KEY = "tumble" + TUMBLE_PATHS + "x" + TUMBLE_FRAMES + "+ball" + BALL_STEPS;
function getPoses(): Pose[] {
  return (poses ??= buildPoses());
}
/** 絵の1辺(px)。実際に貼る大きさ（世界座標で最大 size 36 × 2 ≒ 72px）を余裕込みで包む */
export const STONE_PX = 96;
/** 代わりの絵で使う固定の光の向き（左上から）。今までの💎と同じ値 */
export const SPRITE_LIGHT = -Math.PI / 3;
/** 絵の中で、石の形の長さ1つぶんが何pxになるか。
 *  焼く時の枠は「どの姿勢でもはみ出さない一番大きい箱」で決まり、その半分は腰の半径＝1つぶんにあたる。
 *  貼る側は「腰の直径を何pxにしたいか」から、この値を使って絵の一辺を逆算する */
export const STONE_LOCAL_PX = (STONE_PX / 2) * GEM_FIT;

// ── 石の頭がどちらを向いているか ───────────────────────────
// 焼く時は、先に横の軸まわりに tilt だけ倒し、次に画面の縦の軸まわりに spin だけ回している。
// なので石の頭は、カメラから見て (sin(tilt)sin(spin), cos(tilt), sin(tilt)cos(spin)) の方を向く。
// 貼る時に絵ごと回せるのは画面の中だけ＝紙を回しても手前と奥は入れ替わらないので、
// 奥行きの分だけは絵を選んで合わせるしかない。そこで「欲しい奥行きに一番近い姿勢」を選び、
// 残りの向きのずれは絵を回して合わせる。
/** 姿勢ごとの、石の頭の向き。x右・y上・z手前 */
export const STONE_AXIS: readonly { x: number; y: number; z: number }[] = getPoses().map((p) => ({
  x: Math.sin(p.tilt) * Math.sin(p.spin),
  y: Math.cos(p.tilt),
  z: Math.sin(p.tilt) * Math.cos(p.spin),
}));
/** 一番こちらを向いている絵。真上から見た姿に近い1枚が要る所で使う。
 *  球専用の並びの最後の1枚が、そのまま真正面を向いた姿になる */
export const STONE_FACE_INDEX: number = STONE_STEPS + BALL_STEPS - 1;
/** 頭をこの奥行きへ向けたい時に使う絵の番号を返す。引くのは球専用の並びから。
 *  並んでいるのは倒す角なので、奥行きを角度へ戻してから割り当てる。
 *  asin を1コマにつき席の数だけ呼ぶことになるが、表を引くより絵の刻みが素直になる方を採る。
 *  奥を向いている石は真横の1枚で足りる */
export function stoneIndexForDepth(z: number): number {
  if (z <= 0) return STONE_STEPS;
  const k = Math.round((Math.asin(z < 1 ? z : 1) / (Math.PI / 2)) * (BALL_STEPS - 1));
  return STONE_STEPS + k;
}

/** 本物が焼き上がって差し替わるたびに1増える数。
 *  貼る側は、この数が前と違っていた時だけ絵を引き直せばよい＝毎フレーム引きに行かなくて済む */
let generation = 0;
export function stoneGeneration(): number {
  return generation;
}

// 裏で焼く時の刻み方。持ち時間ぶんだけ焼いて休む、を繰り返す。
// 1回の持ち時間を長くすると早く焼き上がるが、その間だけ画面がひっかかる
const SLICE_MS = 6;      // 一度に焼き続ける時間の上限【仮】
const SLICE_GAP_MS = 32; // 次の一刻みまで休む時間【仮】
// 入口では画面がほぼ止まっているので急いで焼く。再生が始まったら動画を邪魔しないよう元のペースへ戻す
const SLICE_MS_HURRY = 24;    // 急ぐ時に一度に焼き続ける時間の上限【仮】
const SLICE_GAP_MS_HURRY = 8; // 急ぐ時に次の一刻みまで休む時間【仮】
let hurry = false;
/** 急ぐかどうかを切り替える。切り替えた時にもう待っている一刻みは、前の間隔のまま1回動く */
export function setStoneBakeHurry(on: boolean) {
  hurry = on;
}

/** 一番はじめに焼き始めた時刻。1回だけ控える */
let bakeT0 = 0;
/** 最後の色が焼き上がった時刻。焼き上がるたびに上書きする */
let bakeLastAt = 0;
/** どれくらいで焼き上がったかの読み取り。実機で秒数を確かめるために使う。
 *  started=焼き始めているか、done=順番待ちが空で焼いている途中の色も無いか、
 *  ms=焼き上がっていればかかった時間、途中なら始めてから今までの時間、colors=焼き上がった色の数 */
export function stoneBakeReport(): { started: boolean; done: boolean; ms: number; colors: number } {
  const started = bakeT0 > 0;
  const done = !job && queue.length === 0;
  const end = done && bakeLastAt > 0 ? bakeLastAt : performance.now();
  return { started, done, ms: started ? end - bakeT0 : 0, colors: realCache.size };
}

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
  // 代わりの絵は平らな絵なので傾きを表せない。段の数だけ同じ並びを繰り返して枚数だけ合わせる。
  // 球専用の分も、転がり用と同じ並びをそのまま続ける
  for (let i = 0; i < STONE_STEPS + BALL_STEPS; i++) {
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
  timer = setTimeout(pump, hurry ? SLICE_GAP_MS_HURRY : SLICE_GAP_MS);
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
    if (!bakeT0) bakeT0 = performance.now();   // 焼き始めた時刻。読み取りの起点なので最初の1回だけ
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
    job.advance(hurry ? SLICE_MS_HURRY : SLICE_MS);
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
    bakeLastAt = performance.now();   // 今のところ最後に焼き上がった時刻。読み取りの終点
    generation++;   // 絵が入れ替わった合図。貼る側はこの数を見て引き直す
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
 *  焼くのにかかる時間は機械次第で、描画装置のある機械なら13色で3.2秒、ページの読み込みと重なると5〜6秒。
 *  ただし機械の頭だけで描く環境では100秒を超える。数字は2026-09-11の実測。「はじめる」を押してから頼んでいると
 *  曲が終わるまでに焼き終わらない色が出る。入口は止まっている画面なので、ここで焼いても引っかからない。
 *  順番は渡された並びのまま。自分が選んでいる色は setOwnColor から割り込ませる。
 *  なお上の数字は96枚の頃の実測で、球専用の32枚を足したぶん3割ほど増える見込み。足した後は測っていない */
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

/** 貼るための絵を1色ぶん受け取る。必ず96＋32枚そろった配列が返る。
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

/** その色の本物がもう焼き上がっているか。
 *  焼け待ちの間だけ別の絵で代役を立てたい所が、代わりの絵を掴まされたかどうかを見分けるのに使う */
export function hasRealStoneSprites(rgb: [number, number, number]): boolean {
  return realCache.has(keyOf(rgb));
}

/** 渡された色ぜんぶの焼き上がりが済んでいるか。
 *  本物が焼き上がった色と、焼くのを諦めた色を「済み」として数える。
 *  諦めた色まで待つと、立体を描けない端末でいつまでも待たされることになるため。
 *  石と代わりの板が混ざって出るのを避けたい所が、待ってよい頃合いを見るのに使う */
export function stonesSettled(hexes: readonly string[]): boolean {
  for (const hex of hexes) {
    const key = keyOf(hexToRgb(hex));
    if (!realCache.has(key) && !givenUp.has(key)) return false;
  }
  return true;
}

/** 積もった山も降っている💎も、この並びから絵を選ぶ。
 *  path は💎ごとに持っている飛び方の通り道、ang はその通り道のどこまで進んだか */
export function stoneIndex(ang: number, path = 0): number {
  const f = ((Math.round((ang / (Math.PI * 2)) * TUMBLE_FRAMES) % TUMBLE_FRAMES) + TUMBLE_FRAMES) % TUMBLE_FRAMES;
  const p = ((path % TUMBLE_PATHS) + TUMBLE_PATHS) % TUMBLE_PATHS;
  return p * TUMBLE_FRAMES + f;
}
