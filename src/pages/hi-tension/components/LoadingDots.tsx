import { ALL_HI_MEMBERS } from "../data";

/**
 * 動画読み込み中のスピナー: 9名のメンバーカラーの丸が一列に並んで
 * 順番にピョコピョコ跳ねる(animationDelay を順送り)
 */
export default function LoadingDots() {
  return (
    <>
      <style>{`
        @keyframes hi-tension-loading-bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-14px); }
        }
      `}</style>
      <div style={{ display: "flex", gap: "0.45rem", alignItems: "center" }}>
        {ALL_HI_MEMBERS.map((m, i) => (
          <div
            key={m.id}
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: m.color,
              animation: "hi-tension-loading-bounce 1.4s ease-in-out infinite",
              animationDelay: `${i * 0.12}s`,
              boxShadow: "0 0 0 1px rgba(255,255,255,0.15)",
            }}
          />
        ))}
      </div>
    </>
  );
}
