// 夜空へ放つ演出と星空。飛んでいる粒・星・瞬きをここに集めた。
// DiamondCanvas.tsx から切り出しただけで、中身は変えていない。
import { MAX_DPR, type Gem } from "./pile";

// 夜空へ放つ演出（曲の最後のフレーズ）の値。数字は全部【仮】、実機で見て決める
const LAUNCH_MAX = 6000;         // 一斉に放つ粒の数の上限。これより多い山は等間隔に間引く
const LAUNCH_FLY_MS = 1600;      // 山の粒が夜空の行き先へ着くまで
const LAUNCH_FLY_JITTER = 500;   // 粒ごとの着く時刻のばらつき（全部が同時に着かないように）
const SPAWN_FLY_MS = 800;        // 放った後に押した分が星になるまで
const SKY_Y_BIAS = 1.25;         // 行き先の縦の偏り。1より大きいほど画面の上の方が密になる
const FLY_BOW_MIN = 20;          // 弧の膨らみ(px)。まっすぐ飛ばずに少し持ち上がる
const FLY_BOW_RANGE = 60;
const FLY_DOT_MIN = 3;           // 飛んでいる粒の直径(px)。面の計算はせず色つきの小さな丸で描く
const FLY_DOT_RANGE = 3;
export const STAR_MIN = 2;              // 星の点の直径(px)
export const STAR_RANGE = 2;
const SELF_LAUNCH_Y = 230;       // 放った後の自分の💎の出発点。画面の下端からこれだけ上＝色の帯（下端から約120px）とその下地のはっきり上。140 だと帯の下地の裏に隠れて見えないことがあった（Hop指摘 2026-09-08）【仮】
const SELF_LAUNCH_SPREAD = 40;   // 同上の縦のばらつき。押すたびに同じ高さから出ると、閃光が一直線に並んで機械的に見える
const SKY_SPARK_RATE = 6;        // 星の瞬きの頻度（毎秒）。曲の終わりの山と同じ水準
const SKY_SPARK_RATE_HL = 9;     // ハイライト再生中（選んだ色の星だけ）の頻度
const SKY_SPARK_SIZE = 7;        // 星の瞬きの大きさ（閃光の半径の元・画面座標）
export const SKY_FLASH_SIZE = 10;       // 放った後に押した手応えの閃光の大きさ（画面座標）

/** 夜空へ飛んでいる粒（画面座標）。飛び終わると星になって、星空の1枚の絵へ焼き込まれる */
export type SkyFly = {
  x0: number; y0: number;   // 出発（画面座標）
  x1: number; y1: number;   // 行き先（画面座標）
  bow: number;              // 弧の膨らみ(px)。まっすぐ飛ばずに少し持ち上がる
  t0: number;               // 飛び始めた時刻(ms)
  dur: number;              // 飛ぶ時間(ms)
  d: number;                // 粒の直径(px)
  rgb: [number, number, number];
  /** 自分が押した分。取り消し（スワイプの空振り）で消せるようにする */
  self: boolean;
};

/** 夜空の星（画面座標）。位置は星空の絵へ焼き込んだ後も、瞬きの抽選のために覚えておく */
export type SkyStar = { x: number; y: number; d: number; rgb: [number, number, number] };

