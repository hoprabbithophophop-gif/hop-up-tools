/* =============================================================================
 * 【使い捨て】💎の角度と光の調整ツール
 *
 * 1200×630 のカードを縮めて映し、石の向き・光・大きさ・色・背景のにじみを
 * その場で動かして見るための1画面。決まった構図は文字の欄に書き出して渡せる。
 *
 * 本番の src/ は読むだけで、書き換えていない。石を描く部分は
 * gemStudioRenderer.ts（src/pages/hai-to-diamond/gemRenderer.ts の写し）を使う。
 * ========================================================================== */

import { ARENA_BG } from "../../../src/pages/hi-tension/data";
import { DIAMOND_COLOR_ORDER, DIAMOND_COLOR_PAGES, findDiamondMember } from "../../../src/pages/hai-to-diamond/members";
import {
  prepareGemRenderer,
  renderGem,
  defaultLights,
  gemBoundRadius,
  gemVertices,
  GEM_FIT,
  DEFAULT_SPARKLE,
  PLAIN_SPARKLE,
  type StudioLight,
  type Sparkle,
} from "../ogp-card/gemStudioRenderer";
import {
  lchToLinearInGamut,
  linearTo255,
  liftToTargetL,
  hexToLinear,
  linearToOklab,
  oklabToLinear,
  toLinear,
  toSrgb,
  relLuminance,
  labToLch,
  type Lch,
  type Rgb,
} from "../ogp-card/gemStudioColor";
import {
  buildLayer, bestAssignment, sampleAmount, baseAt, rayArea,
  type LayerBlob, type TextBox, type Space, type Amount,
} from "../ogp-card/gemStudioLayer";
import {
  findGlints, drawGlint, drawBigGlint, brightFraction, scatterAround, splitColors,
  boostFacetColor, boostInfo, findBrightFacets, bodyCore,
  type FireSet, type Glint,
} from "../ogp-card/gemFireDraw";
import {
  drawFromSeed, quatToRows, renderForScore, scoreGem, culetScore, measure,
  setCalibration, useCalibration, PASS_MARK, BREAKS, WEIGHTS, gemOutline, outlineHitsBox,
  setVerts, getVerts, polyArea, clipToRect, culetPointsUp, culetOnScreen, type Draw,
} from "../ogp-card/gemStudioScore";

/* ---------------------------------------------------------------------------
 * カードの決めごと（いまのOGPカードと同じ値）
 * ------------------------------------------------------------------------ */
const W = 1200;
const H = 630;
const H1_PX = 72;
const SUB_PX = 46;
const GAP_PX = ((H1_PX * 4.8) / 25.6) * 1.6; // 見出しと副題の間
const TEXT_PAD_LEFT = 80;
const GEM_ALPHA = 0.92; // 石を置くときの濃さ（いまのカードと同じ）

/** 色の名簿。名簿には合言葉（id）と色しか無いので、画面にもそれだけを出す */
const PALETTE: { id: string; hex: string }[] = DIAMOND_COLOR_ORDER.map((id) => ({
  id,
  hex: findDiamondMember(id)?.color ?? "#e8eaed",
}));
const HEX_BY_ID = new Map(PALETTE.map((p) => [p.id, p.hex]));

/** 背景のにじみに使う色の組。中身は合言葉だけ。Hop から聞いた組み分けをそのまま写している。
 *  shimakura・takase・yamazaki だけで作る組は置かない（Hop決定） */
const COLOR_SETS: { key: string; ids: string[] }[] = [
  { key: "b1", ids: ["nishida", "eguchi", "otsubo", "sugiyama"] },
  { key: "b2", ids: ["maeda", "okamura", "kiyono", "kojima"] },
  { key: "b3", ids: ["hirai", "kobayashi", "satoyoshi"] },
  { key: "t3", ids: ["kojima", "otsubo", "sugiyama"] },
  { key: "o3", ids: ["shimakura", "nishida", "eguchi"] },
  { key: "o5", ids: ["yamazaki", "takase", "maeda", "okamura", "kiyono"] },
];

/* ---------------------------------------------------------------------------
 * カードの配置の型
 *   文字の置き方・石の置き場所・にじみを置ける帯・量を測る側を、型ごとにまとめる。
 *   数は好みで置かず、下の「置き場所の決め方」で測って決めたものを入れる。
 * ------------------------------------------------------------------------ */
type LayoutDef = {
  key: string;
  /** 文字の置き方。カードの中での寄せ方と余白 */
  text: {
    justify: string;   // 縦の寄せ
    align: string;     // 横の寄せ
    textAlign: string;
    padLeft: number;
    padRight: number;
    padTop: number;
    padBottom: number;
  };
  /** 石の大きさと置き場所 */
  gem: { sizePx: number; cx: number; cy: number };
  /** 石の色のにじみを、石の中心からどれだけずらして置くか。
   *  どの型も同じずらし方（型1の構図で決まっていた値）にして、
   *  石の色のにじみは石の位置にそのまま追随させる */
  mainOffset: { dx: number; dy: number; radius: number };
  /** 背景のにじみを置ける所（文字の無い帯） */
  slots: [number, number][];
  /** 脇役の量を測る、石の無い側。広さはどの型もカードのちょうど半分 */
  amountArea: { x0: number; y0: number; x1: number; y1: number }[];
  /** 底の尖りがカードの中に収まっていることを求める型。
   *  石1個の一枚絵は尖りが写った方がよい、という決まりから。
   *  型1は石が右へ寄るぶん尖りが外へ出やすいので、置き場所を決める時と同じく外している */
  culetMustFit: boolean;
};

/** にじみを置く場所の下敷き。
 *  文字の箱は横 80〜660・縦 233〜396 にあるので、その帯を外した
 *  「文字の上の帯」と「文字の下の帯」にだけ中心を置く。
 *  中心が文字から離れていれば、同じ強さでも文字にかぶる量が減る */
const SET_SLOTS: [number, number][] = [
  [150, 85],
  [430, 70],
  [655, 105],
  [140, 540],
  [405, 560],
  [640, 515],
];

/** 石の色のにじみの、石の中心からのずらし。
 *  型1のいまの構図（中心 970,330 に対して にじみ 1009,408）から出した値。
 *  どの型でもこの同じずらし方を使うので、にじみは石の位置に追随する */
const MAIN_OFFSET = { dx: 39, dy: 78, radius: 620 };

/** 3つの型。石の大きさと置き場所は、下の「置き場所の決め方」で測って決めた数 */
const LAYOUTS: LayoutDef[] = [
  {
    // 型1 左に文字・右に石。いまの形そのまま
    key: "l1",
    text: { justify: "center", align: "flex-start", textAlign: "left", padLeft: TEXT_PAD_LEFT, padRight: 0, padTop: 0, padBottom: 0 },
    gem: { sizePx: 780, cx: 970, cy: 330 },
    mainOffset: { dx: MAIN_OFFSET.dx, dy: MAIN_OFFSET.dy, radius: MAIN_OFFSET.radius },
    slots: SET_SLOTS,
    // 石は右にあるので、左半分で測る（最初の版と同じ）
    amountArea: [{ x0: 0, y0: 0, x1: 600, y1: H }],
    culetMustFit: false,
  },
  {
    // 型2 中央そろえ。石が上、文字が下
    key: "l2",
    text: { justify: "flex-end", align: "center", textAlign: "center", padLeft: 40, padRight: 40, padTop: 0, padBottom: 52 },
    gem: { sizePx: 640, cx: 600, cy: 150 },
    mainOffset: { dx: MAIN_OFFSET.dx, dy: MAIN_OFFSET.dy, radius: MAIN_OFFSET.radius },
    // 石が真ん中、文字が下の帯なので、にじみは左右のはしへ置く
    slots: [
      [110, 140], [1090, 140], [130, 420],
      [1070, 420], [140, 575], [1060, 575],
    ],
    // 石は真ん中にあるので、左右の両はしを合わせてカードの半分ぶんを測る
    amountArea: [{ x0: 0, y0: 0, x1: 300, y1: H }, { x0: 900, y0: 0, x1: W, y1: H }],
    culetMustFit: true,
  },
  {
    // 型3 対角。文字が左上、石が右下で右と下へはみ出す
    key: "l3",
    text: { justify: "flex-start", align: "flex-start", textAlign: "left", padLeft: TEXT_PAD_LEFT, padRight: 0, padTop: 56, padBottom: 0 },
    gem: { sizePx: 750, cx: 900, cy: 360 },
    mainOffset: { dx: MAIN_OFFSET.dx, dy: MAIN_OFFSET.dy, radius: MAIN_OFFSET.radius },
    // 文字は左上、石は右下。空いているのは「文字の下から左半分」だけなので、
    // その中を3×2に割って、どの2つを選んでも離れるように置く
    slots: [
      [90, 275], [285, 275], [480, 275],
      [90, 575], [285, 575], [480, 575],
    ],
    // 石は右下にあるので、左半分で測る
    amountArea: [{ x0: 0, y0: 0, x1: 600, y1: H }],
    culetMustFit: true,
  },
];
const LAYOUT_BY_KEY = new Map(LAYOUTS.map((l) => [l.key, l]));
function layoutDef(): LayoutDef {
  return LAYOUT_BY_KEY.get(ST.layout) ?? LAYOUTS[0];
}

/* ---------------------------------------------------------------------------
 * 脇役の量の物差し
 *   Hop が「単体でめちゃめちゃいい」と言った最初の版の背景を、そのまま基準にする。
 *   石 nishida・反対の色は裏返し・強さ0.176 大きさ520 位置[180,120]、
 *   石の色のにじみは 強さ0.32 大きさ620 位置[919,408]、混ぜ方は画面の色のまま。
 *   この絵が地からどれだけ浮いているかを測り、その量を上限にする。
 * ------------------------------------------------------------------------ */
const REF = {
  hex: "#da1884",
  main: { alpha: 0.32, radius: 620, x: 919, y: 408 },
  comp: { alpha: 0.176, radius: 520, x: 180, y: 120 },
};
/** 基準のにじみが、その中心でどれだけ濃く乗っているか。持ち上げの判定に使う */
const REF_PEAK_ALPHA = REF.comp.alpha;
/** 脇役のにじみの、量を測る前の元の濃さ。倍率はここに掛かる */
const SET_NOMINAL_ALPHA = 0.22;

/** 暗い色を、色味を変えずに明るさだけ持ち上げる。
 *  いちばん強い成分が LIFT_TARGET に届くまで全部の成分に同じ数を掛ける。
 *  掛け算なので色味と鮮やかさの比はそのまま。明るい色は何もしない */
const LIFT_TARGET = 210;
function liftColor(rgb: [number, number, number], t: number): [number, number, number] {
  const mx = Math.max(rgb[0], rgb[1], rgb[2], 1);
  const full = Math.max(1, LIFT_TARGET / mx);
  const k = 1 + Math.max(0, Math.min(1, t)) * (full - 1);
  return [
    Math.min(255, Math.round(rgb[0] * k)),
    Math.min(255, Math.round(rgb[1] * k)),
    Math.min(255, Math.round(rgb[2] * k)),
  ];
}

/* ---------------------------------------------------------------------------
 * 回転の小道具（四元数）
 *   四元数は「どの軸のまわりに何度回したか」を4つの数で覚えておく入れ物。
 *   角度を3つ並べる書き方と違って、回し続けても向きが飛ばない。
 * ------------------------------------------------------------------------ */
type Quat = [number, number, number, number]; // x, y, z, w

function qNorm(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
function qMul(a: Quat, b: Quat): Quat {
  return qNorm([
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]);
}
function qAxis(ax: number, ay: number, az: number, rad: number): Quat {
  const l = Math.hypot(ax, ay, az);
  if (l < 1e-9 || !isFinite(rad)) return [0, 0, 0, 1];
  const s = Math.sin(rad / 2) / l;
  return qNorm([ax * s, ay * s, az * s, Math.cos(rad / 2)]);
}
/** 四元数 → 3x3 の回転（石の座標 → 世界の座標）。並べ方は行の順 */
function qToRows(q: Quat): number[] {
  const [x, y, z, w] = qNorm(q);
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}
/** 四元数は、全部の符号を反転しても同じ向きを表す。
 *  書き出した文字が毎回同じになるよう、いちばん大きい成分が正の側にそろえる。
 *  向きそのものは変わらないので、絵は1画素も動かない */
function qCanon(q: Quat): Quat {
  let big = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(q[i]) > Math.abs(q[big])) big = i;
  return q[big] < 0 ? (q.map((v) => -v) as Quat) : q;
}

/** 3x3 の回転 → 四元数。書き出した設定を読み戻すときに使う */
function rowsToQ(r: number[]): Quat {
  const t = r[0] + r[4] + r[8];
  let q: Quat;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    q = [(r[7] - r[5]) / s, (r[2] - r[6]) / s, (r[3] - r[1]) / s, s / 4];
  } else if (r[0] > r[4] && r[0] > r[8]) {
    const s = Math.sqrt(1 + r[0] - r[4] - r[8]) * 2;
    q = [s / 4, (r[1] + r[3]) / s, (r[2] + r[6]) / s, (r[7] - r[5]) / s];
  } else if (r[4] > r[8]) {
    const s = Math.sqrt(1 + r[4] - r[0] - r[8]) * 2;
    q = [(r[1] + r[3]) / s, s / 4, (r[5] + r[7]) / s, (r[2] - r[6]) / s];
  } else {
    const s = Math.sqrt(1 + r[8] - r[0] - r[4]) * 2;
    q = [(r[2] + r[6]) / s, (r[5] + r[7]) / s, s / 4, (r[3] - r[1]) / s];
  }
  return qCanon(qNorm(q));
}

/* ---------------------------------------------------------------------------
 * 光の向きの言い換え
 *   世界の向き（x=画面右, y=画面上, z=手前）を、人が読める2つの角度に直す。
 *   「画面の中でどちらから」＝0度が右・90度が上。「手前への起こし」＝90度で真正面。
 * ------------------------------------------------------------------------ */
