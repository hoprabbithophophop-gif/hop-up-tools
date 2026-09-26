// 灰toダイヤモンド「原石の版」の絵の器。
//
// 主役は灰色の原石。曲の進行で必ず削れていき、大サビで透明なダイヤが完成する。
// 削れ具合は動画の時刻で決まり、人が少なくても必ず最後まで完成する。
// タップで変わるのは「どの面が何色になるか」と「どれだけ明るく輝くか」だけ（Hop決定 2026-09-26）。
//
// 今の版（DiamondCanvas.tsx＝ミラーボール）と同じ窓口 DiamondCanvasApi を全部実装する。
// ページ側は variant で器を差し替えるだけで、再生の始め方・記録の送り方・終了画面はそのまま。
//
// 描く場所のルール（YouTube API 規約）: 動画プレイヤーの上には何も描かない。
// この器は動画の裏（z-index 下）に置き、石・粒・光の類は動画の矩形をクリップで除外して描く。
// 飛んでいる💎だけは裏を通る（隠れる）だけなので除外しない（今の版と同じ）。
//
// 部品の分担:
//   stoneTimeline.ts  … 曲の区切りと、時刻ごとの削れ具合（純関数）
//   stoneGeometry.ts  … 原石→ダイヤの形と、面ごとの削れる順番
//   stoneRender.ts    … 石そのものを描く
//   stoneParticles.ts … 光の筋・回る粒・削りかす・放つ光・上へ伸びる光
//   stonePile.ts      … 削りかすの山と個数
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { DiamondCanvasApi, DiamondMode } from "../DiamondCanvas";
import { hexToRgb } from "../gemFacets";
import { requestStoneSpritesByHex, warmUpGemRenderer, TUMBLE_PATHS } from "../gemSprites";
import { findDiamondMember } from "../members";
import { drawGemLive, MAX_DPR, SHRINK_MIN, SHRINK_REF, SIZE_MIN, SIZE_RANGE } from "../canvas/pile";
import type { FaceState, RGB, Rect, StoneLayout, StoneView } from "./stoneTypes";
import { buildStoneMesh, morphVertices } from "./stoneGeometry";
import { drawStone, drawStoneGhost, pickTargetFace, projectFaceCenter } from "./stoneRender";
import {
  createParticleState, clearParticles, updateAmbient, emitChips, emitScatter, emitSpark, emitBurst,
  updateRays, stepParticles, drawParticlesBehind, drawParticlesFront, setStoneRadius, setParticleFloor,
} from "./stoneParticles";
import { createPileState, resetPile, setPileTarget, startRain, stepPile, drawPile } from "./stonePile";
import { COMPLETE_TIME, RAIN_TIME, cutFractionAt, sectionAt, sectionProgress, type SectionKey } from "./stoneTimeline";

/** この器の窓口。今の版の窓口に、入口の💎を飛ばす口を1つ足した物。
 *  spawnEntry は「再生開始の合図で入口の💎が飛ぶ」1個で、自分の回数にも山の個数にも数えない（今の版でも回数には数えない） */
export type StoneCanvasApi = DiamondCanvasApi & {
  spawnEntry: (color: string, origin: { x: number; y: number }, key?: string) => void;
};

interface Props {
  /** 動画本体（16:9の箱）の要素。毎フレーム位置を測る */
  videoBoxRef: React.RefObject<HTMLElement | null>;
  /** 額縁の太さ(px) */
  frame: number;
  /** 動き軽減：回転と粒を止める。物語（削れて完成する・山ができる）は最後まで進む */
  reduceMotion?: boolean;
  /** 置き場所。ページが画面の縦横から決めて渡す。まだ測れていない間は null */
  layout: StoneLayout | null;
}

