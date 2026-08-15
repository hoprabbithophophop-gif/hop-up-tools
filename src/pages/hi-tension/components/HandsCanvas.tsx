import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
// PixiJS は内部で `new Function(...)` を使うため、CSP の script-src に unsafe-eval が
// 含まれない環境(Cloudflare Pages のデフォルト)では起動できない。
// `pixi.js/unsafe-eval` を side-effect import すると eval を使わない別実装に切り替わる。
// import そのものに副作用があるので、pixi.js の他 import より前に置く。
import "pixi.js/unsafe-eval";
import { Application, Container, PerspectiveMesh, Sprite, Texture, Ticker } from "pixi.js";
import { getHandTexture, getHandOutlineTexture, getMarkTexture, getMarkOutlineTexture, seatFromHash } from "../handTexture";
import { findMember } from "../data";
import type { HiSession } from "../api";

export type HandsCanvasApi = {
  /**
   * color を渡すと、その色で跳ねる（selfMemberId からの色引きをスキップ）。
   * 未指定ならこれまでどおり selfMemberId から色を引く（挙動不変）。
   */
  spawnSelf: (color?: string) => void;
  onTimeUpdate: (currentTime: number) => void;
  receiveLiveTap: (memberId: string, seatIndex: number, videoTime: number, lagMs: number) => void;
};

interface Props {
  sessions: HiSession[];
  selfMemberId: string | null;
  selfSeatHash: number;
  /** リアルタイム再生中の自分の席番号（0始まり）。横一列の整列位置に使う。ソロ時は -1 */
  selfSeatIndex?: number;
  /** サイド席（左右スタンド）を出すか。PC（動画が小さく横が空く）でのみ true 想定。スマホは false。 */
  enableSides?: boolean;
  /** 横画面（アリーナ）レイアウト。動画を中央上(高さ60vh)に置く前提で、左右=縦長サイド席/
   *  下40vh=フラットなアリーナ席（傾斜なし＝全員同じ目線）にする。動画の裏には席を置かない。 */
  landscape?: boolean;
  /** 全✋の色を強制上書き（誕生日モード等）。未指定は各メンバーカラー。 */
  overrideColor?: string;
  /** ✋サイズ算出(crowdScale)に使う人数。客席を分離表示しても全体登録数で安定させる用。未指定=表示中の数。 */
  scaleCount?: number;
  /** ✋の経日減衰(ageScale)を無効化。スペシャル回の客席を「満員のまま」凍結表示する用。 */
  freezeAge?: boolean;
  /** 動き軽減：✋の跳ねる演出（squash→jump→fade）を止め、その場で出して静かに消す（軽量・酔い対策）。 */
  reduceMotion?: boolean;
  /** 診断用: Pixi/WebGL 関連イベントを親に通知（後で削除） */
  onPixiEvent?: (event: string, detail?: string) => void;
  /**
   * 湧かす絵。既定は "hand"（✋）＝ハイ！テンションのこれまでどおり。
   * "mark" にすると「！」になる（コール情報集約センター用）。
   * 変えるのは絵だけで、席の作りも跳ね方も一切変えない。
   */
  icon?: "hand" | "mark";
  /**
   * 上に空けておく余白(px)。既定は 80（＝ハイ！テンションのこれまでどおり）。
   * ここを跳躍量＋絵の高さより大きくすると、跳ねが上端で切れずに全部収まる。
   * 高さの低い面で使うときに指定する。
   */
  topMargin?: number;
  /**
   * 群衆✋の色を決める関数（省略時はこれまでどおり findMember＝ハイ！テンションの
   * BEYOOOOONDS名簿のみ。ここに findMember 以外の名簿（例: src/data/members.ts の
   * 全グループ）を渡すと、そちらで色を解決できる）。
   * 未指定のときだけ「名簿に無いIDは湧かさない」という従来の挙動を維持する。
   * 指定したときは、名簿に無いID（=undefined を返す）は白で湧かす（消さない）。
   */
  resolveColor?: (memberId: string) => string | undefined;
  /**
   * 自分の跳ねの頂点（一番高い瞬間）が、面の縦の真ん中に来るように着地点を逆算する。
   * 未指定（既定 false）ならこれまでどおり SELF_Y / SELF_Y_SOLO / 席ベースの位置を使う（挙動不変）。
   * 群衆（他の人の粒）の位置には影響しない。
   */
  centerSelfPeak?: boolean;
  /**
   * 左右に空けておく余白(px)。既定は 0（＝ハイ！テンションのこれまでどおり、xRatio=0〜1がそのまま画面幅）。
   * 0より大きいと、xRatio=0〜1 の範囲をこの余白ぶん内側（画面の中）に押し込めてから配置する。
   * 絵の表示幅の半分ぶんを指定すると、絵の中心が画面端に来ても本体が枠外にはみ出さない。
   */
  sideMargin?: number;
  /**
   * 下に空けておく余白(px)。既定は 0（＝ハイ！テンションのこれまでどおり）。topMargin の下版。
   * 着地帯の下端をこのぶん画面の内側へ引き上げる。0だと着地点が画面の最下端まで使われうる。
   */
  bottomMargin?: number;
  /**
   * 溜め（squash＝跳ぶ前に一瞬縮む予備動作）を省いて、タップした瞬間から上昇を始める。
   * 既定は false（＝ハイ！テンションのこれまでどおり、溜めてから跳ぶ）。
   * コール集約センターの！は「置けた」の即時確認が目的なので、溜めが遅延に見える。
   */
  skipSquash?: boolean;
}

// バケットインデックスに紐づく「(セッション, このバケットでの押下回数)」
type BucketEntry = { session: HiSession; count: number };

const BASE_SIZE = 84;
const SELF_SIZE = 84; // 自分は群衆より明確に大きく（埋もれ防止。白フチも併用）
// 自分=最前列の「あなた」。手前の客席(FRONT_SCALE=4.2)の半分は超える程度に。
// 大きすぎると視界を塞ぐので 4.2 の約6割で抑える（半分=2.1 以下だと小さすぎて違和感）。
const SELF_DEPTH = 2.5;
const NON_TODAY_ALPHA = 0.4;
// 跳躍してもキャンバス上端(プレイヤー直下)で✋が見切れないための上余白。
// 上端(動画直下)に確保する余白。小さくするほど✋の着地帯が上へ広がり、跳躍ピークが
// 動画の下あたりまで届く。タップ✋ボタンは z 上位(z3)で前面に残るので、帯が上がって
// ボタン裏に✋が来ても自然に重なる。最上段の跳躍ピークが一瞬上端で軽く切れる程度は許容。
const TOP_MARGIN = 80;

