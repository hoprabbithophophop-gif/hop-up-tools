// 灰toダイヤモンド「原石の版」— 削りかすの山。
//
// 歓声パート（RAIN_TIME＝4:30〜）で、曲の間に落ちた削りかすがまとめて降り注ぎ、山になる。
// 1人でも必ず山ができ（n=0 でも小さな山）、みんなの分が上乗せされる。
// 山のてっぺんからすそまで、必ず山の領域（layout.pile）の中に収める（描く物は全部この四角で切り抜く）。
// 山の個数「N個」をてっぺんの少し上に出す（文言は「N個」だけ）。個数は器が「歴代累計＋この回の自分の分」を渡す。
//
// 単位の約束: now は ms（performance.now() と同じ）。dt は秒。RAIN_SEC は秒。座標は画面の px。
// document に触るのは描く時（焼き込みの絵を作る時）だけ。ほかの関数は node でもそのまま動く（確かめの台本が import する）。
import type { Rect, RGB } from "./stoneTypes.ts";
import { RAIN_SEC } from "./stoneTimeline.ts";

// ───────────────────────────── 値（全部【仮】）

/** 山の高さの式の定数。h = 領域の高さ × (PILE_BASE + PILE_SPAN × n/(n+PILE_K))。
 *  n=270,000（今の累計）で 0.12+0.78×2/3 = 0.64（領域の高さの約6割）。n=0 で 0.12、どれだけ増えても 0.9 を越えない【仮】
 *  「画面の6割」は「山の領域の6割」と解釈した【仮】 */
export const PILE_BASE = 0.12;
export const PILE_SPAN = 0.78;
export const PILE_K = 135000;
/** 動きを減らす設定で山が出来上がるまで(ms)【仮】 */
const RAIN_MS_REDUCED = 1000;
/** 降ってくる削りかすの数（1秒あたり）。降り注ぎの最後の 15% は新しく降らせない（着地しきってから終わる）【仮】 */
const RAIN_RATE = 150;
const RAIN_SPAWN_UNTIL = 0.85;
const RAIN_GRAVITY = 900;          // px/s^2
const MAX_RAIN = 700;              // 降っている削りかすの上限（超えたら古い物から捨てる）
const MAX_GLINTS = 160;            // 着地・表面のキラッの上限
const LAND_MS = 320;               // 着地のキラッ
const SURFACE_MS = 480;            // 表面のきらめき
const SURFACE_RATE = 5;            // 表面のきらめき（1秒あたり・数点/秒）【仮】
const PROFILE_N = 97;              // 山の輪郭の点の数
const EDGE_ROUGH = 0.04;           // 縁の不揃いの強さ（高さの割合）【仮】
const COLOR_SHARE = 0.55;          // 中身の削りかすのうち、メンバー色で塗る割合。残りは灰〜白【仮】
const BAKE_DENSITY = 22;           // 焼き込みの削りかす1つあたりの面積(px^2)
const BAKE_MAX_CHIPS = 12000;
const MAX_BAKE_RES = 2;            // 焼き込みの細かさの上限（pile.ts の MAX_DPR と同じ考え）
const LABEL_MIN_PX = 16;           // 「N個」の文字の大きさ（ハロヲタは年齢層高め＝14px以上）【仮】
const LABEL_MAX_PX = 30;
const LABEL_H_RATIO = 0.08;        // 領域の高さに対する文字の大きさ
const LABEL_GAP = 0.45;            // てっぺんと文字の下端の間（文字の大きさの倍数）
const LABEL_FONT = 'Inter, "Helvetica Neue", Arial, sans-serif';
const GREY_MIN = 120, GREY_MAX = 245;   // 灰〜白の削りかす

// ───────────────────────────── 型

interface RainChip { alive: boolean; x: number; y: number; vy: number; size: number; rgb: RGB; spin: number }
interface Glint { alive: boolean; x: number; y: number; t0: number; size: number; dur: number }
interface Ring<T> { items: T[]; head: number; cap: number }

