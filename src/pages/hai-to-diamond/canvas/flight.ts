// 押された💎が席へ飛んでいく間のこと。飛び方・通り道・飛び立ち・着地の判定をここに集めた。
// DiamondCanvas.tsx から切り出しただけで、中身は変えていない。
import { FACE_ON_ANG, TUMBLE_PATHS } from "../gemSprites";
import {
  type Ball, type BallView, type SeatHold, BALL_R, BALL_SPIN_SEC, BALL_TILE_FILL, BALL_TILE_MIN, BALL_TILT,
  BALL_ZOOM_MIN, getBallLattice, landOnSeat, rememberSelfSeat, reserveSeat, reserveSelfSeat,
} from "./ball";
import { drawGemLive, SHRINK_MIN, SHRINK_REF, SIZE_MIN, SIZE_RANGE } from "./pile";

/** ミラーボール方式で、動画の中心へ吸い込まれている途中の💎（画面座標）。
 *  行き先は覚えず、描く時に毎回いまの動画の中心を見る＝再生中に画面の高さが変わっても狙いがずれない */
export type Suck = {
  x0: number; y0: number;   // 出発（画面座標）
  t0: number;               // 飛び始めた時刻(ms)
  dur: number;              // 吸い込まれるまでの時間(ms)
  ang: number;              // 出た時の向き(rad)。着く時に angEnd になるよう、飛び方の回る量から逆算してある
  angEnd: number;           // 着く時の向き(rad)＝その通り道でいちばん正面に近い姿勢（Hop決定 2026-09-13）
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
  /** 手前かつ動画の矩形の外の席を取れたか（自分の分だけ）。
   *  席は着く頃の球の向きで選んでいるので、押した瞬間の向きで「奥」と見なして
   *  輪郭のきわで消してしまわないようにする目印 */
  seatFront: boolean;
  /** 席を取る時に、決まった混ぜ順の目印（reserved）を1つ進めたか。取り消しの時に戻すかどうかの判断に使う。
   *  自分の分は混ぜ順を使わずに手前の席を選ぶので false になる */
  seatCounted: boolean;
  /** 行き先の席が、いま球のどの方角に見えているか(rad)と、球の中心からどれだけ離れて見えるか(px)。
   *  席は回転で動くので毎フレーム測り直し、少しずつ寄せる＝行き先が動いても飛び方が跳ばない */
  seatAng: number;
  seatDist: number;
  /** 行き先を一度でも決めたか（false のうちは寄せずに直接そこへ置く） */
  aimed: boolean;
  /** 席そのものへ着地せず、球の輪郭のきわから中へ入って消えるか。
   *  奥を向いている席と、動画にすっぽり隠れる手前の席がこれにあたる。
   *  押した直後の1フレーム目に決めて以後は変えない（途中で切り替わると飛び方が跳ぶ） */
  enter: boolean;
  /** どちら回りで回り込むか（+1 / -1）。出発点のある側から回る */
  wrapSide: number;
  /** 回り込みの深さ（0=まっすぐ入る 1=いっぱいに回り込む）。
   *  正面を向いた席ほど浅く、輪郭ぎわの席と中へ入る分は深い。押した直後に決めて以後は変えない */
  wrapCurl: number;
};