function dirToAngles(d: readonly number[]): { az: number; el: number } {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const x = d[0] / l, y = d[1] / l, z = d[2] / l;
  return {
    az: (Math.atan2(y, x) * 180) / Math.PI,
    el: (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI,
  };
}
function anglesToDir(az: number, el: number): [number, number, number] {
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  const c = Math.cos(e);
  return [c * Math.cos(a), c * Math.sin(a), Math.sin(e)];
}

/* ---------------------------------------------------------------------------
 * 色の小道具
 * ------------------------------------------------------------------------ */
function hexToRgb(hex: string): [number, number, number] {
  let h = String(hex).replace("#", "").trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const v = parseInt(h, 16);
  if (!isFinite(v)) return [255, 255, 255];
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
/** 色相（色合いの目盛り）を180度まわす。白や灰のように色合いが無い色はそのまま */
function rgbHueTurn(rgb: [number, number, number]): [number, number, number] {
  const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const dd = mx - mn;
  if (dd < 1e-6) return [rgb[0], rgb[1], rgb[2]]; // 色合いが無い＝まわしても変わらない
  const s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
  let hh: number;
  if (mx === r) hh = ((g - b) / dd + (g < b ? 6 : 0)) / 6;
  else if (mx === g) hh = ((b - r) / dd + 2) / 6;
  else hh = ((r - g) / dd + 4) / 6;
  hh = (hh + 0.5) % 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [Math.round(f(hh + 1 / 3) * 255), Math.round(f(hh) * 255), Math.round(f(hh - 1 / 3) * 255)];
}
/** 補色を作る。2通りの求め方を選べる。どちらも同じだけ落ち着かせてから使う */
function compColor(hex: string, method: string): [number, number, number] {
  const rgb = hexToRgb(hex);
  const raw: [number, number, number] =
    method === "hue" ? rgbHueTurn(rgb) : [255 - rgb[0], 255 - rgb[1], 255 - rgb[2]];
  // いまのカードと同じ落ち着かせ方（少し暗くして下駄を履かせる）
  return [
    Math.round(raw[0] * 0.75 + 40),
    Math.round(raw[1] * 0.75 + 40),
    Math.round(raw[2] * 0.75 + 40),
  ];
}

/** 同じ種からは必ず同じ並びが出る、小さな数当て器（いまのカードと同じ式） */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------------------
 * いまの設定（これがそのまま書き出す中身になる）
 * ------------------------------------------------------------------------ */
type Blob = { alpha: number; radius: number; x: number; y: number };
/** 背景のにじみに使う色の組の選び方 */
type GlowSet = {
  /** comp = 反対の色 ／ group = 決まった組 ／ custom = 自分で選ぶ */
  kind: string;
  /** 組の合言葉。COLOR_SETS の key か "comp" か "custom" */
  key: string;
  /** その組に入っている合言葉の並び。メインの色もそのまま入っている */
  ids: string[];
  /** 自分で選ぶ で選んだ合言葉。多くても3つ */
  pickedIds: string[];
  alpha: number;
  radius: number;
  seed: number;
  /** 暗い色の持ち上げ。0 でそのまま、1 でいちばん強い成分が 210 になるまで。
   *  自動の補正を切っているときだけ効く */
  lift: number;
  /** 脇役の量の倍率。1.0 が Hop の良いと言った絵と同じ量 */
  mul: number;
};
/** 出来上がったにじみ1つぶん。読み込むときは組から作り直すので、これは結果の控え */
type BlobOut = {
  id: string;
  /** 石が周りに投げた光のかけらなら true */
  shard?: boolean;
  /** 石の足元から伸びる光の筋なら true。x,y は根元、radius は長さ */
  ray?: boolean;
  /** 光の筋の、根元での幅の半分 */
  width?: number;
  /** その筋が覆う広さ。上限を測るときに使う */
  area?: number;
  rot?: number;
  aspect?: number;
  edge?: number;
  facet?: boolean;
  hex: string;
  rgb: number[];
  /** 補正したあとの、目で見た感じに近い並べ方での 明るさ・鮮やかさ・色合い */
  oklch: number[];
  x: number;
  y: number;
  radius: number;
  alpha: number;
};
/** 自動の補正の決めごとと、その結果 */
type AutoSet = {
  on: boolean;
  /** 人の色を持ち上げる先の明るさ */
  targetL: number;
  /** 混ぜる場所。linear = 光の量そのもの ／ oklab = 目で見た感じに近い並べ方 */
  space: string;
  /** true なら、目標の明るさを色ごとに「その色合いで一番鮮やかになる明るさ」にする */
  cusp: boolean;
  /** 以下は結果。読むだけ */
  minContrastBefore: number;
  minContrastAfter: number;
  capScale: number;
  capped: boolean;
  /** 文字のまわりだけを弱めた度合い。1 なら弱めていない */
  shieldScale: number;
  shielded: boolean;
  /** 脇役のにじみに掛けた倍率。基準の量に収めるために自動で決まる */
  sideFit: number;
  /** 光のかけらに掛けた倍率。かけら専用の縛りに収めるために自動で決まる */
  causticFit: number;
};
type Setting = {
  version: number;
  convention: string;
  card: { w: number; h: number };
  /** カードの配置の型。l1 左に文字・右に石 ／ l2 中央そろえ ／ l3 対角 */
  layout: string;
  member: { id: string; hex: string };
  rotation: { rows: number[][]; quat: number[] };
  roll2dDeg: number;
  lights: { dir: number[]; intensity: number; radius: number }[];
  gem: { cx: number; cy: number; sizePx: number; alpha: number; fitHalf: number };
  glow: { method: string; main: Blob; comp: Blob; set: GlowSet; blobs: BlobOut[] };
  auto: AutoSet;
  /** きらめきの演出。入にすると、石の中で色が分かれる幅を本物の5倍に広げた
   *  【誇張】の絵になる。切ると本物の値に戻り、本番の描き手と同じ絵になる */
  sparkle: { on: boolean };
  /** 石が周りに投げる光のかけら */
  caustics: { on: boolean; count: number; mul: number };
  /** シャッフルの控え。種ひとつで同じ絵に戻せる */
  shuffle: { seed: number; score: number; baseCx: number; baseCy: number };
  dots: { on: boolean; count: number; seed: number };
  /** 絵を3つの層に分けたときの、層ごとの入り切り。
   *  bg = 下地とにじみ ／ gem = 石 ／ light = 光の筋と光の粒。文字はいつも一番上 */
  layers: { bg: boolean; gem: boolean; light: boolean };
  /** 石の絵を描いたあとに足す、作り物の演出。3つとも切ると足す前の絵に戻る。
   *  glints = 光の点（level は 弱 weak ／ 中 mid ／ 強 strong）
   *  facet  = 面の虹色を濃くする
   *  bloom  = 明るい面のあふれ */
  fire: { glints: boolean; level: string; facet: boolean; bloom: boolean };
};

const CONVENTION =
  "rows は石の座標から世界の座標への回転（行の順 r00,r01,r02,r10,...）。" +
  "カメラは +Z から原点を見ている。+X が画面右、+Y が画面上、+Z が手前。" +
  "quat は [x,y,z,w]。lights の dir も同じ世界の向き。" +
  "fitHalf は正射影の枠の半分の大きさ（石の座標での長さ）で、setOrtho にそのまま渡す値。" +
  "枠の中心は石の原点（0,0）で、本番の screenBounds が返す cx,cy は使わない。" +
  "石は cx,cy を中心に一辺 sizePx の正方形として置き、そのあと roll2dDeg だけ絵ごと回す。" +
  "glow.blobs は背景のにじみの出来上がりで、石の色のにじみが先頭、そのあとに背景色の組のぶんが続く。" +
  "rgb は持ち上げたあとの最終的な色。glow.set は、その並びを作った元の選び方。" +
  "kind=group のときは ids からメインの色を除いたものを置く。" +
  "kind=custom のときは pickedIds をそのまま置き、メインの色は除かない。" +
  "auto.on のときは、人の色を OkLCh で auto.targetL まで持ち上げ、色合いを保ったまま鮮やかさを削って画面に収め、" +
  "下地とにじみを auto.space の場所で混ぜ、文字と背景の明るさの比が 4.5 を割らないよう " +
  "にじみ全体の強さに auto.capScale を掛けている。blobs の rgb と oklch は、その補正が済んだあとの値。";

/** 光の点の強さ3段。big = 大きい点の数（明るい順の上位いくつ）、
 *  len = その点の筋の長さ（石の大きさに対する割合）、
 *  around = 石のまわりの空いた所にも点を散らすか */
const FIRE_LEVELS: { key: string; label: string; big: number; len: number; around: boolean }[] = [
  { key: "weak", label: "弱", big: 3, len: 0.15, around: false },
  { key: "mid", label: "中", big: 4, len: 0.22, around: false },
  { key: "strong", label: "強", big: 5, len: 0.3, around: true },
];
/** 面の色のずれを何倍に広げるか */
const FACET_K = 2;

/** 初期値。いまのOGPカード（layout=x）の主役の石に合わせてある */
function makeDefault(): Setting {
  const q = qAxis(1, 0, 0, (26 * Math.PI) / 180); // 本番の TILT_DEG = 26 度と同じ倒し方
  const rows = qToRows(q);
  const size = 780;
  // 石の中心の横の位置。880 では引きの 88% が見出しとの重なりで捨てられていた。
  // 880〜1040 を粗く測ったあと、5割の線のきわを1万回単位で測り直して決めた。
  //   940 → 37.3%  950 → 42.3%  960 → 47.0%  970 → 51.5%  980 → 56.5%  1000 → 69.5%
  // 文字に被らず通る割合が5割を超える候補のうち、カードの中に見えている面積が
  // いちばん大きいのが 970（通る率 51.5%・見えている面積 92.0%）
  const cx = 970;
  const cy = 330;
  const hx = cx - size / 2;
  const hy = cy - size / 2;
  return {
    version: 1,
    convention: CONVENTION,
    card: { w: W, h: H },
    layout: "l1",
    member: { id: PALETTE[0].id, hex: PALETTE[0].hex },
    rotation: { rows: [rows.slice(0, 3), rows.slice(3, 6), rows.slice(6, 9)], quat: q.slice() },
    roll2dDeg: 20,
    lights: defaultLights().map((l) => ({ dir: l.dir.slice(), intensity: l.intensity, radius: l.radius })),
    gem: { cx, cy, sizePx: size, alpha: GEM_ALPHA, fitHalf: 0 },
    glow: {
      method: "invert",
      main: { alpha: 0.32, radius: 620, x: hx + size * 0.55, y: hy + size * 0.6 },
      comp: { alpha: 0.176, radius: 520, x: 180, y: 120 },
      set: { kind: "comp", key: "comp", ids: [], pickedIds: [], alpha: 0.22, radius: 480, seed: 1, lift: 0, mul: 1 },
      blobs: [],
    },
    auto: {
      on: true,
      targetL: 0.62,
      space: "linear",
      cusp: false,
      minContrastBefore: 0,
      minContrastAfter: 0,
      capScale: 1,
      capped: false,
      shieldScale: 1,
      shielded: false,
      sideFit: 1,
      causticFit: 1,
    },
    sparkle: { on: true },
    caustics: { on: true, count: 12, mul: 1 },
    shuffle: { seed: 0, score: 0, baseCx: cx, baseCy: cy },
    dots: { on: false, count: 90, seed: 20265229 },
    layers: { bg: true, gem: true, light: true },
    fire: { glints: true, level: "mid", facet: true, bloom: true },
  };
}

let ST: Setting = makeDefault();
let QUAT: Quat = ST.rotation.quat.slice() as Quat;

/* ---------------------------------------------------------------------------
 * 覚えておく（使えない端末もあるので、失敗しても何も起きないようにする）
 * ------------------------------------------------------------------------ */
const SAVE_KEY = "gem-studio-tmp-v1";
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(ST));
  } catch {
    /* 覚えられなくても動きは変わらない */
  }
}
function load(): Setting | null {
  try {
    const t = localStorage.getItem(SAVE_KEY);
    return t ? (JSON.parse(t) as Setting) : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * 画面を組み立てる
 * ------------------------------------------------------------------------ */
const root = document.getElementById("gem-studio-root");
if (!root) throw new Error("置き場所が見つからない");

root.innerHTML = `
<div class="gs-wrap">
  <div class="gs-left" id="gs-left">
    <div class="gs-cardbox" id="gs-cardbox">
      <div class="gs-card" id="gs-card">
        <canvas id="gs-canvas" width="${W}" height="${H}"></canvas>
        <div class="gs-texts">
          <h1>灰toダイヤモンド</h1>
          <p>#銀河to銀河届けよ</p>
        </div>
      </div>
    </div>
    <div class="gs-shuffle">
      <button type="button" class="gs-big" id="gs-shuffle">シャッフル</button>
      <button type="button" class="gs-back" id="gs-back">1つ前に戻る</button>
    </div>
    <div class="gs-statusline">
      <p class="gs-seed" id="gs-seed"></p>
      <p class="gs-status" id="gs-status">支度をしています…</p>
    </div>
  </div>
  <div class="gs-right" id="gs-panel">
    <p class="gs-hint">絵の上をなぞると石が回ります。</p>
    <div class="gs-tabs" id="gs-tabs" role="tablist" aria-label="項目"></div>
    <div id="gs-bodies"></div>
  </div>
</div>`;

const canvas = document.getElementById("gs-canvas") as HTMLCanvasElement;
const cardEl = document.getElementById("gs-card") as HTMLDivElement;
const cardBox = document.getElementById("gs-cardbox") as HTMLDivElement;
const statusEl = document.getElementById("gs-status") as HTMLParagraphElement;
const leftEl = document.getElementById("gs-left") as HTMLDivElement;
cardEl.style.background = ARENA_BG;

const textsEl = cardEl.querySelector(".gs-texts") as HTMLDivElement;
textsEl.style.paddingLeft = TEXT_PAD_LEFT + "px";
(textsEl.querySelector("h1") as HTMLElement).style.fontSize = H1_PX + "px";
const subEl = textsEl.querySelector("p") as HTMLElement;
subEl.style.fontSize = SUB_PX + "px";
subEl.style.marginTop = GAP_PX + "px";

/* ---- 項目のタブ ---------------------------------------------------------- */
/** タブの並び。中身の見出しはそれぞれの項目のままで、ここは札の文字 */
const TABS: { key: string; label: string }[] = [
  { key: "place", label: "配置" },
  { key: "color", label: "石の色" },
  { key: "rot", label: "石の向き" },
  { key: "light", label: "光の当て方" },
  { key: "size", label: "大きさと置き場所" },
  { key: "glow", label: "背景のにじみ" },
  { key: "shine", label: "きらめきと層" },
  { key: "io", label: "設定の受け渡し" },
];
const TAB_KEY = "gem-studio-tmp-tab-v1";
const tabsEl = document.getElementById("gs-tabs") as HTMLDivElement;
const bodiesEl = document.getElementById("gs-bodies") as HTMLDivElement;
const tabBtn = new Map<string, HTMLButtonElement>();
const tabBody = new Map<string, HTMLDivElement>();
for (const t of TABS) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "gs-tab";
  b.id = "gs-tab-" + t.key;
  b.dataset.tab = t.key;
  b.setAttribute("role", "tab");
  b.setAttribute("aria-controls", "gs-body-" + t.key);
  b.setAttribute("aria-selected", "false");
  b.tabIndex = -1;
  b.textContent = t.label;
  b.addEventListener("click", () => showTab(t.key, true));
  tabsEl.appendChild(b);
  tabBtn.set(t.key, b);

  const d = document.createElement("div");
  d.className = "gs-body";
  d.id = "gs-body-" + t.key;
  d.setAttribute("role", "tabpanel");
  d.setAttribute("aria-labelledby", b.id);
  d.hidden = true;
  bodiesEl.appendChild(d);
  tabBody.set(t.key, d);
}
/** 左右のキーで隣のタブへ移る */
tabsEl.addEventListener("keydown", (ev) => {
  const step = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : ev.key === "Home" ? -999 : ev.key === "End" ? 999 : 0;
  if (!step) return;
  ev.preventDefault();
  const at = TABS.findIndex((t) => t.key === openTab);
  const to = step === -999 ? 0 : step === 999 ? TABS.length - 1 : (at + step + TABS.length) % TABS.length;
  showTab(TABS[to].key, true);
  tabBtn.get(TABS[to].key)!.focus();
});

let openTab = TABS[0].key;
/** 選んだタブが列の中で見えるところへ来るように、列だけを横に送る。
 *  ページ全体は動かさない */
function scrollTabIntoView(b: HTMLButtonElement) {
  const left = b.offsetLeft;
  const right = left + b.offsetWidth;
  if (left < tabsEl.scrollLeft) tabsEl.scrollLeft = Math.max(0, left - 8);
  else if (right > tabsEl.scrollLeft + tabsEl.clientWidth) tabsEl.scrollLeft = right - tabsEl.clientWidth + 8;
}
function showTab(key: string, remember: boolean) {
  if (!tabBody.has(key)) key = TABS[0].key;
  openTab = key;
  for (const t of TABS) {
    const on = t.key === key;
    const b = tabBtn.get(t.key)!;
    b.setAttribute("aria-selected", on ? "true" : "false");
    b.tabIndex = on ? 0 : -1;
    tabBody.get(t.key)!.hidden = !on;
  }
  scrollTabIntoView(tabBtn.get(key)!);
  if (remember) {
    try {
      localStorage.setItem(TAB_KEY, key);
    } catch {
      /* 覚えられなくても動きは変わらない */
    }
  }
}

/* ---- 操作盤の部品 ------------------------------------------------------- */
/** いま作っている項目の入れ場所。section を呼ぶ前にここを切り替える */
let intoTab: HTMLDivElement = tabBody.get(TABS[0].key)!;
function useTab(key: string) {
  intoTab = tabBody.get(key) ?? tabBody.get(TABS[0].key)!;
}
function section(title: string, note?: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "gs-sec";
  d.innerHTML = `<h2>${title}</h2>` + (note ? `<p class="gs-note">${note}</p>` : "");
  intoTab.appendChild(d);
  return d;
}

type SliderOpts = {
  parent: HTMLElement;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  onInput: (v: number) => void;
};
function slider(o: SliderOpts): { set: (v: number) => void; el: HTMLInputElement } {
  const row = document.createElement("div");
  row.className = "gs-row";
  const lab = document.createElement("label");
  const name = document.createElement("span");
  name.textContent = o.label;
  const val = document.createElement("b");
  lab.appendChild(name);
  lab.appendChild(val);
  const inp = document.createElement("input");
  inp.type = "range";
  inp.min = String(o.min);
  inp.max = String(o.max);
  inp.step = String(o.step);
  inp.value = String(o.value);
  const show = () => {
    val.textContent = inp.value + (o.unit ?? "");
  };
  show();
  inp.addEventListener("input", () => {
    show();
    o.onInput(Number(inp.value));
  });
  row.appendChild(lab);
  row.appendChild(inp);
  o.parent.appendChild(row);
  return {
    el: inp,
    set: (v: number) => {
      inp.value = String(v);
      show();
    },
  };
}

/** 押している間だけ効いて、離すと真ん中へ戻るつまみ。
 *  いまの向きからの「足し算」で回すので、何度動かしても向きが飛ばない */
function nudgeSlider(parent: HTMLElement, label: string, apply: (deg: number) => void) {
  const row = document.createElement("div");
  row.className = "gs-row";
  const lab = document.createElement("label");
  const name = document.createElement("span");
  name.textContent = label;
  const val = document.createElement("b");
  val.textContent = "±";
  lab.appendChild(name);
  lab.appendChild(val);
  const inp = document.createElement("input");
  inp.type = "range";
  inp.min = "-45";
  inp.max = "45";
  inp.step = "0.5";
  inp.value = "0";
  let last = 0;
  inp.addEventListener("input", () => {
    const v = Number(inp.value);
    apply(v - last);
    last = v;
    val.textContent = (v > 0 ? "+" : "") + v.toFixed(1) + "度";
  });
  const back = () => {
    inp.value = "0";
    last = 0;
    val.textContent = "±";
  };
  inp.addEventListener("change", back);
  inp.addEventListener("pointerup", back);
  inp.addEventListener("pointercancel", back);
  inp.addEventListener("blur", back);
  row.appendChild(lab);
  row.appendChild(inp);
  parent.appendChild(row);
}

function button(parent: HTMLElement, text: string, fn: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "gs-btn";
  b.type = "button";
  b.textContent = text;
  b.addEventListener("click", fn);
  parent.appendChild(b);
  return b;
}

/* ---- 1. 色 --------------------------------------------------------------- */
/* ---- 0. 配置 ------------------------------------------------------------- */
useTab("place");
const secPlace = section("配置");
const placeWrap = document.createElement("div");
placeWrap.className = "gs-places";
secPlace.appendChild(placeWrap);
const placeEls: HTMLButtonElement[] = [];
for (const d of LAYOUTS) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "gs-place";
  btn.dataset.layout = d.key;
  btn.setAttribute("aria-pressed", "false");
  // カードを縮めた見本の図。文字の帯と石の丸の位置だけを出す
  const k = 148 / W;
  const t = d.text;
  const headW = 580 * k, headH = 86 * k, subW = 421 * k, subH = 55 * k;
  const boxH = H * k;
  // 文字の帯の左上を、型の寄せ方から出す
  const tx = (w: number) =>
    t.align === "center" ? (148 - w) / 2 : t.align === "flex-end" ? 148 - w - t.padRight * k : t.padLeft * k;
  const blockH = headH + 21.6 * k + subH;
  const ty =
    t.justify === "flex-end" ? boxH - t.padBottom * k - blockH
      : t.justify === "flex-start" ? t.padTop * k
        : (boxH - blockH) / 2;
  const gx = d.gem.cx * k;
  const gy = d.gem.cy * k;
  const gr = (d.gem.sizePx * 0.42) * k;
  btn.innerHTML =
    `<span class="gs-mini" style="height:${boxH.toFixed(1)}px">` +
    `<i class="gs-mgem" style="left:${(gx - gr).toFixed(1)}px;top:${(gy - gr).toFixed(1)}px;width:${(gr * 2).toFixed(1)}px;height:${(gr * 2).toFixed(1)}px"></i>` +
    `<i class="gs-mbar" style="left:${tx(headW).toFixed(1)}px;top:${ty.toFixed(1)}px;width:${headW.toFixed(1)}px;height:${headH.toFixed(1)}px"></i>` +
    `<i class="gs-mbar gs-msub" style="left:${tx(subW).toFixed(1)}px;top:${(ty + headH + 21.6 * k).toFixed(1)}px;width:${subW.toFixed(1)}px;height:${subH.toFixed(1)}px"></i>` +
    `</span>`;
  btn.addEventListener("click", () => {
    applyLayout(d.key);
    markPlace();
  });
  placeWrap.appendChild(btn);
  placeEls.push(btn);
}
function markPlace() {
  for (const b of placeEls) {
    const on = b.dataset.layout === ST.layout;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

useTab("color");
const secColor = section("石の色", "名簿には合言葉と色しか入っていないので、色の見本と合言葉だけを出しています。");
const swatchWrap = document.createElement("div");
swatchWrap.className = "gs-swatches";
secColor.appendChild(swatchWrap);
const swatchEls: HTMLButtonElement[] = [];
PALETTE.forEach((p) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "gs-sw";
  b.innerHTML = `<i style="background:${p.hex}"></i><span>${p.id}</span>`;
  b.addEventListener("click", () => {
    ST.member = { id: p.id, hex: p.hex };
    markSwatch();
    rebuildSetOptions();
    showSetControls();
    needGem = true;
    schedule();
  });
  swatchWrap.appendChild(b);
  swatchEls.push(b);
});
function markSwatch() {
  swatchEls.forEach((b, i) => b.classList.toggle("on", PALETTE[i].id === ST.member.id));
}

/* ---- 2. 向き ------------------------------------------------------------- */
useTab("rot");
const secRot = section(
  "石の向き",
  "つまみは押している間だけ効いて、離すと真ん中に戻ります。いまの向きから足し算で回すので、何度でも続けて動かせます。"
);
nudgeSlider(secRot, "左右に回す（画面の縦の軸）", (d) => turn(0, 1, 0, d));
nudgeSlider(secRot, "上下に回す（画面の横の軸）", (d) => turn(1, 0, 0, d));
nudgeSlider(secRot, "ねじる（画面の奥へ向かう軸・光は動かない）", (d) => turn(0, 0, 1, d));
const rollCtl = slider({
  parent: secRot,
  label: "絵ごと回す（光も一緒に回る）",
  min: -180,
  max: 180,
  step: 1,
  value: ST.roll2dDeg,
  unit: "度",
  onInput: (v) => {
    ST.roll2dDeg = v;
    schedule();
  },
});
const rotBtns = document.createElement("div");
rotBtns.className = "gs-btns";
secRot.appendChild(rotBtns);
button(rotBtns, "真上から見る", () => setQuat(qAxis(1, 0, 0, Math.PI / 2)));
button(rotBtns, "真横から見る", () => setQuat([0, 0, 0, 1]));
button(rotBtns, "はじめの向き（26度）", () => setQuat(qAxis(1, 0, 0, (26 * Math.PI) / 180)));

function turn(ax: number, ay: number, az: number, deg: number) {
  if (!deg) return;
  QUAT = qMul(qAxis(ax, ay, az, (deg * Math.PI) / 180), QUAT);
  syncRotation();
  needGem = true;
  schedule();
}
function setQuat(q: Quat) {
  QUAT = qNorm(q);
  syncRotation();
  needGem = true;
  schedule();
}
function syncRotation() {
  const rows = qToRows(QUAT);
  ST.rotation = { rows: [rows.slice(0, 3), rows.slice(3, 6), rows.slice(6, 9)], quat: QUAT.slice() };
}

/* ---- 3. 光 --------------------------------------------------------------- */
useTab("light");
const secLight = section(
  "光の当て方（3灯）",
  "「向き」は 0度が画面の右、90度が画面の上。「手前への起こし」は 90度でカメラの真正面から当てた形です。" +
    "「光の玉の大きさ」を広げると、面が拾う光がやわらかく広がります。" +
    "ここで動くのは3灯ぶんの光だけです。部屋そのものの明るさの左右差と、天井の白い帯の位置は、" +
    "いまの本番の作りのままなので動きません。"
);
const lightCtl: {
  az: ReturnType<typeof slider>;
  el: ReturnType<typeof slider>;
  it: ReturnType<typeof slider>;
  rd: ReturnType<typeof slider>;
}[] = [];
const LIGHT_NAMES = ["1灯目（いちばん強い光）", "2灯目（後ろからの縁どり）", "3灯目（暗い側の起こし）"];
ST.lights.forEach((l, i) => {
  const box = document.createElement("div");
  box.className = "gs-light";
  box.innerHTML = `<h3>${LIGHT_NAMES[i]}</h3>`;
  secLight.appendChild(box);
  const a = dirToAngles(l.dir);
  const az = slider({
    parent: box, label: "向き", min: -180, max: 180, step: 1, value: Math.round(a.az), unit: "度",
    onInput: (v) => { setLightDir(i, v, Number(lightCtl[i].el.el.value)); },
  });
  const el = slider({
    parent: box, label: "手前への起こし", min: -90, max: 90, step: 1, value: Math.round(a.el), unit: "度",
    onInput: (v) => { setLightDir(i, Number(lightCtl[i].az.el.value), v); },
  });
  const it = slider({
    parent: box, label: "強さ", min: 0, max: 2, step: 0.01, value: l.intensity,
    onInput: (v) => { ST.lights[i].intensity = v; needGem = true; schedule(); },
  });
  const rd = slider({
    parent: box, label: "光の玉の大きさ", min: 0.01, max: 0.4, step: 0.005, value: l.radius,
    onInput: (v) => { ST.lights[i].radius = v; needGem = true; schedule(); },
  });
  lightCtl.push({ az, el, it, rd });
});
function setLightDir(i: number, az: number, el: number) {
  ST.lights[i].dir = anglesToDir(az, el);
  needGem = true;
  schedule();
}
const lightBtns = document.createElement("div");
lightBtns.className = "gs-btns";
secLight.appendChild(lightBtns);
button(lightBtns, "光を最初の場所に戻す", () => {
  ST.lights = defaultLights().map((l) => ({ dir: l.dir.slice(), intensity: l.intensity, radius: l.radius }));
  syncLightCtl();
  needGem = true;
  schedule();
});
function syncLightCtl() {
  ST.lights.forEach((l, i) => {
    const a = dirToAngles(l.dir);
    lightCtl[i].az.set(Math.round(a.az));
    lightCtl[i].el.set(Math.round(a.el));
    lightCtl[i].it.set(l.intensity);
    lightCtl[i].rd.set(l.radius);
  });
}

/* ---- 3b. きらめきの演出 --------------------------------------------------- */
useTab("shine");
const secSparkle = section(
  "きらめきの演出",
  "石の中で光が色に分かれる幅を、本物の5倍に広げます。作り物の誇張です。切ると本物の値に戻り、本番と同じ絵になります。"
);
const sparkleOn = document.createElement("label");
sparkleOn.className = "gs-check";
sparkleOn.innerHTML = `<input type="checkbox"><span>色の分かれを強める</span>`;
secSparkle.appendChild(sparkleOn);
const sparkleBox = sparkleOn.querySelector("input") as HTMLInputElement;
sparkleBox.checked = ST.sparkle.on;
sparkleBox.addEventListener("change", () => {
  ST.sparkle.on = sparkleBox.checked;
  needGem = true;
  schedule();
});
/** いま使う演出の決めごと。切っているときは本番とまったく同じ値になる */
function sparkleNow(): Sparkle {
  return ST.sparkle.on ? DEFAULT_SPARKLE : PLAIN_SPARKLE;
}

/* ---- 3c. 強い光の演出 ----------------------------------------------------- */
useTab("shine");
const secFire = section(
  "強い光の演出",
  "石の絵を描いたあとに、強い光の下で見たときの見え方を足します。作り物の誇張です。3つとも切ると、足す前とまったく同じ絵に戻ります。"
);
const fireBox: Record<string, HTMLInputElement> = {};
for (const [key, name] of [
  ["glints", "光の点"],
  ["facet", "面の虹色を濃くする"],
  ["bloom", "明るい面のあふれ"],
] as [string, string][]) {
  const lab = document.createElement("label");
  lab.className = "gs-check";
  lab.innerHTML = `<input type="checkbox" data-fire="${key}"><span>${name}</span>`;
  secFire.appendChild(lab);
  const inp = lab.querySelector("input") as HTMLInputElement;
  inp.checked = (ST.fire as unknown as Record<string, boolean>)[key];
  inp.addEventListener("change", () => {
    (ST.fire as unknown as Record<string, boolean>)[key] = inp.checked;
    showFireLevel();
    schedule();
  });
  fireBox[key] = inp;
  if (key === "glints") secFire.appendChild(fireLevelWrap());
}
const fireLevels = secFire.querySelector(".gs-radios") as HTMLDivElement;
(fireLevels.querySelector(`input[value="${ST.fire.level}"]`) as HTMLInputElement | null)?.setAttribute("checked", "checked");
fireLevels.querySelectorAll("input").forEach((r) => {
  (r as HTMLInputElement).checked = (r as HTMLInputElement).value === ST.fire.level;
});
showFireLevel();

function fireLevelWrap(): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "gs-radios";
  wrap.innerHTML = FIRE_LEVELS.map(
    (v) => `<label><input type="radio" name="gs-fire-level" value="${v.key}"><span>${v.label}</span></label>`
  ).join("");
  wrap.querySelectorAll("input").forEach((r) => {
    r.addEventListener("change", () => {
      const el = r as HTMLInputElement;
      if (el.checked) { ST.fire.level = el.value; schedule(); }
    });
  });
  return wrap;
}
/** 光の点を切っているときは、弱・中・強を選べないようにする */
function showFireLevel() {
  fireLevels.querySelectorAll("input").forEach((r) => {
    (r as HTMLInputElement).disabled = !ST.fire.glints;
  });
  fireLevels.style.opacity = ST.fire.glints ? "" : "0.45";
}

