// 灰toダイヤモンド「原石の版」— 石の「まわり」の光と粒。
//
// 主役は灰色の原石（描くのは別の部品）。ここは石のまわりだけを受け持つ:
//   Aメロ=2本ずつ走る光の筋 / Bメロ=石のまわりを回る光の粒（ときどき石に当たって弾ける）/
//   サビ=粒が揃って回り、揃って石に当たる / 間奏=削りかすの飛び散り / ラップ=刻んだ瞬間の火花 /
//   エレピ=磨いた瞬間の光の輪 / 大サビ=完成の瞬間に放つ光（色の帯と白の✦）と上へ伸びる光の柱 /
//   後奏=きらめきの粒 / 常時=💎が当たった所から落ちる削りかす
//
// 単位の約束（ここを取り違えるのが一番の落とし穴）:
//   now は ms（performance.now() と同じ）。dt は秒。座標は画面の px（CSS px・呼ぶ側が dpr を掛けた ctx を渡す）。
//
// 作りの約束:
//   ・React に依存しない。状態を作る関数／進める・出す関数／描く関数だけ。
//   ・粒は種類ごとに上限つきの輪（ring）で使い回す。満杯なら一番古い物を上書きする＝古い物から捨てる。
//   ・毎コマ createRadialGradient を作らない。小さな絵を色ごとに一度だけ作り置きして drawImage で貼る
//     （canvas/sky.ts の makeRadial / getStar と同じ流儀。sky.ts は gemSprites を引き込むので import せず、ここに写した）。
//   ・document に触るのは描く時（絵の作り置き）だけ。作る・進める関数は node でもそのまま動く。
//   ・飾りの色は白か灰だけ。色が付くのは、呼ぶ側から渡されたタップの色（rgb）だけ。人の色を暗く・薄くする演出は入れない。
import type { Rect, RGB, StoneView } from "./stoneTypes.ts";
import type { SectionKey } from "./stoneTimeline.ts";
import { SECTIONS } from "./stoneTimeline.ts";

// ───────────────────────────── 値（全部【仮】・実機で見て決める）

/** 原石の外接半径（模型の単位）。StoneView には原石の大きさが無いので、既定はこの値。
 *  器が StoneMesh.roughRadius を知っていれば setStoneRadius で入れ直す【仮】 */
const STONE_R_UNITS_DEFAULT = 1.2;

// 輪の上限
const MAX_CHIPS = 900;       // 削りかす（💎の当たり・間奏の飛び散り・粒の当たり）
const MAX_STREAKS = 24;      // Aメロの光の筋
const MAX_ORBITERS = 24;     // Bメロ・サビの回る粒
const MAX_SPARKS = 220;      // 一瞬の光（火花・光の輪・当たりの弾け・着地のキラッ・きらめき）
const MAX_BEAMS = 320;       // 完成の瞬間に放つ光（面の数ぶん）

// Aメロの光の筋
const STREAK_PAIR_SEC_A = 1.8;   // 1番: この秒数ごとに2本1組が走る【仮】（曲のハモの位置は測っていない）
const STREAK_PAIR_SEC_A2 = 1.15; // 2番: 一段上（間隔が短い）【仮】
const STREAK_MS = 1100;          // 1本が走り切るまで
const STREAK_SWEEP = 2.5;        // 頭が進む角度(rad)
const STREAK_TRAIL = 1.1;        // 尾の長さ(rad)
const STREAK_PAIR_GAP_MS = 90;   // 2本目が遅れて出る時間
const STREAK_PAIR_DR = 0.07;     // 2本目の半径のずれ（石の半径の倍数）
const STREAK_SEGS = 14;          // 尾を何本の線分で描くか

// Bメロ・サビの回る粒
const ORBIT_COUNT_B = 8;         // 1番Bメロの粒の数【仮】
const ORBIT_COUNT_B2 = 13;       // 2番Bメロ（一段上）【仮】
const ORBIT_COUNT_CHORUS = 12;   // サビ（揃って回る）【仮】
const ORBIT_HIT_RATE_B = 0.22;   // 1粒が1秒あたり石に当たりに行く見込み（1番）【仮】
const ORBIT_HIT_RATE_B2 = 0.38;  // 2番【仮】
const ORBIT_DIVE_MS = 520;       // 当たりに行って戻るまで
const CHORUS_CUT_SEC = 2.0;      // サビで揃って当たる間隔【仮】（曲の拍は測っていない）
const SYNC_RAD = 1.5;            // 揃った時の軌道の半径（石の半径の倍数）
const SYNC_SQUASH = 0.32;        // 揃った時の楕円のつぶれ（縦/横）
const SYNC_SPEED = 1.7;          // 揃った時の回る速さ(rad/s)
const SYNC_EASE = 1.4;           // 揃う・ほどける速さ（1秒あたり）
const ORBIT_FADE = 2.5;          // 粒が現れる・消える速さ（1秒あたり）
const ORBIT_GHOSTS = 5;          // 回る粒の残像の数

// 削りかす
const CHIP_GRAVITY = 720;        // px/s^2
const CHIP_LIFE_MS = 4500;       // 床に届かなくてもこれで消える（画面の外へ飛んだ分の保険）
const LAND_GLINT_MS = 280;       // 床で消える時のキラッ
const GREYS: RGB[] = [[150, 150, 156], [188, 188, 194], [224, 224, 230], [255, 255, 255]];

// 一瞬の光
const CUT_MS = 260;              // ラップの刻みの火花
const POLISH_MS = 560;           // エレピの磨きの光の輪
const HIT_MS = 240;              // 回る粒が石に当たった弾け
const TWINKLE_MS = 520;          // 後奏のきらめき・✦
const OUTRO_TWINKLE_RATE = 2.6;  // 後奏のきらめき（1秒あたり）【仮】

// 完成の瞬間に放つ光
const BEAM_GROW_MS = 380;        // 帯が伸び切るまで
const BEAM_MS = 1500;            // 帯が消えるまで
const BEAM_MS_REDUCED = 650;     // 動きを減らす設定: 短く1回【仮】
const BEAM_LEN = 2.6;            // 帯の長さ（石の半径の倍数）
const BEAM_W = 11;               // 帯の太さ(px)
const WHITE_STAR_MS = 1200;      // 白の分の✦
const WHITE_STAR_SIZE = 38;      // ✦の大きさ(px)

