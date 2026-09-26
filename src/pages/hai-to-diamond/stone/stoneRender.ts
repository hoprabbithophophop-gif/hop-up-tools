// 灰toダイヤモンド「原石の版」— 石を Canvas 2D に描く。
//
// 形（頂点の位置）は stoneGeometry.ts が作り、面ごとの状態（削れ具合・色・輝き・自分の印・透明）は器が持つ。
// ここはそれを受け取って描くだけ。光を放つ演出（大サビ）は粒の部品が描くので、ここでは描かない。
//
// 描き方:
//   1. 見る向きへ回す … 縦の軸まわり(rotY) → 手前へ倒す(rotX・上面が見えるように) → 弱い遠近（奥 0.85倍〜手前 1.15倍）
//      尖りは必ず下。rotX はこのファイルの中で 0〜MAX_TILT に押さえ込むので、裏返った姿勢は呼ぶ側が何を渡しても通らない
//   2. 画家の描き方 … 面を奥から順に塗り、手前の面で上書きする。こちらを向いていない面は捨てる
//      （透明のときだけ、奥の面を先に薄く描いてから表の面を描く＝ガラス越しに奥が透ける）
//   3. 面の色 … 原石は灰色の陰影、削れかけは灰色→磨いた明るい灰色＋縁のひび、削れた面は人の色（無ければ磨いた灰色）
//
// 重さ対策: 57〜74面を毎コマ描く。作業用の配列は形ごとに一度だけ作って使い回す。
// 放射状のグラデーション（createRadialGradient）は1枚も作らない。虹色の分散だけ、1コマに直線のグラデーションを最大3つ作る。
import type { StoneMesh, FaceState, StoneView, Rect, Vec3, RGB } from "./stoneTypes";
import { faceCenter } from "./stoneGeometry";

export interface StoneDrawOpts {
  /** いまの時刻(ms)。ひびと透明な面のきらめきの揺らぎに使う */
  now: number;
  /** 動きを減らす設定。true なら時刻による揺らぎ（ひびの明滅・きらめきの瞬き）を止める【仮】 */
  reduceMotion: boolean;
  /** 光の向き（正規化済み）。見る人から見た向き（画面の右が +x・上が +y・手前が +z）【仮】。
   *  石が回ると、光を返す面が次々に入れ替わる（＝回転で面ごとにきらめきが移る） */
  light: [number, number, number];
  /** 動画の矩形。ここには何も描かない（YouTube API 規約。クリップで除外） */
  clip?: Rect;
}

// ─── 見た目の値【仮】（実機で見て決める）──────────────
/** 手前へ倒す角の上限(rad)。π/2 で真上から見下ろす。これ以上は倒さない＝尖りが上を向く姿勢は通さない */
const MAX_TILT = 1.2;
/** 遠近の強さ。奥行き ±roughRadius で 1∓PERSP 倍 */
const PERSP = 0.15;
const ROUGH_GRAY: RGB = [106, 109, 115];   // 原石の灰色（#6a6d73）
const POLISH_GRAY: RGB = [185, 188, 196];  // 磨いた明るい灰色（#b9bcc4）
const ROUGH_VARIATION = 0.12;              // 原石の面ごとの明るさのばらつき（±）。ゴツゴツ感のため
const SPEC_POWER = 28;                     // 鏡面ハイライトの鋭さ（大きいほど小さく鋭い）
const CRACK_PEAK: [number, number] = [0.05, 0.4]; // ひびが最も見える削れ具合の範囲（依頼文の指定）
const CLEAR_FILL: [number, number] = [0.06, 0.18]; // 透明な面の不透明度の幅（依頼文の指定）

