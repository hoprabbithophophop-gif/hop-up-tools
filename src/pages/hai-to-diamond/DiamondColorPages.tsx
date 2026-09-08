// 画面下の色えらび、もう一つの並べ方「ユニットごとのページ」（Hop決定 2026-09-08。既定はこちら）。
//
// 一列の帯（DiamondColorCarousel.tsx）では、杉山さん（現役）と山﨑夢羽さん（卒業）の💎が
// 同じ赤で隣り合って見分けが付かない、という声への答え。14人を4つのページに分け、
// 1ページの中では全部の💎が同じ大きさで横に並ぶ。どれでも直接押せる（真ん中に呼び寄せる手間が無い）。
// ページの入れ替えは左右のスワイプ。4ページを端から端へ回り続ける。
//
// 置き方: 4つのページを「横一列の長い帯」として繋げて置き、画面の真ん中がその帯のどこを
// 映しているかを px の目盛り（カメラの位置）で持つ。ページとページのあいだは PAGE_SEP px だけ空ける。
// 帯は端と端が繋がった輪なので、位置はいつも近い方の回り方で出す＝端で先頭へ戻る時にも継ぎ目が出ない。
// 目盛りをページ数（1ページ＝1）で持たない理由: ページごとに💎の数が違う（4・4・3・3人）ので
// ページの横幅も違う。1ページ＝画面1枚ぶんで動かすと、💎の少ないページが隣に来た時に
// 画面の端まで届かず、覗かせたい💎が見えなくなる（Hop要望 2026-09-08「両端に隣の色が見切れていてほしい」）。
// 帯として繋げておけば、どのページが隣でも端の💎が必ず同じ間隔で覗く。
// ただし「覗く量」は揃わない。正面が4人のページなら隣は端が少しだけ（幅390の画面で23px）、
// 正面が3人のページなら隣の💎が丸ごと見える。ページの幅が違うぶん、真ん中に寄せた列の端から
// 画面の端までの余りが変わるため。3人のページだけ💎の間隔を広げれば揃うが、
// 人数の違うページでも間隔を変えない決め（GEM_GAP の説明）と噛み合わないので、揃えていない。
//
// 覗いている隣のページの💎は薄く・少し小さくして、いま選べる列と見分けられるようにする。
// 押しても色は変わらず💎も降らない＝そのページへ送るだけ。
//
// 指を追っている間は React に描き直しを頼まず、ページの要素の transform を直に書き換える
// （一列の帯と同じ理由。React を挟むと1コマぶんの組み直しが挟まって引っかかる）。
// iOS はページの操作を横取りする時に pointercancel を送ってくるので、指の状態は
// pointerup / pointercancel / lostpointercapture の3つで必ず片付ける。
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { faGem } from "@fortawesome/free-solid-svg-icons";
import FaIcon from "../hi-tension/components/FaIcon";
import {
  BAND_BG,
  BAND_BLUR,
  BAND_FADE,
  BAND_HEIGHT,
  BAND_PAD,
  DRAG_THRESHOLD,
  GEM_MASK,
  INVITE_PULSE_SECONDS,
  PRESS_SCALE,
  SHINE_STRIPES,
  type DiamondColorOption,
} from "./DiamondColorCarousel";

/** 1つの💎の大きさ(px)【仮】。ページの中では全部この大きさ（大小を付けない） */
const GEM_SIZE = 64;
/** 選択中の印（グレーの縁）の色と、💎より何倍大きく敷くか【仮】。
 *  縁は透過を高くする＝下に積もった💎の山が透けて見え、印だけが浮かない（Hop指示 2026-09-08） */
const SELECTED_RING_COLOR = "rgba(154,160,166,0.5)";
const SELECTED_RING_SCALE = 1.14;
/** 💎と💎のあいだの隙間(px)【仮】。人数の違うページでも💎の間隔を変えず、中央寄せで並べる */
const GEM_GAP = 24;
/** ページとページのあいだの隙間(px)【仮】。前のページの端の💎と、次のページの端の💎の間隔。
 *  ここを広げるほど隣の💎の覗く量が減る（幅390の画面では 31px から この値を引いたぶんが覗く） */