// 大サビの光の柱（フェイク）
const RAYS_PERIOD_SEC = 4;       // 伸び縮みの周期【仮：4秒】
const RAYS_MIN = 2.2;            // 柱の高さの最小（石の半径の倍数）
const RAYS_MAX = 3.8;            // 最大
const RAYS_REDUCED = 3.0;        // 動きを減らす設定では止めた高さ【仮】
const RAYS_WIDTH = 0.95;         // 柱の幅（石の半径の倍数）
const RAYS_ALPHA = 0.34;         // 淡い白
const RAYS_FADE = 1.2;           // 現れる・消える速さ（1秒あたり）

// ───────────────────────────── 型

interface Chip {
  alive: boolean;
  x: number; y: number; vx: number; vy: number;
  size: number;          // 菱形の高さ(px)
  spin: number;          // 回転の角(rad)。幅を |cos| で縮めて、ひらひら回って見せる
  spinV: number;
  rgb: RGB;
  t0: number;
  floorY: number;
}
interface Streak {
  alive: boolean;
  t0: number;
  th0: number;           // 頭の出発角
  dir: number;           // 回る向き ±1
  rad: number;           // 半径（石の半径の倍数）
  squash: number;        // 楕円のつぶれ
  tilt: number;          // 楕円の傾き(rad)
  grey: number;          // 線の明るさ（255=白・それより下=灰）
}
interface Orbiter {
  alive: boolean;
  alpha: number;         // 0..1
  leaving: boolean;
  th: number;            // 自分の角
  speed: number;         // rad/s（向き込み）
  rad: number; squash: number; tilt: number;
  size: number;          // 芯の直径(px)
  diveT0: number;        // 当たりに行き始めた時刻(ms)。-1=行っていない
  diveBig: boolean;      // サビの揃った当たり
  diveHit: boolean;      // 底で弾けを出したか
}
type SparkKind = "cut" | "polish" | "hit" | "bigHit" | "land" | "twinkle";
interface Spark {
  alive: boolean;
  kind: SparkKind;
  x: number; y: number;
  t0: number;
  size: number;
  seed: number;          // 火花の向きなどを決める種
  behind: boolean;
}
interface Beam {
  alive: boolean;
  x: number; y: number;
  ux: number; uy: number; // 外向きの向き（単位）
  len: number;
  rgb: RGB | null;        // null=白の✦
  t0: number;
  dur: number;
  grow: boolean;
}
interface Ring<T> { items: T[]; head: number; cap: number }

interface Sprites {
  dot: HTMLCanvasElement | null;           // 白い粒（芯＋滲み）
  glow: HTMLCanvasElement | null;          // 白い柔らかい光
  star: HTMLCanvasElement | null;          // 白い✦
  pillar: HTMLCanvasElement | null;        // 光の柱
  chip: Map<string, HTMLCanvasElement>;    // 色ごとの菱形の削りかす
  beam: Map<string, HTMLCanvasElement>;    // 色ごとの光の帯
  beamGlow: Map<string, HTMLCanvasElement>; // 色ごとの帯の根元の光
}

/** 粒の部品が持ち回る物ぜんぶ（粒の輪と作り置きの絵） */
export interface ParticleState {
  chips: Ring<Chip>;
  streaks: Ring<Streak>;
  orbiters: Orbiter[];
  sparks: Ring<Spark>;
  beams: Ring<Beam>;
  sprites: Sprites;
  /** 原石の外接半径（模型の単位）【仮・既定 1.2】 */
  stoneRUnits: number;
  /** 最後に見た石の見え方（放つ光・きらめきの中心に使う） */
  view: StoneView | null;
  /** 削りかすが消える床(px)。emitChips / emitScatter / setParticleFloor で最後に渡された値。
   *  回る粒の当たりで出る削りかすは、この床を使う【仮】。0 以下なら石の下 2.5 半径 */
  floorY: number;
  /** 動きを減らす設定（updateAmbient / stepParticles / emitBurst で渡された最後の値）。
   *  emitChips / emitScatter には引数が無いので、これを見て動く削りかすを出さない【仮】 */
  reduceMotion: boolean;
  streakAcc: number;     // 次の筋までの貯め(秒)
  syncTheta: number;     // 揃った時の共通の角
  sync: number;          // 揃い具合 0..1
  lastChorusCut: number; // サビの揃った当たりの番号（同じ番号で2回出さない）
  twinkleAcc: number;
  rays: { alpha: number; target: number; x: number; y: number; R: number; h: number; lastNow: number };
}

// ───────────────────────────── 作る・片付ける

function ring<T>(cap: number): Ring<T> { return { items: [], head: 0, cap }; }
/** 輪から1つ借りる。満杯なら一番古い物を上書きする（make は輪が満ちるまでの新規作成だけに使う） */
function take<T>(r: Ring<T>, make: () => T): T {
  if (r.items.length < r.cap) { const o = make(); r.items.push(o); return o; }
  const o = r.items[r.head];
  r.head = (r.head + 1) % r.cap;
  return o;
}

export function createParticleState(): ParticleState {
  return {
    chips: ring<Chip>(MAX_CHIPS),
    streaks: ring<Streak>(MAX_STREAKS),
    orbiters: [],
    sparks: ring<Spark>(MAX_SPARKS),
    beams: ring<Beam>(MAX_BEAMS),
    sprites: { dot: null, glow: null, star: null, pillar: null, chip: new Map(), beam: new Map(), beamGlow: new Map() },
    stoneRUnits: STONE_R_UNITS_DEFAULT,
    view: null,
    floorY: 0,
    reduceMotion: false,
    streakAcc: 0,
    syncTheta: 0,
    sync: 0,
    lastChorusCut: -1,
    twinkleAcc: 0,
    rays: { alpha: 0, target: 0, x: 0, y: 0, R: 0, h: 0, lastNow: -1 },
  };
}

/** 粒を全部消す（見返しで時刻が戻った時など）。作り置きの絵は残す */
export function clearParticles(st: ParticleState): void {
  for (const c of st.chips.items) c.alive = false;
  for (const s of st.streaks.items) s.alive = false;
  for (const s of st.sparks.items) s.alive = false;
  for (const b of st.beams.items) b.alive = false;
  st.orbiters.length = 0;
  st.streakAcc = 0;
  st.sync = 0;
  st.lastChorusCut = -1;
  st.twinkleAcc = 0;
  st.rays.alpha = 0; st.rays.target = 0; st.rays.lastNow = -1;
}

