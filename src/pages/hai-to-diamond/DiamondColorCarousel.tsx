// 画面下の「一列でループする💎ボタンの帯」（Hop決定 2026-09-07）。
//
// メンバーの色で塗った💎の絵が横一列に並び、真ん中の1つだけが大きい。左右へ離れるほど小さく・暗くなる。
// 丸い下地も輪も付けず、💎の絵そのものを並べる（入口の大きな💎と揃える・Hop指示 2026-09-07）。
// 横にスワイプすると帯が流れ、指を離すと一番近い色が真ん中に吸い付く。端まで行くと先頭に戻って
// 無限に回る。真ん中を押すと💎が1つ降り、真ん中以外を押すとその色が真ん中に来る（💎は降らない）。
//
// ループのやり方: 並びを何周ぶんも並べるのではなく、「真ん中の位置」を小数の目盛り offset で持ち、
// その前後 WINDOW 個ぶんだけを毎回描き直している。何番目を描くかは色の数で割った余りで決めるので、
// 目盛りがいくら進んでも先頭に戻るだけ＝継ぎ目が無い。並びの本数より窓が狭いので同じ色は一度しか出ない。
//
// スクロールの仕組み（CSS の scroll-snap）はあえて使っていない。継ぎ目で位置を戻す細工が要るうえ、
// iOS Safari では戻した瞬間に見た目が飛ぶことがあるため、指の動きから自前で位置を計算している。
import { memo, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { faGem } from "@fortawesome/free-solid-svg-icons";
import FaIcon from "../hi-tension/components/FaIcon";

/** 真ん中の💎の大きさ(px)【仮】。幅390の画面で7個が丸ごと見え、両端に次の色が覗く寸法（Hop指示 2026-09-07） */
const CENTER_SIZE = 76;
/** 真ん中から数えて1つ目・2つ目・3つ目以降の💎の大きさ(px)【仮】 */
const STEP_SIZES = [CENTER_SIZE, 46, 38, 34] as const;
/** 💎同士のあいだの隙間(px)【仮】 */
const GAP = 6;
/** 真ん中の左右に何個ずつ描くか。色の数より狭くしないと同じ色が2つ出てしまう */
const WINDOW = 5;
/** 帯の器の高さ(px)【仮】。真ん中の💎と、そのまわりに広がる光のぶん */
const BAND_HEIGHT = 96;
/** これだけ指が動いたらスワイプ扱いにして、ボタンの押し（色えらび）を取り消す(px)【仮】 */
const DRAG_THRESHOLD = 8;
/** 指を離してから一番近い色が真ん中に収まるまでの時間(ms)【仮】 */
const SNAP_MS = 220;
/** 誘いの輪が1回広がって消えるまでの秒数【仮】。今までの💎ボタンと同じ */
const INVITE_PULSE_SECONDS = 1.6;
/** 真ん中以外をどれだけ暗くするか【仮】。1.0＝そのまま */
const CENTER_OPACITY = 1;
const SIDE_OPACITY = 0.7;

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
  /** まだ一度も押されていない間、真ん中の💎のまわりの光をゆっくり脈打たせて押すよう誘う */
  inviting?: boolean;
  /** 動き軽減：脈打ちと吸い付きの動きを止める */
  reduceMotion?: boolean;
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

const DiamondColorCarousel = memo(function DiamondColorCarousel({
  options,
  selectedId,
  onSelect,
  onRecord,
  inviting = false,
  reduceMotion = false,
}: Props) {
  const n = options.length;
  const containerRef = useRef<HTMLDivElement>(null);
  /** 真ん中に来ている位置。整数なら色がぴたりと真ん中、小数はその途中 */
  const [offset, setOffset] = useState(() => Math.max(0, options.findIndex((o) => o.id === selectedId)));
  const offsetRef = useRef(offset);
  const setOffsetBoth = useCallback((v: number) => { offsetRef.current = v; setOffset(v); }, []);
  /** 吸い付きの行き先。途中の色を「選ばれた」と誤解しないよう、外との突き合わせはこの値で見る */
  const targetIndexRef = useRef(offsetRef.current);
  /** 指の情報。null なら触っていない */
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startOffset: number; slot: number | null; moved: boolean } | null>(null);
  /** 押されている見た目にするボタン（帯の通し番号）。null なら誰も押されていない */
  const [pressedSlot, setPressedSlot] = useState<number | null>(null);
  const animRef = useRef<number | null>(null);

  const idAt = useCallback((slot: number) => options[((slot % n) + n) % n].id, [options, n]);

  const stopAnim = useCallback(() => {
    if (animRef.current != null) { cancelAnimationFrame(animRef.current); animRef.current = null; }
  }, []);

  /** 目盛りを行き先まで滑らせる。動き軽減なら一足飛び */
  const animateTo = useCallback((target: number) => {
    stopAnim();
    targetIndexRef.current = ((target % n) + n) % n;
    const from = offsetRef.current;
    const dist = target - from;
    if (reduceMotion || Math.abs(dist) < 0.001) {
      setOffsetBoth(((target % n) + n) % n);
      return;
    }
    const t0 = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / SNAP_MS);
      const e = 1 - Math.pow(1 - p, 3);          // 終わりでゆっくり止まる
      if (p >= 1) {
        animRef.current = null;
        setOffsetBoth(((target % n) + n) % n);   // 目盛りが際限なく伸びないよう、収まったところで色の数の範囲へ戻す
        return;
      }
      setOffsetBoth(from + dist * e);
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  }, [n, reduceMotion, setOffsetBoth, stopAnim]);

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
    let diff = want - cur;
    if (diff > n / 2) diff -= n;
    if (diff < -n / 2) diff += n;
    animateTo(cur + diff);
  });

  /** 指を離した／取り上げられた時の共通の後片付け。iOS は画面の操作を横取りする時に
   *  pointercancel を送ってくるので、そこで片付けを忘れるとボタンが二度と押せなくなる */
  const endDrag = useCallback((commit: boolean, e?: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (e && e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    setPressedSlot(null);
    const base = Math.round(offsetRef.current);
    // 動かさずに真ん中以外を押した＝その色を真ん中に呼ぶ
    if (commit && !d.moved && d.slot != null && d.slot !== base) {
      animateTo(d.slot);
      onSelect(idAt(d.slot));
      return;
    }
    animateTo(base);
    if (idAt(base) !== selectedId) onSelect(idAt(base));
  }, [animateTo, idAt, onSelect, selectedId]);

  /** 指が触れた瞬間。真ん中の💎なら、指を離すのを待たずにここで💎を1つ降らせる */
  const beginDrag = useCallback((e: ReactPointerEvent<HTMLElement>, slot: number | null) => {
    if (dragRef.current) return;
    stopAnim();
    containerRef.current?.setPointerCapture?.(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, startOffset: offsetRef.current, slot, moved: false };
    const base = Math.round(offsetRef.current);
    if (slot != null) {
      setPressedSlot(slot);
      if (slot === base && onRecord) onRecord();
    }
  }, [onRecord, stopAnim]);

  const handleMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
      d.moved = true;
      setPressedSlot(null);      // 指がぶれた＝押しではなくスワイプ
    }
    if (!d.moved) return;
    setOffsetBoth(d.startOffset - indexAtX(dx));
  }, [setOffsetBoth]);

  const base = Math.round(offset);
  const half = Math.min(WINDOW, Math.floor((n - 1) / 2));

  return (
    <div
      ref={containerRef}
      data-center-id={idAt(base)}
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
          0%   { filter: drop-shadow(0 0 0 rgba(255,255,255,0.8)); }
          70%  { filter: drop-shadow(0 0 22px rgba(255,255,255,0)); }
          100% { filter: drop-shadow(0 0 22px rgba(255,255,255,0)); }
        }
      `}</style>

      {Array.from({ length: half * 2 + 1 }, (_, k) => {
        const slot = base + k - half;
        const d = slot - offset;
        const opt = options[((slot % n) + n) % n];
        const size = sizeAt(d);
        const x = xAt(d);
        const near = Math.min(Math.abs(d), 1);
        // 窓の外側は薄くして、色が出たり消えたりするのを目立たせない
        const edge = Math.max(0, Math.min(1, half - Math.abs(d)));
        const opacity = (CENTER_OPACITY + (SIDE_OPACITY - CENTER_OPACITY) * near) * edge;
        const isCenter = slot === base;
        const pressed = pressedSlot === slot;
        const showInvitePulse = isCenter && inviting && !reduceMotion && !pressed;
        return (
          <button
            key={opt.id}
            type="button"
            aria-label={opt.id}
            aria-pressed={isCenter}
            data-diamond-color-id={opt.id}
            data-diamond-center={isCenter ? "true" : "false"}
            onPointerDown={(e) => { e.stopPropagation(); beginDrag(e, slot); }}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: size,
              height: size,
              marginLeft: -size / 2,
              marginTop: -size / 2,
              transform: `translate3d(${x}px, 0, 0) scale(${pressed ? 0.92 : 1})`,
              willChange: "transform",
              opacity,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              zIndex: isCenter ? 2 : 1,
              animation: showInvitePulse ? `hai-to-diamond-band-invite ${INVITE_PULSE_SECONDS}s ease-out infinite` : undefined,
              transition: reduceMotion ? undefined : "opacity 0.12s",
              touchAction: "none",
              WebkitTapHighlightColor: "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* 積もった💎の山に重なっても輪郭が分かるよう、絵の形に沿った薄い暗い縁取りを敷く【仮】 */}
            <span style={{ display: "block", filter: "drop-shadow(0 0 2px rgba(0,0,0,0.75)) drop-shadow(0 2px 6px rgba(0,0,0,0.5))" }}>
              <FaIcon icon={faGem} size={size} color={opt.color} />
            </span>
          </button>
        );
      })}
    </div>
  );
});

export default DiamondColorCarousel;
