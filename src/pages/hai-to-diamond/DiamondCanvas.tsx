// 💎が上から降って画面の下に積もり、曲が進むとカメラが引いて山が動画の背景になるキャンバス。
//
// 描く場所のルール（YouTube API 規約）: 動画プレイヤーの上には何も描かない。
// このキャンバスは動画の裏（z-index 下）に置き、光の類は描画時に動画の矩形をクリップで除外する。
// 💎そのものは動画の裏を通る（隠れる）だけで、動画の上には出ない。
//
// 表示の方式は2つあり、setMode で選ぶ（既定は "pile"＝今までの山）。
//   pile        … 💎が上から降って画面の下に積もる。カメラが引いて山が動画の背景になる。
//   mirrorball  … 曲の歌詞のミラーボール。💎は積もらず動画の中心へ吸い込まれ、動画の裏で球の表面に貼られた鏡の板になる。
//                  本物のミラーボールと同じで、球の大きさも席の数も変わらない。曲が進むにつれてカメラが寄っていき、
//                  はじめは動画の裏にすっぽり隠れている球が、途中から上下に覗き、終わりには画面からはみ出して回る。
//                  席が全部埋まった後に押された分は、同じ色の板のうちいちばん古いものに貼り替わる。
//                  壁（動画と額縁の外の画面全体）に映る色の粒は、球の向こう側＝奥の面が返した光なので、
//                  こちらを向いている手前の板とは逆向きに流れる。
//                  曲の最後は、その粒がその場で星になり、球の板も夜空へ散って星空になる。
//                  この方式ではカメラの引き寄り・山の帳簿・焼き込みの絵は使わない。
//
// 世界座標: カメラ倍率1のときの画面座標と同じ。y は画面上端=0 で下へ正。
// カメラの軸は「床（画面の下端）」。引くほど山は画面の下に縮んで留まり、動画（固定）の下に収まる。
// 動画の中心を軸にすると、引くほど山の頂上が動画の中心に寄ってしまい、山を動画の下に留められない。
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
// 💎の絵はここから受け取る。落ちてくる💎と積もった💎は、屈折・全反射・分散まで計算した本物（gemRenderer.ts）。
// まだ焼けていない色と、WebGL が使えない端末では、今までの平らな面の絵（gemFacets.ts）が返る。
// gemFacets.ts に面の形のデータを1本化した。入口の大きな💎は今までのまま。
// ミラーボールの席も本編は立体の石で、焼き上がっていない色だけ上から見た板の絵が代役に立つ
import { hexToRgb } from "./gemFacets";
import {
  getStoneSprites, requestStoneSpritesByHex, stoneIndex, warmUpGemRenderer, SPRITE_LIGHT, TUMBLE_PATHS, requestAllStoneSprites,
  STONE_PX, STONE_AXIS, STONE_FACE_INDEX, STONE_LOCAL_PX, stoneIndexForDepth, stoneGeneration, hasRealStoneSprites,
} from "./gemSprites";
import { DIAMOND_COLOR_ORDER, findDiamondMember } from "./members";
// ミラーボールの席を色ごとにまとめるための、目に見える色の近さの物差しと、色ごとの居場所
import { colorDistance, colorHome, type ColorHome, type Rgb } from "./ballColors";

export type DiamondCanvasApi = {
  /** その色の💎を1つ、画面の上から降らせる。速さ・回転の向きと速さは1つずつ違う。
   *  self=true は自分の💎: 画面内の上寄りに出て、出た瞬間にピカッと光る（押した手応え） */
  spawn: (color: string, self?: boolean) => void;
  /** 動画の現在時刻と総尺（秒）。カメラの引き・寄りに使う */
  setTime: (t: number, duration: number) => void;
  /** 山・降っている💎・カメラをすべて最初の状態に戻す（「最初に戻る」→ もう一度はじめる時） */
  reset: () => void;
  /** 色ごとの曲全体の総数（色のhex → 個数）。額縁の順位を「その色の普段の量と比べた倍率」で決めるための基準 */
  setColorTotals: (totals: Record<string, number>) => void;
  /** 直前に spawn した自分の💎を取り消す（触れた瞬間に降らせたが、指が滑ってスワイプだった時）。まだ落ちている途中のものだけ消す */
  undoLastSpawn: () => void;
  /** いま自分が選んでいる色。getPeakTime を色の指定なしで呼んだ時の既定になる（色を替えるたびに呼ぶ） */
  setOwnColor: (hex: string) => void;
  /** その色の倍率が曲中で最大だった動画時刻（秒）。まだ無ければ null。
   *  記録は色ごとに全部覚えているので、hex を渡せば選んでいない色の瞬間も引ける。省略時はいま自分が選んでいる色 */
  getPeakTime: (hex?: string) => number | null;
  /** カメラを今の状態で止める（ハイライト再生中に引き直さないように）。reset で解除 */
  setHoldCamera: (on: boolean) => void;
  /** 積もった山を一斉に夜空へ放って星空にする（曲の最後のフレーズ「Let's Shine Together!」）。
   *  山は空になり、以後に降る💎も積もらずそのまま星になる。カメラもここで止まる。1回だけ効く（reset で戻る） */
  launchToSky: () => void;
  /** 表示の方式を選ぶ。既定は "pile"（今までの山）。"mirrorball" は💎が動画に吸い込まれて球になる。
   *  「はじめる」の前に呼ぶ想定。途中で替えても壊れないが、それまでの山や球は画面から消え、カメラは倍率1に戻る */
  setMode: (mode: DiamondMode) => void;
};

/** 表示の方式。"pile"＝💎が降って積もる山、"mirrorball"＝動画の裏に集まる球 */
export type DiamondMode = "pile" | "mirrorball";

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
  /** 飛び方の通り道（0〜TUMBLE_PATHS-1）。💎ごとに抽選して、その💎の一生の間は変わらない。
   *  ang がその通り道のどこまで進んだかを表し、倒れ具合と回りが一緒に変わる＝転がって見える */
  path: number;
  /** 画面の上での向き(rad)。💎ごとにばらばらに寝かせる＝みんなが同じ姿勢で降りてこない */
  roll: number;
  size: number;
  rgb: [number, number, number];
  settled: boolean;
  seed: number;
  /** 着地先（世界座標）。降る前に決めて、隙間なく詰まる位置へはめ込む */
  tx: number;
  ty: number;
};