export interface PileState {
  /** 山の個数（器が渡す：歴代累計＋この回の自分の分） */
  n: number;
  /** 最後に渡された山の領域 */
  region: Rect | null;
  /** 降り注ぎの始まり(ms)。-1 はまだ（山を描かない） */
  rainT0: number;
  /** 降り注ぎの長さ(ms) */
  rainMs: number;
  reduceMotion: boolean;
  /** 山の輪郭（左端→右端・0..1・一番高い所が 1）。乱数の種から決まる */
  profile: Float32Array;
  /** 一番高い点の位置（0..1） */
  peakU: number;
  rain: Ring<RainChip>;
  glints: Ring<Glint>;
  rainAcc: number;
  sparkAcc: number;
  lastNow: number;
  /** 降らせる削りかすの色（drawPile に渡された colors を覚えておく） */
  palette: { rgb: RGB; weight: number }[];
  bake: { canvas: HTMLCanvasElement; key: string } | null;
  star: HTMLCanvasElement | null;
  chipSprites: Map<string, HTMLCanvasElement>;
}

// ───────────────────────────── 小さな計算

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function ring<T>(cap: number): Ring<T> { return { items: [], head: 0, cap }; }
function take<T>(r: Ring<T>, make: () => T): T {
  if (r.items.length < r.cap) { const o = make(); r.items.push(o); return o; }
  const o = r.items[r.head];
  r.head = (r.head + 1) % r.cap;
  return o;
}

/** 山の輪郭: 領域の幅いっぱいのなだらかなドーム（中心が高く、両端で 0）。縁を少し不揃いにする。
 *  最大が 1 になるよう割り直すので、どんな高さを掛けても「一番高い所＝指定の高さ」 */
function makeProfile(seed: number): { profile: Float32Array; peakU: number } {
  const rnd = mulberry(seed);
  const ph = [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283, rnd() * 6.283];
  const p = new Float32Array(PROFILE_N);
  let max = 0, peak = 0.5;
  for (let i = 0; i < PROFILE_N; i++) {
    const u = (i / (PROFILE_N - 1)) * 2 - 1;   // -1..1
    const dome = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), 2.2)), 1.1);   // 頂が丸いなだらかなドーム（尖らせない）【仮】
    const wob = Math.sin(u * 5.1 + ph[0]) * 0.55 + Math.sin(u * 11.7 + ph[1]) * 0.3 + Math.sin(u * 23.3 + ph[2]) * 0.15;
    const jit = (rnd() - 0.5) * 0.35;           // 細かなぎざぎざ
    const v = Math.max(0, dome * (1 + EDGE_ROUGH * (wob + jit) * Math.sqrt(Math.max(0, 1 - u * u)) * 2));
    p[i] = v;
    if (v > max) { max = v; peak = i / (PROFILE_N - 1); }
  }
  for (let i = 0; i < PROFILE_N; i++) p[i] = max > 0 ? p[i] / max : 0;
  p[0] = 0; p[PROFILE_N - 1] = 0;   // すそは必ず床に着く
  return { profile: p, peakU: peak };
}
function profileAt(st: PileState, u: number): number {
  if (u <= 0 || u >= 1) return 0;
  const f = u * (PROFILE_N - 1);
  const i = Math.floor(f), k = f - i;
  return st.profile[i] * (1 - k) + st.profile[Math.min(PROFILE_N - 1, i + 1)] * k;
}

// ───────────────────────────── 公開: 純粋な部分

/** 山の高さ(px)。数が増えるほど伸び方がゆるやかになる（飽和する）式。
 *  n=0 で領域の 0.12、n=270,000 で 0.64、上限は 0.9 に近づくだけで越えない。n が変な値（負・NaN）なら 0 とみなす */
export function pileHeightFor(n: number, regionH: number): number {
  const H = Number.isFinite(regionH) && regionH > 0 ? regionH : 0;
  const m = Number.isFinite(n) && n > 0 ? n : n === Infinity ? Number.MAX_VALUE : 0;
  const sat = m >= Number.MAX_VALUE / 2 ? 1 : m / (m + PILE_K);
  return H * (PILE_BASE + PILE_SPAN * sat);
}

export function createPileState(): PileState {
  const { profile, peakU } = makeProfile(20260926);
  return {
    n: 0, region: null, rainT0: -1, rainMs: RAIN_SEC * 1000, reduceMotion: false,
    profile, peakU,
    rain: ring<RainChip>(MAX_RAIN), glints: ring<Glint>(MAX_GLINTS),
    rainAcc: 0, sparkAcc: 0, lastNow: -1,
    palette: [], bake: null, star: null, chipSprites: new Map(),
  };
}

