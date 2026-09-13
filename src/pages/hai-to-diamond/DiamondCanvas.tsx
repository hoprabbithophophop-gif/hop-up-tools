// 💎が上から降って画面の下に積もり、曲が進むとカメラが引いて山が動画の背景になるキャンバス。
//
// 描く場所のルール（YouTube API 規約）: 動画プレイヤーの上には何も描かない。
// このキャンバスは動画の裏（z-index 下）に置き、光の類は描画時に動画の矩形をクリップで除外する。
// 💎そのものは動画の裏を通る（隠れる）だけで、動画の上には出ない。
//
// 表示の方式は2つあり、setMode で選ぶ（既定は "pile"＝今までの山）。
//   pile        … 💎が上から降って画面の下に積もる。カメラが引いて山が動画の背景になる。
//   mirrorball  … 曲の歌詞のミラーボール。💎は積もらず動画の中心へ吸い込まれ、動画の裏で球の表面に貼られた
//                  色の付いた平らな丸い鏡になる。鏡は面が1枚で、球が回って向きの合った鏡が白く光る。
//                  本物のミラーボールと同じで、球の大きさも席の数も変わらない。曲が進むにつれてカメラが寄っていき、
//                  はじめは動画の裏にすっぽり隠れている球が、途中から上下に覗き、終わりには画面からはみ出して回る。
//                  席が全部埋まった後に押された分は、同じ色の鏡のうちいちばん古いものに貼り替わる。
//                  壁（動画と額縁の外の画面全体）に映る色の粒は、球の向こう側＝奥の面が返した光なので、
//                  こちらを向いている手前の鏡とは逆向きに流れる。
//                  曲の最後は、その粒がその場で星になり、球の鏡も夜空へ散って星空になる。
//                  この方式ではカメラの引き寄り・山の帳簿・焼き込みの絵は使わない。
//
// 世界座標: カメラ倍率1のときの画面座標と同じ。y は画面上端=0 で下へ正。
// カメラの軸は「床（画面の下端）」。引くほど山は画面の下に縮んで留まり、動画（固定）の下に収まる。
// 動画の中心を軸にすると、引くほど山の頂上が動画の中心に寄ってしまい、山を動画の下に留められない。
//
// 中身は canvas/ の5つの部品に分けてある。ここに残っているのは React の器・外向きの窓口・
// 毎コマの描画の順番・額縁・盛り上がりの帯との受け渡しだけ。
//   canvas/flight.ts … 押された💎が席へ飛んでいく間のこと
//   canvas/ball.ts   … ミラーボールの球（席の格子・席の取り合い・鏡）
//   canvas/wall.ts   … 壁に映る光の粒
//   canvas/sky.ts    … 夜空へ放つ演出と星空
//   canvas/pile.ts   … 💎が降って積もる山
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
// 💎の絵はここから受け取る。落ちてくる💎と積もった💎は、屈折・全反射・分散まで計算した本物（gemRenderer.ts）。
// まだ焼けていない色と、WebGL が使えない端末では、今までの平らな面の絵（gemFacets.ts）が返る。
// gemFacets.ts に面の形のデータを1本化した。入口の大きな💎は今までのまま。
// ミラーボールの席に着いた💎は、立体ではなく色の付いた平らな丸い鏡になる
import { hexToRgb } from "./gemFacets";
import { requestStoneSpritesByHex, warmUpGemRenderer, SPRITE_LIGHT, TUMBLE_PATHS } from "./gemSprites";
import { DIAMOND_COLOR_ORDER, findDiamondMember } from "./members";
import {
  type Ball, BALL_R, BALL_SPIN_SEC, BALL_TILE_FILL, BALL_TILE_MIN, BALL_TILT, BALL_ZOOM_EASE,
  ballZoomFor, clearBall, createBall, createBallView, drawMirrors, drawSelfRipple, getBallLattice,
  forgetLastSelfSeat, releaseSeat,
} from "./canvas/ball";
import { type Suck, drawSucks, landSucks, spawnSuck } from "./canvas/flight";
import {
  type Gem, COUNT_REF, FALL_SPEED_MIN, FALL_SPEED_RANGE, FINALE_END_SCALE, FINALE_TIME, FLOOR_DEPTH,
  MAX_DPR, MIN_SCALE, PILE_MAX_ON_SCREEN, SHRINK_MIN, SHRINK_REF, SIZE_MIN, SIZE_RANGE, SPIN_MIN, SPIN_RANGE,
  allocSlot, createPileState, drawPile, resizePile, stepFall,
} from "./canvas/pile";
import {
  type SkyFly, type SkyStar, SKY_FLASH_SIZE, STAR_MIN, STAR_RANGE,
  addStar as skyAddStar, bakeAndDrawSky, createSkyState, drawFlies, launchBallToSky, launchPileToSky,
  promoteFlies, sparkSky, spawnFlyToSky,
} from "./canvas/sky";
import {
  beginWallFrame, createWallState, drawWallFade, drawWallSpots, promoteWallFade,
  takeBackSeat, takeFreshLandings, wallToFade,
} from "./canvas/wall";