/** 原石の外接半径（模型の単位・StoneMesh.roughRadius）を教える。呼ばなければ 1.2【仮】 */
export function setStoneRadius(st: ParticleState, roughRadius: number): void {
  if (Number.isFinite(roughRadius) && roughRadius > 0) st.stoneRUnits = roughRadius;
}
/** 削りかすが消える床(px)を教える。回る粒の当たりの削りかすもこの床で消える */
export function setParticleFloor(st: ParticleState, floorY: number): void {
  if (Number.isFinite(floorY)) st.floorY = floorY;
}

// ───────────────────────────── 小さな計算

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
/** 石が画面で占める半径(px) */
function stoneR(st: ParticleState, v: StoneView): number { return v.r * st.stoneRUnits * (v.bulge || 1); }
function angDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
/** 傾いた楕円の上の点。z>0 は石の手前、z<0 は石の奥 */
function ellipsePt(cx: number, cy: number, R: number, squash: number, tilt: number, th: number): { x: number; y: number; z: number } {
  const lx = Math.cos(th) * R, ly = Math.sin(th) * R * squash;
  const c = Math.cos(tilt), s = Math.sin(tilt);
  return { x: cx + lx * c - ly * s, y: cy + lx * s + ly * c, z: Math.sin(th) };
}
function sectionSec(key: SectionKey): number {
  for (let i = 0; i < SECTIONS.length; i++) {
    if (SECTIONS[i].key !== key) continue;
    const start = i === 0 ? 0 : SECTIONS[i - 1].end;
    const end = SECTIONS[i].end;
    return Number.isFinite(end) ? end - start : 10;
  }
  return 10;
}
function floorFor(st: ParticleState, v: StoneView | null): number {
  if (st.floorY > 0) return st.floorY;
  return v ? v.cy + stoneR(st, v) * 2.5 : 1e4;
}

// ───────────────────────────── 出す

function spawnChip(st: ParticleState, x: number, y: number, vx: number, vy: number, size: number, rgb: RGB, now: number, floorY: number) {
  const c = take(st.chips, () => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, size: 0, spin: 0, spinV: 0, rgb: GREYS[0], t0: 0, floorY: 0 }));
  c.alive = true;
  c.x = x; c.y = y; c.vx = vx; c.vy = vy;
  c.size = size;
  c.spin = Math.random() * TAU;
  c.spinV = rand(6, 16) * (Math.random() < 0.5 ? -1 : 1);
  c.rgb = rgb; c.t0 = now; c.floorY = floorY;
}
function spawnSpark(st: ParticleState, kind: SparkKind, x: number, y: number, now: number, size: number, behind = false) {
  const s = take(st.sparks, () => ({ alive: false, kind: "cut" as SparkKind, x: 0, y: 0, t0: 0, size: 0, seed: 0, behind: false }));
  s.alive = true; s.kind = kind; s.x = x; s.y = y; s.t0 = now; s.size = size; s.seed = Math.random() * 1000; s.behind = behind;
}
function greyPick(): RGB { return GREYS[(Math.random() * GREYS.length) | 0]; }

/** 💎が当たった所から削りかすを出す。半分はその色、半分は灰〜白。落ちて floorY で小さくキラッと消える。
 *  動きを減らす設定では落ちる粒は出さず、当たった所で一瞬だけキラッとする【仮】 */
export function emitChips(st: ParticleState, x: number, y: number, rgb: RGB, n: number, now: number, floorY: number): void {
  st.floorY = floorY;
  if (st.reduceMotion) { spawnSpark(st, "land", x, y, now, 9); return; }
  const cnt = Math.max(0, Math.floor(n));
  for (let i = 0; i < cnt; i++) {
    const col = i % 2 === 0 ? rgb : greyPick();   // 当たった色＋灰色
    spawnChip(st, x + rand(-4, 4), y + rand(-4, 4), rand(-130, 130), rand(-240, -50), rand(4, 8), col, now, floorY);
  }
}

/** 間奏の飛び散り。石のまわりから放射状にキラキラの削りかす（白〜灰）が飛び、落ちて floorY で消える */
export function emitScatter(st: ParticleState, view: StoneView, n: number, now: number, floorY: number): void {
  st.floorY = floorY;
  st.view = view;
  const R = stoneR(st, view);
  if (st.reduceMotion) {   // 動きを減らす設定: 飛ばさず、石の縁で数か所だけキラッ【仮】
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      spawnSpark(st, "twinkle", view.cx + Math.cos(a) * R, view.cy + Math.sin(a) * R, now, 16);
    }
    return;
  }
  const cnt = Math.max(0, Math.floor(n));
  for (let i = 0; i < cnt; i++) {
    const a = Math.random() * TAU;
    const sp = rand(170, 430);
    const x = view.cx + Math.cos(a) * R * 0.95, y = view.cy + Math.sin(a) * R * 0.95;
    spawnChip(st, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 90, rand(4, 9), greyPick(), now, floorY);
  }
  spawnSpark(st, "bigHit", view.cx, view.cy - R * 0.2, now, R * 0.5);
}

/** ラップの刻み（cut）／エレピの磨き（polish）の一瞬の光。どちらも白 */
export function emitSpark(st: ParticleState, x: number, y: number, kind: "cut" | "polish", now: number): void {
  spawnSpark(st, kind, x, y, now, kind === "cut" ? 14 : 34);
}

/** 完成の瞬間に放つ光。rgb がある面は、面の中心から外向きにその色の光の帯。
 *  white=true の面は十字のきらめき（✦・白は色の光だと背景に溶けるため）。rgb が null で white でもない面は出さない。
 *  white と rgb が両方ある時は white を優先する【仮】 */
export function emitBurst(
  st: ParticleState,
  sources: { x: number; y: number; rgb: RGB | null; white: boolean }[],
  now: number, reduceMotion: boolean,
): void {
  st.reduceMotion = reduceMotion;
  const v = st.view;
  let cx = v ? v.cx : 0, cy = v ? v.cy : 0;
  if (!v && sources.length) {   // 石の見え方をまだ知らない時は、面の中心の平均を石の中心とみなす
    for (const s of sources) { cx += s.x; cy += s.y; }
    cx /= sources.length; cy /= sources.length;
  }
  const R = v ? stoneR(st, v) : 60;
  const dur = reduceMotion ? BEAM_MS_REDUCED : BEAM_MS;
  for (const s of sources) {
    if (!s.white && !s.rgb) continue;
    let dx = s.x - cx, dy = s.y - cy;
    const d = Math.hypot(dx, dy);
    if (d < 1) { dx = 0; dy = -1; } else { dx /= d; dy /= d; }   // 真ん中の面（テーブル）は上へ
    const b = take(st.beams, () => ({ alive: false, x: 0, y: 0, ux: 0, uy: 0, len: 0, rgb: null as RGB | null, t0: 0, dur: 0, grow: true }));
    b.alive = true; b.x = s.x; b.y = s.y; b.ux = dx; b.uy = dy;
    b.len = R * BEAM_LEN * rand(0.85, 1.15);
    b.rgb = s.white ? null : s.rgb;
    b.t0 = now; b.dur = s.white ? (reduceMotion ? BEAM_MS_REDUCED : WHITE_STAR_MS) : dur;
    b.grow = !reduceMotion;
  }
}