/* ---- 4. 大きさと位置 ----------------------------------------------------- */
useTab("size");
const secSize = section("石の大きさと置き場所", "カードは横1200・縦630です。石は正方形の絵として置きます。");
const sizeCtl = slider({
  parent: secSize, label: "大きさ", min: 100, max: 1600, step: 5, value: ST.gem.sizePx, unit: "px",
  onInput: (v) => { ST.gem.sizePx = v; needGem = true; schedule(); },
});
const xCtl = slider({
  parent: secSize, label: "横の位置", min: -200, max: 1400, step: 1, value: ST.gem.cx,
  onInput: (v) => { ST.gem.cx = v; ST.shuffle.baseCx = v; schedule(); },
});
const yCtl = slider({
  parent: secSize, label: "縦の位置", min: -200, max: 830, step: 1, value: ST.gem.cy,
  onInput: (v) => { ST.gem.cy = v; ST.shuffle.baseCy = v; schedule(); },
});

/* ---- 5. 背景のにじみ ----------------------------------------------------- */
useTab("glow");
const secGlow = section("背景のにじみ", "石の色がうしろの闇へ漏れるにじみと、背景に置く色のにじみを別々に動かせます。");

/* ---- 自動の補正 ---- */
const autoHead = document.createElement("h3");
autoHead.textContent = "自動の補正";
secGlow.appendChild(autoHead);
const autoNote = document.createElement("p");
autoNote.className = "gs-note";
autoNote.textContent =
  "色の決まりに書かれている式で、人の色の明るさをそろえ、混ぜ方を光の量そのもので行い、" +
  "近い色どうしを離して置き、文字が読める明るさで頭打ちにします。切ると前のやり方に戻ります。";
secGlow.appendChild(autoNote);
const autoOn = document.createElement("label");
autoOn.className = "gs-check";
autoOn.innerHTML = `<input type="checkbox"><span>自動の補正を使う</span>`;
secGlow.appendChild(autoOn);
const autoBox = autoOn.querySelector("input") as HTMLInputElement;
autoBox.checked = ST.auto.on;
autoBox.addEventListener("change", () => {
  ST.auto.on = autoBox.checked;
  showSetControls();
  schedule();
});
const autoWrap = document.createElement("div");
secGlow.appendChild(autoWrap);
const autoL = slider({
  parent: autoWrap, label: "そろえる明るさ（色ごとの尖りを選んだ時だけ効く）", min: 0.3, max: 0.95, step: 0.01, value: ST.auto.targetL,
  onInput: (v) => { ST.auto.targetL = v; schedule(); },
});
const spaceWrap = document.createElement("div");
spaceWrap.className = "gs-radios";
spaceWrap.innerHTML = `
  <label><input type="radio" name="gs-space" value="linear" checked><span>光の量そのもので混ぜる</span></label>
  <label><input type="radio" name="gs-space" value="oklab"><span>目で見た感じの並びで混ぜる</span></label>`;
autoWrap.appendChild(spaceWrap);
spaceWrap.querySelectorAll("input").forEach((r) => {
  r.addEventListener("change", () => {
    const el = r as HTMLInputElement;
    if (el.checked) { ST.auto.space = el.value; schedule(); }
  });
});
const cuspWrap = document.createElement("div");
cuspWrap.className = "gs-radios";
cuspWrap.innerHTML = `
  <label><input type="radio" name="gs-cusp" value="flat" checked><span>どの色も同じ明るさにそろえる</span></label>
  <label><input type="radio" name="gs-cusp" value="cusp"><span>色ごとに、いちばん鮮やかに見える明るさにする</span></label>`;
autoWrap.appendChild(cuspWrap);
cuspWrap.querySelectorAll("input").forEach((r) => {
  r.addEventListener("change", () => {
    const el = r as HTMLInputElement;
    if (el.checked) { ST.auto.cusp = el.value === "cusp"; schedule(); }
  });
});

const glowMainHead = document.createElement("h3");
glowMainHead.textContent = "石の色のにじみ";
secGlow.appendChild(glowMainHead);
const gm = {
  a: slider({ parent: secGlow, label: "強さ", min: 0, max: 1, step: 0.01, value: ST.glow.main.alpha, onInput: (v) => { ST.glow.main.alpha = v; schedule(); } }),
  r: slider({ parent: secGlow, label: "大きさ", min: 40, max: 1200, step: 10, value: ST.glow.main.radius, unit: "px", onInput: (v) => { ST.glow.main.radius = v; schedule(); } }),
  x: slider({ parent: secGlow, label: "横の位置", min: -300, max: 1500, step: 5, value: ST.glow.main.x, onInput: (v) => { ST.glow.main.x = v; schedule(); } }),
  y: slider({ parent: secGlow, label: "縦の位置", min: -300, max: 930, step: 5, value: ST.glow.main.y, onInput: (v) => { ST.glow.main.y = v; schedule(); } }),
};

/* ---- 背景色の組えらび ---- */
const glowSetHead = document.createElement("h3");
glowSetHead.textContent = "背景の色のにじみ";
secGlow.appendChild(glowSetHead);
const setOptsWrap = document.createElement("div");
setOptsWrap.className = "gs-setopts";
secGlow.appendChild(setOptsWrap);

/** 自分で選ぶ の色えらび。並びは名簿の段の順そのまま */
const customWrap = document.createElement("div");
customWrap.className = "gs-custom";
secGlow.appendChild(customWrap);
DIAMOND_COLOR_PAGES.forEach((rowIds) => {
  const row = document.createElement("div");
  row.className = "gs-crow";
  rowIds.forEach((id) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gs-cdot";
    b.dataset.id = id;
    b.setAttribute("aria-label", id);
    b.style.background = HEX_BY_ID.get(id) ?? "#888";
    b.addEventListener("click", () => togglePicked(id));
    row.appendChild(b);
  });
  customWrap.appendChild(row);
});

/** 反対の色のときだけ出すつまみ */
const compWrap = document.createElement("div");
secGlow.appendChild(compWrap);
const methodWrap = document.createElement("div");
methodWrap.className = "gs-radios";
methodWrap.innerHTML = `
  <label><input type="radio" name="gs-comp" value="invert" checked><span>色を裏返す（255から引く）</span></label>
  <label><input type="radio" name="gs-comp" value="hue"><span>色合いを180度まわす（濃さと明るさは残す）</span></label>`;
compWrap.appendChild(methodWrap);
methodWrap.querySelectorAll("input").forEach((r) => {
  r.addEventListener("change", () => {
    const el = r as HTMLInputElement;
    if (el.checked) {
      ST.glow.method = el.value;
      rebuildSetOptions();
      schedule();
    }
  });
});
const compNote = document.createElement("p");
compNote.className = "gs-note gs-compnote";
compWrap.appendChild(compNote);
const gc = {
  a: slider({ parent: compWrap, label: "強さ", min: 0, max: 1, step: 0.01, value: ST.glow.comp.alpha, onInput: (v) => { ST.glow.comp.alpha = v; schedule(); } }),
  r: slider({ parent: compWrap, label: "大きさ", min: 40, max: 1200, step: 10, value: ST.glow.comp.radius, unit: "px", onInput: (v) => { ST.glow.comp.radius = v; schedule(); } }),
  x: slider({ parent: compWrap, label: "横の位置", min: -300, max: 1500, step: 5, value: ST.glow.comp.x, onInput: (v) => { ST.glow.comp.x = v; schedule(); } }),
  y: slider({ parent: compWrap, label: "縦の位置", min: -300, max: 930, step: 5, value: ST.glow.comp.y, onInput: (v) => { ST.glow.comp.y = v; schedule(); } }),
};