/** 山を消して降り注ぎの前へ戻す（見返しで時刻が 4:30 より前へ戻った時など）。焼き込みの絵は残す */
export function resetPile(st: PileState): void {
  st.rainT0 = -1;
  st.rainAcc = 0; st.sparkAcc = 0; st.lastNow = -1;
  for (const c of st.rain.items) c.alive = false;
  for (const g of st.glints.items) g.alive = false;
}

/** 目標の個数と領域 */
export function setPileTarget(st: PileState, n: number, region: Rect): void {
  st.n = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  st.region = region;
}

/** 降り注ぎの開始。RAIN_SEC かけて山が 0 から目標まで伸び、削りかすが上から降って山に着地する。
 *  動きを減らす設定では削りかすを降らせず、短い時間（1秒【仮】）で出来上がる。既に始まっていれば何もしない */
export function startRain(st: PileState, now: number, reduceMotion: boolean): void {
  if (st.rainT0 >= 0) return;
  st.rainT0 = now;
  st.reduceMotion = reduceMotion;
  st.rainMs = reduceMotion ? RAIN_MS_REDUCED : RAIN_SEC * 1000;
  st.rainAcc = 0; st.sparkAcc = 0; st.lastNow = now;
}

/** 降り注ぎの進み 0..1（始まる前は 0・出来上がったら 1）。はじめ速く、終わりゆっくり */
export function pileGrowth(st: PileState, now: number): number {
  if (st.rainT0 < 0) return 0;
  const u = clamp01((now - st.rainT0) / Math.max(1, st.rainMs));
  return 1 - (1 - u) * (1 - u);
}
/** 山を描き始めたか（startRain の後か） */
export function pileStarted(st: PileState): boolean { return st.rainT0 >= 0; }
/** いま表示する個数（降り注ぎの間は 0 から数え上げる） */
export function pileShownCount(st: PileState, now: number): number {
  const g = pileGrowth(st, now);
  return g >= 1 ? st.n : Math.round(st.n * g);
}
/** いまの山の高さ(px) */
export function pileCurrentHeight(st: PileState, now: number, regionH: number): number {
  return pileHeightFor(st.n, regionH) * pileGrowth(st, now);
}
/** 横の位置 x での山の表面の y(px)。山の外（左右）や始まる前は領域の底 */
export function pileSurfaceY(st: PileState, region: Rect, x: number, now: number): number {
  const bottom = region.y + region.h;
  const u = (x - region.x) / Math.max(1, region.w);
  return bottom - pileCurrentHeight(st, now, region.h) * profileAt(st, u);
}
/** 「N個」の置き場所。てっぺんの少し上。上に余地が無い時は領域の上端から文字1つ分下に留める（山の頂に少し重なる）【仮】。
 *  幅に入らない時は文字を小さくする（下限 LABEL_MIN_PX まで。それでも入らない時はその下限のまま）。始まる前は null */
export function pileLabel(st: PileState, region: Rect, now: number): { text: string; x: number; y: number; fontPx: number } | null {
  if (st.rainT0 < 0) return null;
  const text = `${pileShownCount(st, now).toLocaleString("ja-JP")}個`;
  let fontPx = Math.max(LABEL_MIN_PX, Math.min(LABEL_MAX_PX, region.h * LABEL_H_RATIO));
  const estW = (t: string, f: number) => (t.length - 1) * f * 0.6 + f;   // 数字と「,」は約0.6字幅、「個」は1字幅
  // 数え上げの途中で文字が縮んだり戻ったりしないよう、幅は目標の個数の文字で決める
  const widest = `${st.n.toLocaleString("ja-JP")}個`;
  while (fontPx > LABEL_MIN_PX && estW(widest, fontPx) > region.w * 0.9) fontPx -= 1;
  const peakY = region.y + region.h - pileCurrentHeight(st, now, region.h);
  const x = region.x + region.w * st.peakU;
  const half = estW(widest, fontPx) / 2;
  const cx = Math.max(region.x + half, Math.min(region.x + region.w - half, x));
  // y は文字の下端（textBaseline = "bottom"）。上端 = y - fontPx が領域の中に入るように留める
  const y = Math.max(region.y + fontPx * 1.1, peakY - fontPx * LABEL_GAP);
  return { text, x: cx, y, fontPx };
}

// ───────────────────────────── 進める