// 夜空の星と、飛んでいる粒の丸。どちらも面の計算はせず、色ごとに一度だけ描いた絵を大きさを変えて貼る。
// 数千個が同時に動くので、1個ごとに描き方を組み立てないのが肝（発熱対策）。
const STAR_PX = 64;
export const STAR_CORE = 0.16;   // 絵の中で「点」に見える芯の割合。芯の直径 d の星は d/STAR_CORE の大きさで貼る
const starCache = new Map<string, HTMLCanvasElement>();
const DOT_PX = 32;
const DOT_CORE = 0.45;    // 同上（粒は芯が大きく、滲みは狭い）
const dotCache = new Map<string, HTMLCanvasElement>();
export function makeRadial(px: number, stops: [number, string][]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = px; c.height = px;
  const cx = c.getContext("2d");
  if (cx) {
    const grad = cx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
    for (const [o, col] of stops) grad.addColorStop(o, col);
    cx.fillStyle = grad;
    cx.fillRect(0, 0, px, px);
  }
  return c;
}
/** 星: 白い芯＋その人の色の、ごく薄い光の滲み */
export function getStar(rgb: [number, number, number]): HTMLCanvasElement {
  const key = rgb.join(",");
  let c = starCache.get(key);
  if (c) return c;
  const [r, g, b] = rgb;
  c = makeRadial(STAR_PX, [
    [0, "rgba(255,255,255,0.95)"],
    [STAR_CORE, `rgba(${r},${g},${b},0.8)`],
    [0.34, `rgba(${r},${g},${b},0.07)`],   // 滲みは「ごく薄い」。数千個を重ねる（lighter）ので、濃いと白く飽和する【仮】
    [1, `rgba(${r},${g},${b},0)`],
  ]);
  starCache.set(key, c);
  return c;
}
/** 飛んでいる粒: その色の小さな丸 */
export function getDot(rgb: [number, number, number]): HTMLCanvasElement {
  const key = rgb.join(",");
  let c = dotCache.get(key);
  if (c) return c;
  const [r, g, b] = rgb;
  c = makeRadial(DOT_PX, [
    [0, "rgba(255,255,255,0.9)"],
    [DOT_CORE, `rgba(${r},${g},${b},0.9)`],
    [0.75, `rgba(${r},${g},${b},0.25)`],
    [1, `rgba(${r},${g},${b},0)`],
  ]);
  dotCache.set(key, c);
  return c;
}

/** 夜空の行き先（画面座標）。画面全体に散らし、縦は上の方が少し密になるよう偏らせる */
export function skyTarget(W: number, H: number): { x: number; y: number } {
  return { x: Math.random() * W, y: H * Math.pow(Math.random(), SKY_Y_BIAS) };
}

/** 星空の絵（画面座標そのまま）。星になった粒はここへ描き移し、以後は毎フレームこの1枚を貼るだけ */
export type SkyState = {
  canvas: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null;
  /** starsRef のうち何個目まで焼き込んだか。0 に戻すと全部焼き直す */
  baked: number;
};
export function createSkyState(): SkyState {
  return { canvas: null, baked: 0 };
}

/** 飛び終わった粒を星にする。位置は色ごとの控えにも入れて、瞬きの抽選で色を絞れるようにする。
 *  d を渡すと星の大きさを指定できる（壁の粒が縮んで星になる時に、縮み先の大きさを先に決めておくため） */
export function addStar(
  stars: SkyStar[], byColor: Map<string, number[]>,
  x: number, y: number, rgb: [number, number, number], d?: number,
) {
  stars.push({ x, y, d: d ?? STAR_MIN + Math.random() * STAR_RANGE, rgb });
  const key = rgb.join(",");
  const arr = byColor.get(key);
  if (arr) arr.push(stars.length - 1); else byColor.set(key, [stars.length - 1]);
}

/** ミラーボール方式で夜空へ放つ。球の表面の鏡が、そのまま夜空へ散る。出発点はいま画面に見えている位置。
 *  球の鏡は、壁の粒になった数（spots）を除いた残りの席へ飛ぶ＝星の総数は今までと同じ */