// ── 見た目の決め事（全部【仮】） ─────────────────────────────
const FRAME_BASE: [number, number, number] = [0x1a, 0x1d, 0x24]; // 額縁の地色（今の版と同じ）
const TINT_WINDOW_MS = 2500;   // 額縁の順位に使う直近の幅（今の版と同じ）
const TINT_STRENGTH = 0.45;
const TINT_SLOTS = 4;
const TINT_BASE_TOTAL = 200;
/** 面が削れ始めてから削れ終わるまでの、削れ具合の幅（枚数の割合）。1枚ぶん（1÷74≒0.0135）より少し小さく＝1枚ずつ削れ切る */
const CUT_SOFT = 0.012;
/** 石の回転の速さ(rad/s)。区切りごとに変える */
const SPIN_BASE = 0.32;
const SPIN_CHORUS = 0.55;
const SPIN_FINAL = 0.75;
const SPIN_OUTRO = 0.45;
/** 手前へ倒す角(rad)。上面（テーブルと細かいカット）が多く見える姿勢。尖りは必ず下 */
const TILT_X = 0.42;
/** 動き軽減で止める時の向き */
const STILL_ROT_Y = 0.55;
/** 間奏の脈打ち: 拍の間隔(秒)と膨らみの最大 */
const PULSE_SEC = 0.5;
const PULSE_MAX = 0.05;
/** 輝き（glow）が消えるまでの秒数 */
const GLOW_DECAY_SEC = 2.2;
/** 飛ぶ時間(ms)。今の版と同じ値（自分 1260±210・他の人 980±280） */
const SELF_MS = 1260, SELF_MS_JITTER = 210;
const OTHER_MS = 980, OTHER_MS_JITTER = 280;
/** 押した💎のボタンの中心から、これだけ上を出発点にする（今の版と同じ） */
const SELF_ABOVE_BUTTON = 28;
/** 他の人の分の出発点を画面の縁からこれだけ外へ（今の版と同じ） */
const SPAWN_OUTSIDE = 48;
/** 飛んでいる💎の見かけの倍率（今の版と同じ: 自分1・他の人0.5、全体に1.3） */
const FLY_SCALE = 1.3;
const OTHER_FLY_RATIO = 0.5;
/** まだ面が1つも削れていない間に届いた色を、次に削れる面へ回すための待ち行列の上限 */
const COLOR_QUEUE_MAX = 64;
/** 💎が当たった時に出す削りかすの数 */
const CHIPS_SELF = 7, CHIPS_OTHER = 3;
/** 間奏の飛び散り: 拍ごとに出す削りかすの数 */
const SCATTER_PER_BEAT = 14;
/** 白い色の判定。r,g,b が全部この値以上なら白扱い＝放つ時は十字のきらめき */
const WHITE_MIN = 236;

type Flight = {
  x0: number; y0: number; t0: number; dur: number;
  /** 行き先の面。-1 は面が無い（まだ削れていない）ので石の中心寄りへ */
  face: number;
  /** 面が無い時の行き先（石の中心からのずれ・模型の単位） */
  ox: number; oy: number;
  /** 出発の向きの横への寄せ(px)。少し弧を描く */
  bow: number;
  ang: number; spin: number; path: number; roll: number;
  size: number; rgb: RGB; self: boolean; key: string;
  /** 描く時の使い回し（現在位置） */
  x: number; y: number;
};

const flyDraw = { x: 0, y: 0, ang: 0, path: 0, roll: 0, size: 0, rgb: [0, 0, 0] as RGB };

