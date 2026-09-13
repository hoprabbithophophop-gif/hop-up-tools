// 球の後ろの壁に映る、色の付いた光の粒。拾い方と貼り方、着いたばかりの席の返事、囲いをここに集めた。
// DiamondCanvas.tsx から切り出しただけで、中身は変えていない。
import {
  type Ball, type BallView, BALL_HL_CUT, BALL_SEATS, BALL_TILE_MIN, LAND_FLASH_MS, devStats,
} from "./ball";
import { getStar, makeRadial, STAR_CORE } from "./sky";

const WALL_FRESH_MS = 500;       // 席が「着いたばかり」の印を持っている間の長さ。
                                 // 本番は毎秒およそ200個が着くので、印を持つ裏の席は常に50ほどに収まり、
                                 // くじで選ばれた粒と場所を取り合わずに共存する。
                                 // 3000 では印を持つ席だけで壁の上限を埋めてしまい、くじの粒が消えていた
const WALL_LAND_FLASH = 2.2;     // 着いた直後に、その席の壁の粒を何倍明るくするか

// 壁に映る光の粒（Hop決定 2026-09-08）。ここでいう「壁」は動画と額縁の外の画面全体。
// 壁に届く光は、こちらを向いている手前の面ではなく、球の向こう側＝奥の面が返したもの。
// 球が回ると奥の面は画面の上で手前の面と逆向きに動くので、壁の粒も手前の鏡とは逆向きに流れる
// （Hop指摘 2026-09-08。それまでは手前の鏡から粒を作っていたので同じ向きに流れていた）。
// 序盤は淡くまばら（球は動画の裏にいて、粒だけが「裏で何か光っている」手掛かり）、
// 終盤は数も大きさも濃さも増して、粒が小さな💎の輪郭を持ち始める。
// 以前あった「裏から漏れる放射状の筋」と「鏡からの筋」は、車輪の輻のように見えて
// 球の回転と結びつかなかったので、まるごとこの粒に置き換えた
// 粒の大きさは鏡の大きさに合わせる。球が寄れば粒も一緒に大きくなり、鏡1枚と粒1つが同じ物差しになる。
// 光源は3つ。2つ目と3つ目は1つ目の光を縦の軸まわりに振った向きで、鏡1枚が光源ごとに筋を返すので
// 壁の粒の数がほぼ3倍になる。球の鏡は密なのに壁の粒は小さくて少ない、という見え方への直し（Hop決定 2026-09-11 案3）
const WALL_SPOT_MAX = 300;       // 一度に壁へ映す粒の数の上限【仮】。光源3つぶんを含めた上限
const WALL_LIT_MIN = 0.15;       // 奥の鏡がこれ以上光を受けていないと壁に映らない【仮】。
                                 // 奥の鏡には「奥から当たる光」を当てて数える＝光の向きの奥行きだけ裏返し、
                                 // 手前の鏡と同じ考え方で「どれだけ光を返しているか」を測る。
                                 // 本物のミラーボールと同じで光の向きが回るため、壁の半分しか光らないのはそのままでよい（Hop決定 2026-09-08）。
                                 // ただし 0.3 だと粒が4個まで減る瞬間があって寂しかったので、光の当たる範囲を少し広げた
const WALL_LIT_EARLY = -0.5;     // 鏡がまだ少ない間の足切り【仮】。鏡が数十枚のうちは、光を受けている鏡のうち
                                 // さらに画面に収まる位置へ映るものがごく僅かで、粒が2個しか出ないことがあった（Hop報告 2026-09-08）。
                                 // 序盤だけ「うっすら光を受けている鏡」まで拾って、粒が6〜10個は壁に出るようにする
const WALL_LIT_RAMP = BALL_SEATS; // 鏡がこの枚数まで増えたら、足切りを通常の WALL_LIT_MIN へ戻しきる【仮】。
                                 // 席が満席になった所でちょうど通常に戻る