// ───────────────────────────── 区切りごとの演出

function orbitTarget(key: SectionKey): number {
  if (key === "verseB") return ORBIT_COUNT_B;
  if (key === "verseB2") return ORBIT_COUNT_B2;
  if (key === "chorus") return ORBIT_COUNT_CHORUS;
  return 0;
}

/** 石のまわりの演出の入口。毎コマ呼ぶ。
 *  verseA/verseA2=光の筋が2本ずつ、verseB/verseB2=回る粒（ときどき当たる）、chorus=揃って回り揃って当たる、outro=きらめき。
 *  2番は1番より一段上（筋の間隔が短い・粒が多い・よく当たる）。
 *  動きを減らす設定: 筋は出さない。回る粒は止まったまま置くだけ（当たらない）。きらめきも出さない【仮】 */
export function updateAmbient(
  st: ParticleState, sectionKey: SectionKey, sectionProgress: number,
  view: StoneView, now: number, dt: number, reduceMotion: boolean,
): void {
  st.view = view;
  st.reduceMotion = reduceMotion;
  const R = stoneR(st, view);

  // ─ 光の筋（Aメロ）
  if (!reduceMotion && (sectionKey === "verseA" || sectionKey === "verseA2")) {
    const every = sectionKey === "verseA2" ? STREAK_PAIR_SEC_A2 : STREAK_PAIR_SEC_A;
    st.streakAcc += dt;
    if (st.streakAcc >= every) {
      st.streakAcc -= every;
      if (st.streakAcc > every) st.streakAcc = 0;   // 裏へ回っていた後などで貯まり過ぎた分は捨てる
      const th0 = Math.random() * TAU, dir = Math.random() < 0.5 ? -1 : 1;
      const squash = rand(0.22, 0.55), tilt = rand(-0.7, 0.7), rad = rand(1.0, 1.06);
      for (let k = 0; k < 2; k++) {   // 2人ずつのハモ＝2本1組
        const s = take(st.streaks, () => ({ alive: false, t0: 0, th0: 0, dir: 1, rad: 1, squash: 0.4, tilt: 0, grey: 255 }));
        s.alive = true;
        s.t0 = now + k * STREAK_PAIR_GAP_MS;
        s.th0 = th0; s.dir = dir;
        s.rad = rad + k * STREAK_PAIR_DR;
        s.squash = squash; s.tilt = tilt;
        s.grey = k === 0 ? 255 : 205;   // 1本目は白、2本目は明るい灰
      }
    }
  } else {
    st.streakAcc = 0;
  }

  // ─ 回る粒（Bメロ・サビ）
  const want = orbitTarget(sectionKey);
  let live = 0;
  for (const o of st.orbiters) if (o.alive && !o.leaving) live++;
  if (live < want) {
    for (let i = live; i < want && st.orbiters.length <= MAX_ORBITERS; i++) {
      let o = st.orbiters.find((q) => !q.alive);
      if (!o) {
        if (st.orbiters.length >= MAX_ORBITERS) break;
        o = { alive: false, alpha: 0, leaving: false, th: 0, speed: 1, rad: 1.5, squash: 0.35, tilt: 0, size: 4, diveT0: -1, diveBig: false, diveHit: false };
        st.orbiters.push(o);
      }
      o.alive = true; o.alpha = 0; o.leaving = false;
      o.th = Math.random() * TAU;
      o.speed = rand(0.9, 1.6) * (Math.random() < 0.8 ? 1 : -1);   // 大半は同じ向き・少しだけ逆回り（揃っていない感じ）
      o.rad = rand(1.3, 1.75); o.squash = rand(0.22, 0.48); o.tilt = rand(-0.45, 0.45);
      o.size = rand(3.5, 5.5);
      o.diveT0 = -1; o.diveBig = false; o.diveHit = false;
    }
  } else if (live > want) {
    let extra = live - want;
    for (let i = st.orbiters.length - 1; i >= 0 && extra > 0; i--) {
      const o = st.orbiters[i];
      if (o.alive && !o.leaving) { o.leaving = true; extra--; }
    }
  }
  // 揃い具合（サビの間だけ 1 へ）
  const syncTarget = sectionKey === "chorus" ? 1 : 0;
  st.sync += Math.sign(syncTarget - st.sync) * Math.min(Math.abs(syncTarget - st.sync), SYNC_EASE * dt);
  if (!reduceMotion) st.syncTheta = (st.syncTheta + SYNC_SPEED * dt) % TAU;

  // サビ: 決まった間隔で全員が揃って当たりに行く（曲の時刻から番号を出すので、見返しでも同じ所で当たる）
  let chorusCut = false;
  if (sectionKey === "chorus" && !reduceMotion) {
    const idx = Math.floor((clamp01(sectionProgress) * sectionSec("chorus")) / CHORUS_CUT_SEC);
    if (idx !== st.lastChorusCut) { chorusCut = st.lastChorusCut >= 0 || idx > 0; st.lastChorusCut = idx; }
  } else {
    st.lastChorusCut = -1;
  }
  const hitRate = sectionKey === "verseB2" ? ORBIT_HIT_RATE_B2 : sectionKey === "verseB" ? ORBIT_HIT_RATE_B : 0;
  const floorY = floorFor(st, view);

  for (const o of st.orbiters) {
    if (!o.alive) continue;
    o.alpha += (o.leaving ? -1 : 1) * ORBIT_FADE * dt;
    if (o.alpha <= 0 && o.leaving) { o.alive = false; continue; }
    o.alpha = clamp01(o.alpha);
    if (reduceMotion) continue;   // 止まったまま置くだけ
    o.th = (o.th + o.speed * dt) % TAU;
    if (chorusCut && o.diveT0 < 0) { o.diveT0 = now; o.diveBig = true; o.diveHit = false; }
    else if (hitRate > 0 && o.diveT0 < 0 && !o.leaving && Math.random() < hitRate * dt) {
      // 手前側にいる時だけ当たりに行く（奥で当たっても石に隠れて見えない）
      const p = orbiterPos(st, o, view, now);
      if (p.z > 0.15) { o.diveT0 = now; o.diveBig = false; o.diveHit = false; }
    }
    if (o.diveT0 >= 0) {
      const u = (now - o.diveT0) / ORBIT_DIVE_MS;
      if (u >= 0.5 && !o.diveHit) {
        o.diveHit = true;
        const p = orbiterPos(st, o, view, now);
        const behind = p.z < 0;
        spawnSpark(st, o.diveBig ? "bigHit" : "hit", p.x, p.y, now, o.diveBig ? 30 : 16, behind);
        if (!behind) {
          const nChip = o.diveBig ? 5 : 2;
          for (let i = 0; i < nChip; i++) {
            const ax = (p.x - view.cx) / Math.max(1, R), ay = (p.y - view.cy) / Math.max(1, R);
            spawnChip(st, p.x, p.y, ax * rand(60, 200) + rand(-60, 60), ay * rand(60, 160) - rand(60, 200), rand(3.5, 7), greyPick(), now, floorY);
          }
        }
      }
      if (u >= 1) o.diveT0 = -1;
    }
  }

  // ─ 後奏のきらめき
  if (sectionKey === "outro" && !reduceMotion) {
    st.twinkleAcc += OUTRO_TWINKLE_RATE * dt;
    while (st.twinkleAcc >= 1) {
      st.twinkleAcc -= 1;
      const a = Math.random() * TAU, rr = R * rand(0.5, 1.45);
      spawnSpark(st, "twinkle", view.cx + Math.cos(a) * rr, view.cy + Math.sin(a) * rr * 0.85, now, rand(10, 20));
    }
  } else {
    st.twinkleAcc = 0;
  }
}