function paletteSum(p: { rgb: RGB; weight: number }[]): number {
  let s = 0;
  for (const c of p) if (Number.isFinite(c.weight) && c.weight > 0) s += c.weight;
  return s;
}
/** 色を1つ選ぶ。COLOR_SHARE の割合でメンバー色（割合に従う）、残りは灰〜白 */
function pickColor(p: { rgb: RGB; weight: number }[], rnd: () => number): RGB {
  const sum = paletteSum(p);
  if (sum > 0 && rnd() < COLOR_SHARE) {
    let r = rnd() * sum;
    for (const c of p) {
      if (!(c.weight > 0)) continue;
      r -= c.weight;
      if (r <= 0) return c.rgb;
    }
    for (let i = p.length - 1; i >= 0; i--) if (p[i].weight > 0) return p[i].rgb;
  }
  const g = Math.round(GREY_MIN + (GREY_MAX - GREY_MIN) * rnd());
  return [g, g, g + 4 > 255 ? 255 : g + 4];
}

/** 降っている削りかすを落として着地させ、表面をきらめかせる。毎コマ呼ぶ */
export function stepPile(st: PileState, now: number, dt: number): void {
  st.lastNow = now;
  const region = st.region;
  if (st.rainT0 < 0 || !region) return;
  const u = (now - st.rainT0) / Math.max(1, st.rainMs);
  // 降らせる
  if (!st.reduceMotion && u < RAIN_SPAWN_UNTIL) {
    st.rainAcc += RAIN_RATE * dt;
    while (st.rainAcc >= 1) {
      st.rainAcc -= 1;
      // 山の高い所ほど多く降る（輪郭の高さで受け入れを決める）
      let x = region.x + region.w * 0.5;
      for (let tries = 0; tries < 6; tries++) {
        const uu = Math.random();
        if (Math.random() < Math.sqrt(profileAt(st, uu)) + 0.05) { x = region.x + region.w * uu; break; }
      }
      const c = take(st.rain, () => ({ alive: false, x: 0, y: 0, vy: 0, size: 0, rgb: [200, 200, 200] as RGB, spin: 0 }));
      c.alive = true;
      c.x = x;
      c.y = region.y - Math.random() * region.h * 0.3;   // 領域の上端あたりから（領域の外は切り抜かれて見えない）
      c.vy = 60 + Math.random() * 160;
      c.size = 3.5 + Math.random() * 4;
      c.rgb = pickColor(st.palette, Math.random);
      c.spin = Math.random() * 6.283;
    }
  }
  // 落とす・着地
  for (const c of st.rain.items) {
    if (!c.alive) continue;
    c.vy += RAIN_GRAVITY * dt;
    c.y += c.vy * dt;
    c.spin += 9 * dt;
    const sy = pileSurfaceY(st, region, c.x, now);
    if (c.y >= sy) {
      c.alive = false;
      const g = take(st.glints, () => ({ alive: false, x: 0, y: 0, t0: 0, size: 0, dur: 0 }));
      g.alive = true; g.x = c.x; g.y = sy; g.t0 = now; g.size = c.size * 1.8; g.dur = LAND_MS;
    }
  }
  // 表面のきらめき（動きを減らす設定では止める）
  if (!st.reduceMotion) {
    st.sparkAcc += SURFACE_RATE * dt;
    while (st.sparkAcc >= 1) {
      st.sparkAcc -= 1;
      const uu = 0.05 + Math.random() * 0.9;
      const pr = profileAt(st, uu);
      if (pr < 0.15) continue;
      const x = region.x + region.w * uu;
      const top = pileSurfaceY(st, region, x, now);
      const depth = pileCurrentHeight(st, now, region.h) * pr * 0.3;
      const g = take(st.glints, () => ({ alive: false, x: 0, y: 0, t0: 0, size: 0, dur: 0 }));
      g.alive = true; g.x = x; g.y = top + 3 + Math.random() * depth; g.t0 = now; g.size = 6 + Math.random() * 7; g.dur = SURFACE_MS;
    }
  }
  for (const g of st.glints.items) if (g.alive && now - g.t0 > g.dur) g.alive = false;
}

// ───────────────────────────── 描く（ここから下だけ document に触る）