const WALL_FADE_BAND = 0.08;     // 足切りのすぐ上の粒は薄くする幅。ふっと現れ・ふっと消える【仮】
// 球の後ろに平らな壁がある部屋として粒を置く（Hop決定 2026-09-11 案1）。
// 以前は球の中心から鏡の向きへ一定の倍率で伸ばした所に置いていたが、
// それだと粒の並びが球をそのまま大きくした同心の形になり、奥に平らな壁があるようには見えなかった。
// 床は置かない。球は天井から吊るされているものなので、床が近くに見えると天井の低い部屋になってしまう
const ROOM_WALL = 1.4;           // 球の中心から奥の壁までの距離。球の半径を1とした値【仮】
const ROOM_CAM = 6.0;            // 球の中心からカメラまでの距離。同じ単位【仮】。
                                 // 球の中心の距離でちょうど等倍になるように写す。
                                 // 壁は球の中心より奥にあるので、粒はどれも一律に少しだけ縮んで見える
const WALL_STRETCH_MAX = 3;      // 浅い角度で当たった粒がどこまで伸びるかの上限【仮】
const WALL_TILE_MUL = 1.8;       // 粒の直径は、元になった鏡の短い方の辺の何倍か【仮】。
                                 // 粒の大きさを px で決め打ちせず鏡に合わせるので、カメラが寄って鏡が大きくなれば粒も一緒に大きくなる
const WALL_LIGHT_TURNS = [0, 2.2, -2.2];   // 光源の向き。1つ目が今までの光で、2つ目と3つ目は
                                 // それを縦の軸まわりにこれだけラジアンで回した向き【仮】
// 光源ごとの回し量の cos と sin。毎コマ数え直さないよう、ここで一度だけ表にしておく
const WALL_LIGHT_COS = WALL_LIGHT_TURNS.map((t) => Math.cos(t));
const WALL_LIGHT_SIN = WALL_LIGHT_TURNS.map((t) => Math.sin(t));
const WALL_A_MIN = 0.15;         // 粒の濃さ。序盤【仮】
const WALL_A_MAX = 0.35;         // 同上、終盤（主役は動画なので、これより濃くしない）【仮】
const WALL_FULL_AT = 0.945;      // 濃さが満開になる曲の進み。夜空へ放つ時刻（4:28.5 ÷ 4:44）に合わせてある【仮】
                                 // 以前は「曲の進み」と「球の大きさ」の2つで満開の度合いを決めていたが、
                                 // 球の見かけの大きさ（＝カメラの寄り）も曲の進みで決まるようになったので、二重に数えず進みだけで決める
const WALL_GEM_FROM = 0.8;       // 曲の進みがここを過ぎたら、粒の中心に鏡と同じ絵を薄く重ねて輪郭を出す【仮】
const WALL_GEM_FADE = 0.03;      // 同上の出はじめ。ここを過ぎた瞬間にぱっと現れないよう、この幅だけかけて濃くなる【仮】
const WALL_GEM_SCALE = 0.45;     // その絵の大きさ（粒の直径の何倍か）【仮】
const WALL_GEM_ALPHA = 0.6;      // 同上の濃さ（粒の濃さの何倍か）【仮】
const WALL_FLASH = 2.2;          // 奥の鏡がちょうど光を返す向きに来た瞬間、その粒を何倍明るくするか【仮】
// 夜空へ放つ瞬間、壁の粒（直径40px前後）はその場で星（2〜4px）になる。
// 入れ替わりが一瞬だと見た目が飛ぶので、粒が縮みながら星へ入れ替わる時間を挟む（Hop決定 2026-09-08）
const WALL_TO_STAR_MS = 300;     // 粒が縮んで星になるまで【仮】
const WALL_TO_STAR_CORE = 0.22;  // 粒の絵のうち「芯」に見える割合。縮み終わりの粒は 星の直径 ÷ この値 の大きさで貼る
                                 // ＝縮みきった時に、粒の芯の太さが星の点の太さとちょうどそろう【仮】

/** 壁に映る光の粒: 芯がぼんやり明るく、外へ向かって溶けていく丸。
 *  色ごとに一度だけ描いて、貼る時に大きさと濃さ（globalAlpha）を変える＝毎フレームの塗りは貼るだけ */