const SUCK_MS = 700;             // 💎が席へ飛び着くまで
const SUCK_MS_JITTER = 200;      // 同上のばらつき。全部が同じ速さだと機械的に見える
// 飛んでいる💎の通り道。出発点から着く所まで、位置も速さの向きも切れ目のない1本の3次ベジェ曲線で飛ぶ。
//   P0 = 出発点、P1 = 出発の向きへ少し伸ばした所、P2 = 球の輪郭の外側で、着く点の接線の方へ引いた所、P3 = 着く点。
// 前半は入口へ直進・後半は輪の上を滑る、という2段の道にすると、切り替わる所で速さと向きが折れて見える
// （Hop指摘 2026-09-13）。1本の曲線に1つのなめらかな進みにして、途中で速さが跳ばないようにした。
// 行き先は席の全面に均等のまま。手前の見える席を優先したり奥の席を減らしたりはしない（Hop条件 2026-09-13）。
// 数字は全部【仮】
const SUCK_CTRL_LEAD = 0.45;     // P1 を、出発点から着く点までの距離の何倍ぶん出発の向きへ伸ばすか
const SUCK_WRAP_BULGE = 1.14;    // P2 を置く、輪郭の外側の半径（見かけの半径の倍数）
const SUCK_WRAP_SWEEP = 1.0;     // 回り込みがいちばん深い時の角度(rad)。正面を向いた席ほど浅くなる
const SUCK_ENTER_R = 0.92;       // 輪郭のきわから中へ入る分の、着く点の半径（見かけの半径の倍数）。
                                 // 輪郭より少しだけ内側に置き、またぐ前後で薄くなりきるようにする
const SUCK_FADE_FROM = 0.72;     // 飛ぶ時間のうち、ここから薄くなり始める
const SUCK_DEPTH_SOFT = 0.08;    // 席の深さがこれを下回っていると、着く頃には薄くする。
                                 // 鏡は真横を向くとほとんど見えないので、飛んでいる💎の濃さもそれに合わせる
                                 // ＝着いて鏡に変わる瞬間に濃さが跳ばない。
                                 // 0.2 と見比べて 0.08 を採った（Hop決定 2026-09-13）。縁への着地がはっきり見える
// 自分の💎を群衆と見分ける（Hop決定 2026-09-13）。飛んでいる間だけ大きくする【仮】
const SELF_BIG = 1;              // 自分の分の飛んでいる大きさを何倍にするか。1.35 / 1.0 / 0.8 を見比べて 1 を採った（Hop決定 2026-09-13）
const OTHER_SMALL = 0.5;         // 他の人の分の飛んでいる大きさを何倍にするか【仮】。1倍では大きすぎた（Hop指摘 2026-09-13）
// 席へ着く💎は、飛びの終盤で鏡と平行になるまで寝る（Hop指示 2026-09-13「着席の瞬間こっちに面を向けるんじゃなくて鏡に対して平行に」）。
// 鏡は「席に接する平面の東向き・北向きを画面に写した2本」を絵の縦横に使って描いている（ball.ts の drawMirrors）。
// 同じ2本を💎の絵にも掛ける＝正面の席では素の丸のまま、縁の席では鏡と同じだけ潰れて見える。
// 掛け方は飛びの進みで正面向き（そのまま）から鏡の平面へなめらかに移す。止まっている間は寝たまま
const LAY_FROM = 0.6;            // 飛ぶ時間のうち、ここから鏡の平面へ寝始める【仮】
// 自分の分は、着いた場所でひと呼吸だけ💎のまま止まってから鏡になる（Hop決定 2026-09-13 案1）
const SELF_LAND_HOLD_MS = 220;   // 席に着いてから鏡に変わるまで止まっている時間【仮】
const SELF_LAND_FLASH_MS = 700;  // 自分の分の着地の光が通常の見え方へ戻るまで【仮】。他の人の分は LAND_FLASH_MS のまま

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
const SELF_SUCK_MS = 900;        // 席へ着くまで。他の人の分より少し長くして、飛んでいる姿が見えるようにする【仮】
const SELF_SUCK_MS_JITTER = 150; // 同上のばらつき
const SELF_SUCK_BOW = 45;        // 出発の向きの横への寄せ(px)。まっすぐ飛ばず少し弧を描く（ベジェの P1 を横へずらす）【仮】
const SELF_ABOVE_BUTTON = 28;    // 押した💎のボタンの中心から、これだけ上を出発点にする。
                                 // 押した指のすぐ上から飛び立つので、自分の1個がどれか目で追える（Hop決定 2026-09-11）【仮】
const SPAWN_OUTSIDE = 48;        // 他の人の分の出発点を、画面の縁からこれだけ外へ押し出す。
                                 // 縁ぴったりだと出た瞬間に見えて「画面の中で湧いた」ように映る（Hop報告 2026-09-11）【仮】

