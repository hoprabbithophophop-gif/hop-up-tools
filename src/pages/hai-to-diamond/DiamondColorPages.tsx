// 画面下の色えらび、もう一つの並べ方「ユニットごとのページ」（Hop決定 2026-09-08。既定はこちら）。
//
// 一列の帯（DiamondColorCarousel.tsx）では、杉山さん（現役）と山﨑夢羽さん（卒業）の💎が
// 同じ赤で隣り合って見分けが付かない、という声への答え。14人を4つのページに分け、
// 1ページの中では全部の💎が同じ大きさで横に並ぶ。どれでも直接押せる（真ん中に呼び寄せる手間が無い）。
// ページの入れ替えは左右のスワイプ。4ページを端から端へ回り続ける。
//
// ページの動かし方は一列の帯と同じ考え方: ページの要素は最初に4枚置いたきり並べ替えず、
// 「いまどのページが正面か」を小数の目盛り offset で持つ。それぞれのページは正面から
// 何ページぶん離れているかを、4で割った近い方の回り方で毎回計算して置き直す。
// 目盛りがいくら進んでも一周ぶんの中に収まるので、端で先頭へ戻る時にも継ぎ目が出ない。
//
// 指を追っている間は React に描き直しを頼まず、ページの要素の transform を直に書き換える
// （一列の帯と同じ理由。React を挟むと1コマぶんの組み直しが挟まって引っかかる）。
// iOS はページの操作を横取りする時に pointercancel を送ってくるので、指の状態は
// pointerup / pointercancel / lostpointercapture の3つで必ず片付ける。
import { memo, useCallback, useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
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
/** 選択中の印（グレーの縁）の色と、💎より何倍大きく敷くか【仮】 */
const SELECTED_RING_COLOR = "#9aa0a6";
const SELECTED_RING_SCALE = 1.14;
/** 💎と💎のあいだの隙間(px)【仮】。人数の違うページでも💎の間隔を変えず、中央寄せで並べる */
const GEM_GAP = 24;
/** 💎の列の中心を、帯の器の上端から何px下に置くか【仮】。下に点を置くぶん少し上寄せ */
const GEM_CENTER_Y = 40;
/** ページを覗かせる窓の最大の幅(px)【仮】。広い画面でも1回のスワイプが長くなりすぎないようにする */
const WINDOW_MAX_WIDTH = 420;
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

/** 差 d を「一周のうち近い方の回り方」に直す */
function wrapDelta(d: number, n: number): number {
  const x = ((d % n) + n) % n;
  return x > n / 2 ? x - n : x;
}

/** 目盛りを 0 以上 n 未満に収める */
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
  const paintedRef = useRef<{ t: string; v: string }[]>([]);
  /** 窓の幅(px)。ページ1枚ぶんの横幅＝スワイプの換算に使う */
  const widthRef = useRef(0);

  /** いま正面にあるページ。整数ならぴたり正面、小数はその途中 */
  const pageOfSelected = Math.max(0, pages.findIndex((p) => p.some((o) => o.id === selectedId)));
  const offsetRef = useRef(pageOfSelected);
  /** 吸い付きの行き先。外との突き合わせは映っている位置ではなくこちらで見る */
  const targetIndexRef = useRef(offsetRef.current);
  /** 指の情報。null なら触っていない */
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; anchorX: number; startOffset: number; startPage: number; moved: boolean; recorded: boolean } | null>(null);
  /** 指の速さを測るための、直前の動きの控え（時刻とページの目盛り） */
  const samplesRef = useRef<{ t: number; o: number }[]>([]);
  /** 押されている見た目にする💎（「ページ番号:💎番号」）。null なら誰も押されていない */
  const pressedRef = useRef<string | null>(null);
  const animRef = useRef<number | null>(null);
  const disabledRef = useRef(disabled);
  const reduceMotionRef = useRef(reduceMotion);
  disabledRef.current = disabled;
  reduceMotionRef.current = reduceMotion;

  /** いまの目盛りから、ページの位置と点の濃さを画面へ直に書き込む */
  const paint = useCallback(() => {
    const off = offsetRef.current;
    const w = widthRef.current;
    const base = wrapIndex(Math.round(off), n);
    for (let i = 0; i < n; i++) {
      const el = pageElsRef.current[i];
      if (!el) continue;
      const d = wrapDelta(i - off, n);
      const t = `translate3d(${(d * w).toFixed(2)}px, 0, 0)`;
      // 窓の外へ出きったページは「無い」ことにする。置いたままだと、見えていない💎が
      // 窓のふちで反応してしまう
      const v = Math.abs(d) < 0.999 ? "" : "hidden";
      const prev = paintedRef.current[i];
      if (!prev) paintedRef.current[i] = { t: "", v: "" };
      const p = paintedRef.current[i];
      if (p.t !== t) { el.style.transform = t; p.t = t; }
      if (p.v !== v) { el.style.visibility = v; p.v = v; }
    }
    for (let i = 0; i < n; i++) {
      const dot = dotElsRef.current[i];
      if (dot) dot.style.opacity = String(i === base ? DOT_ON : DOT_OFF);
    }
    containerRef.current?.setAttribute("data-page-index", String(base));
  }, [n]);

  // 描き直しのあと（最初に置かれた時も含む）に、いまの目盛りの見た目へ合わせ直す
  useLayoutEffect(paint);

  // 窓の幅を測る。画面の向きが変わった時・アドレスバーの出入りで幅が変わった時も測り直す
  useLayoutEffect(() => {
    const measure = () => {
      const w = windowRef.current?.getBoundingClientRect().width ?? 0;
      if (w > 0 && Math.abs(w - widthRef.current) > 0.5) { widthRef.current = w; paint(); }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [paint]);

  const stopAnim = useCallback(() => {
    if (animRef.current != null) { cancelAnimationFrame(animRef.current); animRef.current = null; }
  }, []);
  useEffect(() => stopAnim, [stopAnim]);

  /** 目盛りを行き先まで滑らせる。終わりに向かってなめらかに減速する。動き軽減なら一足飛び */
  const glideTo = useCallback((target: number, ms: number = SNAP_MS) => {
    stopAnim();
    targetIndexRef.current = wrapIndex(target, n);
    const from = offsetRef.current;
    const dist = target - from;
    if (reduceMotionRef.current || Math.abs(dist) < 0.001) {
      offsetRef.current = wrapIndex(target, n);
      paint();
      return;
    }
    const t0 = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      if (p >= 1) {
        animRef.current = null;
        offsetRef.current = wrapIndex(target, n);   // 目盛りが際限なく伸びないよう、収まったところで戻す
        paint();
        return;
      }
      offsetRef.current = from + dist * (1 - Math.pow(1 - p, 3));
      paint();
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  }, [n, paint, stopAnim]);

  // 色が変わった時（前回の色の読み込み、見返しで色を切り替えた時など）に、
  // その色が載っているページを正面へ持ってくる。
  // 罠: ここを「描き直しのたびに見比べる」形にすると、別のユニットのページを見ようとスワイプしても
  // 次の描き直し（再生中は自分の回数や動画の時刻の更新で毎秒起きる）で今の色のページへ引き戻される。
  // 色が変わった時だけ動かすこと（2026-09-08 の実測で引き戻しを確認して直した）
  useEffect(() => {
    if (dragRef.current) return;
    const want = pages.findIndex((p) => p.some((o) => o.id === selectedId));
    if (want < 0) return;
    const cur = targetIndexRef.current;
    if (Math.abs(cur - want) < 0.001) return;
    glideTo(cur + wrapDelta(want - cur, n));
  }, [selectedId, glideTo, n, pages]);

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
      // 動かさずに離した＝押しただけ。💎を押した時の処理は触れた瞬間に済ませてあるので、ここは元の位置へ戻すだけ
      glideTo(Math.round(offsetRef.current));
      return;
    }
    // 指の速さ（払った勢い）を測る。止まったまま離した時は勢い無しとして一番近いページへ
    const now = performance.now();
    const s = samplesRef.current;
    let v = 0;                                     // ページ／ms
    if (s.length >= 2 && now - s[s.length - 1].t <= VELOCITY_STALE_MS) {
      const first = s[0];
      const last = s[s.length - 1];
      const dt = last.t - first.t;
      if (dt > 0) v = (last.o - first.o) / dt;
    }
    samplesRef.current = [];
    const from = offsetRef.current;
    // 1回のスワイプで進むのは隣のページまで。速く払っても飛び越さない
    const raw = Math.round(from + v * GLIDE_PROJECTION_MS);
    const target = Math.max(d.startPage - 1, Math.min(d.startPage + 1, raw));
    glideTo(target);
  }, [glideTo, paintPressed]);

  /** 指が触れた瞬間。💎の上なら、指を離すのを待たずにここで色を変えて💎を1つ降らせる */
  const beginDrag = useCallback((e: ReactPointerEvent<HTMLElement>, gem: { key: string; id: string } | null) => {
    if (dragRef.current) return;
    stopAnim();
    containerRef.current?.setPointerCapture?.(e.pointerId);
    const startPage = Math.round(offsetRef.current);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, anchorX: e.clientX, startOffset: offsetRef.current, startPage, moved: false, recorded: false };
    samplesRef.current = [];
    if (gem) {
      paintPressed(gem.key);
      onSelect(gem.id);
      if (onRecord && !disabledRef.current) dragRef.current.recorded = onRecord(gem.id);
    }
  }, [onRecord, onSelect, paintPressed, stopAnim]);

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
      d.startOffset = offsetRef.current;
      paintPressed(null);                                            // 指がぶれた＝押しではなくスワイプ
      if (d.recorded) { d.recorded = false; onRecordCancel?.(); }     // 触れた瞬間に降らせた分は取り消す
    }
    const w = widthRef.current || 1;
    offsetRef.current = d.startOffset - (e.clientX - d.anchorX) / w;
    const now = performance.now();
    const s = samplesRef.current;
    s.push({ t: now, o: offsetRef.current });
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
      {/* 誘いの光沢。一列の帯と同じ流れ方（片方しか画面に出ないので同じ名前を使い回す） */}
      <style>{`
        @keyframes hai-to-diamond-band-invite {
          0%   { transform: translate3d(-100%, 0, 0); }
          55%  { transform: translate3d(100%, 0, 0); }
          100% { transform: translate3d(100%, 0, 0); }
        }
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

      {/* ページを覗かせる窓。はみ出したページは切り落とす＝スワイプ中に隣のページが端から入ってくる */}
      <div
        ref={windowRef}
        style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          top: 0,
          width: "100%",
          maxWidth: WINDOW_MAX_WIDTH,
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
              left: 0,
              top: GEM_CENTER_Y - GEM_SIZE / 2,
              width: "100%",
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
                  onPointerDown={(e) => { e.stopPropagation(); beginDrag(e, { key, id: opt.id }); }}
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
                  <span style={{ display: "block", position: "relative", filter: "drop-shadow(0 0 2px rgba(0,0,0,0.75)) drop-shadow(0 2px 6px rgba(0,0,0,0.5))" }}>
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