export type DiamondCanvasApi = {
  /** その色の💎を1つ、画面の上から降らせる。速さ・回転の向きと速さは1つずつ違う。
   *  self=true は自分の💎: 画面内の上寄りに出て、出た瞬間にピカッと光る（押した手応え）。
   *  origin は押した💎のボタンの中心。画面座標で渡す。自分の分はそのすぐ上から飛び立つ。
   *  key は誰の💎かを表すメンバーID。同じ色でも人が違えば額縁の順位・輝いた瞬間は別々に数える
   *  （杉山・山﨑は同じ #e70033 だが別人・Hop指摘 2026-09-14）。省略時は色の rgb をそのまま鍵にする（今まで通り） */
  spawn: (color: string, self?: boolean, origin?: { x: number; y: number }, key?: string) => void;
  /** 動画の現在時刻と総尺（秒）。カメラの引き・寄りに使う */
  setTime: (t: number, duration: number) => void;
  /** 山・降っている💎・カメラをすべて最初の状態に戻す（「最初に戻る」→ もう一度はじめる時） */
  reset: () => void;
  /** 曲全体の総数（メンバーID → 個数）。額縁の順位を「その色の普段の量と比べた倍率」で決めるための基準。
   *  同じ色を複数人が使っていても、人ごとに別々の基準になる */
  setColorTotals: (totals: Record<string, number>) => void;
  /** 直前に spawn した自分の💎を取り消す（触れた瞬間に降らせたが、指が滑ってスワイプだった時）。まだ落ちている途中のものだけ消す */
  undoLastSpawn: () => void;
  /** いま自分が選んでいる色。getPeakTime を引数なしで呼んだ時の既定になる（色を替えるたびに呼ぶ）。
   *  key はそのメンバーID。省略時は色の rgb をそのまま鍵にする（今まで通り） */
  setOwnColor: (hex: string, key?: string) => void;
  /** そのメンバー（key）の倍率が曲中で最大だった動画時刻（秒）。まだ無ければ null。
   *  記録は人ごとに全部覚えているので、key を渡せば選んでいない人の瞬間も引ける。省略時はいま自分が選んでいる人 */
  getPeakTime: (key?: string) => number | null;
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

const FRAME_BASE: [number, number, number] = [0x1a, 0x1d, 0x24]; // 額縁の地色
const TINT_WINDOW_MS = 2500;   // 「その瞬間いちばん多い色」を数える直近の幅【仮】
const TINT_STRENGTH = 0.45;    // 額縁の地色にその色をどれだけ混ぜるか（0=地色のまま、1=その色そのもの）【仮】
const TINT_SLOTS = 4;          // 額縁に並べる色の数（4声コーラスに合わせて上位4色・Hop決定 2026-09-07）
const TINT_BASE_TOTAL = 200;   // 順位を「直近の数 ÷ その色の曲全体の総数」で決める時に、総数に履かせる下駄。
                               // 参加者がごく少ない色が1回押されただけで跳ね上がるのを抑える【仮】（Hop決定 2026-09-07: 人数の偏りをそのまま出さない）

const DiamondCanvas = forwardRef<DiamondCanvasApi, Props>(function DiamondCanvas({ videoBoxRef, frame, reduceMotion = false }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** 押した瞬間の閃光（世界座標）。短時間で消える */
  const flashesRef = useRef<{ x: number; y: number; t0: number; rgb: [number, number, number]; size: number }[]>([]);
  /** 直近に降った💎の控え。その瞬間いちばん多い色で額縁を染めるのに使う（名前も数字も出さない・Hop決定 2026-09-07）。
   *  key はメンバーID（無ければ色の rgb）。同じ色を複数人が使っていても人ごとに別々に数える
   *  （杉山・山﨑は同じ #e70033 だが別人・Hop指摘 2026-09-14） */
  const recentRef = useRef<{ t: number; key: string; rgb: [number, number, number] }[]>([]);
  /** 曲全体の総数（メンバーID → 個数）。額縁の順位の基準。読み込み前は空＝全員同じ基準。
   *  同じ色の人が複数いても人ごとに別々（杉山・山﨑は同じ #e70033 だが別人・Hop指摘 2026-09-14） */
  const colorTotalsRef = useRef<Map<string, number>>(new Map());
  /** いま自分が選んでいる人（メンバーID、無ければ色の rgb）。getPeakTime の既定の引き先 */
  const ownKeyRef = useRef<string | null>(null);
  /** 人ごとの「一番輝いた瞬間」。key（メンバーID）→ その人の倍率が最大だった時刻と、その時の倍率。
   *  自分の分だけでなく全員ぶん覚える＝ハイライト再生中に色を切り替えても、その人の瞬間へ飛べる */
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
    // 色を焼く順番はページ側（HaiToDiamondPage）が決めて頼む。ここで全色を頼むと、
    // 器の側の方が先に動くので、ページ側が決めた順番より先に並んでしまう（2026-09-14）
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
  const getBall = (): Ball => (ballRef.current ??= createBall());
  const sizeRef = useRef({ W: 0, H: 0 });
  /** 動画本体の矩形（キャンバスの中の画面座標）。毎フレーム測った値をここに控えて、
   *  押した時（描く処理の外）にも「動画がいまどこにあるか」を見られるようにする。w=0 はまだ一度も測っていない */
  const videoRectRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const camRef = useRef({ scale: 1, cx: 0, cy: 0, oy: 0 });

  useImperativeHandle(ref, () => ({
    spawn(color: string, self = false, origin?: { x: number; y: number }, key?: string) {
      const { W, H } = sizeRef.current;
      const { scale, cx, oy } = camRef.current;
      if (!W) return;
      spawnedRef.current += 1;
      const rgb = hexToRgb(color);
      recentRef.current.push({ t: performance.now(), key: key ?? rgb.join(","), rgb });
      // 放った後は山に積もらない。自分の分は色の帯の少し上から、他の人の分は画面の下端から出て、
      // そのまま夜空の行き先へ飛んで星になる（曲の終わりの拍手代わりの押しが「星が増える」になる）
      if (launchedRef.current) {
        const now = performance.now();
        const at = spawnFlyToSky(flyRef.current, now, W, H, self, rgb);
        // 押した手応えの閃光は今までどおり出す（画面座標）
        if (self) skyFlashesRef.current.push({ x: at.x0, y: at.y0, t0: now, rgb, size: SKY_FLASH_SIZE });
        return;
      }
      // ミラーボール方式: 積もらせず、動画の中心へ吸い込む
      if (modeRef.current === "mirrorball") {
        const now = performance.now();
        const at = spawnSuck(
          suckRef.current, getBall(), rgb, self, origin,
          W, H, videoRectRef.current, now, spawnedRef.current, reduceMotionRef.current,
        );
        // 押した手応えの閃光は今までどおり（画面座標なので夜空の分と同じ入れ物に入れる）
        if (self) skyFlashesRef.current.push({ x: at.x0, y: at.y0, t0: now, rgb, size: SKY_FLASH_SIZE });
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
        // 鏡をもう置いた分（溶け込みの途中）は取り消さない。席を返すと置いた鏡と食い違う
        if (last.landed) return;
        suck.pop();
        // 取っておいた席も返す。空席を取っていたなら空席へ戻し、
        // 貼り替えを取っていたなら元の色と並び順へ戻す（貼り替えは起きなかったことになる）
        releaseSeat(getBall(), last.seat, last.seatWasEmpty, last.seatPrevRgb, last.seatPrevAge, last.seatCounted);
        // 守る環へ入れた分も取り消す（直前に入れたものだけ）
        forgetLastSelfSeat(getBall(), last.seat);
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
    setOwnColor(hex: string, key?: string) {
      ownKeyRef.current = key ?? hexToRgb(hex).join(",");
      // 自分の色は真っ先に降るので、焼くよう頼んでおく。頼むだけで、焼くのはこの呼び出しが終わったあと。
      // 「はじめる」の中から呼ばれても、動画の再生を止めない（重い処理をこの場で走らせない）
      requestStoneSpritesByHex(hex, true);
    },
    getPeakTime(key?: string) {
      const k = key ?? ownKeyRef.current;
      if (!k) return null;
      return peakRef.current.get(k)?.t ?? null;
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
      for (const [id, n] of Object.entries(totals)) m.set(id, n);
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
    // 部品ごとの控え。毎コマ作り直さず、中身だけ書き換える
    const pile = createPileState();
    const skySt = createSkyState();
    const wallSt = createWallState();
    const ballView = createBallView();
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const prevW = W, prevH = H;
      dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      sizeRef.current = { W, H };
      resizePile(pile, W, H);
      // 星と飛んでいる粒は画面座標なので、画面の大きさが変わったら比率で合わせ直し、星空の絵を焼き直す。
      // iPhone は再生中にもアドレスバーの出入りで高さが変わる
      if (prevW > 0 && prevH > 0 && (W !== prevW || H !== prevH)) {
        const kx = W / prevW, ky = H / prevH;
        for (const s of starsRef.current) { s.x *= kx; s.y *= ky; }
        for (const f2 of flyRef.current) { f2.x0 *= kx; f2.x1 *= kx; f2.y0 *= ky; f2.y1 *= ky; }
        for (const s2 of suckRef.current) { s2.x0 *= kx; s2.y0 *= ky; }
        for (const wf of wallSt.fade) { wf.x *= kx; wf.y *= ky; }
        skySt.canvas = null;
        skySt.baked = 0;
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    clearWorldRef.current = () => {
      pile.cols.fill(0);
      wallSt.buf.n = 0;    // 壁に映っていた粒も消す
      wallSt.fade.length = 0;
      pile.bake = null;    // 焼き込みの絵は捨てて、次に必要になった時に作り直す
      skySt.canvas = null;
      skySt.baked = 0;
    };
    const addStar = (x: number, y: number, rgb: [number, number, number], d?: number) =>
      skyAddStar(starsRef.current, starsByColorRef.current, x, y, rgb, d);
    // 奥側の鏡から壁の粒を拾う手（鏡を描く輪から呼ばれる）。毎コマ作り直さず、一度だけ作って使い回す
    const onBackSeat = (slot: number, x1: number, y2: number, z2: number, tileU: number) =>
      takeBackSeat(wallSt, getBall(), slot, x1, y2, z2, tileU);
    launchRef.current = () => {
      if (launchedRef.current || !W) return;
      launchedRef.current = true;
      const { scale, cx, oy } = camRef.current;
      const now = performance.now();
      // ミラーボール方式: 球の表面の鏡が、そのまま夜空へ散る。出発点はいま画面に見えている位置
      if (modeRef.current === "mirrorball") {
        const ball = getBall();
        const lv = getBallLattice();
        const bR = BALL_R * ball.zoom;   // いま見えている球の半径（固定の大きさ × カメラの寄り）
        const spin = reduceMotionRef.current ? 0 : (now / 1000) * (Math.PI * 2 / BALL_SPIN_SEC);
        const cs = Math.cos(spin), sn = Math.sin(spin);
        const ct = Math.cos(BALL_TILT), st = Math.sin(BALL_TILT);
        const bcy = camRef.current.cy;
        // 壁に映っていた粒は、飛ばずにその場で星になる（位置も色もそのまま引き継ぐ）。
        // 「壁の光が結晶になったもの」として星空につながる
        wallToFade(wallSt, now, STAR_MIN, STAR_RANGE);
        const spots = wallSt.buf.n;
        wallSt.buf.n = 0;
        launchBallToSky(ball, lv.a, flyRef.current, now, W, H, cx, bcy, bR, cs, sn, ct, st, spots);
        // 球をほどく（表面の鏡・吸い込まれ中の💎・閃光を空にする）
        clearBall(ball);
        suckRef.current = [];
        skyFlashesRef.current = [];
        return;
      }
      launchPileToSky(sparkPointsRef.current, gemsRef.current, flyRef.current, now, W, H, scale, cx, oy, pile.floorY);
      // 山を空にする（1つずつ描いている💎・位置の控え・積もり高さの帳簿・焼き込みの絵）。
      // 帳簿を空にするので、以後は着地先の割り当ても走らない
      gemsRef.current = [];
      sparkPointsRef.current = [];
      flashesRef.current = [];   // 山の閃光は行き場が無くなるので一緒に捨てる（放つ光に紛れて見えない）
      pileTopRef.current = Infinity;
      pile.cols.fill(0);
      pile.bake = null;
    };

    slotRef.current = (x: number, size: number, scale: number, self: boolean) =>
      allocSlot(pile, x, size, scale, self, W, camRef.current.cx);

    // 閃光（画面座標）。光の類なので動画の矩形は除外して描く。
    // 夜空へ放った後とミラーボール方式の両方で使う（山の閃光は世界座標なので別）
    const drawScreenFlashes = (v: { x: number; y: number; w: number; h: number }, now: number) => {
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
      const floorY = pile.floorY;
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
      const cols = pile.cols;
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
      const gems = gemsRef.current;
      stepFall(gems, dt, reduceMotionRef.current, sparkPointsRef.current);

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

      // 夜空へ放った後（画面座標のまま描く。カメラの外なので世界座標の計算は要らない）。
      // 星空は1枚の絵にして貼るだけ、1つずつ描くのは飛んでいる途中の粒だけ＝放つ2秒を過ぎたら山より軽い
      if (launchedRef.current) {
        const stars = starsRef.current;
        const fly = flyRef.current;
        // 飛び終わった粒を星にする（先に済ませて、この後の焼き込みに間に合わせる＝1コマ消える瞬間を作らない）
        promoteFlies(fly, stars, starsByColorRef.current, now);
        // 壁の粒から縮みきった分も、同じ理由でここで星にする（大きさは縮み始めに決めてある）
        promoteWallFade(wallSt, now, addStar);
        bakeAndDrawSky(ctx, skySt, stars, W, H, dpr);
        drawWallFade(ctx, wallSt, now, W, H, f);
        drawFlies(ctx, fly, now);
        if (!reduceMotionRef.current) {
          sparkSky(stars, starsByColorRef.current, skyFlashesRef.current, now, dt, W, H, v,
            holdCameraRef.current, ownKeyRef.current);
        }
        drawScreenFlashes(v, now);
        return;
      }

      // ミラーボール方式（画面座標のまま描く。カメラの引き寄りを使わないので世界座標の計算は要らない）。
      // 山の帳簿・焼き込みの絵は使わず、球の表面の鏡・壁に映る光の粒・吸い込まれ中の💎だけを描く
      if (modeRef.current === "mirrorball") {
        const ball = getBall();
        const lightAng = reduceMotionRef.current ? SPRITE_LIGHT : (now / 1000) * 0.35;
        const suck = suckRef.current;
        // 1. 飛び終わった💎を球の表面へ貼る
        const lv = getBallLattice();
        landSucks(suck, ball, now);
        // 見に行くのは「取ってある席」の全部。着いた席だけに絞ると、
        // 取った順と着く順がずれた鏡（＝先に押した💎がまだ飛んでいる間に着いた鏡）が
        // しばらく描かれず、後から急に現れてしまう。まだ着いていない席は絵が無いので飛ばされる
        const filled = ball.occ.length;
        // 球そのものの大きさは変わらない。変わるのはカメラの寄り具合＝見かけの大きさだけ。
        // 曲が進むほど寄って、動画の裏から上下にはみ出してくる。
        // ハイライト再生中と、夜空へ放った後は寄りを止める（時刻が飛んでも拡大率が跳ねない）。
        // 目当ての拡大率へは数フレームかけて寄せる＝時刻が飛んだ時も一足飛びにならない
        if (!holdCameraRef.current && !launchedRef.current) {
          ball.zoom += (ballZoomFor(p) - ball.zoom) * Math.min(1, dt * BALL_ZOOM_EASE);
        }
        const r = BALL_R * ball.zoom;
        // 球の向き（回転と傾き）と鏡の大きさ。鏡を描く所だけでなく、飛んでいる💎が
        // 「自分の席がいま画面のどこにあるか」を知るのにも要るので、鏡が1枚も無い時でも先に出しておく
        const spin = reduceMotionRef.current ? 0 : (now / 1000) * (Math.PI * 2 / BALL_SPIN_SEC);
        // 鏡の大きさは、見かけの半径と席の間隔から決める。高さは段の間隔（格子で1つ）、
        // 横幅は隣の席との間隔（席ごとに違う。極に近い段ほど細い）。カメラが寄るほど鏡も大きく見える
        const tileK = r * BALL_TILE_FILL;
        // 光の向き。鏡の向きが光を返す向きに近いほど明るくする
        const lz = 0.8;
        const ln = Math.hypot(Math.cos(lightAng), Math.sin(lightAng), lz);
        ballView.cx = cx; ballView.cy = cy; ballView.r = r;
        ballView.cs = Math.cos(spin); ballView.sn = Math.sin(spin);
        ballView.ct = Math.cos(BALL_TILT); ballView.st = Math.sin(BALL_TILT);
        ballView.tileK = tileK;
        ballView.tileV = Math.max(BALL_TILE_MIN, tileK * lv.v);
        ballView.Lx = Math.cos(lightAng) / ln; ballView.Ly = Math.sin(lightAng) / ln; ballView.Lz = lz / ln;
        ballView.lat = lv.a;          // 席1つにつき4つ（向き x,y,z と 横の間隔）
        ballView.filled = filled;
        ballView.flash = !reduceMotionRef.current;

        const wallAlpha = beginWallFrame(wallSt, ballView, p, W, H, reduceMotionRef.current);
        // 1.5 着地の返事（奥の席）
        takeFreshLandings(wallSt, ball, ballView, now);
        // 1.7 奥の席へ回る途中の💎。球より先に描く＝輪郭を越えたら球の後ろに隠れる
        drawSucks(ctx, suck, ball, ballView, v, now, dt, reduceMotionRef.current, "back");
        // 2. 球の表面（ついでに奥側の鏡から壁の粒を拾う）
        drawMirrors(ctx, ball, ballView, W, H, dpr, v, now, onBackSeat);
        drawSelfRipple(ctx, ball, ballView, dpr, now);
        // 3. 壁に映る光の粒
        drawWallSpots(ctx, wallSt, ballView, wallAlpha, p, W, H, f);
        // 4. 飛んでいる途中の💎（手前の席へ着く分と、動画の裏の席へ向かう分）
        drawSucks(ctx, suck, ball, ballView, v, now, dt, reduceMotionRef.current, "front");
        // 5. 押した手応えの閃光
        drawScreenFlashes(v, now);
        return;
      }

      drawPile(ctx, pile, gems, sparkPointsRef.current, flashesRef.current,
        W, H, dpr, v, cx, scale, oy, p, dt, now, reduceMotionRef.current);
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