// 💎の行き先を「動画の中心」から「これから自分がはまる席」に変える（Hop指摘 2026-09-08）。
// 席が手前側で動画の外にあれば、その席へ飛んで鏡の大きさまで縮み、着いた瞬間に鏡として貼られる
const SEAT_FOLLOW = 8;           // 席の動きを追いかける速さ（1秒あたり）。席が回転で動画の裏へ入った時に
                                 // 行き先が中心へ移るのも、この速さでなめらかに動く＝飛び先が跳ばない【仮】
// 飛んでいる間は最後までダイヤのまま。着いた瞬間に鏡になる（Hop決定 2026-09-11）

// 吸い込まれ中の💎を描く時の使い回しの入れ物（1個ずつ作ると押した数だけゴミが出る）
const suckDraw = { x: 0, y: 0, ang: 0, path: 0, roll: 0, size: 0, rgb: [0, 0, 0] as [number, number, number] };

/** ミラーボール方式で押された💎を1つ飛ばす。積もらせず、動画の中心へ吸い込む。
 *  自分の分は画面の下の方の中央寄りから、他の人の分は画面の縁のどこかから出る。着いたら球の表面の鏡になる。
 *  戻り値は出発点（押した手応えの閃光をそこへ出すため） */
export function spawnSuck(
  suck: Suck[], ball: Ball, rgb: [number, number, number], self: boolean,
  origin: { x: number; y: number } | undefined,
  W: number, H: number, videoRect: { x: number; y: number; w: number; h: number },
  now: number, spawned: number, reduceMotion: boolean,
): { x0: number; y0: number } {
  let x0: number, y0: number, bow = 0;
  if (self) {
    if (origin) {
      // 押した💎のボタンの中心のすぐ上から飛び立つ（Hop決定 2026-09-11）
      x0 = origin.x;
      y0 = origin.y - SELF_ABOVE_BUTTON;
    } else {
      // ボタンの位置が分からない時は今までどおり中央寄りの下の方から出す。横に散らしすぎると
      // 動画の横の狭い所を通ることになり、動画の下から中心へ真っ直ぐ上がっていく道筋が読めなくなる
      x0 = W / 2 + (Math.random() * 2 - 1) * SELF_SUCK_X_SPREAD;
      y0 = H - SELF_SUCK_Y + (Math.random() - 0.5) * SELF_SUCK_Y_SPREAD;
    }
    // 出発点が動画の矩形の中や、そのすぐ下にならないようにする。
    // 画面が低い端末では動画の下の余白が狭く、そのままだと出た瞬間に裏へ入ってしまう
    const vb = videoRect;
    if (vb.w > 0) y0 = Math.min(H - 8, Math.max(y0, vb.y + vb.h + SELF_SUCK_MIN_GAP));
    bow = (Math.random() < 0.5 ? -1 : 1) * SELF_SUCK_BOW * (0.6 + Math.random() * 0.4);
  } else {
    // 画面の縁を1周ぶんの長さと見て、その上のどこか1点を選び、そこから画面の外へ押し出す
    // ＝画面の中で湧かず、外から入ってくる
    const per = (W + H) * 2;
    const u = Math.random() * per;
    if (u < W) { x0 = u; y0 = H + SPAWN_OUTSIDE; }
    else if (u < W + H) { x0 = W + SPAWN_OUTSIDE; y0 = W + H - u; }
    else if (u < W * 2 + H) { x0 = W * 2 + H - u; y0 = -SPAWN_OUTSIDE; }
    else { x0 = -SPAWN_OUTSIDE; y0 = u - (W * 2 + H); }
  }
  const shrinkM = Math.max(SHRINK_MIN, Math.min(1, Math.sqrt(SHRINK_REF / spawned)));
  // 押した時点で「この💎がはまる席」を1つ取っておく。席は色で決まる＝同じ色の席の隣が空いていればそこ、
  // 無ければその色の居場所にいちばん近い空席。席が全部埋まったら、いちばん古い鏡を貼り替える
  const dur = self
    ? SELF_SUCK_MS + Math.random() * SELF_SUCK_MS_JITTER
    : SUCK_MS + Math.random() * SUCK_MS_JITTER;
  // 自分の分は、動画の外に見えている手前の席へ着く。
  // 席は球と一緒に回っているので、押した今ではなく「着く頃（dur だけ先）」の向きで選ぶ
  //  ＝飛んでいる間に回って動画の裏や輪郭の裏へ入ってしまうのを避ける
  let seat: SeatHold | null = null;
  const vb = videoRect;
  if (self && vb.w > 0) {
    const spin = reduceMotion ? 0 : ((now + dur) / 1000) * (Math.PI * 2 / BALL_SPIN_SEC);
    const rNow = BALL_R * ball.zoom;
    seat = reserveSelfSeat(ball, rgb, {
      cx: vb.x + vb.w / 2, cy: vb.y + vb.h / 2, r: rNow,
      cs: Math.cos(spin), sn: Math.sin(spin), ct: Math.cos(BALL_TILT), st: Math.sin(BALL_TILT),
      tileV: Math.max(BALL_TILE_MIN, rNow * BALL_TILE_FILL * getBallLattice().v),
      v: vb,
    });
  }
  // 他の人の分と、条件に合う席が1つも無かった時は、今までどおりの決め方（球の全面に均等）
  const front = seat !== null;
  if (!seat) seat = reserveSeat(ball, rgb);
  if (self) rememberSelfSeat(ball, seat.seat);
  // 飛び方を1つ引く。飛び方によっては使う通り道が決まっているので、通り道もここで合わせて引く
  const flight = Math.floor(Math.random() * FLIGHT_STYLES.length);
  const fp = FLIGHT_STYLES[flight].paths;
  const path = fp ? fp[Math.floor(Math.random() * fp.length)] : Math.floor(Math.random() * TUMBLE_PATHS);
  // 着く時の姿勢を「いちばん正面に近いコマ」に固定し、出発の姿勢はそこから回る量ぶん戻した所にする。
  // 飛び方も回る量も変えず、着いた瞬間に横向きの💎が正面の鏡へ跳ばないようにする。
  // 画面の上での向き（roll）は今までどおり抽選なので、飛ぶ姿の散らばりは残る
  const angEnd = FACE_ON_ANG[path];
  suck.push({
    x0, y0, t0: now,
    dur,
    ang: angEnd - FLIGHT_STYLES[flight].laps * Math.PI * 2,
    angEnd,
    flight,
    path,
    roll: Math.random() * Math.PI * 2,
    size: (SIZE_MIN + Math.random() * SIZE_RANGE) * shrinkM,
    rgb, bow, self,
    seat: seat.seat, seatWasEmpty: seat.wasEmpty, seatPrevRgb: seat.prevRgb, seatPrevAge: seat.prevAge,
    seatCounted: seat.counted, seatFront: front,
    seatAng: 0, seatDist: 0, aimed: false, enter: false, wrapSide: 1, wrapCurl: 0,
  });
  return { x0, y0 };
}