/** 人の色を置くときのつまみ */
const setWrap = document.createElement("div");
secGlow.appendChild(setWrap);
/** 前のやり方の持ち上げ。自動の補正を切っているときだけ出す。
 *  並び順をそろえるため、下のつまみを作ってから中へ入れる */
const liftWrap = document.createElement("div");
const gs = {
  a: slider({ parent: setWrap, label: "脇役の量", min: 0, max: 1.5, step: 0.05, value: ST.glow.set.mul, onInput: (v) => { ST.glow.set.mul = v; schedule(); } }),
  r: slider({ parent: setWrap, label: "全体の大きさ", min: 40, max: 1200, step: 10, value: ST.glow.set.radius, unit: "px", onInput: (v) => { ST.glow.set.radius = v; schedule(); } }),
  s: slider({ parent: setWrap, label: "散らし方（種）", min: 1, max: 9999, step: 1, value: ST.glow.set.seed, onInput: (v) => { ST.glow.set.seed = v; schedule(); } }),
  l: slider({ parent: liftWrap, label: "暗い色の持ち上げ", min: 0, max: 1, step: 0.05, value: ST.glow.set.lift, onInput: (v) => { ST.glow.set.lift = v; schedule(); } }),
};
setWrap.appendChild(liftWrap);

/** いまのメインの色で選べる組を並べ直す。メインの色が入っている組だけ出す */
function rebuildSetOptions() {
  const picked = ST.glow.set;
  setOptsWrap.innerHTML = "";
  const opts: { kind: string; key: string; ids: string[]; dots: (string | null)[]; label: string }[] = [];

  // 読み上げ用の名札も、組の名前を言わず色の合言葉と色の値だけにする（Hop決定）
  const comp = compColor(ST.member.hex, ST.glow.method);
  opts.push({ kind: "comp", key: "comp", ids: [], dots: [`rgb(${comp.join(",")})`], label: rgbToHex(comp) });

  for (const s of COLOR_SETS) {
    if (!s.ids.includes(ST.member.id)) continue;
    const rest = s.ids.filter((id) => id !== ST.member.id);
    opts.push({ kind: "group", key: s.key, ids: s.ids.slice(), dots: rest.map((id) => HEX_BY_ID.get(id) ?? "#888"), label: rest.join(" ") });
  }

  const cd: (string | null)[] = picked.pickedIds.length
    ? picked.pickedIds.map((id) => HEX_BY_ID.get(id) ?? "#888")
    : [null, null, null];
  opts.push({ kind: "custom", key: "custom", ids: [], dots: cd, label: picked.pickedIds.join(" ") });

  let stillThere = false;
  for (const o of opts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gs-setopt";
    b.dataset.key = o.key;
    b.setAttribute("aria-label", o.label);
    const wrap = document.createElement("span");
    wrap.className = "gs-dots";
    for (const d of o.dots) {
      const i = document.createElement("i");
      if (d) i.style.background = d;
      else i.className = "gs-empty";
      wrap.appendChild(i);
    }
    b.appendChild(wrap);
    if (o.key === picked.key) {
      b.classList.add("on");
      stillThere = true;
    }
    b.addEventListener("click", () => {
      ST.glow.set.kind = o.kind;
      ST.glow.set.key = o.key;
      ST.glow.set.ids = o.ids.slice();
      rebuildSetOptions();
      showSetControls();
      schedule();
    });
    setOptsWrap.appendChild(b);
  }

  // 色を変えて、前に選んでいた組が無くなったら反対の色に戻す
  if (!stillThere) {
    ST.glow.set.kind = "comp";
    ST.glow.set.key = "comp";
    ST.glow.set.ids = [];
    rebuildSetOptions();
  }
  // 組の中身はメインの色に付いて回るので、選ばれている組の合言葉を入れ直す
  const cur = COLOR_SETS.find((s) => s.key === ST.glow.set.key);
  if (cur) ST.glow.set.ids = cur.ids.slice();
}

/** 自分で選ぶ の色を入れたり外したり。3つまで。4つ目を押すといちばん古いものが外れる */
function togglePicked(id: string) {
  const p = ST.glow.set.pickedIds;
  const i = p.indexOf(id);
  if (i >= 0) p.splice(i, 1);
  else {
    p.push(id);
    while (p.length > 3) p.shift();
  }
  ST.glow.set.kind = "custom";
  ST.glow.set.key = "custom";
  rebuildSetOptions();
  showSetControls();
  schedule();
}

/** いまの選び方に合わせて、出すつまみを入れ替える */
function showSetControls() {
  const k = ST.glow.set.kind;
  autoWrap.style.display = ST.auto.on ? "" : "none";
  liftWrap.style.display = ST.auto.on ? "none" : "";
  compWrap.style.display = k === "comp" ? "" : "none";
  setWrap.style.display = k === "comp" ? "none" : "";
  customWrap.style.display = k === "custom" ? "" : "none";
  customWrap.querySelectorAll<HTMLButtonElement>(".gs-cdot").forEach((b) => {
    b.classList.toggle("on", ST.glow.set.pickedIds.includes(b.dataset.id ?? ""));
  });
}

/** いま背景に置くにじみを組み立てる。位置は種から決まるので、同じ種なら必ず同じ置き方になる */
function glowBlobs(): BlobOut[] {
  const s = ST.glow.set;
  if (s.kind === "comp") {
    // 反対の色は人の色ではないので、明るさをそろえる補正は当てない
    const c = compColor(ST.member.hex, ST.glow.method);
    return [{
      id: "", hex: rgbToHex(c), rgb: c, oklch: lchOf(c),
      x: ST.glow.comp.x, y: ST.glow.comp.y, radius: ST.glow.comp.radius,
      alpha: ST.auto.on ? ST.glow.comp.alpha : ST.glow.comp.alpha,
    }];
  }
  const ids = (s.kind === "custom" ? s.pickedIds : s.ids.filter((id) => id !== ST.member.id))
    .filter((id) => HEX_BY_ID.has(id));
  if (!ids.length) return [];
  const rng = makeRng(s.seed);

  // 色を先に決める。自動の補正が入っているときは、明るさをそろえてから使う
  const colors = ids.map((id) => {
    const hex = HEX_BY_ID.get(id) ?? "#888888";
    if (ST.auto.on) {
      // 一律に明るくせず、その色の色合いが読み取れる最低限まで
      const want = ST.auto.cusp ? ST.auto.targetL : minReadableL(hex, ST.auto.space as Space);
      const f = liftToTargetL(hex, want, ST.auto.cusp);
      return { id, hex, rgb: f.rgb255 as [number, number, number], lch: f.lch };
    }
    const rgb = liftColor(hexToRgb(hex), s.lift);
    return { id, hex, rgb, lch: labToLch(linearToOklab(hexToLinear(rgbToHex(rgb)))) };
  });

  // 置き場所を決める。自動の補正が入っているときは、近い色どうしほど遠くへ置く
  let use: [number, number][];
  if (ST.auto.on) {
    const labs = colors.map((c) => linearToOklab(hexToLinear(rgbToHex(c.rgb))));
    const order = bestAssignment(labs as [number, number, number][], layoutDef().slots);
    use = order.map((sI) => layoutDef().slots[sI]);
  } else {
    const all = layoutDef().slots;
    const slots = all.slice(0, Math.max(1, Math.min(all.length, ids.length)));
    const rest = slots.slice(1);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    use = [slots[0], ...rest];
  }

  return colors.map((c, i) => {
    const base = use[i % use.length];
    return {
      id: c.id,
      hex: c.hex,
      rgb: c.rgb,
      oklch: [Math.round(c.lch[0] * 1e4) / 1e4, Math.round(c.lch[1] * 1e4) / 1e4, Math.round(c.lch[2] * 10) / 10],
      // 種は、決まった置き場所からの小さなずらしにだけ使う。
      // 大きく振ると文字の帯へ入り込むので、縦は控えめにする
      x: Math.round(base[0] + (rng() - 0.5) * 100),
      y: Math.round(base[1] + (rng() - 0.5) * 60),
      radius: Math.round(s.radius * (0.85 + rng() * 0.3)),
      alpha: ST.auto.on ? SET_NOMINAL_ALPHA : s.alpha,
    };
  });
}

/** 色の値から、目で見た感じに近い並べ方での3つの数を出す */
function lchOf(c: readonly number[]): number[] {
  const l = labToLch(linearToOklab(hexToLinear(rgbToHex(c))));
  return [Math.round(l[0] * 1e4) / 1e4, Math.round(l[1] * 1e4) / 1e4, Math.round(l[2] * 10) / 10];
}

/* ---------------------------------------------------------------------------
 * 脇役の量をそろえる
 * ------------------------------------------------------------------------ */
let refAmountCache: { space: string; amount: Amount } | null = null;
/** 基準の絵が地からどれだけ浮いているかを測る。混ぜ方ごとに一度だけ */
function referenceAmount(space: Space): Amount {
  if (refAmountCache && refAmountCache.space === space) return refAmountCache.amount;
  const comp = compColor(REF.hex, "invert");
  const blobs: LayerBlob[] = [
    { x: REF.main.x, y: REF.main.y, radius: REF.main.radius, alpha: REF.main.alpha, linear: hexToLinear(REF.hex) },
    { x: REF.comp.x, y: REF.comp.y, radius: REF.comp.radius, alpha: REF.comp.alpha, linear: hexToLinear(rgbToHex(comp)) },
  ];
  // 基準そのものは、最初の版と同じ「画面の色のまま混ぜる」で測る
  const amount = sampleAmount(blobs, "srgb", 1);
  refAmountCache = { space, amount };
  return amount;
}

/** 地の色を、その位置で取り出す */
function baseLinearAt(x: number, y: number): Rgb {
  const dx = (x - 600) / 1800;
  const dy = (y + 50.4) / 535.5;
  const t = Math.min(1, Math.sqrt(dx * dx + dy * dy));
  const s = baseAt(t);
  return [toLinear(s[0] / 255), toLinear(s[1] / 255), toLinear(s[2] / 255)];
}
function mixInSpace(a: Rgb, b: Rgb, t: number, space: Space): Rgb {
  const toS = (c: Rgb): Rgb =>
    space === "oklab" ? linearToOklab(c) : space === "srgb" ? [toSrgb(c[0]), toSrgb(c[1]), toSrgb(c[2])] : c;
  const fromS = (c: Rgb): Rgb =>
    space === "oklab" ? oklabToLinear(c) : space === "srgb" ? [toLinear(c[0]), toLinear(c[1]), toLinear(c[2])] : c;
  const A = toS(a), B = toS(b);
  return fromS([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

/** その色が「色合いを読み取れる」いちばん低い明るさを探す。
 *  基準の濃さで地の上に置いたとき、鮮やかさが見分けの付く差の2倍ぶん増え、
 *  色合いが20度以内に収まることを条件にする。明るい色は持ち上げない */
const readableCache = new Map<string, number>();
function minReadableL(hex: string, space: Space): number {
  const key = hex + "|" + space;
  const hit = readableCache.get(key);
  if (hit !== undefined) return hit;
  const at = baseLinearAt(SET_SLOTS[0][0], SET_SLOTS[0][1]);
  const baseLch = labToLch(linearToOklab(at));
  const own = labToLch(linearToOklab(hexToLinear(hex)));
  let found = own[0];
  for (let L = own[0]; L <= 0.96; L += 0.01) {
    const lifted = liftToTargetL(hex, L, false);
    const mixed = labToLch(linearToOklab(mixInSpace(at, lifted.linear, REF_PEAK_ALPHA, space)));
    const dC = mixed[1] - baseLch[1];
    let dh = Math.abs(mixed[2] - lifted.lch[2]) % 360;
    if (dh > 180) dh = 360 - dh;
    if (dC >= 0.04 && (own[1] < 0.02 || dh <= 20)) { found = L; break; }
    found = L;
  }
  readableCache.set(key, found);
  return found;
}

/** 脇役のにじみに掛ける倍率を、基準の量に収まるところまで下げて決める。
 *  色が増えるほど1色ぶんは淡くなる。同じ組み合わせなら覚えておいて測り直さない */
const fitCache = new Map<string, number>();
function fitSetAmount(all: LayerBlob[], space: Space): number {
  if (!all.length) return 1;
  const target = referenceAmount(space);
  const key = space + "|" + all
    .map((b) => [b.x, b.y, b.radius, b.alpha, ...b.linear.map((v) => v.toFixed(4))].join(","))
    .join(";");
  const hit = fitCache.get(key);
  if (hit !== undefined) return hit;
  const test = (m: number) => sampleAmount(all, space, m, layoutDef().amountArea);
  const ok = (a: Amount) =>
    a.sumDC <= target.sumDC * 1.02 && a.sumDL <= target.sumDL * 1.02 &&
    a.maxDC <= target.maxDC * 1.02 && a.maxDL <= target.maxDL * 1.02;
  let out: number;
  if (ok(test(1.5))) out = 1.5;
  else {
    let lo = 0, hi = 1.5;
    for (let i = 0; i < 11; i++) {
      const mid = (lo + hi) / 2;
      if (ok(test(mid))) lo = mid;
      else hi = mid;
    }
    out = lo;
  }
  if (fitCache.size > 200) fitCache.clear();
  fitCache.set(key, out);
  return out;
}

/** 石の影の外周と、中心から出した向きが交わる所までの長さ。
 *  石の足元がどこかを知るために使う */
function outlineReach(poly: [number, number][], cx: number, cy: number, dx: number, dy: number): number {
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - cx) * ey - (a[1] - cy) * ex) / den;
    const s = ((a[0] - cx) * dy - (a[1] - cy) * dx) / den;
    if (t > 0 && s >= 0 && s <= 1 && t > best) best = t;
  }
  return best;
}

/** 底の尖りが、カードのどこに来るか。
 *  石の形のいちばん下の角（物の座標で y がいちばん小さい点）を、
 *  石の影と同じやり方で画面へ落とす */
