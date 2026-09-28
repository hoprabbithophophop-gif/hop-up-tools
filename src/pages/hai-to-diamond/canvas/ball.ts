// ミラーボールの球そのもの。席の格子・席の取り合い・鏡の絵・球の表面の描画をここに集めた。
// DiamondCanvas.tsx から切り出しただけで、中身は変えていない。
import { SPRITE_LIGHT, stoneTone } from "../gemSprites";
// ミラーボールの席を色ごとにまとめるための、目に見える色の近さの物差しと、色ごとの居場所
import { colorDistance, colorHome, type ColorHome, type Rgb } from "../ballColors";

// 開発中だけの切り替え。画面のアドレスに ?keep=0|3|5|10 を付けると変わる。
// 手元で動かしている時（import.meta.env.DEV）と、main 以外の枝のプレビュー（__SHOW_VERSION__）で読む。
// 本番の組み立てでは読まないので、公開している画面では既定のまま＝守らない。
// プレビューでも読むのは、K を Hop が実機で押し比べて決めるため（2026-09-13）。
const DEV_OPT = (import.meta.env.DEV || __SHOW_VERSION__) && typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
/** 自分の直近いくつの席を上書きから守るか。0＝守らない */
const SELF_KEEP = Math.max(0, Math.min(10, Math.floor(Number(DEV_OPT?.get("keep")) || 0)));
/** 自分の💎が着いた合図の出し方。見本で見比べるための切り替え（?ripple=0|1|2|3）。数字は全部【仮】
 *  0＝出さない  1＝輪が席から広がる  2＝まわりの鏡が波のように順に光る  3＝席にぼんやりした光が広がって消える */
export const RIPPLE_STYLE = DEV_OPT?.has("ripple") ? Math.max(0, Math.min(3, Math.floor(Number(DEV_OPT.get("ripple")) || 0))) : 1;
const RIPPLE_MS = 600;           // 合図が消えるまで(ms)
const RIPPLE_R = 3.2;            // 合図が届く広さ。鏡の高さの何倍まで
const RIPPLE_ALPHA = 0.85;       // 出た瞬間の濃さ
/** 開発中だけ、着いたばかりの席から壁へ出た粒の数と、その最後の1つの画面での位置を
 *  外から読めるようにする（見本の撮影で数える・場所を確かめる） */
export const devStats = DEV_OPT
  ? ((window as unknown as { __diamondDev?: { freshSpots: number; x: number; y: number; out: number } }).__diamondDev
    = { freshSpots: 0, x: -1, y: -1, out: 0 })
  : null;

// ミラーボール方式の値。数字は全部【仮】、実機で見て決める
// 本物のミラーボールは、人が増えても球そのものが大きくなったりはしない。近づいて見れば大きく見えるだけ。
// なので球の大きさも席の数も固定で、曲が進むにつれてカメラが寄っていく（Hop決定 2026-09-08）。
export const BALL_SEATS = 840;          // 席（鏡を貼る場所）の数【仮】。固定。押した💎は色ごとにまとまるように席を取り、
                                 // 満席になったら 同じ色の鏡のうちいちばん古いものを貼り替える。
                                 // 人が少ないうちは鏡がまばらなままでよい（Hop了承 2026-09-08）
export const BALL_R = 95;               // 球の半径(px)。カメラが寄っていない（拡大率1）時の見かけの大きさ【仮】。
                                 // 390幅の画面なら 動画の高さの半分＋額縁 ≒ 116px なので、曲の始まりは動画の裏にすっぽり隠れる
export const BALL_ZOOM_MIN = 1.30;      // 曲の始まりの拡大率【仮】。95 × 1.30 ≒ 124px で、幅375の画面の動画（高さ195）の
                                 // 上下から 25px ほど球の縁が覗く。始まりから球の存在が分かるようにする（Hop決定 2026-09-13）。
                                 // 壁の粒は鏡の大きさに合わせてあるので、序盤の粒も一緒に大きくなる
const BALL_ZOOM_MAX = 2.08;      // 曲の終わりの拡大率【仮】。95 × 2.08 ≒ 198px ＝ 画面の幅の半分を超えて上下からはみ出す。
                                 // 2.6 では実機で大きすぎた（Hop指摘 2026-09-11）ので8割にした
export const BALL_ZOOM_EASE = 3;        // 拡大率を目当ての値へ寄せる速さ（1秒あたり）。ハイライト再生で動画の時刻が飛んだ時に、
                                 // 拡大率まで一足飛びに変わらないようにする【仮】
export const BALL_SPIN_SEC = 20;        // 縦の軸まわりに1周する秒数
export const BALL_TILT = 0.3;           // 軸の傾き(rad)。まっすぐ立っているより少し傾いている方が球に見える
export const BALL_TILE_FILL = 1.0;      // 鏡を貼る大きさ。隣の席との間隔の何倍か【仮】。1.0 で鏡の直径が席の間隔いっぱいになり、
                                 // 隣どうしが触れ合う。絵は枠より少し内側で切ってあるので、鏡と鏡の間には細い隙間が残る
export const BALL_TILE_MIN = 2.5;       // 鏡の最小の大きさ(px)。拡大率が低いうちに1px を切ると消えてしまう【仮】
export const BALL_HL_CUT = 0.985;       // 壁の粒を一瞬明るくする、奥の鏡の光の返し具合【仮】。
                                 // 手前の鏡が白く光り始める所は MIRROR_HL_CUT で別に決める
const BALL_DIM = 0.55;           // 光が当たっていない側の明るさ。暗すぎると球が欠けて見える

// 自分の💎が着く席の選び方（手前かつ動画の矩形の外）。数字は全部【仮】
const SELF_SEAT_DEPTH_MIN = 0.15; // 手前を向いている度合いの下限。真横に近い席は鏡がほとんど見えないので選ばない
const SELF_SEAT_MARGIN = 4;      // 鏡が動画の矩形から離れていてほしい余白(px)
const SELF_SEAT_OLD_POOL = 6;    // 空席が無い時に塗り替え先を選ぶ、古い席の候補の数【仮】。
                                 // この中でいちばんこちらを向いている席を取る
// 上の候補を控える入れ物。席を取るたびに作らず、ここで1度だけ作って中身を書き換える
const selfOldSeat = new Int32Array(SELF_SEAT_OLD_POOL);
const selfOldAge = new Float64Array(SELF_SEAT_OLD_POOL);
const selfOldZ = new Float64Array(SELF_SEAT_OLD_POOL);
// 着地の手応え。数字は全部【仮】
export const LAND_FLASH_MS = 260;       // 着いた瞬間の強い光が、通常の見え方へ戻るまで