const StoneCanvas = forwardRef<StoneCanvasApi, Props>(function StoneCanvas({ videoBoxRef, frame, reduceMotion = false, layout }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotionRef = useRef(reduceMotion);
  useEffect(() => { reduceMotionRef.current = reduceMotion; }, [reduceMotion]);
  const layoutRef = useRef<StoneLayout | null>(layout);
  useEffect(() => { layoutRef.current = layout; }, [layout]);

  useEffect(() => { warmUpGemRenderer(); }, []);

  /** 石の形。1回だけ作る */
  const meshRef = useRef(buildStoneMesh(1));
  const mesh = meshRef.current;
  const nFaces = mesh.faces.length;
  /** 面ごとの「削れ始める削れ具合」。cutRank の順に並べて (番号+0.5)÷枚数 にする＝
   *  削れ具合が枚数の割合になり、区切りの表の cutEnd（枚数の配分）どおりに1枚ずつ削れる */
  const thresholdRef = useRef<Float32Array>((() => {
    const order = mesh.faces.map((f, i) => [f.cutRank, i] as const).sort((a, b) => a[0] - b[0]);
    const th = new Float32Array(nFaces);
    order.forEach(([, i], k) => { th[i] = (k + 0.5) / nFaces; });
    return th;
  })());
  const makeFaceState = (): FaceState => ({
    cut: new Float32Array(nFaces),
    color: new Array<RGB | null>(nFaces).fill(null),
    glow: new Float32Array(nFaces),
    own: new Uint8Array(nFaces),
    clear: false,
  });
  const faceRef = useRef<FaceState>(makeFaceState());
  /** 削れ具合を混ぜた頂点（毎コマ書き換え） */
  const vertsRef = useRef(new Float32Array(mesh.fine.length));
  /** 前のコマの削れ具合。「この面がいま削れ切った」を見つけるため */
  const prevCutRef = useRef(new Float32Array(nFaces));
  const viewRef = useRef<StoneView>({ cx: 0, cy: 0, r: 1, rotY: 0, rotX: TILT_X, bulge: 1 });
  const partRef = useRef(createParticleState());
  const pileRef = useRef(createPileState());
  const flightsRef = useRef<Flight[]>([]);
  /** まだ面が無い間に届いた色。次に削れる面がこの順に染まる */
  const colorQueueRef = useRef<RGB[]>([]);
  /** 押した手応えの閃光（画面座標） */
  const flashesRef = useRef<{ x: number; y: number; t0: number; rgb: RGB; size: number }[]>([]);
  /** 直近に届いた💎（額縁の順位と一番輝いた瞬間の元。今の版と同じ作り） */
  const recentRef = useRef<{ t: number; key: string; rgb: RGB }[]>([]);
  const colorTotalsRef = useRef<Map<string, number>>(new Map());
  /** 山の色の配分（メンバー色とその割合）。setColorTotals で組み直す */
  const pileColorsRef = useRef<{ rgb: RGB; weight: number }[]>([]);
  const ownKeyRef = useRef<string | null>(null);
  const peakRef = useRef<Map<string, { t: number; s: number }>>(new Map());
  const frameSlotsRef = useRef(Array.from({ length: TINT_SLOTS }, () => ({ rgb: [...FRAME_BASE] as RGB, w: 0 })));
  const holdRef = useRef(false);
  const timeRef = useRef({ t: 0, d: 280 });
  /** この回に自分が押した数（山の個数に足す） */
  const selfCountRef = useRef(0);
  /** これまでに飛ばした総数（縮み具合の元・今の版と同じ） */
  const spawnedRef = useRef(0);
  /** 完成の瞬間の光をもう放ったか */
  const burstRef = useRef(false);
  /** 降り注ぎを始めたか */
  const rainRef = useRef(false);
  /** 回転の角と、最後に進めた実時間 */
  const rotRef = useRef(0);
  /** 間奏の拍の控え（飛び散りを拍ごとに1回出す） */
  const lastBeatRef = useRef(-1);
  const sizeRef = useRef({ W: 0, H: 0 });
  const videoRectRef = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const clearAll = () => {
    faceRef.current = makeFaceState();
    prevCutRef.current.fill(0);
    flightsRef.current = [];
    colorQueueRef.current = [];
    flashesRef.current = [];
    recentRef.current = [];
    peakRef.current.clear();
    for (const sl of frameSlotsRef.current) { sl.rgb = [...FRAME_BASE] as RGB; sl.w = 0; }
    holdRef.current = false;
    selfCountRef.current = 0;
    spawnedRef.current = 0;
    burstRef.current = false;
    rainRef.current = false;
    lastBeatRef.current = -1;
    clearParticles(partRef.current);
    resetPile(pileRef.current);
    timeRef.current = { t: 0, d: timeRef.current.d };
  };

  /** いま石が画面のどこにあるか（置き場所と動画の位置から） */
  const isWhite = (rgb: RGB) => rgb[0] >= WHITE_MIN && rgb[1] >= WHITE_MIN && rgb[2] >= WHITE_MIN;

  /** 💎を当てる面を選ぶ。表を向いていて削れ始めた面のうち、投影した中心が動画の矩形の外にある面を優先する
   *  （横長のPCでは原石が動画の裏にあり、動画の中に着くと自分の💎も印も見えないため）。外に無ければ中も許す */
  const pickVisibleFace = (prefer: "uncolored" | "any"): number => {
    const st = faceRef.current, view = viewRef.current, v = videoRectRef.current;
    const p = { x: 0, y: 0, depth: 0, front: false };
    let last = -1;
    for (let tries = 0; tries < 10; tries++) {
      const f = pickTargetFace(mesh, vertsRef.current, st, view, prefer, Math.random);
      if (f < 0) return -1;
      last = f;
      if (!v.w) return f;
      projectFaceCenter(mesh, vertsRef.current, f, view, p);
      const inside = p.x > v.x && p.x < v.x + v.w && p.y > v.y && p.y < v.y + v.h;
      if (!inside) return f;
    }
    return last;
  };

  /** 1個飛ばす。counted=false は入口の💎（回数にも山の個数にも数えない） */
  const launch = (color: string, self: boolean, origin: { x: number; y: number } | undefined, key: string | undefined, counted: boolean) => {
      const { W, H } = sizeRef.current;
      if (!W) return;
      const now = performance.now();
      const rgb = hexToRgb(color);
      spawnedRef.current += 1;
      if (self && counted) selfCountRef.current += 1;
      if (counted) recentRef.current.push({ t: now, key: key ?? rgb.join(","), rgb });
      const view = viewRef.current;
      // 出発点。自分は押した💎のボタンのすぐ上（無ければ画面の下の方の中央寄り）、他の人は画面の縁の外
      let x0: number, y0: number, bow = 0;
      if (self) {
        if (origin) { x0 = origin.x; y0 = origin.y - SELF_ABOVE_BUTTON; }
        else { x0 = W / 2 + (Math.random() - 0.5) * 160; y0 = H - 230 + (Math.random() - 0.5) * 40; }
        bow = (Math.random() < 0.5 ? -1 : 1) * 45;
      } else {
        // 縁のどこか。石に近い辺を避けず、全周から均等に（画面の中で湧いたように見えないよう外へ押し出す）
        const side = Math.floor(Math.random() * 4);
        const u = Math.random();
        if (side === 0) { x0 = u * W; y0 = -SPAWN_OUTSIDE; }
        else if (side === 1) { x0 = W + SPAWN_OUTSIDE; y0 = u * H; }
        else if (side === 2) { x0 = u * W; y0 = H + SPAWN_OUTSIDE; }
        else { x0 = -SPAWN_OUTSIDE; y0 = u * H; }
      }
      const shrink = Math.max(SHRINK_MIN, Math.min(1, Math.sqrt(SHRINK_REF / Math.max(1, spawnedRef.current))));
      const size = (SIZE_MIN + Math.random() * SIZE_RANGE) * shrink * (self ? 1 : OTHER_FLY_RATIO) * FLY_SCALE;
      const face = pickVisibleFace("uncolored");
      const a = Math.random() * Math.PI * 2;
      flightsRef.current.push({
        x0, y0, t0: now,
        dur: self ? SELF_MS + Math.random() * SELF_MS_JITTER : OTHER_MS + Math.random() * OTHER_MS_JITTER,
        face,
        ox: Math.cos(a) * 0.45, oy: Math.sin(a) * 0.35,
        bow,
        ang: Math.random() * Math.PI * 2,
        spin: (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 2.4),
        path: Math.floor(Math.random() * TUMBLE_PATHS),
        roll: Math.random() * Math.PI * 2,
        size, rgb, self, key: key ?? rgb.join(","),
        x: x0, y: y0,
      });
      // 押した手応えの閃光は出発点に（今の版と同じ）。入口の💎は押していないので出さない
      if (self && counted) flashesRef.current.push({ x: x0, y: y0, t0: now, rgb, size: 10 });
  };

  useImperativeHandle(ref, () => ({
    spawn(color: string, self = false, origin?: { x: number; y: number }, key?: string) {
      launch(color, self, origin, key, true);
    },
    spawnEntry(color: string, origin: { x: number; y: number }, key?: string) {
      launch(color, true, origin, key, false);
    },
    setTime(t: number, duration: number) {
      timeRef.current = { t: Math.max(0, t), d: Math.max(1, duration) };
    },
    undoLastSpawn() {
      const fl = flightsRef.current;
      const last = fl[fl.length - 1];
      if (!last || !last.self) return;
      fl.pop();
      spawnedRef.current = Math.max(0, spawnedRef.current - 1);
      selfCountRef.current = Math.max(0, selfCountRef.current - 1);
      recentRef.current.pop();
      const sf = flashesRef.current;
      if (sf.length && Math.abs(sf[sf.length - 1].x - last.x0) < 1) sf.pop();
    },
    setOwnColor(hex: string, key?: string) {
      ownKeyRef.current = key ?? hexToRgb(hex).join(",");
      requestStoneSpritesByHex(hex, true);
    },
    getPeakTime(key?: string) {
      const k = key ?? ownKeyRef.current;
      if (!k) return null;
      return peakRef.current.get(k)?.t ?? null;
    },
    setHoldCamera(on: boolean) { holdRef.current = on; },
    // 山を夜空へ放つ演出はこの版には無い。降り注ぎは stoneTimeline の RAIN_TIME（4:30）で自分で始める【仮】。
    // ページが 268.5 秒で呼ぶ合図は受け取るだけで何もしない
    launchToSky() { /* この版では何もしない */ },
    setMode(_mode: DiamondMode) { /* この版は方式が1つ。切り替えは無い */ },
    setColorTotals(totals: Record<string, number>) {
      const m = new Map<string, number>();
      let sum = 0;
      for (const [id, n] of Object.entries(totals)) { m.set(id, n); sum += n; }
      colorTotalsRef.current = m;
      // 山の色の配分。メンバーごとの総数の割合で、その人の色を散らす
      const cols: { rgb: RGB; weight: number }[] = [];
      for (const [id, n] of m) {
        const hex = findDiamondMember(id)?.color;
        if (!hex || n <= 0) continue;
        cols.push({ rgb: hexToRgb(hex), weight: sum > 0 ? n / sum : 0 });
      }
      pileColorsRef.current = cols;
    },
    reset() { clearAll(); },
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let W = 0, H = 0, dpr = 1;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      sizeRef.current = { W, H };
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const proj = { x: 0, y: 0, depth: 0, front: false };
    const light: [number, number, number] = [-0.45, 0.7, 0.55];
    {
      const l = Math.hypot(light[0], light[1], light[2]);
      light[0] /= l; light[1] /= l; light[2] /= l;
    }

    /** 閃光（画面座標）。光の類なので動画の矩形は除外して描く（今の版の drawScreenFlashes と同じ） */
    const drawFlashes = (v: Rect, now: number) => {
      const sf = flashesRef.current;
      if (!sf.length) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.rect(v.x, v.y, v.w, v.h);
      ctx.clip("evenodd");
      ctx.globalCompositeOperation = "lighter";
      for (let i = sf.length - 1; i >= 0; i--) {
        const fl = sf[i];
        const k = (now - fl.t0) / 320;
        if (k >= 1) { sf.splice(i, 1); continue; }
        const r = Math.max(1, fl.size * (1.2 + 2.6 * k));
        const a = 1 - k;
        const rg = ctx.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, r);
        rg.addColorStop(0, `rgba(255,255,255,${0.95 * a})`);
        rg.addColorStop(0.35, `rgba(${fl.rgb[0]},${fl.rgb[1]},${fl.rgb[2]},${0.7 * a})`);
        rg.addColorStop(1, `rgba(${fl.rgb[0]},${fl.rgb[1]},${fl.rgb[2]},0)`);
        ctx.fillStyle = rg;
        ctx.fillRect(fl.x - r, fl.y - r, r * 2, r * 2);
        ctx.strokeStyle = `rgba(255,255,255,${0.8 * a})`;
        ctx.lineWidth = 2;
        const L = fl.size * (2 + 3 * k);
        ctx.beginPath();
        ctx.moveTo(fl.x - L, fl.y); ctx.lineTo(fl.x + L, fl.y);
        ctx.moveTo(fl.x, fl.y - L); ctx.lineTo(fl.x, fl.y + L);
        ctx.stroke();
      }
      ctx.restore();
    };

    /** 額縁の地色（今の版と同じ作り: 直近2.5秒の上位4色を左から幅＝割合で並べて染める。名前・数字は出さない） */
    const drawFrame = (f: Rect, now: number, dt: number) => {
      const recent = recentRef.current;
      const cutoff = now - TINT_WINDOW_MS;
      let drop = 0;
      while (drop < recent.length && recent[drop].t < cutoff) drop++;
      if (drop > 0) recent.splice(0, drop);
      const counts = new Map<string, { n: number; rgb: RGB }>();
      for (const r of recent) {
        const c = counts.get(r.key);
        if (c) c.n++; else counts.set(r.key, { n: 1, rgb: r.rgb });
      }
      const totals = colorTotalsRef.current;
      const scored = [...counts.entries()].map(([key, c]) => ({ key, rgb: c.rgb, s: c.n / ((totals.get(key) ?? 0) + TINT_BASE_TOTAL) }));
      if (!holdRef.current) {
        const peaks = peakRef.current;
        for (const c of scored) {
          const cur = peaks.get(c.key);
          if (!cur || c.s > cur.s) peaks.set(c.key, { t: timeRef.current.t, s: c.s });
        }
      }
      const top = scored.sort((a, b) => b.s - a.s).slice(0, TINT_SLOTS);
      const topSum = top.reduce((acc, c) => acc + c.s, 0);
      const slots = frameSlotsRef.current;
      const k = Math.min(1, dt * 2);
      for (let i = 0; i < TINT_SLOTS; i++) {
        const t = top[i];
        const rgbT: RGB = t
          ? [FRAME_BASE[0] + (t.rgb[0] - FRAME_BASE[0]) * TINT_STRENGTH, FRAME_BASE[1] + (t.rgb[1] - FRAME_BASE[1]) * TINT_STRENGTH, FRAME_BASE[2] + (t.rgb[2] - FRAME_BASE[2]) * TINT_STRENGTH]
          : FRAME_BASE;
        const wT = t ? t.s / topSum : 0;
        const sl = slots[i];
        sl.rgb[0] += (rgbT[0] - sl.rgb[0]) * k;
        sl.rgb[1] += (rgbT[1] - sl.rgb[1]) * k;
        sl.rgb[2] += (rgbT[2] - sl.rgb[2]) * k;
        sl.w += (wT - sl.w) * k;
      }
      const wSum = slots.reduce((acc, sl) => acc + sl.w, 0);
      if (wSum < 0.01) {
        ctx.fillStyle = `rgb(${FRAME_BASE[0]},${FRAME_BASE[1]},${FRAME_BASE[2]})`;
      } else {
        const g = ctx.createLinearGradient(f.x, 0, f.x + f.w, 0);
        const soft = 0.03;
        let acc = 0;
        for (const sl of slots) {
          const w = sl.w / wSum;
          if (w <= 0) continue;
          const col = `rgb(${sl.rgb[0] | 0},${sl.rgb[1] | 0},${sl.rgb[2] | 0})`;
          g.addColorStop(Math.min(1, acc + Math.min(soft, w / 2)), col);
          g.addColorStop(Math.max(0, Math.min(1, acc + w - Math.min(soft, w / 2))), col);
          acc += w;
        }
        ctx.fillStyle = g;
      }
      ctx.fillRect(f.x, f.y, f.w, f.h);
    };

    /** 💎が石に着いた */
    const arrive = (fl: Flight, now: number, section: SectionKey, floorY: number) => {
      const st = faceRef.current;
      const view = viewRef.current;
      let f = fl.face;
      // 押した時に選んだ面が、飛んでいる間に裏へ回っていたら選び直す
      if (f >= 0) {
        projectFaceCenter(mesh, vertsRef.current, f, view, proj);
        if (!proj.front) f = pickVisibleFace("uncolored");
      }
      if (f < 0) f = pickVisibleFace("uncolored");
      if (f >= 0 && !st.clear) {
        st.color[f] = fl.rgb;
        st.glow[f] = 1;
        if (fl.self) st.own[f] = 1;
      } else if (f >= 0) {
        // 完成した後は色は放たれた後なので面には残さない。輝きだけ
        st.glow[f] = 1;
        if (fl.self) st.own[f] = 1;
      } else {
        // まだ面が無い。色は次に削れる面へ回す
        const q = colorQueueRef.current;
        q.push(fl.rgb);
        if (q.length > COLOR_QUEUE_MAX) q.shift();
      }
      flashesRef.current.push({ x: fl.x, y: fl.y, t0: now, rgb: fl.rgb, size: fl.self ? 12 : 7 });
      emitChips(partRef.current, fl.x, fl.y, fl.rgb, fl.self ? CHIPS_SELF : CHIPS_OTHER, now, floorY);
      void section;
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
      const v: Rect = { x: vr.left - cr.left, y: vr.top - cr.top, w: vr.width, h: vr.height };
      videoRectRef.current = v;
      const f: Rect = { x: v.x - frame, y: v.y - frame, w: v.w + frame * 2, h: v.h + frame * 2 };
      const lay = layoutRef.current;
      const rm = reduceMotionRef.current;
      const { t } = timeRef.current;
      const section = sectionAt(t);
      const sk = section.key;
      const sp = sectionProgress(t);
      const st = faceRef.current;
      const view = viewRef.current;

      // ── 石の置き場所 ──
      if (lay) {
        if (lay.mode === "wide") {
          // 動画の裏に、動画の角より少しはみ出す大きさで
          view.cx = v.x + v.w / 2;
          view.cy = v.y + v.h / 2;
          view.r = Math.min(Math.hypot(v.w, v.h) / 2 * 1.08, H * 0.48) / mesh.roughRadius;
        } else {
          view.cx = lay.stone.x + lay.stone.w / 2;
          view.cy = lay.stone.y + lay.stone.h / 2;
          view.r = Math.min(lay.stone.w, lay.stone.h) / 2 * 0.92 / mesh.roughRadius;
        }
      } else {
        view.cx = W / 2; view.cy = H * 0.62; view.r = Math.min(W, H) * 0.14 / mesh.roughRadius;
      }
      view.rotX = TILT_X;
      const floorY = lay ? lay.pile.y + lay.pile.h : H;
      // 粒の部品に石の大きさと床を知らせる（削りかすが消える所・筋や粒の軌道の半径）
      setStoneRadius(partRef.current, mesh.roughRadius);
      setParticleFloor(partRef.current, floorY);

      // ── 回転（尖りは下のまま、縦の軸だけ回す） ──
      if (rm) {
        view.rotY = STILL_ROT_Y;
      } else if (!holdRef.current) {
        let w = 0;
        if (sk === "prelude") w = SPIN_BASE * sp;                 // ゆっくり回り始める
        else if (sk === "intro" || sk === "headChorus") w = 0;
        else if (sk === "chorus") w = SPIN_CHORUS;
        else if (sk === "finalChorus") w = SPIN_FINAL;
        else if (sk === "outro" || sk === "cheers") w = SPIN_OUTRO;
        else w = SPIN_BASE;
        rotRef.current += w * dt;
        view.rotY = rotRef.current;
      }
      // ── 脈打ち（間奏） ──
      if (sk === "interlude" && !rm) {
        const beat = ((t - 132) % PULSE_SEC) / PULSE_SEC;
        view.bulge = 1 + PULSE_MAX * Math.pow(1 - beat, 2);
        const bi = Math.floor((t - 132) / PULSE_SEC);
        if (bi !== lastBeatRef.current) {
          lastBeatRef.current = bi;
          emitScatter(partRef.current, view, SCATTER_PER_BEAT, now, floorY);
        }
      } else {
        view.bulge += (1 - view.bulge) * Math.min(1, dt * 8);
      }

      // ── 削れ具合（時刻の純関数）。見返し中は止める ──
      if (!holdRef.current) {
        const frac = cutFractionAt(t);
        const prev = prevCutRef.current;
        const th = thresholdRef.current;
        for (let i = 0; i < nFaces; i++) {
          const c = frac >= 1 ? 1 : Math.max(0, Math.min(1, (frac - th[i] + CUT_SOFT / 2) / CUT_SOFT));
          if (c >= 1 && prev[i] < 1) {
            // この面がいま削れ切った。待っている色があれば染め、区切りに合わせた一瞬の光を出す
            const q = colorQueueRef.current;
            if (!st.color[i] && q.length) { st.color[i] = q.shift()!; st.glow[i] = 0.8; }
            projectFaceCenter(mesh, vertsRef.current, i, view, proj);
            if (proj.front) {
              if (sk === "rap") emitSpark(partRef.current, proj.x, proj.y, "cut", now);
              else if (sk === "epiano") { emitSpark(partRef.current, proj.x, proj.y, "polish", now); st.glow[i] = Math.max(st.glow[i], 0.9); }
              emitChips(partRef.current, proj.x, proj.y, st.color[i] ?? [200, 202, 208], 2, now, floorY);
            }
          } else if (c < 1 && prev[i] >= 1 && frac < 1) {
            // 巻き戻し（頭出し）で削れ切る前へ戻った。染まりも輝きも戻す
            st.color[i] = null; st.glow[i] = 0; st.own[i] = 0;
          }
          st.cut[i] = c;
          prev[i] = c;
        }
        // 完成の瞬間: 面に貯まった色を光として一斉に放ち、本体は透明に
        if (t >= COMPLETE_TIME && !burstRef.current) {
          burstRef.current = true;
          const sources: { x: number; y: number; rgb: RGB | null; white: boolean }[] = [];
          for (let i = 0; i < nFaces; i++) {
            const c = st.color[i];
            if (!c) continue;
            projectFaceCenter(mesh, vertsRef.current, i, view, proj);
            if (!proj.front) continue;
            sources.push({ x: proj.x, y: proj.y, rgb: c, white: isWhite(c) });
          }
          emitBurst(partRef.current, sources, now, rm);
          st.clear = true;
        } else if (t < COMPLETE_TIME && burstRef.current) {
          // 巻き戻しで完成の前へ戻った
          burstRef.current = false;
          st.clear = false;
        }
        // 降り注ぎ（歓声パート）。山の個数＝みんなの累計＋この回の自分の分
        if (t >= RAIN_TIME && !rainRef.current && lay) {
          rainRef.current = true;
          let sum = 0;
          for (const n of colorTotalsRef.current.values()) sum += n;
          setPileTarget(pileRef.current, sum + selfCountRef.current, lay.pile);
          startRain(pileRef.current, now, rm);
        } else if (rainRef.current && lay) {
          // 自分が押し続けた分は山の個数に追いつかせる
          let sum = 0;
          for (const n of colorTotalsRef.current.values()) sum += n;
          setPileTarget(pileRef.current, sum + selfCountRef.current, lay.pile);
        }
      }
      // 輝きは時間で減る
      for (let i = 0; i < nFaces; i++) if (st.glow[i] > 0) st.glow[i] = Math.max(0, st.glow[i] - dt / GLOW_DECAY_SEC);
      morphVertices(mesh, st.cut, vertsRef.current);

      // ── 飛んでいる💎を進める ──
      const flights = flightsRef.current;
      for (let i = flights.length - 1; i >= 0; i--) {
        const fl = flights[i];
        const k = Math.min(1, (now - fl.t0) / fl.dur);
        // 行き先: 面の中心（回転で動くので毎コマ測る）。面が無ければ石の中心寄り
        let tx: number, ty: number;
        if (fl.face >= 0) {
          projectFaceCenter(mesh, vertsRef.current, fl.face, view, proj);
          if (!proj.front) { fl.face = pickVisibleFace("uncolored"); }
        }
        if (fl.face >= 0) { projectFaceCenter(mesh, vertsRef.current, fl.face, view, proj); tx = proj.x; ty = proj.y; }
        else { tx = view.cx + fl.ox * view.r; ty = view.cy + fl.oy * view.r; }
        // 3次ベジェ: 出発点 → 出発の向きへ少し伸ばした所（横へ寄せて弧を描く）→ 行き先の手前 → 行き先
        const e = k * k * (3 - 2 * k);
        const p1x = fl.x0 + (tx - fl.x0) * 0.3 + fl.bow, p1y = fl.y0 + (ty - fl.y0) * 0.3 - Math.abs(fl.bow) * 0.6;
        const p2x = tx + (fl.x0 - tx) * 0.25, p2y = ty + (fl.y0 - ty) * 0.25;
        const u = 1 - e;
        fl.x = u * u * u * fl.x0 + 3 * u * u * e * p1x + 3 * u * e * e * p2x + e * e * e * tx;
        fl.y = u * u * u * fl.y0 + 3 * u * u * e * p1y + 3 * u * e * e * p2y + e * e * e * ty;
        if (!rm) fl.ang += fl.spin * dt;
        if (k >= 1) {
          arrive(fl, now, sk, floorY);
          flights.splice(i, 1);
        }
      }

      // ── 粒と山を進める ──
      const part = partRef.current;
      if (!holdRef.current || sk === "outro" || sk === "cheers") updateAmbient(part, sk, sp, view, now, dt, rm);
      updateRays(part, view, t, now, st.clear && sk === "finalChorus");
      stepParticles(part, now, dt, rm);
      stepPile(pileRef.current, now, dt);

      // ── 描く（奥から手前へ） ──
      drawFrame(f, now, dt);
      if (lay) drawPile(ctx, pileRef.current, now, lay.pile, dpr, pileColorsRef.current);
      drawParticlesBehind(ctx, part, now, v);
      const opts = { now, reduceMotion: rm, light, clip: v };
      drawStone(ctx, mesh, vertsRef.current, st, view, opts);
      if (sk === "headChorus" && !st.clear) {
        // 一瞬だけ中から光が漏れ、完成形がちらっと透けて灰色に戻る（頭サビの間に2回・山なりに）【仮】。
        // 原石の上に重ねて描く（先に描くと原石に隠れて見えない）
        const pulse = Math.max(0, Math.sin(sp * Math.PI * 4)) ** 3;
        if (pulse > 0.02) drawStoneGhost(ctx, mesh, view, pulse * 0.85, opts);
      }
      drawParticlesFront(ctx, part, now, v);
      // 飛んでいる💎（動画の裏を通る＝クリップしない。今の版と同じ）
      for (const fl of flights) {
        flyDraw.x = fl.x; flyDraw.y = fl.y; flyDraw.ang = fl.ang; flyDraw.path = fl.path; flyDraw.roll = fl.roll;
        flyDraw.size = fl.size; flyDraw.rgb = fl.rgb;
        drawGemLive(ctx, flyDraw);
      }
      drawFlashes(v, now);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [videoBoxRef, frame, mesh, nFaces]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", pointerEvents: "none" }}
    />
  );
});

export default StoneCanvas;
