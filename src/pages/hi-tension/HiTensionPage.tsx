import { useState, useEffect, useRef } from "react";
import MemberSelect from "./components/MemberSelect";
import YouTubePlayer from "./components/YouTubePlayer";
import { VIDEO_ID, findMember } from "./data";
import {
  getLastSelectedMemberId,
  setLastSelectedMemberId,
  getOrCreateAnonymousSessionId,
} from "./storage";

type Screen = "select" | "play";

export default function HiTensionPage() {
  const [screen, setScreen] = useState<Screen>("select");
  const [memberId, setMemberId] = useState<string | null>(() => getLastSelectedMemberId());
  const timestampsRef = useRef<number[]>([]);

  useEffect(() => {
    // anonymous_session_id を初回訪問時に確保（書き込みはまだしないが、IDだけ確保）
    getOrCreateAnonymousSessionId();
  }, []);

  const handleConfirm = (id: string) => {
    setMemberId(id);
    setLastSelectedMemberId(id);
    timestampsRef.current = [];
    setScreen("play");
  };

  const handleVideoEnded = () => {
    console.log("[hi-tension] video ended. timestamps:", timestampsRef.current);
    // Phase 1 で Supabase に保存する
  };

  const handleHi = () => {
    // Phase 1 まで: 押下時刻をローカルに溜めるだけ
    // currentTime の取得はプレイヤー側のポーリングコールバックでまかなう想定。
    // ボタン押下の瞬間は「最後にポーリングで取れた時刻」を使う方が同期しやすいので、
    // useRef で最新時刻を保持する設計に Phase 1 で差し替える。
    timestampsRef.current.push(performance.now() / 1000);
    console.log("[hi-tension] HI! pressed. count:", timestampsRef.current.length);
  };

  if (screen === "select") {
    return (
      <MemberSelect initialSelectedId={memberId} onConfirm={handleConfirm} />
    );
  }

  const member = findMember(memberId);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8f9fa",
        color: "#191c1d",
        fontFamily: "Inter, 'Noto Sans JP', sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <YouTubePlayer videoId={VIDEO_ID} onEnded={handleVideoEnded} />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "1.6rem 1.2rem 2rem",
        }}
      >
        <button
          type="button"
          onClick={handleHi}
          style={{
            width: 120,
            height: 120,
            borderRadius: "50%",
            background: member?.color ?? "#000",
            color: "#fff",
            border: "none",
            fontSize: "1.5rem",
            fontWeight: 800,
            letterSpacing: "0.05em",
            cursor: "pointer",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.08)",
          }}
        >
          ハイ！
        </button>

        <p
          style={{
            marginTop: "auto",
            paddingTop: "2.4rem",
            fontSize: "0.625rem",
            color: "#777",
            textAlign: "center",
            lineHeight: 1.6,
          }}
        >
          楽曲・映像の著作権は権利者に帰属します。
          <br />
          やめてねと言われたらすぐやめます。
        </p>
      </div>
    </div>
  );
}