/** ミラーボールの球。球の大きさも席の数も固定で、変わるのは「どの席が埋まっているか」と、カメラの寄り具合だけ。
 *  zoom=いまのカメラの寄り（見かけの大きさは BALL_R × zoom）、
 *  sprites/rgb=各席に入っている💎の絵と色（空きは null）。席の位置は席の格子の並び、
 *  どの席を取るかは押された色で決まる（同じ色の席の隣を選ぶ） */
export type Ball = {
  zoom: number;
  sprites: (HTMLCanvasElement[] | null)[];
  rgb: Uint8Array;
  /** 取ってある席の一覧。押した時点で1つ取り、着いた時にそこへ貼る。
   *  着いた席ではなく取った席で数えるので、飛んでいる途中の💎どうしで席がぶつからない。
   *  並びに意味は無く、「いま埋まっている席はどれか」と「何席埋まっているか」を見るだけに使う。
   *  古い新しいは age で見る */
  occ: number[];
  /** 席が取られているか（1=取ってある。飛んでいる途中の分も含む）。occ と同じ中身を席の番号で引けるようにした控え */
  taken: Uint8Array;
  /** 色ごとの、その色が入っている席の一覧（"r,g,b" → 席の番号）。
   *  同じ色の隣を探す時に、球の全部の席を見に行かなくて済むようにする（連打された時の重さ対策） */
  byColor: Map<string, number[]>;
  /** 席が最後に塗られた順番。押されるたびに seq を1つ進めて、その番号を席に書く。
   *  小さいほど古い＝満席の後に貼り替える相手を選ぶ物差し */
  age: Float64Array;
  seq: number;
  /** 取った席の通し番号（色でまとめない時に使う）。決まった混ぜ順の何番目まで使ったか */
  reserved: number;
  /** 席の鏡を塗ってある色（"r,g,b" を3つ組で）。メンバーカラーそのままではなく、
   *  焼いた石の絵の平均の色。鏡を貼る時に一緒に書き、壁の粒の色として毎コマ引く。
   *  rgb の方はメンバーカラーのままなので、色ごとのまとまりや額縁の染まりはそちらで決まる */
  tone: Uint8Array;
  /** その席に💎が最後に着いた時刻(ms)。0＝まだ一度も着いていない。
   *  着いた瞬間の強い光と、壁の粒の返事に使う */
  landAt: Float64Array;
  /** その席の着地の光が通常へ戻るまでの長さ(ms)。0＝LAND_FLASH_MS。
   *  自分の分だけ長い光にするために席ごとに持つ */
  landMs: Float64Array;
  /** 自分の💎が最後に着いた席と、その時刻(ms)。着いた合図（波紋）に使う。-1＝出ていない */
  rippleSeat: number;
  rippleAt: number;
  /** 「着いたばかり」の印を持っている席の一覧（固定長）と、その数。毎コマ作り直さず、詰めるだけ */
  fresh: Int32Array;
  freshN: number;
  /** その席が fresh の一覧に入っているか（1=入っている） */
  freshIn: Uint8Array;
  /** 自分の💎が取った直近の席の環と、これまでに入れた総数。SELF_KEEP 個ぶんだけ上書きから守る */
  selfRing: Int32Array;
  selfRingN: number;
};

// ミラーボールの席に着いた💎は、球の表面に貼られた色の付いた平らな丸い鏡になる（Hop決定 2026-09-11 案1）。
// 鏡は面が1枚。球が回って向きの合った鏡が白く光るだけで、面ごとの明るさは計算しない。
// 向きは貼る時の変形で決まるので、回していない絵を色ごとに持つ。
//
// 鏡の色はメンバーカラーそのままではなく、焼いた立体の石の絵の平均の色にする（Hop決定 2026-09-11 案C）。
// 純色を並べると強すぎるうえ、石の絵は光が中で折れるぶん白を含んで淡く見えるので、
// メンバーカラーのままだと飛んでいる💎と席の鏡で色味がそろわない。
// まだ焼けていない色と、立体を描けない端末では、メンバーカラーに白を混ぜた色で代える。
//
// 白い瞬きは別の光を上から重ねるのではなく、「白く光った絵」に差し替えて出す
// ＝鏡1枚につき貼るのは1回のままで、瞬きのために描く回数が増えない
const MIRROR_PX = 64;            // 絵の1辺【仮】
const MIRROR_FLASH = 5;          // 瞬きの段階の数。0番が光っていない絵
const MIRROR_R = 0.96;           // 鏡の円の大きさ。絵の枠の何倍か。枠より少し内側で切って、
                                 // 隣の鏡との間に細い隙間が見えるようにする【仮】
const MIRROR_FLASH_MAX = 0.92;   // 一番光った時に、どこまで白へ寄せるか【仮】
const MIRROR_WHITEN = 0.35;      // 石がまだ焼けていない色の代え。メンバーカラーにこれだけ白を混ぜる【仮】
/** 鏡が白く光り始める、光の返し具合【仮】。緩めると光る鏡が増えすぎて、白い塊になって球に見えなくなる */
const MIRROR_HL_CUT = 0.975;
/** 色に白を混ぜる */
function whiten(rgb: [number, number, number], w: number): [number, number, number] {
  return [rgb[0] + (255 - rgb[0]) * w, rgb[1] + (255 - rgb[1]) * w, rgb[2] + (255 - rgb[2]) * w];
}
const mirrorCache = new Map<string, HTMLCanvasElement[]>();
/** 鏡の絵を1色ぶん。白さの段ごとに1枚ずつ、色ごとに一度だけ作って控える。
 *  渡される色は石の絵を測った平均なので小数が混ざる。控えの鍵は丸めた値で作る */
