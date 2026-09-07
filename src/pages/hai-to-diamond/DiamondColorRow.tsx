// 再生中の色えらび（◀ 丸の列 ▶）。
// /call-center の色えらびと同じ手触り: 丸を直接押しても、左右の矢印で前後に送ってもよい。
// 名前のラベルは出さない（色だけで選ぶ）。丸が画面幅に入りきらない時は横に流せるが、
// つまみ（スクロールバー）は出さない＝下の💎ボタンの邪魔をしない。
import { memo, useEffect, useRef } from "react";
import { DIAMOND_COLOR_ORDER, findDiamondMember } from "./members";

/** 丸の直径(px)【仮】 */
const DOT = 18;
/** 丸と丸のあいだの見た目の隙間(px)【仮】。当たり判定はこの隙間ぶんも押し込める広さにする */
const GAP = 8;

interface Props {
  /** いま選んでいるメンバーID */
  selectedId: string;
  /** 丸を押した、または矢印で送った時に呼ぶ */
  onSelect: (id: string) => void;
}

const DiamondColorRow = memo(function DiamondColorRow({ selectedId, onSelect }: Props) {
  const rowRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // 選んだ丸が列からはみ出していたら、その丸が真ん中に来るまで列を横へ流す。
  // block: "nearest" ＝ページ全体を縦に動かさない（画面は 100dvh で縦スクロールしない作り）
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [selectedId]);

  /** 矢印での色送り。端まで来たら反対の端へ回る */
  const move = (delta: number) => {
    const idx = DIAMOND_COLOR_ORDER.indexOf(selectedId);
    const base = idx === -1 ? 0 : idx;
    const next = (base + delta + DIAMOND_COLOR_ORDER.length) % DIAMOND_COLOR_ORDER.length;
    onSelect(DIAMOND_COLOR_ORDER[next]);
  };

  return (
    <div style={rowStyle}>
      {/* つまみ（スクロールバー）を隠す。style 属性では書けない指定なので <style> で当てる */}
      <style>{`.diamond-color-dots{scrollbar-width:none}.diamond-color-dots::-webkit-scrollbar{display:none}`}</style>
      <button type="button" style={arrowStyle} onClick={() => move(-1)} aria-label="前の色">◀</button>
      <div ref={rowRef} className="diamond-color-dots" style={dotsStyle}>
        {DIAMOND_COLOR_ORDER.map((id) => {
          const hex = findDiamondMember(id)?.color;
          if (!hex) return null;
          const selected = id === selectedId;
          return (
            <button
              key={id}
              ref={selected ? selectedRef : undefined}
              type="button"
              onClick={() => onSelect(id)}
              aria-label={id}
              aria-pressed={selected}
              style={hitStyle}
            >
              <span
                style={{
                  ...dotStyle,
                  background: hex,
                  transform: selected ? "scale(1.35)" : "scale(1)",
                  // 白いメンバーカラーが白い輪に溶けないよう、丸自体にも暗い縁を入れる
                  boxShadow: selected
                    ? "0 0 0 2px #fff, inset 0 0 0 1px rgba(0,0,0,0.35)"
                    : "inset 0 0 0 1px rgba(0,0,0,0.35)",
                }}
              />
            </button>
          );
        })}
      </div>
      <button type="button" style={arrowStyle} onClick={() => move(1)} aria-label="次の色">▶</button>
    </div>
  );
});

export default DiamondColorRow;

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  width: "min(100%, 360px)",
  maxWidth: "100%",
};

const arrowStyle: React.CSSProperties = {
  flex: "0 0 auto",
  width: 30,
  height: 30,
  background: "rgba(14,16,22,0.85)",
  color: "#e8eaed",
  border: "1px solid rgba(255,255,255,0.35)",
  fontSize: 12,
  lineHeight: 1,
  cursor: "pointer",
  padding: 0,
  touchAction: "manipulation",
  WebkitTapHighlightColor: "transparent",
};

const dotsStyle: React.CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  overflowX: "auto",
  overflowY: "hidden",
};

/** 丸そのものは小さいので、まわりの余白ごと押せるようにした当たり判定の器 */
const hitStyle: React.CSSProperties = {
  flex: "0 0 auto",
  width: DOT + GAP,
  height: DOT + GAP * 2,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "none",
  border: 0,
  padding: 0,
  cursor: "pointer",
  touchAction: "manipulation",
  WebkitTapHighlightColor: "transparent",
};

const dotStyle: React.CSSProperties = {
  width: DOT,
  height: DOT,
  borderRadius: "50%",
  display: "block",
  transition: "transform 0.12s",
};
