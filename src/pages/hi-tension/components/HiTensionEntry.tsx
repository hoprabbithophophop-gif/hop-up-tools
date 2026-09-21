import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ALL_HI_MEMBERS, findMember, PRACTICE_VIDEOS } from "../data";
import HandIcon from "./HandIcon";
import FaIcon from "./FaIcon";
import { faHandPointer } from "@fortawesome/free-solid-svg-icons";
import type { SpecialEvent } from "../events";

// YouTube の規約対応で入口を作り直した版。動画そのものはページ側が常に一番上に出していて、
// 視聴者は YouTube 本体の再生ボタンで始める。ここは「動画の下の帯」に入る部品。
// 「はじめる」ボタンと合言葉の部屋（ROOM_ENABLED=false で非表示）は移していない
// ＝再生は動画側のボタンで始まる前提のため、この部品には「押すと始まる」要素を置かない。
//
// 色えらびは横一列のダイヤル（2026-09-22 Hop決定）。段を4つ積むと幅375pxの端末で帯に収まらないため、
// 1行に並べて指で横に送り、真ん中に来た色が選ばれる形にした。スペシャル回の日は今までどおり
// 主役の色の丸が1個だけで、ダイヤルは出さない。

// ---- ダイヤルの決めごと ----
// 指ざわりの数値（しきい値・滑る時間・速さの測り方）は、灰toダイヤモンドの色の帯
// （hai-to-diamond/DiamondColorCarousel.tsx）と同じ値をそのまま使う。同じ「一列でループする
// 色えらび」なので、ツールごとに感触が違うと戸惑うため。
/** 丸と丸のあいだ(px)。段の中の間隔（1rem）をそのまま横に持ってきた値 */
const STRIP_GAP = 16;
/** これだけ指が動いたらスワイプ扱いにして、丸の押し（色えらび）を取り消す(px) */
const DRAG_THRESHOLD = 8;
/** 指を離してから一番近い色が真ん中に収まるまでの時間(ms)。勢いが無かった時に使う */
const SNAP_MS = 220;
/** 勢いを付けて滑る時の、いちばん短い／長い時間(ms)。急に止まる・だらだら続くのを防ぐ */
const GLIDE_MIN_MS = 160;
const GLIDE_MAX_MS = 900;
/** 指の速さを測る窓(ms)。これより古い動きは勢いの計算に入れない */
const VELOCITY_WINDOW_MS = 100;
/** 指が止まってからこれ以上経って離した場合は、勢い無し＝一番近い色へ吸い付くだけにする(ms) */
const VELOCITY_STALE_MS = 100;
/** 指の速さから「この先どこまで滑るか」を見積もる時間(ms) */
const GLIDE_PROJECTION_MS = 100;
/** 1回のスワイプで進める上限（個）。速く払っても行き過ぎないための蓋 */
const GLIDE_MAX_STEPS = 6;

/** 差 d を「一周のうち近い方の回り方」に直す。例: 12色で 10 個先は、逆回りで 2 個手前 */
function wrapDelta(d: number, n: number): number {
  const x = ((d % n) + n) % n;
  return x > n / 2 ? x - n : x;
}

/** 目盛りを 0 以上 n 未満に収める */
function wrapIndex(v: number, n: number): number {
  return ((v % n) + n) % n;
}

/** 端末側で「動きを減らす」設定になっているか。滑る動きを一足飛びに切り替えるのに使う */
function prefersReducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

interface Props {
  /** 端末に残っている「最後に選んだ色」。ダイヤルを最初に置く位置にだけ使う。 */
  selectedId: string | null;
  /** 色が選ばれた時に親へ伝える（親が覚えて端末にも保存する）。指を離した時・丸を押した時だけ呼ぶ。 */
  onPickColor: (id: string) => void;
  /** いま真ん中に居る色を親へ伝える。保存はさせない＝まだ本人が選んだとは限らないため。 */
  onCenterColor?: (id: string) => void;
  events?: readonly SpecialEvent[];
  selectedEventKey?: string | null;
  /** 右上にあった表示設定の歯車。今回はタイトル行の中に置く。 */
  onOpenSettings?: () => void;
  /** QAモードのトグル（隠しジェスチャー成立時に呼ぶ）。 */
  onToggleQa?: () => void;
  /** 上級編（振り練習）へ移動する。アイコンのみの控えめな導線。 */
  onOpenAdvanced?: () => void;
  /** 横向きか。横向きだけレイアウトそのものを丸ごと作り替える（動画の左右の帯へ要素を振り分ける）。 */
  isLandscape: boolean;
  /** 横向きの時だけ使う：動画の器の下端（HiTensionPage 側の LANDSCAPE_VIDEO_BOTTOM と同じ式を
   *  そのまま受け取る）。下の帯（色えらびだけの帯）をここから画面の下端まで敷くのに使う。
   *  縦向きでは使わない。 */
  landscapeVideoBottom?: string;
}