function getMirrorSprites(rgb: [number, number, number]): HTMLCanvasElement[] {
  const key = Math.round(rgb[0]) + "," + Math.round(rgb[1]) + "," + Math.round(rgb[2]);
  let arr = mirrorCache.get(key);
  if (arr) return arr;
  const lx = Math.cos(SPRITE_LIGHT), ly = Math.sin(SPRITE_LIGHT);
  /** 明るさ k と白の混ぜ具合 w から、塗る色を作る */
  const mix = (k: number, w: number) => {
    const r = rgb[0] * k, g = rgb[1] * k, b = rgb[2] * k;
    return "rgb(" + ((r + (255 - r) * w) | 0) + "," + ((g + (255 - g) * w) | 0) + "," + ((b + (255 - b) * w) | 0) + ")";
  };
  arr = [];
  for (let s = 0; s < MIRROR_FLASH; s++) {
    // 白く光っている度合い。真っ白まで振り切るとただの白丸になるので、手前で止める【仮】
    const fl = (s / (MIRROR_FLASH - 1)) * MIRROR_FLASH_MAX;
    const c = document.createElement("canvas");
    c.width = MIRROR_PX; c.height = MIRROR_PX;
    const cx = c.getContext("2d");
    if (cx) {
      cx.translate(MIRROR_PX / 2, MIRROR_PX / 2);
      cx.scale(MIRROR_PX / 2, MIRROR_PX / 2);
      // 中は一様に近く、光の側から反対側へ向かってゆるく暗くなるだけ
      const g = cx.createLinearGradient(lx * MIRROR_R, ly * MIRROR_R, -lx * MIRROR_R, -ly * MIRROR_R);
      g.addColorStop(0, mix(1.0, fl * 0.95 + 0.18));
      g.addColorStop(0.5, mix(0.92, fl * 0.85 + 0.04));
      g.addColorStop(1, mix(0.62, fl * 0.7));
      cx.fillStyle = g;
      cx.beginPath();
      cx.arc(0, 0, MIRROR_R, 0, Math.PI * 2);
      cx.fill();
      // 縁の細い光。丸い鏡であることが分かるように
      cx.lineWidth = 0.05;
      cx.strokeStyle = "rgba(255,255,255," + (0.28 + 0.5 * fl).toFixed(2) + ")";
      cx.beginPath();
      cx.arc(0, 0, MIRROR_R, 0, Math.PI * 2);
      cx.stroke();
    }
    arr.push(c);
  }
  mirrorCache.set(key, arr);
  return arr;
}
/** その色の鏡を塗る色。石が焼けていればその絵の平均の色、まだなら白を混ぜた色 */
function mirrorToneFor(rgb: [number, number, number]): [number, number, number] {
  return stoneTone(rgb) ?? whiten(rgb, MIRROR_WHITEN);
}
/** メンバーカラーから鏡の絵を引く。石がまだ焼けていない間の代えの色は控えない
 *  ＝焼き上がった後に引き直せば、本物の石から測った色の鏡に変わる */
const mirrorByColor = new Map<string, HTMLCanvasElement[]>();
function mirrorSpritesFor(rgb: [number, number, number]): HTMLCanvasElement[] {
  const key = rgb.join(",");
  const hit = mirrorByColor.get(key);
  if (hit) return hit;
  const tone = stoneTone(rgb);
  const arr = getMirrorSprites(tone ?? whiten(rgb, MIRROR_WHITEN));
  if (tone) mirrorByColor.set(key, arr);
  return arr;
}

// ミラーボールの席の並び（半径1の球）。本物のミラーボールと同じく、北から南へ何本かの帯に切り、
// 帯ごとに「その帯の円周の長さに比例した枚数」を等間隔に置く＝行と列がそろった格子になる。
// 枚数は4の倍数に丸めて、隣り合う帯どうしでも列がだいたいそろって見えるようにする。
// 格子は1つだけ・BALL_SEATS 席で固定し、最初に使う時だけ組み立てて使い回す。
// 💎が1つ吸い込まれたら、決まった混ぜ順の次の1席が埋まる（Hop決定 2026-09-08: 席の数も球の大きさも増やさない）
/** 決まった順番で同じ数を返す簡単な乱数。席を埋める順が起動のたびに変わらないようにするために使う */
function ballRandom(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

/** 席の格子。seats=席の数、a=席1つにつき4つ（球の上の向き x,y,z と、その席の横の間隔）、
 *  order=散らばった順（席を色で決められない時の逃げ道と、迷った時の順番付け）、v=段（緯度）の間隔。
 *  a の4つ目と v が、そのまま鏡の横幅・高さの元になる。
 *  rank=席の番号から order の何番目かを引く表、lon=席の経度（色ごとの居場所と見比べるのに使う）。
 *  nbrStart/nbr=隣り合う席の一覧。席 s の隣は nbr[nbrStart[s]] から nbr[nbrStart[s+1]-1] まで。
 *  この一覧は起動時に1回だけ作って使い回す（押すたびに隣を計算し直さない） */
export type BallLattice = {
  seats: number; a: Float32Array; order: Int32Array; v: number;
  rank: Int32Array; nbrStart: Int32Array; nbr: Int32Array; lon: Float32Array;
};
let ballLattice: BallLattice | null = null;
function buildBallLattice(): BallLattice {
  const N = BALL_SEATS;
  // 帯の本数は「鏡が正方形に並ぶ本数」から逆算する（合計はおよそ 4B²/π 席になる）
  const B0 = Math.max(4, Math.round(Math.sqrt((Math.PI * N) / 4)));
  const counts: number[] = [];
  for (let i = 0; i < B0; i++) {
    const th = ((i + 0.5) / B0) * Math.PI;
    counts.push(Math.max(4, Math.round((2 * B0 * Math.sin(th)) / 4) * 4));
  }
  // 合計をちょうど N 席に合わせる。席のいちばん多い帯（＝赤道寄り）で増減させるので、間隔はほとんど変わらない
  let total = counts.reduce((acc, c) => acc + c, 0);
  while (total !== N) {
    let m = 0;
    for (let i = 1; i < counts.length; i++) if (counts[i] > counts[m]) m = i;
    if (total > N) {
      const cut = Math.min(total - N >= 4 ? 4 : 1, counts[m] - 4);
      if (cut <= 0) break;
      counts[m] -= cut; total -= cut;
    } else {
      const add = Math.min(4, N - total);
      counts[m] += add; total += add;
    }
  }
  const B = counts.length;
  const v = Math.PI / B;   // 段と段の間隔（rad）。半径を掛けると鏡の高さになる
  const a = new Float32Array(N * 4);
  const lon = new Float32Array(N);  // 席の経度
  const bandStart: number[] = [];   // 段ごとの、いちばん若い席の番号
  const bandCount: number[] = [];   // 段ごとに実際に置けた席の数
  let k = 0;
  for (let i = 0; i < B && k < N; i++) {
    bandStart.push(k);
    bandCount.push(Math.min(counts[i], N - k));
    const th = ((i + 0.5) / B) * Math.PI;
    const y = Math.cos(th), rho = Math.sin(th);
    // 横の間隔は帯の円周を席の数で割ったもの。極に近い段は円周が短いので、そのぶん鏡も細くなる
    // （かぎ針編みの球で、上下の段の目が細く見えるのと同じ）。段の間隔より広くはしない
    const u = Math.min(v * 1.2, ((Math.PI * 2) / counts[i]) * rho);
    for (let j = 0; j < counts[i] && k < N; j++) {
      const ph = (j / counts[i]) * Math.PI * 2;
      a[k * 4] = rho * Math.cos(ph);
      a[k * 4 + 1] = y;
      a[k * 4 + 2] = rho * Math.sin(ph);
      a[k * 4 + 3] = u;
      lon[k] = ph;
      k++;
    }
  }
  // 散らばった順。席を色で決めるようになった今は、色で決められない時の逃げ道と、
  // 同じくらい良い席が並んだ時の順番付けに使う（下の rank）。
  // 並びの端から順に埋めると北極だけに固まるので、決まった順で混ぜた並びを使う。
  // 赤道から上下へ広げる埋め方も試したが、赤道の帯はちょうど動画にすっかり隠れる高さなので、
  // 数千枚たまるまで球が1枚も見えないままだった（2026-09-08 に見比べて混ぜる方を採用）。
  // 毎回同じ並びになるよう乱数の種は固定（起動ごとに変わると見え方が揺れる）
  const ord = new Int32Array(N);
  for (let i = 0; i < N; i++) ord[i] = i;
  const rnd = ballRandom(19980621);
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = ord[i]; ord[i] = ord[j]; ord[j] = t;
  }
  const rank = new Int32Array(N);
  for (let i = 0; i < N; i++) rank[ord[i]] = i;
  // 隣り合う席の表。同じ段の左右と、上下の段で「席の受け持つ幅が触れ合っている」席を隣とみなす。
  // 段によって席の数が違う（極に近いほど少ない）ので、上下の隣は1つとは限らない。
  // かぎ針編みの球で、上の段の1目に下の段の2目が付くことがあるのと同じ
  const lists: number[][] = [];
  for (let i = 0; i < bandStart.length; i++) {
    const ci = bandCount[i];
    for (let j = 0; j < ci; j++) {
      const list: number[] = [];
      if (ci > 1) list.push(bandStart[i] + ((j + 1) % ci));
      if (ci > 2) list.push(bandStart[i] + ((j - 1 + ci) % ci));
      const ph = (j / ci) * Math.PI * 2;
      for (const nb of [i - 1, i + 1]) {
        if (nb < 0 || nb >= bandStart.length) continue;
        const cn = bandCount[nb];
        const w = Math.PI / ci + Math.PI / cn + 1e-6;   // 受け持つ幅の半分どうしの合計＝ここまで近ければ触れ合っている
        const st2 = (Math.PI * 2) / cn;
        const lo = Math.ceil((ph - w) / st2), hi = Math.floor((ph + w) / st2);
        for (let m = lo; m <= hi && m - lo < cn; m++) {
          const s2 = bandStart[nb] + (((m % cn) + cn) % cn);
          if (!list.includes(s2)) list.push(s2);
        }
      }
      lists.push(list);
    }
  }
  const nbrStart = new Int32Array(N + 1);
  let tot = 0;
  for (let s = 0; s < N; s++) { nbrStart[s] = tot; tot += lists[s]?.length ?? 0; }
  nbrStart[N] = tot;
  const nbr = new Int32Array(tot);
  let w2 = 0;
  for (let s = 0; s < N; s++) for (const t2 of lists[s] ?? []) nbr[w2++] = t2;
  return { seats: N, a, order: ord, v, rank, nbrStart, nbr, lon };
}
export function getBallLattice(): BallLattice {
  return (ballLattice ??= buildBallLattice());
}