export function launchBallToSky(
  ball: { occ: number[]; sprites: (HTMLCanvasElement[] | null)[]; rgb: Uint8Array },
  lat: Float32Array, fly: SkyFly[], now: number, W: number, H: number,
  cx: number, bcy: number, bR: number,
  cs: number, sn: number, ct: number, st: number, spots: number,
) {
  const occ = ball.occ;            // 取ってある席（取った順）
  const filled = occ.length;
  const n = Math.max(0, Math.min(filled, LAUNCH_MAX) - spots);
  const step = n > 0 ? filled / n : 1;
  for (let k = 0; k < n; k++) {
    const slot = occ[Math.floor(k * step)];
    if (!ball.sprites[slot]) continue;   // まだ埋まっていない席（飛んでいる途中の💎の分）は粒にしない
    const o = slot * 4, oc = slot * 3;   // 席の向きは4つ組、色は3つ組で持っている
    const x1 = lat[o] * cs + lat[o + 2] * sn;
    const z1 = -lat[o] * sn + lat[o + 2] * cs;
    const y2 = lat[o + 1] * ct - z1 * st;
    const tgt = skyTarget(W, H);
    fly.push({
      x0: cx + x1 * bR, y0: bcy - y2 * bR,
      x1: tgt.x, y1: tgt.y,
      bow: FLY_BOW_MIN + Math.random() * FLY_BOW_RANGE,
      t0: now, dur: LAUNCH_FLY_MS + Math.random() * LAUNCH_FLY_JITTER,
      d: FLY_DOT_MIN + Math.random() * FLY_DOT_RANGE,
      rgb: [ball.rgb[oc], ball.rgb[oc + 1], ball.rgb[oc + 2]], self: false,
    });
  }
}

/** 山の方式で夜空へ放つ。粒の元は「積もった💎の位置の控え（焼き込んだ分も含む）」＋「まだ落ちている途中の💎」 */
export function launchPileToSky(
  sparkPoints: { x: number; y: number; rgb: [number, number, number]; size: number }[],
  gems: Gem[], fly: SkyFly[], now: number, W: number, H: number,
  scale: number, cx: number, oy: number, floorY: number,
) {
  const src: { x: number; y: number; rgb: [number, number, number] }[] = sparkPoints.slice();
  for (const g of gems) if (!g.settled) src.push({ x: g.x, y: g.y, rgb: g.rgb });
  const n = Math.min(src.length, LAUNCH_MAX);
  const step = n > 0 ? src.length / n : 1;   // 多すぎる時は等間隔に間引く
  for (let k = 0; k < n; k++) {
    const s = src[Math.floor(k * step)];
    const tgt = skyTarget(W, H);
    fly.push({
      x0: cx + (s.x - cx) * scale,          // 世界座標のいまの見え方＝画面座標から出発する
      y0: H + oy + (s.y - floorY) * scale,
      x1: tgt.x, y1: tgt.y,
      bow: FLY_BOW_MIN + Math.random() * FLY_BOW_RANGE,
      t0: now, dur: LAUNCH_FLY_MS + Math.random() * LAUNCH_FLY_JITTER,
      d: FLY_DOT_MIN + Math.random() * FLY_DOT_RANGE,
      rgb: s.rgb, self: false,
    });
  }
}

/** 押した分が星になるまでの飛び。放った後に押された💎はそのまま夜空へ向かう */
export function spawnFlyToSky(
  fly: SkyFly[], now: number, W: number, H: number, self: boolean, rgb: [number, number, number],
): { x0: number; y0: number } {
  const x0 = Math.random() * W;
  const y0 = self ? H - SELF_LAUNCH_Y + (Math.random() - 0.5) * SELF_LAUNCH_SPREAD : H;
  const tgt = skyTarget(W, H);
  fly.push({
    x0, y0, x1: tgt.x, y1: tgt.y,
    bow: FLY_BOW_MIN + Math.random() * FLY_BOW_RANGE,
    t0: now, dur: SPAWN_FLY_MS,
    d: FLY_DOT_MIN + Math.random() * FLY_DOT_RANGE,
    rgb, self,
  });
  return { x0, y0 };
}

