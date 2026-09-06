// 💎が上から降って画面の下に積もり、曲が進むとカメラが引いて山が動画の背景になるキャンバス。
//
// 描く場所のルール（YouTube API 規約）: 動画プレイヤーの上には何も描かない。
// このキャンバスは動画の裏（z-index 下）に置き、光の類は描画時に動画の矩形をクリップで除外する。
// 💎そのものは動画の裏を通る（隠れる）だけで、動画の上には出ない。
//
// 世界座標: カメラ倍率1のときの画面座標と同じ。y は画面上端=0 で下へ正。
// カメラの軸は「床（画面の下端）」。引くほど山は画面の下に縮んで留まり、動画（固定）の下に収まる。
// 動画の中心を軸にすると、引くほど山の頂上が動画の中心に寄ってしまい、山を動画の下に留められない。
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type DiamondCanvasApi = {
  /** その色の💎を1つ、画面の上から降らせる。速さ・回転の向きと速さは1つずつ違う。
   *  self=true は自分の💎: 画面内の上寄りに出て、出た瞬間にピカッと光る（押した手応え） */
  spawn: (color: string, self?: boolean) => void;
  /** 動画の現在時刻と総尺（秒）。カメラの引き・寄りに使う */
  setTime: (t: number, duration: number) => void;
  /** 山・降っている💎・カメラをすべて最初の状態に戻す（「最初に戻る」→ もう一度はじめる時） */
  reset: () => void;
};

interface Props {
  /** 動画本体（16:9の箱）の要素。毎フレーム位置を測る */
  videoBoxRef: React.RefObject<HTMLElement | null>;
  /** 額縁の太さ(px) */
  frame: number;
  /** 動き軽減：回転と瞬きを止める（軽量・酔い対策） */
  reduceMotion?: boolean;
}

type Gem = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ang: number;
  spin: number;
  size: number;
  rgb: [number, number, number];
  settled: boolean;
  seed: number;
  /** 着地先（世界座標）。降る前に決めて、隙間なく詰まる位置へはめ込む */
  tx: number;
  ty: number;
};

// 【仮】見本の値。実機で見て決める
const GRAVITY = 60;            // px/s^2（世界座標）
const FALL_SPEED_MIN = 40;     // 初速 px/s
const FALL_SPEED_RANGE = 90;
const SPIN_MIN = 0.6;          // rad/s
const SPIN_RANGE = 3.2;
const SIZE_MIN = 16;
const SIZE_RANGE = 8;
const MIN_SCALE = 0.3;         // いちばん引いた時のカメラ倍率【仮】
const FINALE_END_SCALE = 0.7;  // 曲の終わりの倍率【仮】。0.3から一気に1まで寄ると急なので途中で止める
// 数が増えるほど💎を小さくする（ハイ！テンションで人が増えると✋が縮むのと同じ考え・Hop決定 2026-09-06）。
// SHRINK_REF 個までは等倍、それ以降は個数の平方根に反比例して縮み、SHRINK_MIN で止まる【仮】
const SHRINK_REF = 400;
const SHRINK_MIN = 0.6;          // 縮みすぎると面の影で黒っぽく見えるので、この辺で止める
const COUNT_REF = 120;         // この数を超えたら、降った数の平方根に反比例してカメラを引く【仮】
const FINALE_TIME = 206;       // 動画時刻 3:26（曲が一番盛り上がる所）からゆっくり寄り始める（Hop指定 2026-09-06）
const FLOOR_DEPTH = 1.0;       // 床の位置（画面高さの倍数）。カメラの軸が床なので 1.0＝画面の下端が床
const PILE_MAX_ON_SCREEN = 0.7; // 山の頂上が画面のこの高さ（画面高さの倍数）より上に行かないようカメラを抑える。
                                // 終盤に寄った時、山が画面をはみ出すと降ってくる💎が画面の外で着地して見えなくなる（Hop報告 2026-09-07）【仮】