// ── 席の決め方 ───────────────────────────────────────────────
// 押された💎を、色ごとに塊になるように席へ割り当てる。
//   1. 同じ色の席がもうあれば、その隣の空いている席
//   2. まだ無ければ、その色の居場所（ballColors.ts の colorHome）にいちばん近い空いている席
//   3. 席が全部埋まっていれば、同じ色の席のうちいちばん古いものを貼り替える（pickRepaintSeat）
// 隣の一覧は起動時に1回だけ作った表を引くだけ（押すたびに計算し直さない）。
/** 席の決め方の切り替え。2つの案を見比べるために残してある（Hopの判断待ち・2026-09-10）。
 *  "hue"       … 上のとおり。色ごとの居場所（色合いから決まる経度）を先に決めておくので、
 *                 塊は球じゅうに散らばって生まれ、隣り合う塊の色は少しずつ移り変わる
 *  "continent" … 指示のままの3段（同じ色の隣 → 色合いの近い色の隣 → 散らばった順）。
 *                 散らばった順を使うのはいちばん最初の1つだけで、以後はすべてその隣に付くので、
 *                 球の一部だけが埋まって残りが空のままになる */
/** 席を色でまとめるかどうか。false＝公開中の本番と同じで、決まった混ぜ順に前から埋める。
 *  色でまとめる方は、満席の後の塗り替えの決め方がまだ決まっていないので今は止めてある（Hopの判断待ち・2026-09-10）。
 *  true に戻すだけで色でまとめる作りに切り替わる */
const SEAT_CLUSTER = false;
type SeatSeed = "hue" | "continent";
const SEAT_SEED = "hue" as SeatSeed;
/** 塊の1枚目を置く時に、経度をどれくらい大まかに見るか。
 *  半周（180度）をこの数で割った幅がひと帯＝12なら15度ずつ【仮】 */
const SEED_LON_STEP = 12;

/** その席が、その色の居場所にどれだけ合っているか（1に近いほど合っている）。
 *  色合いを持つ色は経度だけで測る＝南北は問わないので、塊は北にも南にも伸びられる。
 *  白は居場所が無いので、どの席も同じ0点＝散らばった順で先に来る席が選ばれる */
function homeScore(lv: BallLattice, s: number, home: ColorHome): number {
  if (home.lon === null) return 0;
  let d = Math.abs(lv.lon[s] - home.lon) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return 1 - d / Math.PI;
}
function seatIsColor(ball: Ball, s: number, rgb: Rgb): boolean {
  const o = s * 3;
  return ball.taken[s] === 1 && ball.rgb[o] === rgb[0] && ball.rgb[o + 1] === rgb[1] && ball.rgb[o + 2] === rgb[2];
}
/** 同じ席を二度調べないための印。押すたびに番号を1つ進めて、消して回らなくて済むようにする */
let seatVisit: Int32Array | null = null;
let seatVisitStamp = 0;
/** seats（ある色が入っている席の一覧）の隣の空席から、いちばん良い1つを選ぶ。
 *  良さは「その色の席にいくつ囲まれているか（＝塊が丸くまとまる）」が第一で、
 *  同じなら色の居場所に近い方、それも同じなら散らばった順で先に来る方 */
