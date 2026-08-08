import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/useReducedMotion";
import type { CallUnit } from "./callBubbles";

/**
 * 帯の下に置く「言葉の段」。
 *
 * 上の帯は拍に乗っているかを見せる担当なので、拡大すると先が読めなくなり、
 * 縮めると文字が潰れる。そこで「何を言うのか」はこちらが受け持つ。
 *
 * いま言うコールを全文そのまま出し、声を出す瞬間が来た音だけを大きくする。
 * 上の帯の映す幅をどれだけ変えても、ここを見れば言葉は分かる。
 */

type Props = {
  units: CallUnit[];
  /** いまの再生位置（曲の中での秒数）を返す */
  getNow: () => number;
};

/** 声を出した音が、次の音までどれだけ大きいままでいるか（秒） */
const HOLD_SEC = 0.28;

export default function CallTicker({ units, getNow }: Props) {
  // 端末が「視差効果を減らす」なら、大きくする動きは出さない。
  // 色と太さだけで「いまここ」を示す＝何を言うかは同じように読める。
  const reduced = useReducedMotion();
  const [idx, setIdx] = useState(-1);
  const shownRef = useRef(-1);
  const getNowRef = useRef(getNow);
  getNowRef.current = getNow;

  // いま鳴っている音を探す。変わったときだけ描き直す。
  useEffect(() => {
    if (units.length === 0) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = getNowRef.current();
      let found = -1;
      for (let i = 0; i < units.length; i++) {
        if (units[i].t <= now + 0.02) found = i;
        else break;
      }
      // 通り過ぎて間が空いたら、いったん消す（言い終わったコールを出しっぱなしにしない）
      if (found >= 0 && now - units[found].t > 2.5) found = -1;
      if (found !== shownRef.current) {
        shownRef.current = found;
        setIdx(found);
      }
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [units]);

  // いま鳴っているコールの粒を全部（＝コール1つぶんの全文）と、その次のコール
  const { current, next } = useMemo(() => {
    if (idx < 0) return { current: [] as CallUnit[], next: null as CallUnit[] | null };
    const ci = units[idx].callIndex;
    const cur = units.filter((u) => u.callIndex === ci);
    const nextIdx = units.findIndex((u) => u.callIndex > ci);
    if (nextIdx < 0) return { current: cur, next: null };
    const ni = units[nextIdx].callIndex;
    return { current: cur, next: units.filter((u) => u.callIndex === ni) };
  }, [idx, units]);

  const activeUnit = idx >= 0 ? units[idx] : null;

  return (
    <div style={S.wrap}>
      <div style={S.line}>
        {current.length === 0 ? (
          <span style={S.rest}>—</span>
        ) : (
          current.map((u, i) => {
            const on =
              activeUnit !== null &&
              u.callIndex === activeUnit.callIndex &&
              u.unitIndex === activeUnit.unitIndex;
            const past =
              activeUnit !== null &&
              u.callIndex === activeUnit.callIndex &&
              u.unitIndex < activeUnit.unitIndex;
            return (
              <span
                key={i}
                style={{
                  ...S.mora,
                  ...(reduced ? S.moraStill : null),
                  ...(past ? S.moraPast : null),
                  ...(on ? (reduced ? S.moraOnStill : S.moraOn) : null),
                }}
              >
                {u.text}
              </span>
            );
          })
        )}
      </div>
      <div style={S.nextLine}>
        {next && next.length > 0 ? `つぎ　${next[0].callText}` : " "}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { background: "#fff", padding: "14px 12px 10px", marginTop: 2 },
  line: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    flexWrap: "wrap",
    minHeight: 42,
    gap: 1,
  },
  mora: {
    fontSize: 20,
    fontWeight: 800,
    lineHeight: 1.1,
    color: "#b1b8c0",
    transform: "scale(1)",
    transformOrigin: "50% 100%",
    transition: `transform ${HOLD_SEC}s ease-out, color ${HOLD_SEC}s ease-out`,
    willChange: "transform",
  },
  moraPast: { color: "#585f6c" },
  moraOn: { color: "#000", transform: "scale(1.5)", transitionDuration: "0.06s" },

  /** 「視差効果を減らす」設定のとき。動かさず、色と下線だけで示す */
  moraStill: { transform: "none", transition: "none" },
  moraOnStill: {
    color: "#000",
    transform: "none",
    transition: "none",
    boxShadow: "inset 0 -4px 0 #000",
  },
  rest: { fontSize: 20, fontWeight: 800, color: "#dfe2e6" },
  nextLine: {
    textAlign: "center",
    fontSize: 11.5,
    color: "#9aa1aa",
    marginTop: 8,
    minHeight: 16,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
};