/** 飛び終わった粒を星にする（先に済ませて、この後の焼き込みに間に合わせる＝1コマ消える瞬間を作らない） */
export function promoteFlies(
  fly: SkyFly[], stars: SkyStar[], byColor: Map<string, number[]>, now: number,
) {
  for (let i = fly.length - 1; i >= 0; i--) {
    if (now - fly[i].t0 < fly[i].dur) continue;
    addStar(stars, byColor, fly[i].x1, fly[i].y1, fly[i].rgb);
    fly.splice(i, 1);
  }
}

/** 新しく星になった分を1枚の絵へ焼き足して、その1枚を貼る。重なった所は明るくなる */
export function bakeAndDrawSky(
  ctx: CanvasRenderingContext2D, sky: SkyState, stars: SkyStar[], W: number, H: number, dpr: number,
) {
  if (stars.length > sky.baked) {
    if (!sky.canvas) {
      const res = Math.min(dpr, MAX_DPR);
      const c = document.createElement("canvas");
      c.width = Math.ceil(W * res); c.height = Math.ceil(H * res);
      const sctx = c.getContext("2d");
      if (sctx) {
        sctx.scale(res, res);
        sctx.globalCompositeOperation = "lighter";
        sky.canvas = { canvas: c, ctx: sctx };
      }
    }
    if (sky.canvas) {
      for (let i = sky.baked; i < stars.length; i++) {
        const stt = stars[i];
        const w = stt.d / STAR_CORE;
        sky.canvas.ctx.drawImage(getStar(stt.rgb), stt.x - w / 2, stt.y - w / 2, w, w);
      }
      sky.baked = stars.length;
    }
  }
  if (sky.canvas) ctx.drawImage(sky.canvas.canvas, 0, 0, W, H);
}

/** 飛んでいる粒。はじめ速く終わりゆっくり進み、まっすぐでなく少し弧を描く */
export function drawFlies(ctx: CanvasRenderingContext2D, fly: SkyFly[], now: number) {
  if (!fly.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const f2 of fly) {
    const u = (now - f2.t0) / f2.dur;
    const k = 1 - (1 - u) * (1 - u) * (1 - u);
    const x = f2.x0 + (f2.x1 - f2.x0) * k;
    const y = f2.y0 + (f2.y1 - f2.y0) * k - f2.bow * Math.sin(Math.PI * k);
    const w = f2.d / DOT_CORE;
    ctx.drawImage(getDot(f2.rgb), x - w / 2, y - w / 2, w, w);
  }
  ctx.restore();
}

/** 星の瞬き: 星空からランダムに1つ選んで、山の時と同じ十字の閃光を出す。
 *  画面の外や動画の裏の星を選んでも見えないので、当たるまで数回引き直す。
 *  ハイライト再生中（setHoldCamera(true) で入る）は、いま選んでいる色の星だけが光る（Hop決定 2026-09-08） */
export function sparkSky(
  stars: SkyStar[], byColor: Map<string, number[]>,
  flashes: { x: number; y: number; t0: number; rgb: [number, number, number]; size: number }[],
  now: number, dt: number, W: number, H: number,
  v: { x: number; y: number; w: number; h: number },
  onlyOwn: boolean, ownKey: string | null,
) {
  if (!(stars.length > 0)) return;
  if (Math.random() < (onlyOwn ? SKY_SPARK_RATE_HL : SKY_SPARK_RATE) * dt) {
    const idx = onlyOwn ? (byColor.get(ownKey ?? "") ?? []) : null;
    const len = idx ? idx.length : stars.length;
    for (let tries = 0; tries < 12 && len > 0; tries++) {
      const stt = stars[idx ? idx[(Math.random() * len) | 0] : (Math.random() * len) | 0];
      if (stt.x < 0 || stt.x > W || stt.y < 0 || stt.y > H) continue;
      if (stt.x > v.x && stt.x < v.x + v.w && stt.y > v.y && stt.y < v.y + v.h) continue;
      flashes.push({ x: stt.x, y: stt.y, t0: now, rgb: stt.rgb, size: SKY_SPARK_SIZE });
      break;
    }
  }
}