function bestFreeNeighbor(ball: Ball, lv: BallLattice, seats: number[] | undefined, rgb: Rgb, home: ColorHome): number {
  if (!seats || seats.length === 0) return -1;
  if (!seatVisit || seatVisit.length !== lv.seats) seatVisit = new Int32Array(lv.seats);
  const seen = seatVisit;
  const stamp = ++seatVisitStamp;
  let best = -1, bestScore = -Infinity, bestRank = Infinity;
  for (const s of seats) {
    for (let i = lv.nbrStart[s]; i < lv.nbrStart[s + 1]; i++) {
      const n = lv.nbr[i];
      if (ball.taken[n] || seen[n] === stamp) continue;
      seen[n] = stamp;
      let same = 0;
      for (let j = lv.nbrStart[n]; j < lv.nbrStart[n + 1]; j++) if (seatIsColor(ball, lv.nbr[j], rgb)) same++;
      const score = same + 0.5 * homeScore(lv, n, home);
      const rk = lv.rank[n];
      if (score > bestScore || (score === bestScore && rk < bestRank)) { bestScore = score; bestRank = rk; best = n; }
    }
  }
  return best;
}
function dropFromColor(ball: Ball, key: string, seat: number) {
  const arr = ball.byColor.get(key);
  if (!arr) return;
  const at = arr.indexOf(seat);
  if (at >= 0) arr.splice(at, 1);
  if (arr.length === 0) ball.byColor.delete(key);
}
function addToColor(ball: Ball, key: string, seat: number) {
  const arr = ball.byColor.get(key);
  if (arr) arr.push(seat); else ball.byColor.set(key, [seat]);
}
/** 席の一覧のうち、いちばん古く塗られた1席。空の一覧なら -1 */
function oldestSeat(ball: Ball, seats: number[] | undefined): number {
  if (!seats || seats.length === 0) return -1;
  let best = -1, bestAge = Infinity;
  for (const s of seats) {
    if (seatProtected(ball, s)) continue;   // 自分の直近の席は塗り替えの候補から外す
    const g = ball.age[s];
    if (g < bestAge) { bestAge = g; best = s; }
  }
  return best;
}
/** 満席の後に貼り替える1席を選ぶ。
 *  同じ色の席のうちいちばん古いもの＝その色の枚数は変わらず、色の塊も虫食いにならない。
 *  同じ色が1つも無ければ、色合いのいちばん近い色のうちいちばん古いもの。
 *  そのとき、残り1席しかない色は先に外して探す＝球からその色が消えてしまわないようにする。
 *  どの色も1席しか持っていない時だけ、その決まりを外して最寄りの色から取る（外さないと貼り替え先が無くなる）。
 *  見るのは色の数（数十）と、その色が持つ席の数だけなので、連打されても重くならない */
function pickRepaintSeat(ball: Ball, rgb: Rgb, key: string): number {
  const same = oldestSeat(ball, ball.byColor.get(key));
  if (same >= 0) return same;
  let bestKey: string | null = null, bestD = Infinity;
  let anyKey: string | null = null, anyD = Infinity;
  for (const [k2, arr] of ball.byColor) {
    if (!arr || arr.length === 0) continue;
    const d = colorDistance(rgb, k2.split(",").map(Number) as Rgb);
    if (d < anyD) { anyD = d; anyKey = k2; }
    if (arr.length > 1 && d < bestD) { bestD = d; bestKey = k2; }
  }
  const pick = bestKey ?? anyKey;
  if (pick !== null) return oldestSeat(ball, ball.byColor.get(pick));
  // 色ごとの一覧が空＝ここへは来ないはずだが、念のため全席からいちばん古い1席を選ぶ
  let fb = -1, fbAge = Infinity;
  for (let s = 0; s < ball.taken.length; s++) {
    if (!ball.taken[s] || seatProtected(ball, s)) continue;
    if (ball.age[s] < fbAge) { fbAge = ball.age[s]; fb = s; }
  }
  return fb;
}
/** 席を1つ確保して、そこへ色を書き込む。戻り値は取り消し（スワイプの空振り）で元へ戻すための控え */
export type SeatHold = { seat: number; wasEmpty: boolean; prevRgb: [number, number, number]; prevAge: number; counted: boolean };
function claimSeat(ball: Ball, seat: number, rgb: Rgb, key: string, counted: boolean): SeatHold {
  const o = seat * 3;
  const prevRgb: [number, number, number] = [ball.rgb[o], ball.rgb[o + 1], ball.rgb[o + 2]];
  const prevAge = ball.age[seat];
  const wasEmpty = ball.taken[seat] === 0;
  if (!wasEmpty) dropFromColor(ball, prevRgb.join(","), seat);
  ball.taken[seat] = 1;
  ball.rgb[o] = rgb[0]; ball.rgb[o + 1] = rgb[1]; ball.rgb[o + 2] = rgb[2];
  addToColor(ball, key, seat);
  // occ は「埋まっている席の一覧」なので、新しく取った時だけ足す（貼り替えは既に入っている）
  if (wasEmpty) ball.occ.push(seat);
  ball.age[seat] = ++ball.seq;
  return { seat, wasEmpty, prevRgb, prevAge, counted };
}
/** その席が「自分の直近 SELF_KEEP 個」に入っていて、上書きから守られているか。
 *  SELF_KEEP が 0 の間は誰も守られない＝今までどおり */
function seatProtected(ball: Ball, seat: number): boolean {
  if (SELF_KEEP <= 0) return false;
  const n = Math.min(ball.selfRingN, SELF_KEEP);
  for (let i = 0; i < n; i++) if (ball.selfRing[i] === seat) return true;
  return false;
}
/** 自分が取った席を環へ入れる。K+1 個目を入れると、いちばん古い自分の席が環から外れる＝守られなくなる */
export function rememberSelfSeat(ball: Ball, seat: number) {
  if (SELF_KEEP <= 0) return;
  ball.selfRing[ball.selfRingN % SELF_KEEP] = seat;
  ball.selfRingN++;
}
/** 直前に入れた自分の席を環から外す（取り消しの時） */
export function forgetLastSelfSeat(ball: Ball, seat: number) {
  if (SELF_KEEP <= 0 || ball.selfRingN <= 0) return;
  const at = (ball.selfRingN - 1) % SELF_KEEP;
  if (ball.selfRing[at] !== seat) return;
  ball.selfRing[at] = -1;
  ball.selfRingN--;
}
/** 自分の💎が着く席を選ぶ時に見る、そのコマの球の見え方 */
export type SeatView = {
  cx: number; cy: number; r: number;
  cs: number; sn: number; ct: number; st: number;
  tileV: number;
  v: { x: number; y: number; w: number; h: number };
};
/** 自分の💎の席を1つ取る。条件は「手前（画面に向いている側）を向いていて、鏡がまるごと動画の矩形の外」。
 *  条件に合う席のうち、いちばんこちらを向いている席（z2 が最大）を取る＝自分の分が着いた場所を見つけやすくする
 *  （Hop決定 2026-09-13 案1）。空席を先に見る考え方は残す。空席があればその中で z2 が最大のもの、
 *  無ければ同じ条件の席のうち古い方から SELF_SEAT_OLD_POOL 個に絞り、その中で z2 が最大のものを塗り替える。
 *  条件に合う席が1つも無ければ null を返し、呼び出し側が今までどおりの決め方に戻す。
 *  他の人の分の決め方（reserveSeat）はこれまでのまま＝球の全面に均等 */
