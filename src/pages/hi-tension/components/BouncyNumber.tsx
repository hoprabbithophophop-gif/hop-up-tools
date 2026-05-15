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
      <style>{`
        @keyframes hi-tension-digit-bounce {
          0%   { transform: translateY(28px) scale(0.4); opacity: 0; }
          55%  { transform: translateY(-8px) scale(1.18); opacity: 1; }
          78%  { transform: translateY(2px) scale(0.95); opacity: 1; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
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
        }}
      >
        {digits.map((d, i) => (
          <span
            key={`${i}-${d}`}
            style={{
              display: "inline-block",
              animation: "hi-tension-digit-bounce 0.5s both",
              animationDelay: `${i * 0.08}s`,
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
