import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { VideoLink } from "@/data/the-ballad";
import { SHOWS, SETLIST, compareAnchor, compareEnd } from "@/data/the-ballad";
import { C, labelStyle } from "./ui";
import SongView from "./components/SongView";
import MemberView from "./components/MemberView";
import ShowView from "./components/ShowView";
import MineView from "./components/MineView";
import OmakeView from "./components/OmakeView";
import VideoModal from "./components/VideoModal";
import type { YouTubePlayerApi } from "./components/YouTubePlayer";

type Tab = "songs" | "members" | "shows" | "mine" | "omake";
const TABS: { key: Tab; label: string }[] = [
  { key: "songs", label: "Songs" },
  { key: "members", label: "Members" },
  { key: "shows", label: "Shows" },
  { key: "mine", label: "Mine" },
  { key: "omake", label: "Omake" },
];

const ATTEND_KEY = "the-ballad.attended";

export default function TheBalladPage() {
  // アクティブタブを URL(?tab=) に同期 → ブラウザバックでタブが1段ずつ戻る
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const tab: Tab =
    rawTab === "members" || rawTab === "shows" || rawTab === "mine" || rawTab === "omake" ? rawTab : "songs";
  const setTab = (t: Tab) => {
    if (t === tab) return;
    setSearchParams(t === "songs" ? {} : { tab: t }); // push で履歴を積む
  };
  const [query, setQuery] = useState("");
  const [videoOnly, setVideoOnly] = useState(false);
  const [playing, setPlaying] = useState<VideoLink | null>(null);
  const playerRef = useRef<YouTubePlayerApi | null>(null);
  // 再生(PlayChip)のタップハンドラ内で音ありロード(iOS対策)してからモーダルを開く
  const handlePlay = (v: VideoLink) => {
    // 曲が終わったら停止するよう endSeconds(曲終わり)を渡す。
    // ハロ！ステは v.endSec(実測の映像終了時間)を優先、通常曲は compareEnd(区間end)。無ければ垂れ流し。
    const end = v.endSec ?? compareEnd(v.videoId, v.startSec);
    playerRef.current?.unMute();
    playerRef.current?.loadVideo(v.videoId, {
      startSeconds: compareAnchor(v.videoId, v.startSec),
      ...(isFinite(end) ? { endSeconds: Math.floor(end) } : {}),
    });
    setPlaying(v);
  };

  // 参戦した公演（ブラウザのlocalStorageに保存・ログイン不要・端末内のみ）
  const [attended, setAttended] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(ATTEND_KEY) || "[]"));
    } catch {
      return new Set<string>();
    }
  });
  const toggleAttend = (no: string) =>
    setAttended((prev) => {
      const next = new Set(prev);
      next.has(no) ? next.delete(no) : next.add(no);
      try {
        localStorage.setItem(ATTEND_KEY, JSON.stringify([...next]));
      } catch {
        /* localStorage不可でも動作は継続 */
      }
      return next;
    });

  useEffect(() => {
    document.title = "The Balladデータベース | hop-up-tools";
  }, []);

  const placeholder =
    tab === "songs" ? "曲名・アーティスト・メンバーで検索"
    : tab === "members" ? "メンバー・曲名で検索"
    : tab === "omake" ? "曲名・アーティスト・メンバーで検索"
    : "会場・日程・メンバー・曲名で検索";

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "Inter, 'Noto Sans JP', sans-serif", color: C.body }}>
      {/* ヘッダー */}
      <header style={{ padding: "2.4rem 1.6rem 1.6rem", maxWidth: 720, margin: "0 auto" }}>
        <Link to="/" style={{ ...labelStyle, textDecoration: "none", display: "inline-block", marginBottom: "1.6rem" }}>
          ← hop-up-tools
        </Link>
        <p style={{ ...labelStyle, margin: "0 0 0.4rem" }}>The Ballad</p>
        <h1 style={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.05, color: C.ink, margin: 0 }}>
          The Balladデータベース
        </h1>
        <p style={{ fontSize: "0.8125rem", color: C.meta, margin: "0.8rem 0 0", lineHeight: 1.5 }}>
          Hello! Project 2020 〜The Ballad〜 秋ツアーで歌われた{SHOWS.length}公演・{SETLIST.length}曲のソロカバーを、曲・メンバー・公演から検索できます。公式ダイジェスト映像のある曲はその箇所から再生できます。
        </p>
      </header>

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "0 1.6rem 4rem" }}>
        {/* 検索（参戦記録タブでは出さない） */}
        {tab !== "mine" && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "0.8rem 1rem",
              fontSize: "0.875rem",
              fontFamily: "inherit",
              color: C.body,
              background: C.card,
              border: `1px solid ${C.line}`,
              borderRadius: 0,
              outline: "none",
              marginBottom: "1rem",
            }}
          />
        )}

        {/* タブ + 動画ありトグル */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.8rem", marginBottom: "1.2rem" }}>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={{
                    background: "transparent",
                    border: "none",
                    borderBottom: active ? `2px solid ${C.ink}` : "2px solid transparent",
                    padding: "0.3rem 0.2rem",
                    fontSize: "0.6875rem",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    color: active ? C.ink : C.faint,
                    cursor: "pointer",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {tab !== "mine" && tab !== "omake" && (
            <button
              onClick={() => setVideoOnly((v) => !v)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                background: videoOnly ? C.ink : "transparent",
                color: videoOnly ? "#fff" : C.faint,
                border: `1px solid ${videoOnly ? C.ink : C.hair}`,
                padding: "0.3rem 0.6rem",
                fontSize: "0.625rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                cursor: "pointer",
              }}
              aria-pressed={videoOnly}
            >
              <span style={{ fontSize: "0.6rem" }}>▶</span> 動画あり
            </button>
          )}
        </div>

        {tab === "songs" && <SongView query={query} videoOnly={videoOnly} onPlay={handlePlay} />}
        {tab === "members" && <MemberView query={query} videoOnly={videoOnly} onPlay={handlePlay} />}
        {tab === "shows" && <ShowView query={query} videoOnly={videoOnly} onPlay={handlePlay} />}
        {tab === "mine" && <MineView attended={attended} onToggleAttend={toggleAttend} onPlay={handlePlay} />}
        {tab === "omake" && <OmakeView query={query} onPlay={handlePlay} />}
      </main>

      {/* フッター */}
      <footer style={{ maxWidth: 720, margin: "0 auto", padding: "2.4rem 1.6rem", borderTop: `1px solid ${C.line}` }}>
        <p style={{ fontSize: "0.625rem", color: C.hair, margin: "0 0 0.8rem", lineHeight: 1.6 }}>
          非公式ファンツール。株式会社アップフロントワークスとは無関係です。映像は公式チャンネルへのリンク（埋め込み）であり、本サイトは映像を保持していません。
        </p>
        <p style={{ fontSize: "0.625rem", color: C.hair, margin: 0, lineHeight: 1.6 }}>
          セットリスト・歌唱者データは有志のまとめ（出典：鳩スレ）を元に作成しています。
        </p>
        <a
          href="https://ofuse.me/hopuptools"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "inline-block", marginTop: "1.4rem", fontSize: "0.7rem", color: C.meta, textDecoration: "none" }}
        >
          ♡ このツールを応援する
        </a>
      </footer>

      <VideoModal video={playing} visible={!!playing} playerRef={playerRef} onClose={() => setPlaying(null)} />
    </div>
  );
}