let culetVert: number[] | null = null;
function culetPoint(rows: number[], half: number, cx: number, cy: number, size: number, rollDeg: number): [number, number] {
  if (!culetVert) {
    let best: number[] | null = null;
    for (const v of gemVertices()) if (!best || v[1] < best[1]) best = v;
    culetVert = best ?? [0, -1, 0];
  }
  const v = culetVert;
  const k = size / 2 / half;
  const a = (rollDeg * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const wx = rows[0] * v[0] + rows[1] * v[1] + rows[2] * v[2];
  const wy = rows[3] * v[0] + rows[4] * v[1] + rows[5] * v[2];
  const ox = wx * k;
  const oy = -wy * k;
  return [cx + ox * ca - oy * sa, cy + ox * sa + oy * ca];
}

/** 根元を石の輪郭より少し内側に入れる量。
 *  筋の根元は濃さが急に切れる所なので、石の絵の下へ隠す */
const RAY_INSET = 12;

/** 石が周りに投げる光のかけら。
 *  本当に光を追うと重すぎるので、近似で置いている。
 *  石を通った光が床に落ちる時の見え方に合わせて、石の足元（影の輪郭）から
 *  外へ向かって、長さの違う細い光の筋を扇のように伸ばす。
 *  根元がいちばん明るく、先へ行くほど淡く細くなる。
 *  色の決まりは、表面で跳ね返った分は白、石を通った分は石の色。
 *  白い石は吸う色が無いので、淡い七色に散らす。
 *  文字の箱に掛かる筋は置かない */
function causticBlobs(): BlobOut[] {
  if (!ST.caustics.on || ST.caustics.count <= 0) return [];
  const L = ST.lights[0];
  if (!L || L.intensity <= 0.02) return [];
  // 光が進む向きを画面の座標に直す。画面は下が正。
  // 向きは書き出すときに小数6桁へ丸めるので、ここでも同じ桁に丸めてから使う。
  // そうしないと、書き出して読み戻したときに筋の向きがごくわずかにずれる
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  const ex = -r6(L.dir[0]);
  const ey = r6(L.dir[1]);
  const len = Math.hypot(ex, ey);
  if (len < 0.08) return [];   // 光がほぼ正面から来ている時は、抜ける側が決まらない
  const baseAng = Math.atan2(ey / len, ex / len);
  const rng = makeRng(ST.glow.set.seed * 31 + 17);
  const gemR = ST.gem.sizePx * 0.5;
  const isWhite = labToLch(linearToOklab(hexToLinear(ST.member.hex)))[1] < 0.02;
  const bodyHex = HEX_BY_ID.has(ST.member.id)
    ? rgbToHex(liftToTargetL(ST.member.hex, minReadableL(ST.member.hex, ST.auto.space as Space), false).rgb255)
    : ST.member.hex;
  const boxes = textBoxes();
  if (!getVerts().length) setVerts(gemVertices());
  const poly = gemOutline(
    getVerts(),
    ([] as number[]).concat(...ST.rotation.rows),
    fitHalf(),
    ST.gem.cx,
    ST.gem.cy,
    ST.gem.sizePx,
    ST.roll2dDeg
  );
  /** 筋の通り道が、文字の箱の 40px 内に入らないか */
  const clearOfText = (x: number, y: number, rx: number, ry: number, length: number) => {
    const steps = Math.max(2, Math.ceil(length / 16));
    for (let i = 0; i <= steps; i++) {
      const px = x + rx * (length * i) / steps;
      const py = y + ry * (length * i) / steps;
      for (const b of boxes) {
        if (px > b.x - 40 && px < b.x + b.w + 40 && py > b.y - 40 && py < b.y + b.h + 40) return false;
      }
    }
    return true;
  };
  const out: BlobOut[] = [];
  let guard = 0;
  while (out.length < ST.caustics.count && guard++ < 400) {
    // 抜けていく側の扇。2回引いて足すと、扇のまん中が出やすく端は少なくなる。
    // そろいすぎず、ばらばらすぎない散らばりになる
    const ang = baseAng + (rng() + rng() - 1) * 0.75;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const reach = outlineReach(poly, ST.gem.cx, ST.gem.cy, dx, dy);
    if (reach <= 0) continue;
    const root = Math.max(gemR * 0.2, reach - RAY_INSET);
    const x = Math.round(ST.gem.cx + dx * root);
    const y = Math.round(ST.gem.cy + dy * root);
    if (x < 10 || y < 10 || x > W - 10 || y > H - 10) continue;
    // 筋の向きは、まっすぐ外へ向かう向きから少しだけずらす
    const tilt = (rng() - 0.5) * 0.34;
    const rx = Math.cos(ang + tilt);
    const ry = Math.sin(ang + tilt);
    // 長さはばらつかせる。先は石の半径の1.5倍までに収める
    const want = gemR * (0.18 + rng() * 0.45);
    const length = Math.round(Math.min(want, gemR * 1.5 - root));
    if (length < 40) continue;
    const width = 5 + rng() * 7;
    if (!clearOfText(x, y, rx, ry, length)) continue;
    // 3本に1本は、表面で跳ね返っただけの白い筋
    const surface = rng() < 0.34;
    let rgb: number[];
    if (surface) rgb = [255, 255, 255];
    else if (isWhite) {
      // 白い石は七色。筋ごとに色合いを変え、淡くする
      const h = rng() * 360;
      const f = lchToLinearInGamut([0.88, 0.09, h]);
      rgb = linearTo255(f.linear);
    } else rgb = hexToRgb(bodyHex);
    out.push({
      id: surface ? "" : ST.member.id,
      hex: rgbToHex(rgb),
      rgb,
      oklch: lchOf(rgb),
      x,
      y,
      radius: length,
      // ここは出発点の濃さ。このあと、かけら専用の縛りに当たる所まで自動で下げる
      alpha: SET_NOMINAL_ALPHA * (surface ? 0.9 : 1),
      shard: true,
      ray: true,
      rot: Math.atan2(ry, rx),
      width,
      area: rayArea(length, width),
    });
  }
  // 覆う広さの合計をカードの1.5%までに収める。
  // 丸めたあとにもう一度測り直して、はみ出していたらもう一度縮める
  const CAP = W * H * 0.015;
  for (let pass = 0; pass < 8; pass++) {
    let area = 0;
    for (const o of out) area += o.area ?? 0;
    if (area <= CAP || area <= 0) break;
    const k = Math.sqrt((CAP * 0.995) / area);
    for (const o of out) {
      o.radius = Math.max(20, Math.round(o.radius * k));
      o.width = Math.max(2, (o.width ?? 5) * k);
      o.area = rayArea(o.radius, o.width);
    }
  }
  // それでも収まらないときは、本数を減らして必ず守る
  let area = out.reduce((a, o) => a + (o.area ?? 0), 0);
  while (out.length && area > CAP) {
    area -= out.pop()!.area ?? 0;
  }
  return out;
}

/** 石の絵から、明るい面の明るさと平均の鮮やかさを測る。かけらの上限の物差しに使う */
let gemStatCache: { key: string; topL: number; meanC: number } | null = null;
function gemStats(): { topL: number; meanC: number } {
  const key = ST.member.hex + "|" + JSON.stringify(ST.rotation.rows) + "|" + lastPx + "|" + (ST.sparkle.on ? "s1" : "s0");
  if (gemStatCache && gemStatCache.key === key) return gemStatCache;
  const fallback = { topL: 0.8, meanC: 0.1 };
  if (!sprite) return fallback;
  try {
    const px = sprite.width;
    const d = sprite.getContext("2d")!.getImageData(0, 0, px, px).data;
    const ls: number[] = [];
    let cSum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 7) {
      if (d[i + 3] < 200) continue;
      const lch = labToLch(linearToOklab([toLinear(d[i] / 255), toLinear(d[i + 1] / 255), toLinear(d[i + 2] / 255)]));
      ls.push(lch[0]);
      cSum += lch[1];
      n++;
    }
    if (n < 20) return fallback;
    ls.sort((a, b) => b - a);
    const top = ls.slice(0, Math.max(1, Math.round(ls.length * 0.1)));
    const out = { key, topL: top.reduce((a, b) => a + b, 0) / top.length, meanC: cSum / n };
    gemStatCache = out;
    return out;
  } catch {
    return fallback;
  }
}

/** かけら専用の縛り。いちばん明るい所が石の明るい面の7割を超えず、
 *  地からの浮きが L で +0.30 を超えず、鮮やかさが石の平均を超えない所まで下げる。
 *  かけらの峰はその中心なので、升目で探さず中心の色を直に計算して測る */