function hexToTint(hex: string): number {
  return parseInt(hex.replace(/^#/, ""), 16);
}

/**
 * 累計セッション数に応じた✋サイズの倍率。
 * 100セッションまでは 100%、そこから 1000セッションへ向けて線形に縮小、
 * 1000以降は 50% で固定。人が増えても画面密度をだいたい一定に保つ。
 */
function crowdScale(sessionCount: number): number {
  const t = Math.min(1, Math.max(0, (sessionCount - 100) / 900));
  return 1 - t * 0.5;
}

// 画面サイズに応じた✋の基準倍率。狭い/低い画面(iPhone SE 等)ほど小さくして窮屈さを解消する。
// w,h は再生エリア(動画下のキャンバス)の実ピクセル。基準(REF)より小さければ縮め、大きくても等倍で頭打ち。
// 縦・横どちらかが詰まっていれば小さい方に合わせる(min)。下限 0.6 で潰れすぎない。間引きはしない。
const REF_W = 412;
const REF_H = 560;
function viewportSizeK(w: number, h: number): number {
  return Math.min(1, Math.max(0.6, Math.min(w / REF_W, h / REF_H)));
}

/**
 * セッションの日付に応じた✋サイズの倍率（区間線形減衰）。
 * day0=100%, day1=80%, day7=50%, day30=20%, それ以降は20%固定。
 */
function ageScale(playedDate: string): number {
  const days = (Date.now() - new Date(playedDate).getTime()) / 86400000;
  if (days <= 0) return 1.0;
  if (days <= 1) return 1.0 - 0.2 * days;
  if (days <= 7) return 0.8 - (0.3 / 6) * (days - 1);
  if (days <= 30) return 0.5 - (0.3 / 23) * (days - 7);
  return 0.2;
}

// ✋の着地点を収める安全な縦帯（0=領域上端/TOP_MARGIN直下, 1=領域下端＝免責文字の下）。
// タップボタンは再生エリア上部にあり TOP_MARGIN で上側を保護済みなので、帯を下へ広げても
// ボタン裏には回り込まない。下端付近(免責文字の上)まで使って、小さい画面(iPhone SE 等)で
// ✋が一箇所に集中しないよう縦の散らばりを確保する。
// ※「中断して戻る」ボタンは z-order で✋履歴より下に置く（HiTensionPage 側）ので、下端まで
// 広げても✋がボタンの上に重なって自然。
const BAND_TOP = 0.08;
// 下端は再生エリアの最下部(免責文字のあたり)まで使う。免責文字は z 上位(z3)で前面に残るので
// ✋(z2)はその裏に回り、文字は読めたまま下端まで✋で埋まる。
const BAND_BOT = 1.0;

// 自分（と相手）の大きい✋の着地点。タップボタンは再生エリア上部にあるので、
// ここを下寄り(0.75)にして上昇アニメがボタンに重なって隠れないようにする。
// （履歴✋は小さいので帯の中＝多少ボタン寄りでも問題ない）
const SELF_Y = 0.75;
// ソロ時はxRatio中央＝タップボタン真下になるため、TOP_MARGIN短縮後はボタン裏に寄る。
// ボタンの下に抜けるよう更に下げて、自分✋(大＋白フチ)がちゃんと見えるようにする。
const SELF_Y_SOLO = 0.88;

/**
 * 参加順インデックスから✋の位置を決める（リアルタイムセッション用・上限2人）。
 * 左右に等間隔（1/3・2/3）。yは下寄り（上昇アニメがタップボタンの裏に隠れない）。
 */
function seatIndexToPosition(index: number): { xRatio: number; yRatio: number } {
  const col = index % 2;                 // 上限2人
  return {
    xRatio: (col + 1) / 3,               // 0→0.333, 1→0.667（左右等間隔）
    yRatio: SELF_Y,                       // 下寄り
  };
}

const LIVE_QUEUE_MAX = 100;
const LIVE_DISCARD_SEC = 3;
// 遅延した✋のアニメ先送り量の上限（ms）。上昇(最大120ms)+滞空(最大50ms)分までは飛ばし、
// それ以上ラグが大きくても「上昇アニメ」だけは必ず見せる(挙げた瞬間を残すため)。
const MAX_EXTRAPOLATION_MS = 170;

type QueuedLiveTap = { videoTime: number; memberId: string; seatIndex: number };

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

const HandsCanvas = forwardRef<HandsCanvasApi, Props>(function HandsCanvas(
  { sessions, selfMemberId, selfSeatHash, selfSeatIndex, enableSides = false, landscape = false, overrideColor, scaleCount, freezeAge = false, reduceMotion = false, onPixiEvent, icon = "hand", topMargin = TOP_MARGIN, resolveColor, centerSelfPeak = false, sideMargin = 0, bottomMargin = 0, skipSquash = false },
  ref,
) {
  // 絵の種類は起動時に1回だけ見る（途中で切り替える使い方はしない）
  const iconRef = useRef<"hand" | "mark">(icon);
  const skipSquashRef = useRef<boolean>(skipSquash);
  useEffect(() => { skipSquashRef.current = skipSquash; }, [skipSquash]);
  const topMarginRef = useRef<number>(topMargin);
  useEffect(() => { topMarginRef.current = topMargin; }, [topMargin]);
  const sideMarginRef = useRef<number>(sideMargin);
  useEffect(() => { sideMarginRef.current = sideMargin; }, [sideMargin]);
  const bottomMarginRef = useRef<number>(bottomMargin);
  useEffect(() => { bottomMarginRef.current = bottomMargin; }, [bottomMargin]);
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const textureRef = useRef<Texture | null>(null);
  const layerRef = useRef<Container | null>(null);
  // 自分の✋は「別のpixiキャンバス」に描く。DOM上でそのキャンバスを✋ボタン(z:3)より上(z:4)に
  // 重ねることで「自分✋ > ✋ボタン > 群衆✋」を満たす（1枚キャンバスだと自分と群衆が同一zで両立不可）。
  // 動きは群衆と同じ spawnHand をそのまま使う（CSS等で作り直さない）。
  const selfContainerRef = useRef<HTMLDivElement>(null);
  const selfAppRef = useRef<Application | null>(null);
  const lastBucketRef = useRef<number>(-1);
  const currentTimeRef = useRef<number>(0);
  const liveQueueRef = useRef<QueuedLiveTap[]>([]);
  const sessionsRef = useRef<HiSession[]>(sessions);
  const selfMemberIdRef = useRef<string | null>(selfMemberId);
  const selfSeatHashRef = useRef<number>(selfSeatHash);
  const selfSeatIndexRef = useRef<number | undefined>(selfSeatIndex);
  const onPixiEventRef = useRef<typeof onPixiEvent>(onPixiEvent);
  const overrideColorRef = useRef<string | undefined>(overrideColor);
  useEffect(() => { overrideColorRef.current = overrideColor; }, [overrideColor]);
  const resolveColorRef = useRef<((memberId: string) => string | undefined) | undefined>(resolveColor);
  useEffect(() => { resolveColorRef.current = resolveColor; }, [resolveColor]);
  const centerSelfPeakRef = useRef<boolean>(centerSelfPeak);
  useEffect(() => { centerSelfPeakRef.current = centerSelfPeak; }, [centerSelfPeak]);
  const freezeAgeRef = useRef<boolean>(freezeAge);
  useEffect(() => { freezeAgeRef.current = freezeAge; }, [freezeAge]);
  const reduceMotionRef = useRef<boolean>(reduceMotion);
  useEffect(() => { reduceMotionRef.current = reduceMotion; }, [reduceMotion]);
  const landscapeRef = useRef<boolean>(landscape);
  useEffect(() => { landscapeRef.current = landscape; }, [landscape]);
  const scaleCountRef = useRef<number | undefined>(scaleCount);
  useEffect(() => { scaleCountRef.current = scaleCount; }, [scaleCount]);
  useEffect(() => { onPixiEventRef.current = onPixiEvent; }, [onPixiEvent]);
  // WebGL コンテキストロスト時の再初期化トリガ（カウンタを増やすと init useEffect が再実行される）
  const [reinitCount, setReinitCount] = useState(0);

  // バケット → 該当セッションのインデックス(検索を O(1) にする)
  const bucketIndex = useMemo<Map<number, BucketEntry[]>>(() => {
    const map = new Map<number, BucketEntry[]>();
    for (const session of sessions) {
      // 0.05秒刻みの細かいバケットを優先(人間の叩くブレが同じマスに丸まって機械っぽく揃うのを防ぐ)。
      // 古いビューで列が無い場合は 0.1秒刻みを2倍して 0.05秒スケールに合わせる。
      const buckets = session.bucket_indices_20 ?? session.bucket_indices.map((b) => b * 2);
      // 重複あり(同じ 0.05秒に2回押せばダブる)
      const counts = new Map<number, number>();
      for (const b of buckets) {
        counts.set(b, (counts.get(b) ?? 0) + 1);
      }
      for (const [bucket, count] of counts) {
        const arr = map.get(bucket) ?? [];
        arr.push({ session, count });
        map.set(bucket, arr);
      }
    }
    return map;
  }, [sessions]);

  // セッション → ✋の配置（横アリ風・両サイドV字スタンド）。
  // 動画(=ステージ)を上に見立て、左右のスタンドが内側に傾いて中央を囲む配置にする。
  // 奥(上=ステージ際)ほど小さく(depthK)、手前(下)ほど大きく見せて疑似的な奥行きを出す。
  // 中央下はアリーナ席として少しだけ✋を置く。並び順は毎プレイ(selfSeatHash)で席替えし、
  // 色と位置を固定で結びつけない。同一プレイ中は安定なので再生中に✋がワープしない。
  // 安全帯 BAND_TOP〜BAND_BOT に収め、上部のタップボタン裏は中央を空けることで避ける。
  const sessionLayout = useMemo<Map<number, { xRatio: number; yRatio: number; depthK: number; rotation: number; jumpScale?: number }>>(() => {
    const n = sessions.length;
    const map = new Map<number, { xRatio: number; yRatio: number; depthK: number; rotation: number; jumpScale?: number }>();
    if (n === 0) return map;
    // selfSeatHash を種に session_hash を撹拌して並べ替える（毎プレイで席替え）。
    const seed = selfSeatHash >>> 0;
    const mix = (h: number) => {
      let x = (h ^ seed) >>> 0;
      x = Math.imul(x ^ (x >>> 16), 2246822507) >>> 0;
      x = Math.imul(x ^ (x >>> 13), 3266489909) >>> 0;
      return (x ^ (x >>> 16)) >>> 0;
    };
    // session_hash から決定的な擬似乱数 [0,1)（格子を少し崩すジッター用。毎プレイ変わる）。
    const rand01 = (h: number, salt: number) => {
      let x = (h ^ salt ^ seed) >>> 0;
      x = Math.imul(x ^ (x >>> 15), 2246822507) >>> 0;
      x = Math.imul(x ^ (x >>> 13), 3266489909) >>> 0;
      return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
    };
    const sorted = [...sessions].sort((a, b) => mix(a.session_hash) - mix(b.session_hash));
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

    // jumpScale: 跳ね量の倍率（80px に掛ける。未指定=1）。アリーナは動画裏に入らないよう抑える。
    type Slot = { xRatio: number; yRatio: number; depthK: number; rotation: number; spread: number; jumpScale?: number };
    // ★ スロット幾何は人数に依存しない固定配置（セッションが増えても席数・描画は一定＝軽い。
    //   ✋は「今そのバケットで叩いた人」だけ湧くので、人が増えれば自然に密になる）。
    //   同じスロットに複数人が乗っても、各自ハッシュで決まる固有オフセット(間隔spreadに比例)で
    //   散らすので、同座標スタックが起きず隙間も埋まる。
    const sideSlots: Slot[] = [];
    const centerSlots: Slot[] = [];
    let sideRatio: number;       // セッションのうちサイド席へ流す割合（残りはセンター/アリーナ）

    if (landscape) {
      // ── 横画面（アリーナ）── 実際の横アリ（センター席から見た図）に寄せる。動画＝中央上のステージ、
      //   その左右に客席スタンドが立ち上がり、手前下に平らなアリーナフロアが奥(ステージ)へ広がる。
      //   ✋は動画より背面なので、動画の矩形(中央上)に入る位置には置かない（裏に回って消えるのを防ぐ）。

      // ── サイド席（スタンド）── 動画(ステージ)の左右、外端を基準に密に詰めた三角スタンド。
      //   ✋同士の余白を消すピッチ(SIDE_DX=0.022≒手幅)で隙間なく敷き、上1列→下9列の t² カーブで
      //   急傾斜の三角。段ごとに半ピッチずらす千鳥で「縦一直線の整列」を崩す。
      //   外端(画面端)基準なので動画側へは最大でも x≈0.20 まで＝動画(左端≈0.25)の裏に入らない。
      //   手の傾き(SIDE_YAW)は変えない。
      const SIDE_YAW = 0.95;
      const SIDE_ROWS = 11;
      const SIDE_YTOP = 0.04, SIDE_YBOT = 0.57;  // 上端〜下端（動画の高さを覆う）
      const SIDE_X0 = 0.012, SIDE_DX = 0.022;    // 外端起点・密ピッチ（余白を残さない）
      for (let i = 0; i < SIDE_ROWS; i++) {
        const t = i / (SIDE_ROWS - 1);                 // 0=上(奥/ステージ際) .. 1=下(手前/フロア際)
        const yy = SIDE_YTOP + (SIDE_YBOT - SIDE_YTOP) * t;
        const depthK = 0.5 + 0.42 * t;                 // 下ほど大きい（手前）
        const cols = 2 + Math.round(7 * t * t);        // 上2列 →（下で加速）→ 下9列＝急傾斜の三角
        const brick = (i % 2) * SIDE_DX * 0.5;         // 段ごと半ピッチずらす千鳥＝縦の整列を崩す
        for (let j = 0; j < cols; j++) {
          const xx = SIDE_X0 + brick + j * SIDE_DX;    // 外端から内側へ密に詰める
          sideSlots.push({ xRatio: xx, yRatio: yy, depthK, rotation: -SIDE_YAW, spread: SIDE_DX });     // 左スタンド
          sideSlots.push({ xRatio: 1 - xx, yRatio: yy, depthK, rotation: SIDE_YAW, spread: SIDE_DX });  // 右スタンド
        }
      }

      // ── アリーナ(フロア)席 ── 下のフラットな面。手前=大きめ/奥=小さめのゆるい遠近で奥(動画側)へ広がる。
      //   フラット床なのでホールのような急な段差はない。跳ねを含めても動画(下端≈0.615)の裏に入らないよう、
      //   上端を下げ(A_YTOP)＋跳ね量を抑える(A_JUMP)。
      const projY = (z: number, zNear: number, zFar: number, yTop: number, yBot: number) =>
        yTop + (yBot - yTop) * ((1 / z - 1 / zFar) / (1 / zNear - 1 / zFar));
      const A_ZNEAR = 1.0, A_ZFAR = 2.2;   // 遠近の強さ。比2.2＝ゆるい（ホールは6.0で急）
      const A_FRONT = 1.5;                  // 手前の✋倍率（ホールは4.2で急。フラット床は控えめ）
      const A_YTOP = 0.77, A_YBOT = 1.0;    // 上端0.77＝跳ねても動画(0.615)の裏に入らない
      const A_JUMP = 0.55;                  // 跳ね量を55%に抑える（裏回り込み防止＋穏やかな床）
      const A_LATERAL = 0.085, A_ROWS = 11;
      for (let r = 0; r < A_ROWS; r++) {
        const t = r / (A_ROWS - 1);
        const z = A_ZNEAR + (A_ZFAR - A_ZNEAR) * t;
        const yy = projY(z, A_ZNEAR, A_ZFAR, A_YTOP, A_YBOT);
        const depthK = (A_ZNEAR / z) * A_FRONT;
        const pitch = A_LATERAL / z;                       // 手前ほど席間隔が広い
        const maxCols = Math.max(1, Math.floor(0.92 / pitch));
        const rowBrick = ((r % 2) ? 0.25 : -0.25) * pitch; // 段ごと±1/4ピッチの千鳥
        for (let cc = -maxCols; cc <= maxCols; cc++) {
          const xx = 0.5 + cc * pitch + rowBrick;
          if (xx < -0.05 || xx > 1.05) continue;
          centerSlots.push({ xRatio: xx, yRatio: yy, depthK, rotation: 0, spread: pitch, jumpScale: A_JUMP });
        }
      }
      sideRatio = 0.24;
    } else {
      // ── 縦（ホール）── 奥ほど高く小さい透視配置。サイド有り(PC)はセンターを HORIZON より下に。
      // サイド有り(PC)＝この線より上はサイド用に空ける。サイド無し(スマホ)＝センターを上まで詰めて全面化。
      const HORIZON = enableSides ? 0.32 : 0.06;
      // 最前列の着地点は画面下端(1.0)より下＝最大の✋は下半分が画面外（飛んでも視界を全部塞がない）。
      const CENTER_BOT = 1.35;
      // 1/z 補間で縦位置（手前=下=yBot、奥=上=yTop、手前ほど縦に広い）。
      const projY = (z: number, zNear: number, zFar: number, yTop: number, yBot: number) =>
        yTop + (yBot - yTop) * ((1 / z - 1 / zFar) / (1 / zNear - 1 / zFar));
      const Z_NEAR = 1.0, Z_FAR = 6.0;    // 視点からの距離。比が大きいほど遠近が強い（小さめ=奥を底上げ）
      const FRONT_SCALE = 4.2;            // 最前列の✋サイズ倍率（手前で視界が半分以上隠れる）

      // ── サイド席：左右上部の直角三角形スロット。ヨー＋左右ミラーで内向き ──
      const SIDE_SIZE = 0.6;        // 一定サイズ（遠いので差なし）
      const SIDE_ROWS = 6;          // 1+..+6 = 21席/側
      const SIDE_X0 = 0.012, SIDE_DX = 0.032; // 横（さらに詰める）
      const SIDE_Y0 = 0.05, SIDE_DY = 0.043;  // 縦（上部に収める）
      const SIDE_YAW = 0.95;        // z軸ヨー角(rad)
      for (let i = 0; i < SIDE_ROWS; i++) {
        const yy = SIDE_Y0 + i * SIDE_DY;
        for (let j = 0; j <= i; j++) {
          const xx = SIDE_X0 + j * SIDE_DX;
          sideSlots.push({ xRatio: xx, yRatio: yy, depthK: SIDE_SIZE, rotation: -SIDE_YAW, spread: SIDE_DX });     // 左席
          sideSlots.push({ xRatio: 1 - xx, yRatio: yy, depthK: SIDE_SIZE, rotation: SIDE_YAW, spread: SIDE_DX });  // 右席
        }
      }

      // ── センター席：前は席少・奥は席多の透視スロット（HORIZONより下、固定）──
      const LATERAL = 0.18, ROWS = 22;               // 列を詰め段数を増やして間を詰める
      for (let r = 0; r < ROWS; r++) {
        const t = r / (ROWS - 1);
        const z = Z_NEAR + (Z_FAR - Z_NEAR) * t;
        const yRatio = projY(z, Z_NEAR, Z_FAR, HORIZON, CENTER_BOT);
        const depthK = (Z_NEAR / z) * FRONT_SCALE;
        const pitch = LATERAL / z;                     // 手前ほど席間隔が広い＝1段に入る人が少ない
        const maxCols = Math.max(0, Math.floor(0.80 / pitch)); // 下段の隅(ボタン付近)まで届かせる
        const rowBrick = ((r % 2) ? 0.25 : -0.25) * pitch; // 段ごと±1/4ピッチ＝左右対称の千鳥(片側の空白を防ぐ)
        for (let cc = -maxCols; cc <= maxCols; cc++) {
          const xRatio = 0.5 + cc * pitch + rowBrick;
          if (xRatio < -0.15 || xRatio > 1.15) continue; // 画面端で見切れる✋を残す（隅まで埋める）
          centerSlots.push({ xRatio, yRatio, depthK, rotation: 0, spread: pitch });
        }
      }
      sideRatio = (enableSides && sideSlots.length > 0) ? 0.10 : 0;
    }

    if (centerSlots.length === 0 && sideSlots.length === 0) return map;

    // 循環割り当て＋間隔比例ジッター（同一スロットに複数人乗っても座標が散って重ならない）。
    const assign = (arr: typeof sorted, slotArr: Slot[], salt: number) => {
      if (slotArr.length === 0) return;
      const ord = slotArr.map((_, idx) => idx).sort((a, b) => {
        const ha = (Math.imul(a + 1, 2654435761) ^ seed ^ salt) >>> 0;
        const hb = (Math.imul(b + 1, 2654435761) ^ seed ^ salt) >>> 0;
        return ha - hb;
      });
      arr.forEach((s, i) => {
        const slot = slotArr[ord[i % slotArr.length]];
        const jx = (rand01(s.session_hash, 0x11) - 0.5) * slot.spread * 0.5; // 間隔比例で散らす(千鳥は残す)
        const jy = (rand01(s.session_hash, 0x22) - 0.5) * 0.016;
        // 画面端の見切れ・下端のはみ出しを許すため 0〜1 に丸めない（緩い範囲で安全のみ確保）。
        map.set(s.session_hash, {
          xRatio: Math.max(-0.1, Math.min(1.1, slot.xRatio + jx)),
          yRatio: Math.max(-0.1, Math.min(1.5, slot.yRatio + jy)),
          depthK: slot.depthK,
          rotation: slot.rotation,
          jumpScale: slot.jumpScale,
        });
      });
    };
    // sideRatio ぶんをサイド席へ、残りをセンター/アリーナへ（縦PCは10%、横は34%、スマホ縦は0）。
    const sideCount = sideSlots.length > 0 ? Math.round(n * sideRatio) : 0;
    assign(sorted.slice(0, sideCount), sideSlots, 0x5e);
    assign(sorted.slice(sideCount), centerSlots, 0x0c);

    return map;
  }, [sessions, selfSeatHash, enableSides, landscape]);

  // 最新の props を ref に反映(imperative メソッドの中で参照する用)
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { selfMemberIdRef.current = selfMemberId; }, [selfMemberId]);
  useEffect(() => { selfSeatHashRef.current = selfSeatHash; }, [selfSeatHash]);
  useEffect(() => { selfSeatIndexRef.current = selfSeatIndex; }, [selfSeatIndex]);

  // 区間遷移時にlastBucketを初期化(別動画再生・再入場時)
  useEffect(() => {
    lastBucketRef.current = -1;
  }, [selfSeatHash]);

  useEffect(() => {
    let cancelled = false;
    let onContextLost: ((e: Event) => void) | null = null;
    let onContextRestored: (() => void) | null = null;
    let crowdCanvas: HTMLCanvasElement | null = null;
    let selfCanvas: HTMLCanvasElement | null = null;

    onPixiEventRef.current?.("pixi_init_start", reinitCount > 0 ? `reinit=${reinitCount}` : undefined);

    (async () => {
      const container = containerRef.current;
      const selfContainer = selfContainerRef.current;
      if (!container || !selfContainer) { onPixiEventRef.current?.("pixi_init_fail", "no container"); return; }

      const texture = iconRef.current === "mark" ? getMarkTexture() : getHandTexture();

      // 群衆用と自分用、2つの pixi を作る（自分用キャンバスは DOM で✋ボタンより上に重ねる）。
      const crowdApp = new Application();
      const selfApp = new Application();
      try {
        const opts = { backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 } as const;
        await crowdApp.init({ resizeTo: container, ...opts });
        await selfApp.init({ resizeTo: selfContainer, ...opts });
      } catch (e) {
        onPixiEventRef.current?.("pixi_init_fail", e instanceof Error ? e.message : String(e));
        return;
      }
      if (cancelled) {
        try { crowdApp.destroy(true, { children: true }); } catch { /* ignore */ }
        try { selfApp.destroy(true, { children: true }); } catch { /* ignore */ }
        return;
      }

      container.appendChild(crowdApp.canvas);
      selfContainer.appendChild(selfApp.canvas);
      const layer = new Container();
      crowdApp.stage.addChild(layer);

      appRef.current = crowdApp;
      selfAppRef.current = selfApp;
      textureRef.current = texture;
      layerRef.current = layer;
      crowdCanvas = crowdApp.canvas as HTMLCanvasElement;
      selfCanvas = selfApp.canvas as HTMLCanvasElement;

      // WebGL コンテキストロスト復旧（Android 等の GPU 圧迫時に発生しやすい）。両キャンバス共通。
      onContextLost = (e: Event) => {
        e.preventDefault(); // ブラウザにコンテキスト復元の機会を与える
        onPixiEventRef.current?.("webgl_context_lost");
      };
      onContextRestored = () => {
        onPixiEventRef.current?.("webgl_context_restored");
        // useEffect を再実行させて Pixi 全体を作り直す
        setReinitCount(c => c + 1);
      };
      crowdCanvas.addEventListener("webglcontextlost", onContextLost);
      crowdCanvas.addEventListener("webglcontextrestored", onContextRestored);
      selfCanvas.addEventListener("webglcontextlost", onContextLost);
      selfCanvas.addEventListener("webglcontextrestored", onContextRestored);

      const rendererType = (crowdApp.renderer as unknown as { type?: number }).type === 1 ? "webgl" : "unknown";
      onPixiEventRef.current?.("pixi_init_ok", `r=${rendererType}`);
    })();

    return () => {
      cancelled = true;
      if (crowdCanvas) {
        if (onContextLost) crowdCanvas.removeEventListener("webglcontextlost", onContextLost);
        if (onContextRestored) crowdCanvas.removeEventListener("webglcontextrestored", onContextRestored);
      }
      if (selfCanvas) {
        if (onContextLost) selfCanvas.removeEventListener("webglcontextlost", onContextLost);
        if (onContextRestored) selfCanvas.removeEventListener("webglcontextrestored", onContextRestored);
      }
      const ca = appRef.current;
      const sa = selfAppRef.current;
      appRef.current = null;
      selfAppRef.current = null;
      textureRef.current = null;
      layerRef.current = null;
      try { ca?.destroy(true, { children: true }); } catch { /* ignore */ }
      try { sa?.destroy(true, { children: true }); } catch { /* ignore */ }
    };
  }, [reinitCount]);

  function spawnHand(params: {
    xRatio: number;
    yRatio: number;
    color: string;
    isSelf: boolean;
    isToday: boolean;
    playedDate?: string;
    /** アニメをこの ms 分だけ先に進めてスポーンする（遅延した他人の✋の補正） */
    animationOffsetMs?: number;
    /** 客席の奥行きに応じた縮小倍率（奥=小さい）。未指定=1.0（リアルタイム/自分✋は等倍）。 */
    depthK?: number;
    /** ✋の傾き(rad)。サイド席を内向きに見せる用。未指定=0（正面）。 */
    rotation?: number;
    /** 跳ね量の倍率（80px に掛ける）。未指定=1。アリーナは動画裏に入らないよう抑える。 */
    jumpScale?: number;
  }) {
    const texture = textureRef.current;
    // 自分✋は自分用pixi(別キャンバス・✋ボタンより上)、群衆は群衆pixiに描く。
    const app = params.isSelf ? selfAppRef.current : appRef.current;
    const targetLayer = params.isSelf ? (selfAppRef.current?.stage ?? null) : layerRef.current;
    if (!app || !texture || !targetLayer) return;

    const w = app.screen.width;
    const h = app.screen.height;
    if (w === 0 || h === 0) return;

    // 画面サイズ × 累計セッション数 × 日付経過に応じて✋を縮小(自分も同率なので「自分は約20%大きい」は維持)
    const viewK = viewportSizeK(w, h);
    const crowdK = crowdScale(scaleCountRef.current ?? sessionsRef.current.length);
    const ageK = (freezeAgeRef.current || !params.playedDate) ? 1.0 : ageScale(params.playedDate);
    const depthK = params.depthK ?? 1.0;
    const targetSize = (params.isSelf ? SELF_SIZE : BASE_SIZE) * viewK * crowdK * ageK * depthK;
    const texMax = Math.max(texture.width, texture.height) || 1;
    const spriteScale = targetSize / texMax;
    const colorTint = hexToTint(params.color);
    const baseAlpha = params.isToday ? 1.0 : NON_TODAY_ALPHA;

    // node = 動かす対象。他人は単一スプライト。自分の✋だけは群衆に埋もれないよう白フチを付ける：
    // 事前に焼いた白フチ版テクスチャ(1枚)を背面に、色付き本体(1枚)を前面に置いた Container。
    // 実行時の重ね描き(オーバードロー)が背面1枚で済むので軽い。
    // 位置/スケール/αのアニメは node に対して共通で回す（自分は基準スケール1）。
    const yaw = params.rotation ?? 0;
    let node: Sprite | Container;
    if (params.isSelf) {
      const container = new Container();
      const outlineTex = iconRef.current === "mark" ? getMarkOutlineTexture() : getHandOutlineTexture();
      const outline = new Sprite(outlineTex.texture);
      outline.anchor.set(outlineTex.anchorX, outlineTex.anchorY); // 中身の手を本体とぴったり重ねる
      outline.scale.set(spriteScale);
      container.addChild(outline);
      const fg = new Sprite(texture);
      fg.anchor.set(0.5, 1.0);
      fg.scale.set(spriteScale);
      fg.tint = colorTint;
      container.addChild(fg);
      node = container;
    } else if (Math.abs(yaw) > 0.001) {
      // サイド席：板を縦軸(z軸)まわりに3D回転→透視投影した台形に✋テクスチャをマッピング。
      // 奥側(ステージ寄り)の辺が短く・手前の辺が長くなり「内を向く」。親指の大小も自然に出る。
      const dispW = texture.width * spriteScale;
      const dispH = texture.height * spriteScale;
      const D = dispW * 1.3;               // 透視距離（小さいほど台形が強い）
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      // ローカル四隅(中心基準)を投影し、手首(下端中央)を原点(0,0)に合わせる
      const proj = (px: number, py: number): [number, number] => {
        const s = D / (D + px * sn);
        return [-(px * cs * s), py * s - dispH / 2]; // x反転=左右ミラー（親指を反対側へ）
      };
      const [x0, y0] = proj(-dispW / 2, -dispH / 2); // 上左
      const [x1, y1] = proj(dispW / 2, -dispH / 2);  // 上右
      const [x2, y2] = proj(dispW / 2, dispH / 2);   // 下右
      const [x3, y3] = proj(-dispW / 2, dispH / 2);  // 下左
      const mesh = new PerspectiveMesh({
        texture, verticesX: 8, verticesY: 8,
        x0, y0, x1, y1, x2, y2, x3, y3,
      });
      mesh.tint = colorTint;
      node = mesh;
    } else {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 1.0); // 下端中央(着地地点を yRatio に固定)
      sprite.scale.set(spriteScale);
      sprite.tint = colorTint;
      node = sprite;
    }
    node.alpha = baseAlpha;

    // 上端に TOP_MARGIN 分、下端に bottomMargin 分の余白を確保した残り領域に着地点を配置する。
    // これで yRatio が小さい(=上寄りの)席でも、跳躍が上端で見切れない。bottomMargin は既定0＝従来どおり。
    const usableH = Math.max(1, h - topMarginRef.current - bottomMarginRef.current);
    const baselineY = topMarginRef.current + params.yRatio * usableH;
    // 左右に sideMargin 分の余白を確保した残り幅に配置する。既定0のときは xRatio×w と完全に同じ
    // （0 + xRatio×(w-0) = xRatio×w）＝ハイ！テンションの見た目は1pxも変わらない。
    const usableW = Math.max(1, w - 2 * sideMarginRef.current);
    node.x = sideMarginRef.current + params.xRatio * usableW;
    node.y = baselineY;

    targetLayer.addChild(node);

    // 溜め(squash) → 上昇 → 軽い滞空 → 下降しながらフェードアウト（二段ジャンプなし）。
    // タップした瞬間に一瞬グッと縮んでから勢いよく上がる「予備動作」で手応えを出し、
    // 最後は元の位置に落ちながら消えるので、連打しても上に積もって居座らない。
    // 値はすべて固定（揺らさない）。狙った1つの気持ちいいモーションを全✋で再現するため。
    const jumpHeight = 80 * (params.jumpScale ?? 1);        // 上昇量(px)。アリーナは抑えて動画裏に入れない
    const squashDur = 50;         // 溜め: scale を SQUASH_SCALE まで縮める時間
    const upDur = 220;            // 上昇: しっかり見せる
    const holdDur = 80;           // 滞空: 頂点で軽く粘る
    const downFadeDur = 180;      // 下降しながらフェードアウト
    const SQUASH_SCALE = 0.85;    // 溜め時の最小スケール倍率
    const baseScale = node.scale.x; // spawn 時に設定済みのスケールを基準にする（自分=1, 他人=spriteScale）

    // 動き軽減：跳ね・溜めを一切せず、その場に出して少し留めて静かに消すだけ。
    // 揺れる演出が無いぶん軽く（scale更新も無し）、酔い・感覚過敏にもやさしい。✋自体は出る＝密度は保つ。
    if (reduceMotionRef.current) {
      node.scale.set(baseScale);
      node.alpha = baseAlpha;
      const holdMs = 250;          // 出てから留まる時間
      const fadeMs = 200;          // 静かに消える時間
      let t = params.animationOffsetMs ?? 0;
      const onTickStatic = (ticker: Ticker) => {
        t += ticker.deltaMS;
        if (t > holdMs) {
          const k = Math.min(1, (t - holdMs) / fadeMs);
          node.alpha = baseAlpha * (1 - k);
          if (k >= 1) {
            app.ticker.remove(onTickStatic);
            try { node.destroy({ children: true }); } catch { /* ignore */ }
          }
        }
      };
      app.ticker.add(onTickStatic);
      return;
    }

    // skipSquash 指定時は溜めを飛ばして即上昇（！の即時確認用）。
    // up フェーズのスケール式は SQUASH_SCALE→1 の戻しなので、飛ばす場合は縮み幅0として扱う
    const squashFrom = skipSquashRef.current ? 1 : SQUASH_SCALE;
    let phase: "squash" | "up" | "hold" | "downfade" | "done" = skipSquashRef.current ? "up" : "squash";
    let phaseStart = 0;
    // 遅延した✋はアニメを先に進めた状態から開始（FPS式の予測）
    let totalMs = params.animationOffsetMs ?? 0;

    const onTick = (ticker: Ticker) => {
      totalMs += ticker.deltaMS;
      const local = totalMs - phaseStart;

      switch (phase) {
        case "squash": {
          if (local < squashDur) {
            // baseScale → baseScale*SQUASH_SCALE へ縮む（タップの溜め）
            const k = local / squashDur;
            node.scale.set(baseScale * (1 - (1 - SQUASH_SCALE) * k));
          } else {
            node.scale.set(baseScale * SQUASH_SCALE);
            phaseStart = totalMs;
            phase = "up";
          }
          break;
        }
        case "up": {
          if (local < upDur) {
            const k = easeOutCubic(local / upDur);
            node.y = baselineY - jumpHeight * k;
            // 縮んだスケールを上昇とともに通常へ戻す（伸び＝stretch感）。skipSquash時は縮んでいないので等倍のまま
            node.scale.set(baseScale * (squashFrom + (1 - squashFrom) * k));
          } else {
            node.y = baselineY - jumpHeight;
            node.scale.set(baseScale);
            phaseStart = totalMs;
            phase = "hold";
          }
          break;
        }
        case "hold": {
          if (local >= holdDur) {
            phaseStart = totalMs;
            phase = "downfade";
          }
          break;
        }
        case "downfade": {
          if (local < downFadeDur) {
            const k = local / downFadeDur;
            // 頂点(baselineY - jumpHeight)から元の baselineY へ落としつつ消す。
            // 落下は easeIn(k*k)で「重力で加速して落ちる」感、フェードは線形。
            node.y = baselineY - jumpHeight * (1 - k * k);
            node.alpha = baseAlpha * (1 - k);
          } else {
            phase = "done";
          }
          break;
        }
      }

      if (phase === "done") {
        app.ticker.remove(onTick);
        try { node.destroy({ children: true }); } catch { /* ignore */ }
      }
    };

    app.ticker.add(onTick);
  }

  /**
   * 群衆1人ぶんの色を決める。
   * resolveColor が指定されていなければ、これまでどおり findMember（ハイ！テンションの
   * BEYOOOOONDS名簿）を引き、見つからなければ undefined を返す（＝呼び出し側でスキップ＝挙動不変）。
   * resolveColor が指定されていれば、それで引く。見つからなくても undefined ではなく白を返す
   * （名簿に無いIDだからと粒ごと消えると、ハイ！テンションの名簿更新忘れ事故と同じことになるため）。
   */
  function memberColorOrSkip(memberId: string): string | undefined {
    if (resolveColorRef.current) return resolveColorRef.current(memberId) ?? "#ffffff";
    return findMember(memberId)?.color;
  }

  function spawnForBucket(bucket: number, animationOffsetMs: number) {
    const entries = bucketIndex.get(bucket);
    if (!entries) return;
    for (const { session, count } of entries) {
      const memberColor = memberColorOrSkip(session.member_id);
      if (!memberColor) continue;
      const pos = sessionLayout.get(session.session_hash) ?? { ...seatFromHash(session.session_hash), depthK: 1, rotation: 0 };
      for (let i = 0; i < count; i++) {
        spawnHand({
          xRatio: pos.xRatio, yRatio: pos.yRatio, depthK: pos.depthK, rotation: pos.rotation, jumpScale: pos.jumpScale,
          color: overrideColorRef.current ?? memberColor,
          isSelf: false,
          isToday: session.is_today,
          playedDate: session.played_date,
          animationOffsetMs,
        });
      }
    }
  }

  useImperativeHandle(ref, () => ({
    spawnSelf(color?: string) {
      // color 指定があればそちらを使う（呼び出し側が自分で色を決めるケース＝コール集約センターの
      // ！ごとの色替え）。未指定ならこれまでどおり selfMemberId から findMember で引く（挙動不変）。
      let resolvedColor = color;
      if (resolvedColor === undefined) {
        const memberId = selfMemberIdRef.current;
        if (!memberId) return;
        const member = findMember(memberId);
        if (!member) return;
        resolvedColor = member.color;
      }
      // リアルタイム時は席ベースの等間隔、ソロ時は中段。横ではハイ！ボタン(右下)の近くから挙げる。
      const seatIdx = selfSeatIndexRef.current;
      let { xRatio, yRatio } =
        seatIdx != null && seatIdx >= 0
          ? seatIndexToPosition(seatIdx)
          : landscapeRef.current
            ? { xRatio: 0.85, yRatio: 0.93 } // 横：右下のボタン付近（アリーナ手前列あたり）で跳ねる
            : { xRatio: 0.5, yRatio: SELF_Y_SOLO };

      // centerSelfPeak: 頂点(baselineY - jumpHeight)が面の縦の真ん中(h/2)に来るよう着地点を逆算する。
      // baselineY = topMargin + yRatio×(h-topMargin-bottomMargin) なので、
      // h/2 = baselineY - jumpHeight を yRatio について解く（spawnHand側の usableH と同じ式に揃える）。
      // self の spawnHand 呼び出しは jumpScale を渡さない＝jumpHeight は既定の80固定。
      if (centerSelfPeakRef.current) {
        const h = selfAppRef.current?.screen.height ?? 0;
        if (h > 0) {
          const usableH = Math.max(1, h - topMarginRef.current - bottomMarginRef.current);
          yRatio = (h / 2 + 80 - topMarginRef.current) / usableH;
        }
      }

      spawnHand({
        xRatio, yRatio,
        color: overrideColorRef.current ?? resolvedColor,
        isSelf: true,
        isToday: true,
        depthK: SELF_DEPTH,
      });
    },
    receiveLiveTap(memberId: string, seatIndex: number, videoTime: number, lagMs: number) {
      const now = currentTimeRef.current;
      // 実測ラグが大きいときだけ記録(効果検証用)。
      if (lagMs > 300) {
        onPixiEventRef.current?.("tap_recv_diff", `lag=${Math.round(lagMs)}ms`);
      }
      const ageSecs = now - videoTime;
      if (ageSecs > LIVE_DISCARD_SEC) return; // 古すぎ → 捨てる
      const member = findMember(memberId);
      if (!member) return;
      const spawn = (animationOffsetMs: number) => {
        const { xRatio, yRatio } = seatIndexToPosition(seatIndex);
        spawnHand({
          xRatio, yRatio,
          color: overrideColorRef.current ?? member.color,
          isSelf: false,
          isToday: true,
          playedDate: new Date().toISOString().slice(0, 10),
          animationOffsetMs,
        });
      };
      if (videoTime <= now) {
        // 既に過ぎたタップ = 遅れて届いた → 実測した片道ラグ分アニメを先送りして補正。
        // ラグ実測値が無い(0)場合は動画位置差で近似フォールバック。
        const offsetMs = lagMs > 0 ? lagMs : (now - videoTime) * 1000;
        spawn(Math.min(offsetMs, MAX_EXTRAPOLATION_MS));
      } else {
        const queue = liveQueueRef.current;
        queue.push({ videoTime, memberId, seatIndex });
        if (queue.length > LIVE_QUEUE_MAX) queue.splice(0, queue.length - LIVE_QUEUE_MAX);
      }
    },
    onTimeUpdate(currentTime: number) {
      currentTimeRef.current = currentTime;

      // live キューを走査してスポーン
      const queue = liveQueueRef.current;
      if (queue.length > 0) {
        const remaining: QueuedLiveTap[] = [];
        for (const tap of queue) {
          if (tap.videoTime <= currentTime) {
            const member = findMember(tap.memberId);
            if (member) {
              const { xRatio, yRatio } = seatIndexToPosition(tap.seatIndex);
              spawnHand({
                xRatio, yRatio,
                color: overrideColorRef.current ?? member.color,
                isSelf: false,
                isToday: true,
                playedDate: new Date().toISOString().slice(0, 10),
                animationOffsetMs: Math.min((currentTime - tap.videoTime) * 1000, MAX_EXTRAPOLATION_MS),
              });
            }
          } else {
            remaining.push(tap);
          }
        }
        liveQueueRef.current = remaining;
      }

      // 0.05秒刻みのバケット先頭で発火させる単純な floor。
      // poll 間に跨いだバケットは下の for で全て埋めるので取りこぼさない。
      const newBucket = Math.floor(currentTime * 20);
      const lastBucket = lastBucketRef.current;
      if (newBucket === lastBucket) return;
      lastBucketRef.current = newBucket;
      // 初回・大ジャンプ(シーク)時は湧き出しスキップ(60バケット=3秒以上飛んだら無効)
      if (lastBucket < 0 || newBucket < lastBucket || newBucket - lastBucket > 60) return;
      // poll は 100ms 間隔なので、1回で複数バケットがまとめて来る。全部を同フレームに
      // 湧かすと「壁」になって機械っぽく揃う。各バケットが「実際に何ms前だったか」だけ
      // アニメを先送りして湧かすと、早い✋は少し上がった状態・遅い✋は出たて、で
      // さざ波状にバラける（バケット内の本物のタイミング差をそのまま見せる）。
      for (let b = lastBucket + 1; b <= newBucket; b++) {
        const ageMs = (currentTime - b / 20) * 1000;
        spawnForBucket(b, Math.max(0, Math.min(ageMs, MAX_EXTRAPOLATION_MS)));
      }
    },
  }), [bucketIndex, sessionLayout]);

  return (
    <>
      {/* 群衆✋キャンバス（z:2）。✋ボタン(z:3)・自分✋(z:4)より下。 */}
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          // 上端を動画下に40px潜らせる（このキャンバスだけ。カウント数字/ボタンの位置は動かさない）。
          // 動画は前面(z:2)なので、最上段の✋がジャンプした先っぽだけ動画の裏に隠れる＝動画の延長感。
          top: -40,
          left: 0,
          right: 0,
          bottom: 0,
          pointerEvents: "none",
          overflow: "hidden",
          zIndex: 2, // 「中断して戻る」(z:1)より上＝✋履歴がボタンに被る。
        }}
      />
      {/* 自分✋専用キャンバス（z:4）＝✋ボタン(z:3)より上。pointerEvents:none でタップは透過。
          別pixiにすることで「自分✋ > ✋ボタン > 群衆✋ > 中断」を1枚キャンバスの制約なく満たす。
          再生エリア全体を覆う（潜り込みの -40 は不要＝自分✋の着地点 yRatio がそのまま対応）。 */}
      <div
        ref={selfContainerRef}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          overflow: "hidden",
          zIndex: 4,
        }}
      />
    </>
  );
});

export default HandsCanvas;