/** 飛び終わった💎を球の表面へ貼る。貼る場所は、押した時に取っておいた席（sk.seat）。
 *  席は色ごとにまとまるように決めてあるので、同じ色の鏡が隣り合って塊になる。
 *  席が全部埋まった後に取った席は、いちばん古い鏡の貼り替えになる。
 *  自分の分で席へ着く分だけは、着いた場所で SELF_LAND_HOLD_MS のあいだ💎のまま止まってから鏡になる。
 *  席は押した時に取ってあるので、止まっている間に他の人の分がそこへ入ることはない */
export function landSucks(suck: Suck[], ball: Ball, now: number) {
  for (let i = suck.length - 1; i >= 0; i--) {
    const sk = suck[i];
    const held = sk.self && !sk.enter;
    if (now - sk.t0 < sk.dur + (held ? SELF_LAND_HOLD_MS : 0)) continue;
    landOnSeat(ball, sk.seat, sk.rgb, now, held ? SELF_LAND_FLASH_MS : undefined);
    suck.splice(i, 1);
  }
}

/** 飛んでいる途中の💎（落ちている時と同じ面付きの絵）。
 *  押した💎は必ず自分の席へ向かって飛ぶ。行き先の席は球の全面に均等に割り当てられているので、
 *  手前へ来る分・輪郭ぎわを回る分・向こう側へ入っていく分が自然に散らばる（Hop決定 2026-09-13）。
 *  通り道は1本の3次ベジェ曲線。球を突き抜けず、輪郭の外側をなぞってから席へ寄る。
 *  手前の見えている席へ向かう分は、飛びながら鏡の大きさまで縮んで、着いた瞬間に鏡として貼られる
 *  ＝押した💎がはめ込まれる様子が見える（Hop指摘 2026-09-08）。
 *  奥を向いている席と、動画にすっぽり隠れる席へ向かう分は、輪郭のきわで薄くなって球の中へ入り、
 *  見えない所で席が埋まる。飛んでいる間は最後までダイヤのまま（Hop決定 2026-09-11） */