function fitCaustics(shards: BlobOut[], space: Space): number {
  if (!shards.length) return 1;
  const g = gemStats();
  const limitL = Math.min(g.topL * 0.7, 1);
  // 鮮やかさは石の平均を超えない。ただし白い石は平均がほぼ0なので、
  // それをそのまま当てると淡い七色のかけらが一枚も出せなくなる。
  // 色の無い石に「石より鮮やかにするな」は意味を持たないので、下限を置く
  const limitC = Math.max(g.meanC, 0.1);
  const ok = (k: number) => {
    for (const sh of shards) {
      const at = baseLinearAt(sh.x, sh.y);
      const baseL = labToLch(linearToOklab(at))[0];
      const mixed = labToLch(linearToOklab(mixInSpace(at, hexToLinear(sh.hex), Math.min(1, sh.alpha * k), space)));
      if (mixed[0] > limitL) return false;
      if (mixed[0] - baseL > 0.30) return false;
      if (mixed[1] > limitC) return false;
    }
    return true;
  };
  if (ok(1.5)) return 1.5;
  let lo = 0, hi = 1.5;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** 石の色のにじみを先頭に、背景色の組のぶんを続けた、出来上がりの並び。
 *  石の色のにじみは石そのものと同じ色でなければ嘘になるので、明るさはそろえない */
function allBlobs(): BlobOut[] {
  const rgb = hexToRgb(ST.member.hex);
  return [
    { id: ST.member.id, hex: ST.member.hex, rgb: [rgb[0], rgb[1], rgb[2]], oklch: lchOf(rgb), x: ST.glow.main.x, y: ST.glow.main.y, radius: ST.glow.main.radius, alpha: ST.glow.main.alpha },
    ...glowBlobs(),
    ...causticBlobs(),
  ];
}

function rgbToHex(c: readonly number[]): string {
  return "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/* ---- 6. 光の粒 ----------------------------------------------------------- */
useTab("shine");
const secDots = section("光の粒", "石から左上へ離れていく小さな点です。");
const dotsOn = document.createElement("label");
dotsOn.className = "gs-check";
dotsOn.innerHTML = `<input type="checkbox"><span>光の粒を出す</span>`;
secDots.appendChild(dotsOn);
const dotsBox = dotsOn.querySelector("input") as HTMLInputElement;
dotsBox.checked = ST.dots.on;
dotsBox.addEventListener("change", () => { ST.dots.on = dotsBox.checked; schedule(); });
const dotsNCtl = slider({ parent: secDots, label: "数", min: 0, max: 400, step: 5, value: ST.dots.count, unit: "粒", onInput: (v) => { ST.dots.count = v; schedule(); } });
const dotsSeedCtl = slider({ parent: secDots, label: "散らし方（種）", min: 1, max: 99999999, step: 1, value: ST.dots.seed, onInput: (v) => { ST.dots.seed = v; schedule(); } });

/* ---- 6b. 層の入り切り ----------------------------------------------------- */
useTab("shine");
const secLayers = section(
  "層",
  "絵は3つの層でできています。下から 背景（下地とにじみ）・石・光（石の足元の光の筋と、光の粒）。文字はいつも一番上です。"
);
const layerBox: Record<string, HTMLInputElement> = {};
for (const [key, name] of [["bg", "背景"], ["gem", "石"], ["light", "光"]] as [string, string][]) {
  const lab = document.createElement("label");
  lab.className = "gs-check";
  lab.innerHTML = `<input type="checkbox" data-layer="${key}"><span>${name}</span>`;
  secLayers.appendChild(lab);
  const inp = lab.querySelector("input") as HTMLInputElement;
  inp.checked = (ST.layers as unknown as Record<string, boolean>)[key];
  inp.addEventListener("change", () => {
    (ST.layers as unknown as Record<string, boolean>)[key] = inp.checked;
    schedule();
  });
  layerBox[key] = inp;
}

/* ---- 7. 設定の受け渡し --------------------------------------------------- */
useTab("io");
const secIo = section(
  "設定の受け渡し",
  "いまの数字をひとまとめの文字として書き出します。貼り戻して読み込めば同じ絵に戻ります。"
);
const ioBtns = document.createElement("div");
ioBtns.className = "gs-btns";
secIo.appendChild(ioBtns);
const ta = document.createElement("textarea");
ta.className = "gs-json";
ta.spellcheck = false;
ta.rows = 12;
secIo.appendChild(ta);
const ioMsg = document.createElement("p");
ioMsg.className = "gs-note";
secIo.appendChild(ioMsg);

button(ioBtns, "いまの設定を書き出す", () => {
  ta.value = exportJson();
  ioMsg.textContent = "書き出しました。";
});
button(ioBtns, "欄の中身を読み込む", () => {
  try {
    importJson(JSON.parse(ta.value));
    ioMsg.textContent = "読み込みました。";
  } catch (e) {
    ioMsg.textContent = "読み込めませんでした: " + (e instanceof Error ? e.message : String(e));
  }
});
button(ioBtns, "全部えらぶ", () => {
  ta.focus();
  ta.select();
  // 写し取りは断られることがあるので、断られても何も起きないようにしておく
  try {
    navigator.clipboard?.writeText(ta.value).catch(() => undefined);
  } catch {
    /* 写し取りが使えない場でも、選ぶところまでは効いている */
  }
  ioMsg.textContent = "選びました。写し取れていなければ、そのまま手で写してください。";
});
button(ioBtns, "最初の状態に戻す", () => {
  importJson(makeDefault());
  ioMsg.textContent = "最初の状態に戻しました。";
});

function exportJson(): string {
  ST.gem.fitHalf = fitHalf();
  ST.convention = CONVENTION;
  ST.glow.blobs = allBlobs();
  const round = (v: number, k = 6) => Math.round(v * 10 ** k) / 10 ** k;
  const out: Setting = JSON.parse(JSON.stringify(ST));
  // 石の向きは、読み戻したときに出来上がる向きを先に求めてから書き出す。
  //
  // 書き出すときに小数6桁で丸めている。読み戻す側はその丸めた 3x3 から
  // 向きを組み直すので、丸めた桁のぶんだけ元とずれる。そのまま書き出すと
  // 書き出し→読み戻し→書き出し で6桁目の数字が動いてしまっていた。
  // 丸めても数字が動かなくなる所まで先に通しておけば、往復で文字がそろう。
  let rows9 = ([] as number[]).concat(...out.rotation.rows).map((v) => round(v));
  let q = rowsToQ(rows9);
  for (let i = 0; i < 12; i++) {
    const next = qToRows(q).map((v) => round(v));
    if (next.every((v, k) => v === rows9[k])) break;
    rows9 = next;
    q = rowsToQ(rows9);
  }
  out.rotation.rows = [rows9.slice(0, 3), rows9.slice(3, 6), rows9.slice(6, 9)];
  // 符号をそろえてから書き出す。そろえないと、読み戻したときに
  // 同じ向きのまま符号だけ反転した文字になり、往復で中身が変わって見える
  out.rotation.quat = qCanon(q.slice() as Quat).map((v) => round(v));
  out.lights = out.lights.map((l) => ({ dir: l.dir.map((v) => round(v)), intensity: round(l.intensity, 4), radius: l.radius }));
  out.gem.fitHalf = round(out.gem.fitHalf);
  // 光の筋の向きは、1灯目の向きから出している。その向きは上で小数6桁に丸めて
  // 書き出しているので、読み戻すと筋の向きが 1000万分の3 ほどずれる。
  // 書き出す時に筋の値も丸めておけば、書き出し→読み戻し→書き出しで同じ文字になる
  for (const b of out.glow.blobs) {
    if (b.rot !== undefined) b.rot = round(b.rot, 4);
    if (b.width !== undefined) b.width = round(b.width, 3);
    if (b.area !== undefined) b.area = round(b.area, 1);
  }
  return JSON.stringify(out, null, 2);
}

/** 演出の項目を読む。項目ごと無い＝前の版なので、3つとも切で読む */
function readFire(o: unknown): Setting["fire"] {
  const off = { glints: false, level: "mid", facet: false, bloom: false };
  if (!o || typeof o !== "object") return off;
  const f = o as Partial<Setting["fire"]>;
  return {
    glints: f.glints === true,
    level: typeof f.level === "string" && FIRE_LEVELS.some((v) => v.key === f.level) ? f.level : "mid",
    facet: f.facet === true,
    bloom: f.bloom === true,
  };
}

function importJson(raw: unknown) {
  const d = makeDefault();
  const o = raw as Partial<Setting>;
  if (!o || typeof o !== "object") throw new Error("中身が読めない形です");
  const num = (v: unknown, fb: number) => (typeof v === "number" && isFinite(v) ? v : fb);
  ST = {
    version: num(o.version, 1),
    convention: CONVENTION,
    card: { w: W, h: H },
    // 前の版の設定には型が入っていない。その時は型1として読む
    layout: typeof o.layout === "string" && LAYOUT_BY_KEY.has(o.layout) ? o.layout : "l1",
    member: {
      id: typeof o.member?.id === "string" ? o.member.id : d.member.id,
      hex: typeof o.member?.hex === "string" ? o.member.hex : d.member.hex,
    },
    rotation: d.rotation,
    roll2dDeg: num(o.roll2dDeg, d.roll2dDeg),
    lights: [0, 1, 2].map((i) => {
      const l = o.lights?.[i];
      const dd = Array.isArray(l?.dir) && l!.dir.length === 3 ? l!.dir.map((v) => num(v, 0)) : d.lights[i].dir;
      return { dir: dd, intensity: num(l?.intensity, d.lights[i].intensity), radius: num(l?.radius, d.lights[i].radius) };
    }),
    gem: {
      cx: num(o.gem?.cx, d.gem.cx),
      cy: num(o.gem?.cy, d.gem.cy),
      sizePx: num(o.gem?.sizePx, d.gem.sizePx),
      alpha: num(o.gem?.alpha, d.gem.alpha),
      fitHalf: num(o.gem?.fitHalf, 0),
    },
    glow: {
      method: o.glow?.method === "hue" ? "hue" : "invert",
      main: readBlob(o.glow?.main, d.glow.main),
      comp: readBlob(o.glow?.comp, d.glow.comp),
      // 前の版の設定には組の選び方が入っていない。その時は反対の色のままにする
      set: readGlowSet(o.glow?.set, d.glow.set),
      blobs: [],
    },
    // 前の版の設定には自動の補正の項目が無い。その時は初期値で入れる
    auto: {
      on: typeof o.auto?.on === "boolean" ? o.auto.on : d.auto.on,
      targetL: Math.max(0, Math.min(1, num(o.auto?.targetL, d.auto.targetL))),
      space: o.auto?.space === "oklab" ? "oklab" : "linear",
      cusp: o.auto?.cusp === true,
      minContrastBefore: 0,
      minContrastAfter: 0,
      capScale: 1,
      capped: false,
      shieldScale: 1,
      shielded: false,
      sideFit: 1,
      causticFit: 1,
    },
    // 前の版の設定にはこの項目が無い。その時は既定の「入」で読む
    sparkle: { on: typeof o.sparkle?.on === "boolean" ? o.sparkle.on : d.sparkle.on },
    caustics: {
      on: typeof o.caustics?.on === "boolean" ? o.caustics.on : d.caustics.on,
      count: Math.min(12, num(o.caustics?.count, d.caustics.count)),
      mul: Math.max(0, Math.min(1.5, num(o.caustics?.mul, d.caustics.mul))),
    },
    shuffle: {
      seed: num(o.shuffle?.seed, 0),
      score: num(o.shuffle?.score, 0),
      baseCx: num(o.shuffle?.baseCx, num(o.gem?.cx, d.gem.cx)),
      baseCy: num(o.shuffle?.baseCy, num(o.gem?.cy, d.gem.cy)),
    },
    dots: {
      on: o.dots?.on === true,
      count: num(o.dots?.count, d.dots.count),
      seed: num(o.dots?.seed, d.dots.seed),
    },
    // 前の版の設定にはこの項目が無い。その時は3層とも入で読む
    layers: {
      bg: typeof o.layers?.bg === "boolean" ? o.layers.bg : true,
      gem: typeof o.layers?.gem === "boolean" ? o.layers.gem : true,
      light: typeof o.layers?.light === "boolean" ? o.layers.light : true,
    },
    // 演出の項目が無い設定＝この演出より前の版。その時は3つとも切で読む。
    // 足す前の絵をそのまま再現するため、既定の「入」は使わない
    fire: readFire(o.fire),
  };
  // 向きは 3x3 があればそれを、無ければ四元数を使う
  const rows = o.rotation?.rows;
  const quat = o.rotation?.quat;
  if (Array.isArray(rows) && rows.length === 3 && rows.every((r) => Array.isArray(r) && r.length === 3)) {
    QUAT = rowsToQ(([] as number[]).concat(...rows.map((r) => r.map((v) => num(v, 0)))));
  } else if (Array.isArray(quat) && quat.length === 4) {
    QUAT = qNorm(quat.map((v) => num(v, 0)) as Quat);
  } else {
    QUAT = d.rotation.quat.slice() as Quat;
  }
  syncRotation();
  useCalibration(ST.layout);
  syncAllControls();
  needGem = true;
  schedule();
}
function readBlob(o: Partial<Blob> | undefined, d: Blob): Blob {
  const num = (v: unknown, fb: number) => (typeof v === "number" && isFinite(v) ? v : fb);
  return { alpha: num(o?.alpha, d.alpha), radius: num(o?.radius, d.radius), x: num(o?.x, d.x), y: num(o?.y, d.y) };
}
function readGlowSet(o: Partial<GlowSet> | undefined, d: GlowSet): GlowSet {
  const num = (v: unknown, fb: number) => (typeof v === "number" && isFinite(v) ? v : fb);
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") as string[] : []);
  const kind = o?.kind === "group" || o?.kind === "custom" ? o.kind : "comp";
  const key = typeof o?.key === "string" ? o.key : kind;
  const known = COLOR_SETS.find((s) => s.key === key);
  return {
    kind: known ? "group" : kind === "custom" ? "custom" : "comp",
    key: known ? key : kind === "custom" ? "custom" : "comp",
    ids: known ? known.ids.slice() : ids(o?.ids),
    pickedIds: ids(o?.pickedIds).slice(0, 3),
    alpha: num(o?.alpha, d.alpha),
    radius: num(o?.radius, d.radius),
    seed: num(o?.seed, d.seed),
    lift: Math.max(0, Math.min(1, num(o?.lift, d.lift))),
    mul: Math.max(0, Math.min(1.5, num(o?.mul, d.mul))),
  };
}

/** 型に合わせて文字の置き方を入れ直す。
 *  文字の箱はここで実際に動くので、石が被らない判定・光の筋の文字よけ・
 *  文字が読める明るさの判定は、どれも自動でその型の位置で測り直される */
function applyLayoutText() {
  const t = layoutDef().text;
  textsEl.style.justifyContent = t.justify;
  textsEl.style.alignItems = t.align;
  textsEl.style.textAlign = t.textAlign;
  textsEl.style.paddingLeft = t.padLeft + "px";
  textsEl.style.paddingRight = t.padRight + "px";
  textsEl.style.paddingTop = t.padTop + "px";
  textsEl.style.paddingBottom = t.padBottom + "px";
}

/** 型を切り替える。石の大きさと置き場所・石の色のにじみも、その型のものにする。
 *  石の色・背景の色の組・石の向きと光は動かさない */
function applyLayout(key: string) {
  if (!LAYOUT_BY_KEY.has(key)) return;
  // 替える前の姿を控えておく。「1つ前に戻る」で型も向きもまとめて戻せるようにする。
  // このあと引き直しても控えは足さないので、1回押せば替える前に戻る
  pushHistory();

  ST.layout = key;
  // 採点の目盛りも、その型で取り直したものに切り替える
  useCalibration(key);
  const d = layoutDef();
  ST.gem.sizePx = d.gem.sizePx;
  ST.gem.cx = d.gem.cx;
  ST.gem.cy = d.gem.cy;
  ST.shuffle.baseCx = d.gem.cx;
  ST.shuffle.baseCy = d.gem.cy;
  ST.glow.main.x = d.gem.cx + d.mainOffset.dx;
  ST.glow.main.y = d.gem.cy + d.mainOffset.dy;
  ST.glow.main.radius = d.mainOffset.radius;
  applyLayoutText();

  // いまの向きが、替えた先の型で出してよい姿かを見る。
  // 通るならそのまま残し、通らない時だけその型で1回引き直す
  const rows = ([] as number[]).concat(...ST.rotation.rows);
  if (poseFitsLayout(rows, ST.gem.cx, ST.gem.cy, ST.gem.sizePx, ST.roll2dDeg)) {
    syncAllControls();
    needGem = true;
    schedule();
  } else {
    doShuffle(false);
  }
}

function syncAllControls() {
  applyLayoutText();
  markPlace();
  markSwatch();
  rollCtl.set(ST.roll2dDeg);
  syncLightCtl();
  sizeCtl.set(ST.gem.sizePx);
  xCtl.set(ST.gem.cx);
  yCtl.set(ST.gem.cy);
  gm.a.set(ST.glow.main.alpha); gm.r.set(ST.glow.main.radius); gm.x.set(ST.glow.main.x); gm.y.set(ST.glow.main.y);
  gc.a.set(ST.glow.comp.alpha); gc.r.set(ST.glow.comp.radius); gc.x.set(ST.glow.comp.x); gc.y.set(ST.glow.comp.y);
  gs.a.set(ST.glow.set.mul); gs.r.set(ST.glow.set.radius); gs.s.set(ST.glow.set.seed); gs.l.set(ST.glow.set.lift);
  autoBox.checked = ST.auto.on;
  autoL.set(ST.auto.targetL);
  spaceWrap.querySelectorAll("input").forEach((r) => {
    (r as HTMLInputElement).checked = (r as HTMLInputElement).value === ST.auto.space;
  });
  cuspWrap.querySelectorAll("input").forEach((r) => {
    (r as HTMLInputElement).checked = ((r as HTMLInputElement).value === "cusp") === ST.auto.cusp;
  });
  rebuildSetOptions();
  showSetControls();
  sparkleBox.checked = ST.sparkle.on;
  for (const k of ["glints", "facet", "bloom"]) {
    fireBox[k].checked = (ST.fire as unknown as Record<string, boolean>)[k];
  }
  fireLevels.querySelectorAll("input").forEach((r) => {
    (r as HTMLInputElement).checked = (r as HTMLInputElement).value === ST.fire.level;
  });
  showFireLevel();
  for (const k of ["bg", "gem", "light"]) {
    layerBox[k].checked = (ST.layers as unknown as Record<string, boolean>)[k];
  }
  dotsBox.checked = ST.dots.on;
  dotsNCtl.set(ST.dots.count);
  dotsSeedCtl.set(ST.dots.seed);
  (methodWrap.querySelector(`input[value="${ST.glow.method}"]`) as HTMLInputElement | null)?.setAttribute("checked", "checked");
  methodWrap.querySelectorAll("input").forEach((r) => {
    (r as HTMLInputElement).checked = (r as HTMLInputElement).value === ST.glow.method;
  });
}

/* ---------------------------------------------------------------------------
 * シャッフル
 *   向き・絵ごとの回し・3灯・置き場所のずらし・にじみの散らし方を、
 *   種ひとつから引き直す。石の色と背景の色の組は動かさない。
 *   引いたものは機械で採点して、線に届かないものは出さずに引き直す。
 * ------------------------------------------------------------------------ */
const seedEl = document.getElementById("gs-seed") as HTMLParagraphElement;
const shuffleBtn = document.getElementById("gs-shuffle") as HTMLButtonElement;
const backBtn = document.getElementById("gs-back") as HTMLButtonElement;
/** 「1つ前に戻る」の控え。
 *
 *  前は「書き出した文字」を控えていた。書き出すときに石の向きを小数6桁、
 *  光の濃さを小数4桁で丸めているので、読み戻すと石の絵がごくわずかに変わる。
 *  絵の差は1段ぶんで、これまでは目に見えなかったが、強い光の演出を入れると
 *  そのわずかな違いで光の点の場所がずれ、差が目に見える大きさになった。
 *  控えるのは丸める前の中身そのものにして、押す前とまったく同じ絵に戻す */
let history: { st: Setting; quat: Quat }[] = [];
/** いまの姿を控えに積む */
function pushHistory() {
  history.push({ st: JSON.parse(JSON.stringify(ST)) as Setting, quat: QUAT.slice() as Quat });
  while (history.length > 20) history.shift();
}
let shuffleMs = 0;
let shuffleTries = 0;

/** 引いたものを設定へ入れる。画面はまだ描き直さない */
function applyDraw(d: Draw) {
  QUAT = d.quat.slice() as Quat;
  syncRotation();
  ST.roll2dDeg = d.roll2dDeg;
  ST.lights = d.lights.map((l) => ({ dir: l.dir.slice(), intensity: l.intensity, radius: l.radius }));
  ST.gem.cx = ST.shuffle.baseCx + d.dx;
  ST.gem.cy = ST.shuffle.baseCy + d.dy;
  ST.glow.set.seed = d.glowSeed;
  ST.shuffle.seed = d.seed;
}

/** 石の影が、見出しか副題の箱に掛かっていないか。
 *  絵を描かずに、角の点を囲んだ外周だけで見分ける */
function hitsText(rows: number[], cx: number, cy: number, size: number, rollDeg: number): boolean {
  if (!getVerts().length) setVerts(gemVertices());
  const poly = gemOutline(getVerts(), rows, fitHalf(), cx, cy, size, rollDeg);
  for (const b of textBoxes()) {
    if (outlineHitsBox(poly, b.x, b.y, b.w, b.h)) return true;
  }
  return false;
}

/** 底の尖りがカードから出ていないか。尖りを求める型でだけ見る */
function culetOutside(rows: number[], cx: number, cy: number, size: number, rollDeg: number): boolean {
  if (!layoutDef().culetMustFit) return false;
  const c = culetPoint(rows, fitHalf(), cx, cy, size, rollDeg);
  return c[0] < 0 || c[0] > W || c[1] < 0 || c[1] > H;
}

/** いまの型の「出してよい姿か」の判定。
 *  文字に被らない・尖りが水平より上を向かない・（型2と型3は）尖りがカードの中。
 *  採点の線はここでは見ない */
function poseFitsLayout(rows: number[], cx: number, cy: number, size: number, rollDeg: number): boolean {
  if (culetPointsUp(rows, rollDeg)) return false;
  if (hitsText(rows, cx, cy, size, rollDeg)) return false;
  if (culetOutside(rows, cx, cy, size, rollDeg)) return false;
  return true;
}

/** 種ひとつぶんを引いて採点する。出してよければ点を返す */
function trial(seed: number): { draw: Draw; score: number } | null {
  const d = drawFromSeed(seed, ST.lights.map((l) => l.radius));
  const rows = quatToRows(d.quat);
  const cx = ST.shuffle.baseCx + d.dx;
  const cy = ST.shuffle.baseCy + d.dy;
  // 描かずに済む判定で先に弾く。
  // 尖りが上を向く姿・文字に被る姿・（型2と型3は）尖りがカードから出る姿
  if (!poseFitsLayout(rows, cx, cy, ST.gem.sizePx, d.roll2dDeg)) return null;
  const img = renderForScore(ST.member.hex, rows, d.lights, fitHalf(), sparkleNow());
  if (!img) return null;
  const sc = scoreGem(img, ST.member.hex, rows, d.roll2dDeg);
  if (!sc || sc.score < PASS_MARK) return null;
  return { draw: d, score: sc.score };
}

function doShuffle(keepHistory = true) {
  const t0 = performance.now();
  if (keepHistory) pushHistory();
  let tries = 0;
  let hit: { draw: Draw; score: number } | null = null;
  while (tries < 400 && !hit) {
    tries++;
    hit = trial(1 + Math.floor(Math.random() * 2147483000));
  }
  shuffleTries = tries;
  if (hit) {
    applyDraw(hit.draw);
    ST.shuffle.score = Math.round(hit.score * 1000) / 1000;
    syncAllControls();
    needGem = true;
    schedule();
  }
  shuffleMs = performance.now() - t0;
}

function goBack() {
  const prev = history.pop();
  if (!prev) return;
  try {
    importJson(prev.st);
    // 向きは 3x3 から四元数に直して読まれるので、そこでもわずかにずれる。
    // 控えてあった向きに入れ直して、押す前とまったく同じ石の絵に戻す
    QUAT = prev.quat.slice() as Quat;
    syncRotation();
    needGem = true;
    schedule();
  } catch {
    /* 戻れなくても今の絵はそのまま */
  }
}

shuffleBtn.addEventListener("click", doShuffle);
backBtn.addEventListener("click", goBack);

/* ---------------------------------------------------------------------------
 * なぞって回す
 * ------------------------------------------------------------------------ */
let dragging = false;
let dragStart: [number, number, number] | null = null;
let dragQuat: Quat = QUAT;

function cardPoint(ev: PointerEvent): { x: number; y: number } {
  const rect = cardEl.getBoundingClientRect();
  const k = rect.width / W;
  return { x: (ev.clientX - rect.left) / k, y: (ev.clientY - rect.top) / k };
}
/** カードの上の点を、石を包む球の上の点に置き換える（アークボール） */
function toBall(x: number, y: number): [number, number, number] {
  const r = Math.max(60, ST.gem.sizePx / 2);
  const ux = (x - ST.gem.cx) / r;
  const uy = -(y - ST.gem.cy) / r;
  const d = ux * ux + uy * uy;
  if (d <= 1) return [ux, uy, Math.sqrt(1 - d)];
  const s = 1 / Math.sqrt(d);
  return [ux * s, uy * s, 0];
}
cardEl.addEventListener("pointerdown", (ev) => {
  const p = cardPoint(ev);
  dragging = true;
  dragStart = toBall(p.x, p.y);
  dragQuat = QUAT.slice() as Quat;
  cardEl.setPointerCapture(ev.pointerId);
  ev.preventDefault();
});
cardEl.addEventListener("pointermove", (ev) => {
  if (!dragging || !dragStart) return;
  const p = cardPoint(ev);
  const b = toBall(p.x, p.y);
  const ax = dragStart[1] * b[2] - dragStart[2] * b[1];
  const ay = dragStart[2] * b[0] - dragStart[0] * b[2];
  const az = dragStart[0] * b[1] - dragStart[1] * b[0];
  const dotv = Math.max(-1, Math.min(1, dragStart[0] * b[0] + dragStart[1] * b[1] + dragStart[2] * b[2]));
  const ang = Math.acos(dotv) * 2; // 少し大きく回して、端まで行かなくても裏が見られるようにする
  if (Math.hypot(ax, ay, az) < 1e-7) return;
  QUAT = qMul(qAxis(ax, ay, az, ang), dragQuat);
  syncRotation();
  needGem = true;
  lowQuality = true;
  schedule();
});
function endDrag(ev: PointerEvent) {
  if (!dragging) return;
  dragging = false;
  dragStart = null;
  try { cardEl.releasePointerCapture(ev.pointerId); } catch { /* 取れていなくてもよい */ }
  lowQuality = false;
  needGem = true;
  schedule();
}
cardEl.addEventListener("pointerup", endDrag);
cardEl.addEventListener("pointercancel", endDrag);

/* ---------------------------------------------------------------------------
 * 絵を描く
 * ------------------------------------------------------------------------ */
// willReadFrequently: この絵は確かめのたびに点を読み出される。
// 付けないと、読み出した瞬間に描き方の裏方が切り替わることがあり、
// まったく同じ指示で描いても、切り替わる前と後で絵がわずかに変わる。
// 下地やにじみは元から点の並びとして作っているので違いが出ないが、
// 光の点はその場で作る濃淡で描くので、この切り替わりを拾ってしまう
const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
let sprite: HTMLCanvasElement | null = null;
let needGem = true;
let lowQuality = false;
let queued = false;
let refineTimer = 0;
let lastMs = 0;
let lastPx = 0;
let layerMs = 0;
let layerCv: HTMLCanvasElement | null = null;
let ready = false;

function fitHalf(): number {
  return gemBoundRadius() / GEM_FIT;
}

function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    draw();
  });
  // 手が止まったら、きれいに描き直す
  window.clearTimeout(refineTimer);
  refineTimer = window.setTimeout(() => {
    if (dragging) return;
    lowQuality = false;
    needGem = true;
    draw();
    save();
  }, 220);
}

/** 石の絵の版。作り直すたびに増える。演出の控えを見分ける合言葉に使う */
let spriteGen = 0;

function drawGem() {
  const want = lowQuality
    ? Math.min(360, Math.max(96, Math.round(ST.gem.sizePx * 0.45)))
    : Math.min(860, Math.max(120, Math.round(ST.gem.sizePx)));
  const t0 = performance.now();
  const cv = renderGem({
    hex: ST.member.hex,
    px: want,
    rot: ([] as number[]).concat(...ST.rotation.rows),
    lights: ST.lights.map((l) => ({ dir: [l.dir[0], l.dir[1], l.dir[2]], intensity: l.intensity, radius: l.radius })) as StudioLight[],
    half: fitHalf(),
    superSample: lowQuality ? 1 : 2,
    sparkle: sparkleNow(),
  });
  lastMs = performance.now() - t0;
  lastPx = want;
  if (cv) sprite = cv;
  needGem = false;
  // 石の絵が作り直されるたびに1つ増やす番号。演出の控えはこの番号で見分ける。
  // 色や向きだけを合言葉にすると、光のつまみを動かしたときや、粗い絵ときれいな絵の
  // 間で、前の絵から拾った控えが残ってしまう
  spriteGen++;
}

