import { useEffect, useRef, useState } from "react";

/**
 * 簡易FPS計測オーバーレイ（計測用・本番には出さない）。
 * requestAnimationFrame で実際のブラウザ描画フレームレートを測る＝体感のカクつきに直結する値。
 * 現在値と「最低値(min)」を表示。サビの混雑でどこまで落ちるかは min を見る。
 * タップで min をリセット（混む瞬間の直前に押せば、その山だけの最低値が取れる）。
 */
export default function FpsMeter() {
  const [fps, setFps] = useState(0);
  const [min, setMin] = useState<number | null>(null);
  const minRef = useRef<number | null>(null);

  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    const started = last;
    const loop = (now: number) => {
      frames++;
      const dt = now - last;
      if (dt >= 500) {
        const f = Math.round((frames * 1000) / dt);
        setFps(f);
        // 起動直後1秒は初期化のカクつきがあるので min に入れない
        if (now - started > 1000 && (minRef.current == null || f < minRef.current)) {
          minRef.current = f;
          setMin(f);
        }
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const reset = () => {
    minRef.current = null;
    setMin(null);
  };

  return (
    <div
      onClick={reset}
      title="タップで min リセット"
      style={{
        position: "fixed",
        top: 4,
        right: 4,
        zIndex: 400,
        background: "rgba(0,0,0,0.72)",
        color: min != null && min < 40 ? "#ff5252" : "#0f0",
        fontSize: "0.7rem",
        fontFamily: "monospace",
        fontWeight: 700,
        padding: "3px 7px",
        lineHeight: 1.3,
        cursor: "pointer",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {fps} fps{min != null ? ` (min ${min})` : ""}
    </div>
  );
}