export default function HiTensionEntry({
  selectedId,
  onPickColor,
  onCenterColor,
  events = [],
  selectedEventKey = null,
  onOpenSettings,
  onToggleQa,
  onOpenAdvanced,
  isLandscape,
  landscapeVideoBottom,
}: Props) {
  // 色タップごとに +1。背景✋の key に混ぜて「同じ色を選び直しても」再マウント→ポップさせる。
  // 指で送っている最中は key を変えない＝色だけ変わって、跳ねる演出は押した時だけ出る。
  const [popTick, setPopTick] = useState(0);

  // 表示中のスペシャル回（お祝い等）。選ばれていれば入口の色・文言をその回仕様にする。
  const selectedEvent = events.find((e) => e.key === selectedEventKey) ?? null;
  const isSpecial = selectedEvent != null;
  const eventColor = selectedEvent?.color ?? null;

  // ---- ダイヤル（普段の日の色えらび）----
  // 並び順は今の段（ユニット3段＋新メンバーの1段）を上から順につないだ並びそのまま。
  const colors = ALL_HI_MEMBERS;
  const n = colors.length;
  // 最初に真ん中へ置く色。端末に残っていればその色、無ければその都度1色を当てる。
  // 当てただけの色は本人が選んだ物ではないので保存しない（押す／指で送ると保存される）。
  const [initialId] = useState<string>(
    () => findMember(selectedId)?.id ?? colors[Math.floor(Math.random() * n)].id,
  );
  // 真ん中に居る色。背景✋の着色と読み上げに使う。指を動かしている最中も追従する。
  const [centerId, setCenterId] = useState<string>(initialId);
  const centerIdRef = useRef(initialId);

  const stripRef = useRef<HTMLDivElement | null>(null);
  /** 丸の要素の控え。色の並び順にそのまま入れる（並べ替えないので番号＝色の番号） */
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  /** 前回書き込んだ見た目。同じ値なら書き込まない＝指を動かしている間の無駄な書き換えを減らす */
  const paintedRef = useRef<{ t: string; s: string; b: string }[]>([]);
  /** 丸1個ぶんの横幅(px)。丸の直径は帯の高さに合わせて変わるので、置かれた後に測る */
  const strideRef = useRef(0);
  /** 前回の「真ん中の丸」。読み上げ用の印を、変わった時だけ書き換えるために覚えておく */
  const paintedBaseRef = useRef(-1);
  /** 真ん中に来ている位置。整数なら色がぴたりと真ん中、小数はその途中。
   *  指を追っている間も滑っている間もこの値だけを動かし、画面へは paint() で直に書き込む */
  const offsetRef = useRef(Math.max(0, colors.findIndex((c) => c.id === initialId)));
  /** 指の情報。null なら触っていない。anchorX は「スワイプと認めた地点」で、ここからの差分で列を動かす */
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; anchorX: number; startOffset: number; item: number | null; moved: boolean } | null>(null);
  /** 指の速さを測るための、直前の動きの控え（時刻と目盛り） */
  const samplesRef = useRef<{ t: number; o: number }[]>([]);
  const animRef = useRef<number | null>(null);

  /** いまの目盛りから、丸の位置・大きさ・輪を画面へ直に書き込む。
   *  React を通さないので、指を動かしている間も要素を作り直さずに済む
   *  （灰toダイヤモンドの帯で「指でスライドすると引っかかる」を直した時と同じ作り）。 */
  const paint = useCallback(() => {
    const stride = strideRef.current;
    if (stride <= 0) return;
    const off = offsetRef.current;
    const base = wrapIndex(Math.round(off), n);
    for (let i = 0; i < n; i++) {
      const el = itemsRef.current[i];
      if (!el) continue;
      const d = wrapDelta(i - off, n);
      // 真ん中にどれだけ近いか（1＝真ん中、0＝隣より外）。選択中の見た目をこの割合で効かせる＝
      // 指で送っている途中も、大きさと輪が真ん中の丸へなめらかに移っていく。
      const k = Math.max(0, 1 - Math.abs(d));
      const t = `translate3d(calc(-50% + ${(d * stride).toFixed(2)}px), 0, 0)`;
      const s = `scale(${(1 + 0.2 * k).toFixed(3)})`;
      // 輪は box-shadow（場所を取らないので列の幅が動かない）。いちばん外の 1px は
      // 白メンカラが暗背景から浮いて見えないようにする縁で、輪が出ると裏に隠れる。
      const b = `0 0 0 ${(3 * k).toFixed(2)}px #f8f9fa, 0 0 0 ${(5 * k).toFixed(2)}px ${colors[i].color}, 0 0 0 1px rgba(0,0,0,0.08)`;
      if (!paintedRef.current[i]) paintedRef.current[i] = { t: "", s: "", b: "" };
      const p = paintedRef.current[i];
      const dot = el.firstElementChild as HTMLElement | null;
      if (p.t !== t) { el.style.transform = t; p.t = t; }
      if (dot && p.s !== s) { dot.style.transform = s; p.s = s; }
      if (dot && p.b !== b) { dot.style.boxShadow = b; p.b = b; }
      if (paintedBaseRef.current !== base) el.setAttribute("aria-pressed", i === base ? "true" : "false");
    }
    paintedBaseRef.current = base;
  }, [colors, n]);

  /** 真ん中の色が変わったら、背景✋の色と読み上げを合わせる。
   *  親には「今これが真ん中に居る」とだけ伝える＝端末には保存させない。 */
  const syncCenter = useCallback(() => {
    const id = colors[wrapIndex(Math.round(offsetRef.current), n)].id;
    if (id === centerIdRef.current) return;
    centerIdRef.current = id;
    setCenterId(id);
    onCenterColor?.(id);
  }, [colors, n, onCenterColor]);

  const stopAnim = useCallback(() => {
    if (animRef.current != null) { cancelAnimationFrame(animRef.current); animRef.current = null; }
  }, []);

  /** 目盛りを行き先まで滑らせる。終わりに向かってなめらかに減速する。
   *  follow を立てると、滑っている途中に通り過ぎる色にも背景✋が追従する（指で払った時）。
   *  端末が「動きを減らす」設定なら一足飛びに置く。 */
  const glideTo = useCallback((target: number, ms: number, follow: boolean) => {
    stopAnim();
    const from = offsetRef.current;
    const dist = target - from;
    if (prefersReducedMotion() || Math.abs(dist) < 0.001) {
      offsetRef.current = wrapIndex(target, n);
      paint();
      if (follow) syncCenter();
      return;
    }
    const t0 = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);          // 終わりでゆっくり止まる
      if (p >= 1) {
        animRef.current = null;
        offsetRef.current = wrapIndex(target, n); // 目盛りが際限なく伸びないよう、収まったところで色の数の範囲へ戻す
        paint();
        if (follow) syncCenter();
        return;
      }
      offsetRef.current = from + dist * e;
      paint();
      if (follow) syncCenter();
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  }, [n, paint, stopAnim, syncCenter]);

  // QAモード起動の隠しジェスチャー（hop指定）：nishida⇄eguchi の色を5秒以内に10往復（交互20タップ）。
  // 実機でURLにパラメータを打つのが面倒なため。成立でトグル（もう一度で解除）。保存はしない。
  // 数えるのは「丸を押した事」だけ＝滑って真ん中を通り過ぎた色は数に入らない。滑り終わるのも待たない。
  const qaTapsRef = useRef<{ id: string; t: number }[]>([]);
  const detectQaGesture = (id: string) => {
    if (id !== "nishida" && id !== "eguchi") {
      qaTapsRef.current = []; // 別の色を押したら仕切り直し
      return;
    }
    const now = performance.now();
    const taps = qaTapsRef.current;
    const last = taps[taps.length - 1];
    if (last && last.id === id) {
      qaTapsRef.current = [{ id, t: now }]; // 交互でなければこのタップから数え直し
      return;
    }
    taps.push({ id, t: now });
    while (taps.length > 0 && now - taps[0].t > 5000) taps.shift(); // 5秒窓の外は捨てる
    if (taps.length >= 20) {
      qaTapsRef.current = [];
      onToggleQa?.();
    }
  };

  /** 丸を押した：その丸を真ん中へ呼んで、その色を選ぶ。指で送れない環境でもここで選べる。 */
  const pickItem = (i: number) => {
    const id = colors[i].id;
    // 押した色は滑り終わりを待たずに選ばれた扱いにする＝背景✋は押した瞬間にその色で跳ねる。
    // 途中で通り過ぎる色に✋がちらつかないよう、この滑りでは色を追従させない（follow=false）。
    centerIdRef.current = id;
    setCenterId(id);
    setPopTick((t) => t + 1);
    detectQaGesture(id);
    glideTo(offsetRef.current + wrapDelta(i - offsetRef.current, n), SNAP_MS, false);
    onPickColor(id);
  };

  /** 指が触れた瞬間 */
  const beginDrag = (e: ReactPointerEvent<HTMLElement>, item: number | null) => {
    if (dragRef.current) return;
    stopAnim();
    stripRef.current?.setPointerCapture?.(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, anchorX: e.clientX, startOffset: offsetRef.current, item, moved: false };
    samplesRef.current = [];
  };

  const handleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      // ここを起点にする＝しきい値を越えた瞬間に列が8pxぶん飛ばない
      d.anchorX = e.clientX;
      d.startOffset = offsetRef.current;
    }
    const stride = strideRef.current || 1;
    offsetRef.current = d.startOffset - (e.clientX - d.anchorX) / stride;
    // 指の速さを測るための控え。窓より古いものは捨てる
    const now = performance.now();
    const s = samplesRef.current;
    s.push({ t: now, o: offsetRef.current });
    while (s.length > 2 && now - s[0].t > VELOCITY_WINDOW_MS) s.shift();
    paint();
    syncCenter();
  };

  /** 指を離した／取り上げられた時の共通の後片付け。iOS は画面の操作を横取りする時に
   *  pointercancel を送ってくるので、そこで片付けを忘れるとボタンが二度と押せなくなる */
  const endDrag = (commit: boolean, e?: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (e && e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    // 動かさずに丸を押した＝その色を選ぶ
    if (commit && !d.moved && d.item != null) {
      pickItem(d.item);
      return;
    }
    // iOS に操作を取り上げられた時(commit=false)も、ここから下は同じように通す。
    // 通さないと、色と色のあいだで止まったままになる。
    // 指の速さ（払った勢い）を測る。指が止まったまま離した時は勢い無しとして一番近い色へ
    const now = performance.now();
    const s = samplesRef.current;
    let v = 0;                                     // 目盛り／ms
    if (s.length >= 2 && now - s[s.length - 1].t <= VELOCITY_STALE_MS) {
      const first = s[0];
      const last = s[s.length - 1];
      const dt = last.t - first.t;
      if (dt > 0) v = (last.o - first.o) / dt;
    }
    const from = offsetRef.current;
    // 速さのぶんだけ先を見て、そこから一番近い色を行き先にする＝必ずどれかの色の真ん中で止まる
    const glide = Math.max(-GLIDE_MAX_STEPS, Math.min(GLIDE_MAX_STEPS, v * GLIDE_PROJECTION_MS));
    const target = Math.round(from + glide);
    const dist = Math.abs(target - from);
    // 離した瞬間の速さと滑り出しの速さを揃えると、動き出しの段差が出ない
    // （終わりでゆっくり止まる曲線では、滑り出しの速さ＝距離×3÷時間）
    const ms = Math.abs(v) > 0.0005
      ? Math.max(GLIDE_MIN_MS, Math.min(GLIDE_MAX_MS, (3 * dist) / Math.abs(v)))
      : SNAP_MS;
    samplesRef.current = [];
    glideTo(target, ms, true);
    // 保存を伴う「選んだ」は1回のスワイプにつきここ1回だけ。行き先はもう決まっているので、
    // 滑り終わりを待たずに伝える＝滑っている最中に動画の再生ボタンを押されても色が合う。
    onPickColor(colors[wrapIndex(target, n)].id);
  };

  /** キーボードで丸に移った時は、その色を真ん中へ呼んで見せるだけ（選ぶのは Enter / Space）。 */
  const handleFocusItem = (i: number) => {
    if (dragRef.current) return;
    if (wrapIndex(Math.round(offsetRef.current), n) === i) return;
    glideTo(offsetRef.current + wrapDelta(i - offsetRef.current, n), SNAP_MS, true);
  };

  // 丸1個ぶんの横幅を測って位置を引き直す。回転・画面の大きさ変更でも真ん中の色は真ん中のまま
  // （目盛りは触らず、幅だけ測り直して置き直すため）。
  useLayoutEffect(() => {
    // 縦⇄横で丸の部品そのものが作り直される（縦用と横用で別の場所に描くため）。
    // 「前に塗った値」の控えは古い部品の物なので捨てる＝捨てないと、新しい丸には
    // 「もう塗ってある」と勘違いして位置も輪も付かず、選んだ色が真ん中からずれて見える。
    paintedRef.current = [];
    paintedBaseRef.current = -1;
    const measure = () => {
      const el = itemsRef.current[0];
      const w = el ? el.getBoundingClientRect().width : 0;
      if (w > 0) strideRef.current = w;
      paint();
    };
    measure();
    const strip = stripRef.current;
    const slot = itemsRef.current[0];
    if (!strip || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(strip);
    if (slot) ro.observe(slot);   // 丸の直径が変わった時（＝1個ぶんの幅が変わった時）を直に拾う
    return () => ro.disconnect();
    // isLandscape：向きが変わったら、新しく出来た丸を測り直して見張り直す。
  }, [paint, isLandscape]);

  // 描き直しのあとに、いまの目盛りの見た目へ合わせ直す。位置・大きさ・輪は JSX に書いていないので、
  // React の描き直しで元に戻ることはない（書くと取り合いになる）。
  useLayoutEffect(paint);

  useEffect(() => stopAnim, [stopAnim]);

  // 最初に真ん中へ置いた色を親へ伝える。端末に残っていた色でも、その都度当てた色でも、
  // これで「常にどれかの色が選ばれている」状態になる（保存はしない）。
  useEffect(() => {
    if (isSpecial) return;
    onCenterColor?.(initialId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 選択中のメンバーカラー。背景の✋モチーフの着色に使う。スペシャル回中は回の色に統一。
  const selectedColor = isSpecial ? eventColor : (findMember(centerId)?.color ?? null);

  return (
    <>
      <style>{`
        /* 本編/待機室の hand-hop と同じ「squash→stretch」の感触。全画面の✋なので
           平行移動はせず、その場で潰れて伸びて戻る（色を押すたびに走る）。 */
        @keyframes hi-tension-hand-pop {
          0%   { transform: translate(-50%, -50%) scaleX(1.06) scaleY(0.9); }
          45%  { transform: translate(-50%, -50%) scaleX(0.97) scaleY(1.05); }
          100% { transform: translate(-50%, -50%) scale(1); }
        }

        /* なぞる器(.hi-entry-scroll)自身の矩形を、帯の高さに固定した「物差し」にする。
           これで cqh は中身がどれだけ膨らんでも帯の見えている高さのまま動かない。 */
        .hi-entry-scroll {
          container-type: size;
        }

        /* 中身の箱。✋も中身もここでまとめて切る＝✋のはみ出しは見えなくなるだけで、
           なぞれる範囲（なぞる器のスクロール量）を広げない。overflow:clip 未対応環境向けに
           overflow:hidden を先に書いておき、後勝ちで clip に上書きさせる。 */
        .hi-entry-inner {
          overflow: hidden;
          overflow: clip;
        }

        /* 帯の上下の余白。上：古いエンジン向けの元の固定値→次点でcqh。cqh非対応なら固定値のまま。 */
        .hi-entry-pad {
          padding: 1.5rem 1.2rem 1.5rem;
          padding: clamp(0.5rem, 5cqh, 1.5rem) 1.2rem clamp(0.5rem, 5cqh, 1.5rem);
        }
        .hi-entry-pad-landscape {
          padding: 0.7rem 1rem 0.7rem;
          padding: clamp(0.4rem, 4cqh, 0.7rem) 1rem clamp(0.4rem, 4cqh, 0.7rem);
        }

        /* 色の丸を横一列に送るダイヤルの器。列の外へ出た丸はここで切る＝見えない丸が
           押せてしまわない。切った所で丸が半分見えるのが「まだ続きがある」合図になる。
           左右だけ切って上下は切らない＝真ん中の丸が大きくなって輪が付いても、その輪のぶんの
           高さをこの器に足さずに済む（輪は上下の余白へはみ出すだけ。帯の端では .hi-entry-inner が切る）。
           古いエンジンは上下も切れるので、そちらのフォールバック値だけ輪のぶんを含めた高さにする。
           器の幅（横向きで最大560px）が、一周ぶん(色の数×丸1個ぶん)の半分より狭いことが前提。
           列は一周を回り込ませて並べ直すので、この範囲を超えると回り込む瞬間が見えてしまう。 */
        .hi-color-strip {
          position: relative;
          width: 100%;
          overflow: hidden;
          overflow: clip visible;
          height: 84px;
          height: clamp(44px, 17cqh, 56px);
        }
        /* 丸1個ぶんの場所。丸の直径＋丸と丸のあいだ＝当たり判定に隙間ができない幅にする
           （押し損ねが起きないように。QAの隠し操作もこの幅で拾う）。 */
        .hi-color-slot {
          position: absolute;
          left: 50%;
          top: 0;
          height: 100%;
          width: 72px;
          width: calc(clamp(44px, 17cqh, 56px) + ${STRIP_GAP}px);
        }
        /* 色の丸の直径。44px を下限に、帯の高さに余裕があれば 56px まで戻る。
           2段構え：①どのエンジンでも通る素の値 ②帯の高さ基準のcqhの式（後勝ち）。 */
        .hi-color-circle {
          width: 56px;
          width: clamp(44px, 17cqh, 56px);
          height: 56px;
          height: clamp(44px, 17cqh, 56px);
        }
        /* スペシャル回の主役1人ぶんの丸（通常より大きめの56〜72px）。 */
        .hi-color-circle-event {
          width: 56px;
          width: clamp(56px, 10dvh, 72px);
          width: clamp(44px, 15cqh, 72px);
          height: 56px;
          height: clamp(56px, 10dvh, 72px);
          height: clamp(44px, 15cqh, 72px);
        }

        /* ここから追加：タイトル周り〜リンク行の上下の余白と行の高さ（line-height）も帯の高さに
           合わせて詰める。フォールバック→cqh の2段構え。line-height の下限は1.2em＝文字が
           上下で切れない目安（FaIcon/絵文字/日本語とも、行の高さが文字サイズの1.2倍を割らなければ欠けない）。
           フォールバック値の1.45は、日本語混在時にNoto Sans JPのnormalが1.2よりかなり大きく
           出ることがあるための仮置き（Latin主体の要素は実際はもっと1.2寄りになる想定）。 */
        .hi-subtitle {
          margin: 0.3rem 0 0;
          margin: clamp(0.15rem, 2cqh, 0.3rem) 0 0;
          line-height: 1.45;
          line-height: clamp(1.2em, 6cqh, 1.45em);
        }
        .hi-special-subtitle {
          margin: 0.25rem 0 0;
          margin: clamp(0.15rem, 2cqh, 0.25rem) 0 0;
          line-height: 1.45;
          line-height: clamp(1.2em, 6cqh, 1.45em);
        }
        .hi-color-intro {
          margin: 0 0 1rem;
          margin: 0 0 clamp(0.3rem, 4cqh, 1rem);
          line-height: 1.45;
          line-height: clamp(1.2em, 6cqh, 1.45em);
        }
        .hi-color-intro-landscape {
          margin: 0 0 0.6rem;
          margin: 0 0 clamp(0.3rem, 3cqh, 0.6rem);
          line-height: 1.45;
          line-height: clamp(1.2em, 6cqh, 1.45em);
        }
        .hi-invite {
          margin: 0.6rem 0 0;
          margin: clamp(0.25rem, 3cqh, 0.6rem) 0 0;
          line-height: 1.5;
          line-height: clamp(1.2em, 6cqh, 1.5em);
        }
        .hi-links-row {
          margin-top: 0.6rem;
          margin-top: clamp(0.25rem, 3cqh, 0.6rem);
        }
        .hi-advanced-btn {
          padding: 0.4rem;
          padding: clamp(0.15rem, 2cqh, 0.4rem);
        }
        .hi-links-text {
          line-height: 1.45;
          line-height: clamp(1.2em, 6cqh, 1.45em);
        }
      `}</style>

      {/* 縦画面はここから下、今まで通り。横画面はレイアウトそのものが別物なので、
          後ろの isLandscape ブロックへ丸ごと分けた（このブロックは縦の時しか描かれない）。 */}
      {!isLandscape && (
      <div
        className="hi-entry-scroll"
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          minHeight: 0,
          overflowX: "hidden",
          overflowY: "auto",
          overscrollBehavior: "contain",
        }}
      >
        {/* 中身の箱。minHeight:100% で「最低でも帯いっぱい」を確保しつつ、中身が収まりきらない
            端末だけ自然に content の高さぶん伸びる（＝なぞる器がその差だけスクロール可能になる）。
            ✋は絶対配置で中に居座るだけなので、この伸び縮みには参加しない＝伸びても✋の見え方は
            変わらない。overflow:clip がこの箱の矩形ぴったりで✋と中身の両方を切る。 */}
        <div
          className={`hi-entry-inner ${isLandscape ? "hi-entry-pad-landscape" : "hi-entry-pad"}`}
          style={{
            minHeight: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            color: "#e8eaed",
            fontFamily: "Inter, 'Noto Sans JP', sans-serif",
            isolation: "isolate", // ✋モチーフ(zIndex:-1)を背景の前・全コンテンツの背面に固定する
          }}
        >
          {/* タイトル行：見出しと設定の歯車を同じ行に。歯車は動画の上ではなくこの帯の中に置く。 */}
          <div
            style={{
              position: "relative",
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <h1
              style={{
                fontSize: "clamp(1.3rem, 6.5vw, 1.6rem)",
                fontWeight: 700,
                letterSpacing: "-0.02em",
                margin: 0,
                textAlign: "center",
                color: "#f5f7fa",
                lineHeight: 1.2,
              }}
            >
              ハイ！テンション
            </h1>
            {onOpenSettings && (
              <button
                type="button"
                aria-label="表示設定"
                onClick={onOpenSettings}
                style={{
                  position: "absolute",
                  right: 0,
                  background: "none",
                  border: "none",
                  fontSize: "1.25rem",
                  lineHeight: 1,
                  color: "#9aa0a6",
                  cursor: "pointer",
                  padding: "0.3rem",
                }}
              >
                ⚙
              </button>
            )}
          </div>

          <p
            className="hi-subtitle"
            style={{
              // 元は 0.8125rem(13px)。帯全体の「14px以上」ルールに合わせて引き上げ。
              fontSize: "0.875rem",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textAlign: "center",
              color: "#aab0b6",
            }}
          >
            ✋ Practice ver.
          </p>
          {/* 副題の行は通常/スペシャルで常に確保（高さ固定）＝切替時に背景✋が上下しない。
              以前は minHeight で固定していたが、line-height を帯の高さに合わせて詰める今回、
              この行にも同じ line-height を適用すれば（中身が空文字でも1行ぶんの高さは残るため）
              通常/スペシャルで常に同じ高さになる＝minHeight を持たせなくても崩れない。
              元は 0.75rem(12px)。文言・色の決まりは MemberSelect と同じ、フォントサイズだけ14px以上に引き上げ。 */}
          <p
            className="hi-special-subtitle"
            style={{
              fontSize: "0.875rem",
              fontWeight: 700,
              letterSpacing: "0.02em",
              textAlign: "center",
              color: eventColor ?? "#777",
            }}
          >
            {isSpecial ? `〜${selectedEvent.title}〜` : ""}
          </p>

          {/* 中央：背景の✋モチーフに重ねて、色選択を縦中央に置く。 */}
          <div
            style={{
              flex: 1,
              width: "100%",
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* 背景に画面いっぱいの✋（このツールの核アイコン）。選んだ色で着色して「自分の色の手」を示唆。
                色の丸を押すたび key が変わって再マウント→小さく跳ねる演出が走る。
                大きさ・位置は変えない（オーナー指定）。はみ出しは外側の .hi-entry-inner が切る。 */}
            <div
              key={popTick}
              aria-hidden
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                // 暗背景では色を「重ねる」とくすむので screen 合成で「足して光らせる」。
                // 選んだ色がダークアリーナにそのまま発色する（hop指定: 鮮やかに）。
                mixBlendMode: "screen",
                opacity: selectedColor ? 0.7 : 0.13,
                pointerEvents: "none",
                zIndex: -1,
                animation: "hi-tension-hand-pop 0.42s cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            >
              <HandIcon size="min(122vw, 84vh)" color={selectedColor ?? (isSpecial && eventColor ? eventColor : "#cfd6de")} />
            </div>

            <p
              className={isLandscape ? "hi-color-intro-landscape" : "hi-color-intro"}
              style={{
                fontSize: "0.95rem",
                fontWeight: 500,
                textAlign: "center",
                color: "#c6ccd2",
                position: "relative",
                zIndex: 1,
              }}
            >
              {isSpecial ? "好きな色だよね？" : "好きな色は？"}
            </p>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: "100%",
                // 横向きは列を広く見せる（丸がもっと多く見える）
                maxWidth: isLandscape ? 560 : 360,
                position: "relative",
                zIndex: 1,
              }}
            >
            {isSpecial ? (
              // スペシャル回は色選択をまとめる：主役1人として参加（memberId=主役のid）。通常は選んだ色のメンバー。
              // タップで背景✋がポップ（通常の色選び直しと同じ手触り）。選択自体はスペシャル回で固定済みなので
              // onPickColor は呼ばない（MemberSelect と同じ挙動）。ダイヤルは出さない（1色しかないため）。
              <div style={{ display: "flex", justifyContent: "center" }}>
                <button
                  type="button"
                  aria-label="主役の色"
                  onClick={() => setPopTick((t) => t + 1)}
                  className="hi-color-circle-event"
                  style={{
                    borderRadius: "50%",
                    background: eventColor ?? "#000",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    boxShadow: `0 0 0 3px #f8f9fa, 0 0 0 5px ${eventColor ?? "#000"}`,
                  }}
                />
              </div>
            ) : (
              // 普段の日：色の丸を横一列に並べたダイヤル。指で横に送ると端でつながって回り続け、
              // 真ん中に来た色が選ばれる。丸は色の数だけ置いたきりで、位置・大きさ・輪は paint() が
              // 直に書き込む（指を動かすたびに React が組み直すと引っかかるため）。
              <div
                ref={stripRef}
                className="hi-color-strip"
                onPointerDown={(e) => beginDrag(e, null)}
                onPointerMove={handleMove}
                onPointerUp={(e) => endDrag(true, e)}
                onPointerCancel={(e) => endDrag(false, e)}
                onLostPointerCapture={(e) => endDrag(false, e)}
                onContextMenu={(e) => e.preventDefault()}
                style={{
                  // 列の上で指を縦に動かしても帯や画面が動かないように、この器では
                  // ブラウザ側のスクロールを一切起こさせない（位置は指の動きから自前で計算する）。
                  touchAction: "none",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  WebkitTouchCallout: "none",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {colors.map((m, i) => (
                  <button
                    key={m.id}
                    ref={(el) => { itemsRef.current[i] = el; }}
                    type="button"
                    aria-label={`color ${m.color}`}
                    aria-pressed={m.id === initialId}
                    className="hi-color-slot"
                    onPointerDown={(e) => { e.stopPropagation(); beginDrag(e, i); }}
                    onFocus={() => handleFocusItem(i)}
                    // 指・マウスの押しは pointer の側で拾うので、ここで拾うのはキーボード
                    // （Enter / Space）で押された時だけ（detail===0）。二重に選ばれないように。
                    onClick={(e) => { if (e.detail === 0) pickItem(i); }}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      touchAction: "none",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    <span
                      className="hi-color-circle"
                      style={{ display: "block", borderRadius: "50%", background: m.color }}
                    />
                  </button>
                ))}
              </div>
            )}
            </div>
          </div>

          {/* 誘いの一言。ボタンには見せない＝箱・下線・cursor:pointer・onClick を持たせない素の文。
              押しても何も起きない（始まるのは動画側の再生ボタンから）。 */}
          <p
            className="hi-invite"
            style={{
              fontSize: "1rem", // 16px以上
              fontWeight: 700,
              textAlign: "center",
              color: "#f5f7fa",
              position: "relative",
              zIndex: 1,
            }}
          >
            {selectedEvent?.enterLabel ?? "みんな、幸せになりたいか～！？"}
          </p>

          {/* 公式動画リンクと、上級編（振り練習）へのアイコンを同じ行に並べる。
              見た目（アイコン単体の控えめなボタン、リンクの下線）は元のまま、位置だけ同じ行へ寄せた。 */}
          <div
            className="hi-links-row"
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: "0.6rem",
              flexWrap: "wrap",
            }}
          >
            {onOpenAdvanced && (
              <button
                type="button"
                aria-label="上級編へ"
                onClick={onOpenAdvanced}
                className="hi-advanced-btn"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  opacity: 0.85,
                  display: "inline-flex",
                }}
              >
                <FaIcon icon={faHandPointer} size={26} color="#9aa0a6" />
              </button>
            )}
            <div
              className="hi-links-text"
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "0.55rem",
                flexWrap: "wrap",
                // 元は 0.6875rem(11px)。帯全体の「14px以上」ルールに合わせて引き上げ。
                fontSize: "0.875rem",
                color: "#9aa0a6",
              }}
            >
              <span>公式動画</span>
              {PRACTICE_VIDEOS.map((v) => (
                <a
                  key={v.id}
                  href={`https://youtu.be/${v.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#9aa0a6", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: "0.2rem" }}
                >
                  ▶ {v.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
      )}

      {/* ---- ここから横画面専用レイアウト（2026-09-22 案2で確定）----
          動画の器は画面上部に固定のまま動かさない前提なので、その左右に空く帯へ
          タイトル・公式動画リンク等を振り分け、動画の下の帯は色えらびだけにする。
          動画に重なる要素は無い（左右の帯は動画の幅ぶん内側に入り込まない計算、
          下の帯は動画の下端より下だけ）。
          左右の帯の幅は「(画面の横幅－動画の幅)÷2－動画との間の8px」。動画の幅の式は
          HiTensionPage 側の動画 style（width: min(94vw, calc(60dvh*16/9))）と同じものを使う
          ＝ここか向こうのどちらかだけ変えると帯と動画がずれるので、直す時は両方合わせる。
          見本: hi-landscape-entry-samples.html の案2（下の帯だけ、実物に合わせて画面幅のまま
          にしてある＝見本では動画幅に絞っていたが、ダイヤルの見える丸の数を減らさないため）。
          コンポーネントの上のほうにある stripRef・itemsRef 等のダイヤル用の仕組みは、
          縦画面のダイヤルとまったく同じものをそのままここでも使っている（二重に動かない
          よう、縦と横のどちらか片方しか描かれない＝早期リターンではなく isLandscape の
          分岐で切り替えているのはそのため）。 */}
      {isLandscape && (() => {
        // 帯1本ぶんの幅。動画の幅の式は上のコメント参照。8px は動画との最低の間。
        const sideColW = "calc((100vw - min(94vw, calc(60dvh * 16 / 9))) / 2 - 8px)";
        // 下の帯の開始位置。渡されていない場合（呼び出し側の不備）は 0 にして、
        // 少なくとも画面から消えたりはしないようにする。
        const bandTop = landscapeVideoBottom ?? "0";
        return (
          <>
            {/* 左の帯：タイトル〜誘いの一言を縦中央に積む。画面の上から下まで確保するが、
                中身は少ないので実際にはだいたい真ん中に収まる（入り切らない端末だけ
                この帯の中で見えなくなる＝動画側へはみ出したり帯からはみ出たりはしない）。 */}
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: sideColW,
                overflow: "hidden",
                boxSizing: "border-box",
                padding: "0 0.3rem",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.35rem",
                color: "#e8eaed",
                fontFamily: "Inter, 'Noto Sans JP', sans-serif",
              }}
            >
              <h1
                style={{
                  fontSize: "clamp(0.875rem, 5vw, 1.25rem)", // 14px〜20px。帯に入らない端末だけ縮む
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  margin: 0,
                  textAlign: "center",
                  color: "#f5f7fa",
                  lineHeight: 1.2,
                }}
              >
                {/* 「ハイ！」の直後だけ折り返し可（wbr）。各語は nowrap にして語の途中では
                    絶対に割れないようにする＝「テンショ／ン」のような1文字だけ落ちる折れ方を防ぐ。 */}
                <span style={{ display: "inline-block", whiteSpace: "nowrap" }}>ハイ！</span>
                <wbr />
                <span style={{ display: "inline-block", whiteSpace: "nowrap" }}>テンション</span>
              </h1>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.875rem", // 14px
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textAlign: "center",
                  color: "#aab0b6",
                }}
              >
                ✋ Practice ver.
              </p>
              {/* 副題はスペシャル回の時だけ出す。左の帯は縦中央寄せなので、無い日は残りが詰まって中央に寄る。 */}
              {isSpecial && (
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.875rem", // 14px
                    fontWeight: 700,
                    letterSpacing: "0.02em",
                    textAlign: "center",
                    color: eventColor ?? "#777",
                  }}
                >
                  {`〜${selectedEvent.title}〜`}
                </p>
              )}
              {/* 誘いの一言。縦画面と同じくボタンには見せない（箱・下線・cursor:pointer なし）。
                  押しても何も起きない（始まるのは動画側の再生ボタンから）。 */}
              <p
                style={{
                  margin: 0,
                  fontSize: "1rem", // 16px
                  fontWeight: 700,
                  textAlign: "center",
                  color: "#f5f7fa",
                }}
              >
                {selectedEvent?.enterLabel ?? "みんな、幸せになりたいか～！？"}
              </p>
            </div>

            {/* 右の帯：歯車は右上の隅、公式動画のかたまりは縦中央、👆はそこから
                リンク同士の行間（0.3rem）の3倍ぶん離して下に置く＝別物だと分かる間を空ける。 */}
            <div
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: sideColW,
                overflow: "hidden",
                boxSizing: "border-box",
                padding: "0 0.3rem",
              }}
            >
              {onOpenSettings && (
                <button
                  type="button"
                  aria-label="表示設定"
                  onClick={onOpenSettings}
                  style={{
                    position: "absolute",
                    top: "0.2rem",
                    right: "0.2rem",
                    background: "none",
                    border: "none",
                    fontSize: "1.25rem",
                    lineHeight: 1,
                    color: "#9aa0a6",
                    cursor: "pointer",
                    padding: "0.3rem",
                  }}
                >
                  ⚙
                </button>
              )}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "0.3rem", // リンク同士の行間。👆まではこの3倍（0.9rem）空ける
                    fontSize: "0.875rem", // 14px
                    color: "#9aa0a6",
                    textAlign: "center",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>公式動画</span>
                  {PRACTICE_VIDEOS.map((v) => (
                    <a
                      key={v.id}
                      href={`https://youtu.be/${v.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#9aa0a6", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: "0.2rem" }}
                    >
                      ▶ {v.label}
                    </a>
                  ))}
                </div>
                {onOpenAdvanced && (
                  <button
                    type="button"
                    aria-label="上級編へ"
                    onClick={onOpenAdvanced}
                    style={{
                      marginTop: "0.9rem", // 公式動画のかたまりとは別物だと分かる間（行間0.3remの3倍）
                      minWidth: 44,
                      minHeight: 44,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      opacity: 0.85,
                    }}
                  >
                    <FaIcon icon={faHandPointer} size={26} color="#9aa0a6" />
                  </button>
                )}
              </div>
            </div>

            {/* 下の帯：動画の下端〜画面の下端。動画の幅ではなく画面の幅のまま（今までの帯と同じ）。
                タイトル・リンクは左右の帯へ引っ越したので、ここは背景✋と色えらびだけ。 */}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: bandTop,
                bottom: 0,
                overflow: "hidden", // ✋のはみ出しをここで切る（見え方自体は変えない・今までの帯の枠と同じ）
                isolation: "isolate", // ✋(zIndex:-1)をこの帯の中だけで背面に固定する
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {/* 背景の✋モチーフ。大きさ・不透明度・合成方法は縦画面とまったく同じ値のまま
                  （オーナー指定：小さくしない・動かさない）。帯の外へ出た分はこの枠が切るだけ。 */}
              <div
                key={popTick}
                aria-hidden
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  mixBlendMode: "screen",
                  opacity: selectedColor ? 0.7 : 0.13,
                  pointerEvents: "none",
                  zIndex: -1,
                  animation: "hi-tension-hand-pop 0.42s cubic-bezier(0.34, 1.56, 0.64, 1)",
                }}
              >
                <HandIcon size="min(122vw, 84vh)" color={selectedColor ?? (isSpecial && eventColor ? eventColor : "#cfd6de")} />
              </div>

              <p
                style={{
                  margin: "0 0 0.4rem",
                  fontSize: "0.95rem", // 15.2px
                  fontWeight: 500,
                  textAlign: "center",
                  color: "#c6ccd2",
                  position: "relative",
                  zIndex: 1,
                }}
              >
                {isSpecial ? "好きな色だよね？" : "好きな色は？"}
              </p>

              <div style={{ width: "100%", maxWidth: 560, position: "relative", zIndex: 1 }}>
                {isSpecial ? (
                  // スペシャル回はダイヤルを出さず主役1人の丸だけ（縦画面と同じ挙動）。
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <button
                      type="button"
                      aria-label="主役の色"
                      onClick={() => setPopTick((t) => t + 1)}
                      className="hi-color-circle-event"
                      style={{
                        borderRadius: "50%",
                        background: eventColor ?? "#000",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        boxShadow: `0 0 0 3px #f8f9fa, 0 0 0 5px ${eventColor ?? "#000"}`,
                      }}
                    />
                  </div>
                ) : (
                  // 普段の日の横一列ダイヤル。仕組み・イベントハンドラは縦画面と完全に同じもの
                  // （stripRef 等は共有の ref なので、縦横どちらか一方しか描かれない前提が壊れると壊れる）。
                  <div
                    ref={stripRef}
                    className="hi-color-strip"
                    onPointerDown={(e) => beginDrag(e, null)}
                    onPointerMove={handleMove}
                    onPointerUp={(e) => endDrag(true, e)}
                    onPointerCancel={(e) => endDrag(false, e)}
                    onLostPointerCapture={(e) => endDrag(false, e)}
                    onContextMenu={(e) => e.preventDefault()}
                    style={{
                      touchAction: "none",
                      userSelect: "none",
                      WebkitUserSelect: "none",
                      WebkitTouchCallout: "none",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {colors.map((m, i) => (
                      <button
                        key={m.id}
                        ref={(el) => { itemsRef.current[i] = el; }}
                        type="button"
                        aria-label={`color ${m.color}`}
                        aria-pressed={m.id === initialId}
                        className="hi-color-slot"
                        onPointerDown={(e) => { e.stopPropagation(); beginDrag(e, i); }}
                        onFocus={() => handleFocusItem(i)}
                        onClick={(e) => { if (e.detail === 0) pickItem(i); }}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          touchAction: "none",
                          WebkitTapHighlightColor: "transparent",
                        }}
                      >
                        <span
                          className="hi-color-circle"
                          style={{ display: "block", borderRadius: "50%", background: m.color }}
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        );
      })()}

      {/* 版の札。分岐プレビュー・手元だけ右下に出す（本番には出ない）。
          なぞる中身(.hi-entry-inner)の外＝帯の器（HiTensionPage 側の入口コンテナ）を基準にした
          position:absolute。なぞる中身が縦にスクロールしても、この札は帯の右下すみに固定されたまま動かない。 */}
      {__SHOW_VERSION__ && (
        <span
          style={{
            position: "absolute",
            bottom: 4,
            right: 8,
            fontSize: "0.5rem",
            color: "#c6c6c6",
            letterSpacing: "0.02em",
            pointerEvents: "none",
          }}
        >
          v.{__COMMIT_SHA__}
        </span>
      )}
    </>
  );
}
