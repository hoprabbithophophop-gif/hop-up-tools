// 画面下の「一列でループする💎ボタンの帯」（Hop決定 2026-09-07）。
//
// メンバーの色で塗った💎の絵が横一列に並び、真ん中の1つだけが大きい。左右へ離れるほど小さく・暗くなる。
// 丸い下地も輪も付けず、💎の絵そのものを並べる（入口の大きな💎と揃える・Hop指示 2026-09-07）。
// 横にスワイプすると帯が流れ、指を離すと一番近い色が真ん中に吸い付く。速く払えば勢いのぶん数個先まで
// 進んでから減速して止まる。端まで行くと先頭に戻って無限に回る。
// 真ん中を押すと💎が1つ降り、真ん中以外を押すとその色が真ん中に来る（💎は降らない）。
//
// ループのやり方: 並びを何周ぶんも並べるのではなく、「真ん中の位置」を小数の目盛り offset で持つ。
// 💎の絵は色の数だけ最初に1つずつ置いておき（並べ替えも作り直しもしない）、それぞれが真ん中から
// 何個ぶん離れているかを、色の数で割った近い方の回り方で毎回計算して置き直す。目盛りがいくら進んでも
// 一周ぶんの中に収まるので継ぎ目が無い。窓（WINDOW）より外に行った💎は透明になって消える。
//
// 滑らかさのための決めごと（Hop報告「指でスライドすると引っかかる」2026-09-07 の直し）:
//  ・指を追っている間と、離れた後に滑っている間は、React に描き直しを頼まない。💎の要素の
//    transform と opacity を直に書き換えるだけにする。指の動き1回ごとに React が11個のボタンと
//    その中の絵を組み直していたのが引っかかりの正体だった（実測: CPU を4倍重くした状態で、
//    1コマ 20ms 超えが3割。重りを付けない机上のブラウザでは元のままでも間に合っていた）。
//  ・そのため、動きに関わる見た目（位置・大きさ・薄さ・重なりの順・脈打ち）は JSX に書かず、
//    すべて paint() の中だけで触る。JSX にも書くと、React の描き直しの時に取り合いになって戻される。
//  ・💎の大きさは要素の幅ではなく transform の scale で変える。幅を変えると毎コマ組み直しが起きる。
//    scale は当たり判定にも効くので、押せる範囲は見えている大きさのまま。
//
// スクロールの仕組み（CSS の scroll-snap）はあえて使っていない。継ぎ目で位置を戻す細工が要るうえ、
// iOS Safari では戻した瞬間に見た目が飛ぶことがあるため、指の動きから自前で位置を計算している。
import { memo, useCallback, useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { faGem } from "@fortawesome/free-solid-svg-icons";
import FaIcon from "../hi-tension/components/FaIcon";

/** 誘いの光沢: 💎の形（Font Awesome の gem の輪郭）で切り抜くための型紙 */
const GEM_MASK = (() => {
  const [w, h, , , pathData] = faGem.icon;
  const d = Array.isArray(pathData) ? pathData.join(" ") : pathData;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="#000"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
})();
/** 誘いの光沢: 太い斜線と細い斜線を1本ずつ（角度・太さ・明るさは【仮】） */
const SHINE_STRIPES =
  "linear-gradient(115deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.75) 38%, rgba(255,255,255,0.75) 46%, rgba(255,255,255,0) 50%, rgba(255,255,255,0) 56%, rgba(255,255,255,0.55) 58%, rgba(255,255,255,0.55) 61%, rgba(255,255,255,0) 65%)";
/** 真ん中の💎の大きさ(px)【仮】。幅390の画面で7個が丸ごと見え、両端に次の色が覗く寸法（Hop指示 2026-09-07） */
const CENTER_SIZE = 76;
/** 真ん中から数えて1つ目・2つ目・3つ目以降の💎の大きさ(px)【仮】 */
const STEP_SIZES = [CENTER_SIZE, 46, 38, 34] as const;
/** 💎同士のあいだの隙間(px)【仮】 */
const GAP = 6;
/** 真ん中の左右に何個ずつ見せるか。これより外は透明にする */
const WINDOW = 5;
/** 帯の器の高さ(px)【仮】。真ん中の💎と、そのまわりに広がる光のぶん */
const BAND_HEIGHT = 96;
/** これだけ指が動いたらスワイプ扱いにして、ボタンの押し（色えらび）を取り消す(px)【仮】 */
const DRAG_THRESHOLD = 8;
/** 指を離してから一番近い色が真ん中に収まるまでの時間(ms)【仮】。勢いが無かった時に使う */
const SNAP_MS = 220;
/** 勢いを付けて滑る時の、いちばん短い／長い時間(ms)【仮】。急に止まる・だらだら続くのを防ぐ */
const GLIDE_MIN_MS = 160;
const GLIDE_MAX_MS = 900;
/** 指の速さを測る窓(ms)【仮】。これより古い動きは勢いの計算に入れない */
const VELOCITY_WINDOW_MS = 100;
/** 指が止まってからこれ以上経って離した場合は、勢い無し＝一番近い色へ吸い付くだけにする(ms)【仮】 */
const VELOCITY_STALE_MS = 100;
/** 指の速さから「この先どこまで滑るか」を見積もる時間(ms)【仮】。速さ×この時間ぶん先を行き先にする */
const GLIDE_PROJECTION_MS = 100;
/** 1回のスワイプで進める上限（個）【仮】。速く払っても行き過ぎないための蓋 */
const GLIDE_MAX_STEPS = 6;
/** 誘いの輪が1回広がって消えるまでの秒数【仮】。今までの💎ボタンと同じ */
const INVITE_PULSE_SECONDS = 1.6;
/** 真ん中以外をどれだけ暗くするか【仮】。1.0＝そのまま */
const CENTER_OPACITY = 1;
const SIDE_OPACITY = 0.7;
/** 押された💎を少し縮めて手応えを出す倍率【仮】 */
const PRESS_SCALE = 0.92;
/** 帯の裏に敷く暗い下地【仮】。積もった💎の山に重なっても💎の列が読めるように（Hop指示 2026-09-07）。
 *  終了画面の帯（rgba(7,8,12,0.72)）と同じ色味で、こちらは常時出るぶん少し薄い */
const BAND_BG = "rgba(7,8,12,0.42)";   // 山が向こうに見える程度の薄さ（Hop指摘 2026-09-08: 幅も濃さも取りすぎ）【仮】
/** 下地の上下の縁を透明へぼかす幅(px)【仮】。真四角の板に見えないよう背景へ溶かす */
const BAND_FADE = 10;
/** 下地の高さは💎の列にぴったり寄せる。真ん中の💎の上下にこれだけ足した高さ【仮】 */
const BAND_PAD = 6;
/** 下地の裏をぼかす強さ(px)【仮】。対応していない環境では暗い下地だけが残る */
const BAND_BLUR = 2;

export interface DiamondColorOption {
  id: string;
  color: string;
}

interface Props {
  /** 帯に並べる色。この並びの順にループする */
  options: readonly DiamondColorOption[];
  /** いま真ん中にある色（メンバーID） */
  selectedId: string;
  /** 真ん中に来た色が変わった時に呼ぶ */
  onSelect: (id: string) => void;
  /** 真ん中の💎を押した時に呼ぶ。true を返したら押せたものとして扱う。
   *  渡さなければ「押しても💎は降らない」帯になる（曲のあとの見返し中） */
  onRecord?: () => boolean;
  /** 真ん中を触れた瞬間に降らせた💎を取り消す。指が滑ってスワイプになった時に呼ぶ（Hop指摘 2026-09-08: スライドしただけで降るのは早すぎる） */
  onRecordCancel?: () => void;
  /** まだ一度も押されていない間、真ん中の💎のまわりの光をゆっくり脈打たせて押すよう誘う */
  inviting?: boolean;
  /** 動き軽減：脈打ちと吸い付きの動きを止める */
  reduceMotion?: boolean;
  /** 一時停止中など、帯を薄く見せて真ん中を押しても💎を降らせないようにする（色えらびのスワイプはできたまま）（Hop決定 2026-09-08） */
  disabled?: boolean;
}

/** 真ん中から d 個ぶん離れた場所の💎の大きさ(px)。整数と整数のあいだはなめらかに繋ぐ */
function sizeAt(d: number): number {
  const a = Math.abs(d);
  if (a >= STEP_SIZES.length - 1) return STEP_SIZES[STEP_SIZES.length - 1];
  const i = Math.floor(a);
  const f = a - i;
  return STEP_SIZES[i] + (STEP_SIZES[i + 1] - STEP_SIZES[i]) * f;
}

/** 真ん中から k 個目（整数）の💎の中心が、真ん中から何px離れるか。
 *  隣り合う💎の半分の大きさの合計＋隙間を足していった表。大きさが場所ごとに違うので足し算で作る */
const CENTER_X: number[] = (() => {
  const xs = [0];
  for (let k = 1; k <= WINDOW + 1; k++) {
    xs[k] = xs[k - 1] + (sizeAt(k - 1) + sizeAt(k)) / 2 + GAP;
  }
  return xs;
})();

/** 真ん中から d 個ぶん離れた場所の中心の横位置(px)。表のあいだは直線で繋ぐ */
function xAt(d: number): number {
  const s = Math.sign(d);
  const a = Math.abs(d);
  const last = CENTER_X.length - 1;
  if (a >= last) return s * (CENTER_X[last] + (a - last) * (sizeAt(last) + GAP));
  const i = Math.floor(a);
  const f = a - i;
  return s * (CENTER_X[i] + (CENTER_X[i + 1] - CENTER_X[i]) * f);
}

/** xAt の逆引き。指を px 動かしたぶんが、目盛りで何個ぶんに当たるかを返す＝
 *  真ん中にあったボタンが指にそのまま付いてくるようにするための換算 */
function indexAtX(px: number): number {
  const s = Math.sign(px);
  const a = Math.abs(px);
  const last = CENTER_X.length - 1;
  if (a >= CENTER_X[last]) return s * (last + (a - CENTER_X[last]) / (sizeAt(last) + GAP));
  for (let k = 1; k <= last; k++) {
    if (a <= CENTER_X[k]) {
      const span = CENTER_X[k] - CENTER_X[k - 1];
      return s * (k - 1 + (a - CENTER_X[k - 1]) / span);
    }
  }
  return 0;
}

/** 差 d を「一周のうち近い方の回り方」に直す。例: 14色で 12 個先は、逆回りで 2 個手前 */
function wrapDelta(d: number, n: number): number {
  const x = ((d % n) + n) % n;
  return x > n / 2 ? x - n : x;
}

/** 目盛りを 0 以上 n 未満に収める */
function wrapIndex(v: number, n: number): number {
  return ((v % n) + n) % n;
}

const DiamondColorCarousel = memo(function DiamondColorCarousel({
  options,
  selectedId,
  onSelect,
  onRecord,
  onRecordCancel,
  inviting = false,
  reduceMotion = false,
  disabled = false,
}: Props) {
  const n = options.length;
  const containerRef = useRef<HTMLDivElement>(null);
  /** 💎の要素の控え。色の並び順にそのまま入れる（並べ替えないので番号＝色の番号） */
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  /** 前回書き込んだ見た目。同じ値なら書き込まない＝無駄な書き換えを減らす */
  const paintedRef = useRef<{ t: string; o: string; z: string; anim: string; v: string }[]>([]);
  /** 真ん中に来ている位置。整数なら色がぴたりと真ん中、小数はその途中。
   *  指を追っている間も滑っている間もこの値だけを動かし、画面へは paint() で直に書き込む */
  const offsetRef = useRef(Math.max(0, options.findIndex((o) => o.id === selectedId)));
  /** 吸い付きの行き先。途中の色を「選ばれた」と誤解しないよう、外との突き合わせはこの値で見る */
  const targetIndexRef = useRef(offsetRef.current);
  /** 指の情報。null なら触っていない。anchorX は「スワイプと認めた地点」で、ここからの差分で帯を動かす */
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; anchorX: number; startOffset: number; item: number | null; moved: boolean; recorded: boolean } | null>(null);
  /** 指の速さを測るための、直前の動きの控え（時刻と目盛り） */
  const samplesRef = useRef<{ t: number; o: number }[]>([]);
  /** 押されている見た目にする💎（色の番号）。null なら誰も押されていない */
  const pressedRef = useRef<number | null>(null);
  const animRef = useRef<number | null>(null);
  /** 脈打ちの誘いを出すか。paint() から読むので控えにも置く */
  const invitingRef = useRef(inviting);
  const reduceMotionRef = useRef(reduceMotion);
  /** 一時停止中かどうか。beginDrag は memo 化された関数なので、最新の値をこの控えから読む */
  const disabledRef = useRef(disabled);
  invitingRef.current = inviting;
  reduceMotionRef.current = reduceMotion;
  disabledRef.current = disabled;

  /** いまの目盛りから、💎の位置・大きさ・薄さを画面へ直に書き込む。
   *  React を通さないので、指を動かしている間も要素を作り直さずに済む */
  const paint = useCallback(() => {
    const off = offsetRef.current;
    const half = Math.min(WINDOW, Math.floor((n - 1) / 2));
    const base = wrapIndex(Math.round(off), n);
    const pressed = pressedRef.current;
    const pulse = invitingRef.current && !reduceMotionRef.current;
    for (let i = 0; i < n; i++) {
      const el = itemsRef.current[i];
      if (!el) continue;
      const d = wrapDelta(i - off, n);
      const a = Math.abs(d);
      const isPressed = pressed === i;
      const scale = (sizeAt(d) / CENTER_SIZE) * (isPressed ? PRESS_SCALE : 1);
      const near = Math.min(a, 1);
      // 窓の外側は薄くして、色が出たり消えたりするのを目立たせない
      const edge = Math.max(0, Math.min(1, half - a));
      const t = `translate3d(${xAt(d).toFixed(2)}px, 0, 0) scale(${scale.toFixed(4)})`;
      const o = ((CENTER_OPACITY + (SIDE_OPACITY - CENTER_OPACITY) * near) * edge).toFixed(3);
      const z = i === base ? "2" : "1";
      void pulse;
      const anim = "none";   // 脈打ちは💎の絵ではなく、真ん中の裏に置いた輪（下の invite の要素）で出す
      // 透明になった💎は「無い」ことにする。置いたままだと、画面の広いPCでは
      // 帯の左右の何も無いところを押した時に見えない💎が反応してしまう
      const v = o === "0.000" ? "hidden" : "";
      const prev = paintedRef.current[i];
      if (!prev) paintedRef.current[i] = { t: "", o: "", z: "", anim: "", v: "" };
      const p = paintedRef.current[i];
      if (p.t !== t) { el.style.transform = t; p.t = t; }
      if (p.o !== o) { el.style.opacity = o; p.o = o; }
      if (p.v !== v) { el.style.visibility = v; p.v = v; }
      if (p.z !== z) { el.style.zIndex = z; el.setAttribute("data-diamond-center", i === base ? "true" : "false"); el.setAttribute("aria-pressed", i === base ? "true" : "false"); p.z = z; }
      if (p.anim !== anim) { el.style.animation = anim; p.anim = anim; }
    }
    containerRef.current?.setAttribute("data-center-id", options[base].id);
  }, [n, options]);

  // 描き直しのあと（最初に置かれた時も含む）に、いまの目盛りの見た目へ合わせ直す。
  // 位置や薄さは JSX に書いていないので、React の描き直しでは元に戻らない
  useLayoutEffect(paint);

  const idAt = useCallback((i: number) => options[wrapIndex(i, n)].id, [options, n]);

  const stopAnim = useCallback(() => {
    if (animRef.current != null) { cancelAnimationFrame(animRef.current); animRef.current = null; }
  }, []);

  /** 目盛りを行き先まで滑らせる。終わりに向かってなめらかに減速する。動き軽減なら一足飛び。
   *  ms を渡さなければ吸い付きの既定の速さ */
  const glideTo = useCallback((target: number, ms: number = SNAP_MS) => {
    stopAnim();
    targetIndexRef.current = wrapIndex(target, n);
    const from = offsetRef.current;
    const dist = target - from;
    if (reduceMotion || Math.abs(dist) < 0.001) {
      offsetRef.current = wrapIndex(target, n);
      paint();
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
        return;
      }
      offsetRef.current = from + dist * e;
      paint();
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  }, [n, paint, reduceMotion, stopAnim]);

  useEffect(() => stopAnim, [stopAnim]);

  // 外から色が変えられた時（前回の色の読み込み、見返し中に飛び先が無くて選択が戻された時など）に
  // 帯の位置を合わせ直す。途中の色ではなく「行き先」と見比べるので、滑っている最中に横取りされない
  useEffect(() => {
    if (dragRef.current) return;
    const want = options.findIndex((o) => o.id === selectedId);
    if (want < 0) return;
    const cur = targetIndexRef.current;
    if (Math.abs(cur - want) < 0.001) return;
    // 近い方の回り方で寄せる（端から端へ行くより先頭に戻った方が近いことがある）
    glideTo(cur + wrapDelta(want - cur, n));
  });

  /** 指を離した／取り上げられた時の共通の後片付け。iOS は画面の操作を横取りする時に
   *  pointercancel を送ってくるので、そこで片付けを忘れるとボタンが二度と押せなくなる */
  const endDrag = useCallback((commit: boolean, e?: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (e && e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    pressedRef.current = null;
    const base = Math.round(offsetRef.current);
    // 動かさずに真ん中以外を押した＝その色を真ん中に呼ぶ
    if (commit && !d.moved && d.item != null && d.item !== wrapIndex(base, n)) {
      glideTo(offsetRef.current + wrapDelta(d.item - offsetRef.current, n));
      onSelect(idAt(d.item));
      return;
    }
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
    glideTo(target, ms);
    if (idAt(target) !== selectedId) onSelect(idAt(target));
  }, [glideTo, idAt, n, onSelect, selectedId]);

  /** 指が触れた瞬間。真ん中の💎なら、指を離すのを待たずにここで💎を1つ降らせる */
  const beginDrag = useCallback((e: ReactPointerEvent<HTMLElement>, item: number | null) => {
    if (dragRef.current) return;
    stopAnim();
    containerRef.current?.setPointerCapture?.(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, anchorX: e.clientX, startOffset: offsetRef.current, item, moved: false, recorded: false };
    samplesRef.current = [];
    const base = wrapIndex(Math.round(offsetRef.current), n);
    if (item != null) {
      pressedRef.current = item;
      paint();
      if (item === base && onRecord && !disabledRef.current) dragRef.current.recorded = onRecord();
    }
  }, [n, onRecord, paint, stopAnim]);

  const handleMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      // ここを起点にする＝しきい値を越えた瞬間に帯が8pxぶん飛ばない
      d.anchorX = e.clientX;
      d.startOffset = offsetRef.current;
      if (pressedRef.current != null) { pressedRef.current = null; }   // 指がぶれた＝押しではなくスワイプ
      // 真ん中を触れた瞬間に降らせた分は取り消す（スワイプのつもりだった）
      if (d.recorded) { d.recorded = false; onRecordCancel?.(); }
    }
    offsetRef.current = d.startOffset - indexAtX(e.clientX - d.anchorX);
    // 指の速さを測るための控え。窓より古いものは捨てる
    const now = performance.now();
    const s = samplesRef.current;
    s.push({ t: now, o: offsetRef.current });
    while (s.length > 2 && now - s[0].t > VELOCITY_WINDOW_MS) s.shift();
    paint();
  }, [paint, onRecordCancel]);

  return (
    <div
      ref={containerRef}
      onPointerDown={(e) => beginDrag(e, null)}
      onPointerMove={handleMove}
      onPointerUp={(e) => endDrag(true, e)}
      onPointerCancel={(e) => endDrag(false, e)}
      onLostPointerCapture={(e) => endDrag(false, e)}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "relative",
        width: "100%",
        height: BAND_HEIGHT,
        // 一時停止中は帯全体を薄くして「押しても降らない」ことを見た目でも伝える（Hop決定 2026-09-08）
        opacity: disabled ? 0.4 : 1,
        touchAction: "none",       // 帯を横になぞってもページが動かないように
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",   // 長押しで iOS の吹き出しが出ないように
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {/* 誘いの脈打ち。丸い輪が無くなったので、💎の形に沿った光がまわりへ広がって消えるのを繰り返す【仮】 */}
      <style>{`
        @keyframes hai-to-diamond-band-invite {
          0%   { transform: translate3d(-100%, 0, 0); }
          55%  { transform: translate3d(100%, 0, 0); }
          100% { transform: translate3d(100%, 0, 0); }
        }
      `}</style>

      {/* 帯の裏の下地。積もった💎の山に💎の列が紛れないように敷く（Hop指示 2026-09-07）。
          上下の縁はグラデーションで透明にして、板が浮いて見えないよう背景へ溶かす */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "50%",
          height: CENTER_SIZE + BAND_PAD * 2,
          marginTop: -(CENTER_SIZE / 2 + BAND_PAD),
          zIndex: 0,
          background: BAND_BG,
          backdropFilter: `blur(${BAND_BLUR}px)`,
          WebkitBackdropFilter: `blur(${BAND_BLUR}px)`,
          maskImage: `linear-gradient(to bottom, transparent 0, #000 ${BAND_FADE}px, #000 calc(100% - ${BAND_FADE}px), transparent 100%)`,
          WebkitMaskImage: `linear-gradient(to bottom, transparent 0, #000 ${BAND_FADE}px, #000 calc(100% - ${BAND_FADE}px), transparent 100%)`,
          pointerEvents: "none",
        }}
      />

      {/* 💎は色の数だけ最初に置いたきり、並べ替えも作り直しもしない。
          動く見た目（位置・大きさ・薄さ・重なりの順・脈打ち）は paint() が直に書き込む */}
      {options.map((opt, i) => (
        <button
          key={opt.id}
          ref={(el) => { itemsRef.current[i] = el; }}
          type="button"
          aria-label={opt.id}
          data-diamond-color-id={opt.id}
          onPointerDown={(e) => { e.stopPropagation(); beginDrag(e, i); }}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: CENTER_SIZE,
            height: CENTER_SIZE,
            marginLeft: -CENTER_SIZE / 2,
            marginTop: -CENTER_SIZE / 2,
            willChange: "transform, opacity",
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
          {/* 積もった💎の山に重なっても輪郭が分かるよう、絵の形に沿った薄い暗い縁取りを敷く【仮】 */}
          <span style={{ display: "block", position: "relative", filter: "drop-shadow(0 0 2px rgba(0,0,0,0.75)) drop-shadow(0 2px 6px rgba(0,0,0,0.5))" }}>
            <FaIcon icon={faGem} size={CENTER_SIZE} color={opt.color} />
            {/* 初回タップまでの誘い: 太さの違う白い斜線2本が💎の上を左から右へ流れ、面が光を受けているように見せる
                （Hop指示 2026-09-08。💎の形で切り抜くので絵の外にはみ出さない）。選択中の💎にだけ出し、1回押したら消える */}
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
      ))}
    </div>
  );
});

export default DiamondColorCarousel;