/** 夜空へ飛んでいる粒（画面座標）。飛び終わると星になって、星空の1枚の絵へ焼き込まれる */
type SkyFly = {
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
/** ミラーボール方式で、動画の中心へ吸い込まれている途中の💎（画面座標）。
 *  行き先は覚えず、描く時に毎回いまの動画の中心を見る＝再生中に画面の高さが変わっても狙いがずれない */
type Suck = {
  x0: number; y0: number;   // 出発（画面座標）
  t0: number;               // 飛び始めた時刻(ms)
  dur: number;              // 吸い込まれるまでの時間(ms)
  ang: number;              // 出た時の向き(rad)
  flight: number;           // 飛び方（FLIGHT_STYLES の何番か）。押した時に引いて、着くまで変わらない
  path: number;             // 飛び方の通り道（0〜TUMBLE_PATHS-1）
  roll: number;             // 画面の上での向き(rad)
  size: number;
  rgb: [number, number, number];
  /** 進む道の膨らみ(px)。まっすぐ吸い込まれず、横へ少し逸れてから中心へ向かう。他の人の分は0（まっすぐ） */
  bow: number;
  /** 自分が押した分。取り消し（スワイプの空振り）で消せるようにする */
  self: boolean;
  /** はまる席の番号。押した時点で決まり、着くまで変わらない */
  seat: number;
  /** その席は取った時に空いていたか。取り消し（スワイプの空振り）で元へ戻すのに使う */
  seatWasEmpty: boolean;
  /** 貼り替えだった時の、元の色と、取る前にその席が塗られていた順番。取り消しの時だけ使う */
  seatPrevRgb: [number, number, number];
  seatPrevAge: number;
  /** いまの行き先（画面座標）。席が見えているならその席、見えていないなら動画の中心。
   *  席は回転で動くので毎フレーム測り直し、少しずつ寄せる＝行き先が変わっても飛び方が跳ばない */
  tx: number; ty: number;
  /** 行き先を一度でも決めたか（false のうちは寄せずに直接そこへ置く） */
  aimed: boolean;
  /** 席へ飛ぶ（＝はめ込まれる様子が見える）か、今までどおり動画の中心へ飛んで隠れるか。
   *  押した直後の1フレーム目に、席が手前側で動画の外にあるかどうかで決めて以後は変えない */
  toSeat: boolean;
};
/** ミラーボールの球。球の大きさも席の数も固定で、変わるのは「どの席が埋まっているか」と、カメラの寄り具合だけ。
 *  zoom=いまのカメラの寄り（見かけの大きさは BALL_R × zoom）、
 *  sprites/rgb=各席に入っている💎の絵と色（空きは null）。席の位置は席の格子の並び、
 *  どの席を取るかは押された色で決まる（同じ色の席の隣を選ぶ） */
type Ball = {
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
  /** 席に貼ってあるのがどちらの絵か。0＝板・1＝石。
   *  貼り方も明暗の付け方も別なので、描く時にここで振り分ける。空いている席の中身は見ない */
  kind: Uint8Array;
  /** 席へ貼った絵が「何代目」のものか。色の本物が焼き上がるたびに元の数が1増えるので、
   *  この数とずれていたら、埋まっている席の絵をまとめて引き直す。毎フレーム引きに行かないための目印 */
  spriteGen: number;
};
/** 夜空の星（画面座標）。位置は星空の絵へ焼き込んだ後も、瞬きの抽選のために覚えておく */
type SkyStar = { x: number; y: number; d: number; rgb: [number, number, number] };

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
const FINALE_TIME = 206;       // 動画時刻 3:26（曲が一番盛り上がる所）からゆっくり寄り始める（Hop指定 2026-09-06。Live Edit. でも同じ所で良いとHop確認 2026-09-07）
const FLOOR_DEPTH = 1.0;       // 床の位置（画面高さの倍数）。カメラの軸が床なので 1.0＝画面の下端が床
const PILE_MAX_ON_SCREEN = 0.7; // 山の頂上が画面のこの高さ（画面高さの倍数）を超えたら、床を画面の下へ送り出して頂上をこの線に留める。
                                // 終盤に寄った時、山が画面をはみ出すと降ってくる💎が画面の外で着地して見えなくなる（Hop報告 2026-09-07）【仮】
                                // 寄りそのものを抑える方式は、山が大きいと最大の引きより引いてしまい両端に帯状の空白ができた（Hop報告 2026-09-07・2回目）
const FRAME_BASE: [number, number, number] = [0x1a, 0x1d, 0x24]; // 額縁の地色
const TINT_WINDOW_MS = 2500;   // 「その瞬間いちばん多い色」を数える直近の幅【仮】
const TINT_STRENGTH = 0.45;    // 額縁の地色にその色をどれだけ混ぜるか（0=地色のまま、1=その色そのもの）【仮】
const TINT_SLOTS = 4;          // 額縁に並べる色の数（4声コーラスに合わせて上位4色・Hop決定 2026-09-07）
const TINT_BASE_TOTAL = 200;   // 順位を「直近の数 ÷ その色の曲全体の総数」で決める時に、総数に履かせる下駄。
                               // 参加者がごく少ない色が1回押されただけで跳ね上がるのを抑える【仮】（Hop決定 2026-09-07: 人数の偏りをそのまま出さない）
const MAX_DPR = 2;             // 描く画面の細かさの上限。3倍の端末で画素が2.25倍になり発熱の元になる。焼き込みの絵と同じ上限【仮】
const COL_W = 10;              // 積もり高さの帳簿の列幅
const PACK_RADIUS = 0.6;       // 積もり計算で💎を丸い粒とみなす時の半径（size 倍）。見た目の半径(約1.0)より小さくして深く重ねる＝「ぎっしり」【仮】
const SLOPE = 0.06;            // 山の傾き。小さいほど平らで、瓶に詰めるように下から隙間なく埋まる【仮】
const NEAR_SPAWN = 0.5;        // 散らした位置の近くに落とす強さ。小さいと一番低い所（引いた直後は画面の端）に集まり、動画の周りが寂しくなる【仮】
const OUTSIDE_SLOPE = 1.5;     // 画面の端より外へ 1px 出るごとに、積もり高さ何px分の損と数えるか＝端の外の裾野の急さ【仮】
const MAX_GEMS = 4000;         // 配列に持つ💎の上限（焼き込みの絵が作れない環境での保険）
const LIVE_KEEP = 300;         // 1つずつ描き続ける積もった💎の数（山の表面ぶん）。それより古いものは後ろの絵へ焼き込む
const BAKE_BATCH = 200;        // 1フレームで焼き込む上限（一度に大量に描いて引っかからないように）
const BAKE_HEIGHT = 2.0;       // 焼き込み用の絵の高さ（画面高さの倍数・床から上へ）
const BAKE_MAX_AREA = 12e6;    // 焼き込み用の絵の画素数の上限（iOS Safari の1枚あたりの限界より下）

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
const STAR_MIN = 2;              // 星の点の直径(px)
const STAR_RANGE = 2;
const SELF_LAUNCH_Y = 230;       // 放った後の自分の💎の出発点。画面の下端からこれだけ上＝色の帯（下端から約120px）とその下地のはっきり上。140 だと帯の下地の裏に隠れて見えないことがあった（Hop指摘 2026-09-08）【仮】
const SELF_LAUNCH_SPREAD = 40;   // 同上の縦のばらつき。押すたびに同じ高さから出ると、閃光が一直線に並んで機械的に見える
const SKY_SPARK_RATE = 6;        // 星の瞬きの頻度（毎秒）。曲の終わりの山と同じ水準
const SKY_SPARK_RATE_HL = 9;     // ハイライト再生中（選んだ色の星だけ）の頻度
const SKY_SPARK_SIZE = 7;        // 星の瞬きの大きさ（閃光の半径の元・画面座標）
const SKY_FLASH_SIZE = 10;       // 放った後に押した手応えの閃光の大きさ（画面座標）

// ミラーボール方式の値。数字は全部【仮】、実機で見て決める
// 本物のミラーボールは、人が増えても球そのものが大きくなったりはしない。近づいて見れば大きく見えるだけ。
// なので球の大きさも席の数も固定で、曲が進むにつれてカメラが寄っていく（Hop決定 2026-09-08）。
const BALL_SEATS = 840;          // 席（板を貼る場所）の数【仮】。固定。押した💎は色ごとにまとまるように席を取り、
                                 // 満席になったら 同じ色の板のうちいちばん古いものを貼り替える。
                                 // 人が少ないうちは板がまばらなままでよい（Hop了承 2026-09-08）
const BALL_R = 95;               // 球の半径(px)。カメラが寄っていない（拡大率1）時の見かけの大きさ【仮】。
                                 // 390幅の画面なら 動画の高さの半分＋額縁 ≒ 116px なので、曲の始まりは動画の裏にすっぽり隠れる
const BALL_ZOOM_MAX = 2.08;      // 曲の終わりの拡大率【仮】。95 × 2.08 ≒ 198px ＝ 画面の幅の半分を超えて上下からはみ出す。
                                 // 2.6 では実機で大きすぎた（Hop指摘 2026-09-11）ので8割にした
const BALL_ZOOM_EASE = 3;        // 拡大率を目当ての値へ寄せる速さ（1秒あたり）。ハイライト再生で動画の時刻が飛んだ時に、
                                 // 拡大率まで一足飛びに変わらないようにする【仮】
const BALL_SPIN_SEC = 20;        // 縦の軸まわりに1周する秒数
const BALL_TILT = 0.3;           // 軸の傾き(rad)。まっすぐ立っているより少し傾いている方が球に見える
const BALL_TILE_FILL = 1.0;      // 石を貼る大きさ（隣の席との間隔の何倍か）【仮】。石の腰の太さが、ちょうど席の間隔いっぱいになる。
                                 // 石は球へ刺さっているので、隣どうしは横から見ると重なり、真正面から見ると腰が触れ合う。
                                 // 平らな板を貼っていた頃は、板と板の隙間が穴に見えないようこの値を詰めていた（Hop決定 2026-09-08）
const BALL_TILE_MIN = 2.5;       // 板の最小の大きさ(px)。拡大率が低いうちに1px を切ると消えてしまう【仮】
const BALL_HL_CUT = 0.985;       // 板の白い差し替えと、壁の粒の瞬きの倍率に使う。石の瞬きは面ごとの判定 FACET_ で決める。
                                 // 緩めると光る板が増えすぎて、白い塊になって球に見えなくなる
const BALL_DIM = 0.55;           // 光が当たっていない側の明るさ。暗すぎると球が欠けて見える
const SUCK_MS = 700;             // 💎が動画の中心へ吸い込まれるまで
const SUCK_MS_JITTER = 200;      // 同上のばらつき。全部が同じ速さだと機械的に見える
const SUCK_SHRINK = 0.9;         // 吸い込まれる間に縮む割合（1.0で点まで縮む）
// 飛んでいる💎の飛び方。押した時に等しい確率で1つ引き、着くまで変えない（Hop指示 2026-09-11）。
// 進み具合は壁の時計ではなく飛行の進み（0→1）で決める。飛ぶのは0.7〜0.9秒と短いので、
// 1秒あたりの速さで回していた頃は24コマのうち2〜13コマしか進まず、横顔で止まって見えた。
// 絵は焼き直さず、「通り道の上を進める量」と「絵ごと画面の中で回す量」の組み合わせだけで5通り作る。
//   laps   … 通り道の上をいくつ進むか。1＝24コマぶんで一巡
//   turns  … 絵ごと画面の中で何回転させるか
//   quad   … 絵ごとの回りを後ほど速くするか。止まりかけのコマの感じを出す
//   wobble … 絵ごとの回りに足す揺れの大きさ(rad)
//   paths  … 使う通り道の番号。null なら全部から引く
// 数字は全部【仮】
const FLIGHT_STYLES: { laps: number; turns: number; quad: boolean; wobble: number; paths: number[] | null }[] = [
  { laps: 0, turns: 0, quad: false, wobble: 0, paths: null },       // 0 無回転。出発時の向きのまま
  { laps: 0.35, turns: 0, quad: false, wobble: 0, paths: null },    // 1 緩く回る
  { laps: 2.5, turns: 0, quad: false, wobble: 0, paths: [1, 2] },   // 2 勢いよく回る
  { laps: 0.5, turns: 1, quad: true, wobble: 0.35, paths: [2] },    // 3 止まりかけのコマのようにぐらぐら
  { laps: 1, turns: 1, quad: false, wobble: 0, paths: null },       // 4 ひねりながら
];
// 上の paths に書いた番号は gemSprites.ts の通り道の並びに合わせてある。
// 2番は「1周で2回まわる」通り道、3番は「倒れ角の振れ幅が小さい」通り道。
// gemSprites.ts の通り道の並びが変わったらここも直す
const FLIGHT_WOBBLE_CYCLES = 3;  // 揺れの往復の数。飛ぶ間にこの回数だけ行き来する【仮】
// 自分が押した💎の飛び方。他の人の分（画面の縁から出る）とは別に決める。
// 画面の下の方から出して動画の下端よりはっきり下を通し、動画の裏に入るまでは大きさを保つ。
// 以前は横が画面いっぱい・出発点が動画のすぐ下だったので、10回押して9回は出た瞬間に動画の裏へ入って見えなかった（Hop報告 2026-09-08）
const SELF_SUCK_Y = 230;         // 出発点。画面の下端からこれだけ上【仮】
const SELF_SUCK_Y_SPREAD = 40;   // 同上の縦のばらつき。毎回同じ高さから出ると閃光が一直線に並んで機械的に見える
const SELF_SUCK_X_SPREAD = 80;   // 出発点の横のばらつき（画面の中央から左右へこれだけ）【仮】
const SELF_SUCK_MIN_GAP = 40;    // 出発点は必ず「動画の下端＋これだけ」より下にする＝出た瞬間に裏へ入らない【仮】
const SELF_SUCK_MS = 900;        // 動画の中心に着くまで。他の人の分より少し長くして、飛んでいる姿が見えるようにする【仮】
const SELF_SUCK_MS_JITTER = 150; // 同上のばらつき
const SELF_SUCK_BOW = 45;        // 道の膨らみ(px)。まっすぐ吸い込まれず少し弧を描く【仮】
const SELF_SUCK_ENTER = 0.85;    // 飛ぶ時間のうち、この割合をかけて動画の矩形の縁まで進む。
                                 // 残りで矩形の中へ吸い込まれる＝速さが変わる瞬間は動画の裏なので見えない【仮】
// 壁に映る光の粒（Hop決定 2026-09-08）。ここでいう「壁」は動画と額縁の外の画面全体。
// 壁に届く光は、こちらを向いている手前の面ではなく、球の向こう側＝奥の面が返したもの。
// 球が回ると奥の面は画面の上で手前の面と逆向きに動くので、壁の粒も手前の板とは逆向きに流れる
// （Hop指摘 2026-09-08。それまでは手前の板から粒を作っていたので同じ向きに流れていた）。
// 序盤は淡くまばら（球は動画の裏にいて、粒だけが「裏で何か光っている」手掛かり）、
// 終盤は数も大きさも濃さも増して、粒が小さな💎の輪郭を持ち始める。
// 以前あった「裏から漏れる放射状の筋」と「板からの筋」は、車輪の輻のように見えて
// 球の回転と結びつかなかったので、まるごとこの粒に置き換えた
const WALL_SPOT_MAX = 300;       // 一度に壁へ映す粒の数の上限【仮】
const WALL_LIT_MIN = 0.15;       // 奥の板がこれ以上光を受けていないと壁に映らない【仮】。
                                 // 奥の板には「奥から当たる光」を当てて数える＝光の向きの奥行きだけ裏返し、
                                 // 手前の板と同じ考え方で「どれだけ光を返しているか」を測る。
                                 // 本物のミラーボールと同じで光の向きが回るため、壁の半分しか光らないのはそのままでよい（Hop決定 2026-09-08）。
                                 // ただし 0.3 だと粒が4個まで減る瞬間があって寂しかったので、光の当たる範囲を少し広げた
const WALL_LIT_EARLY = -0.5;     // 板がまだ少ない間の足切り【仮】。板が数十枚のうちは、光を受けている板のうち
                                 // さらに画面に収まる位置へ映るものがごく僅かで、粒が2個しか出ないことがあった（Hop報告 2026-09-08）。
                                 // 序盤だけ「うっすら光を受けている板」まで拾って、粒が6〜10個は壁に出るようにする
const WALL_LIT_RAMP = BALL_SEATS; // 板がこの枚数まで増えたら、足切りを通常の WALL_LIT_MIN へ戻しきる【仮】。
                                 // 席が満席になった所でちょうど通常に戻る
const WALL_FADE_BAND = 0.08;     // 足切りのすぐ上の粒は薄くする幅。ふっと現れ・ふっと消える【仮】
const WALL_MAG = 2.4;            // 球の中心から板までの距離を何倍に伸ばした所へ映すか（拡大投影）。
                                 // 距離は見かけの半径（＝カメラの寄りを掛けたもの）なので、寄るほど粒も外へ広がる【仮】。
                                 // 3.0 だと外へ散りすぎて、粒が少ない序盤に画面から出てしまう分が多かったので下げた
const WALL_D_MIN = 20;           // 粒の直径(px)。序盤【仮】
const WALL_D_MAX = 40;           // 同上、終盤【仮】
const WALL_A_MIN = 0.15;         // 粒の濃さ。序盤【仮】
const WALL_A_MAX = 0.35;         // 同上、終盤（主役は動画なので、これより濃くしない）【仮】
const WALL_FULL_AT = 0.945;      // 大きさと濃さが満開になる曲の進み。夜空へ放つ時刻（4:28.5 ÷ 4:44）に合わせてある【仮】
                                 // 以前は「曲の進み」と「球の大きさ」の2つで満開の度合いを決めていたが、
                                 // 球の見かけの大きさ（＝カメラの寄り）も曲の進みで決まるようになったので、二重に数えず進みだけで決める
const WALL_GEM_FROM = 0.8;       // 曲の進みがここを過ぎたら、粒の中心に💎の輪郭（板と同じ絵）を薄く重ねる【仮】
const WALL_GEM_FADE = 0.03;      // 同上の出はじめ。ここを過ぎた瞬間にぱっと現れないよう、この幅だけかけて濃くなる【仮】
const WALL_GEM_SCALE = 0.45;     // その💎の大きさ（粒の直径の何倍か）【仮】
const WALL_GEM_ALPHA = 0.6;      // 同上の濃さ（粒の濃さの何倍か）【仮】
const WALL_FLASH = 2.2;          // 奥の板がちょうど光を返す向きに来た瞬間、その粒を何倍明るくするか【仮】
// 面が光を返した位置に、その面ぶんの小さな光を置く（Hop決定 2026-09-11 案2）。
// 石は球へ刺さった立体なので、光るのは石ぜんたいではなく石の1つの面。
// 席の向き1枚で決めていた頃は、向きの近い隣どうしがかたまりで同時に光り、実機では白く飛んで見えた。
// 面が光るのは、その面の向きが「光と視線のちょうど中間の向き」に近い時。
// 席の向きから見て中間の向きがどの倒れ角・どの方位にあるかを測り、下の4段のどれかの面に近ければその面が光る。
// 光の絵は壁の粒と同じ「色ごとに一度描いたもの」を使うので、貼る回数が増えるだけで絵を作る計算は増えない
const BLOOM_MAX = 96;            // 一度に滲みを出す面の数の上限【仮】
// 石の外を向いた面。頭からの倒れ角（度）と、その段の方位の数・方位のずらし（度）。数字は全部【仮】
//   テーブル 0度 × 1、スター 約20度 × 8で22.5度ずらし、ベゼル 約31度 × 8、上ガードル 約37度 × 16で11.25度ずらし
const FACET_RINGS: { t: number; n: number; off: number }[] = [
  { t: 0, n: 1, off: 0 },
  { t: 20, n: 8, off: 22.5 },
  { t: 31, n: 8, off: 0 },
  { t: 37, n: 16, off: 11.25 },
];
const FACET_TOL_T = 4;           // 面が光ったと見なす倒れ角の許容（度）【仮】
const FACET_TOL_P = 8;           // 同じく方位の許容（度）【仮】
const FACET_FLASH_SCALE = 0.9;   // 光の丸の直径。石の腰の直径の何倍か【仮】
const FACET_FLASH_OFFSET = 0.32; // 光の丸を石の中心から面の向きへずらす量。腰の直径の何倍か【仮】
const FACET_FLASH_ALPHA = 0.85;  // 光の丸の濃さの上限【仮】。面の合い具合を掛ける
const WALL_FACET_CUT = 0.3;      // 面ごとの壁の粒の足切りを wallCut に上乗せする量【仮】
const WALL_FACET_KEEP_DIV = 11;  // 面ごとの粒のくじを辛くする割り算【仮】。33面ぶん増える粒を、今までと同じ程度の数に抑える
// 夜空へ放つ瞬間、壁の粒（直径40px前後）はその場で星（2〜4px）になる。
// 入れ替わりが一瞬だと見た目が飛ぶので、粒が縮みながら星へ入れ替わる時間を挟む（Hop決定 2026-09-08）
const WALL_TO_STAR_MS = 300;     // 粒が縮んで星になるまで【仮】
const WALL_TO_STAR_CORE = 0.22;  // 粒の絵のうち「芯」に見える割合。縮み終わりの粒は 星の直径 ÷ この値 の大きさで貼る
                                 // ＝縮みきった時に、粒の芯の太さが星の点の太さとちょうどそろう【仮】
// 💎の行き先を「動画の中心」から「これから自分がはまる席」に変える（Hop指摘 2026-09-08）。
// 席が手前側で動画の外にあれば、その席へ飛んで板の大きさまで縮み、着いた瞬間に板として貼られる
const SEAT_FOLLOW = 8;           // 席の動きを追いかける速さ（1秒あたり）。席が回転で動画の裏へ入った時に
                                 // 行き先が中心へ移るのも、この速さでなめらかに動く＝飛び先が跳ばない【仮】
const SEAT_FACE_MS = 200;        // 席にはめ込まれる直前のこの時間だけ、飛んでいる💎の絵を
                                 // 「飛んでいる向きの💎」から「その席に収まった時の向きの💎」に差し替える。
                                 // 絵を差し替えるだけで、回して見せる演出はしない（Hop決定 2026-09-08）【仮】

// 積もった💎も落ちてくる💎も、毎フレーム面を計算せず、色×石の向きごとに一度焼いた小さな絵(スプライト)を貼る。
// 数千個積もっても drawImage の回数が増えるだけで、絵を作る計算は増えない（重さ対策）。
// 絵の作り置きと焼く順番は gemSprites.ts が持つ。ここは受け取って貼るだけ。
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
// ミラーボールの表面は、球に貼った平らな板ではなく、球へ刺さった立体の💎にする。
// 貼るのは落ちてくる💎・積もった💎と同じ、焼いてある96枚の絵。窓口は gemSprites.ts の getStoneSprites。
// 席の向きに合う姿勢の1枚を選んで貼るので、球の正面の席は真上から見た姿、縁の席は横顔になり、
// 石が球から生えているように見える。まだ焼けていない色と、立体を描けない端末では、
// 焼き上がるまでの代役として下の板の絵を貼る。

// 板は、その色の立体の絵が焼き上がるまでの間の代役。焼けた色の席は下の石に差し替わる。
// ミラーボールの板の絵: 上から見たブリリアントカットの💎（王冠側）。
// ミラーボールの板は正面（外）を向いているので、横から見た💎を潰して貼るのではなくこの形にする（Hop決定 2026-09-08）。
//
// 外形は八角形ではなく円。石の腰（ガードル）は本物も真上から見ると円で、
// 八角形で切ると留め具のように見えて気持ち悪い（Hop指摘 2026-09-10）。
// 中の面の並びは本物と同じ4種類。
//   テーブル   … 中央の平らな八角形。1枚
//   スター     … テーブルの各辺を底辺にした外向きの三角。8枚
//   ベゼル     … テーブルの角から腰へ伸びる凧形。8枚
//   上ガードル … 腰に沿った細い三角。16枚
// 向きは貼る時の変形で決まるので、回していない絵を色ごとに持つ。面ごとの明るさは
// その面の向き（法線）と光の向きの内積から決める。外へ倒れている面ほど光の差が大きい。
//
// 白い瞬きは別の光を上から重ねるのではなく、「白く光った絵」に差し替えて出す
// ＝板1枚につき貼るのは1回のままで、瞬きのために描く回数が増えない。
// 光らせるのは中央だけではなく面ぜんたい。中央だけ白くすると白目が反転したように見える（Hop指摘 2026-09-08）
const PLATE_PX = 64;             // 絵の1辺。面が増えたので前より細かくした【仮】
const PLATE_FLASH = 5;           // 瞬きの段階の数（0番＝光っていない絵）
const PLATE_R = 0.96;            // 腰（外形の円）の大きさ（絵の枠の何倍か）。枠より少し内側で切って、
                                 // 隣の板との間に細い隙間が見えるようにする（Hop決定 2026-09-08）【仮】
const PLATE_TABLE = 0.50;        // テーブル（中央の八角形）の大きさ（外形の何倍か）【仮】
const PLATE_STAR = 0.76;         // スターの先端が届く高さ（外形の何倍か）【仮】
// 面の倒れ具合。大きいほど寝ていて、光の当たり方の差がはっきりする【仮】
const PLATE_SLOPE_STAR = 0.30;
const PLATE_SLOPE_BEZEL = 0.72;
const PLATE_SLOPE_UG = 1.05;
/** 一番光った時に、どこまで白へ寄せるか。1.0 にすると真っ白な丸になって面が見えなくなる【仮】 */
const PLATE_FLASH_MAX = 0.86;
const plateCache = new Map<string, HTMLCanvasElement[]>();
function getPlateSprites(rgb: [number, number, number]): HTMLCanvasElement[] {
  const key = rgb.join(",");
  let arr = plateCache.get(key);
  if (arr) return arr;
  const L: [number, number, number] = [Math.cos(SPRITE_LIGHT), Math.sin(SPRITE_LIGHT), 0.8];
  const ll = Math.hypot(L[0], L[1], L[2]);
  L[0] /= ll; L[1] /= ll; L[2] /= ll;
  /** 角度 a・半径 r の点 */
  const pt = (a: number, r: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
  /** 面の明るさ k と白の混ぜ具合 w から、塗る色を作る */
  const mix = (k: number, w: number) => {
    const r = rgb[0] * k, g = rgb[1] * k, b = rgb[2] * k;
    return "rgb(" + ((r + (255 - r) * w) | 0) + "," + ((g + (255 - g) * w) | 0) + "," + ((b + (255 - b) * w) | 0) + ")";
  };
  /** その面の明るさ。mid=面が外へ倒れている向き（角度）、slope=倒れ具合。0 なら真正面 */
  const lit = (mid: number, slope: number) => {
    const nx = Math.cos(mid) * slope, ny = Math.sin(mid) * slope;
    const nl = Math.hypot(nx, ny, 1);
    const d = Math.max(0, (nx * L[0] + ny * L[1] + L[2]) / nl);
    return 0.42 + 0.58 * d * d;
  };
  const T = Math.PI * 2;
  const RT = PLATE_R * PLATE_TABLE;    // テーブルの角までの長さ
  const RS = PLATE_R * PLATE_STAR;     // スターの先端までの長さ
  arr = [];
  for (let s = 0; s < PLATE_FLASH; s++) {
    // 白く光っている度合い。真っ白まで振り切ると面の割り付けが消えてただの白丸になるので、手前で止める【仮】
    const fl = (s / (PLATE_FLASH - 1)) * PLATE_FLASH_MAX;
    const c = document.createElement("canvas");
    c.width = PLATE_PX; c.height = PLATE_PX;
    const cx = c.getContext("2d");
    if (cx) {
      cx.translate(PLATE_PX / 2, PLATE_PX / 2);
      cx.scale(PLATE_PX / 2, PLATE_PX / 2);
      const poly = (ps: [number, number][], style: string) => {
        cx.fillStyle = style;
        cx.beginPath();
        ps.forEach((q, i) => (i === 0 ? cx.moveTo(q[0], q[1]) : cx.lineTo(q[0], q[1])));
        cx.closePath();
        cx.fill();
      };
      // 下地。面と面の継ぎ目に地の色が透けないよう、先に円をひと塗りしておく
      cx.fillStyle = mix(lit(0, PLATE_SLOPE_BEZEL), fl);
      cx.beginPath();
      cx.arc(0, 0, PLATE_R, 0, T);
      cx.fill();

      for (let i = 0; i < 8; i++) {
        const aT = (i / 8) * T;              // テーブルの角の向き（＝ベゼルの真ん中）
        const aS = ((i + 0.5) / 8) * T;      // スターの先端の向き（＝上ガードル2枚の境）
        const aSm = ((i - 0.5) / 8) * T;
        // 上ガードル（腰沿いの細い三角）。いちばん外側なので先に塗る
        const gA = pt(aT, PLATE_R), gB = pt(((i + 1) / 8) * T, PLATE_R), gM = pt(aS, PLATE_R);
        const sTip = pt(aS, RS);
        poly([sTip, gA, gM], mix(lit((aT + aS) / 2, PLATE_SLOPE_UG), fl));
        poly([sTip, gM, gB], mix(lit((aS + ((i + 1) / 8) * T) / 2, PLATE_SLOPE_UG), fl));
        // ベゼル（テーブルの角から腰へ伸びる凧形）
        poly([pt(aT, RT), pt(aS, RS), pt(aT, PLATE_R), pt(aSm, RS)], mix(lit(aT, PLATE_SLOPE_BEZEL), fl));
        // スター（テーブルの辺を底辺にした外向きの三角）
        poly([pt(aT, RT), pt(((i + 1) / 8) * T, RT), sTip], mix(lit(aS, PLATE_SLOPE_STAR), fl));
      }
      // テーブル（中央の平らな八角形。まっすぐ正面を向いている）
      poly(Array.from({ length: 8 }, (_, i) => pt((i / 8) * T, RT)), mix(lit(0, 0), fl));

      // 面の境目の細い線。小さく貼っても💎の割り付けが分かるように
      cx.lineWidth = 0.035;
      cx.strokeStyle = fl < 0.4
        ? "rgba(255,255,255," + (0.16 + 0.34 * fl).toFixed(2) + ")"
        : "rgba(0,0,0," + (0.10 + 0.16 * fl).toFixed(2) + ")";   // 白に寄った絵では、白い線は消えるので影の線にする
      cx.beginPath();
      for (let i = 0; i < 8; i++) {
        const aT = (i / 8) * T, aS = ((i + 0.5) / 8) * T;
        cx.moveTo(...pt(aT, RT)); cx.lineTo(...pt(aT, PLATE_R));   // ベゼルの背
        cx.moveTo(...pt(aS, RS)); cx.lineTo(...pt(aS, PLATE_R));   // 上ガードルの境
        cx.moveTo(...pt(aT, RT)); cx.lineTo(...pt(aS, RS));        // スターの辺
        cx.moveTo(...pt(((i + 1) / 8) * T, RT)); cx.lineTo(...pt(aS, RS));
      }
      cx.stroke();
      // 外形（腰）の細い光。円であることが分かるように
      cx.lineWidth = 0.05;
      cx.strokeStyle = "rgba(255,255,255," + (0.32 + 0.5 * fl).toFixed(2) + ")";
      cx.beginPath();
      cx.arc(0, 0, PLATE_R, 0, T);
      cx.stroke();
    }
    arr.push(c);
  }
  plateCache.set(key, arr);
  return arr;
}

// 降っている💎は、以前は「石は回さず光の向きだけ48段階回した絵」を持ち、貼る時に絵ごと回していた。
// 平らな絵のうちは「石を回す」と「絵を回す」が同じ結果になるので成り立っていたが、
// 本物の💎は立体なので、絵ごと回すと石が画面の中で寝転がってしまう。
// そこで積もった💎と同じ「石を回した絵を、回さずに貼る」形に揃えた（gemSprites.ts の getStoneSprites）。

// 夜空の星と、飛んでいる粒の丸。どちらも面の計算はせず、色ごとに一度だけ描いた絵を大きさを変えて貼る。
// 数千個が同時に動くので、1個ごとに描き方を組み立てないのが肝（発熱対策）。
const STAR_PX = 64;
const STAR_CORE = 0.16;   // 絵の中で「点」に見える芯の割合。芯の直径 d の星は d/STAR_CORE の大きさで貼る
const starCache = new Map<string, HTMLCanvasElement>();
const DOT_PX = 32;
const DOT_CORE = 0.45;    // 同上（粒は芯が大きく、滲みは狭い）
const dotCache = new Map<string, HTMLCanvasElement>();
function makeRadial(px: number, stops: [number, string][]): HTMLCanvasElement {
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
function getStar(rgb: [number, number, number]): HTMLCanvasElement {
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
function getDot(rgb: [number, number, number]): HTMLCanvasElement {
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
/** 夜空の行き先（画面座標）。画面全体に散らし、縦は上の方が少し密になるよう偏らせる */
function skyTarget(W: number, H: number): { x: number; y: number } {
  return { x: Math.random() * W, y: H * Math.pow(Math.random(), SKY_Y_BIAS) };
}

// 面ごとの三角関数は毎コマ計算しない。読み込んだ時に1回だけ、面ごとの
// 倒れ角の cos・sin と、方位の cos・sin を控えに作っておいて引くだけにする。
// FACET_RING_BASE は段ごとの、いちばん若い面の番号
const D2R = Math.PI / 180;
const FACET_RING_BASE = new Int32Array(FACET_RINGS.length);
const FACET_COUNT = (() => {
  let n = 0;
  for (let i = 0; i < FACET_RINGS.length; i++) { FACET_RING_BASE[i] = n; n += FACET_RINGS[i].n; }
  return n;
})();
const FACET_COS_T = new Float32Array(FACET_COUNT);
const FACET_SIN_T = new Float32Array(FACET_COUNT);
const FACET_COS_P = new Float32Array(FACET_COUNT);
const FACET_SIN_P = new Float32Array(FACET_COUNT);
(() => {
  let fi = 0;
  for (const ring of FACET_RINGS) {
    const tr = ring.t * D2R;
    for (let k = 0; k < ring.n; k++, fi++) {
      const pr = (ring.off + (k * 360) / ring.n) * D2R;
      FACET_COS_T[fi] = Math.cos(tr); FACET_SIN_T[fi] = Math.sin(tr);
      FACET_COS_P[fi] = Math.cos(pr); FACET_SIN_P[fi] = Math.sin(pr);
    }
  }
})();
/** 席の向きのまわりの基準の向き2本。方位を測る物差しになる。
 *  向き1本目を 0〜2、2本目を 3〜5 へ書き込む。作り置きの控えに書くので、呼ぶたびに入れ物を作らない */
const facetBasis = new Float32Array(6);
function setFacetBasis(ax: number, ay: number, az: number) {
  let ux = 0, uy = 1;
  if (Math.abs(ay) > 0.95) { ux = 1; uy = 0; }
  const dot = ux * ax + uy * ay;
  let t0x = ux - dot * ax, t0y = uy - dot * ay, t0z = -dot * az;
  const tl = Math.hypot(t0x, t0y, t0z) || 1;
  t0x /= tl; t0y /= tl; t0z /= tl;
  facetBasis[0] = t0x; facetBasis[1] = t0y; facetBasis[2] = t0z;
  facetBasis[3] = ay * t0z - az * t0y;
  facetBasis[4] = az * t0x - ax * t0z;
  facetBasis[5] = ax * t0y - ay * t0x;
}
/** 光った面の合い具合 q と、その面の向き。0 が q、1〜3 が向きの x,y,z */
const facetFlash = new Float32Array(4);
/** 席の向き a から見て、光と視線の中間の向き h がどの倒れ角・どの方位にあるかを測り、
 *  FACET_RINGS の4段のどれかの面に近ければ、その面を facetFlash へ書いて true を返す。
 *  複数の段に当たった時は、合い具合のいちばん良い面を採る。
 *  spin は席ごとの石の回り。facetBasis も一緒に埋まるので、呼んだ後はそのまま読める */
function findLitFacet(ax: number, ay: number, az: number, hx: number, hy: number, hz: number,
                      spin: number, spinCos: number, spinSin: number): boolean {
  const cosT = ax * hx + ay * hy + az * hz;
  const theta = Math.acos(Math.max(-1, Math.min(1, cosT))) / D2R;
  setFacetBasis(ax, ay, az);
  const t0x = facetBasis[0], t0y = facetBasis[1], t0z = facetBasis[2];
  const t1x = facetBasis[3], t1y = facetBasis[4], t1z = facetBasis[5];
  const px = hx - cosT * ax, py = hy - cosT * ay, pz = hz - cosT * az;
  const phi = (Math.atan2(px * t1x + py * t1y + pz * t1z, px * t0x + py * t0y + pz * t0z) + spin) / D2R;
  let bestQ = -1, bestFi = -1;
  for (let ri = 0; ri < FACET_RINGS.length; ri++) {
    const ring = FACET_RINGS[ri];
    const dT = Math.abs(theta - ring.t);
    if (dT > FACET_TOL_T) continue;
    let q: number, fi: number;
    if (ring.n === 1) {
      // テーブルは1枚しかないので方位を問わない
      q = 1 - dT / FACET_TOL_T;
      fi = FACET_RING_BASE[ri];
    } else {
      const step = 360 / ring.n;
      const k = Math.round((phi - ring.off) / step);
      let dP = Math.abs(phi - (ring.off + k * step)) % 360;
      if (dP > 180) dP = 360 - dP;
      if (dP > FACET_TOL_P) continue;
      q = (1 - dT / FACET_TOL_T) * (1 - dP / FACET_TOL_P);
      fi = FACET_RING_BASE[ri] + (((k % ring.n) + ring.n) % ring.n);
    }
    if (q > bestQ) { bestQ = q; bestFi = fi; }
  }
  if (bestFi < 0) return false;
  // 面の向きを組み立てる。方位は席ごとの回りのぶんだけ戻す
  const cosPr = FACET_COS_P[bestFi] * spinCos + FACET_SIN_P[bestFi] * spinSin;
  const sinPr = FACET_SIN_P[bestFi] * spinCos - FACET_COS_P[bestFi] * spinSin;
  const ctf = FACET_COS_T[bestFi], stf = FACET_SIN_T[bestFi];
  facetFlash[0] = bestQ;
  facetFlash[1] = ctf * ax + stf * (cosPr * t0x + sinPr * t1x);
  facetFlash[2] = ctf * ay + stf * (cosPr * t0y + sinPr * t1y);
  facetFlash[3] = ctf * az + stf * (cosPr * t0z + sinPr * t1z);
  return true;
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
 *  a の4つ目と v が、そのまま板の横幅・高さの元になる。
 *  rank=席の番号から order の何番目かを引く表、lon=席の経度（色ごとの居場所と見比べるのに使う）。
 *  nbrStart/nbr=隣り合う席の一覧。席 s の隣は nbr[nbrStart[s]] から nbr[nbrStart[s+1]-1] まで。
 *  この一覧は起動時に1回だけ作って使い回す（押すたびに隣を計算し直さない）。
 *  seatSpin=席ごとの石の回り（頭のまわりのどこを向いて刺さっているか）と、その cos・sin の控え。
 *  面ごとの光り方を測る時に、方位の基準をこのぶんだけずらす */
type BallLattice = {
  seats: number; a: Float32Array; order: Int32Array; v: number;
  rank: Int32Array; nbrStart: Int32Array; nbr: Int32Array; lon: Float32Array;
  seatSpin: Float32Array; spinCos: Float32Array; spinSin: Float32Array;
};
let ballLattice: BallLattice | null = null;
function buildBallLattice(): BallLattice {
  const N = BALL_SEATS;
  // 帯の本数は「板が正方形になる本数」から逆算する（合計はおよそ 4B²/π 席になる）
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
  const v = Math.PI / B;   // 段と段の間隔（rad）。半径を掛けると板の高さになる
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
    // 横の間隔は帯の円周を席の数で割ったもの。極に近い段は円周が短いので、そのぶん板も細くなる
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
  // 席ごとの石の回り。石は席の向きへ刺さっているが、頭のまわりのどこを向いているかは席ごとに違う。
  // 絵の中の面の並びと厳密には一致しない。見た目の散り方を作るための代え【仮】。
  // 乱数の種は固定＝起動のたびに散り方が変わらない
  const seatSpin = new Float32Array(N);
  const spinCos = new Float32Array(N);
  const spinSin = new Float32Array(N);
  const rnd2 = ballRandom(19990705);
  for (let i = 0; i < N; i++) {
    const sp = rnd2() * Math.PI * 2;
    seatSpin[i] = sp;
    spinCos[i] = Math.cos(sp);
    spinSin[i] = Math.sin(sp);
  }
  return { seats: N, a, order: ord, v, rank, nbrStart, nbr, lon, seatSpin, spinCos, spinSin };
}
function getBallLattice(): BallLattice {
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
    if (!ball.taken[s]) continue;
    if (ball.age[s] < fbAge) { fbAge = ball.age[s]; fb = s; }
  }
  return fb;
}
/** 押された💎の席を1つ取る。戻り値は取り消し（スワイプの空振り）で元へ戻すための控え */
function reserveSeat(ball: Ball, rgb: Rgb): { seat: number; wasEmpty: boolean; prevRgb: [number, number, number]; prevAge: number } {
  const lv = getBallLattice();
  const N = lv.seats;
  const key = rgb.join(",");
  const home = colorHome(rgb);
  let seat = -1;
  if (!SEAT_CLUSTER) {
    // 公開中の本番と同じ決め方。決まった混ぜ順を前から使い、一周したら古い席から上書きする
    seat = lv.order[ball.reserved % N];
    ball.reserved++;
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
  return { seat, wasEmpty, prevRgb, prevAge };
}
/** 取った席を返す（取り消し）。空席だった席は空席へ、貼り替えだった席は元の色と塗られた順番へ戻す */
function releaseSeat(ball: Ball, seat: number, wasEmpty: boolean, prevRgb: [number, number, number], prevAge: number) {
  if (!SEAT_CLUSTER) ball.reserved = Math.max(0, ball.reserved - 1);
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
/** カメラの寄り具合。曲の進み p が 0 → 1 の間に 1.0 → BALL_ZOOM_MAX へ。
 *  序盤はゆっくり、中盤で覗き始め、終盤ではっきりはみ出す（ゆっくり動き出してゆっくり止まる曲線） */
function ballZoomFor(p: number): number {
  const q = Math.min(1, Math.max(0, p));
  return 1 + (BALL_ZOOM_MAX - 1) * q * q * (3 - 2 * q);
}

const DiamondCanvas = forwardRef<DiamondCanvasApi, Props>(function DiamondCanvas({ videoBoxRef, frame, reduceMotion = false }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** 押した瞬間の閃光（世界座標）。短時間で消える */
  const flashesRef = useRef<{ x: number; y: number; t0: number; rgb: [number, number, number]; size: number }[]>([]);
  /** 直近に降った💎の色の控え。その瞬間いちばん多い色で額縁を染めるのに使う（名前も数字も出さない・Hop決定 2026-09-07） */
  const recentRef = useRef<{ t: number; key: string; rgb: [number, number, number] }[]>([]);
  /** 色ごとの曲全体の総数（"r,g,b" → 個数）。額縁の順位の基準。読み込み前は空＝全色同じ基準 */
  const colorTotalsRef = useRef<Map<string, number>>(new Map());
  /** いま自分が選んでいる色（"r,g,b"）。getPeakTime の既定の引き先 */
  const ownKeyRef = useRef<string | null>(null);
  /** 色ごとの「一番輝いた瞬間」。"r,g,b" → その色の倍率が最大だった時刻と、その時の倍率。
   *  自分の色だけでなく全色ぶん覚える＝ハイライト再生中に色を切り替えても、その色の瞬間へ飛べる */
  const peakRef = useRef<Map<string, { t: number; s: number }>>(new Map());
  const holdCameraRef = useRef(false);
  /** 額縁の区画（左から順位順）のいまの色と幅の割合（なめらかに移り変わる） */
  const frameSlotsRef = useRef(Array.from({ length: TINT_SLOTS }, () => ({ rgb: [...FRAME_BASE] as [number, number, number], w: 0 })));
  const reduceMotionRef = useRef(reduceMotion);
  useEffect(() => { reduceMotionRef.current = reduceMotion; }, [reduceMotion]);
  // 宝石を描く道具の支度（形の組み立て・環境の描画・計算式の組み上げ）を、画面を開いた直後に済ませておく。
  // 「はじめる」を押した瞬間は動画の再生を最優先にしたいので、そこに重い処理を残さない
  useEffect(() => {
    warmUpGemRenderer();
    // 出てくる色ぜんぶを、この時点で焼き始める。1色あたりの実時間が長いので、
    // 「はじめる」を押してから頼んでいると曲の途中まで代わりの平らな絵のままになる（2026-09-10 実測）
    requestAllStoneSprites(
      DIAMOND_COLOR_ORDER.map((id) => findDiamondMember(id)?.color).filter((c): c is string => !!c)
    );
  }, []);
  const gemsRef = useRef<Gem[]>([]);
  const timeRef = useRef({ t: 0, d: 284 });
  /** 山の頂上の世界座標（低いほど高い山）。自分の💎を山より上に出すために使う */
  const pileTopRef = useRef(Infinity);
  /** これまでに降った💎の総数（自分＋みんな）。縮み具合の元 */
  const spawnedRef = useRef(0);
  /** 積もった💎の位置の控え（焼き込んだ分も含む）。山のきらめきの抽選に使う */
  const sparkPointsRef = useRef<{ x: number; y: number; rgb: [number, number, number]; size: number }[]>([]);
  /** 寄り始めの時点の倍率。そこから曲の終わりの倍率へなめらかに寄る */
  const finaleFromRef = useRef(1);
  /** 着地先を決める関数（キャンバスの寸法を知っている useEffect 内で差し替える） */
  const slotRef = useRef<(x: number, size: number, scale: number, self: boolean) => { tx: number; ty: number }>(() => ({ tx: 0, ty: 0 }));
  /** 帳簿と焼き込みの絵、星空の絵を空にする関数（useEffect 内で差し替える） */
  const clearWorldRef = useRef<() => void>(() => {});
  /** 山を夜空へ放つ関数（帳簿と焼き込みの絵を知っている useEffect 内で差し替える） */
  const launchRef = useRef<() => void>(() => {});
  /** 放った後か。true の間は山を作らず、降る💎はそのまま星になる。カメラも止まったまま */
  const launchedRef = useRef(false);
  /** 夜空へ飛んでいる途中の粒（画面座標） */
  const flyRef = useRef<SkyFly[]>([]);
  /** 夜空の星（画面座標）。焼き込んだ後も瞬きの抽選のために位置を覚えておく */
  const starsRef = useRef<SkyStar[]>([]);
  /** 色ごとの星の番号の控え（"r,g,b" → starsRef の添字）。
   *  ハイライト再生中に「選んでいる色の星だけ」を抽選するのに使う。数の少ない色を引き当てに行くと当たらないので、先に色で分けておく */
  const starsByColorRef = useRef<Map<string, number[]>>(new Map());
  /** 夜空の閃光（画面座標）。山の閃光は世界座標なので別に持つ */
  const skyFlashesRef = useRef<{ x: number; y: number; t0: number; rgb: [number, number, number]; size: number }[]>([]);
  /** 表示の方式。reset では変えない（方式を保ったまま中身だけ空にする） */
  const modeRef = useRef<DiamondMode>("pile");
  /** ミラーボール方式で、動画の中心へ吸い込まれている途中の💎（画面座標） */
  const suckRef = useRef<Suck[]>([]);
  /** ミラーボールの球。最初に使う時だけ作る（画面が描き直されるたびに作り捨てないように） */
  const ballRef = useRef<Ball | null>(null);
  const getBall = (): Ball => (ballRef.current ??= {
    zoom: 1,
    sprites: new Array<HTMLCanvasElement[] | null>(BALL_SEATS).fill(null),
    rgb: new Uint8Array(BALL_SEATS * 3),
    occ: [],
    taken: new Uint8Array(BALL_SEATS),
    byColor: new Map<string, number[]>(),
    age: new Float64Array(BALL_SEATS),
    kind: new Uint8Array(BALL_SEATS),
    seq: 0,
    reserved: 0,
    spriteGen: 0,
  });
  /** 球を空にする（最初に戻す時・方式を替えた時・夜空へ放った時）。席の並びも大きさも固定なので、中身を消すだけ */
  const clearBall = (ball: Ball) => {
    ball.zoom = 1;
    ball.sprites = new Array<HTMLCanvasElement[] | null>(BALL_SEATS).fill(null);
    ball.rgb = new Uint8Array(BALL_SEATS * 3);
    ball.occ = [];
    ball.taken = new Uint8Array(BALL_SEATS);
    ball.byColor = new Map<string, number[]>();
    ball.age = new Float64Array(BALL_SEATS);
    ball.kind = new Uint8Array(BALL_SEATS);
    ball.seq = 0;
    ball.reserved = 0;
    ball.spriteGen = 0;
  };
  const sizeRef = useRef({ W: 0, H: 0 });
  /** 動画本体の矩形（キャンバスの中の画面座標）。毎フレーム測った値をここに控えて、
   *  押した時（描く処理の外）にも「動画がいまどこにあるか」を見られるようにする。w=0 はまだ一度も測っていない */
  const videoRectRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const camRef = useRef({ scale: 1, cx: 0, cy: 0, oy: 0 });

  useImperativeHandle(ref, () => ({
    spawn(color: string, self = false) {
      const { W, H } = sizeRef.current;
      const { scale, cx, oy } = camRef.current;
      if (!W) return;
      spawnedRef.current += 1;
      const rgb = hexToRgb(color);
      recentRef.current.push({ t: performance.now(), key: rgb.join(","), rgb });
      // 放った後は山に積もらない。自分の分は色の帯の少し上から、他の人の分は画面の下端から出て、
      // そのまま夜空の行き先へ飛んで星になる（曲の終わりの拍手代わりの押しが「星が増える」になる）
      if (launchedRef.current) {
        const now = performance.now();
        const x0 = Math.random() * W;
        const y0 = self ? H - SELF_LAUNCH_Y + (Math.random() - 0.5) * SELF_LAUNCH_SPREAD : H;
        const tgt = skyTarget(W, H);
        flyRef.current.push({
          x0, y0, x1: tgt.x, y1: tgt.y,
          bow: FLY_BOW_MIN + Math.random() * FLY_BOW_RANGE,
          t0: now, dur: SPAWN_FLY_MS,
          d: FLY_DOT_MIN + Math.random() * FLY_DOT_RANGE,
          rgb, self,
        });
        // 押した手応えの閃光は今までどおり出す（画面座標）
        if (self) skyFlashesRef.current.push({ x: x0, y: y0, t0: now, rgb, size: SKY_FLASH_SIZE });
        return;
      }
      // ミラーボール方式: 積もらせず、動画の中心へ吸い込む。自分の分は画面の下の方の中央寄りから、
      // 他の人の分は画面の縁のどこかから出る。着いたら球の表面の板になる
      if (modeRef.current === "mirrorball") {
        const now = performance.now();
        let x0: number, y0: number, bow = 0;
        if (self) {
          // 中央寄りの下の方から出す。横に散らしすぎると動画の横の狭い所を通ることになり、
          // 動画の下から中心へ真っ直ぐ上がっていく道筋が読めなくなる
          x0 = W / 2 + (Math.random() * 2 - 1) * SELF_SUCK_X_SPREAD;
          y0 = H - SELF_SUCK_Y + (Math.random() - 0.5) * SELF_SUCK_Y_SPREAD;
          // 出発点が動画の矩形の中や、そのすぐ下にならないようにする。
          // 画面が低い端末では動画の下の余白が狭く、そのままだと出た瞬間に裏へ入ってしまう
          const vb = videoRectRef.current;
          if (vb.w > 0) y0 = Math.min(H - 8, Math.max(y0, vb.y + vb.h + SELF_SUCK_MIN_GAP));
          bow = (Math.random() < 0.5 ? -1 : 1) * SELF_SUCK_BOW * (0.6 + Math.random() * 0.4);
        } else {
          // 画面の縁を1周ぶんの長さと見て、その上のどこか1点を選ぶ
          const per = (W + H) * 2;
          const u = Math.random() * per;
          if (u < W) { x0 = u; y0 = H; }
          else if (u < W + H) { x0 = W; y0 = W + H - u; }
          else if (u < W * 2 + H) { x0 = W * 2 + H - u; y0 = 0; }
          else { x0 = 0; y0 = u - (W * 2 + H); }
        }
        const shrinkM = Math.max(SHRINK_MIN, Math.min(1, Math.sqrt(SHRINK_REF / spawnedRef.current)));
        // 押した時点で「この💎がはまる席」を1つ取っておく。席は色で決まる＝同じ色の席の隣が空いていればそこ、
        // 無ければその色の居場所にいちばん近い空席。席が全部埋まったら、いちばん古い板を貼り替える
        const ball = getBall();
        const seat = reserveSeat(ball, rgb);
        // 飛び方を1つ引く。飛び方によっては使う通り道が決まっているので、通り道もここで合わせて引く
        const flight = Math.floor(Math.random() * FLIGHT_STYLES.length);
        const fp = FLIGHT_STYLES[flight].paths;
        suckRef.current.push({
          x0, y0, t0: now,
          dur: self
            ? SELF_SUCK_MS + Math.random() * SELF_SUCK_MS_JITTER
            : SUCK_MS + Math.random() * SUCK_MS_JITTER,
          ang: Math.random() * Math.PI * 2,
          flight,
          path: fp ? fp[Math.floor(Math.random() * fp.length)] : Math.floor(Math.random() * TUMBLE_PATHS),
          roll: Math.random() * Math.PI * 2,
          size: (SIZE_MIN + Math.random() * SIZE_RANGE) * shrinkM,
          rgb, bow, self,
          seat: seat.seat, seatWasEmpty: seat.wasEmpty, seatPrevRgb: seat.prevRgb, seatPrevAge: seat.prevAge,
          tx: 0, ty: 0, aimed: false, toSeat: false,
        });
        // 押した手応えの閃光は今までどおり（画面座標なので夜空の分と同じ入れ物に入れる）
        if (self) skyFlashesRef.current.push({ x: x0, y: y0, t0: now, rgb, size: SKY_FLASH_SIZE });
        return;
      }
      const shrink = Math.max(SHRINK_MIN, Math.min(1, Math.sqrt(SHRINK_REF / spawnedRef.current)));
      const size = (SIZE_MIN + Math.random() * SIZE_RANGE) * shrink;
      // いま見えている範囲の横幅に散らす（引くほど広がる）
      const visibleHalf = (W / 2) / scale;
      const x = cx + (Math.random() * 2 - 1) * visibleHalf * 0.94;
      // 自分の💎は画面内（上端から少し下）に出して、出た瞬間の光が見えるようにする。他人は画面の上の外から。
      // ただし山がそこまで届いていたら山の中に出てしまう（上書きに見える）ので、山の頂上より上に出す
      const floorY = H * FLOOR_DEPTH;
      const topWorld = floorY - (H + oy) / scale;            // 画面上端の世界座標（軸は床。oy は床を画面の下へ送り出した分）
      const pileTop = pileTopRef.current;
      let y = self ? topWorld + (60 + Math.random() * 40) / scale : topWorld - size * 2;
      if (pileTop !== Infinity) y = Math.min(y, pileTop - size * 3);
      const gems = gemsRef.current;
      const slot = slotRef.current(x, size, scale, self);
      if (self) flashesRef.current.push({ x: slot.tx, y, t0: performance.now(), rgb, size });
      gems.push({
        x: slot.tx,
        y,
        tx: slot.tx,
        ty: slot.ty,
        vx: 0,
        vy: FALL_SPEED_MIN + Math.random() * FALL_SPEED_RANGE,
        ang: Math.random() * Math.PI * 2,
        spin: (Math.random() < 0.5 ? -1 : 1) * (SPIN_MIN + Math.random() * SPIN_RANGE),
        path: Math.floor(Math.random() * TUMBLE_PATHS),
        roll: Math.random() * Math.PI * 2,
        size,
        rgb,
        settled: false,
        seed: Math.random() * 1000,
      });
    },
    setTime(t: number, duration: number) {
      timeRef.current = { t: Math.max(0, t), d: Math.max(1, duration) };
    },
    undoLastSpawn() {
      // 放った後は山が無く、代わりに夜空へ飛んでいる粒がある。直前の自分の粒とその閃光を取り消す
      if (launchedRef.current) {
        const fly = flyRef.current;
        const last = fly[fly.length - 1];
        if (!last || !last.self) return;
        fly.pop();
        spawnedRef.current = Math.max(0, spawnedRef.current - 1);
        recentRef.current.pop();
        // 押した手応えの閃光も消す。星の瞬きが後から割り込んでいることがあるので、出発点が同じものだけ
        const sf = skyFlashesRef.current;
        if (sf.length && Math.abs(sf[sf.length - 1].x - last.x0) < 1) sf.pop();
        return;
      }
      // ミラーボール方式: まだ吸い込まれている途中のものだけ消す（球に入った分はもう取り消せない）
      if (modeRef.current === "mirrorball") {
        const suck = suckRef.current;
        const last = suck[suck.length - 1];
        if (!last || !last.self) return;
        suck.pop();
        // 取っておいた席も返す。空席を取っていたなら空席へ戻し、
        // 貼り替えを取っていたなら元の色と並び順へ戻す（貼り替えは起きなかったことになる）
        releaseSeat(getBall(), last.seat, last.seatWasEmpty, last.seatPrevRgb, last.seatPrevAge);
        spawnedRef.current = Math.max(0, spawnedRef.current - 1);
        recentRef.current.pop();
        const sf = skyFlashesRef.current;
        if (sf.length && Math.abs(sf[sf.length - 1].x - last.x0) < 1) sf.pop();
        return;
      }
      const gems = gemsRef.current;
      const last = gems[gems.length - 1];
      if (!last || last.settled) return;
      gems.pop();
      spawnedRef.current = Math.max(0, spawnedRef.current - 1);
      recentRef.current.pop();
      // 押した手応えの閃光も一緒に消す（直前に足したもの）
      const fl = flashesRef.current;
      if (fl.length && Math.abs(fl[fl.length - 1].x - last.x) < 1) fl.pop();
      // 帳簿（cols）に取った着地先はそのまま残る。スワイプは1回の再生で数回なので、その分の小さな隙間は許容する
    },
    setOwnColor(hex: string) {
      ownKeyRef.current = hexToRgb(hex).join(",");
      // 自分の色は真っ先に降るので、焼くよう頼んでおく。頼むだけで、焼くのはこの呼び出しが終わったあと。
      // 「はじめる」の中から呼ばれても、動画の再生を止めない（重い処理をこの場で走らせない）
      requestStoneSpritesByHex(hex, true);
    },
    getPeakTime(hex?: string) {
      const key = hex ? hexToRgb(hex).join(",") : ownKeyRef.current;
      if (!key) return null;
      return peakRef.current.get(key)?.t ?? null;
    },
    setHoldCamera(on: boolean) { holdCameraRef.current = on; },
    launchToSky() { launchRef.current(); },
    setMode(mode: DiamondMode) {
      if (mode === modeRef.current) return;
      modeRef.current = mode;
      // 方式が変わると、それまでの中身は行き場が無くなるので空にする（途中の切り替えは想定外だが壊さない）
      gemsRef.current = [];
      suckRef.current = [];
      flashesRef.current = [];
      sparkPointsRef.current = [];
      pileTopRef.current = Infinity;
      clearBall(getBall());
      camRef.current = { ...camRef.current, scale: 1, oy: 0 };
      clearWorldRef.current();
    },
    setColorTotals(totals: Record<string, number>) {
      const m = new Map<string, number>();
      for (const [hex, n] of Object.entries(totals)) m.set(hexToRgb(hex).join(","), n);
      colorTotalsRef.current = m;
    },
    reset() {
      gemsRef.current = [];
      flashesRef.current = [];
      recentRef.current = [];
      peakRef.current.clear();
      holdCameraRef.current = false;
      for (const sl of frameSlotsRef.current) { sl.rgb = [...FRAME_BASE] as [number, number, number]; sl.w = 0; }
      sparkPointsRef.current = [];
      launchedRef.current = false;
      flyRef.current = [];
      starsRef.current = [];
      starsByColorRef.current.clear();
      skyFlashesRef.current = [];
      suckRef.current = [];
      clearBall(getBall());
      spawnedRef.current = 0;
      finaleFromRef.current = 1;
      pileTopRef.current = Infinity;
      timeRef.current = { t: 0, d: timeRef.current.d };
      camRef.current = { scale: 1, cx: camRef.current.cx, cy: camRef.current.cy, oy: 0 };
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
    // 星空の絵（画面座標そのまま）。星になった粒はここへ描き移し、以後は毎フレームこの1枚を貼るだけ
    let sky: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
    let skyBaked = 0;   // starsRef のうち何個目まで焼き込んだか。0 に戻すと全部焼き直す
    const cols: number[] = [];
    // いま壁に映っている光の粒。板を描くついでに拾って、板を描き終えてからまとめて貼る。
    // 毎フレーム作り直さないよう先に用意して使い回す。夜空へ放つ時は、この位置と色がそのまま星になる
    const wallX = new Float32Array(WALL_SPOT_MAX);
    const wallY = new Float32Array(WALL_SPOT_MAX);
    const wallC = new Uint8Array(WALL_SPOT_MAX * 3);              // 粒の色（3つ組）
    const wallW = new Float32Array(WALL_SPOT_MAX);                // 濃さの重み（足切りのすぐ上は薄く・瞬いた板は明るく）
    const wallP: (HTMLCanvasElement | null)[] = new Array(WALL_SPOT_MAX).fill(null);  // 終盤に重ねる💎の絵。一番こちらを向いた1枚
    let wallN = 0;
    // いま壁に映している粒の直径(px)と濃さ。夜空へ放つ時に「この大きさ・この濃さから縮む」の出発点として読む
    let wallDiaNow = 0;
    let wallAlphaNow = 0;
    // 光を返した面に出す小さな光。石を描くついでに拾って、壁の粒と同じ場所（額縁の外）でまとめて貼る
    const bloomX = new Float32Array(BLOOM_MAX);
    const bloomY = new Float32Array(BLOOM_MAX);
    const bloomC = new Uint8Array(BLOOM_MAX * 3);
    const bloomA = new Float32Array(BLOOM_MAX);   // 濃さ（面の合い具合に比例）
    const bloomD = new Float32Array(BLOOM_MAX);   // 直径(px)。石ごとに腰の太さが違うので1つずつ持つ
    let bloomN = 0;
    // 手前側の石は、奥にあるものから順に描かないと重なりが逆になる。
    // 毎フレーム並べ替えの入れ物を作ると押した数だけゴミが出るので、席の数ぶんを先に用意して使い回す。
    // 毎フレーム数え直すのは長さ ballFrontN だけ
    const ballSeatZ = new Float32Array(BALL_SEATS);   // 席ごとの奥行き。並べ替えの物差しになる
    const ballFront = new Int32Array(BALL_SEATS);     // 手前側にあって実際に描く、石の席の番号
    let ballFrontN = 0;
    // 代役の板が立っている席。石とは貼り方も明暗の付け方も違うので別に数える。並べ替えはしない
    const ballPlate = new Int32Array(BALL_SEATS);
    let ballPlateN = 0;
    // 石は別の紙に濃いまま描いてから、描いた所だけを暗くして本紙へ貼る。
    // 1つずつ薄く貼ると、刺さって重なった所で向こう側の石が透けてしまう。
    // 紙はキャンバスの大きさが変わった時だけ作り直す
    let ballLay: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
    const getBallLayer = () => {
      if (ballLay && ballLay.canvas.width === canvas.width && ballLay.canvas.height === canvas.height) return ballLay;
      const c = document.createElement("canvas");
      c.width = canvas.width; c.height = canvas.height;
      const lctx = c.getContext("2d");
      ballLay = lctx ? { canvas: c, ctx: lctx } : null;
      return ballLay;
    };
    // 夜空へ放った瞬間、壁の粒が縮んで星になるまでの途中の姿（画面座標）。縮み終わったら星にして空へ焼き込む
    const wallFade: { x: number; y: number; rgb: [number, number, number]; t0: number; d0: number; a0: number; d1: number }[] = [];
    // 吸い込まれ中の💎を描く時の使い回しの入れ物（1個ずつ作ると押した数だけゴミが出る）
    const suckDraw = { x: 0, y: 0, ang: 0, path: 0, roll: 0, size: 0, rgb: [0, 0, 0] as [number, number, number] };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const prevW = W, prevH = H;
      dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      sizeRef.current = { W, H };
      floorY = H * FLOOR_DEPTH;
      worldW = W / MIN_SCALE;
      worldX0 = W / 2 - worldW / 2;
      const n = Math.ceil(worldW / COL_W) + 1;
      while (cols.length < n) cols.push(0);
      // 星と飛んでいる粒は画面座標なので、画面の大きさが変わったら比率で合わせ直し、星空の絵を焼き直す。
      // iPhone は再生中にもアドレスバーの出入りで高さが変わる
      if (prevW > 0 && prevH > 0 && (W !== prevW || H !== prevH)) {
        const kx = W / prevW, ky = H / prevH;
        for (const s of starsRef.current) { s.x *= kx; s.y *= ky; }
        for (const f2 of flyRef.current) { f2.x0 *= kx; f2.x1 *= kx; f2.y0 *= ky; f2.y1 *= ky; }
        for (const s2 of suckRef.current) { s2.x0 *= kx; s2.y0 *= ky; }
        for (const wf of wallFade) { wf.x *= kx; wf.y *= ky; }
        sky = null;
        skyBaked = 0;
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    clearWorldRef.current = () => {
      cols.fill(0);
      wallN = 0;     // 壁に映っていた粒も消す
      bloomN = 0;
      wallFade.length = 0;
      bake = null;   // 焼き込みの絵は捨てて、次に必要になった時に作り直す
      sky = null;
      skyBaked = 0;
    };
    /** 飛び終わった粒を星にする。位置は色ごとの控えにも入れて、瞬きの抽選で色を絞れるようにする。
     *  d を渡すと星の大きさを指定できる（壁の粒が縮んで星になる時に、縮み先の大きさを先に決めておくため） */
    const addStar = (x: number, y: number, rgb: [number, number, number], d?: number) => {
      const stars = starsRef.current;
      stars.push({ x, y, d: d ?? STAR_MIN + Math.random() * STAR_RANGE, rgb });
      const key = rgb.join(",");
      const arr = starsByColorRef.current.get(key);
      if (arr) arr.push(stars.length - 1); else starsByColorRef.current.set(key, [stars.length - 1]);
    };
    launchRef.current = () => {
      if (launchedRef.current || !W) return;
      launchedRef.current = true;
      const { scale, cx, oy } = camRef.current;
      const now = performance.now();
      // ミラーボール方式: 球の表面の板が、そのまま夜空へ散る。出発点はいま画面に見えている位置
      if (modeRef.current === "mirrorball") {
        const ball = getBall();
        const lv = getBallLattice();
        const occ = ball.occ;            // 取ってある席（取った順）
        const filled = occ.length;
        const lat = lv.a;
        const bR = BALL_R * ball.zoom;   // いま見えている球の半径（固定の大きさ × カメラの寄り）
        const spin = reduceMotionRef.current ? 0 : (now / 1000) * (Math.PI * 2 / BALL_SPIN_SEC);
        const cs = Math.cos(spin), sn = Math.sin(spin);
        const ct = Math.cos(BALL_TILT), st = Math.sin(BALL_TILT);
        const bcy = camRef.current.cy;
        // 壁に映っていた粒は、飛ばずにその場で星になる（位置も色もそのまま引き継ぐ）。
        // 「壁の光が結晶になったもの」として星空につながる。
        // ただし直径40px前後の粒が2〜4pxの星にいきなり入れ替わると見た目が飛ぶので、
        // WALL_TO_STAR_MS かけて縮ませてから星にする。縮み先の星の大きさはここで決めておく。
        // 出発点の濃さも1枚ずつ引き継ぐ＝足切りぎりぎりの薄い粒が、放った瞬間に急に明るくならない
        for (let i = 0; i < wallN; i++) {
          const d1 = STAR_MIN + Math.random() * STAR_RANGE;
          wallFade.push({
            x: wallX[i], y: wallY[i],
            rgb: [wallC[i * 3], wallC[i * 3 + 1], wallC[i * 3 + 2]],
            t0: now, d0: wallDiaNow, a0: Math.min(1, wallAlphaNow * wallW[i]), d1,
          });
        }
        // 球の板は、粒になった数を除いた残りの席へ飛ぶ＝星の総数は今までと同じ
        const n = Math.max(0, Math.min(filled, LAUNCH_MAX) - wallN);
        const step = n > 0 ? filled / n : 1;
        wallN = 0;
        const fly = flyRef.current;
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
        // 球をほどく（表面の板・吸い込まれ中の💎・閃光を空にする）
        clearBall(ball);
        suckRef.current = [];
        skyFlashesRef.current = [];
        return;
      }
      // 粒の元は「積もった💎の位置の控え（焼き込んだ分も含む）」＋「まだ落ちている途中の💎」
      const src: { x: number; y: number; rgb: [number, number, number] }[] = sparkPointsRef.current.slice();
      for (const g of gemsRef.current) if (!g.settled) src.push({ x: g.x, y: g.y, rgb: g.rgb });
      const n = Math.min(src.length, LAUNCH_MAX);
      const step = n > 0 ? src.length / n : 1;   // 多すぎる時は等間隔に間引く
      const fly = flyRef.current;
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
      // 山を空にする（1つずつ描いている💎・位置の控え・積もり高さの帳簿・焼き込みの絵）。
      // 帳簿を空にするので、以後は着地先の割り当ても走らない
      gemsRef.current = [];
      sparkPointsRef.current = [];
      flashesRef.current = [];   // 山の閃光は行き場が無くなるので一緒に捨てる（放つ光に紛れて見えない）
      pileTopRef.current = Infinity;
      cols.fill(0);
      bake = null;
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
        const score = h + outside + Math.abs(c - cMid) * COL_W * SLOPE + Math.abs(c - cC) * COL_W * NEAR_SPAWN + Math.random() * size * 0.4;
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

    /** 降っている💎: 自分の向きに合う絵を選んで、回さずに貼る。
     *  光は画面に対して止まっているので、石が回れば面が順番に光る＝絵を回してはいけない。
     *  毎フレーム面を塗るのは、みんなの💎がたくさん降る時に発熱の元になっていた（Hop報告 2026-09-07） */
    const drawGemLive = (g: Pick<Gem, "x" | "y" | "ang" | "path" | "roll" | "size" | "rgb">) => {
      const sprites = getStoneSprites(g.rgb);
      const w = (g.size * 2 / 0.95);
      const img = sprites[stoneIndex(g.ang, g.path)];
      if (!g.roll) { ctx.drawImage(img, g.x - w / 2, g.y - w / 2, w, w); return; }
      // 画面の上で寝かせる分だけ絵ごと回す。光も一緒に回るが、💎ごとに向きが決まっていて
      // 途中で変わらないので、その石はその向きから照らされているように見える
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.roll);
      ctx.drawImage(img, -w / 2, -w / 2, w, w);
      ctx.restore();
    };
    /** 積もった💎: スプライトを貼る */
    const drawGemSettled = (g: Gem, target: CanvasRenderingContext2D = ctx) => {
      const sprites = getStoneSprites(g.rgb);
      const i = stoneIndex(g.ang, g.path);
      const w = (g.size * 2 / 0.95) * 1.12;              // 少し大きめに貼って継ぎ目の隙間を埋める【仮】
      if (!g.roll) {
        target.drawImage(sprites[i], g.x - w / 2, g.y - w / 2, w, w);
      } else {
        target.save();
        target.translate(g.x, g.y);
        target.rotate(g.roll);
        target.drawImage(sprites[i], -w / 2, -w / 2, w, w);
        target.restore();
      }
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
      videoRectRef.current = v;   // 押した時に「動画の下端」を知るための控え
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
      let maxH = 0;
      for (let j = 0; j < cols.length; j++) if (cols[j] > maxH) maxH = cols[j];
      const pileTopWorld = maxH > 0 ? floorY - maxH : Infinity;
      // 急に変わらないよう、前フレームからなめらかに寄せる
      const prev = camRef.current.scale || scale;
      scale = prev + (scale - prev) * Math.min(1, dt * 4);
      // 山の頂上が画面の上の方まで来たら、床を画面の下へ送り出して頂上を留める（カメラが頂上について上がる）
      const oyTarget = Math.max(0, maxH * scale - H * PILE_MAX_ON_SCREEN);
      const prevOy = camRef.current.oy;
      let oy = prevOy + (oyTarget - prevOy) * Math.min(1, dt * 4);
      // ハイライト再生中と、夜空へ放った後は動かさない
      if (holdCameraRef.current || launchedRef.current) { scale = prev; oy = prevOy; }
      // ミラーボール方式は引き寄りをしない（球の大きさで見せるので、カメラまで動くと何が起きているか分からなくなる）
      if (modeRef.current === "mirrorball") { scale = 1; oy = 0; }
      pileTopRef.current = pileTopWorld;
      camRef.current = { scale, cx, cy, oy };
      // 落下（世界座標）: 着地先まで落ちて止まる。横には流れない（着地先が最初から詰まる位置なので）
      const gems = gemsRef.current;
      for (const g of gems) {
        if (g.settled) continue;
        g.vy += GRAVITY * dt;
        g.y += g.vy * dt;
        if (!reduceMotionRef.current) g.ang += g.spin * dt;
        if (g.y >= g.ty) {
          g.y = g.ty; g.settled = true; g.vx = 0;
          sparkPointsRef.current.push({ x: g.x, y: g.y, rgb: g.rgb, size: g.size });
        }
      }

      // 額縁の地色（画面座標・カメラの外）。直近に降った💎の色の上位4つを、左から順に幅＝割合で並べて染める。
      // 4声コーラスのパートに合わせて色の順位が分かるように（Hop決定 2026-09-07・案1）。名前・数字は出さない。
      // 順位や割合が変わる時は各区画の色と幅をなめらかに寄せ、境目はにじませる。降っていない時は地色に戻る
      {
        const recent = recentRef.current;
        const cutoff = now - TINT_WINDOW_MS;
        let drop = 0;
        while (drop < recent.length && recent[drop].t < cutoff) drop++;
        if (drop > 0) recent.splice(0, drop);
        const counts = new Map<string, { n: number; rgb: [number, number, number] }>();
        for (const r of recent) {
          const c = counts.get(r.key);
          if (c) c.n++; else counts.set(r.key, { n: 1, rgb: r.rgb });
        }
        // 順位は単純な数ではなく「その色の普段の量に対する倍率」。参加者が多い色がずっと上位に居座らないように
        const totals = colorTotalsRef.current;
        const scored = [...counts.entries()].map(([key, c]) => ({ rgb: c.rgb, s: c.n / ((totals.get(key) ?? 0) + TINT_BASE_TOTAL) }));
        // 色ごとに「倍率が曲中で最大だった瞬間」を覚える（ハイライト再生中は更新しない）。
        // 全色ぶん控えておくと、あとから色を切り替えてもその色の瞬間へ飛べる
        if (!holdCameraRef.current) {
          const peaks = peakRef.current;
          for (const c of scored) {
            const key = c.rgb.join(",");
            const cur = peaks.get(key);
            if (!cur || c.s > cur.s) peaks.set(key, { t: timeRef.current.t, s: c.s });
          }
        }
        const top = scored.sort((a, b) => b.s - a.s).slice(0, TINT_SLOTS);
        const topSum = top.reduce((acc, c) => acc + c.s, 0);
        const slots = frameSlotsRef.current;
        const k = Math.min(1, dt * 2);   // 約0.5秒かけて移り変わる
        for (let i = 0; i < TINT_SLOTS; i++) {
          const t = top[i];
          const rgbT: [number, number, number] = t
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
      }
      ctx.fillRect(f.x, f.y, f.w, f.h);

      // 閃光（画面座標）。光の類なので動画の矩形は除外して描く。
      // 夜空へ放った後とミラーボール方式の両方で使う（山の閃光は世界座標なので別）
      const drawScreenFlashes = () => {
        const sf = skyFlashesRef.current;
        if (sf.length) {
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
            const r = fl.size * (1.2 + 2.6 * k);
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
        }
      };
      // 夜空へ放った後（画面座標のまま描く。カメラの外なので世界座標の計算は要らない）。
      // 星空は1枚の絵にして貼るだけ、1つずつ描くのは飛んでいる途中の粒だけ＝放つ2秒を過ぎたら山より軽い
      if (launchedRef.current) {
        const stars = starsRef.current;
        const fly = flyRef.current;
        // 飛び終わった粒を星にする（先に済ませて、この後の焼き込みに間に合わせる＝1コマ消える瞬間を作らない）
        for (let i = fly.length - 1; i >= 0; i--) {
          if (now - fly[i].t0 < fly[i].dur) continue;
          addStar(fly[i].x1, fly[i].y1, fly[i].rgb);
          fly.splice(i, 1);
        }
        // 壁の粒から縮みきった分も、同じ理由でここで星にする（大きさは縮み始めに決めてある）
        for (let i = wallFade.length - 1; i >= 0; i--) {
          if (now - wallFade[i].t0 < WALL_TO_STAR_MS) continue;
          addStar(wallFade[i].x, wallFade[i].y, wallFade[i].rgb, wallFade[i].d1);
          wallFade.splice(i, 1);
        }
        // 新しく星になった分を1枚の絵へ焼き足す。重なった所は明るくなる
        if (stars.length > skyBaked) {
          if (!sky) {
            const res = Math.min(dpr, MAX_DPR);
            const c = document.createElement("canvas");
            c.width = Math.ceil(W * res); c.height = Math.ceil(H * res);
            const sctx = c.getContext("2d");
            if (sctx) {
              sctx.scale(res, res);
              sctx.globalCompositeOperation = "lighter";
              sky = { canvas: c, ctx: sctx };
            }
          }
          if (sky) {
            for (let i = skyBaked; i < stars.length; i++) {
              const st = stars[i];
              const w = st.d / STAR_CORE;
              sky.ctx.drawImage(getStar(st.rgb), st.x - w / 2, st.y - w / 2, w, w);
            }
            skyBaked = stars.length;
          }
        }
        if (sky) ctx.drawImage(sky.canvas, 0, 0, W, H);
        // 壁に映っていた粒が、その場で縮んで星に入れ替わる途中の姿（放った瞬間から WALL_TO_STAR_MS の間だけ）。
        // 直径40px前後の粒が2〜4pxの星へ一足飛びに変わると見た目が飛ぶので、粒を縮めながら薄くし、
        // 入れ替わりに星を濃くする。縮みきったところで星にして、以後は星空の絵へ焼き込まれる。
        // 額縁の外だけに出すのは、壁に映っていた時と同じ囲い方（額縁の中にあった粒は元から見えていない）
        if (wallFade.length) {
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
        // 飛んでいる粒。はじめ速く終わりゆっくり進み、まっすぐでなく少し弧を描く
        if (fly.length) {
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
        // 星の瞬き: 星空からランダムに1つ選んで、山の時と同じ十字の閃光を出す。
        // 画面の外や動画の裏の星を選んでも見えないので、当たるまで数回引き直す。
        // ハイライト再生中（setHoldCamera(true) で入る）は、いま選んでいる色の星だけが光る（Hop決定 2026-09-08）
        if (!reduceMotionRef.current && stars.length > 0) {
          const onlyOwn = holdCameraRef.current;
          if (Math.random() < (onlyOwn ? SKY_SPARK_RATE_HL : SKY_SPARK_RATE) * dt) {
            const idx = onlyOwn ? (starsByColorRef.current.get(ownKeyRef.current ?? "") ?? []) : null;
            const len = idx ? idx.length : stars.length;
            for (let tries = 0; tries < 12 && len > 0; tries++) {
              const st = stars[idx ? idx[(Math.random() * len) | 0] : (Math.random() * len) | 0];
              if (st.x < 0 || st.x > W || st.y < 0 || st.y > H) continue;
              if (st.x > v.x && st.x < v.x + v.w && st.y > v.y && st.y < v.y + v.h) continue;
              skyFlashesRef.current.push({ x: st.x, y: st.y, t0: now, rgb: st.rgb, size: SKY_SPARK_SIZE });
              break;
            }
          }
        }
        drawScreenFlashes();
        return;
      }

      // ミラーボール方式（画面座標のまま描く。カメラの引き寄りを使わないので世界座標の計算は要らない）。
      // 山の帳簿・焼き込みの絵は使わず、球の表面の板・壁に映る光の粒・吸い込まれ中の💎だけを描く
      if (modeRef.current === "mirrorball") {
        const ball = getBall();
        const lightAng = reduceMotionRef.current ? SPRITE_LIGHT : (now / 1000) * 0.35;
        const suck = suckRef.current;
        // 1. 飛び終わった💎を球の表面へ刺す。刺す場所は、押した時に取っておいた席（sk.seat）。
        //    席は色ごとにまとまるように決めてあるので、同じ色の石が隣り合って塊になる。
        //    席が全部埋まった後に取った席は、いちばん古い石の差し替えになる
        const lv = getBallLattice();
        for (let i = suck.length - 1; i >= 0; i--) {
          const sk = suck[i];
          if (now - sk.t0 < sk.dur) continue;
          const slot = sk.seat;
          // 貼る絵はここで1回だけ引く（毎フレーム引くと重い）。
          // その色の立体がまだ焼けていなければ、焼き上がるまでは板の絵で代役を立てる
          const real = hasRealStoneSprites(sk.rgb);
          ball.sprites[slot] = real ? getStoneSprites(sk.rgb) : getPlateSprites(sk.rgb);
          ball.kind[slot] = real ? 1 : 0;
          ball.rgb[slot * 3] = sk.rgb[0];
          ball.rgb[slot * 3 + 1] = sk.rgb[1];
          ball.rgb[slot * 3 + 2] = sk.rgb[2];
          suck.splice(i, 1);
        }
        // どこかの色が焼き上がったら、埋まっている席ぶんだけ引き直す。
        // 代役の板が立っていた席は、ここで石に差し替わる。
        // 引き直すのは焼き上がった時だけで、毎フレームではない
        const gen = stoneGeneration();
        if (ball.spriteGen !== gen) {
          for (const slot of ball.occ) {
            if (!ball.sprites[slot]) continue;
            const oc = slot * 3;
            const rgb: [number, number, number] = [ball.rgb[oc], ball.rgb[oc + 1], ball.rgb[oc + 2]];
            const real = hasRealStoneSprites(rgb);
            ball.sprites[slot] = real ? getStoneSprites(rgb) : getPlateSprites(rgb);
            ball.kind[slot] = real ? 1 : 0;
          }
          ball.spriteGen = gen;
        }
        // 見に行くのは「取ってある席」の全部。着いた席だけに絞ると、
        // 取った順と着く順がずれた板（＝先に押した💎がまだ飛んでいる間に着いた板）が
        // しばらく描かれず、後から急に現れてしまう。まだ着いていない席は絵が無いので飛ばされる
        const occ = ball.occ;
        const filled = occ.length;
        // 球そのものの大きさは変わらない。変わるのはカメラの寄り具合＝見かけの大きさだけ。
        // 曲が進むほど寄って、動画の裏から上下にはみ出してくる。
        // ハイライト再生中と、夜空へ放った後は寄りを止める（時刻が飛んでも拡大率が跳ねない）。
        // 目当ての拡大率へは数フレームかけて寄せる＝時刻が飛んだ時も一足飛びにならない
        if (!holdCameraRef.current && !launchedRef.current) {
          ball.zoom += (ballZoomFor(p) - ball.zoom) * Math.min(1, dt * BALL_ZOOM_EASE);
        }
        const r = BALL_R * ball.zoom;
        // 球の向き（回転と傾き）と板の大きさ。板を描く所だけでなく、飛んでいる💎が
        // 「自分の席がいま画面のどこにあるか」を知るのにも要るので、板が1枚も無い時でも先に出しておく
        const lat = lv.a;          // 席1つにつき4つ（向き x,y,z と 横の間隔）
        const spin = reduceMotionRef.current ? 0 : (now / 1000) * (Math.PI * 2 / BALL_SPIN_SEC);
        const cs = Math.cos(spin), sn = Math.sin(spin);
        const ct = Math.cos(BALL_TILT), st = Math.sin(BALL_TILT);
        // 板の大きさは、見かけの半径と席の間隔から決める。高さは段の間隔（格子で1つ）、
        // 横幅は隣の席との間隔（席ごとに違う。極に近い段ほど細い）。カメラが寄るほど板も大きく見える
        const tileK = r * BALL_TILE_FILL;
        const tileV = Math.max(BALL_TILE_MIN, tileK * lv.v);
        // 光の向き。落ちている💎の面と同じ考えで、板の向きが光を返す向きに近いほど明るくする
        const lz = 0.8;
        const ln = Math.hypot(Math.cos(lightAng), Math.sin(lightAng), lz);
        const Lx = Math.cos(lightAng) / ln, Ly = Math.sin(lightAng) / ln, Lz = lz / ln;
        // 鏡がこちらへ光を返す向き＝光の向きと視線のちょうど中間。石の面がこの向きに近いと、その面が光る。
        // 毎コマ1回だけ出して、面ごとの判定で使い回す。同じ所で使っている H は画面の高さで、これとは別物
        const hl = Math.hypot(Lx, Ly, Lz + 1);
        const Hx = Lx / hl, Hy = Ly / hl, Hz = (Lz + 1) / hl;

        // 壁に映る粒の「満開の度合い」（0〜1）。曲の進みで決まる。
        // 序盤は淡く小さく、終盤は数も大きさも濃さも増す＝球が壁に近づいたように見せる
        const wallQ = Math.min(1, Math.max(0, p / WALL_FULL_AT));
        const wallDia = WALL_D_MIN + (WALL_D_MAX - WALL_D_MIN) * wallQ;
        const wallAlpha = WALL_A_MIN + (WALL_A_MAX - WALL_A_MIN) * wallQ;
        wallDiaNow = wallDia; wallAlphaNow = wallAlpha;   // 夜空へ放つ時に、粒の縮み始めの大きさと濃さとして読む
        // 光を受けている板の足切り。板がまだ少ない間は緩め（WALL_LIT_EARLY）、
        // 板が WALL_LIT_RAMP 枚まで増える間に通常（WALL_LIT_MIN）へ戻す。
        // 序盤は光を受けている板そのものが数枚しかなく、さらに壁へ映した位置が画面に収まるものとなると
        // 2個ほどしか出なかった（Hop報告 2026-09-08）
        const wallCut = WALL_LIT_EARLY + (WALL_LIT_MIN - WALL_LIT_EARLY) * Math.min(1, filled / WALL_LIT_RAMP);
        // 壁に映す板の選び方: 光を受けている板（wallCut 以上）から、席の番号ごとに決まっている
        // くじで当たった分だけを映す。当たりの割合は「上限の数 ÷ 光を受けている板の数」なので、
        // 数が増えるほど当たりが少しずつ辛くなる＝粒が1枚ずつ静かに減る。
        // 当たり外れは席の番号で散らばるので、板の格子がそのまま拡大されて壁に写ることはない。
        // 「光の受け方が強い順に上位◯枚」を採る形も試したが、光の当たっている一角に粒が固まって
        // 壁の片側だけが光り、しかも格子の目がそのまま拡大されて見えた（2026-09-08 に手元で見てくじに変えた）。
        // 「◯枚おきに1枚」の間引きも、間隔が2枚おきから3枚おきへ変わる瞬間に粒が一斉に入れ替わるのでやめた
        const wallLit = filled * (1 - wallCut) / 2;   // だいたい何枚が光を受けているか（球の上でその向きが占める割合から）
        const wallKeep = Math.min(1, WALL_SPOT_MAX / Math.max(1, wallLit));
        wallN = 0;
        bloomN = 0;

        // 2. 球の表面: 縦の軸まわりに回して少し傾け、席ごとに💎を1つずつ球へ刺す。
        //    貼るのは、席の向きの奥行きに一番近い姿勢の絵。正面の席は真上から見た姿、縁の席は横顔になり、
        //    石が球から生えて見える。刺さった石は隣と重なるので、描く順番が要る。
        //    奥側の石 → 土台の球 → 手前側の石 の順に重ね、手前側は奥にあるものから先に描く。
        //    まだ焼けていない色の席には、代役の板を消す前と同じ貼り方で最後に貼る。
        //    板は隣と重ならず自分で明暗を持っているので、石とは別の紙立てになる。
        //    ついでに、壁に映る粒の元になる席（光を受けている奥側の席）をここで拾っておく。
        //    壁の粒は奥の石の面ごとに拾う。代役の板の席だけは今までどおり1席に1粒
        if (filled > 0) {
          const half = tileV * 0.6;   // 画面からはみ出した石を弾くための目安（横幅は段の間隔の1.2倍まで）
          const flash = !reduceMotionRef.current;
          const layer = getBallLayer();
          // 石は濃いまま別の紙へ描き、描いた所だけを後で暗くしてから本紙へ貼る。
          // 紙を用意できない端末では本紙へ直に描き、明暗を掛けるのは諦める
          const g = layer ? layer.ctx : ctx;
          if (layer) {
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
          }
          /** 席1つぶんの石を刺す。絵の中で石の頭が向いている先を、球の外へ向かう向きへ回して合わせる */
          const drawSeatStone = (sp: HTMLCanvasElement[], x1: number, y2: number, z2: number, sx: number, sy: number, tileU: number) => {
            const gemD = Math.min(tileU, tileV);                      // 石の腰の直径(px)
            const size = (STONE_PX * gemD) / (2 * STONE_LOCAL_PX);    // 絵を貼る一辺(px)
            const idx = stoneIndexForDepth(z2);
            const a = STONE_AXIS[idx];
            const ang = Math.atan2(-y2, x1) - Math.atan2(-a.y, a.x);
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.translate(sx, sy);
            g.rotate(ang);
            g.drawImage(sp[idx], -size / 2, -size / 2, size, size);
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
          };
          ballFrontN = 0;
          ballPlateN = 0;
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
            const tileU = Math.max(BALL_TILE_MIN, tileK * lat[o + 3]);
            if (z2 <= 0) {
              // 奥側の石。壁に映る粒の元はこちら。
              // 壁に届く光は球の向こう側の面が返したものなので、粒は手前の石と逆向きに流れる。
              // 奥の石が光を受けているかどうかは、光の向きの奥行きだけ裏返して（＝奥から当たる光として）
              // 手前の石と同じ内積で測る。映す先は、球の中心からその向きへ WALL_MAG 倍伸ばした所。
              // 石が動画に隠れているかは問わない（動画の裏の石の光も壁には届く＝序盤の「裏で何か光っている」手掛かり）。
              // ここでは位置と色を控えるだけで、貼るのは石を全部描いた後（3.）
              // くじは席の番号と面の番号から毎回同じ数を作る＝同じ面はずっと映り続ける（ちらつかない）。
              // 席を取った順（k）から作ると、取り消しや差し替えで並びがずれた時に
              // 壁の粒が一斉に入れ替わってしまう
              const oc = slot * 3;
              if (ball.kind[slot]) {
                // 石の席は面ごと。石の面それぞれについて、その面が奥から当たる光をどれだけ返しているかを見る。
                // 映す先も席の向きではなく面の向きなので、粒の向きが単調にならない。
                // 基準の向き2本は石1つにつき1回だけ作り、面のくじは席の番号と面の番号から毎回同じ数を作る
                setFacetBasis(x1, y2, z2);
                const t0x = facetBasis[0], t0y = facetBasis[1], t0z = facetBasis[2];
                const t1x = facetBasis[3], t1y = facetBasis[4], t1z = facetBasis[5];
                const spinCos = lv.spinCos[slot], spinSin = lv.spinSin[slot];
                for (let fi = 0; fi < FACET_COUNT && wallN < WALL_SPOT_MAX; fi++) {
                  const hk = (((slot * FACET_COUNT + fi) * 2654435761) >>> 0) / 4294967296;
                  if (hk >= wallKeep / WALL_FACET_KEEP_DIV) continue;
                  const cosPr = FACET_COS_P[fi] * spinCos + FACET_SIN_P[fi] * spinSin;
                  const sinPr = FACET_SIN_P[fi] * spinCos - FACET_COS_P[fi] * spinSin;
                  const ctf = FACET_COS_T[fi], stf = FACET_SIN_T[fi];
                  const nx = ctf * x1 + stf * (cosPr * t0x + sinPr * t1x);
                  const ny = ctf * y2 + stf * (cosPr * t0y + sinPr * t1y);
                  const nz = ctf * z2 + stf * (cosPr * t0z + sinPr * t1z);
                  if (nz > 0) continue;              // こちらを向いた面の光は壁へ回らない
                  const db = nx * Lx + ny * Ly - nz * Lz;   // その面がどれだけ光を返しているか
                  if (db <= wallCut + WALL_FACET_CUT) continue;
                  const wx = cx + nx * r * WALL_MAG, wy = cy - ny * r * WALL_MAG;
                  if (wx <= -wallDia || wx >= W + wallDia || wy <= -wallDia || wy >= H + wallDia) continue;
                  wallX[wallN] = wx; wallY[wallN] = wy;
                  wallC[wallN * 3] = ball.rgb[oc];
                  wallC[wallN * 3 + 1] = ball.rgb[oc + 1];
                  wallC[wallN * 3 + 2] = ball.rgb[oc + 2];
                  wallW[wallN] = Math.min(1, (db - wallCut - WALL_FACET_CUT) / WALL_FADE_BAND)
                    * (!reduceMotionRef.current && db > BALL_HL_CUT ? WALL_FLASH : 1);
                  wallP[wallN] = sp[STONE_FACE_INDEX];
                  wallN++;
                }
              } else {
                // 代役の板の席は今までどおり1席に1粒
                const db = x1 * Lx + y2 * Ly - z2 * Lz;                // 奥の板がどれだけ光を受けているか（0〜1）
                const hk = ((slot * 2654435761) >>> 0) / 4294967296;
                if (hk < wallKeep && db > wallCut && wallN < WALL_SPOT_MAX) {
                  const wx = cx + (sx - cx) * WALL_MAG, wy = cy + (sy - cy) * WALL_MAG;
                  if (wx > -wallDia && wx < W + wallDia && wy > -wallDia && wy < H + wallDia) {
                    wallX[wallN] = wx; wallY[wallN] = wy;
                    wallC[wallN * 3] = ball.rgb[oc];
                    wallC[wallN * 3 + 1] = ball.rgb[oc + 1];
                    wallC[wallN * 3 + 2] = ball.rgb[oc + 2];
                    // 足切りのすぐ上の板は薄く（ふっと現れ・ふっと消える）。
                    // ちょうど光を返す向きに来た板の粒は一瞬明るくする＝手前の板が白く瞬くのと同じ合図
                    wallW[wallN] = Math.min(1, (db - wallCut) / WALL_FADE_BAND)
                      * (!reduceMotionRef.current && db > BALL_HL_CUT ? WALL_FLASH : 1);
                    wallP[wallN] = sp[0];
                    wallN++;
                  }
                }
              }
              // 板は球の表面から出っ張らないので、奥側の分は今までどおり描かない
              if (!ball.kind[slot]) continue;
              // 石は奥側でも、土台の球からはみ出した頭が見える。粒を拾い終えてから、
              // 画面の外と、動画にすっかり隠れる分を落として描く
              if (sx < -half || sx > W + half || sy < -half || sy > H + half) continue;
              if (sx - half > v.x && sx + half < v.x + v.w && sy - half > v.y && sy + half < v.y + v.h) continue;
              drawSeatStone(sp, x1, y2, z2, sx, sy, tileU);
              continue;
            }
            if (sx < -half || sx > W + half || sy < -half || sy > H + half) continue;
            // 石がまるごと動画の中に入る＝動画に隠れて見えないので描かない（動画の縁にかかる石は裏を通るだけ）
            if (sx - half > v.x && sx + half < v.x + v.w && sy - half > v.y && sy + half < v.y + v.h) continue;
            // 手前側は土台の球より後に描く。ここでは番号と奥行きを控えるだけ。
            // 板の席は並べ替えも要らないので、別の控えへ回す
            if (ball.kind[slot]) {
              ballSeatZ[slot] = z2;
              ballFront[ballFrontN++] = slot;
            } else {
              ballPlate[ballPlateN++] = slot;
            }
            // 石の面のどれかが光を返す向きに来ていたら、その面の所へ小さな光を置く。
            // 置き場は石の中心から面の向きへ少しずらした所で、大きさは石の腰の太さに合わせる。
            // 貼るのはこの後 3. でまとめて。拾うのは実際に描く分だけ＝画面の外と、動画にすっかり隠れる分は出さない。
            // 代役の板の席はここでは拾わず、板そのものを白い絵に差し替えるだけにする
            if (flash && ball.kind[slot] && bloomN < BLOOM_MAX
              && findLitFacet(x1, y2, z2, Hx, Hy, Hz, lv.seatSpin[slot], lv.spinCos[slot], lv.spinSin[slot])) {
              const gemD = Math.min(tileU, tileV);
              bloomX[bloomN] = sx + facetFlash[1] * gemD * FACET_FLASH_OFFSET;
              bloomY[bloomN] = sy - facetFlash[2] * gemD * FACET_FLASH_OFFSET;
              bloomD[bloomN] = gemD * FACET_FLASH_SCALE;
              const oc2 = slot * 3;
              bloomC[bloomN * 3] = ball.rgb[oc2];
              bloomC[bloomN * 3 + 1] = ball.rgb[oc2 + 1];
              bloomC[bloomN * 3 + 2] = ball.rgb[oc2 + 2];
              bloomA[bloomN] = FACET_FLASH_ALPHA * facetFlash[0];
              bloomN++;
            }
          }
          // 土台の球。色は付けず、明暗はこの後まとめて掛ける
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          g.fillStyle = "#171a21";
          g.beginPath();
          g.arc(cx, cy, r, 0, Math.PI * 2);
          g.fill();
          // 手前側の石。奥にあるものから順に重ねる＝より手前の石が上に来る
          if (ballFrontN > 1) ballFront.subarray(0, ballFrontN).sort((s1, s2) => ballSeatZ[s1] - ballSeatZ[s2]);
          for (let i = 0; i < ballFrontN; i++) {
            const slot = ballFront[i];
            const sp = ball.sprites[slot];
            if (!sp) continue;
            const o = slot * 4;
            const x1 = lat[o] * cs + lat[o + 2] * sn;
            const z1 = -lat[o] * sn + lat[o + 2] * cs;
            const y2 = lat[o + 1] * ct - z1 * st;
            const z2 = lat[o + 1] * st + z1 * ct;
            drawSeatStone(sp, x1, y2, z2, cx + x1 * r, cy - y2 * r, Math.max(BALL_TILE_MIN, tileK * lat[o + 3]));
          }
          // 明暗: 光の当たる所を中心にした放射の黒を、この紙に描いた所だけへ掛ける。
          // 何も描いていない所には掛からないので、球の周りに黒い輪が出ない
          if (layer) {
            const gx = cx + Math.cos(lightAng) * r * 0.55, gy = cy - Math.sin(lightAng) * r * 0.55;
            const rr = r * 1.9;
            const gd = g.createRadialGradient(gx, gy, r * 0.1, gx, gy, rr);
            gd.addColorStop(0, "rgba(0,0,0,0)");
            gd.addColorStop(0.5, "rgba(0,0,0," + (1 - BALL_DIM) * 0.45 + ")");
            gd.addColorStop(1, "rgba(0,0,0," + (1 - BALL_DIM) + ")");
            g.globalCompositeOperation = "source-atop";
            g.fillStyle = gd;
            g.fillRect(0, 0, W, H);
            g.globalCompositeOperation = "source-over";
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.drawImage(layer.canvas, 0, 0, W, H);
          }
          // 代役の板。消す前と同じ貼り方に戻す＝席の接する面の向きに合わせて潰し、明暗は1枚ずつ透け具合で付け、
          // ちょうど光を返す向きに来たら白く光った絵に差し替える。
          // 板は隣と重ならないので透けの心配が無く、自分で明暗を持っているので別の紙には乗せない。
          // 石の紙を本紙へ貼り終えてから最後に貼る＝後から掛ける明暗が二重に効かない。
          // 焼け待ちの間だけの姿なので、石との前後関係は厳密には合わせない
          for (let i = 0; i < ballPlateN; i++) {
            const slot = ballPlate[i];
            const sp = ball.sprites[slot];
            if (!sp) continue;
            const o = slot * 4;
            const x1 = lat[o] * cs + lat[o + 2] * sn;
            const z1 = -lat[o] * sn + lat[o + 2] * cs;
            const y2 = lat[o + 1] * ct - z1 * st;
            const z2 = lat[o + 1] * st + z1 * ct;
            const sx = cx + x1 * r, sy = cy - y2 * r;
            const d = x1 * Lx + y2 * Ly + z2 * Lz;
            // 板は球に接する平面に貼られている。その平面の「北向き」と「東向き」を画面に写した2本を、
            // そのまま絵の縦と横の向きに使う＝正面の板は素の💎、縁へ行くほど潰れて見える。
            // 帯の緯度（lat[o+1]）は回しても傾けても変わらないので、北向きの計算にそのまま使える
            const ap = lat[o + 1];
            const q = Math.sqrt(Math.max(1e-4, 1 - ap * ap));
            const nx = (-ap * x1) / q, ny = (ct - ap * y2) / q, nz = (st - ap * z2) / q;
            const ex = ny * z2 - nz * y2, ey = nz * x1 - nx * z2;
            const tileU = Math.max(BALL_TILE_MIN, tileK * lat[o + 3]);
            ctx.globalAlpha = d > 0 ? BALL_DIM + (1 - BALL_DIM) * d : BALL_DIM;
            // 画面の y は下向きなので、縦方向は符号を裏返す
            ctx.setTransform(ex * tileU * dpr, -ey * tileU * dpr, -nx * tileV * dpr, ny * tileV * dpr, sx * dpr, sy * dpr);
            const fs = flash && d > BALL_HL_CUT
              ? Math.min(PLATE_FLASH - 1, 1 + Math.floor(((d - BALL_HL_CUT) / (1 - BALL_HL_CUT)) * (PLATE_FLASH - 1)))
              : 0;
            ctx.drawImage(sp[fs], -0.5, -0.5, 1, 1);
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.globalAlpha = 1;
        }

        // 3. 壁に映る光の粒: 2. で拾った奥側の板を、球の中心から見た向きへ伸ばした所に、柔らかい光の丸として貼る。
        //    奥側の板は画面の上で手前の板と逆向きに動くので、粒も逆向きに流れる＝本物のミラーボールと同じ。
        //    額縁（動画を含む）の中は clip で除外する。合成は lighter なので、重なった所だけ明るくなる。
        //    貼るのは板を全部描いた後。粒は球の 2.4 倍の広がりに散るので板とはほとんど重ならず、
        //    重なった時も足し算で少し明るくなるだけ（主役の動画より目立たない濃さに抑えてある）
        //    粒は球の奥にある光なので、球の円の内側には貼らない（Hop指摘 2026-09-11）。
        //    光を返した面の小さな光（2. で拾った分）は球の上のものなので、円は抜かず額縁だけを抜いた囲いで貼る。
        //    額縁の地色はこのキャンバスに塗ってあるので、囲いを外すと額縁まで明るくなってしまう
        if (wallN > 0 && wallAlpha > 0.01) {
          const gem = Math.min(1, Math.max(0, (p - WALL_GEM_FROM) / WALL_GEM_FADE));
          const gemW = wallDia * WALL_GEM_SCALE;
          ctx.save();
          // 囲いは2回に分けて掛ける。1回目で額縁の中を抜き、2回目で球の円を抜く＝両方を抜いた残りだけに貼る。
          // 円を1回目と同じ経路に足すと、額縁の矩形と円が重なっている所は境目を3回またぐことになり、
          // evenodd の数え方では逆に「貼れる側」へ返ってしまう。
          // 円の半径は、球へ刺さった石が縁から頭を出す分まで隠すために少し大きく取る
          ctx.beginPath();
          ctx.rect(0, 0, W, H);
          ctx.rect(f.x, f.y, f.w, f.h);
          ctx.clip("evenodd");
          ctx.beginPath();
          ctx.rect(0, 0, W, H);
          ctx.arc(cx, cy, r + tileV * 0.5, 0, Math.PI * 2);
          ctx.clip("evenodd");
          ctx.globalCompositeOperation = "lighter";
          for (let i = 0; i < wallN; i++) {
            const oc = i * 3;
            const cr = wallC[oc], cg = wallC[oc + 1], cb = wallC[oc + 2];
            ctx.globalAlpha = Math.min(1, wallAlpha * wallW[i]);
            ctx.drawImage(getWallSpot((cr << 16) | (cg << 8) | cb, cr, cg, cb),
              wallX[i] - wallDia / 2, wallY[i] - wallDia / 2, wallDia, wallDia);
          }
          // 終盤だけ、粒の中心に真上から見た💎を薄く重ねて輪郭を出す（曲が進むほどはっきりする）
          if (gem > 0) {
            for (let i = 0; i < wallN; i++) {
              const sp2 = wallP[i];
              if (!sp2) continue;
              ctx.globalAlpha = Math.min(1, wallAlpha * wallW[i] * WALL_GEM_ALPHA * gem);
              ctx.drawImage(sp2, wallX[i] - gemW / 2, wallY[i] - gemW / 2, gemW, gemW);
            }
          }
          ctx.globalAlpha = 1;
          ctx.restore();
        }
        // 面が返した光は球の上にあるので、額縁だけを抜いた囲いで貼る
        if (bloomN > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, W, H);
          ctx.rect(f.x, f.y, f.w, f.h);
          ctx.clip("evenodd");
          ctx.globalCompositeOperation = "lighter";
          for (let i = 0; i < bloomN; i++) {
            const oc = i * 3;
            const cr = bloomC[oc], cg = bloomC[oc + 1], cb = bloomC[oc + 2];
            const dia = bloomD[i];
            ctx.globalAlpha = Math.min(1, bloomA[i]);
            ctx.drawImage(getWallSpot((cr << 16) | (cg << 8) | cb, cr, cg, cb),
              bloomX[i] - dia / 2, bloomY[i] - dia / 2, dia, dia);
          }
          ctx.globalAlpha = 1;
          ctx.restore();
        }

        // 4. 飛んでいる途中の💎（落ちている時と同じ面付きの絵）。
        //    自分の席が手前側で動画の外にあるなら、その席へ向かって飛び、飛びながら板の大きさまで縮んで
        //    着いた瞬間に板として貼られる＝押した💎がはめ込まれる様子が見える（Hop指摘 2026-09-08）。
        //    席が動画の裏や奥側にある時は今までどおり動画の中心へ飛んで隠れ、裏で席が埋まる。
        //    中心へ飛ぶ時の自分の分だけは別扱い: 動画の矩形の縁までは大きさを保ったまま弧を描いて飛び、
        //    縁に着いてから残りの時間で中へ吸い込まれて縮む。速さも大きさも変わるのは動画の裏に入った後なので、
        //    見えている間はずっと同じ大きさの💎が飛んでいるように見える（Hop報告 2026-09-08 の「出た瞬間に消える」対策）
        for (const sk of suck) {
          const u = Math.min(1, (now - sk.t0) / sk.dur);
          // その💎に取ってある席が、いま画面のどこにあるか（回転と傾きを反映）
          const so = sk.seat * 4;
          const sx1 = lat[so] * cs + lat[so + 2] * sn;
          const sz1 = -lat[so] * sn + lat[so + 2] * cs;
          const sy2 = lat[so + 1] * ct - sz1 * st;
          const sz2 = lat[so + 1] * st + sz1 * ct;
          const seatX = cx + sx1 * r, seatY = cy - sy2 * r;
          // 手前側で、かつ動画に隠れない席なら「見えている席」
          const seatShown = sz2 > 0 && (seatX < v.x || seatX > v.x + v.w || seatY < v.y || seatY > v.y + v.h);
          if (!sk.aimed) {
            // 飛び方は押した直後の1フレーム目に決めて以後は変えない（途中で切り替わると飛び方が跳ぶ）
            sk.aimed = true;
            sk.toSeat = seatShown;
            sk.tx = seatShown ? seatX : cx;
            sk.ty = seatShown ? seatY : cy;
          } else {
            // 席は回転で動くので行き先を追いかける。席が動画の裏へ入ってしまったら行き先を中心へ寄せる。
            // 寄せ方はなめらかなので、行き先が変わっても💎の位置は跳ばない
            const wx = sk.toSeat && seatShown ? seatX : cx;
            const wy = sk.toSeat && seatShown ? seatY : cy;
            const m = Math.min(1, dt * SEAT_FOLLOW);
            sk.tx += (wx - sk.tx) * m;
            sk.ty += (wy - sk.ty) * m;
          }
          const dx0 = sk.x0 - sk.tx, dy0 = sk.y0 - sk.ty;
          let k: number, shrink: number;
          if (sk.toSeat) {
            k = u * u * (3 - 2 * u);   // ゆっくり動き出して、着く直前でまたゆっくり＝席にそっと収まる
            shrink = 0;                // 大きさは「板の大きさへ縮む」で別に決める（下）
          } else if (sk.self) {
            // 出発点から中心へ向かう線が動画の矩形の縁を横切る所（進み具合の割合で表す）
            const mx = Math.abs(dx0) > 0.5 ? (v.w / 2) / Math.abs(dx0) : 1;
            const my = Math.abs(dy0) > 0.5 ? (v.h / 2) / Math.abs(dy0) : 1;
            const kEnter = 1 - Math.min(1, Math.min(mx, my));
            const w1 = Math.min(1, u / SELF_SUCK_ENTER);
            k = u < SELF_SUCK_ENTER
              ? kEnter * (0.35 * w1 + 0.65 * w1 * w1)   // 縁まではゆっくり動き出して少しずつ速く
              : kEnter + (1 - kEnter) * ((u - SELF_SUCK_ENTER) / (1 - SELF_SUCK_ENTER));
            shrink = k <= kEnter ? 0 : (k - kEnter) / Math.max(0.001, 1 - kEnter);
          } else {
            k = u * u;
            shrink = k;
          }
          suckDraw.x = sk.x0 + (sk.tx - sk.x0) * k;
          suckDraw.y = sk.y0 + (sk.ty - sk.y0) * k;
          if (sk.bow) {
            // 進む向きと直角にずらす＝道が少し弧を描く。出発点と着地点ではずれ0
            const len = Math.hypot(dx0, dy0) || 1;
            const off = sk.bow * Math.sin(Math.PI * u);
            suckDraw.x += (-dy0 / len) * off;
            suckDraw.y += (dx0 / len) * off;
          }
          // 飛んでいる姿勢。通り道の上をどこまで進めるかと、絵ごと画面の中で何回まわすかを飛び方から決める。
          // 進み具合は飛行の進み u で測るので、飛ぶ時間が長くても短くても同じだけ回りきる。
          // 動きを減らす設定では、飛び方に関わらず出発時の向きのまま飛ばす
          const style = FLIGHT_STYLES[sk.flight] ?? FLIGHT_STYLES[0];
          if (reduceMotionRef.current) {
            suckDraw.ang = sk.ang;
            suckDraw.roll = sk.roll;
          } else {
            suckDraw.ang = sk.ang + u * style.laps * Math.PI * 2;
            suckDraw.roll = sk.roll + style.turns * Math.PI * 2 * (style.quad ? u * u : u)
              + (style.wobble ? style.wobble * Math.sin(u * Math.PI * 2 * FLIGHT_WOBBLE_CYCLES) : 0);
          }
          // 席へ向かう分は板の大きさまで縮む。drawGemLive は size の (2 / 0.95) 倍の幅で描くので、
          // 貼られる板（幅＝tile）と同じ見え方になる大きさに合わせる＝着いた瞬間に大きさが跳ばない。
          // 元の大きさにはカメラの寄りを掛ける。球と刺さった石は寄りで大きくなるので、
          // 飛んでいる💎だけ素のままだと、曲の終わりに球だけが近くにあるように見えてしまう（Hop決定 2026-09-11）。
          // 寄りは毎コマ変わりうるので、出発時の大きさには混ぜず描く時に掛ける
          const base = sk.size * ball.zoom;
          suckDraw.size = sk.toSeat
            ? base + (tileV * 0.95 / 2 - base) * k
            : base * (1 - shrink * SUCK_SHRINK);
          suckDraw.path = sk.path;
          suckDraw.rgb = sk.rgb;
          // 席にはめ込まれる直前だけ、その席に収まった時と同じ向きの絵に差し替える（回して見せる演出はしない）。
          // その色の立体がまだ焼けていなければ、収まる先も代役の板なので板の絵にする。
          // 動画の中心へ吸い込まれて隠れる分は、差し替えても見えないのでそのまま飛んでいる向きで飛ばす
          if (sk.toSeat && sk.dur - (now - sk.t0) < SEAT_FACE_MS) {
            const w = suckDraw.size * 2 / 0.95;
            const face = hasRealStoneSprites(sk.rgb)
              ? getStoneSprites(sk.rgb)[stoneIndexForDepth(sz2)]
              : getPlateSprites(sk.rgb)[0];
            ctx.drawImage(face, suckDraw.x - w / 2, suckDraw.y - w / 2, w, w);
          } else {
            drawGemLive(suckDraw);
          }
        }

        // 5. 押した手応えの閃光
        drawScreenFlashes();
        return;
      }

      if (gems.length === 0) return;

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
        const sx = cx + (g.x - cx) * scale, sy = H + oy + (g.y - floorY) * scale;
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
      ctx.translate(cx, H + oy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -floorY);
      let settledCount = 0;
      for (const g of gems) if (g.settled) settledCount++;
      if (settledCount > LIVE_KEEP) bakeOldest(gems, settledCount - LIVE_KEEP);
      else if (gems.length > MAX_GEMS) bakeOldest(gems, gems.length - MAX_GEMS);
      if (bake) ctx.drawImage(bake.canvas, bake.x0, bake.y0, bake.w, bake.h);
      for (const g of gems) {
        if (g.settled) drawGemSettled(g);
        else drawGemLive(g);
      }
      // 山のきらめき: 積もった💎（焼き込んだ分も含む）からランダムに1つ選び、押した時と同じ閃光を出す。
      // 画面の外や動画の裏にある💎を選んでも見えないので、画面内のものが当たるまで数回引き直す（Hop報告 2026-09-07）。
      // 曲が進むほど頻度が上がり、最後の山で一番ピカピカする【仮: 毎秒 0.5〜6回】。動き軽減では出さない（飾りなので）
      if (!reduceMotionRef.current) {
        const pts = sparkPointsRef.current;
        if (pts.length > 0) {
          const rate = 0.5 + 5.5 * p * p;
          if (Math.random() < rate * dt) {
            for (let tries = 0; tries < 12; tries++) {
              const pt = pts[Math.floor(Math.random() * pts.length)];
              const sx = cx + (pt.x - cx) * scale, sy = H + oy + (pt.y - floorY) * scale;
              if (sx < 0 || sx > W || sy < 0 || sy > H) continue;
              if (sx > v.x && sx < v.x + v.w && sy > v.y && sy < v.y + v.h) continue;
              flashesRef.current.push({ x: pt.x, y: pt.y, t0: now, rgb: pt.rgb, size: pt.size * 0.8 });
              break;
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