/** 回る粒のいまの位置（揃い具合と当たりに行く動きを混ぜた後） */
function orbiterPos(st: ParticleState, o: Orbiter, v: StoneView, now: number, lagTh = 0): { x: number; y: number; z: number } {
  const R = stoneR(st, v);
  // 揃った時の自分の席: 生きている粒の中の順番で等間隔
  let rank = 0, n = 0;
  for (const q of st.orbiters) { if (!q.alive) continue; if (q === o) rank = n; n++; }
  const seat = st.syncTheta + (TAU * rank) / Math.max(1, n);
  const s = st.sync;
  const th = o.th + angDiff(o.th, seat) * s - lagTh * (o.speed * (1 - s) + SYNC_SPEED * s >= 0 ? 1 : -1);
  let rad = o.rad + (SYNC_RAD - o.rad) * s;
  const squash = o.squash + (SYNC_SQUASH - o.squash) * s;
  const tilt = o.tilt * (1 - s);
  if (o.diveT0 >= 0) {
    const u = clamp01((now - o.diveT0) / ORBIT_DIVE_MS);
    rad = rad + (1.0 - rad) * Math.sin(Math.PI * u);   // 石の表面まで寄って戻る
  }
  return ellipsePt(v.cx, v.cy, R * rad, squash, tilt, th);
}

/** 大サビの上向きの光の柱。active の間、透明なダイヤの中心から淡い白い柱が上へ伸び縮みする。
 *  高さは曲の時刻 tSong から出す（見返しでも同じ姿）。周期は【仮：4秒】。動きを減らす設定では止めた高さ */
export function updateRays(st: ParticleState, view: StoneView, tSong: number, now: number, active: boolean): void {
  const r = st.rays;
  const dt = r.lastNow < 0 ? 0 : Math.min(0.1, Math.max(0, (now - r.lastNow) / 1000));
  r.lastNow = now;
  r.target = active ? 1 : 0;
  r.alpha += Math.sign(r.target - r.alpha) * Math.min(Math.abs(r.target - r.alpha), RAYS_FADE * dt);
  r.x = view.cx; r.y = view.cy;
  r.R = stoneR(st, view);
  const ph = ((tSong % RAYS_PERIOD_SEC) + RAYS_PERIOD_SEC) % RAYS_PERIOD_SEC / RAYS_PERIOD_SEC;
  const k = st.reduceMotion ? (RAYS_REDUCED - RAYS_MIN) / (RAYS_MAX - RAYS_MIN) : 0.5 - 0.5 * Math.cos(TAU * ph);
  r.h = r.R * (RAYS_MIN + (RAYS_MAX - RAYS_MIN) * k);
}

// ───────────────────────────── 進める

/** 削りかすを落とし、寿命の尽きた物を片付ける。毎コマ呼ぶ */
export function stepParticles(st: ParticleState, now: number, dt: number, reduceMotion: boolean): void {
  st.reduceMotion = reduceMotion;
  for (const c of st.chips.items) {
    if (!c.alive) continue;
    c.vy += CHIP_GRAVITY * dt;
    c.vx *= Math.pow(0.6, dt);   // 空気で少し止まる
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.spin += c.spinV * dt;
    if (c.y >= c.floorY && c.vy > 0) {   // 床に着いた: 消えて小さくキラッ
      c.alive = false;
      spawnSpark(st, "land", c.x, c.floorY - 1, now, c.size * 1.4);
      continue;
    }
    if (now - c.t0 > CHIP_LIFE_MS) c.alive = false;
  }
  for (const s of st.streaks.items) if (s.alive && now - s.t0 > STREAK_MS) s.alive = false;
  for (const s of st.sparks.items) if (s.alive && now - s.t0 > sparkDur(s.kind)) s.alive = false;
  for (const b of st.beams.items) if (b.alive && now - b.t0 > b.dur) b.alive = false;
}
function sparkDur(k: SparkKind): number {
  return k === "cut" ? CUT_MS : k === "polish" ? POLISH_MS : k === "land" ? LAND_GLINT_MS : k === "twinkle" ? TWINKLE_MS : k === "bigHit" ? HIT_MS * 1.6 : HIT_MS;
}

/** いま生きている粒の数（確かめ用） */
export function countParticles(st: ParticleState): { chips: number; streaks: number; orbiters: number; sparks: number; beams: number } {
  const n = <T extends { alive: boolean }>(a: T[]) => a.reduce((k, o) => k + (o.alive ? 1 : 0), 0);
  return { chips: n(st.chips.items), streaks: n(st.streaks.items), orbiters: n(st.orbiters), sparks: n(st.sparks.items), beams: n(st.beams.items) };
}