const WALL_PX = 64;
const wallSpotCache = new Map<number, HTMLCanvasElement>();
function getWallSpot(key: number, r: number, g: number, b: number): HTMLCanvasElement {
  let c = wallSpotCache.get(key);
  if (c) return c;
  c = makeRadial(WALL_PX, [
    [0, `rgba(${r},${g},${b},1)`],
    [0.22, `rgba(${r},${g},${b},0.72)`],
    [0.55, `rgba(${r},${g},${b},0.22)`],
    [1, `rgba(${r},${g},${b},0)`],
  ]);
  wallSpotCache.set(key, c);
  return c;
}

// ── 壁に映る粒 ───────────────────────────────────────────────
/** いま壁に映っている粒の控え。毎コマ作り直さず、n を 0 に戻して詰め直すだけ */
export type WallBuf = {
  x: Float32Array; y: Float32Array; c: Uint8Array; w: Float32Array;
  ex: Float32Array; ey: Float32Array; ang: Float32Array; d: Float32Array;
  p: (HTMLCanvasElement | null)[]; n: number;
};
/** そのコマの球の見え方と光の向き。粒を拾う関数へ毎回渡す */
export type WallView = {
  cx: number; cy: number; r: number; W: number; H: number;
  Lx: number; Ly: number; Lz: number;
  cut: number; flash: boolean;
};
/** 奥の鏡が、li 番目の光源からどれだけ光を受けているか（0〜1）。
 *  光の向きを縦の軸まわりに回して光源の向きを作り、光の向きの奥行きだけ裏返して測る */
function wallLightDot(li: number, x1: number, y2: number, z2: number, Lx: number, Ly: number, Lz: number): number {
  const lc = WALL_LIGHT_COS[li], ls = WALL_LIGHT_SIN[li];
  return x1 * (Lx * lc + Lz * ls) + y2 * Ly - z2 * (-Lx * ls + Lz * lc);
}
/** 奥側の鏡1枚が li 番目の光源から返した筋を、球の後ろの平らな壁へ映して控える。映せたら true。
 *  force は「着いたばかりの席」で、光の受け方が足切りに届かなくても1つ映す時に立てる。
 *  boost は着いた直後だけ明るくする倍率（通常は1） */
function takeWallSpot(
  buf: WallBuf, view: WallView, ball: Ball, slot: number,
  x1: number, y2: number, z2: number, li: number, dia: number, boost: number, force: boolean,
): boolean {
  if (buf.n >= WALL_SPOT_MAX) return false;
  const db = wallLightDot(li, x1, y2, z2, view.Lx, view.Ly, view.Lz);
  if (!force && !(db > view.cut)) return false;
  const lc = WALL_LIGHT_COS[li], ls = WALL_LIGHT_SIN[li];
  const Lx2 = view.Lx * lc + view.Lz * ls, Ly2 = view.Ly, Lz2 = -view.Lx * ls + view.Lz * lc;
  // 奥から当たってくる光の向き。db と同じで、光の向きの奥行きだけ裏返してある
  const ix = -Lx2, iy = -Ly2, iz = Lz2;
  // 鏡が返した筋の向き。入ってきた光を鏡の面で折り返したもの
  const dot = ix * x1 + iy * y2 + iz * z2;
  const rx = ix - 2 * dot * x1, ry = iy - 2 * dot * y2, rz = iz - 2 * dot * z2;
  // 奥へ向かっていない筋は壁に届かないので、この光源ぶんは粒にしない
  if (rz >= -1e-4) return false;
  // 鏡の位置から壁までどれだけ筋を伸ばせば当たるか。長さは球の半径を1として数える
  const hitT = (-ROOM_WALL - z2) / rz;
  const hx = x1 + rx * hitT, hy = y2 + ry * hitT, hz = z2 + rz * hitT;
  // 壁に当たった所をカメラから見た位置へ写す。壁は球より奥なので、粒は一律に少し縮む
  const camK = ROOM_CAM / (ROOM_CAM - hz);
  const wx = view.cx + hx * view.r * camK, wy = view.cy - hy * view.r * camK;
  if (!(wx > -dia && wx < view.W + dia && wy > -dia && wy < view.H + dia)) return false;
  const n = buf.n, oc = slot * 3;
  buf.x[n] = wx; buf.y[n] = wy;
  buf.d[n] = dia;
  // 壁に浅い角度で当たった筋ほど、粒が長く引き伸ばされる。伸びる向きは球の中心から外へ
  buf.ex[n] = Math.min(WALL_STRETCH_MAX, 1 / Math.max(0.33, Math.abs(rz))) * camK;
  buf.ey[n] = camK;
  buf.ang[n] = Math.atan2(wy - view.cy, wx - view.cx);
  // 粒の色は席の鏡と同じ色。メンバーカラーそのままより淡い
  buf.c[n * 3] = ball.tone[oc];
  buf.c[n * 3 + 1] = ball.tone[oc + 1];
  buf.c[n * 3 + 2] = ball.tone[oc + 2];
  // 足切りのすぐ上の鏡は薄く（ふっと現れ・ふっと消える）。
  // ちょうど光を返す向きに来た鏡の粒は一瞬明るくする＝手前の鏡が白く瞬くのと同じ合図。
  // 光の受け方が足切りに届いていない粒（着いたばかりの席）は、薄くせずそのままの重みで出す
  const fade = force ? 1 : Math.min(1, (db - view.cut) / WALL_FADE_BAND);
  buf.w[n] = fade * (view.flash && db > BALL_HL_CUT ? WALL_FLASH : 1) * boost;
  buf.p[n] = ball.sprites[slot]?.[0] ?? null;
  buf.n++;
  return true;
}