/** 文字の箱を、実際の画面から測って返す。カードの中の座標に直す */
function textBoxes(): TextBox[] {
  const cardRect = cardEl.getBoundingClientRect();
  const k = cardRect.width / W || 1;
  const out: TextBox[] = [];
  for (const el of [textsEl.querySelector("h1"), textsEl.querySelector("p")]) {
    if (!el) continue;
    const r = (el as HTMLElement).getBoundingClientRect();
    const col = getComputedStyle(el as HTMLElement).color;
    const m = col.match(/\d+/g);
    const lum = m && m.length >= 3 ? relLuminance(Number(m[0]), Number(m[1]), Number(m[2])) : 0.5;
    out.push({
      x: (r.left - cardRect.left) / k,
      y: (r.top - cardRect.top) / k,
      w: r.width / k,
      h: r.height / k,
      lum,
    });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * 【作り物】きらめきの演出
 *   石の絵を描いたあとに足す後処理。3つとも切ると、足す前とまったく同じ絵になる。
 *   ・光の点   石の「まわりより鋭く明るい所」に、白い芯・柔らかいあふれ・短い筋
 *   ・面の色   面に元からある色合いのずれを広げる（石の絵そのものを差し替える）
 *   ・あふれ   小さくて明るい面にだけ、柔らかいあふれ
 * ------------------------------------------------------------------------ */

/** いま使う演出の決めごと。3つとも切っているときは、どの描き足しも通らない */
function fireNow(): FireSet {
  const f = ST.fire;
  const lv = FIRE_LEVELS.find((v) => v.key === f.level) ?? FIRE_LEVELS[1];
  return {
    glints: f.glints,
    around: f.glints && lv.around,
    bigCount: f.glints ? lv.big : 0,
    bigLen: lv.len,
    facetK: f.facet ? FACET_K : 0,
    facetBloom: f.bloom,
    gain: 1,
  };
}

/** 演出の控えを見分ける合言葉。石の絵が作り直されたら必ず変わる */
function fireKey(): string {
  return spriteGen + "|" + lastPx;
}

/** 文字の箱から離れるほど 1 へ戻る弱め。石のまわりに散らす点に掛けて、
 *  文字と背景の明るさの比を保つために使う */
function fireShield(): (px: number, py: number) => number {
  const boxes = textBoxes();
  const PAD = 16;
  const FALL = 190;
  return (px: number, py: number) => {
    let near = Infinity;
    for (const b of boxes) {
      const dx = Math.max(b.x - PAD - px, 0, px - (b.x + b.w + PAD));
      const dy = Math.max(b.y - PAD - py, 0, py - (b.y + b.h + PAD));
      const d = Math.hypot(dx, dy);
      if (d < near) near = d;
    }
    const u = Math.max(0, Math.min(1, near / FALL));
    return u * u * (3 - 2 * u);
  };
}

/** 拾った光の点。同じ石の絵なら拾い直さない */
let glintList: Glint[] = [];
let glintKey = "";
function currentGlints(): Glint[] {
  if (!sprite) return [];
  const key = fireKey();
  if (key !== glintKey) {
    glintList = findGlints(sprite, 20, 60, key);
    glintKey = key;
  }
  return glintList;
}

/** 石の絵の中の場所を、カードの上の場所へ置き直す */
function glintAt(q: { u: number; v: number }): { x: number; y: number } {
  const rad = (ST.roll2dDeg * Math.PI) / 180;
  const ca = Math.cos(rad), sa = Math.sin(rad);
  const size = ST.gem.sizePx;
  const lx = (q.u - 0.5) * size;
  const ly = (q.v - 0.5) * size;
  return { x: ST.gem.cx + lx * ca - ly * sa, y: ST.gem.cy + lx * sa + ly * ca };
}

/** 小さい点を何個まで置くか。
 *  白い石は元々明るいので、同じ数を置くと石の中が白く飛んでしまう。
 *  石が元々どれだけ明るいかから、置ける数を決める */
let smallLimitCache = { key: "", v: 40 };
function smallLimit(): number {
  if (!sprite) return 40;
  const key = fireKey();
  if (key === smallLimitCache.key) return smallLimitCache.v;
  const bf = brightFraction(sprite, key);
  // 明るい所が多い石ほど少なく。実測で白い石の白飛びが1割に収まる所に合わせた
  const v = Math.round(Math.max(10, Math.min(46, 46 - bf * 150)));
  smallLimitCache = { key, v };
  return v;
}

/** 大きい点どうしが近すぎないよう、明るい順に間を空けて選ぶ */
function pickBig(gl: Glint[], count: number): Glint[] {
  const out: Glint[] = [];
  const minD = ST.gem.sizePx * 0.26;
  for (const q of gl) {
    if (out.length >= count) break;
    const p1 = glintAt(q);
    let ok = true;
    for (const k of out) {
      const p2 = glintAt(k);
      if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < minD) { ok = false; break; }
    }
    if (ok) out.push(q);
  }
  return out;
}

/** その向きへ、文字の箱の手前までなら何px伸ばしてよいか。箱は型ごとに変わる */
function reachBeforeText(x: number, y: number): (ang: number) => number {
  const boxes = textBoxes();
  const PAD = 34;
  return (ang: number) => {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (let d = 0; d < 400; d += 8) {
      const px = x + dx * d;
      const py = y + dy * d;
      for (const b of boxes) {
        if (px > b.x - PAD && px < b.x + b.w + PAD && py > b.y - PAD && py < b.y + b.h + PAD) {
          return Math.max(0, d - 26);
        }
      }
    }
    return 400;
  };
}

/** 白く飛んだ小さな面にだけ、柔らかいあふれを足す。
 *  広い面は外してあるので、面がまるごと白い塊になることはない */
let facetBlobs: ReturnType<typeof findBrightFacets> = [];
let facetKey = "";
function drawFacetBloom(target: CanvasRenderingContext2D, gain: number) {
  if (!sprite) return;
  const key = fireKey();
  if (key !== facetKey) {
    // 明るい小さな面は数百個見つかることがある。全部に柔らかいあふれを描くと
    // 1枚に100ミリ秒ほど余計にかかるので、明るい順に上位だけにする
    const all = findBrightFacets(sprite, 340, key);
    all.sort((p1, p2) => p2.power * p2.r - p1.power * p1.r);
    facetBlobs = all.slice(0, 36);
    facetKey = key;
  }
  const size = ST.gem.sizePx;
  // 元々明るい石ほど弱める。石の明るさを測るのは重いので、輪の外で1度だけ
  const dim = smallLimit() / 46;
  target.save();
  target.globalCompositeOperation = "lighter";
  for (const b of facetBlobs) {
    const p1 = glintAt(b);
    const r = Math.max(9, b.r * size * 2.6);
    const a = Math.min(1, 0.3 * b.power * gain * dim);
    const g = target.createRadialGradient(p1.x, p1.y, 0, p1.x, p1.y, r);
    g.addColorStop(0, `rgba(255,255,255,${a.toFixed(4)})`);
    g.addColorStop(0.4, `rgba(255,255,255,${(a * 0.34).toFixed(4)})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    target.fillStyle = g;
    target.beginPath();
    target.arc(p1.x, p1.y, r, 0, Math.PI * 2);
    target.fill();
  }
  target.restore();
  target.globalAlpha = 1;
  target.globalCompositeOperation = "source-over";
}

/** 石の上の光の点。大きい点を少し、小さい点をたくさん */
function drawGlintsOnGem(target: CanvasRenderingContext2D, set: FireSet) {
  const gl = currentGlints();
  if (!gl.length) return;
  const body = splitColors(ST.member.hex, false);
  const surf = splitColors(ST.member.hex, true);
  // 石を通った光の芯は石の色。表面で跳ねた光の芯だけ白
  const core = bodyCore(ST.member.hex);
  const size = ST.gem.sizePx;
  const scale = size / 780;
  const top = gl[0].sharp || 1;
  const big = set.bigCount > 0 ? pickBig(gl, set.bigCount) : [];
  const bigSet = new Set(big);
  const smallMax = smallLimit();

  // 小さい点。大きいものに選ばれたものは外す
  let n = 0;
  for (const q of gl) {
    if (bigSet.has(q)) continue;
    if (n++ >= smallMax) break;
    const p1 = glintAt(q);
    const ang = Math.atan2(p1.y - ST.gem.cy, p1.x - ST.gem.cx);
    const power = Math.max(0.18, Math.min(1, q.sharp / top));
    drawGlint(target, p1.x, p1.y, ang, power, scale, q.surface ? surf : body, set.gain,
      q.surface ? [255, 255, 255] : core);
  }
  // 大きい点はあとから、上に重ねる。筋は文字の箱の手前で止める
  for (const q of big) {
    const p1 = glintAt(q);
    const ang = Math.atan2(p1.y - ST.gem.cy, p1.x - ST.gem.cx);
    const power = Math.max(0.3, Math.min(1, q.sharp / top));
    drawBigGlint(target, p1.x, p1.y, ang, power, size * set.bigLen,
      q.surface ? surf : body, set.gain, reachBeforeText(p1.x, p1.y),
      q.surface ? [255, 255, 255] : core);
  }
}

/** 石のまわりの空いた所にも、同じ作りの点を少し。文字の箱のまわりは弱める */
function drawGlintsAround(target: CanvasRenderingContext2D, gain: number) {
  const surf = splitColors(ST.member.hex, true);
  const body = splitColors(ST.member.hex, false);
  const shield = fireShield();
  const gemR = ST.gem.sizePx * 0.5;
  const pts = scatterAround(ST.gem.cx, ST.gem.cy, gemR, ST.glow.set.seed * 31 + 17, 44);
  let i = 0;
  for (const q of pts) {
    if (q.x < -40 || q.y < -40 || q.x > W + 40 || q.y > H + 40) continue;
    const k = shield(q.x, q.y);
    if (k <= 0.02) continue;
    const ang = Math.atan2(q.y - ST.gem.cy, q.x - ST.gem.cx);
    // 3つに1つは表面で跳ねた光＝全色
    drawGlint(target, q.x, q.y, ang, q.power * 1.9, q.scale * 1.25, (i++ % 3 === 0) ? surf : body, gain * k);
  }
}

/* ---------------------------------------------------------------------------
 * 3つの層
 *   背景（下地＋にじみ）／ 石 ／ 光（光の筋と光の粒）。文字はいつも一番上。
 *
 *   にじみと光の筋は、画面の色のまま重ねているのではなく、光の量そのものの上で
 *   混ぜてから画面の色へ戻している。だから光の筋だけを別に塗って普通に重ねても
 *   同じ絵にはならない。
 *   そこで「下地＋にじみ」で混ぜた絵と「下地＋にじみ＋光の筋」で混ぜた絵の
 *   2通りを作り、3層とも入のときは後者をそのまま出す。
 *   光の層だけを取り出すときは、その2枚の差として作る（足し算で重ねる層）。
 * ------------------------------------------------------------------------ */
let bgCv: HTMLCanvasElement | null = null;
const layerBg = document.createElement("canvas");
const layerGem = document.createElement("canvas");
const layerLight = document.createElement("canvas");
for (const c of [layerBg, layerGem, layerLight]) {
  c.width = W;
  c.height = H;
}

/** 下地とにじみを、決めた場所で混ぜてから画面の色に戻して貼る */
function drawCorrectedLayer(blobs: BlobOut[]) {
  const space = ST.auto.space as Space;
  const layerBlobs: LayerBlob[] = blobs.map((b) => ({
    x: b.x,
    y: b.y,
    radius: b.radius,
    alpha: b.alpha,
    linear: hexToLinear(rgbToHex(b.rgb)),
    rot: b.rot,
    aspect: b.aspect,
    edge: b.edge,
    facet: b.facet,
    ray: b.ray,
    width: b.width,
  }));
  // 静かなにじみと、石が投げる光のかけらは、別々の枠で決める。
  // 広く塗る背景の色と、石のすぐそばに落ちる小さな光は役目が違うので、
  // 同じ枠に入れるとかけらが上限をひとりで使い切って、にじみまで削れてしまう
  const hazeIdx: number[] = [];
  const shardIdx: number[] = [];
  blobs.forEach((b, i) => (b.shard ? shardIdx : hazeIdx).push(i));
  const haze = hazeIdx.map((i) => layerBlobs[i]);
  const fit = fitSetAmount(haze, space) * ST.glow.set.mul;
  for (const i of hazeIdx) {
    layerBlobs[i].alpha *= fit;
    blobs[i].alpha = Math.round(layerBlobs[i].alpha * 1e4) / 1e4;
  }
  const shards = shardIdx.map((i) => blobs[i]);
  const cfit = fitCaustics(shards, space) * ST.caustics.mul;
  for (const i of shardIdx) {
    layerBlobs[i].alpha *= cfit;
    blobs[i].alpha = Math.round(layerBlobs[i].alpha * 1e4) / 1e4;
  }
  ST.auto.sideFit = Math.round(fit * 1000) / 1000;
  ST.auto.causticFit = Math.round(cfit * 1000) / 1000;
  const res = buildLayer(layerBlobs, space, textBoxes(), true);
  ST.auto.minContrastBefore = Math.round(res.minBefore * 100) / 100;
  ST.auto.minContrastAfter = Math.round(res.minAfter * 100) / 100;
  ST.auto.capScale = Math.round(res.capScale * 1000) / 1000;
  ST.auto.capped = res.capped;
  ST.auto.shieldScale = Math.round(res.shieldScale * 1000) / 1000;
  ST.auto.shielded = res.shielded;

  // 同じ弱め方のまま、下地とにじみだけの絵をもう1枚作る。
  // 光の層は、この2枚の差として取り出す
  const resBg = buildLayer(haze, space, textBoxes(), false, { k: res.capScale, minM: res.shieldScale });
  layerMs = res.ms + resBg.ms;

  if (!layerCv) layerCv = document.createElement("canvas");
  if (layerCv.width !== res.lowW || layerCv.height !== res.lowH) {
    layerCv.width = res.lowW;
    layerCv.height = res.lowH;
  }
  layerCv.getContext("2d")!.putImageData(res.image, 0, 0);
  if (!bgCv) bgCv = document.createElement("canvas");
  if (bgCv.width !== resBg.lowW || bgCv.height !== resBg.lowH) {
    bgCv.width = resBg.lowW;
    bgCv.height = resBg.lowH;
  }
  bgCv.getContext("2d")!.putImageData(resBg.image, 0, 0);

  // 背景の層（取り出し用）
  const bgCtx = layerBg.getContext("2d")!;
  bgCtx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in bgCtx) bgCtx.imageSmoothingQuality = "high";
  bgCtx.clearRect(0, 0, W, H);
  bgCtx.drawImage(bgCv, 0, 0, W, H);

  // 光の層（取り出し用）。2枚の差を黒の上に置く。足し算で重ねる層
  const diff = new ImageData(res.lowW, res.lowH);
  const a = res.image.data;
  const b2 = resBg.image.data;
  for (let i = 0; i < a.length; i += 4) {
    diff.data[i] = Math.max(0, a[i] - b2[i]);
    diff.data[i + 1] = Math.max(0, a[i + 1] - b2[i + 1]);
    diff.data[i + 2] = Math.max(0, a[i + 2] - b2[i + 2]);
    diff.data[i + 3] = 255;
  }
  const tmp = document.createElement("canvas");
  tmp.width = res.lowW;
  tmp.height = res.lowH;
  tmp.getContext("2d")!.putImageData(diff, 0, 0);
  const liCtx = layerLight.getContext("2d")!;
  liCtx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in liCtx) liCtx.imageSmoothingQuality = "high";
  liCtx.setTransform(1, 0, 0, 1, 0, 0);
  liCtx.globalCompositeOperation = "source-over";
  liCtx.fillStyle = "#000";
  liCtx.fillRect(0, 0, W, H);
  liCtx.drawImage(tmp, 0, 0, W, H);
  drawDots(liCtx);

  // 画面に出す絵。3層とも入のときは、分ける前とまったく同じ1枚をそのまま貼る
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
  if (ST.layers.bg && ST.layers.light) {
    ctx.drawImage(layerCv, 0, 0, W, H);
  } else if (ST.layers.bg) {
    ctx.drawImage(bgCv, 0, 0, W, H);
  } else {
    // 背景を切るときは黒で塗りつぶす。
    // canvas を透かすと、カードの CSS 側に敷いてある同じ下地が出てきてしまい、
    // 「背景を切った」ことにならない。取り出し口は canvas しか渡さないので、
    // canvas だけで完結する黒塗りにしている
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    if (ST.layers.light) {
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(tmp, 0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
    }
  }
  ctx.restore();
}

/** 光の粒を、渡された絵に描く。光の層の仲間 */
function drawDots(target: CanvasRenderingContext2D) {
  if (!ST.dots.on || ST.dots.count <= 0) return;
  const rgb = hexToRgb(ST.member.hex);
  const r2 = makeRng(ST.dots.seed);
  const hr = ST.gem.sizePx * 0.42;
  target.save();
  target.globalAlpha = 1;
  for (let i = 0; i < ST.dots.count; i++) {
    const ang = Math.PI * (0.85 + r2() * 0.55);
    const dist = hr + 30 + r2() * 260;
    const x = ST.gem.cx + Math.cos(ang) * dist;
    const y = ST.gem.cy + Math.sin(ang) * dist;
    const d = 2 + r2() * 2;
    const white = r2() < 0.5;
    const al = 0.35 + r2() * 0.5;
    if (x < 0 || y < 0 || x > W || y > H) continue;
    target.fillStyle = white ? `rgba(255,255,255,${al})` : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${al})`;
    target.beginPath();
    target.arc(x, y, d / 2, 0, Math.PI * 2);
    target.fill();
  }
  target.restore();
}

function blob(x: number, y: number, r: number, c: readonly number[], a: number) {
  if (a <= 0 || r <= 0) return;
  const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
  rg.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${a})`);
  rg.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
  ctx.fillStyle = rg;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function draw() {
  if (!ready) return;
  if (needGem) drawGem();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, W, H);

  const comp = compColor(ST.member.hex, ST.glow.method);
  ST.glow.blobs = allBlobs();
  if (ST.auto.on) {
    drawCorrectedLayer(ST.glow.blobs);
  } else {
    layerMs = 0;
    ST.auto.minContrastBefore = 0;
    ST.auto.minContrastAfter = 0;
    ST.auto.capScale = 1;
    ST.auto.capped = false;
    ST.auto.shieldScale = 1;
    ST.auto.shielded = false;
    ST.auto.sideFit = 1;
    ST.auto.causticFit = 1;
    // 自動の補正を切っているときは、canvas の重ね塗りで描く。
    // 光の筋はこの塗り方では形を作れないので、根元に小さな丸を置くだけにする
    if (!ST.layers.bg) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
    }
    for (const b of ST.glow.blobs) {
      if (b.shard ? !ST.layers.light : !ST.layers.bg) continue;
      if (b.ray) blob(b.x, b.y, Math.max(6, (b.width ?? 6) * 2.5), b.rgb, b.alpha);
      else blob(b.x, b.y, b.radius, b.rgb, b.alpha);
    }
  }

  // 石の層。取り出せるように、別の1枚にも同じものを描いておく
  const gemCtx = layerGem.getContext("2d")!;
  gemCtx.setTransform(1, 0, 0, 1, 0, 0);
  gemCtx.clearRect(0, 0, W, H);
  const fire = fireNow();
  // 【作り物】面の虹色を濃くする。石の絵そのものを差し替えるので、これは石の層。
  // 切っているときは元の石の絵をそのまま使う
  const shown = (fire.facetK > 0 && sprite) ? boostFacetColor(sprite, fire.facetK, fireKey()) : sprite;
  if (sprite) {
    for (const c of [ctx, gemCtx]) {
      if (c === ctx && !ST.layers.gem) continue;
      c.save();
      c.globalAlpha = ST.gem.alpha;
      c.translate(ST.gem.cx, ST.gem.cy);
      c.rotate((ST.roll2dDeg * Math.PI) / 180);
      c.drawImage(shown!, -ST.gem.sizePx / 2, -ST.gem.sizePx / 2, ST.gem.sizePx, ST.gem.sizePx);
      c.restore();
    }
  }

  // 【作り物】光の点と、明るい面のあふれ。どちらも足し算で重ねる光なので、
  // 石の中に乗る分も含めて「光」の層にまとめている。
  // 取り出せるように、光の層の1枚にも同じものを描いておく
  if (sprite && (fire.facetBloom || fire.glints)) {
    const liCtx = layerLight.getContext("2d")!;
    liCtx.setTransform(1, 0, 0, 1, 0, 0);
    for (const c of [ctx, liCtx]) {
      if (c === ctx && !ST.layers.light) continue;
      if (fire.facetBloom) drawFacetBloom(c, fire.gain);
      if (fire.glints) drawGlintsOnGem(c, fire);
      if (fire.around) drawGlintsAround(c, fire.gain);
    }
  }

  // 光の粒は光の層の仲間。分ける前と同じ順（石のあと）で描く
  if (ST.layers.light) drawDots(ctx);
  ctx.globalAlpha = 1;

  compNote.textContent =
    "いまの反対の色: rgb(" + comp.join(", ") + ")" +
    (ST.glow.method === "invert" ? "（裏返し）" : "（色合いまわし）");
  statusEl.textContent =
    "石の絵の細かさ " + lastPx + "px" +
    (lowQuality ? "・動かしている間は粗く描いています" : "") +
    " ／ 描き直しにかけた時間 石 " + lastMs.toFixed(0) + "ミリ秒・背景の層 " + layerMs.toFixed(0) + "ミリ秒" +
    (ST.auto.on ? " ／ 文字と背景の明るさの比 " + ST.auto.minContrastAfter.toFixed(2) + " ／ 脇役の濃さ ×" + ST.auto.sideFit.toFixed(2) : "") +
    " ／ 合言葉 " + ST.member.id +
    (ST.auto.capped
      ? " ／ 文字が読める明るさで頭打ちにしています"
      : ST.auto.shielded
        ? " ／ 文字のまわりだけ弱めています"
        : "");
  seedEl.textContent = ST.shuffle.seed
    ? "いまの種 " + ST.shuffle.seed + " ／ 合計点 " + ST.shuffle.score.toFixed(3) +
      (shuffleMs ? " ／ シャッフル " + shuffleMs.toFixed(0) + "ミリ秒・" + shuffleTries + "回引いた" : "")
    : "";
  (window as unknown as Record<string, unknown>).__studioState = ST;
  (window as unknown as Record<string, unknown>).__studioShuffle = {
    once: () => doShuffle(),
    back: () => goBack(),
    trial: (seed: number, hex: string) => {
      const d = drawFromSeed(seed, ST.lights.map((l) => l.radius));
      const rows = quatToRows(d.quat);
      const cx = ST.shuffle.baseCx + d.dx;
      const cy = ST.shuffle.baseCy + d.dy;
      const hits = hitsText(rows, cx, cy, ST.gem.sizePx, d.roll2dDeg);
      const upside = culetPointsUp(rows, d.roll2dDeg);
      // 型2・型3は、尖りがカードから出る姿も出さない
      const culetOut = culetOutside(rows, cx, cy, ST.gem.sizePx, d.roll2dDeg);
      const img = renderForScore(hex, rows, d.lights, fitHalf(), sparkleNow());
      if (!img) return null;
      const m = measure(img, hex, 1, 2.2);
      if (!m) return null;
      m.culet = culetScore(rows);
      m.culetDown = Math.max(0, culetOnScreen(rows, d.roll2dDeg).down);
      const sc = scoreGem(img, hex, rows, d.roll2dDeg);
      return {
        seed, hits, upside, culetOut, raw: m,
        score: sc ? sc.score : 0,
        perCase: sc ? sc.perCase : [],
        rawCases: sc ? sc.cases : [],
      };
    },
    apply: (seed: number) => {
      const d = drawFromSeed(seed, ST.lights.map((l) => l.radius));
      applyDraw(d);
      const rows = quatToRows(d.quat);
      const img = renderForScore(ST.member.hex, rows, d.lights, fitHalf(), sparkleNow());
      const sc = img ? scoreGem(img, ST.member.hex, rows, d.roll2dDeg) : null;
      ST.shuffle.score = sc ? Math.round(sc.score * 1000) / 1000 : 0;
      syncAllControls();
      needGem = true;
      schedule();
    },
    amount: (mul: number) => {
      const bl: LayerBlob[] = ST.glow.blobs.map((b) => ({
        x: b.x, y: b.y, radius: b.radius, alpha: b.alpha, linear: hexToLinear(rgbToHex(b.rgb)),
      }));
      return sampleAmount(bl, ST.auto.on ? (ST.auto.space as Space) : "srgb", mul);
    },
    reference: () => referenceAmount(ST.auto.space as Space),
    readable: (hex: string) => minReadableL(hex, ST.auto.space as Space),
    /** 石の置き場所と大きさの候補を試す。画面は動かさない */
    probe: (cx: number, cy: number, size: number, seed: number, hex: string, withScore: boolean) => {
      if (!getVerts().length) setVerts(gemVertices());
      const d = drawFromSeed(seed, ST.lights.map((l) => l.radius));
      const rows = quatToRows(d.quat);
      const gx = cx + d.dx;
      const gy = cy + d.dy;
      const poly = gemOutline(getVerts(), rows, fitHalf(), gx, gy, size, d.roll2dDeg);
      // 「文字に被る」と「尖りが水平より上を向く」は別の話なので、別々に返す。
      // 置き場所を決める物差しは文字に被るかどうかだけで見る
      const upside = culetPointsUp(rows, d.roll2dDeg);
      let onText = false;
      for (const b of textBoxes()) if (outlineHitsBox(poly, b.x, b.y, b.w, b.h)) { onText = true; break; }
      const hits = upside || onText;
      const whole = polyArea(poly);
      const inside = polyArea(clipToRect(poly, W, H));
      const visible = whole > 0 ? inside / whole : 0;
      let score = -1;
      if (withScore && !hits) {
        const img = renderForScore(hex, rows, d.lights, fitHalf(), sparkleNow());
        const sc = img ? scoreGem(img, hex, rows) : null;
        score = sc ? sc.score : -1;
      }
      // 見る向きの区分け。石の軸と見る向きの角度で分ける
      const theta = (Math.acos(Math.max(-1, Math.min(1, rows[7]))) * 180) / Math.PI;
      // 影の四隅と、底の尖りが画面のどこに来るか。
      // 型2で「尖りを切らない」を測るために返す
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of poly) {
        if (q[0] < x0) x0 = q[0];
        if (q[0] > x1) x1 = q[0];
        if (q[1] < y0) y0 = q[1];
        if (q[1] > y1) y1 = q[1];
      }
      const cp = culetPoint(rows, fitHalf(), gx, gy, size, d.roll2dDeg);
      return { seed, hits, onText, upside, visible, score, theta, bbox: [x0, y0, x1, y1], culetPt: cp, whole, inside };
    },
    culet: (rows: number[], roll: number) => culetOnScreen(rows, roll),
    calibrate: setCalibration,
    marks: () => ({ breaks: BREAKS, weights: WEIGHTS, pass: PASS_MARK }),
  };
  (window as unknown as Record<string, unknown>).__studioColor = {
    lift: (hex: string, targetL: number, cuspToward: boolean) => {
      const f = liftToTargetL(hex, targetL, cuspToward);
      return { rgb: f.rgb255, lch: f.lch, before: f.before };
    },
    lum: (r: number, g: number, b: number) => relLuminance(r, g, b),
    lchOfHex: (hex: string): Lch => labToLch(linearToOklab(hexToLinear(hex))),
  };
  // 層ごとに撮れるようにする口。画面には出していない。
  // light は「足し算で重ねる層」で、黒の上に置いてある
  (window as unknown as Record<string, unknown>).__studioLayers = {
    bg: layerBg,
    gem: layerGem,
    light: layerLight,
  };
  (window as unknown as Record<string, unknown>).__studioGem = {
    /** いま画面に出している石の絵と、「演出を何も渡さない道」で描いた絵の差。
     *  演出を切っているときは、この差が0でなければならない */
    diffPlain: () => {
      if (!sprite) return null;
      const cv = renderGem({
        hex: ST.member.hex,
        px: lastPx,
        rot: ([] as number[]).concat(...ST.rotation.rows),
        lights: ST.lights.map((l) => ({ dir: [l.dir[0], l.dir[1], l.dir[2]], intensity: l.intensity, radius: l.radius })) as StudioLight[],
        half: fitHalf(),
        superSample: lowQuality ? 1 : 2,
      });
      if (!cv) return null;
      const a = sprite.getContext("2d")!.getImageData(0, 0, sprite.width, sprite.height).data;
      const b2 = cv.getContext("2d")!.getImageData(0, 0, cv.width, cv.height).data;
      if (a.length !== b2.length) return { px: lastPx, max: 255, mean: 255, n: 0 };
      let max = 0, sum = 0, n = 0;
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b2[i]);
        if (d > max) max = d;
        sum += d;
        if (i % 4 === 3 && a[i] > 8) n++;
      }
      return { px: lastPx, max, mean: sum / a.length, n };
    },
  };
  (window as unknown as Record<string, unknown>).__studioLayout = {
    set: (key: string) => applyLayout(key),
    now: () => ST.layout,
    list: () => LAYOUTS.map((l) => ({ key: l.key, gem: l.gem, amountArea: l.amountArea })),
    /** 型を切り替えずに、その型の文字の置き方だけを当てて試すための口。
     *  置き場所を測るときに使う */
    tryText: (key: string) => {
      const d = LAYOUT_BY_KEY.get(key);
      if (!d) return false;
      const t = d.text;
      textsEl.style.justifyContent = t.justify;
      textsEl.style.alignItems = t.align;
      textsEl.style.textAlign = t.textAlign;
      textsEl.style.paddingLeft = t.padLeft + "px";
      textsEl.style.paddingRight = t.padRight + "px";
      textsEl.style.paddingTop = t.padTop + "px";
      textsEl.style.paddingBottom = t.padBottom + "px";
      return true;
    },
    boxes: () => textBoxes(),
    /** いま画面に出ている石が、文字の箱に掛かっているか。
     *  種からではなく、いまの向き・いまの置き場所で見る */
    gemOnText: () => hitsText(
      ([] as number[]).concat(...ST.rotation.rows),
      ST.gem.cx, ST.gem.cy, ST.gem.sizePx, ST.roll2dDeg
    ),
    /** いまの姿が、いまの型の判定に通っているか */
    poseOk: () => poseFitsLayout(
      ([] as number[]).concat(...ST.rotation.rows),
      ST.gem.cx, ST.gem.cy, ST.gem.sizePx, ST.roll2dDeg
    ),
    /** いまの向きが、別の型に替えたときに通るかどうかを、替えずに調べる */
    poseOkIn: (key: string) => {
      const d = LAYOUT_BY_KEY.get(key);
      if (!d) return false;
      const was = ST.layout;
      ST.layout = key;
      applyLayoutText();
      const rows = ([] as number[]).concat(...ST.rotation.rows);
      const ok = poseFitsLayout(rows, d.gem.cx, d.gem.cy, d.gem.sizePx, ST.roll2dDeg);
      ST.layout = was;
      applyLayoutText();
      return ok;
    },
    /** その型の「石の無い側」で、にじみの浮き方を測る。
     *  hazeOnly を真にすると、静かなにじみだけを見る（光の筋は別枠なので外す） */
    amount: (mul: number, hazeOnly?: boolean) => {
      const src = hazeOnly ? ST.glow.blobs.filter((b) => !b.shard) : ST.glow.blobs;
      const bl: LayerBlob[] = src.map((b) => ({
        x: b.x, y: b.y, radius: b.radius, alpha: b.alpha, linear: hexToLinear(rgbToHex(b.rgb)),
        rot: b.rot, aspect: b.aspect, edge: b.edge, facet: b.facet, ray: b.ray, width: b.width,
      }));
      return sampleAmount(bl, ST.auto.on ? (ST.auto.space as Space) : "srgb", mul, layoutDef().amountArea);
    },
  };
  // 【確かめ用】演出まわりを外から測るための口
  (window as unknown as Record<string, unknown>).__studioFire = {
    now: () => ({ ...ST.fire, set: fireNow() }),
    set: (v: Partial<Setting["fire"]>) => {
      ST.fire = { ...ST.fire, ...v };
      syncAllControls();
      draw();
      return ST.fire;
    },
    off: () => {
      ST.fire = { glints: false, level: ST.fire.level, facet: false, bloom: false };
      syncAllControls();
      draw();
      return ST.fire;
    },
    /** 色を広げたときの控え。虹に見える面の量と、かかった時間 */
    boost: () => boostInfo(),
    /** 色を広げる処理を、毎回まるごと作り直させて1回ぶんの時間を返す */
    timeBoost: (k = FACET_K) => {
      if (!sprite) return null;
      boostFacetColor(sprite, k, "measure-" + Math.random());
      return boostInfo().ms;
    },
    /** 拾った光の点そのもの。場所・鋭さ・表面で跳ねた光かどうか */
    glintList: () => currentGlints().map((q) => ({ u: q.u, v: q.v, sharp: q.sharp, surface: q.surface })),
    /** 拾えた光の点の数と、置いている小さい点の上限 */
    glints: () => {
      const gl = currentGlints();
      return {
        count: gl.length,
        surface: gl.filter((g2) => g2.surface).length,
        smallMax: smallLimit(),
        bright: sprite ? brightFraction(sprite, fireKey()) : 0,
      };
    },
    /** 石の絵はそのままで、カード1枚を描き直す時間。つまみを動かした時の重さ */
    drawMs: (times = 9) => {
      const all: number[] = [];
      for (let i = 0; i < times; i++) {
        const t0 = performance.now();
        draw();
        all.push(performance.now() - t0);
      }
      all.sort((a, b) => a - b);
      return { total: all[all.length >> 1], px: lastPx };
    },
    /** 石から描き直して、カード1枚ができるまでの時間。向きを変えた時の重さ */
    fullMs: (times = 7) => {
      const all: number[] = [];
      for (let i = 0; i < times; i++) {
        needGem = true;
        const t0 = performance.now();
        draw();
        all.push(performance.now() - t0);
      }
      all.sort((a, b) => a - b);
      return { total: all[all.length >> 1], gem: lastMs, px: lastPx };
    },
    /** 石の絵の「その色だと分かるか」の点数。採点と同じ測り方 */
    identity: () => {
      const src = (ST.fire.facet && sprite) ? boostFacetColor(sprite, FACET_K, fireKey()) : sprite;
      if (!src) return 0;
      const c = document.createElement("canvas");
      c.width = 96;
      c.height = 96;
      const x = c.getContext("2d")!;
      x.drawImage(src, 0, 0, 96, 96);
      const m = measure(x.getImageData(0, 0, 96, 96), ST.member.hex, 1, 2.2);
      return m ? m.identity : 0;
    },
  };
  (window as unknown as Record<string, unknown>).__studioExport = exportJson;
  (window as unknown as Record<string, unknown>).__studioImport = (t: string) => importJson(JSON.parse(t));
}

/* ---------------------------------------------------------------------------
 * 画面の幅に合わせてカードを縮める
 * ------------------------------------------------------------------------ */
function fitCard() {
  const w = cardBox.clientWidth;
  if (!w) return;
  const k = w / W;
  cardEl.style.transform = `scale(${k})`;
  cardBox.style.height = H * k + "px";
  fitSticky();
}

/** タブの列は、留めたカードのすぐ下に留める。
 *  カードの高さは画面の幅で変わるので、測って入れ直す。
 *  2列のときはカードと操作盤が横に並ぶので、列は自分の欄の上に留めればよい */
function fitSticky() {
  const oneCol = window.matchMedia("(max-width: 1000px)").matches;
  const h = oneCol ? Math.round(leftEl.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty("--gs-lefth", h + "px");
}
if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(fitCard).observe(cardBox);
  new ResizeObserver(fitSticky).observe(leftEl);
}
window.addEventListener("resize", fitCard);
fitCard();

/* ---------------------------------------------------------------------------
 * はじめる
 * ------------------------------------------------------------------------ */
const saved = load();
if (saved) {
  try {
    importJson(saved);
  } catch {
    /* 覚えていた中身が古ければ、初期値のまま進む */
  }
}
syncAllControls();
ta.value = exportJson();

// 最後に開いていたタブを思い出す。覚えられない端末では最初のタブで始まる
let firstTab = TABS[0].key;
try {
  const t = localStorage.getItem(TAB_KEY);
  if (t && tabBody.has(t)) firstTab = t;
} catch {
  /* 思い出せなくても最初のタブで動く */
}
showTab(firstTab, false);

if (!prepareGemRenderer()) {
  statusEl.textContent = "この端末では石を描く用意ができませんでした。";
  (window as unknown as Record<string, unknown>).__studioError = "renderer-unavailable";
} else {
  ready = true;
  needGem = true;
  draw();
  (window as unknown as Record<string, unknown>).__studioReady = true;
}