// ─── 作業用の配列（形ごとに一度だけ作る）──────────────
interface Scratch {
  /** 回した後の頂点（遠近をかける前・模型の単位） */
  rx: Float32Array; ry: Float32Array; rz: Float32Array;
  /** 画面上の頂点(px) */
  sx: Float32Array; sy: Float32Array;
  /** 面ごと: 奥行き（手前が大きい）・こちらを向いているか・回した後の法線 */
  depth: Float32Array; front: Uint8Array;
  /** 面ごと: 面を扇形に三角へ分けた時、こちらを向いている三角の印（1ビット＝1枚）と、全部の三角の印。
   *  原石の面は平らとは限らない。多角形のまま塗ると本当の表面と塗る範囲がずれ、縁に細い線が飛び出す（2回目の見本で確認）。
   *  三角ごとに向きを見て、こちらを向いている三角だけ塗ると、閉じた形の輪郭とぴったり合う */
  tri: Uint8Array; full: Uint8Array;
  nx: Float32Array; ny: Float32Array; nz: Float32Array;
  /** 面の番号を描く順に並べる箱 */
  order: number[];
  /** 面ごとの固定の明るさのばらつき（原石のゴツゴツ感） */
  jitter: Float32Array;
}
const scratchCache = new WeakMap<StoneMesh, Scratch>();
function scratchOf(mesh: StoneMesh): Scratch {
  let s = scratchCache.get(mesh);
  if (s) return s;
  const nV = mesh.fine.length / 3, nF = mesh.faces.length;
  const jitter = new Float32Array(nF);
  for (let f = 0; f < nF; f++) jitter[f] = 1 + ROUGH_VARIATION * (hash01(f * 7919 + 17) * 2 - 1);
  s = {
    rx: new Float32Array(nV), ry: new Float32Array(nV), rz: new Float32Array(nV),
    sx: new Float32Array(nV), sy: new Float32Array(nV),
    depth: new Float32Array(nF), front: new Uint8Array(nF),
    tri: new Uint8Array(nF), full: new Uint8Array(mesh.faces.map((f) => (1 << (f.verts.length - 2)) - 1)),
    nx: new Float32Array(nF), ny: new Float32Array(nF), nz: new Float32Array(nF),
    order: Array.from({ length: nF }, (_, i) => i),
    jitter,
  };
  scratchCache.set(mesh, s);
  return s;
}
/** 整数から 0..1 の決まった値（面ごとの固定のばらつき用） */
function hash01(n: number): number {
  let t = (n + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// 並べ替えの比べ方は1つだけ作って使い回す（毎コマ関数を作らない）
let sortDepth: Float32Array = new Float32Array(0);
const byDepth = (a: number, b: number) => sortDepth[a] - sortDepth[b];

/** 頂点を回して画面へ写し、面ごとの奥行き・向き・法線を scratch に入れる */
function project(mesh: StoneMesh, verts: Float32Array, view: StoneView, s: Scratch): void {
  const tilt = clamp(view.rotX, 0, MAX_TILT);
  const cyw = Math.cos(view.rotY), syw = Math.sin(view.rotY);
  const cxw = Math.cos(tilt), sxw = Math.sin(tilt);
  const b = view.bulge > 0 ? view.bulge : 1;
  const R = mesh.roughRadius || 1;
  const nV = verts.length / 3;
  for (let v = 0; v < nV; v++) {
    const x = verts[v * 3], y = verts[v * 3 + 1], z = verts[v * 3 + 2];
    // 縦の軸まわり
    const x1 = x * cyw + z * syw;
    const z1 = -x * syw + z * cyw;
    // 手前へ倒す（上面の +y が手前 +z へ傾く）
    const y2 = y * cxw - z1 * sxw;
    const z2 = y * sxw + z1 * cxw;
    s.rx[v] = x1; s.ry[v] = y2; s.rz[v] = z2;
    const p = 1 + (PERSP * z2) / R;
    s.sx[v] = view.cx + x1 * b * view.r * p;
    s.sy[v] = view.cy - y2 * b * view.r * p;
  }
  const faces = mesh.faces;
  for (let f = 0; f < faces.length; f++) {
    const vs = faces[f].verts;
    let z = 0, nx = 0, ny = 0, nz = 0, mask = 0;
    // 扇形の三角ごとの、画面上の符号付き面積（画面は y が下向きなので、表から見て反時計回りの三角は負になる）
    const v0 = vs[0];
    for (let k = 0; k + 2 < vs.length; k++) {
      const b1 = vs[k + 1], b2 = vs[k + 2];
      const area = (s.sx[b1] - s.sx[v0]) * (s.sy[b2] - s.sy[v0]) - (s.sx[b2] - s.sx[v0]) * (s.sy[b1] - s.sy[v0]);
      if (area < 0) mask |= 1 << k;
    }
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i], c = vs[i + 1 === vs.length ? 0 : i + 1];
      z += s.rz[a];
      // 回した後の法線（Newell の方法）
      nx += (s.ry[a] - s.ry[c]) * (s.rz[a] + s.rz[c]);
      ny += (s.rz[a] - s.rz[c]) * (s.rx[a] + s.rx[c]);
      nz += (s.rx[a] - s.rx[c]) * (s.ry[a] + s.ry[c]);
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    s.depth[f] = z / vs.length;
    s.tri[f] = mask;
    s.front[f] = mask ? 1 : 0; // 描くのと同じ遠近で判定する（縁の面がちらつかないように）
    s.nx[f] = nx / l; s.ny[f] = ny / l; s.nz[f] = nz / l;
  }
}

/** 面の形の道筋を作る。mask は塗る三角の印（全部なら多角形のまま・一部なら三角を並べる） */
function tracePath(ctx: CanvasRenderingContext2D, vs: number[], s: Scratch, mask: number, full: number): void {
  ctx.beginPath();
  if (mask === full) {
    ctx.moveTo(s.sx[vs[0]], s.sy[vs[0]]);
    for (let i = 1; i < vs.length; i++) ctx.lineTo(s.sx[vs[i]], s.sy[vs[i]]);
    ctx.closePath();
    return;
  }
  const v0 = vs[0];
  for (let k = 0; k + 2 < vs.length; k++) {
    if (!(mask & (1 << k))) continue;
    ctx.moveTo(s.sx[v0], s.sy[v0]);
    ctx.lineTo(s.sx[vs[k + 1]], s.sy[vs[k + 1]]);
    ctx.lineTo(s.sx[vs[k + 2]], s.sy[vs[k + 2]]);
    ctx.closePath();
  }
}

/** 動画の矩形を除いた所だけに描けるようにする（呼んだら必ず restore） */
function beginClip(ctx: CanvasRenderingContext2D, clip?: Rect): void {
  ctx.save();
  if (!clip) return;
  ctx.beginPath();
  ctx.rect(-1e5, -1e5, 2e5, 2e5);
  ctx.rect(clip.x, clip.y, clip.w, clip.h);
  ctx.clip("evenodd");
}

/** 石を描く。verts は morphVertices 済みの頂点 */
export function drawStone(
  ctx: CanvasRenderingContext2D,
  mesh: StoneMesh,
  verts: Float32Array,
  state: FaceState,
  view: StoneView,
  opts: StoneDrawOpts,
): void {
  const s = scratchOf(mesh);
  project(mesh, verts, view, s);
  sortDepth = s.depth;
  s.order.sort(byDepth); // 奥（小さい）から手前へ

  const [lx, ly, lz] = opts.light;
  // 鏡面ハイライトの向き（光と視線のちょうど間）
  let hx = lx, hy = ly, hz = lz + 1;
  const hl = Math.hypot(hx, hy, hz) || 1;
  hx /= hl; hy /= hl; hz /= hl;
  const faces = mesh.faces;
  const t = opts.reduceMotion ? 0 : opts.now;
  const line = Math.max(1, view.r * 0.008);

  beginClip(ctx, opts.clip);
  ctx.lineJoin = "round";

  if (state.clear) {
    drawClear(ctx, mesh, state, view, s, opts, hx, hy, hz, t, line);
    ctx.restore();
    return;
  }

  for (const f of s.order) {
    if (!s.front[f]) continue;
    const vs = faces[f].verts;
    const cut = clamp(state.cut[f], 0, 1);
    const nx = s.nx[f], ny = s.ny[f], nz = s.nz[f];
    const lambert = Math.max(0, nx * lx + ny * ly + nz * lz);
    const spec = Math.pow(Math.max(0, nx * hx + ny * hy + nz * hz), SPEC_POWER);
    const color = state.color[f];
    let r: number, g: number, b: number;
    if (color && cut > 0) {
      // 人の色: 暗くしない・薄くしない。面ごとの陰影は光の当たる側をほんの少し（最大 12%）白へ寄せるだけ【仮】。
      // 白へ寄せすぎると赤が桃色に見える＝色が薄まる（1回目の見本で確認）。
      // 鏡のように光を返す向きの面だけ強く白く光らせる。削れかけでも当たった面は色で見せる【仮】
      const sharp = Math.pow(spec, 3);
      const w = Math.min(0.85, 0.12 * lambert * lambert + 0.8 * sharp);
      r = color[0] + (255 - color[0]) * w;
      g = color[1] + (255 - color[1]) * w;
      b = color[2] + (255 - color[2]) * w;
    } else {
      // 灰色: 原石(cut 0) → 磨いた灰色(cut 1)
      const k = smooth(cut);
      const roughShade = (0.5 + 0.7 * lambert) * s.jitter[f];
      const polishShade = 0.72 + 0.4 * lambert;
      const shade = roughShade + (polishShade - roughShade) * k;
      const w = spec * 0.85 * k; // 鏡面ハイライトは磨いた面だけ
      r = (ROUGH_GRAY[0] + (POLISH_GRAY[0] - ROUGH_GRAY[0]) * k) * shade;
      g = (ROUGH_GRAY[1] + (POLISH_GRAY[1] - ROUGH_GRAY[1]) * k) * shade;
      b = (ROUGH_GRAY[2] + (POLISH_GRAY[2] - ROUGH_GRAY[2]) * k) * shade;
      r += (255 - r) * w; g += (255 - g) * w; b += (255 - b) * w;
    }
    const fill = `rgb(${clampByte(r)},${clampByte(g)},${clampByte(b)})`;
    tracePath(ctx, vs, s, s.tri[f], s.full[f]);
    ctx.fillStyle = fill;
    ctx.fill();
    // 同じ色で縁をなぞり、隣の面との間に出る細い隙間（なめらか処理の継ぎ目）を埋める
    ctx.strokeStyle = fill;
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // ひび: 削れかけの面の縁に細い明るい線
    if (cut > 0 && cut < 1) {
      let a = crackAlpha(cut);
      if (t) a *= 0.8 + 0.2 * Math.sin(t * 0.006 + f * 1.7);
      if (a > 0.01) {
        ctx.strokeStyle = `rgba(255,255,255,${(a * 0.8).toFixed(3)})`;
        ctx.lineWidth = line;
        ctx.stroke();
      }
    } else if (cut >= 1) {
      // 削れた面の稜線をうっすら見せる（面の境目が分かると宝石らしく見える）【仮】
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = line * 0.8;
      ctx.stroke();
    }

    glowPass(ctx, state.glow[f]);
    if (state.own[f]) drawOwnMark(ctx, vs, s, view);
  }
  ctx.restore();
}

/** 透明になった石（完成・放った後）。面の色は残さない（自分の印だけ残す） */
function drawClear(
  ctx: CanvasRenderingContext2D,
  mesh: StoneMesh,
  state: FaceState,
  view: StoneView,
  s: Scratch,
  opts: StoneDrawOpts,
  hx: number, hy: number, hz: number,
  t: number,
  line: number,
): void {
  const faces = mesh.faces;
  const [lx, ly, lz] = opts.light;
  // 1. 奥の面（こちらを向いていない面）を先に薄く。ガラス越しに奥の稜線が透ける
  ctx.lineWidth = Math.max(0.75, line * 0.7);
  for (const f of s.order) {
    const back = s.full[f] & ~s.tri[f];
    if (!back) continue;
    tracePath(ctx, faces[f].verts, s, back, s.full[f]);
    ctx.fillStyle = "rgba(215,235,255,0.05)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.stroke();
  }
  // 虹色の分散を置く面: 光を斜めにはね返す向き（ハイライトとは別の向き）の面を上位3枚まで【仮】
  let f1 = -1, f2 = -1, f3 = -1, v1 = 0, v2 = 0, v3 = 0;
  let dx = -lx, dy = ly * 0.6 + 0.3, dz = 0.8;
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  for (const f of s.order) {
    if (!s.front[f]) continue;
    const v = Math.pow(Math.max(0, s.nx[f] * dx + s.ny[f] * dy + s.nz[f] * dz), 6);
    if (v > v1) { f3 = f2; v3 = v2; f2 = f1; v2 = v1; f1 = f; v1 = v; }
    else if (v > v2) { f3 = f2; v3 = v2; f2 = f; v2 = v; }
    else if (v > v3) { f3 = f; v3 = v; }
  }
  // 2. 表の面
  for (const f of s.order) {
    if (!s.front[f]) continue;
    const vs = faces[f].verts;
    const nx = s.nx[f], ny = s.ny[f], nz = s.nz[f];
    const lambert = Math.max(0, nx * lx + ny * ly + nz * lz);
    const a = CLEAR_FILL[0] + (CLEAR_FILL[1] - CLEAR_FILL[0]) * lambert;
    tracePath(ctx, vs, s, s.tri[f], s.full[f]);
    // 上を向く面ほど白、横・下を向く面ほど淡い水色
    const up = Math.max(0, ny);
    ctx.fillStyle = `rgba(${(215 + 40 * up) | 0},${(236 + 19 * up) | 0},255,${a.toFixed(3)})`;
    ctx.fill();
    // 光を返す向きの面だけ強い白。石が回ると返す面が入れ替わる
    let sp = Math.pow(Math.max(0, nx * hx + ny * hy + nz * hz), SPEC_POWER * 0.5);
    if (t) sp *= 0.85 + 0.15 * Math.sin(t * 0.011 + f * 2.3);
    if (sp > 0.3) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.92, ((sp - 0.3) / 0.7) * 1.1).toFixed(3)})`;
      ctx.fill();
    }
    if (f === f1 || f === f2 || f === f3) {
      const strength = f === f1 ? v1 : f === f2 ? v2 : v3;
      if (strength > 0.05) drawFire(ctx, vs, s, f, Math.min(1, strength * 1.4));
    }
    ctx.strokeStyle = "rgba(255,255,255,0.62)";
    ctx.lineWidth = line;
    ctx.stroke();
    glowPass(ctx, state.glow[f]);
    if (state.own[f]) drawOwnMark(ctx, vs, s, view);
  }
}

/** 虹色の分散: 面の上に、面を斜めに横切る細い虹のグラデーションを重ねる */
function drawFire(ctx: CanvasRenderingContext2D, vs: number[], s: Scratch, f: number, strength: number): void {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of vs) {
    if (s.sx[v] < minX) minX = s.sx[v]; if (s.sx[v] > maxX) maxX = s.sx[v];
    if (s.sy[v] < minY) minY = s.sy[v]; if (s.sy[v] > maxY) maxY = s.sy[v];
  }
  if (maxX - minX < 1 && maxY - minY < 1) return;
  // 虹の向きは面ごとに固定（同じ面なら毎コマ同じ向き）
  const ang = hash01(f * 131 + 7) * Math.PI;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const half = Math.max(maxX - minX, maxY - minY) / 2;
  const ux = Math.cos(ang) * half, uy = Math.sin(ang) * half;
  const gr = ctx.createLinearGradient(cx - ux, cy - uy, cx + ux, cy + uy);
  const al = (0.42 * strength).toFixed(3);
  gr.addColorStop(0, "rgba(255,60,60,0)");
  gr.addColorStop(0.2, `rgba(255,90,60,${al})`);
  gr.addColorStop(0.38, `rgba(255,220,60,${al})`);
  gr.addColorStop(0.55, `rgba(80,255,120,${al})`);
  gr.addColorStop(0.72, `rgba(60,170,255,${al})`);
  gr.addColorStop(0.88, `rgba(170,90,255,${al})`);
  gr.addColorStop(1, "rgba(170,90,255,0)");
  ctx.fillStyle = gr;
  ctx.fill(); // 呼ぶ前に tracePath 済みの面の形で塗る
}

/** 輝き: 面を白く光らせる（加算）。終わったら合成方法を必ず元に戻す */
function glowPass(ctx: CanvasRenderingContext2D, glow: number): void {
  if (!(glow > 0.01)) return;
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = `rgba(255,255,255,${(Math.min(1, glow) * 0.75).toFixed(3)})`;
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

/** 自分が染めた面の印: 面の中心に白い小さな点と細い輪。大きさは view.r に比例、輪の半径は最小 3px【仮】 */
function drawOwnMark(ctx: CanvasRenderingContext2D, vs: number[], s: Scratch, view: StoneView): void {
  let x = 0, y = 0;
  for (const v of vs) { x += s.sx[v]; y += s.sy[v]; }
  x /= vs.length; y /= vs.length;
  const ring = Math.max(3, view.r * 0.045);
  ctx.beginPath();
  ctx.arc(x, y, ring, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = Math.max(1, ring * 0.22);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1.2, ring * 0.38), 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
}

/** 頭サビ用: ダイヤの完成形（fine の頂点）を白い線と淡い面で描く。原石の上に低い alpha で重ねて「中から透ける」に使う */
export function drawStoneGhost(
  ctx: CanvasRenderingContext2D,
  mesh: StoneMesh,
  view: StoneView,
  alpha: number,
  opts: StoneDrawOpts,
): void {
  if (!(alpha > 0.001)) return;
  const s = scratchOf(mesh);
  project(mesh, mesh.fine, view, s);
  sortDepth = s.depth;
  s.order.sort(byDepth);
  beginClip(ctx, opts.clip);
  ctx.globalAlpha *= Math.min(1, alpha);
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, view.r * 0.007);
  const faces = mesh.faces;
  const [lx, ly, lz] = opts.light;
  for (const f of s.order) {
    if (!s.front[f]) continue;
    const lambert = Math.max(0, s.nx[f] * lx + s.ny[f] * ly + s.nz[f] * lz);
    tracePath(ctx, faces[f].verts, s, s.tri[f], s.full[f]);
    ctx.fillStyle = `rgba(235,245,255,${(0.08 + 0.14 * lambert).toFixed(3)})`;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.stroke();
  }
  ctx.restore();
}

/** 面の中心が画面のどこに写るか（💎の飛び先・光を放つ起点）。depth は面の中心の奥行きで手前が大きい（模型の単位）。
 *  front はその面がこちらを向いているか（pickTargetFace・drawStone と同じ判定＝扇形の三角のどれかが表向き）。
 *  depth は向きの判定には使えない（表向きの面でも中心が奥なら負になる） */
export function projectFaceCenter(
  mesh: StoneMesh,
  verts: Float32Array,
  f: number,
  view: StoneView,
  out: { x: number; y: number; depth: number; front: boolean },
): void {
  const tilt = clamp(view.rotX, 0, MAX_TILT);
  const cyw = Math.cos(view.rotY), syw = Math.sin(view.rotY);
  const cxw = Math.cos(tilt), sxw = Math.sin(tilt);
  const b = view.bulge > 0 ? view.bulge : 1;
  const R = mesh.roughRadius || 1;
  // 1点を画面へ写す（project() と同じ式）。結果は tmpPt に入る
  const put = (x: number, y: number, z: number) => {
    const x1 = x * cyw + z * syw;
    const z1 = -x * syw + z * cyw;
    const y2 = y * cxw - z1 * sxw;
    const z2 = y * sxw + z1 * cxw;
    const p = 1 + (PERSP * z2) / R;
    tmpPt.x = view.cx + x1 * b * view.r * p;
    tmpPt.y = view.cy - y2 * b * view.r * p;
    tmpPt.depth = z2;
  };
  const c = faceCenter(mesh, verts, f, tmpVec);
  put(c[0], c[1], c[2]);
  out.x = tmpPt.x; out.y = tmpPt.y; out.depth = tmpPt.depth;
  // 向き: この面の頂点だけを写し、扇形の三角のどれかが表向き（画面上の符号付き面積が負）なら表
  const vs = mesh.faces[f].verts;
  put(verts[vs[0] * 3], verts[vs[0] * 3 + 1], verts[vs[0] * 3 + 2]);
  const ax = tmpPt.x, ay = tmpPt.y;
  put(verts[vs[1] * 3], verts[vs[1] * 3 + 1], verts[vs[1] * 3 + 2]);
  let bx = tmpPt.x, by = tmpPt.y, front = false;
  for (let k = 2; k < vs.length && !front; k++) {
    put(verts[vs[k] * 3], verts[vs[k] * 3 + 1], verts[vs[k] * 3 + 2]);
    if ((bx - ax) * (tmpPt.y - ay) - (tmpPt.x - ax) * (by - ay) < 0) front = true;
    bx = tmpPt.x; by = tmpPt.y;
  }
  out.front = front;
}
const tmpVec: Vec3 = [0, 0, 0];
const tmpPt = { x: 0, y: 0, depth: 0 };

/** 💎を当てる面を選ぶ。こちらを向いていて、少しでも削れ始めた（cut>0.05）面から。
 *  prefer="uncolored" なら染まっていない面を優先し、無ければ輝きの低い面から選ぶ。候補が無ければ -1 */
export function pickTargetFace(
  mesh: StoneMesh,
  verts: Float32Array,
  state: FaceState,
  view: StoneView,
  prefer: "uncolored" | "any",
  rng: () => number,
): number {
  const s = scratchOf(mesh);
  project(mesh, verts, view, s);
  const nF = mesh.faces.length;
  let nCand = 0, nUncolored = 0, minGlow = Infinity;
  for (let f = 0; f < nF; f++) {
    if (!s.front[f] || !(state.cut[f] > 0.05)) continue;
    nCand++;
    if (!state.color[f]) nUncolored++;
    if (state.glow[f] < minGlow) minGlow = state.glow[f];
  }
  if (nCand === 0) return -1;
  // どの面を候補に数えるか: 染まっていない面 → 無ければ輝きが一番低い面の近く（+0.1 まで）【仮】 → prefer="any" なら全部
  const mode = prefer === "any" ? 0 : nUncolored > 0 ? 1 : 2;
  const ok = (f: number) =>
    s.front[f] === 1 && state.cut[f] > 0.05 &&
    (mode === 0 || (mode === 1 ? !state.color[f] : state.glow[f] <= minGlow + 0.1));
  let total = 0;
  for (let f = 0; f < nF; f++) if (ok(f)) total++;
  let pick = Math.min(total - 1, Math.floor(rng() * total));
  for (let f = 0; f < nF; f++) if (ok(f) && pick-- === 0) return f;
  return -1;
}

// ─── 小さな道具 ──────────────
function clamp(x: number, a: number, b: number): number { return x < a ? a : x > b ? b : x; }
function clampByte(x: number): number { return x < 0 ? 0 : x > 255 ? 255 : x | 0; }
function smooth(x: number): number { return x * x * (3 - 2 * x); }
/** ひびの見え方: 削れ始め（0→0.05）で現れ、0.05〜0.4 で最も見え、そこから削れ終わり（1）へ向けて消える */
function crackAlpha(cut: number): number {
  if (cut <= 0 || cut >= 1) return 0;
  if (cut < CRACK_PEAK[0]) return cut / CRACK_PEAK[0];
  if (cut <= CRACK_PEAK[1]) return 1;
  return (1 - cut) / (1 - CRACK_PEAK[1]);
}