export function reserveSelfSeat(ball: Ball, rgb: Rgb, view: SeatView): SeatHold | null {
  const lv = getBallLattice();
  const lat = lv.a;
  const half = view.tileV * 0.6 + SELF_SEAT_MARGIN;
  let free = -1, freeZ = -Infinity;
  let oldN = 0;
  for (let s = 0; s < lv.seats; s++) {
    const o = s * 4;
    const x1 = lat[o] * view.cs + lat[o + 2] * view.sn;
    const z1 = -lat[o] * view.sn + lat[o + 2] * view.cs;
    const y2 = lat[o + 1] * view.ct - z1 * view.st;
    const z2 = lat[o + 1] * view.st + z1 * view.ct;
    if (z2 < SELF_SEAT_DEPTH_MIN) continue;   // 奥を向いている席と、真横に近い席は外す
    const sx = view.cx + x1 * view.r, sy = view.cy - y2 * view.r;
    // 鏡がまるごと動画の矩形の外にあること。矩形に少しでもかかる席は、半分隠れて見えるので外す
    if (sx + half > view.v.x && sx - half < view.v.x + view.v.w
      && sy + half > view.v.y && sy - half < view.v.y + view.v.h) continue;
    if (seatProtected(ball, s)) continue;
    if (!ball.taken[s]) {
      if (z2 > freeZ) { freeZ = z2; free = s; }
      continue;
    }
    // 埋まっている席は、古い順に SELF_SEAT_OLD_POOL 個だけ控える。
    // 入れる場所を後ろから探して1つずつ押し出す＝並べ替えの入れ物を作らない
    const age = ball.age[s];
    if (oldN < SELF_SEAT_OLD_POOL || age < selfOldAge[oldN - 1]) {
      let i = Math.min(oldN, SELF_SEAT_OLD_POOL - 1);
      while (i > 0 && selfOldAge[i - 1] > age) {
        selfOldAge[i] = selfOldAge[i - 1]; selfOldSeat[i] = selfOldSeat[i - 1]; selfOldZ[i] = selfOldZ[i - 1];
        i--;
      }
      selfOldAge[i] = age; selfOldSeat[i] = s; selfOldZ[i] = z2;
      if (oldN < SELF_SEAT_OLD_POOL) oldN++;
    }
  }
  let seat = free;
  if (seat < 0) {
    // 空席が無い時は、控えた古い席の中でいちばんこちらを向いているものを塗り替える
    let bestZ = -Infinity;
    for (let i = 0; i < oldN; i++) if (selfOldZ[i] > bestZ) { bestZ = selfOldZ[i]; seat = selfOldSeat[i]; }
  }
  if (seat < 0) return null;
  return claimSeat(ball, seat, rgb, rgb.join(","), false);
}
/** 押された💎の席を1つ取る。戻り値は取り消し（スワイプの空振り）で元へ戻すための控え */
export function reserveSeat(ball: Ball, rgb: Rgb): SeatHold {
  const lv = getBallLattice();
  const N = lv.seats;
  const key = rgb.join(",");
  const home = colorHome(rgb);
  let seat = -1;
  let counted = false;
  if (!SEAT_CLUSTER) {
    // 公開中の本番と同じ決め方。決まった混ぜ順を前から使い、一周したら古い席から上書きする。
    // 自分の直近の席を守っている間は、その席に当たったら次の席へ送る（最大 SELF_KEEP+1 回で必ず決まる）
    for (let i = 0; i <= SELF_KEEP; i++) {
      const cand = lv.order[ball.reserved % N];
      ball.reserved++;
      counted = true;
      if (!seatProtected(ball, cand)) { seat = cand; break; }
    }
  } else if (ball.occ.length < N) {
    // 1. 同じ色の塊の隣
    seat = bestFreeNeighbor(ball, lv, ball.byColor.get(key), rgb, home);
    if (seat < 0 && SEAT_SEED === "hue") {
      // 2. その色の居場所（経度の帯）の中から、散らばった順で先に来る空席。
      //    経度の近さをそのまま比べると、席の細かい赤道寄りの段がいつも勝ってしまい、
      //    塊の1枚目が必ず動画に隠れる高さに置かれる（2026-09-10 に見て気づいた）。
      //    そこで経度は SEED_LON_STEP きざみの「どの帯か」だけで比べ、
      //    同じ帯の中では今までどおり散らばった順に取る＝1枚目の高さは球じゅうにばらける
      let bestQ = -Infinity, bestRank = Infinity;
      for (let s = 0; s < N; s++) {
        if (ball.taken[s]) continue;
        const q = Math.round(homeScore(lv, s, home) * SEED_LON_STEP);
        const rk = lv.rank[s];
        if (q > bestQ || (q === bestQ && rk < bestRank)) { bestQ = q; bestRank = rk; seat = s; }
      }
    } else if (seat < 0) {
      // 2. 色合いのいちばん近い色から順に、その塊の隣に空きがないか見る
      const others: { k: string; rgb: Rgb; d: number }[] = [];
      for (const k2 of ball.byColor.keys()) {
        if (k2 === key) continue;
        const p = k2.split(",").map(Number) as Rgb;
        others.push({ k: k2, rgb: p, d: colorDistance(rgb, p) });
      }
      others.sort((p, q) => p.d - q.d);
      for (const o2 of others) {
        seat = bestFreeNeighbor(ball, lv, ball.byColor.get(o2.k), o2.rgb, home);
        if (seat >= 0) break;
      }
      // 3. それも無ければ、今までどおり散らばった順のまだ使っていない席
      if (seat < 0) for (let i = 0; i < N; i++) { const s = lv.order[i]; if (!ball.taken[s]) { seat = s; break; } }
    }
  }
  // 席が全部埋まっている。貼り替える相手を色で選ぶ
  if (seat < 0) seat = pickRepaintSeat(ball, rgb, key);
  if (seat < 0) seat = 0;
  return claimSeat(ball, seat, rgb, key, counted);
}
/** 取った席を返す（取り消し）。空席だった席は空席へ、貼り替えだった席は元の色と塗られた順番へ戻す */
export function releaseSeat(ball: Ball, seat: number, wasEmpty: boolean, prevRgb: [number, number, number], prevAge: number, counted: boolean) {
  if (!SEAT_CLUSTER && counted) ball.reserved = Math.max(0, ball.reserved - 1);
  const o = seat * 3;
  dropFromColor(ball, ball.rgb[o] + "," + ball.rgb[o + 1] + "," + ball.rgb[o + 2], seat);
  ball.rgb[o] = prevRgb[0]; ball.rgb[o + 1] = prevRgb[1]; ball.rgb[o + 2] = prevRgb[2];
  ball.age[seat] = prevAge;
  if (wasEmpty) {
    ball.taken[seat] = 0;
    const at = ball.occ.indexOf(seat);
    if (at >= 0) ball.occ.splice(at, 1);
  } else {
    addToColor(ball, prevRgb.join(","), seat);
  }
}