/** いま壁に映っている光の粒。鏡を描くついでに拾って、鏡を描き終えてからまとめて貼る。
 *  毎フレーム作り直さないよう先に用意して使い回す。夜空へ放つ時は、この位置と色がそのまま星になる */
export function createWallBuf(): WallBuf {
  return {
    x: new Float32Array(WALL_SPOT_MAX),
    y: new Float32Array(WALL_SPOT_MAX),
    c: new Uint8Array(WALL_SPOT_MAX * 3),              // 粒の色（3つ組）
    w: new Float32Array(WALL_SPOT_MAX),                // 濃さの重み（足切りのすぐ上は薄く・瞬いた鏡は明るく）
    ex: new Float32Array(WALL_SPOT_MAX),               // 粒の横の伸び。浅い角度で壁に当たった粒ほど長く伸びる
    ey: new Float32Array(WALL_SPOT_MAX),               // 粒の縦の伸び。壁の遠い所に当たった粒ほど小さい
    ang: new Float32Array(WALL_SPOT_MAX),              // 伸びる向き。球の中心から外へ向かう放射方向
    d: new Float32Array(WALL_SPOT_MAX),                // 粒の直径(px)。元になった鏡の大きさから決める
    p: new Array(WALL_SPOT_MAX).fill(null),            // 終盤に重ねる鏡の絵。光っていない1枚
    n: 0,
  };
}
/** そのコマの球の見え方と光の向き。粒を拾う関数へ渡す入れ物で、毎コマ中身だけ書き換える */
export function createWallView(): WallView {
  return { cx: 0, cy: 0, r: 0, W: 0, H: 0, Lx: 0, Ly: 0, Lz: 0, cut: 0, flash: true };
}
/** 壁まわりで持ち回る控え。毎コマ作り直さず、中身だけ書き換える */
export type WallState = {
  buf: WallBuf;
  view: WallView;
  /** いま壁に映している粒の濃さ。夜空へ放つ時に「この濃さから薄くなる」の出発点として読む */
  alphaNow: number;
  /** そのコマの足切りと、くじの当たりやすさ、鏡の高さ。奥側の席を拾う時に読む */
  cut: number;
  keep: number;
  tileV: number;
  /** 夜空へ放った瞬間、壁の粒が縮んで星になるまでの途中の姿（画面座標）。縮み終わったら星にして空へ焼き込む */
  fade: { x: number; y: number; rgb: [number, number, number]; t0: number; d0: number; a0: number; d1: number }[];
};
export function createWallState(): WallState {
  return { buf: createWallBuf(), view: createWallView(), alphaNow: 0, cut: 0, keep: 0, tileV: 0, fade: [] };
}

