// マイク拍検出スパイク（技術検証用・隠しルート /hi-tension/mic）
//
// 目的だけの最小プロトタイプ。「インスタ動画など操作できない音に、マイクで合わせられるか？」を
// 実機で確かめるためのもの。マイクで拾った音のオンセット(ドン/パン)を検出して、間隔から
// だいたいのBPMを推定し、拍に合わせて画面を光らせる。精度・遅延・環境音の耐性を“目と耳”で見る用。
// ※これは検証用。コール表示との同期はまだ繋いでいない（先に「拾えるか」を確かめる段階）。
import { useEffect, useRef, useState } from "react";

const PINK = "#da1884";

export default function HiTensionMicTestPage() {
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string>("");
  const [bpm, setBpm] = useState(0);
  const [onsetCount, setOnsetCount] = useState(0);
  const [level, setLevel] = useState(0); // 0..1 入力レベル（マイクが拾えてるか確認用）

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const pulseRef = useRef<HTMLDivElement>(null);

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    try { ctxRef.current?.close(); } catch { /* ignore */ }
    streamRef.current = null; ctxRef.current = null;
    setRunning(false);
  };

  const start = async () => {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const freq = new Uint8Array(analyser.frequencyBinCount);

      const hist: number[] = [];          // 直近フレームのエネルギー履歴（移動平均用）
      const onsets: number[] = [];        // 直近オンセット時刻（秒）
      let lastOnset = -1;
      let count = 0;

      setRunning(true);
      const loop = () => {
        rafRef.current = requestAnimationFrame(loop);
        analyser.getByteFrequencyData(freq);
        // 低〜中域（キック/スネア帯）のエネルギー。拍の芯はだいたいここに出る。
        let e = 0; for (let i = 0; i < 48; i++) e += freq[i] * freq[i];
        hist.push(e); if (hist.length > 43) hist.shift(); // ≒0.7秒ぶん
        const avg = hist.reduce((a, b) => a + b, 0) / Math.max(1, hist.length);
        const now = ctx.currentTime;
        setLevel(Math.min(1, Math.sqrt(e) / 1400));

        // オンセット＝局所平均を大きく超えた瞬間＋不応期(連打防止)
        if (e > avg * 1.6 && e > 1.2e4 && now - lastOnset > 0.18) {
          lastOnset = now;
          onsets.push(now); if (onsets.length > 16) onsets.shift();
          count += 1; setOnsetCount(count);
          // 光らせる（DOM直更新＝再描画コスト回避）
          if (pulseRef.current) {
            pulseRef.current.style.transform = "scale(1.18)";
            pulseRef.current.style.background = PINK;
            setTimeout(() => { if (pulseRef.current) { pulseRef.current.style.transform = "scale(1)"; pulseRef.current.style.background = "rgba(255,255,255,0.08)"; } }, 90);
          }
          // 間隔の中央値からBPM推定（0.3〜1.0秒＝60〜200BPMだけ採用）
          if (onsets.length >= 4) {
            const iv: number[] = [];
            for (let k = 1; k < onsets.length; k++) iv.push(onsets[k] - onsets[k - 1]);
            const good = iv.filter(d => d > 0.3 && d < 1.0).sort((a, b) => a - b);
            if (good.length) {
              const md = good[Math.floor(good.length / 2)];
              setBpm(Math.round(60 / md));
            }
          }
        }
      };
      loop();
    } catch (e) {
      setErr("マイクが使えなかった：" + (e instanceof Error ? e.message : String(e)));
      setRunning(false);
    }
  };

  useEffect(() => () => stop(), []);

  const btn: React.CSSProperties = { fontSize: 15, padding: "11px 20px", borderRadius: 12, border: "none", background: PINK, color: "#fff", fontWeight: 800, cursor: "pointer" };

  return (
    <div style={{ minHeight: "100dvh", background: "#0b0d12", color: "#eef1f5", display: "flex", flexDirection: "column", alignItems: "center", gap: 18, padding: "20px 16px", fontFamily: "Inter, system-ui, sans-serif", boxSizing: "border-box" }}>
      <h1 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>マイク拍検出テスト <span style={{ fontSize: 11, color: "#8b93a0", fontWeight: 400 }}>(技術検証)</span></h1>
      <p style={{ fontSize: 12, color: "#9aa3b0", margin: 0, textAlign: "center", maxWidth: 360, lineHeight: 1.6 }}>
        スタートを押してマイク許可 → 曲（インスタ動画など）をスピーカーで流す。<br />
        ドン/パンに合わせて丸が光って、だいたいのBPMが出れば「マイクで拍を拾える」が成立。
      </p>

      <div ref={pulseRef} style={{ width: 160, height: 160, borderRadius: "50%", background: "rgba(255,255,255,0.08)", border: "2px solid rgba(255,255,255,0.18)", transition: "transform 80ms ease-out, background 80ms", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, fontWeight: 900 }}>
        {bpm > 0 ? bpm : "—"}
      </div>
      <div style={{ fontSize: 12, color: "#9aa3b0" }}>推定BPM・拾った拍 {onsetCount} 回</div>

      {/* 入力レベル（マイクが音を拾えてるかの確認） */}
      <div style={{ width: "100%", maxWidth: 320, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div style={{ width: `${Math.round(level * 100)}%`, height: "100%", background: PINK, transition: "width 60ms linear" }} />
      </div>

      {err && <p style={{ color: "#ff8a8a", fontSize: 13, maxWidth: 360, textAlign: "center" }}>{err}</p>}

      <button style={running ? { ...btn, background: "rgba(255,255,255,0.1)", color: "#eee" } : btn} onClick={running ? stop : start}>
        {running ? "■ 停止" : "▶ スタート（マイク許可）"}
      </button>
    </div>
  );
}