/** カメラの寄り具合。曲の進み p が 0 → 1 の間に BALL_ZOOM_MIN → BALL_ZOOM_MAX へ。
 *  序盤から動画の上下に球の縁が覗いていて、中盤でせり出し、終盤ではっきりはみ出す
 *  （ゆっくり動き出してゆっくり止まる曲線） */
export function ballZoomFor(p: number): number {
  const q = Math.min(1, Math.max(0, p));
  return BALL_ZOOM_MIN + (BALL_ZOOM_MAX - BALL_ZOOM_MIN) * q * q * (3 - 2 * q);
}

/** ミラーボールの球。最初に使う時だけ作る（画面が描き直されるたびに作り捨てないように） */
export function createBall(): Ball {
  return {
    zoom: BALL_ZOOM_MIN,
    sprites: new Array<HTMLCanvasElement[] | null>(BALL_SEATS).fill(null),
    rgb: new Uint8Array(BALL_SEATS * 3),
    occ: [],
    taken: new Uint8Array(BALL_SEATS),
    byColor: new Map<string, number[]>(),
    age: new Float64Array(BALL_SEATS),
    tone: new Uint8Array(BALL_SEATS * 3),
    seq: 0,
    reserved: 0,
    landAt: new Float64Array(BALL_SEATS),
    landMs: new Float64Array(BALL_SEATS),
    rippleSeat: -1,
    rippleAt: 0,
    fresh: new Int32Array(BALL_SEATS),
    freshN: 0,
    freshIn: new Uint8Array(BALL_SEATS),
    selfRing: new Int32Array(Math.max(1, SELF_KEEP)).fill(-1),
    selfRingN: 0,
  };
}
/** 球を空にする（最初に戻す時・方式を替えた時・夜空へ放った時）。席の並びも大きさも固定なので、中身を消すだけ */
export function clearBall(ball: Ball) {
  ball.zoom = BALL_ZOOM_MIN;
  ball.sprites = new Array<HTMLCanvasElement[] | null>(BALL_SEATS).fill(null);
  ball.rgb = new Uint8Array(BALL_SEATS * 3);
  ball.occ = [];
  ball.taken = new Uint8Array(BALL_SEATS);
  ball.byColor = new Map<string, number[]>();
  ball.age = new Float64Array(BALL_SEATS);
  ball.tone = new Uint8Array(BALL_SEATS * 3);
  ball.seq = 0;
  ball.reserved = 0;
  ball.landAt = new Float64Array(BALL_SEATS);
  ball.landMs = new Float64Array(BALL_SEATS);
  ball.rippleSeat = -1;
  ball.rippleAt = 0;
  ball.fresh = new Int32Array(BALL_SEATS);
  ball.freshN = 0;
  ball.freshIn = new Uint8Array(BALL_SEATS);
  ball.selfRing = new Int32Array(Math.max(1, SELF_KEEP)).fill(-1);
  ball.selfRingN = 0;
}

/** 飛び終わった💎を席へ貼る。貼る絵と、その鏡を塗ってある色はここで1回だけ引く（毎フレーム引くと重い）。
 *  着いた時刻と、その席の光の長さ（既定は LAND_FLASH_MS）を席に書く。手前の席はその長さをかけて強い光から通常へ戻り、
 *  奥の席は WALL_FRESH_MS の間「着いたばかり」として壁に必ず粒を出す */
export function landOnSeat(ball: Ball, slot: number, rgb: [number, number, number], now: number, flashMs = LAND_FLASH_MS) {
  const tone = mirrorToneFor(rgb);
  ball.sprites[slot] = mirrorSpritesFor(rgb);
  ball.tone[slot * 3] = Math.round(tone[0]);
  ball.tone[slot * 3 + 1] = Math.round(tone[1]);
  ball.tone[slot * 3 + 2] = Math.round(tone[2]);
  ball.rgb[slot * 3] = rgb[0];
  ball.rgb[slot * 3 + 1] = rgb[1];
  ball.rgb[slot * 3 + 2] = rgb[2];
  ball.landAt[slot] = now;
  ball.landMs[slot] = flashMs;
  if (!ball.freshIn[slot]) { ball.freshIn[slot] = 1; ball.fresh[ball.freshN++] = slot; }
}

/** そのコマの球の見え方と光の向き。鏡を描く所・壁の粒・飛んでいる💎が同じ値を見る。
 *  毎コマ作り直さず、中身だけ書き換える */
export type BallView = {
  cx: number; cy: number; r: number;
  cs: number; sn: number; ct: number; st: number;
  tileK: number; tileV: number;
  Lx: number; Ly: number; Lz: number;
  lat: Float32Array;
  filled: number;
  flash: boolean;
};
export function createBallView(): BallView {
  return {
    cx: 0, cy: 0, r: 0, cs: 1, sn: 0, ct: 1, st: 0, tileK: 0, tileV: 0,
    Lx: 0, Ly: 0, Lz: 0, lat: new Float32Array(0), filled: 0, flash: true,
  };
}

/** 2. 球の表面: 縦の軸まわりに回して少し傾け、土台の暗い球を描いてから、
 *     手前側の席へ鏡を1枚ずつ貼る。鏡は球の表面に貼り付いた平らなものなので隣と重ならず、
 *     別の紙も並べ替えも要らない。奥側の鏡は土台の球に隠れるので描かない。
 *     ついでに、壁に映る粒の元になる席（光を受けている奥側の席）を onBack へ渡す。
 *     1つの席から、光源の数だけ粒が出る */