const COL_W = 10;              // 積もり高さの帳簿の列幅
const PACK_RADIUS = 0.6;       // 積もり計算で💎を丸い粒とみなす時の半径（size 倍）。見た目の半径(約1.0)より小さくして深く重ねる＝「ぎっしり」【仮】
const SLOPE = 0.06;            // 山の傾き。小さいほど平らで、瓶に詰めるように下から隙間なく埋まる【仮】
const OUTSIDE_SLOPE = 1.5;     // 画面の端より外へ 1px 出るごとに、積もり高さ何px分の損と数えるか＝端の外の裾野の急さ【仮】
const MAX_GEMS = 4000;         // 配列に持つ💎の上限（焼き込みの絵が作れない環境での保険）
const LIVE_KEEP = 300;         // 1つずつ描き続ける積もった💎の数（山の表面ぶん）。それより古いものは後ろの絵へ焼き込む
const BAKE_BATCH = 200;        // 1フレームで焼き込む上限（一度に大量に描いて引っかからないように）
const BAKE_HEIGHT = 2.0;       // 焼き込み用の絵の高さ（画面高さの倍数・床から上へ）
const BAKE_MAX_AREA = 12e6;    // 焼き込み用の絵の画素数の上限（iOS Safari の1枚あたりの限界より下）