/** そのコマの粒の濃さ・足切り・くじの当たりやすさを決めて控える */
export function beginWallFrame(
  st: WallState, view: BallView, p: number, W: number, H: number, reduceMotion: boolean,
): number {
  // 壁に映る粒の「満開の度合い」（0〜1）。曲の進みで決まる。
  // 序盤は淡く、終盤は数も濃さも増す＝球が壁に近づいたように見せる。
  // 大きさは粒ごとに元の鏡から決まるので、ここで決めるのは濃さだけ
  const wallQ = Math.min(1, Math.max(0, p / WALL_FULL_AT));
  const wallAlpha = WALL_A_MIN + (WALL_A_MAX - WALL_A_MIN) * wallQ;
  st.alphaNow = wallAlpha;   // 夜空へ放つ時に、粒の薄くなり始めの濃さとして読む
  // 光を受けている鏡の足切り。鏡がまだ少ない間は緩め（WALL_LIT_EARLY）、
  // 鏡が WALL_LIT_RAMP 枚まで増える間に通常（WALL_LIT_MIN）へ戻す。
  // 序盤は光を受けている鏡そのものが数枚しかなく、さらに壁へ映した位置が画面に収まるものとなると
  // 2個ほどしか出なかった（Hop報告 2026-09-08）
  const wallCut = WALL_LIT_EARLY + (WALL_LIT_MIN - WALL_LIT_EARLY) * Math.min(1, view.filled / WALL_LIT_RAMP);
  // 壁に映す鏡の選び方: 光を受けている鏡（wallCut 以上）から、席の番号ごとに決まっている
  // くじで当たった分だけを映す。当たりの割合は「上限の数 ÷ 光を受けている鏡の数」なので、
  // 数が増えるほど当たりが少しずつ辛くなる＝粒が1枚ずつ静かに減る。
  // 当たり外れは席の番号で散らばるので、鏡の格子がそのまま拡大されて壁に写ることはない。
  // 「光の受け方が強い順に上位◯枚」を採る形も試したが、光の当たっている一角に粒が固まって
  // 壁の片側だけが光り、しかも格子の目がそのまま拡大されて見えた（2026-09-08 に手元で見てくじに変えた）。
  // 「◯枚おきに1枚」の間引きも、間隔が2枚おきから3枚おきへ変わる瞬間に粒が一斉に入れ替わるのでやめた
  const wallLit = view.filled * (1 - wallCut) / 2;   // だいたい何枚が光を受けているか（球の上でその向きが占める割合から）
  st.keep = Math.min(1, WALL_SPOT_MAX / Math.max(1, wallLit));
  st.cut = wallCut;
  st.tileV = view.tileV;
  st.buf.n = 0;
  const wv = st.view;
  wv.cx = view.cx; wv.cy = view.cy; wv.r = view.r; wv.W = W; wv.H = H;
  wv.Lx = view.Lx; wv.Ly = view.Ly; wv.Lz = view.Lz;
  wv.cut = wallCut; wv.flash = !reduceMotion;
  return wallAlpha;
}

/** 着地の返事（奥の席）。裏に着いた💎は鏡そのものが見えないので、壁の粒で返事をする。
 *  着いてから WALL_FRESH_MS の間は「着いたばかり」の印を持ち、その席はくじを飛ばして必ず粒を出す。
 *  上限（WALL_SPOT_MAX）に空きが無くなる前に拾えるよう、他の席より先に見る
 *  ＝空きが足りない時は、着いたばかりでない粒の方が出ないことになる。
 *  着いた直後は LAND_FLASH_MS かけて通常の明るさへ戻る。
 *  【仮】光を受けていない向き（db が足切りに届かない）でも、着いたばかりの間は
 *  いちばん強く受けている光源で1つ出す。ここは物理から外れている */