export function drawMirrors(
  ctx: CanvasRenderingContext2D,
  ball: Ball,
  view: BallView,
  W: number,
  H: number,
  dpr: number,
  v: { x: number; y: number; w: number; h: number },
  now: number,
  onBack: ((slot: number, x1: number, y2: number, z2: number, tileU: number) => void) | null,
) {
  const { cx, cy, r, cs, sn, ct, st, tileK, tileV, Lx, Ly, Lz, lat, filled, flash } = view;
  const occ = ball.occ;
  if (filled <= 0) return;
  const half = tileV * 0.6;   // 画面からはみ出した鏡を弾くための目安（横幅は段の間隔の1.2倍まで）
  // 自分の💎が着いた合図（2番）の進み。-1＝出ていない
  let rippleQ = -1;
  if (RIPPLE_STYLE === 2 && ball.rippleSeat >= 0) {
    const q = (now - ball.rippleAt) / RIPPLE_MS;
    if (q < 1) rippleQ = q; else ball.rippleSeat = -1;
  }
  const rippleUnit = Math.max(1e-6, tileV / r);   // 鏡の高さを、球の半径を1とした長さに直したもの
  // 土台の暗い球。鏡はこの上に貼るので、先に塗っておく
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#171a21";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  for (let k = 0; k < filled; k++) {
    const slot = occ[k];
    const sp = ball.sprites[slot];
    if (!sp) continue;
    const o = slot * 4;
    const x1 = lat[o] * cs + lat[o + 2] * sn;
    const z1 = -lat[o] * sn + lat[o + 2] * cs;
    const y2 = lat[o + 1] * ct - z1 * st;
    const z2 = lat[o + 1] * st + z1 * ct;
    const sx = cx + x1 * r, sy = cy - y2 * r;
    // 鏡の横幅。奥側の席では、壁に映る粒の大きさを決めるのにも使う
    const tileU = Math.max(BALL_TILE_MIN, tileK * lat[o + 3]);
    if (z2 <= 0) {
      // 奥側の鏡。壁に映る粒の元はこちら（wall.ts の takeBackSeat）。
      // 鏡は球の表面から出っ張らないので、奥側の分は描かない
      if (onBack) onBack(slot, x1, y2, z2, tileU);
      continue;
    }
    if (sx < -half || sx > W + half || sy < -half || sy > H + half) continue;
    // 鏡がまるごと動画の中に入る＝動画に隠れて見えないので描かない（動画の縁にかかる鏡は裏を通るだけ）
    if (sx - half > v.x && sx + half < v.x + v.w && sy - half > v.y && sy + half < v.y + v.h) continue;
    const d = x1 * Lx + y2 * Ly + z2 * Lz;
    // 鏡は球に接する平面に貼られている。その平面の「北向き」と「東向き」を画面に写した2本を、
    // そのまま絵の縦と横の向きに使う＝正面の鏡は素の丸、縁へ行くほど潰れて見える。
    // 帯の緯度（lat[o+1]）は回しても傾けても変わらないので、北向きの計算にそのまま使える
    const ap = lat[o + 1];
    const q = Math.sqrt(Math.max(1e-4, 1 - ap * ap));
    const nx = (-ap * x1) / q, ny = (ct - ap * y2) / q, nz = (st - ap * z2) / q;
    const ex = ny * z2 - nz * y2, ey = nz * x1 - nx * z2;
    ctx.globalAlpha = d > 0 ? BALL_DIM + (1 - BALL_DIM) * d : BALL_DIM;
    // 画面の y は下向きなので、縦方向は符号を裏返す
    ctx.setTransform(ex * tileU * dpr, -ey * tileU * dpr, -nx * tileV * dpr, ny * tileV * dpr, sx * dpr, sy * dpr);
    // 光を返す向きに来た鏡は、白さの段を上げた絵に差し替える＝白い帯が流れて光る
    let fs = flash && d > MIRROR_HL_CUT
      ? Math.min(MIRROR_FLASH - 1, 1 + Math.floor(((d - MIRROR_HL_CUT) / (1 - MIRROR_HL_CUT)) * (MIRROR_FLASH - 1)))
      : 0;
    // 着いた瞬間の手応え。いちばん白い段の絵に差し替え、LAND_FLASH_MS かけて通常へ戻す。
    // 戻り方は直線ではなく、ゆっくり動き出してゆっくり収まる曲線。貼る回数は増えない（差し替えだけ）
    const la = ball.landAt[slot];
    if (la > 0) {
      const q = 1 - (now - la) / (ball.landMs[slot] || LAND_FLASH_MS);
      if (q > 0) fs = Math.max(fs, Math.round(q * q * (3 - 2 * q) * (MIRROR_FLASH - 1)));
    }
    // 自分の💎が着いた合図（2番）: 着いた席から広がる波に乗った鏡だけ、白さの段を上げる
    if (rippleQ >= 0 && slot !== ball.rippleSeat) {
      const ro = ball.rippleSeat * 4;
      const ddx = lat[o] - lat[ro], ddy = lat[o + 1] - lat[ro + 1], ddz = lat[o + 2] - lat[ro + 2];
      const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) / rippleUnit;   // 鏡の高さを1とした距離
      const wave = 0.6 + (RIPPLE_R - 0.6) * rippleQ;                            // 波の今の半径
      const near = 1 - Math.min(1, Math.abs(dist - wave) / 0.9);                // 波の上なら1、離れるほど0
      if (near > 0) fs = Math.max(fs, Math.round(near * (1 - rippleQ) * (MIRROR_FLASH - 1)));
    }
    ctx.drawImage(sp[fs], -0.5, -0.5, 1, 1);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
}

/** 自分の💎が着いた合図を出す。飛び終わって席に鏡を置いた時に呼ぶ */
export function markSelfLanding(ball: Ball, seat: number, now: number) {
  ball.rippleSeat = seat;
  ball.rippleAt = now;
}

/** 自分の💎が着いた合図（1番＝輪、3番＝ぼんやりした光）を、鏡の上に描く。2番は drawMirrors の中で鏡そのものを光らせる。
 *  輪も光も、鏡と同じ「席に接する面の東向き・北向きを画面に写した2本」で描く＝球の表面に貼り付いて見える。
 *  色は白（モノクロ）。球の円の中だけに出す */
export function drawSelfRipple(ctx: CanvasRenderingContext2D, ball: Ball, view: BallView, dpr: number, now: number) {
  if (RIPPLE_STYLE !== 1 && RIPPLE_STYLE !== 3) return;
  if (ball.rippleSeat < 0) return;
  const q = (now - ball.rippleAt) / RIPPLE_MS;
  if (q >= 1) { ball.rippleSeat = -1; return; }
  const { cx, cy, r, cs, sn, ct, st, tileV, lat } = view;
  const o = ball.rippleSeat * 4;
  const x1 = lat[o] * cs + lat[o + 2] * sn;
  const z1 = -lat[o] * sn + lat[o + 2] * cs;
  const y2 = lat[o + 1] * ct - z1 * st;
  const z2 = lat[o + 1] * st + z1 * ct;
  if (z2 <= 0) return;
  const sx = cx + x1 * r, sy = cy - y2 * r;
  const ap = lat[o + 1];
  const qq = Math.sqrt(Math.max(1e-4, 1 - ap * ap));
  const nx = (-ap * x1) / qq, ny = (ct - ap * y2) / qq, nz = (st - ap * z2) / qq;
  const ex = ny * z2 - nz * y2, ey = nz * x1 - nx * z2;
  const ease = q * (2 - q);                                   // 速く広がって、ゆっくり止まる
  const rad = tileV * (0.6 + (RIPPLE_R - 0.6) * ease);
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.setTransform(ex * rad * dpr, -ey * rad * dpr, -nx * rad * dpr, ny * rad * dpr, sx * dpr, sy * dpr);
  if (RIPPLE_STYLE === 1) {
    ctx.globalAlpha = RIPPLE_ALPHA * (1 - q) * (1 - q);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = (tileV * 0.16 * (1 - q) + 1) / rad;      // 太さは画面の px で決め、単位円の座標へ直す
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.5, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalAlpha = RIPPLE_ALPHA * (1 - q);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
