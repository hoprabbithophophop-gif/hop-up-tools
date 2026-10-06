// 画面の本物の部品に印（スポットライト）を付けて、吹き出しで順に案内する（Hop 決定 2026-10-05・案B「実物の上で案内する」）。
// 解く側の練習問題と、作る側の案内の両方で使う。
// - 印を付けた要素の周りを薄い幕で覆い、印の要素だけ押せる（幕は印の上下左右の4枚。穴の所には何も置かないので、本物の部品をそのまま押せる）
// - 印の位置は getBoundingClientRect で毎フレーム取り直す（スクロール・キーボードの出入り・盤の組み上がりに付いていく）
// - 段が変わったら印の要素を画面の真ん中あたりへスクロールする
// - YouTube のプレーヤー（iframe）が穴の外にある間は、幕も吹き出しも出さない（YouTube API 規約「プレーヤーの前に何も表示しない」）
// - どの段でも抜けられる（Hop 2026-10-05「離脱不可能なチュートリアルやめてほしい」）。吹き出しの右上の「×」・「とばす」・
//   幕（暗い所）をタップ・Esc キーのどれでも案内を終える。「次へ」を押せない段でも同じ
// - 吹き出しは 390px の画面でもはみ出さないよう、左右 16px の余白の中に置く。印にも動画にも重ならない場所を選ぶ
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { C } from "../style";

export interface CoachStep {
  /** 印を付ける要素の CSS セレクター。複数なら全部を囲む四角に穴を開ける。無ければ穴なしで真ん中に吹き出しだけ */
  target?: string | string[];
  /** 吹き出しの文（1行ずつ） */
  lines: string[];
  /** 「次へ」を出すか（false なら利用者の操作で進む段） */
  showNext?: boolean;
  /** 「次へ」を押せるか（利用者が打つまで押せない段で使う） */
  canNext?: boolean;
  /** 「次へ」の代わりの文字（最後の段など） */
  nextLabel?: string;
  /** 吹き出しの置き場所。auto = 印のすぐ下か上、top = 画面の上（下から出る窓の中に印がある時。窓の字を隠さない） */
  placement?: "auto" | "top";
  /** 穴の中の部品を押せるか（説明だけの段で、押すと窓が開いてしまう部品の時は false） */
  holeClickable?: boolean;
}

interface Props {
  step: CoachStep;
  /** 段の番号（変わった時にスクロールする） */
  stepKey: string | number;
  onNext: () => void;
  onSkip: () => void;
  skipLabel?: string;
  nextDefaultLabel?: string;
  /** 右上の「×」の読み上げ名 */
  closeLabel?: string;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 4; // 穴の余白
const GUTTER = 16; // 吹き出しの左右の余白
const GAP = 12; // 印と吹き出しの間
const Z = 1000; // 拡大の窓（50）より上、保存の確かめ（1200）・知らせ（9998）より下
const MASK = "rgba(0,0,0,0.6)";

// 見えている画面の大きさ（スクロールバーの分を除く）
const viewport = () => ({ w: document.documentElement.clientWidth || window.innerWidth, h: document.documentElement.clientHeight || window.innerHeight });

const toSelectors = (t?: string | string[]) => (!t ? [] : Array.isArray(t) ? t : [t]);

function unionRect(selectors: string[]): Box | null {
  let top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
  for (const s of selectors) {
    document.querySelectorAll(s).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      top = Math.min(top, r.top);
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    });
  }
  if (!isFinite(top)) return null;
  return { top: top - PAD, left: left - PAD, width: right - left + PAD * 2, height: bottom - top + PAD * 2 };
}

const overlaps = (a: Box, b: Box) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
const inside = (inner: Box, outer: Box) =>
  inner.left >= outer.left - 1 && inner.top >= outer.top - 1 && inner.left + inner.width <= outer.left + outer.width + 1 && inner.top + inner.height <= outer.top + outer.height + 1;