export function takeFreshLandings(st: WallState, ball: Ball, view: BallView, now: number) {
  const cx = view.cx, cy = view.cy, r = view.r;
  const cs = view.cs, sn = view.sn, ct = view.ct, vst = view.st;
  const tileK = view.tileK, tileV = view.tileV, lat = view.lat;
  const Lx = view.Lx, Ly = view.Ly, Lz = view.Lz;
  const wall = st.buf, wallView = st.view, wallCut = st.cut;
  // 印の切れた席を一覧から外す（詰めるだけで、配列は作り直さない）
  let keep = 0;
  for (let i = 0; i < ball.freshN; i++) {
    const s = ball.fresh[i];
    if (now - ball.landAt[s] < WALL_FRESH_MS && ball.sprites[s]) ball.fresh[keep++] = s;
    else ball.freshIn[s] = 0;
  }
  ball.freshN = keep;
  let freshSpots = 0;
  // 新しく着いた席から順に見る。一覧は着いた順に並んでいるので後ろから。
  // 上限に空きが無くなった時、いちばん新しい着地の返事が先に落ちてしまわないようにする
  for (let i = ball.freshN - 1; i >= 0; i--) {
    const slot = ball.fresh[i];
    const o = slot * 4;
    const x1 = lat[o] * cs + lat[o + 2] * sn;
    const z1 = -lat[o] * sn + lat[o + 2] * cs;
    const y2 = lat[o + 1] * ct - z1 * vst;
    const z2 = lat[o + 1] * vst + z1 * ct;
    if (z2 > 0) continue;   // 手前の席は鏡そのものが光る（drawMirrors）
    const tileU = Math.max(BALL_TILE_MIN, tileK * lat[o + 3]);
    const dia = Math.min(tileU, tileV) * WALL_TILE_MUL;
    const age = now - ball.landAt[slot];
    const q = Math.max(0, 1 - age / LAND_FLASH_MS);
    const boost = 1 + (WALL_LAND_FLASH - 1) * q * q * (3 - 2 * q);
    let got = 0, bestLi = 0, bestDb = -Infinity;
    for (let li = 0; li < WALL_LIGHT_TURNS.length; li++) {
      const db = wallLightDot(li, x1, y2, z2, Lx, Ly, Lz);
      if (db > bestDb) { bestDb = db; bestLi = li; }
      if (db > wallCut && takeWallSpot(wall, wallView, ball, slot, x1, y2, z2, li, dia, boost, false)) got++;
    }
    if (got === 0 && takeWallSpot(wall, wallView, ball, slot, x1, y2, z2, bestLi, dia, boost, true)) got++;
    freshSpots += got;
    if (devStats && got > 0) {
      // 粒は球の円の内側には貼らないので、そこへ映った分は出していても見えない。
      // 見えている所へ映ったかどうかを、撮影で数えられるようにする
      devStats.x = wall.x[wall.n - 1]; devStats.y = wall.y[wall.n - 1];
      devStats.out = Math.hypot(devStats.x - cx, devStats.y - cy) > r ? 1 : 0;
    }
  }
  if (devStats) devStats.freshSpots = freshSpots;
}

/** 奥側の鏡1枚から、壁に映る粒を拾う。鏡を描く輪（ball.ts の drawMirrors）から呼ばれる。
 *  壁に届く光は球の向こう側の面が返したものなので、粒は手前の鏡と逆向きに流れる。
 *  奥の鏡が光を受けているかどうかは、光の向きの奥行きだけ裏返して（＝奥から当たる光として）
 *  手前の鏡と同じ内積で測る。映す先は、その鏡が返した光の筋が球の後ろの平らな壁に当たる所。
 *  鏡が動画に隠れているかは問わない（動画の裏の鏡の光も壁には届く＝序盤の「裏で何か光っている」手掛かり）。
 *  ここでは位置と色を控えるだけで、貼るのは鏡を全部描いた後（drawWallSpots）。
 *  くじは席の番号から毎回同じ数を作る＝同じ席はずっと映り続ける（ちらつかない）。
 *  席を取った順から作ると、取り消しや差し替えで並びがずれた時に
 *  壁の粒が一斉に入れ替わってしまう。
 *  くじを引くのは席につき1回。当たった席だけが、光源の数だけ粒を出す。
 *  着いたばかりの席は takeFreshLandings で先に拾ってあるので、ここでは飛ばす */