function getStar(st: PileState): HTMLCanvasElement {
  if (st.star) return st.star;
  const px = 64, h = px / 2;
  const c = document.createElement("canvas");
  c.width = px; c.height = px;
  const x = c.getContext("2d");
  if (x) {
    const g = x.createRadialGradient(h, h, 0, h, h, h * 0.45);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, px, px);
    x.fillStyle = "rgba(255,255,255,0.95)";
    const w = px * 0.06;
    x.beginPath();
    x.moveTo(h, 0); x.lineTo(h + w, h); x.lineTo(h, px); x.lineTo(h - w, h); x.closePath();
    x.moveTo(0, h); x.lineTo(h, h - w); x.lineTo(px, h); x.lineTo(h, h + w); x.closePath();
    x.fill();
  }
  return (st.star = c);
}
function getChipSprite(st: PileState, rgb: RGB): HTMLCanvasElement {
  const key = rgb.join(",");
  let c = st.chipSprites.get(key);
  if (c) return c;
  const px = 32, h = px / 2, hh = px * 0.26, hw = hh * 0.62;
  c = document.createElement("canvas");
  c.width = px; c.height = px;
  const x = c.getContext("2d");
  if (x) {
    const [r, g, b] = rgb;
    const halo = x.createRadialGradient(h, h, 0, h, h, h);
    halo.addColorStop(0, `rgba(${r},${g},${b},0.45)`);
    halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = halo;
    x.fillRect(0, 0, px, px);
    drawRhombus(x, h, h, hw, hh, 0, rgb);
  }
  st.chipSprites.set(key, c);
  return c;
}
/** 菱形の削りかす1つ。上半分は光の当たった白寄りの面、下半分はその色の面。色は暗くしない */
function drawRhombus(x: CanvasRenderingContext2D, cx: number, cy: number, hw: number, hh: number, rot: number, rgb: RGB) {
  const [r, g, b] = rgb;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const P = (dx: number, dy: number): [number, number] => [cx + dx * cs - dy * sn, cy + dx * sn + dy * cs];
  const top = P(0, -hh), rt = P(hw, 0), bot = P(0, hh), lt = P(-hw, 0);
  x.fillStyle = `rgb(${Math.round(r + (255 - r) * 0.55)},${Math.round(g + (255 - g) * 0.55)},${Math.round(b + (255 - b) * 0.55)})`;
  x.beginPath(); x.moveTo(top[0], top[1]); x.lineTo(rt[0], rt[1]); x.lineTo(lt[0], lt[1]); x.closePath(); x.fill();
  x.fillStyle = `rgb(${r},${g},${b})`;
  x.beginPath(); x.moveTo(lt[0], lt[1]); x.lineTo(rt[0], rt[1]); x.lineTo(bot[0], bot[1]); x.closePath(); x.fill();
}

/** 中身の絵を焼く: 暗い灰色の下地に、キラキラの削りかす（菱形と点）を敷き詰める。
 *  焼き直すのは領域の大きさが変わった時だけ（Hop指定）。色の割合が後から変わっても焼き直さない（タップのたびに1万個を描き直すと引っかかるため）。
 *  例外として、最初に焼いた時に色が1つも無く、その後に色が届いた時だけは1回焼き直す（灰色だけの山のままにしないため）【仮】 */
function ensureBake(st: PileState, w: number, h: number, dpr: number, colors: { rgb: RGB; weight: number }[]): HTMLCanvasElement | null {
  const res = Math.max(1, Math.min(dpr || 1, MAX_BAKE_RES));
  const hasColor = paletteSum(colors) > 0;
  const key = `${Math.round(w)}x${Math.round(h)}@${res}|${hasColor ? "color" : "grey"}`;
  if (st.bake && st.bake.key === key) return st.bake.canvas;
  if (w < 1 || h < 1) return null;
  const c = st.bake?.canvas ?? document.createElement("canvas");
  c.width = Math.ceil(w * res); c.height = Math.ceil(h * res);
  const x = c.getContext("2d");
  if (!x) return null;
  x.setTransform(res, 0, 0, res, 0, 0);
  x.clearRect(0, 0, w, h);
  // 下地: 暗い灰色（上がほんの少し明るい）
  const bg = x.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#3b3b41");
  bg.addColorStop(1, "#232327");
  x.fillStyle = bg;
  x.fillRect(0, 0, w, h);
  // 削りかすを敷き詰める（種つきの乱数＝焼き直しても同じ模様）
  const rnd = mulberry(7331);
  const n = Math.min(BAKE_MAX_CHIPS, Math.floor((w * h) / BAKE_DENSITY));
  for (let i = 0; i < n; i++) {
    const px = rnd() * w, py = rnd() * h;
    const rgb = pickColor(colors, rnd);
    if (rnd() < 0.18) {   // 細かな光の点
      x.fillStyle = `rgba(255,255,255,${(0.35 + rnd() * 0.5).toFixed(2)})`;
      const d = 0.8 + rnd() * 1.2;
      x.fillRect(px, py, d, d);
      continue;
    }
    const hh = 1.6 + rnd() * 2.6, hw = hh * (0.45 + rnd() * 0.35);
    drawRhombus(x, px, py, hw, hh, (rnd() - 0.5) * 1.6, rgb);
  }
  st.bake = { canvas: c, key };
  return c;
}