export function drawSucks(
  ctx: CanvasRenderingContext2D, suck: Suck[], ball: Ball, view: BallView,
  v: { x: number; y: number; w: number; h: number }, now: number, dt: number, reduceMotion: boolean,
) {
  const cx = view.cx, cy = view.cy, r = view.r;
  const cs = view.cs, sn = view.sn, ct = view.ct, vst = view.st;
  const lat = view.lat, tileV = view.tileV;
  for (const sk of suck) {
    const u = Math.min(1, (now - sk.t0) / sk.dur);
    // その💎に取ってある席が、いま画面のどこにあるか（回転と傾きを反映）
    const so = sk.seat * 4;
    const sx1 = lat[so] * cs + lat[so + 2] * sn;
    const sz1 = -lat[so] * sn + lat[so + 2] * cs;
    const sy2 = lat[so + 1] * ct - sz1 * vst;
    const sz2 = lat[so + 1] * vst + sz1 * ct;
    const seatX = cx + sx1 * r, seatY = cy - sy2 * r;
    const seatAng = Math.atan2(seatY - cy, seatX - cx);
    const seatDist = Math.hypot(seatX - cx, seatY - cy);
    if (!sk.aimed) {
      // 行き先の種類と回り込み方は押した直後の1フレーム目に決めて以後は変えない
      // （途中で切り替わると飛び方が跳ぶ）
      sk.aimed = true;
      sk.seatAng = seatAng;
      sk.seatDist = seatDist;
      // 奥を向いている席と、動画の矩形にすっぽり隠れる手前の席へは着地させず、
      // 輪郭のきわから中へ入って消す。席の割り当てそのものはここでは変えていない
      const hidden = seatX > v.x && seatX < v.x + v.w && seatY > v.y && seatY < v.y + v.h;
      // 自分の分で手前・矩形外の席を取れている時は、押した瞬間の向きで奥に見えていても着地させる。
      // 席は着く頃の向きで選んであるので、ここで消してしまうと動画の外へ着く形にならない
      sk.enter = sk.seatFront ? false : sz2 <= 0 || hidden;
      // 回り込みの深さは席の向きで決まる。正面を向いた席へはほぼまっすぐ、
      // 輪郭ぎわの席へは大きく回り込む。中へ入る分はいちばん深く回り込む
      sk.wrapCurl = sk.enter ? 1 : 1 - Math.min(1, Math.max(0, sz2));
      // 出発点のある側から回り込む＝球の向こう側へ大回りしない
      let d0 = Math.atan2(sk.y0 - cy, sk.x0 - cx) - seatAng;
      while (d0 > Math.PI) d0 -= Math.PI * 2;
      while (d0 < -Math.PI) d0 += Math.PI * 2;
      sk.wrapSide = d0 >= 0 ? 1 : -1;
    } else {
      // 席は回転で動くので、その方角と球の中心からの距離を少しずつ寄せる。
      // 寄せ方はなめらかなので、席が動いても曲線は跳ばない
      const m = Math.min(1, dt * SEAT_FOLLOW);
      let d1 = seatAng - sk.seatAng;
      while (d1 > Math.PI) d1 -= Math.PI * 2;
      while (d1 < -Math.PI) d1 += Math.PI * 2;
      sk.seatAng += d1 * m;
      sk.seatDist += (seatDist - sk.seatDist) * m;
    }
    // 1本の3次ベジェ曲線。P3 は着く点（席そのもの、または輪郭のきわの入る点）、
    // P2 はその点で輪郭に接する向きへ引いた輪郭の外の点、P1 は出発の向きを少し伸ばした所。
    // P2 は P3 に連れて動くので、席が回っても曲線はなめらかに移り変わる
    const rEnd = sk.enter ? r * SUCK_ENTER_R : sk.seatDist;
    const p3x = cx + Math.cos(sk.seatAng) * rEnd;
    const p3y = cy + Math.sin(sk.seatAng) * rEnd;
    const aw = sk.seatAng + sk.wrapSide * SUCK_WRAP_SWEEP * sk.wrapCurl;
    const rCtrl = rEnd + (r * SUCK_WRAP_BULGE - rEnd) * sk.wrapCurl;
    const p2x = cx + Math.cos(aw) * rCtrl;
    const p2y = cy + Math.sin(aw) * rCtrl;
    const dx = p3x - sk.x0, dy = p3y - sk.y0;
    const len = Math.hypot(dx, dy) || 1;
    const p1x = sk.x0 + dx * SUCK_CTRL_LEAD + (dy / len) * sk.bow;
    const p1y = sk.y0 + dy * SUCK_CTRL_LEAD + (-dx / len) * sk.bow;
    // 進み具合。ゆっくり動き出して、着く直前でまたゆっくり＝席にそっと収まる。
    // 曲線1本になめらかな進み1つなので、途中で速さも向きも跳ばない
    const t = u * u * (3 - 2 * u);
    const it = 1 - t;
    const b0 = it * it * it, b1 = 3 * it * it * t, b2 = 3 * it * t * t, b3 = t * t * t;
    suckDraw.x = b0 * sk.x0 + b1 * p1x + b2 * p2x + b3 * p3x;
    suckDraw.y = b0 * sk.y0 + b1 * p1y + b2 * p2y + b3 * p3y;
    // 席へ着く分は鏡の大きさまで縮む。drawGemLive は size の (2 / 0.95) 倍の幅で描くので、
    // 貼られる鏡（幅＝tile）と同じ見え方になる大きさに合わせる＝着いた瞬間に大きさが跳ばない。
    // 元の大きさにはカメラの寄りを掛ける。球と表面の鏡は寄りで大きくなるので、
    // 飛んでいる💎だけ素のままだと、曲の終わりに球だけが近くにあるように見えてしまう（Hop決定 2026-09-11）。
    // 寄りは毎コマ変わりうるので、出発時の大きさには混ぜず描く時に掛ける。
    // 輪郭のきわから中へ入る分は、縮まずに大きさを保ったまま消える
    // 自分の分は、飛んでいる間の大きさを SELF_BIG 倍にして群衆と見分けられるようにする。
    // 着く先の大きさは鏡と同じ見え方のまま変えないので、着いた瞬間に跳ばない。
    // 寄りは素の倍率ではなく「曲の始まりの寄り（BALL_ZOOM_MIN）を1倍とした倍率」で掛ける。
    // 素の倍率だと始まりから1.30倍で描かれ、序盤の他の人の💎が大きすぎた（Hop指摘 2026-09-13）。
    // 始まりが1倍、終わりが BALL_ZOOM_MAX / BALL_ZOOM_MIN ≒ 1.6倍。寄りとの連動そのものは残す
    const base = sk.size * (ball.zoom / BALL_ZOOM_MIN) * (sk.self ? SELF_BIG : OTHER_SMALL);
    suckDraw.size = sk.enter ? base : base + (tileV * 0.95 / 2 - base) * t;
    // 濃さ。輪郭の中へ入る分は消えきる。席へ着く分も、飛んでいる間に球が回って
    // 席が真横を向いてしまったらその分だけ薄くする。鏡は真横を向くとほとんど見えないので、
    // 着いて鏡に変わる瞬間に濃さが跳ばない。薄くなり始めも終わりもなめらかな曲線で結ぶ
    const endAlpha = sk.enter ? 0 : Math.min(1, Math.max(0, sz2 / SUCK_DEPTH_SOFT));
    let alpha = 1;
    if (endAlpha < 1 && u > SUCK_FADE_FROM) {
      const w = (u - SUCK_FADE_FROM) / (1 - SUCK_FADE_FROM);
      alpha = 1 + (endAlpha - 1) * w * w * (3 - 2 * w);
    }
    // 自分の分が席に着いて止まっている間は、薄くせずそのまま濃く描く
    if (sk.self && !sk.enter && now - sk.t0 >= sk.dur) alpha = 1;
    // 飛んでいる姿勢。通り道の上をどこまで進めるかと、絵ごと画面の中で何回まわすかを飛び方から決める。
    // 進み具合は飛行の進み u で測るので、飛ぶ時間が長くても短くても同じだけ回りきる。
    // 動きを減らす設定では、飛び方に関わらず出発時の向きのまま飛ばす
    const style = FLIGHT_STYLES[sk.flight] ?? FLIGHT_STYLES[0];
    if (reduceMotion) {
      suckDraw.ang = sk.angEnd;
      suckDraw.roll = sk.roll;
    } else {
      suckDraw.ang = sk.ang + u * style.laps * Math.PI * 2;
      suckDraw.roll = sk.roll + style.turns * Math.PI * 2 * (style.quad ? u * u : u)
        + (style.wobble ? style.wobble * Math.sin(u * Math.PI * 2 * FLIGHT_WOBBLE_CYCLES) : 0);
    }
    suckDraw.path = sk.path;
    suckDraw.rgb = sk.rgb;
    // 席へ着く分は、飛びの終盤で鏡の平面へ寝かせる。鏡と同じ「東向き・北向きを画面に写した2本」を
    // 絵の縦横に掛ける。正面向き（そのまま）からその2本へ、なめらかな曲線で移す。
    // 席は回転で動くので2本は毎コマいまの席から取る＝着いた瞬間の鏡とぴったり重なる
    let lay = 0;
    if (!sk.enter && !reduceMotion && u > LAY_FROM) {
      const w = (u - LAY_FROM) / (1 - LAY_FROM);
      lay = w * w * (3 - 2 * w);
    }
    if (lay > 0) {
      const ap = lat[so + 1];
      const q = Math.sqrt(Math.max(1e-4, 1 - ap * ap));
      const nx = (-ap * sx1) / q, ny = (ct - ap * sy2) / q, nz = (vst - ap * sz2) / q;
      const ex = ny * sz2 - nz * sy2, ey = nz * sx1 - nx * sz2;
      // 画面の y は下向きなので、縦方向は符号を裏返す（drawMirrors と同じ向き）
      const a = 1 + (ex - 1) * lay, b = (-ey) * lay;
      const c = (-nx) * lay, d = 1 + (ny - 1) * lay;
      ctx.save();
      ctx.translate(suckDraw.x, suckDraw.y);
      ctx.transform(a, b, c, d, 0, 0);
      suckDraw.x = 0;
      suckDraw.y = 0;
    }
    // 飛んでいる間は最後までダイヤのまま。着いた瞬間に鏡になる（Hop決定 2026-09-11）
    if (alpha < 1) {
      ctx.globalAlpha = alpha;
      drawGemLive(ctx, suckDraw);
      ctx.globalAlpha = 1;
    } else {
      drawGemLive(ctx, suckDraw);
    }
    if (lay > 0) ctx.restore();
  }
}