const PAGE_SEP = 8;
/** 覗いている隣のページの💎の薄さと大きさ【仮】。いま押せる列と見分けが付く程度に落とす */
const NEIGHBOR_OPACITY = 0.5;
const NEIGHBOR_SCALE = 0.92;
/** 覗きの濃さ・大きさが切り替わる時間(ms)【仮】。スワイプの途中で入れ替わる時にパッと変わらないように */
const NEIGHBOR_FADE_MS = 160;
/** 💎の列の中心を、帯の器の上端から何px下に置くか【仮】。下に点を置くぶん少し上寄せ */
const GEM_CENTER_Y = 40;
/** 切り落とす窓の元になる幅(px)【仮】。広い画面でも💎の列を画面いっぱいに広げないための蓋。
 *  ページ自体の幅は💎の数で決まる（4人なら328px）ので、この値が幅を縮めることはない */
const WINDOW_MAX_WIDTH = 420;
/** 広い画面で、上の幅の外側に隣のページを覗かせるぶんの余白(px)【仮】。
 *  切り落とす窓をこのぶん左右へ広げる＝ページの並べ方は変えずに両端へ隣が覗く */
const PEEK_OUTSIDE = 48;
/** いまどのページかを示す点の直径(px)【仮】と、点どうしの隙間(px)【仮】 */
const DOT_SIZE = 6;
const DOT_GAP = 6;
/** 点の列の上端を、帯の器の上端から何px下に置くか【仮】 */
const DOTS_TOP = 78;
/** 点の濃さ【仮】。選択中は白、他は薄く */
const DOT_ON = 0.95;
const DOT_OFF = 0.3;
/** 指を離してからページが吸い付くまでの時間(ms)【仮】 */
const SNAP_MS = 260;
/** 指の速さを測る窓(ms)【仮】。これより古い動きは勢いの計算に入れない */
const VELOCITY_WINDOW_MS = 100;
/** 指が止まってからこれ以上経って離した場合は勢い無し＝一番近いページへ吸い付くだけにする(ms)【仮】 */
const VELOCITY_STALE_MS = 100;
/** 指の速さから「この先どこまで滑るか」を見積もる時間(ms)【仮】 */
const GLIDE_PROJECTION_MS = 140;
/** 覗いている💎に付ける目印。薄く・小さくする指定をここへ当てる */
const NEIGHBOR_GEM_CLASS = "hai-to-diamond-page-gem";

interface Props {
  /** ページごとの色の並び。外側がページ、内側がそのページに並ぶ💎 */
  pages: readonly (readonly DiamondColorOption[])[];
  /** いま選ばれている色（メンバーID） */
  selectedId: string;
  /** 💎を押して色が変わった時に呼ぶ */
  onSelect: (id: string) => void;
  /** 💎を押した瞬間に呼ぶ。true を返したら押せたものとして扱う。
   *  渡さなければ「押しても💎は降らない」ページになる（曲のあとの見返し中） */
  onRecord?: (id: string) => boolean;
  /** 触れた瞬間に降らせた💎を取り消す。指が滑ってスワイプになった時に呼ぶ */
  onRecordCancel?: () => void;
  /** まだ一度も押されていない間、いまの色の💎に光沢を流して押すよう誘う */
  inviting?: boolean;
  /** 動き軽減：光沢と吸い付きの動きを止める */
  reduceMotion?: boolean;
  /** 一時停止中など、薄く見せて押しても💎を降らせないようにする（色えらびとページ送りはできたまま） */
  disabled?: boolean;
}

/** 輪の上での差 d(px) を「近い方の回り方」に直す。帯の長さ L で一周 */
function wrapRing(d: number, L: number): number {
  if (L <= 0) return 0;
  const x = ((d % L) + L) % L;
  return x > L / 2 ? x - L : x;
}