// ───────────────────────────── 作り置きの絵（描く時にだけ document に触る）

function canvasOf(w: number, h: number): { c: HTMLCanvasElement; x: CanvasRenderingContext2D | null } {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return { c, x: c.getContext("2d") };
}
function makeRadial(px: number, stops: [number, string][]): HTMLCanvasElement {
  const { c, x } = canvasOf(px, px);
  if (x) {
    const g = x.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
    for (const [o, col] of stops) g.addColorStop(o, col);
    x.fillStyle = g;
    x.fillRect(0, 0, px, px);
  }
  return c;
}
const DOT_CORE = 0.3;    // 白い粒の絵の中で芯に見える割合
function getDot(st: ParticleState): HTMLCanvasElement {
  return (st.sprites.dot ??= makeRadial(32, [[0, "rgba(255,255,255,1)"], [DOT_CORE, "rgba(255,255,255,0.85)"], [0.6, "rgba(255,255,255,0.18)"], [1, "rgba(255,255,255,0)"]]));
}
function getGlow(st: ParticleState): HTMLCanvasElement {
  return (st.sprites.glow ??= makeRadial(64, [[0, "rgba(255,255,255,0.9)"], [0.25, "rgba(255,255,255,0.45)"], [1, "rgba(255,255,255,0)"]]));
}
/** 白い✦（4本の尖った光条＋柔らかい芯）。絵の大きさの半分が光条の長さ */
function getStar(st: ParticleState): HTMLCanvasElement {
  if (st.sprites.star) return st.sprites.star;
  const px = 96, h = px / 2;
  const { c, x } = canvasOf(px, px);
  if (x) {
    const g = x.createRadialGradient(h, h, 0, h, h, h * 0.45);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, px, px);
    x.fillStyle = "rgba(255,255,255,0.95)";
    const w = px * 0.055;
    x.beginPath();   // 縦の光条
    x.moveTo(h, 0); x.lineTo(h + w, h); x.lineTo(h, px); x.lineTo(h - w, h); x.closePath();
    x.moveTo(0, h); x.lineTo(h, h - w); x.lineTo(px, h); x.lineTo(h, h + w); x.closePath();   // 横の光条
    x.fill();
  }
  return (st.sprites.star = c);
}
/** 菱形の削りかす（色ごと）。上半分は白寄りの面、下半分はその色の面、まわりに薄い滲み。
 *  色は薄めない（人の色を薄くしない）。白寄りなのは光が当たった上の面だけ */
const CHIP_PX = 40;
const CHIP_BODY = 0.5;   // 絵の中で菱形の高さが占める割合
function getChip(st: ParticleState, rgb: RGB): HTMLCanvasElement {
  const key = rgb.join(",");
  let c = st.sprites.chip.get(key);
  if (c) return c;
  const [r, g, b] = rgb;
  const made = canvasOf(CHIP_PX, CHIP_PX);
  c = made.c;
  const x = made.x;
  if (x) {
    const h = CHIP_PX / 2;
    const halo = x.createRadialGradient(h, h, 0, h, h, h);
    halo.addColorStop(0, `rgba(${r},${g},${b},0.45)`);
    halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = halo;
    x.fillRect(0, 0, CHIP_PX, CHIP_PX);
    const hh = (CHIP_PX * CHIP_BODY) / 2, hw = hh * 0.62;
    const lr = Math.round(r + (255 - r) * 0.55), lg = Math.round(g + (255 - g) * 0.55), lb = Math.round(b + (255 - b) * 0.55);
    x.fillStyle = `rgb(${lr},${lg},${lb})`;
    x.beginPath(); x.moveTo(h, h - hh); x.lineTo(h + hw, h); x.lineTo(h - hw, h); x.closePath(); x.fill();
    x.fillStyle = `rgb(${r},${g},${b})`;
    x.beginPath(); x.moveTo(h - hw, h); x.lineTo(h + hw, h); x.lineTo(h, h + hh); x.closePath(); x.fill();
    x.strokeStyle = "rgba(255,255,255,0.8)";
    x.lineWidth = 1;
    x.beginPath(); x.moveTo(h, h - hh); x.lineTo(h + hw, h); x.lineTo(h, h + hh); x.lineTo(h - hw, h); x.closePath(); x.stroke();
  }
  st.sprites.chip.set(key, c);
  return c;
}
/** 光の帯（色ごと）。左端が根元（白い芯→その色）、右へ行くほど消える。縦は中心が濃い */
function getBeam(st: ParticleState, rgb: RGB): HTMLCanvasElement {
  const key = rgb.join(",");
  let c = st.sprites.beam.get(key);
  if (c) return c;
  const [r, g, b] = rgb;
  const W = 160, H = 32;
  const made = canvasOf(W, H);
  c = made.c;
  const x = made.x;
  if (x) {
    const lg = x.createLinearGradient(0, 0, W, 0);
    lg.addColorStop(0, "rgba(255,255,255,1)");
    lg.addColorStop(0.12, `rgba(${r},${g},${b},1)`);
    lg.addColorStop(0.6, `rgba(${r},${g},${b},0.75)`);
    lg.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = lg;
    x.fillRect(0, 0, W, H);
    // 縦の滲み: 中心だけ残す
    x.globalCompositeOperation = "destination-in";
    const vg = x.createLinearGradient(0, 0, 0, H);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(0.35, "rgba(0,0,0,0.55)");
    vg.addColorStop(0.5, "rgba(0,0,0,1)");
    vg.addColorStop(0.65, "rgba(0,0,0,0.55)");
    vg.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = vg;
    x.fillRect(0, 0, W, H);
  }
  st.sprites.beam.set(key, c);
  return c;
}
function getBeamGlow(st: ParticleState, rgb: RGB): HTMLCanvasElement {
  const key = rgb.join(",");
  let c = st.sprites.beamGlow.get(key);
  if (c) return c;
  const [r, g, b] = rgb;
  c = makeRadial(64, [[0, "rgba(255,255,255,0.95)"], [0.22, `rgba(${r},${g},${b},0.9)`], [1, `rgba(${r},${g},${b},0)`]]);
  st.sprites.beamGlow.set(key, c);
  return c;
}
/** 光の柱（白）。下が根元、上へ行くほど消える。横は中心が濃い */
function getPillar(st: ParticleState): HTMLCanvasElement {
  if (st.sprites.pillar) return st.sprites.pillar;
  const W = 64, H = 256;
  const { c, x } = canvasOf(W, H);
  if (x) {
    const hg = x.createLinearGradient(0, 0, W, 0);
    hg.addColorStop(0, "rgba(255,255,255,0)");
    hg.addColorStop(0.3, "rgba(255,255,255,0.45)");
    hg.addColorStop(0.5, "rgba(255,255,255,1)");
    hg.addColorStop(0.7, "rgba(255,255,255,0.45)");
    hg.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = hg;
    x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = "destination-in";
    const vg = x.createLinearGradient(0, 0, 0, H);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(0.45, "rgba(0,0,0,0.6)");
    vg.addColorStop(0.9, "rgba(0,0,0,1)");
    vg.addColorStop(1, "rgba(0,0,0,0.6)");
    x.fillStyle = vg;
    x.fillRect(0, 0, W, H);
  }
  return (st.sprites.pillar = c);
}