// 宝石の面（Font Awesome gem の外形に合わせた 5+3 面）。座標は -1..1。n は擬似的な法線
type Facet = { pts: [number, number][]; n: [number, number, number] };
const FACETS: Facet[] = [
  { pts: [[-0.55, -0.35], [-0.9, 0], [-0.3, 0]], n: [-0.7, -0.3, 0.65] },
  { pts: [[-0.55, -0.35], [0, -0.35], [-0.3, 0]], n: [-0.25, -0.6, 0.76] },
  { pts: [[-0.3, 0], [0, -0.35], [0.3, 0]], n: [0, -0.45, 0.9] },
  { pts: [[0.55, -0.35], [0, -0.35], [0.3, 0]], n: [0.25, -0.6, 0.76] },
  { pts: [[0.55, -0.35], [0.9, 0], [0.3, 0]], n: [0.7, -0.3, 0.65] },
  { pts: [[-0.9, 0], [-0.3, 0], [0, 0.9]], n: [-0.55, 0.5, 0.67] },
  { pts: [[-0.3, 0], [0.3, 0], [0, 0.9]], n: [0, 0.35, 0.94] },
  { pts: [[0.9, 0], [0.3, 0], [0, 0.9]], n: [0.55, 0.5, 0.67] },
].map((f) => {
  const l = Math.hypot(f.n[0], f.n[1], f.n[2]);
  return { pts: f.pts as [number, number][], n: [f.n[0] / l, f.n[1] / l, f.n[2] / l] as [number, number, number] };
});

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  if (!Number.isFinite(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 面ごとの明るさを計算して 2D コンテキストに宝石を描く（座標は宝石中心・半径1） */
function paintFacets(ctx: CanvasRenderingContext2D, rgb: [number, number, number], ang: number, lightAng: number) {
  const L: [number, number, number] = [Math.cos(lightAng - ang), Math.sin(lightAng - ang), 0.8];
  const ll = Math.hypot(L[0], L[1], L[2]);
  L[0] /= ll; L[1] /= ll; L[2] /= ll;
  for (const f of FACETS) {
    const d = Math.max(0, f.n[0] * L[0] + f.n[1] * L[1] + f.n[2] * L[2]);
    const k = 0.5 + 0.5 * d * d;   // 影の側も暗くしすぎない（小さい💎が黒っぽく見えないように）
    ctx.fillStyle = `rgb(${(rgb[0] * k) | 0},${(rgb[1] * k) | 0},${(rgb[2] * k) | 0})`;
    ctx.beginPath();
    ctx.moveTo(f.pts[0][0], f.pts[0][1]);
    ctx.lineTo(f.pts[1][0], f.pts[1][1]);
    ctx.lineTo(f.pts[2][0], f.pts[2][1]);
    ctx.closePath();
    ctx.fill();
    // 面がちょうど光を返す瞬間だけ白く瞬く
    if (d > 0.965) {
      ctx.fillStyle = `rgba(255,255,255,${((d - 0.965) / 0.035) * 0.95})`;
      ctx.fill();
    }
  }
  ctx.lineWidth = 0.06;
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.moveTo(-0.55, -0.35); ctx.lineTo(0.55, -0.35); ctx.lineTo(0.9, 0); ctx.lineTo(0, 0.9); ctx.lineTo(-0.9, 0);
  ctx.closePath();
  ctx.stroke();
}

// 積もった💎は毎フレーム面を計算せず、色×向き(24段階)ごとに一度描いた小さな絵(スプライト)を貼る。
// 数千個積もっても drawImage の回数が増えるだけで、面の計算は増えない（重さ対策）。
const SPRITE_STEPS = 24;
const SPRITE_PX = 96;           // スプライトの1辺（世界座標で最大 size 36 × 2 ≒ 72px を余裕込みで）
const SPRITE_LIGHT = -Math.PI / 3; // 固定の光の向き（左上から）
const spriteCache = new Map<string, HTMLCanvasElement[]>();
// 落ちている💎の光の輪と、動画の裏を通る時の額縁の灯りも、色ごとに一度だけ描いた絵を貼る。
// 毎フレーム createRadialGradient を作るのは1個ごとに重く、大勢の💎が降る時に効く（発熱対策 2026-09-07）
const GLOW_PX = 64;
const glowCache = new Map<string, { halo: HTMLCanvasElement; edge: HTMLCanvasElement }>();
function getGlow(rgb: [number, number, number]): { halo: HTMLCanvasElement; edge: HTMLCanvasElement } {
  const key = rgb.join(",");
  let g = glowCache.get(key);
  if (g) return g;
  const [r, gg, b] = rgb;
  const make = (stops: [number, string][]) => {
    const c = document.createElement("canvas");
    c.width = GLOW_PX; c.height = GLOW_PX;
    const cx = c.getContext("2d");
    if (cx) {
      const grad = cx.createRadialGradient(GLOW_PX / 2, GLOW_PX / 2, 0, GLOW_PX / 2, GLOW_PX / 2, GLOW_PX / 2);
      for (const [o, col] of stops) grad.addColorStop(o, col);
      cx.fillStyle = grad;
      cx.fillRect(0, 0, GLOW_PX, GLOW_PX);
    }
    return c;
  };
  g = {
    halo: make([[0, `rgba(${r},${gg},${b},0.35)`], [1, `rgba(${r},${gg},${b},0)`]]),
    edge: make([[0, "rgba(255,255,255,0.5)"], [0.3, `rgba(${r},${gg},${b},0.55)`], [1, `rgba(${r},${gg},${b},0)`]]),
  };
  glowCache.set(key, g);
  return g;
}
function getSprites(rgb: [number, number, number]): HTMLCanvasElement[] {
  const key = rgb.join(",");
  let arr = spriteCache.get(key);
  if (arr) return arr;
  arr = [];
  for (let i = 0; i < SPRITE_STEPS; i++) {
    const c = document.createElement("canvas");
    c.width = SPRITE_PX; c.height = SPRITE_PX;
    const cx = c.getContext("2d");
    if (cx) {
      cx.translate(SPRITE_PX / 2, SPRITE_PX / 2);
      cx.rotate((i / SPRITE_STEPS) * Math.PI * 2);
      cx.scale(SPRITE_PX / 2 / 1.0 * 0.95, SPRITE_PX / 2 / 1.0 * 0.95);
      paintFacets(cx, rgb, (i / SPRITE_STEPS) * Math.PI * 2, SPRITE_LIGHT);
    }
    arr.push(c);
  }
  spriteCache.set(key, arr);
  return arr;
}

const DiamondCanvas = forwardRef<DiamondCanvasApi, Props>(function DiamondCanvas({ videoBoxRef, frame, reduceMotion = false }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** 押した瞬間の閃光（世界座標）。短時間で消える */
  const flashesRef = useRef<{ x: number; y: number; t0: number; rgb: [number, number, number]; size: number }[]>([]);
  const reduceMotionRef = useRef(reduceMotion);
  useEffect(() => { reduceMotionRef.current = reduceMotion; }, [reduceMotion]);
  const gemsRef = useRef<Gem[]>([]);
  const timeRef = useRef({ t: 0, d: 284 });
  /** 山の頂上の世界座標（低いほど高い山）。自分の💎を山より上に出すために使う */
  const pileTopRef = useRef(Infinity);
  /** これまでに降った💎の総数（自分＋みんな）。縮み具合の元 */
  const spawnedRef = useRef(0);
  /** 寄り始めの時点の倍率。そこから曲の終わりの倍率へなめらかに寄る */
  const finaleFromRef = useRef(1);
  /** 着地先を決める関数（キャンバスの寸法を知っている useEffect 内で差し替える） */
  const slotRef = useRef<(x: number, size: number, scale: number, self: boolean) => { tx: number; ty: number }>(() => ({ tx: 0, ty: 0 }));
  /** 帳簿と焼き込みの絵を空にする関数（useEffect 内で差し替える） */
  const clearWorldRef = useRef<() => void>(() => {});
  const sizeRef = useRef({ W: 0, H: 0 });
  const camRef = useRef({ scale: 1, cx: 0, cy: 0 });

  useImperativeHandle(ref, () => ({
    spawn(color: string, self = false) {
      const { W, H } = sizeRef.current;
      const { scale, cx } = camRef.current;
      if (!W) return;
      spawnedRef.current += 1;
      const shrink = Math.max(SHRINK_MIN, Math.min(1, Math.sqrt(SHRINK_REF / spawnedRef.current)));
      const size = (SIZE_MIN + Math.random() * SIZE_RANGE) * shrink;
      // いま見えている範囲の横幅に散らす（引くほど広がる）
      const visibleHalf = (W / 2) / scale;
      const x = cx + (Math.random() * 2 - 1) * visibleHalf * 0.94;
      // 自分の💎は画面内（上端から少し下）に出して、出た瞬間の光が見えるようにする。他人は画面の上の外から。
      // ただし山がそこまで届いていたら山の中に出てしまう（上書きに見える）ので、山の頂上より上に出す
      const floorY = H * FLOOR_DEPTH;
      const topWorld = floorY - H / scale;                   // 画面上端の世界座標（軸は床）
      const pileTop = pileTopRef.current;
      let y = self ? topWorld + (60 + Math.random() * 40) / scale : topWorld - size * 2;
      if (pileTop !== Infinity) y = Math.min(y, pileTop - size * 3);
      const gems = gemsRef.current;
      const slot = slotRef.current(x, size, scale, self);
      if (self) flashesRef.current.push({ x: slot.tx, y, t0: performance.now(), rgb: hexToRgb(color), size });
      gems.push({
        x: slot.tx,
        y,
        tx: slot.tx,
        ty: slot.ty,
        vx: 0,
        vy: FALL_SPEED_MIN + Math.random() * FALL_SPEED_RANGE,
        ang: Math.random() * Math.PI * 2,
        spin: (Math.random() < 0.5 ? -1 : 1) * (SPIN_MIN + Math.random() * SPIN_RANGE),
        size,
        rgb: hexToRgb(color),
        settled: false,
        seed: Math.random() * 1000,
      });
    },
    setTime(t: number, duration: number) {
      timeRef.current = { t: Math.max(0, t), d: Math.max(1, duration) };
    },
    reset() {
      gemsRef.current = [];
      flashesRef.current = [];
      spawnedRef.current = 0;
      finaleFromRef.current = 1;
      pileTopRef.current = Infinity;
      timeRef.current = { t: 0, d: timeRef.current.d };
      camRef.current = { scale: 1, cx: camRef.current.cx, cy: camRef.current.cy };
      clearWorldRef.current();
    },
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0, H = 0, dpr = 1;
    let floorY = 0, worldX0 = 0, worldW = 0;
    // 焼き込み用の絵（世界座標そのまま・1px=1px）。上限を超えた古い💎はここへ描き移して配列から外す。
    // 以前は古い順に配列から消していたので、帳簿の高さはそのままなのに山が床側からくり抜かれて宙に浮いた
    let bake: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; x0: number; y0: number; w: number; h: number } | null = null;
    const cols: number[] = [];
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      sizeRef.current = { W, H };
      floorY = H * FLOOR_DEPTH;
      worldW = W / MIN_SCALE;
      worldX0 = W / 2 - worldW / 2;
      const n = Math.ceil(worldW / COL_W) + 1;
      while (cols.length < n) cols.push(0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    clearWorldRef.current = () => {
      cols.fill(0);
      bake = null;   // 焼き込みの絵は捨てて、次に必要になった時に作り直す
    };

    // 着地先の割り当て。cols[c] は列 c の積もった高さ(px)＝地形。
    // 💎を半径 R の丸い粒として、「その列に落としたら地形のどこで止まるか（中心の高さ hc）」を
    // 粒の下側が地形に触れる条件から求める。いま見えている横幅の中で、止まる高さ hc が一番低い列を選ぶ
    // （中心からの距離と散らした位置で軽く重み付け）＝瓶に砂を入れるように下から隙間なく埋まる。
    // 以前は候補を見えている列に限り、土台を「隣の列の一番高い所」にしていたので、カメラが引いて
    // 新しく見えた端の1列に💎が縦に積み上がって塔になり、次の列はその塔の肩に乗る…の連鎖で
    // 山の底辺が斜めに削れて空洞ができていた（Hop指摘 2026-09-07）。
    const restHeight = (c: number, R: number): number => {
      const hc = Math.ceil(R / COL_W);
      let h = 0;
      for (let j = c - hc; j <= c + hc; j++) {
        const dx = (j - c) * COL_W;
        if (Math.abs(dx) > R) continue;
        const ground = j >= 0 && j < cols.length ? cols[j] : 0;
        const v = ground + Math.sqrt(R * R - dx * dx);
        if (v > h) h = v;
      }
      return h;
    };
    slotRef.current = (x: number, size: number, scale: number, self: boolean) => {
      const cx = camRef.current.cx || W / 2;
      const visibleCols = (W / 2) / scale / COL_W;
      const cC = (x - worldX0) / COL_W; // 押した位置ではなく散らした位置を中心の目安に使う（山が偏らない）
      const cMid = (cx - worldX0) / COL_W;
      const R = size * PACK_RADIUS;
      let best = 0, bestScore = Infinity, bestH = 0;
      // 候補は見えている範囲に限らず世界の全列。範囲の外は「端から離れるほど損」にして、
      // 端に塔が立つ代わりに裾野が外へ伸びる（カメラが引くと裾野が見えて、そこが埋まっていく）。
      // 自分の💎だけは必ず画面の中に落とす（押した手応えと閃光が見えなくなるのを防ぐ）
      for (let c = 0; c < cols.length; c++) {
        const off = Math.abs(c - cMid) - visibleCols;
        if (self && off > 0) continue;
        const h = restHeight(c, R);
        const outside = Math.max(0, off) * COL_W * OUTSIDE_SLOPE;
        const score = h + outside + Math.abs(c - cMid) * COL_W * SLOPE + Math.abs(c - cC) * COL_W * 0.15 + Math.random() * size * 0.4;
        if (score < bestScore) { bestScore = score; best = c; bestH = h; }
      }
      // 止まった粒の上側の丸みを地形に足す
      const hc = Math.ceil(R / COL_W);
      for (let j = best - hc; j <= best + hc; j++) {
        if (j < 0 || j >= cols.length) continue;
        const dx = (j - best) * COL_W;
        if (Math.abs(dx) > R) continue;
        cols[j] = Math.max(cols[j], bestH + Math.sqrt(R * R - dx * dx));
      }
      const ty = floorY - bestH;
      const tx = worldX0 + best * COL_W + (Math.random() - 0.5) * COL_W * 0.6;
      return { tx, ty };
    };

    /** 降っている💎: 面を毎フレーム計算して描く（数は少ない） */
    const drawGemLive = (g: Gem, lightAng: number) => {
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.ang);
      ctx.scale(g.size, g.size);
      paintFacets(ctx, g.rgb, g.ang, lightAng);
      ctx.restore();
    };
    /** 積もった💎: スプライトを貼る */
    const drawGemSettled = (g: Gem, target: CanvasRenderingContext2D = ctx) => {
      const sprites = getSprites(g.rgb);
      const i = ((Math.round((g.ang / (Math.PI * 2)) * SPRITE_STEPS) % SPRITE_STEPS) + SPRITE_STEPS) % SPRITE_STEPS;
      const w = (g.size * 2 / 0.95) * 1.12;              // 少し大きめに貼って継ぎ目の隙間を埋める【仮】
      target.drawImage(sprites[i], g.x - w / 2, g.y - w / 2, w, w);
      // 山の瞬きは十字の閃光（flashes）に統一。ここでは点を打たない（Hop指摘 2026-09-06）
    };
    /** 積もった💎のうち新しい LIVE_KEEP 個を残し、古い順に焼き込み用の絵へ描き移して配列から外す。
     *  止まった💎は動かないのに毎フレーム1つずつ貼り直すのが、長い曲でスマホが熱くなる主因だった（Hop報告 2026-09-07） */
    const bakeOldest = (gems: Gem[], count: number) => {
      if (!bake) {
        // 画面の細かさ(dpr)に合わせた解像度で焼く。1px=1pxだと寄った時に写真部分だけぼやける。画素数の上限内に収める
        const bw = worldW, bh = H * BAKE_HEIGHT;
        const res = Math.min(dpr, 2, Math.sqrt(BAKE_MAX_AREA / (bw * bh)));
        const c = document.createElement("canvas");
        c.width = Math.ceil(bw * res);
        c.height = Math.ceil(bh * res);
        const bctx = c.getContext("2d");
        if (!bctx) { gems.splice(0, gems.length - MAX_GEMS); return; } // 絵が作れない環境では従来どおり消す
        bake = { canvas: c, ctx: bctx, x0: worldX0, y0: floorY - bh, w: bw, h: bh };
        bctx.scale(res, res);
        bctx.translate(-bake.x0, -bake.y0);
      }
      let n = 0;
      const limit = Math.min(count, BAKE_BATCH);
      for (let i = 0; i < gems.length && n < limit; i++) {
        const g = gems[i];
        if (!g.settled || g.y - g.size < bake.y0) continue; // 絵の枠より上に積もった分は1つずつ描き続ける
        drawGemSettled(g, bake.ctx);
        gems.splice(i, 1);
        i--;
        n++;
      }
    };

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const box = videoBoxRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!box) return;

      const cr = canvas.getBoundingClientRect();
      const vr = box.getBoundingClientRect();
      const v = { x: vr.left - cr.left, y: vr.top - cr.top, w: vr.width, h: vr.height };
      const f = { x: v.x - frame, y: v.y - frame, w: v.w + frame * 2, h: v.h + frame * 2 };
      const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
      const { t, d } = timeRef.current;
      const p = Math.min(1, t / d);
      // カメラ: 3:26 までは曲の進みで 1 → MIN_SCALE へ引く。3:26 から曲の終わりまでかけてゆっくり 1 へ寄る。
      // 山の高さでは引かない（山が動画の裏へ上がっていくのを許す＝育っていくのが見える）
      const finaleStart = Math.min(FINALE_TIME, d * 0.9);
      let scale: number;
      if (t < finaleStart) {
        const q = t / finaleStart;
        const byTime = 1 - (1 - MIN_SCALE) * q * q;
        // 序盤から長押し連打されると、時間だけの引きでは間に合わず山が画面を埋める。
        // 降った数でも引く（数が増えるほど先回りして広く）。両方の小さい方を採る【仮: COUNT_REF】
        const byCount = Math.max(MIN_SCALE, Math.min(1, Math.sqrt(COUNT_REF / Math.max(1, spawnedRef.current))));
        scale = Math.min(byTime, byCount);
        finaleFromRef.current = scale;
      } else {
        const k = Math.min(1, (t - finaleStart) / Math.max(1, d - finaleStart));
        const from = finaleFromRef.current;
        scale = from + (FINALE_END_SCALE - from) * (k * k * (3 - 2 * k)); // なめらかに寄る
      }
      void p;
      let maxH = 0;
      for (let j = 0; j < cols.length; j++) if (cols[j] > maxH) maxH = cols[j];
      const pileTopWorld = maxH > 0 ? floorY - maxH : Infinity;
      // 山の頂上が画面の上の方まで来たら、寄りを抑えて降ってくる💎の居場所を残す
      if (maxH > 0) scale = Math.min(scale, (H * PILE_MAX_ON_SCREEN) / maxH);
      // 急に変わらないよう、前フレームからなめらかに寄せる
      const prev = camRef.current.scale || scale;
      scale = prev + (scale - prev) * Math.min(1, dt * 4);
      pileTopRef.current = pileTopWorld;
      camRef.current = { scale, cx, cy };
      // 落下（世界座標）: 着地先まで落ちて止まる。横には流れない（着地先が最初から詰まる位置なので）
      const gems = gemsRef.current;
      for (const g of gems) {
        if (g.settled) continue;
        g.vy += GRAVITY * dt;
        g.y += g.vy * dt;
        if (!reduceMotionRef.current) g.ang += g.spin * dt;
        if (g.y >= g.ty) { g.y = g.ty; g.settled = true; g.vx = 0; }
      }

      // 額縁の地色（画面座標・カメラの外）
      ctx.fillStyle = "#1a1d24";
      ctx.fillRect(f.x, f.y, f.w, f.h);

      if (gems.length === 0) return;
      const lightAng = reduceMotionRef.current ? SPRITE_LIGHT : (now / 1000) * 0.35; // 全体の光の向きをゆっくり回す＝面が順番に瞬く

      // 光（画面座標）: 💎のまわりの小さな輪。動画の裏を通っている間は、いちばん近い額縁の辺を灯す。
      // どちらも動画の矩形を除外して描く
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.rect(v.x, v.y, v.w, v.h);
      ctx.clip("evenodd");
      ctx.globalCompositeOperation = "lighter";
      for (const g of gems) {
        if (g.settled) continue;
        const sx = cx + (g.x - cx) * scale, sy = H + (g.y - floorY) * scale;
        const r = g.size * scale * 1.6;
        const glow = getGlow(g.rgb);
        ctx.drawImage(glow.halo, sx - r, sy - r, r * 2, r * 2);
        // 動画の裏を通っている？
        if (sx > v.x && sx < v.x + v.w && sy > v.y && sy < v.y + v.h) {
          const dl = sx - v.x, dr = v.x + v.w - sx, dtp = sy - v.y, db = v.y + v.h - sy;
          const m = Math.min(dl, dr, dtp, db);
          const hit = m === dl ? { x: v.x, y: sy } : m === dr ? { x: v.x + v.w, y: sy } : m === dtp ? { x: sx, y: v.y } : { x: sx, y: v.y + v.h };
          const reach = 90 * scale;
          const k = Math.max(0, 1 - m / Math.max(1, Math.min(v.w, v.h) / 2)) * 0.9;
          ctx.globalAlpha = k;   // 灯りの強さは色の濃さの掛け算なので、絵を1枚にして全体の透明度で代える
          ctx.drawImage(glow.edge, hit.x - reach, hit.y - reach, reach * 2, reach * 2);
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();

      // 💎本体（世界座標をカメラで縮めて描く。軸は床＝画面の下端、横は動画の中心）
      ctx.save();
      ctx.translate(cx, H);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -floorY);
      let settledCount = 0;
      for (const g of gems) if (g.settled) settledCount++;
      if (settledCount > LIVE_KEEP) bakeOldest(gems, settledCount - LIVE_KEEP);
      else if (gems.length > MAX_GEMS) bakeOldest(gems, gems.length - MAX_GEMS);
      if (bake) ctx.drawImage(bake.canvas, bake.x0, bake.y0, bake.w, bake.h);
      for (const g of gems) {
        if (g.settled) drawGemSettled(g);
        else drawGemLive(g, lightAng);
      }
      // 山のきらめき: 積もった💎からランダムに1つ選び、押した時と同じ閃光を出す。
      // 曲が進むほど頻度が上がり、最後の山で一番ピカピカする【仮: 毎秒 0.5〜6回】。動き軽減では出さない（飾りなので）
      if (!reduceMotionRef.current) {
        settledCount = 0;
        for (const g of gems) if (g.settled) settledCount++;
        if (settledCount > 0) {
          const rate = 0.5 + 5.5 * p * p;
          if (Math.random() < rate * dt) {
            let idx = Math.floor(Math.random() * settledCount);
            for (const g of gems) {
              if (!g.settled) continue;
              if (idx-- === 0) { flashesRef.current.push({ x: g.x, y: g.y, t0: now, rgb: g.rgb, size: g.size * 0.8 }); break; }
            }
          }
        }
      }
      // 閃光: 白い芯＋その色の輪が広がって消える（約320ms）。押した手応えの分は動き軽減でも出す
      const flashes = flashesRef.current;
      if (flashes.length) {
        ctx.globalCompositeOperation = "lighter";
        for (let i = flashes.length - 1; i >= 0; i--) {
          const fl = flashes[i];
          const k = (now - fl.t0) / 320;
          if (k >= 1) { flashes.splice(i, 1); continue; }
          const r = fl.size * (1.2 + 2.6 * k);
          const a = 1 - k;
          const rg = ctx.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, r);
          rg.addColorStop(0, `rgba(255,255,255,${0.95 * a})`);
          rg.addColorStop(0.35, `rgba(${fl.rgb[0]},${fl.rgb[1]},${fl.rgb[2]},${0.7 * a})`);
          rg.addColorStop(1, `rgba(${fl.rgb[0]},${fl.rgb[1]},${fl.rgb[2]},0)`);
          ctx.fillStyle = rg;
          ctx.fillRect(fl.x - r, fl.y - r, r * 2, r * 2);
          // 十字の光条
          ctx.strokeStyle = `rgba(255,255,255,${0.8 * a})`;
          ctx.lineWidth = 2 / Math.max(scale, 0.01);
          const L = fl.size * (2 + 3 * k);
          ctx.beginPath();
          ctx.moveTo(fl.x - L, fl.y); ctx.lineTo(fl.x + L, fl.y);
          ctx.moveTo(fl.x, fl.y - L); ctx.lineTo(fl.x, fl.y + L);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.restore();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [videoBoxRef, frame]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", pointerEvents: "none" }}
    />
  );
});

export default DiamondCanvas;