/** ページ番号を 0 以上 n 未満に収める */
function wrapIndex(v: number, n: number): number {
  return ((v % n) + n) % n;
}

const DiamondColorPages = memo(function DiamondColorPages({
  pages,
  selectedId,
  onSelect,
  onRecord,
  onRecordCancel,
  inviting = false,
  reduceMotion = false,
  disabled = false,
}: Props) {
  const n = pages.length;
  const containerRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  /** ページの要素の控え。並べ替えないので番号＝ページの番号 */
  const pageElsRef = useRef<(HTMLDivElement | null)[]>([]);
  /** いまどのページかを示す点の控え */
  const dotElsRef = useRef<(HTMLSpanElement | null)[]>([]);
  /** 押した手応え（縮み）を書き込むための、💎の要素の控え。「ページ番号:💎番号」で引く */
  const gemElsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  /** 前回書き込んだ見た目。同じ値なら書き込まない */
  const paintedRef = useRef<{ t: string; v: string; f: string }[]>([]);
  /** 切り落とす窓の幅(px)。ここからはみ出したページは見えない */
  const clipWidthRef = useRef(0);

  /** ページごとの💎の列の幅(px)。人数が違うのでページごとに違う */
  const contentWidths = useMemo(
    () => pages.map((p) => (p.length > 0 ? p.length * GEM_SIZE + (p.length - 1) * GEM_GAP : 0)),
    [pages],
  );
  /** 各ページの中心が、繋げた帯の上のどこにあるか(px)と、帯を一周した長さ(px) */
  const { centers, ringLength } = useMemo(() => {
    const c: number[] = [];
    let acc = 0;
    for (let i = 0; i < contentWidths.length; i++) {
      c.push(acc + contentWidths[i] / 2);
      acc += contentWidths[i] + PAGE_SEP;
    }
    return { centers: c, ringLength: acc };
  }, [contentWidths]);

  /** 画面の真ん中が、帯のどこを映しているか(px)。これがページ送りの目盛り */
  const pageOfSelected = Math.max(0, pages.findIndex((p) => p.some((o) => o.id === selectedId)));
  const xRef = useRef(centers[pageOfSelected] ?? 0);
  /** 吸い付きの行き先のページ番号。外との突き合わせは映っている位置ではなくこちらで見る */
  const targetPageRef = useRef(pageOfSelected);
  /** 指の情報。null なら触っていない。navTo は「覗いている💎を押した＝そのページへ送る」の控え */
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; anchorX: number; startCameraX: number; startPage: number; moved: boolean; recorded: boolean; navTo: number | null } | null>(null);
  /** 指の速さを測るための、直前の動きの控え（時刻とカメラの位置px） */
  const samplesRef = useRef<{ t: number; x: number }[]>([]);
  /** 押されている見た目にする💎（「ページ番号:💎番号」）。null なら誰も押されていない */
  const pressedRef = useRef<string | null>(null);
  const animRef = useRef<number | null>(null);
  const disabledRef = useRef(disabled);
  const reduceMotionRef = useRef(reduceMotion);
  disabledRef.current = disabled;
  reduceMotionRef.current = reduceMotion;

  /** いまカメラが映している場所から一番近いページの番号 */
  const nearestPage = useCallback((x: number) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(wrapRing(centers[i] - x, ringLength));
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }, [centers, n, ringLength]);

  /** いまのカメラの位置から、ページの置き場所・覗きの薄さ・点の濃さを画面へ直に書き込む */
  const paint = useCallback(() => {
    const x = xRef.current;
    const clip = clipWidthRef.current;
    const deltas: number[] = [];
    let front = 0;
    let frontD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = wrapRing(centers[i] - x, ringLength);
      deltas.push(d);
      const a = Math.abs(d);
      if (a < frontD) { frontD = a; front = i; }
    }
    for (let i = 0; i < n; i++) {
      const el = pageElsRef.current[i];
      if (!el) continue;
      const d = deltas[i];
      const t = `translate3d(${d.toFixed(2)}px, 0, 0)`;
      // 窓の外へ出きったページは「無い」ことにする。置いたままだと、見えていない💎が
      // 窓のふちで反応してしまう
      const v = Math.abs(d) - contentWidths[i] / 2 > clip / 2 ? "hidden" : "";
      // 正面のページ以外＝両端に覗いているページ。薄く・少し小さくする
      const f = i === front ? "1" : "0";
      const prev = paintedRef.current[i];
      if (!prev) paintedRef.current[i] = { t: "", v: "", f: "" };   // 空にしておく＝最初の1回で必ず書き込む
      const p = paintedRef.current[i];
      if (p.t !== t) { el.style.transform = t; p.t = t; }
      if (p.v !== v) { el.style.visibility = v; p.v = v; }
      if (p.f !== f) { el.setAttribute("data-front", f); p.f = f; }
    }
    for (let i = 0; i < n; i++) {
      const dot = dotElsRef.current[i];
      if (dot) dot.style.opacity = String(i === front ? DOT_ON : DOT_OFF);
    }
    containerRef.current?.setAttribute("data-page-index", String(front));
  }, [centers, contentWidths, n, ringLength]);

  // 描き直しのあと（最初に置かれた時も含む）に、いまの目盛りの見た目へ合わせ直す
  useLayoutEffect(paint);

  // 切り落とす窓の幅を測る。画面の向きが変わった時・アドレスバーの出入りで幅が変わった時も測り直す
  useLayoutEffect(() => {
    const measure = () => {
      const w = windowRef.current?.getBoundingClientRect().width ?? 0;
      if (w > 0 && Math.abs(w - clipWidthRef.current) > 0.5) { clipWidthRef.current = w; paint(); }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [paint]);

  const stopAnim = useCallback(() => {
    if (animRef.current != null) { cancelAnimationFrame(animRef.current); animRef.current = null; }
  }, []);
  useEffect(() => stopAnim, [stopAnim]);

  /** カメラを行き先のページまで滑らせる。終わりに向かってなめらかに減速する。動き軽減なら一足飛び */
  const glideTo = useCallback((page: number, ms: number = SNAP_MS) => {
    stopAnim();
    const target = wrapIndex(page, n);
    targetPageRef.current = target;
    const from = xRef.current;
    const dist = wrapRing(centers[target] - from, ringLength);   // 近い方の回り方で行く
    if (reduceMotionRef.current || Math.abs(dist) < 0.5) {
      xRef.current = centers[target];
      paint();
      return;
    }
    const t0 = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      if (p >= 1) {
        animRef.current = null;
        xRef.current = centers[target];   // 目盛りが際限なく伸びないよう、収まったところで戻す
        paint();
        return;
      }
      xRef.current = from + dist * (1 - Math.pow(1 - p, 3));
      paint();
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  }, [centers, n, paint, ringLength, stopAnim]);

  // 色が変わった時（前回の色の読み込み、見返しで色を切り替えた時など）に、
  // その色が載っているページを正面へ持ってくる。
  // 罠: ここを「描き直しのたびに見比べる」形にすると、別のユニットのページを見ようとスワイプしても
  // 次の描き直し（再生中は自分の回数や動画の時刻の更新で毎秒起きる）で今の色のページへ引き戻される。
  // 色が変わった時だけ動かすこと（2026-09-08 の実測で引き戻しを確認して直した）
  useEffect(() => {
    if (dragRef.current) return;
    const want = pages.findIndex((p) => p.some((o) => o.id === selectedId));
    if (want < 0) return;
    if (want === targetPageRef.current) return;
    glideTo(want);
  }, [selectedId, glideTo, pages]);

  /** 押されている💎の縮みを書き込む。key が null なら全部の縮みを戻す */
  const paintPressed = useCallback((key: string | null) => {
    const prev = pressedRef.current;
    if (prev && prev !== key) {
      const el = gemElsRef.current.get(prev);
      if (el) el.style.transform = "";
    }
    pressedRef.current = key;
    if (key) {
      const el = gemElsRef.current.get(key);
      if (el) el.style.transform = `scale(${PRESS_SCALE})`;
    }
  }, []);

  /** 指を離した／取り上げられた時の後片付け。iOS の pointercancel でもここへ来る */
  const endDrag = useCallback((e?: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (e && e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    paintPressed(null);
    if (!d.moved) {
      // 動かさずに離した＝押しただけ。覗いている💎を押していたらそのページへ送る。
      // いま正面のページの💎なら、押した時の処理は触れた瞬間に済ませてあるので元の位置へ戻すだけ
      glideTo(d.navTo != null ? d.navTo : nearestPage(xRef.current));
      return;
    }
    // 指の速さ（払った勢い）を測る。止まったまま離した時は勢い無しとして一番近いページへ
    const now = performance.now();
    const s = samplesRef.current;
    let v = 0;                                     // px／ms
    if (s.length >= 2 && now - s[s.length - 1].t <= VELOCITY_STALE_MS) {
      const first = s[0];
      const last = s[s.length - 1];
      const dt = last.t - first.t;
      if (dt > 0) v = (last.x - first.x) / dt;
    }
    samplesRef.current = [];
    // この先どこまで滑るかを見積もった位置から、行き先を決める。
    // 行き先の候補は「元のページ」と「なぞった向きの隣のページ」の2つだけ＝
    // 速く払っても・大きく動かしても、1回のスワイプで進むのは隣まで。
    // 候補に左右の両方を入れないのは、4ページしか無いと「2つ先」と「1つ手前」が
    // 同じページになり、行き過ぎた時に逆向きへ吸い付いてしまうため
    const projected = xRef.current + v * GLIDE_PROJECTION_MS;
    const dir = xRef.current > d.startCameraX ? 1 : -1;
    let target = d.startPage;
    let bestD = Infinity;
    for (const c of [d.startPage, wrapIndex(d.startPage + dir, n)]) {
      const dist = Math.abs(wrapRing(centers[c] - projected, ringLength));
      if (dist < bestD) { bestD = dist; target = c; }
    }
    glideTo(target);
  }, [centers, glideTo, n, nearestPage, paintPressed, ringLength]);

  /** 指が触れた瞬間。いま正面のページの💎の上なら、指を離すのを待たずにここで色を変えて💎を1つ降らせる。
   *  両端に覗いているページの💎なら、色は変えず💎も降らさず、離した時にそのページへ送る */
  const beginDrag = useCallback((e: ReactPointerEvent<HTMLElement>, gem: { key: string; id: string; page: number } | null) => {
    if (dragRef.current) return;
    stopAnim();
    containerRef.current?.setPointerCapture?.(e.pointerId);
    const startPage = nearestPage(xRef.current);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, anchorX: e.clientX, startCameraX: xRef.current, startPage, moved: false, recorded: false, navTo: null };
    samplesRef.current = [];
    if (gem && gem.page !== startPage) {
      dragRef.current.navTo = gem.page;
      return;
    }
    if (gem) {
      paintPressed(gem.key);
      onSelect(gem.id);
      if (onRecord && !disabledRef.current) dragRef.current.recorded = onRecord(gem.id);
    }
  }, [nearestPage, onRecord, onSelect, paintPressed, stopAnim]);

  const handleMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      // ここを起点にする＝しきい値を越えた瞬間にページが8pxぶん飛ばない
      d.anchorX = e.clientX;
      d.startCameraX = xRef.current;
      d.navTo = null;                                                // 指が滑った＝ページ送りの押しは取り消す
      paintPressed(null);                                            // 指がぶれた＝押しではなくスワイプ
      if (d.recorded) { d.recorded = false; onRecordCancel?.(); }     // 触れた瞬間に降らせた分は取り消す
    }
    // 指が動いたぶんだけ帯が同じ量ずれる（1対1）
    xRef.current = d.startCameraX - (e.clientX - d.anchorX);
    const now = performance.now();
    const s = samplesRef.current;
    s.push({ t: now, x: xRef.current });
    while (s.length > 2 && now - s[0].t > VELOCITY_WINDOW_MS) s.shift();
    paint();
  }, [onRecordCancel, paint, paintPressed]);

  return (
    <div
      ref={containerRef}
      data-diamond-color-pages="true"
      data-current-id={selectedId}
      onPointerDown={(e) => beginDrag(e, null)}
      onPointerMove={handleMove}
      onPointerUp={(e) => endDrag(e)}
      onPointerCancel={(e) => endDrag(e)}
      onLostPointerCapture={(e) => endDrag(e)}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "relative",
        width: "100%",
        height: BAND_HEIGHT,
        // 一時停止中は全体を薄くして「押しても降らない」ことを見た目でも伝える
        opacity: disabled ? 0.4 : 1,
        touchAction: "none",       // 横になぞってもページが動かないように
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {/* 誘いの光沢。一列の帯と同じ流れ方（片方しか画面に出ないので同じ名前を使い回す）。
          あわせて、両端に覗いているページの💎を薄く・少し小さくする指定もここに置く
          （毎コマ書き込まずに済むよう、paint() は data-front を切り替えるだけにする） */}
      <style>{`
        @keyframes hai-to-diamond-band-invite {
          0%   { transform: translate3d(-100%, 0, 0); }
          55%  { transform: translate3d(100%, 0, 0); }
          100% { transform: translate3d(100%, 0, 0); }
        }
        [data-diamond-page][data-front="0"] .${NEIGHBOR_GEM_CLASS} {
          opacity: ${NEIGHBOR_OPACITY};
          transform: scale(${NEIGHBOR_SCALE});
        }
        ${reduceMotion ? "" : `.${NEIGHBOR_GEM_CLASS} { transition: opacity ${NEIGHBOR_FADE_MS}ms linear, transform ${NEIGHBOR_FADE_MS}ms ease; }`}
      `}</style>

      {/* 帯の裏の下地。一列の帯と同じもの（画面幅いっぱい・上下の縁はぼかして背景へ溶かす）。
          窓の外に置く＝ページを切り落とす枠に巻き込まれない */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: GEM_CENTER_Y - GEM_SIZE / 2 - BAND_PAD,
          height: DOTS_TOP + DOT_SIZE + BAND_PAD - (GEM_CENTER_Y - GEM_SIZE / 2 - BAND_PAD),
          zIndex: 0,
          background: BAND_BG,
          backdropFilter: `blur(${BAND_BLUR}px)`,
          WebkitBackdropFilter: `blur(${BAND_BLUR}px)`,
          maskImage: `linear-gradient(to bottom, transparent 0, #000 ${BAND_FADE}px, #000 calc(100% - ${BAND_FADE}px), transparent 100%)`,
          WebkitMaskImage: `linear-gradient(to bottom, transparent 0, #000 ${BAND_FADE}px, #000 calc(100% - ${BAND_FADE}px), transparent 100%)`,
          pointerEvents: "none",
        }}
      />

      {/* ページを覗かせる窓。はみ出したページは切り落とす＝両端に隣のページの端の💎だけが覗く。
          広い画面では、ページ1枚ぶんの幅の上限（WINDOW_MAX_WIDTH）の外側に覗くぶんだけ広げる */}
      <div
        ref={windowRef}
        style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          top: 0,
          width: "100%",
          maxWidth: WINDOW_MAX_WIDTH + PEEK_OUTSIDE * 2,
          height: BAND_HEIGHT,
          overflow: "hidden",
          zIndex: 1,
        }}
      >
        {pages.map((page, pi) => (
          <div
            key={pi}
            ref={(el) => { pageElsRef.current[pi] = el; }}
            data-diamond-page={pi}
            style={{
              position: "absolute",
              // 帯の上での置き場所は paint() が transform で入れる。ここでは窓の真ん中に据えるだけ
              left: "50%",
              marginLeft: -contentWidths[pi] / 2,
              top: GEM_CENTER_Y - GEM_SIZE / 2,
              width: contentWidths[pi],
              height: GEM_SIZE,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: GEM_GAP,
              willChange: "transform",
            }}
          >
            {page.map((opt, gi) => {
              const key = `${pi}:${gi}`;
              return (
                <button
                  key={opt.id}
                  ref={(el) => { if (el) gemElsRef.current.set(key, el); else gemElsRef.current.delete(key); }}
                  type="button"
                  aria-label={opt.id}
                  aria-pressed={opt.id === selectedId}
                  data-diamond-color-id={opt.id}
                  onPointerDown={(e) => { e.stopPropagation(); beginDrag(e, { key, id: opt.id, page: pi }); }}
                  style={{
                    flex: "0 0 auto",
                    width: GEM_SIZE,
                    height: GEM_SIZE,
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    touchAction: "none",
                    WebkitTapHighlightColor: "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {/* 積もった💎の山に重なっても輪郭が分かるよう、絵の形に沿った薄い暗い縁取りを敷く（一列の帯と同じ） */}
                  <span className={NEIGHBOR_GEM_CLASS} style={{ display: "block", position: "relative", filter: "drop-shadow(0 0 2px rgba(0,0,0,0.75)) drop-shadow(0 2px 6px rgba(0,0,0,0.5))" }}>
                    {/* 選択中の印: 💎の形に沿ったグレーの縁。白だと白のメンバーカラーが膨らんで見えるだけなのでグレー（Hop決定 2026-09-08） */}
                    {opt.id === selectedId && (
                      <span
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          left: "50%",
                          top: "50%",
                          width: GEM_SIZE,
                          height: GEM_SIZE,
                          marginLeft: -GEM_SIZE / 2,
                          marginTop: -GEM_SIZE / 2,
                          transform: `scale(${SELECTED_RING_SCALE})`,
                          pointerEvents: "none",
                        }}
                      >
                        <FaIcon icon={faGem} size={GEM_SIZE} color={SELECTED_RING_COLOR} />
                      </span>
                    )}
                    <span style={{ display: "block", position: "relative" }}>
                      <FaIcon icon={faGem} size={GEM_SIZE} color={opt.color} />
                    </span>
                    {/* 初回タップまでの誘い: 白い斜線2本が💎の上を左から右へ流れる。いまの色の💎にだけ出し、1回押したら消える */}
                    {inviting && !reduceMotion && opt.id === selectedId && (
                      <span
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          inset: 0,
                          overflow: "hidden",
                          pointerEvents: "none",
                          WebkitMaskImage: GEM_MASK,
                          maskImage: GEM_MASK,
                          WebkitMaskSize: "100% 100%",
                          maskSize: "100% 100%",
                          WebkitMaskRepeat: "no-repeat",
                          maskRepeat: "no-repeat",
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            inset: 0,
                            background: SHINE_STRIPES,
                            animation: `hai-to-diamond-band-invite ${INVITE_PULSE_SECONDS}s ease-in-out infinite`,
                            willChange: "transform",
                          }}
                        />
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* いまどのページかを示す点。文字は出さない */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: DOTS_TOP,
          zIndex: 1,
          display: "flex",
          justifyContent: "center",
          gap: DOT_GAP,
          pointerEvents: "none",
        }}
      >
        {pages.map((_, i) => (
          <span
            key={i}
            ref={(el) => { dotElsRef.current[i] = el; }}
            style={{ width: DOT_SIZE, height: DOT_SIZE, borderRadius: "50%", background: "#fff", opacity: DOT_OFF }}
          />
        ))}
      </div>
    </div>
  );
});

export default DiamondColorPages;