// 画面に見えている YouTube のプレーヤー
function visiblePlayers(): Box[] {
  const out: Box[] = [];
  document.querySelectorAll("iframe").forEach((f) => {
    const r = f.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.bottom <= 0 || r.top >= viewport().h) return;
    out.push({ top: r.top, left: r.left, width: r.width, height: r.height });
  });
  return out;
}

// 要素を画面の真ん中あたりへ（scrollIntoView の block: "center" と同じ動き）。
// 中身がスクロールする入れ物（下から出る窓など）の中にあれば、先にその入れ物の中で真ん中へ寄せる
function scrollToCenter(el: Element) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const st = getComputedStyle(p);
    if (/(auto|scroll)/.test(st.overflowY) && p.scrollHeight > p.clientHeight) {
      const pr = p.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      p.scrollBy({ top: r.top + r.height / 2 - (pr.top + pr.height / 2), behavior: "smooth" });
      break;
    }
  }
  const r = el.getBoundingClientRect();
  window.scrollBy({ top: r.top + r.height / 2 - viewport().h / 2, behavior: "smooth" });
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);

export const CoachMarks: React.FC<Props> = ({ step, stepKey, onNext, onSkip, skipLabel = "とばす", nextDefaultLabel = "次へ", closeLabel = "案内を終える" }) => {
  const selectors = toSelectors(step.target);
  const selectorKey = selectors.join("|");
  const [hole, setHole] = useState<Box | null>(null);
  const [view, setView] = useState(() => viewport());
  const [players, setPlayers] = useState<Box[]>([]);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [bubbleH, setBubbleH] = useState(0);

  // 段が変わったら、印の要素を見える所へ。
  // scrollIntoView は使わない（Chrome では Tab の出発点がその要素に移り、最初の Tab が印の次の要素に当たるため。
  // 練習問題で最初の Tab が「左上の次のマス」に当たっていた原因。2026-10-06 アクセシビリティの直し）
  useEffect(() => {
    if (!selectors.length) return;
    let tries = 0;
    let timer = 0;
    const go = () => {
      const el = document.querySelector(selectors[0]);
      if (el) {
        scrollToCenter(el);
        return;
      }
      // まだ描かれていなければ少し待つ（窓が開く途中など）
      if (tries++ < 20) timer = window.setTimeout(go, 100);
    };
    go();
    return () => window.clearTimeout(timer);
  }, [stepKey, selectorKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 印の位置を毎フレーム取り直す（変わった時だけ描き直す）
  useEffect(() => {
    let raf = 0;
    let last: Box | null = null;
    let lastPlayers = "";
    let lastView = "";
    const tick = () => {
      const r = selectors.length ? unionRect(selectors) : null;
      if (!sameBox(r, last)) {
        last = r;
        setHole(r);
      }
      const p = visiblePlayers();
      const pk = JSON.stringify(p.map((b) => [Math.round(b.top), Math.round(b.left), Math.round(b.width), Math.round(b.height)]));
      if (pk !== lastPlayers) {
        lastPlayers = pk;
        setPlayers(p);
      }
      const v = viewport();
      const vk = `${v.w}x${v.h}`;
      if (vk !== lastView) {
        lastView = vk;
        setView(v);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [selectorKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc キーで終える
  const skipRef = useRef(onSkip);
  skipRef.current = onSkip;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skipRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useLayoutEffect(() => {
    const h = bubbleRef.current?.offsetHeight ?? 0;
    if (h !== bubbleH) setBubbleH(h);
  });

  // 動画が穴の外に見えている間は何も出さない（幕を動画の上に重ねない）
  const suspended = players.some((p) => !hole || !inside(p, hole));
  if (suspended) return null;

  const bubbleW = Math.min(360, view.w - GUTTER * 2);
  const bh = bubbleH || 140;

  // 吹き出しの置き場所: 印の下 → 印の上 → 画面の下 → 画面の上。印にも動画にも重ならない最初の所
  let bubbleTop: number;
  let bubbleLeft: number;
  if (hole) {
    const centerX = hole.left + hole.width / 2;
    bubbleLeft = Math.max(GUTTER, Math.min(view.w - GUTTER - bubbleW, centerX - bubbleW / 2));
    const candidates = step.placement === "top" ? [GUTTER, hole.top - GAP - bh, view.h - GUTTER - bh] : [hole.top + hole.height + GAP, hole.top - GAP - bh, view.h - GUTTER - bh, GUTTER];
    const fits = (top: number) => {
      if (top < GUTTER - 0.5 || top + bh > view.h - GUTTER + 0.5) return false;
      const box = { top, left: bubbleLeft, width: bubbleW, height: bh };
      return !overlaps(box, hole) && !players.some((p) => overlaps(box, p));
    };
    bubbleTop = candidates.find(fits) ?? Math.max(GUTTER, view.h - GUTTER - bh);
  } else {
    bubbleLeft = (view.w - bubbleW) / 2;
    bubbleTop = Math.max(GUTTER, (view.h - bh) / 2);
  }

  const showNext = step.showNext !== false;
  const canNext = step.canNext !== false;

  // 幕（穴の上下左右の4枚。穴が無ければ1枚）
  const masks: React.CSSProperties[] = hole
    ? [
        { top: 0, left: 0, width: "100%", height: Math.max(0, hole.top) },
        { top: hole.top + hole.height, left: 0, width: "100%", bottom: 0 },
        { top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height },
        { top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height },
      ]
    : [{ top: 0, left: 0, right: 0, bottom: 0 }];

  return (
    <div data-coach-layer="" aria-live="polite">
      {masks.map((s, i) => (
        // 幕をタップしても終える
        <div key={i} data-coach-mask="" onClick={onSkip} style={{ position: "fixed", zIndex: Z, background: MASK, ...s }} />
      ))}
      {/* 説明だけの段で、穴の中の部品を押させない時の透明なふた */}
      {hole && step.holeClickable === false && (
        <div style={{ position: "fixed", zIndex: Z, top: hole.top, left: hole.left, width: hole.width, height: hole.height }} />
      )}
      <div
        ref={bubbleRef}
        role="dialog"
        aria-modal="false"
        aria-label="案内"
        data-coach-bubble=""
        data-dialog-companion=""
        className="p-4 pr-12"
        style={{ position: "fixed", zIndex: Z + 1, top: bubbleTop, left: bubbleLeft, width: bubbleW, background: C.white, boxShadow: C.modalShadow }}
      >
        {/* どの段でも出す「×」 */}
        <button
          type="button"
          onClick={onSkip}
          data-coach-close=""
          aria-label={closeLabel}
          className="absolute top-1 right-1 w-11 h-11 flex items-center justify-center hover:bg-surface-container-high transition-colors"
          style={{ color: C.secondary }}
        >
          <span aria-hidden="true" className="material-symbols-outlined leading-none" style={{ fontSize: "20px" }}>close</span>
        </button>
        <div className="space-y-1 text-sm leading-relaxed" style={{ color: C.ink }}>
          {step.lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
        {/* 「とばす」はどの段でも出す（押せない段を作らない） */}
        <div className="flex justify-end gap-2 mt-3 -mr-8">
            <button type="button" onClick={onSkip} className="px-4 py-2 text-sm font-semibold bg-surface-container-high hover:bg-surface-container-highest transition-colors" style={{ color: C.ink }}>
              {skipLabel}
            </button>
            {showNext && (
              <button
                type="button"
                onClick={onNext}
                disabled={!canNext}
                className="px-4 py-2 text-sm font-semibold bg-primary text-white hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {step.nextLabel ?? nextDefaultLabel}
              </button>
            )}
        </div>
      </div>
    </div>
  );
};

export default CoachMarks;
