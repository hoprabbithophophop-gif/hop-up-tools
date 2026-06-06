/**
 * 数値を桁ごとに分解して、左から順に下から飛び出てバウンスする数字表示。
 * 桁送りで「カウントアップ」っぽい登場感、桁が登場する瞬間にバウンス。
 */
interface Props {
  value: number;
  color: string;
  /** フォントサイズ (例: "3rem") */
  size?: string;
}

export default function BouncyNumber({ value, color, size = "3rem" }: Props) {
  const digits = value.toLocaleString().split("");
  return (
    <>
      {/* opacity は常に1（透明から登場はしない）。連打で一桁目の値が変わるたび key が変わって
          再マウント→アニメ再生されるが、透明を経由しないので「消える」ことがない。スケールの
          弾みだけで手応えを出す。桁ごとの遅延も撤去（長い数字で一桁目の遅延が大きくなり、連打時に
          ずっと縮んだ状態で固まるのを防ぐ）。 */}
      <style>{`
        @keyframes hi-tension-digit-bounce {
          0%   { transform: translateY(8px) scale(0.6); }
          55%  { transform: translateY(-7px) scale(1.2); }
          78%  { transform: translateY(2px) scale(0.95); }
          100% { transform: translateY(0) scale(1); }
        }
      `}</style>
      <div
        style={{
          display: "inline-flex",
          fontSize: size,
          fontWeight: 800,
          letterSpacing: "-0.02em",
          color,
          lineHeight: 1,
          // 暗いアリーナ背景＋濃いメンカラ(紫/緑等)でも埋もれないよう白で縁取り＋軽い影。
          textShadow:
            "1px 1px 0 rgba(255,255,255,0.95), -1px 1px 0 rgba(255,255,255,0.95), 1px -1px 0 rgba(255,255,255,0.95), -1px -1px 0 rgba(255,255,255,0.95), 0 2px 6px rgba(0,0,0,0.45)",
        }}
      >
        {digits.map((d, i) => (
          <span
            key={`${i}-${d}`}
            style={{
              display: "inline-block",
              animation: "hi-tension-digit-bounce 0.42s both",
              animationTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          >
            {d}
          </span>
        ))}
      </div>
    </>
  );
}