// ───────────────────────────── 描く

/** 動画の矩形には描かない（全体の四角＋動画の四角→evenodd で切り抜く）。DiamondCanvas.tsx の drawScreenFlashes と同じ作り */
function beginClip(ctx: CanvasRenderingContext2D, clip?: Rect) {
  ctx.save();
  if (clip && clip.w > 0 && clip.h > 0) {
    // 外側の四角は canvas より大きければよい（dpr の拡大が掛かっていても、はみ出す分には害が無い）
    const big = Math.max(ctx.canvas.width, ctx.canvas.height, 1) * 4;
    ctx.beginPath();
    ctx.rect(-big, -big, big * 3, big * 3);
    ctx.rect(clip.x, clip.y, clip.w, clip.h);
    ctx.clip("evenodd");
  }
}

function drawStar(ctx: CanvasRenderingContext2D, st: ParticleState, x: number, y: number, size: number, a: number, rot = 0) {
  if (a <= 0 || size <= 0) return;
  const img = getStar(st);
  ctx.globalAlpha = Math.min(1, a);
  if (rot) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.drawImage(img, -size, -size, size * 2, size * 2);
    ctx.restore();
  } else {
    ctx.drawImage(img, x - size, y - size, size * 2, size * 2);
  }
}

function drawStreaks(ctx: CanvasRenderingContext2D, st: ParticleState, now: number, front: boolean) {
  const v = st.view;
  if (!v) return;
  const R = stoneR(st, v);
  const dot = getDot(st);
  for (const s of st.streaks.items) {
    if (!s.alive) continue;
    const u = (now - s.t0) / STREAK_MS;
    if (u < 0 || u > 1) continue;
    const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);   // はじめゆっくり・中ほど速く・終わりゆっくり
    const head = s.th0 + s.dir * STREAK_SWEEP * e;
    const trail = STREAK_TRAIL * Math.min(1, u * 3);
    const fade = Math.min(1, u * 6) * Math.min(1, (1 - u) * 4);
    ctx.strokeStyle = `rgb(${s.grey},${s.grey},${s.grey})`;
    ctx.lineCap = "round";
    let prev = ellipsePt(v.cx, v.cy, R * s.rad, s.squash, s.tilt, head - s.dir * trail);
    for (let j = 1; j <= STREAK_SEGS; j++) {
      const f = j / STREAK_SEGS;
      const p = ellipsePt(v.cx, v.cy, R * s.rad, s.squash, s.tilt, head - s.dir * trail * (1 - f));
      const zMid = (p.z + prev.z) / 2;
      if ((zMid >= 0) === front) {
        ctx.globalAlpha = fade * Math.pow(f, 1.5) * 0.95;
        ctx.lineWidth = 0.8 + 2.2 * f;
        ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      prev = p;
    }
    if ((prev.z >= 0) === front) {   // 頭の光
      const w = 7 / DOT_CORE;
      ctx.globalAlpha = fade;
      ctx.drawImage(dot, prev.x - w / 2, prev.y - w / 2, w, w);
    }
  }
  ctx.globalAlpha = 1;
}

function drawOrbiters(ctx: CanvasRenderingContext2D, st: ParticleState, now: number, front: boolean) {
  const v = st.view;
  if (!v || !st.orbiters.length) return;
  const dot = getDot(st);
  for (const o of st.orbiters) {
    if (!o.alive || o.alpha <= 0) continue;
    for (let g = ORBIT_GHOSTS; g >= 0; g--) {   // 残像（後ろから）→本体
      if (st.reduceMotion && g > 0) continue;
      const p = orbiterPos(st, o, v, now, g * 0.07);
      if ((p.z >= 0) !== front) continue;
      const k = 1 - g / (ORBIT_GHOSTS + 1);
      const d = o.size * (0.55 + 0.45 * k) * (0.85 + 0.15 * p.z);   // 奥は少し小さく
      const w = d / DOT_CORE;
      ctx.globalAlpha = o.alpha * k * k;
      ctx.drawImage(dot, p.x - w / 2, p.y - w / 2, w, w);
    }
  }
  ctx.globalAlpha = 1;
}