export function takeBackSeat(
  st: WallState, ball: Ball, slot: number, x1: number, y2: number, z2: number, tileU: number,
) {
  const hk = ((slot * 2654435761) >>> 0) / 4294967296;
  if (hk < st.keep && !ball.freshIn[slot]) {
    // 粒の直径は、この席の鏡の短い方の辺に合わせる＝鏡1枚と粒1つが同じ物差しになる
    const dia = Math.min(tileU, st.tileV) * WALL_TILE_MUL;
    // 光源の数だけ繰り返す。同じ鏡でも光源ごとに違う向きへ筋を返すので、粒もその数だけ出る
    for (let li = 0; li < WALL_LIGHT_TURNS.length; li++) {
      takeWallSpot(st.buf, st.view, ball, slot, x1, y2, z2, li, dia, 1, false);
    }
  }
}

/** 壁に映る光の粒: 拾った奥側の鏡が返した筋が、奥の壁に当たる所へ柔らかい光の丸として貼る。
 *  外へ行くほど粒と粒の間隔が開き、浅く当たった粒は放射方向に伸びる＝奥に平らな壁があるように見える。
 *  奥側の鏡は画面の上で手前の鏡と逆向きに動くので、粒も逆向きに流れる＝本物のミラーボールと同じ。
 *  額縁（動画を含む）の中は clip で除外する。合成は lighter なので、重なった所だけ明るくなる。
 *  貼るのは鏡を全部描いた後。重なった時も足し算で少し明るくなるだけ（主役の動画より目立たない濃さに抑えてある）
 *  粒は球の奥にある光なので、球の円の内側には貼らない（Hop指摘 2026-09-11）。
 *  額縁の地色はこのキャンバスに塗ってあるので、囲いを外すと額縁まで明るくなってしまう */