/** 山を描く（startRain の前は何も描かない）。描く物は全部 region の中に切り抜く＝てっぺんからすそまで必ず収まる。
 *  colors はメンバー色とその割合（重さ）。中身の削りかすと降る削りかすの色に使い、残りは灰〜白 */
export function drawPile(
  ctx: CanvasRenderingContext2D, st: PileState, now: number, region: Rect, dpr: number,
  colors: { rgb: RGB; weight: number }[],
): void {
  st.palette = colors;
  st.region = region;
  if (st.rainT0 < 0 || region.w < 2 || region.h < 2) return;
  const bottom = region.y + region.h;
  const hPx = pileCurrentHeight(st, now, region.h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(region.x, region.y, region.w, region.h);
  ctx.clip();

  // 山の本体: 輪郭で切り抜いて、焼き込みの絵を貼る
  if (hPx > 0.5) {
    const path = new Path2D();
    path.moveTo(region.x, bottom);
    for (let i = 0; i < PROFILE_N; i++) {
      const xx = region.x + (region.w * i) / (PROFILE_N - 1);
      path.lineTo(xx, bottom - hPx * st.profile[i]);
    }
    path.lineTo(region.x + region.w, bottom);
    path.closePath();
    const img = ensureBake(st, region.w, region.h, dpr, colors);
    ctx.save();
    ctx.clip(path);
    if (img) ctx.drawImage(img, region.x, region.y, region.w, region.h);
    else { ctx.fillStyle = "#2c2c31"; ctx.fillRect(region.x, region.y, region.w, region.h); }
    ctx.restore();
    // 縁の光（輪郭をなぞる薄い白）
    ctx.beginPath();
    for (let i = 0; i < PROFILE_N; i++) {
      const xx = region.x + (region.w * i) / (PROFILE_N - 1);
      const yy = bottom - hPx * st.profile[i];
      if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.38)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // 降ってくる削りかす
  ctx.globalCompositeOperation = "source-over";
  for (const c of st.rain.items) {
    if (!c.alive) continue;
    const img = getChipSprite(st, c.rgb);
    const s = c.size * 3.8;   // 絵の中で菱形は約半分の高さ
    const w = s * Math.max(0.2, Math.abs(Math.cos(c.spin)));
    ctx.drawImage(img, c.x - w / 2, c.y - s / 2, w, s);
  }
  // 着地・表面のキラッ
  ctx.globalCompositeOperation = "lighter";
  const star = getStar(st);
  for (const g of st.glints.items) {
    if (!g.alive) continue;
    const u = (now - g.t0) / g.dur;
    if (u < 0 || u > 1) continue;
    const k = Math.sin(Math.PI * u);
    const s = g.size * (0.5 + 0.5 * k);
    ctx.globalAlpha = k;
    ctx.drawImage(star, g.x - s, g.y - s, s * 2, s * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  // 個数「N個」（文言はこれだけ）
  const lab = pileLabel(st, region, now);
  if (lab) {
    let fs = lab.fontPx;
    ctx.font = `700 ${fs}px ${LABEL_FONT}`;
    const widest = `${st.n.toLocaleString("ja-JP")}個`;
    while (fs > LABEL_MIN_PX && ctx.measureText(widest).width > region.w * 0.9) {
      fs -= 1;
      ctx.font = `700 ${fs}px ${LABEL_FONT}`;
    }
    const tw = ctx.measureText(widest).width;
    const x = Math.max(region.x + tw / 2, Math.min(region.x + region.w - tw / 2, lab.x));
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(lab.text, x, lab.y);
  }
  ctx.restore();
}