function drawSparks(ctx: CanvasRenderingContext2D, st: ParticleState, now: number, behind: boolean) {
  const glow = getGlow(st);
  for (const s of st.sparks.items) {
    if (!s.alive || s.behind !== behind) continue;
    const u = (now - s.t0) / sparkDur(s.kind);
    if (u < 0 || u > 1) continue;
    const a = 1 - u;
    if (s.kind === "cut") {
      // 刻んだ瞬間の火花: 白い閃き＋放射状の短い線（白〜灰）
      const r = s.size * (1 + 1.5 * u);
      ctx.globalAlpha = a;
      ctx.drawImage(glow, s.x - r, s.y - r, r * 2, r * 2);
      ctx.lineCap = "round";
      for (let i = 0; i < 7; i++) {
        const ang = s.seed + i * 0.9 + (i * i * 0.37);
        const L0 = s.size * (0.3 + 1.6 * u), L1 = L0 + s.size * (0.9 + 0.5 * ((i * 7 + s.seed) % 1)) * (1 - u * 0.5);
        const c = i % 2 ? 210 : 255;
        ctx.strokeStyle = `rgb(${c},${c},${c})`;
        ctx.lineWidth = 1.6 * a + 0.4;
        ctx.beginPath();
        ctx.moveTo(s.x + Math.cos(ang) * L0, s.y + Math.sin(ang) * L0);
        ctx.lineTo(s.x + Math.cos(ang) * L1, s.y + Math.sin(ang) * L1);
        ctx.stroke();
      }
    } else if (s.kind === "polish") {
      // 磨いた瞬間の光の輪: 広がって薄くなる白い輪＋芯の✦
      const r = s.size * (0.2 + 0.8 * (1 - (1 - u) * (1 - u)));
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = "rgb(255,255,255)";
      ctx.lineWidth = 2.4 * a + 0.4;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.stroke();
      const gr = s.size * 0.5 * a;
      ctx.globalAlpha = a * 0.8;
      ctx.drawImage(glow, s.x - gr, s.y - gr, gr * 2, gr * 2);
      drawStar(ctx, st, s.x, s.y, s.size * 0.45 * (1 - u * 0.6), a);
    } else if (s.kind === "hit" || s.kind === "bigHit") {
      const r = s.size * (0.6 + 1.2 * u);
      ctx.globalAlpha = a;
      ctx.drawImage(glow, s.x - r, s.y - r, r * 2, r * 2);
      if (s.kind === "bigHit") drawStar(ctx, st, s.x, s.y, s.size * (0.6 + 0.6 * u), a);
    } else if (s.kind === "land") {
      drawStar(ctx, st, s.x, s.y, s.size * (1 - Math.abs(u * 2 - 1) * 0.6), a);
    } else if (s.kind === "twinkle") {
      const k = Math.sin(Math.PI * u);   // ふわっと現れて消える
      drawStar(ctx, st, s.x, s.y, s.size * (0.4 + 0.6 * k), k, u * 0.6);
    }
  }
  ctx.globalAlpha = 1;
}

function drawChips(ctx: CanvasRenderingContext2D, st: ParticleState) {
  const glow = getGlow(st);
  for (const c of st.chips.items) {
    if (!c.alive) continue;
    const img = getChip(st, c.rgb);
    const cs = Math.cos(c.spin);
    const w = (c.size / CHIP_BODY) * Math.max(0.18, Math.abs(cs));   // 幅だけ縮めて、ひらひら回って見せる
    const h = c.size / CHIP_BODY;
    ctx.globalAlpha = 1;
    ctx.drawImage(img, c.x - w / 2, c.y - h / 2, w, h);
    if (Math.abs(cs) > 0.9) {   // 面がこちらを向いた瞬間にキラッ（派手にしてよい: Hop判断）
      const g = c.size * 1.6;
      ctx.globalAlpha = (Math.abs(cs) - 0.9) * 10;
      ctx.drawImage(glow, c.x - g, c.y - g, g * 2, g * 2);
    }
  }
  ctx.globalAlpha = 1;
}

function drawBeams(ctx: CanvasRenderingContext2D, st: ParticleState, now: number) {
  for (const b of st.beams.items) {
    if (!b.alive) continue;
    const u = (now - b.t0) / b.dur;
    if (u < 0 || u > 1) continue;
    if (!b.rgb) {
      // 白の分: ✦が膨らんで、少し回りながら消える
      const k = b.grow ? Math.sin(Math.PI * Math.min(1, u * 1.1)) : 1 - u;
      drawStar(ctx, st, b.x, b.y, WHITE_STAR_SIZE * (0.35 + 0.65 * k), Math.min(1, k * 1.4), u * 0.5);
      continue;
    }
    const tg = b.grow ? Math.min(1, (now - b.t0) / BEAM_GROW_MS) : 1;
    const grow = 1 - (1 - tg) * (1 - tg) * (1 - tg);
    const a = u < 0.35 ? 1 : 1 - (u - 0.35) / 0.65;   // 伸びた後、消えていく（色は薄めず、光そのものが消える）
    const len = b.len * grow;
    const wdt = BEAM_W * (1 - 0.4 * u);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(Math.atan2(b.uy, b.ux));
    ctx.globalAlpha = a;
    ctx.drawImage(getBeam(st, b.rgb), 0, -wdt, len, wdt * 2);   // 絵の縦の真ん中が帯の芯
    ctx.restore();
    const gr = BEAM_W * 1.6 * (1 - u * 0.5);
    ctx.globalAlpha = a;
    ctx.drawImage(getBeamGlow(st, b.rgb), b.x - gr, b.y - gr, gr * 2, gr * 2);
  }
  ctx.globalAlpha = 1;
}

function drawRays(ctx: CanvasRenderingContext2D, st: ParticleState) {
  const r = st.rays;
  if (r.alpha <= 0.001 || r.R <= 0) return;
  const img = getPillar(st);
  const w = r.R * RAYS_WIDTH * 2;
  ctx.globalAlpha = r.alpha * RAYS_ALPHA;
  ctx.drawImage(img, r.x - w / 2, r.y - r.h, w, r.h + r.R * 0.2);
  // 細く明るい芯
  ctx.globalAlpha = r.alpha * RAYS_ALPHA * 0.8;
  ctx.drawImage(img, r.x - w / 6, r.y - r.h * 1.08, w / 3, r.h * 1.08 + r.R * 0.2);
  ctx.globalAlpha = 1;
}

/** 石の裏に描く分（石より先に呼ぶ）: 光の柱・筋と回る粒のうち奥を通る分・奥の当たり */
export function drawParticlesBehind(ctx: CanvasRenderingContext2D, st: ParticleState, now: number, clip?: Rect): void {
  beginClip(ctx, clip);
  ctx.globalCompositeOperation = "lighter";
  drawRays(ctx, st);
  drawStreaks(ctx, st, now, false);
  drawOrbiters(ctx, st, now, false);
  drawSparks(ctx, st, now, true);
  ctx.restore();
}

/** 石の手前に描く分（石の後に呼ぶ）: 筋と回る粒のうち手前を通る分・削りかす・火花・光の輪・放つ光・きらめき */
export function drawParticlesFront(ctx: CanvasRenderingContext2D, st: ParticleState, now: number, clip?: Rect): void {
  beginClip(ctx, clip);
  ctx.globalCompositeOperation = "lighter";
  drawStreaks(ctx, st, now, true);
  drawOrbiters(ctx, st, now, true);
  ctx.globalCompositeOperation = "source-over";   // 削りかすの本体は色をそのまま（光で白く飛ばさない）
  drawChips(ctx, st);
  ctx.globalCompositeOperation = "lighter";
  drawBeams(ctx, st, now);
  drawSparks(ctx, st, now, false);
  ctx.restore();
}