export function drawWallSpots(
  ctx: CanvasRenderingContext2D, st: WallState, view: BallView, wallAlpha: number,
  p: number, W: number, H: number, f: { x: number; y: number; w: number; h: number },
) {
  const wall = st.buf;
  if (!(wall.n > 0 && wallAlpha > 0.01)) return;
  const cx = view.cx, cy = view.cy, r = view.r;
  const gem = Math.min(1, Math.max(0, (p - WALL_GEM_FROM) / WALL_GEM_FADE));
  ctx.save();
  // 囲いは2回に分けて掛ける。1回目で額縁の中を抜き、2回目で球の円を抜く＝両方を抜いた残りだけに貼る。
  // 円を1回目と同じ経路に足すと、額縁の矩形と円が重なっている所は境目を3回またぐことになり、
  // evenodd の数え方では逆に「貼れる側」へ返ってしまう。
  // 円の半径は球の半径ちょうど。壁の光は球の輪郭のすぐ外まで来ていて、遮るのは球そのものだけ。
  // 少し大きく取っていた頃は、球の外側に粒の無い輪ができて黒い縁のように見えた（Hop決定 2026-09-13）
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.rect(f.x, f.y, f.w, f.h);
  ctx.clip("evenodd");
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip("evenodd");
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < wall.n; i++) {
    const oc = i * 3;
    const cr = wall.c[oc], cg = wall.c[oc + 1], cb = wall.c[oc + 2];
    ctx.globalAlpha = Math.min(1, wallAlpha * wall.w[i]);
    const spot = getWallSpot((cr << 16) | (cg << 8) | cb, cr, cg, cb);
    const wd = wall.d[i];
    const wex = wall.ex[i], wey = wall.ey[i];
    if (wex === 1 && wey === 1) {
      ctx.drawImage(spot, wall.x[i] - wd / 2, wall.y[i] - wd / 2, wd, wd);
      continue;
    }
    // 伸びた粒。伸びる向きへ傾けてから、その向きに引き伸ばして貼る
    ctx.save();
    ctx.translate(wall.x[i], wall.y[i]);
    ctx.rotate(wall.ang[i]);
    ctx.scale(wex, wey);
    ctx.drawImage(spot, -wd / 2, -wd / 2, wd, wd);
    ctx.restore();
  }
  // 終盤だけ、粒の中心に鏡の絵を薄く重ねて輪郭を出す（曲が進むほどはっきりする）
  if (gem > 0) {
    for (let i = 0; i < wall.n; i++) {
      const sp2 = wall.p[i];
      if (!sp2) continue;
      const gemW = wall.d[i] * WALL_GEM_SCALE;
      ctx.globalAlpha = Math.min(1, wallAlpha * wall.w[i] * WALL_GEM_ALPHA * gem);
      ctx.drawImage(sp2, wall.x[i] - gemW / 2, wall.y[i] - gemW / 2, gemW, gemW);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** 夜空へ放つ時、壁に映っていた粒を「縮んで星になる途中の姿」へ移す。
 *  出発点の大きさと濃さも1粒ずつ引き継ぐ＝足切りぎりぎりの薄い粒が、放った瞬間に急に明るくならない */
export function wallToFade(st: WallState, now: number, starMin: number, starRange: number) {
  const wall = st.buf;
  for (let i = 0; i < wall.n; i++) {
    const d1 = starMin + Math.random() * starRange;
    st.fade.push({
      x: wall.x[i], y: wall.y[i],
      rgb: [wall.c[i * 3], wall.c[i * 3 + 1], wall.c[i * 3 + 2]],
      t0: now, d0: wall.d[i], a0: Math.min(1, st.alphaNow * wall.w[i]), d1,
    });
  }
}
/** 壁の粒から縮みきった分を星にする（大きさは縮み始めに決めてある） */
export function promoteWallFade(
  st: WallState, now: number, addStar: (x: number, y: number, rgb: [number, number, number], d?: number) => void,
) {
  const fade = st.fade;
  for (let i = fade.length - 1; i >= 0; i--) {
    if (now - fade[i].t0 < WALL_TO_STAR_MS) continue;
    addStar(fade[i].x, fade[i].y, fade[i].rgb, fade[i].d1);
    fade.splice(i, 1);
  }
}
/** 壁に映っていた粒が、その場で縮んで星に入れ替わる途中の姿（放った瞬間から WALL_TO_STAR_MS の間だけ）。
 *  直径40px前後の粒が2〜4pxの星へ一足飛びに変わると見た目が飛ぶので、粒を縮めながら薄くし、
 *  入れ替わりに星を濃くする。縮みきったところで星にして、以後は星空の絵へ焼き込まれる。
 *  額縁の外だけに出すのは、壁に映っていた時と同じ囲い方（額縁の中にあった粒は元から見えていない） */
export function drawWallFade(
  ctx: CanvasRenderingContext2D, st: WallState, now: number,
  W: number, H: number, f: { x: number; y: number; w: number; h: number },
) {
  const wallFade = st.fade;
  if (!wallFade.length) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.rect(f.x, f.y, f.w, f.h);
  ctx.clip("evenodd");
  ctx.globalCompositeOperation = "lighter";
  for (const wf of wallFade) {
    const u = Math.min(1, (now - wf.t0) / WALL_TO_STAR_MS);
    const dEnd = wf.d1 / WALL_TO_STAR_CORE;
    const dNow = wf.d0 + (dEnd - wf.d0) * u * u;      // はじめゆっくり、終わりで一気に縮む
    const [cr, cg, cb] = wf.rgb;
    ctx.globalAlpha = Math.min(1, wf.a0 * (1 - u * u));
    ctx.drawImage(getWallSpot((cr << 16) | (cg << 8) | cb, cr, cg, cb),
      wf.x - dNow / 2, wf.y - dNow / 2, dNow, dNow);
    const ws = wf.d1 / STAR_CORE;
    ctx.globalAlpha = u * u;
    ctx.drawImage(getStar(wf.rgb), wf.x - ws / 2, wf.y - ws / 2, ws, ws);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
