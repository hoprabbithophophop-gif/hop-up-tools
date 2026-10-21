// ランキングだけを見る画面（Hop 指示 2026-10-17。「解き終えた人がランキングをもう一度見るには、もう一度解くしかない」を直す）。
// 入口はギャラリーのカードの「ランキング」と、解き終えた画面のランキングの見出し。回は始めない（受付係には何も送らない）
import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { isHiddenPuzzle, loadPuzzle } from "../../lib/crossword/puzzleStore";
import { usePageReady } from "../../lib/pageReady";
import { PuzzleRanking } from "./components/PuzzleRanking";
import { Footer, Icon } from "./components/ui";
import { C } from "./style";

// 文言（クロスワードの文言は Hop の委任でこちらが決める。2026-10-06）
const T = {
  backToGallery: "ギャラリーへ戻る",
  pageTitle: "ランキング",
  anonymous: "名無し",
  untitled: "無題のクロスワード",
  createdBy: (name: string) => `作った人：${name}`,
  play: "このクロスワードを遊ぶ",
  loading: "読み込み中…",
  // 解く画面と同じ文言
  loadFailed: "クロスワードの読み込みに失敗しました。",
  puzzleHidden: "このクロスワードは非表示になっています。",
  loadError: "このクロスワードを読み込めませんでした。URL をご確認ください。",
};

type State = { status: "loading" } | { status: "done"; title: string; creatorName?: string } | { status: "failed"; message: string };

export default function RankingPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [state, setState] = useState<State>({ status: "loading" });
  // 問題の題名が届くまでページ移動の波を引かない（兄弟の画面と同じ作法）
  usePageReady(state.status !== "loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rec = await loadPuzzle(id);
        if (!alive) return;
        if (!rec) {
          const hidden = await isHiddenPuzzle(id).catch(() => false);
          if (alive) setState({ status: "failed", message: hidden ? T.puzzleHidden : T.loadFailed });
          return;
        }
        setState({ status: "done", title: rec.title, creatorName: rec.body?.creatorName });
      } catch (err) {
        console.error("Failed to load puzzle:", err);
        if (alive) setState({ status: "failed", message: T.loadError });
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <>
      <div className="min-h-screen bg-surface">
        <main className="max-w-2xl mx-auto px-4 py-8">
          <div className="flex items-start gap-3 mb-6 min-w-0">
            {/* 戻る矢印は1行目（題名）の高さに合わせる。p-1.5+24px=36px を題名の行 24px の中央に */}
            <Link to="/crossword" className="p-1.5 -mt-1.5 hover:bg-surface-container-high transition-colors shrink-0" style={{ color: C.ink }} title={T.backToGallery} aria-label={T.backToGallery}>
              <Icon icon="chevron_left" />
            </Link>
            {/* 題名と作った人は小さく上に、画面の名前「ランキング」を一番大きく（Hop 決定 2026-10-17 案a） */}
            <div className="min-w-0">
              <p className="text-base font-bold truncate" style={{ color: C.ink }}>
                {state.status === "done" ? state.title || T.untitled : state.status === "loading" ? T.loading : " "}
              </p>
              <p className="text-sm truncate" style={{ color: C.secondary }}>
                {state.status === "done" ? T.createdBy(state.creatorName || T.anonymous) : " "}
              </p>
              <h1 className="text-2xl font-bold mt-1" style={{ color: C.ink }}>
                {T.pageTitle}
              </h1>
            </div>
          </div>

          {state.status === "failed" && (
            <div className="bg-white p-6 text-center">
              <p className="text-sm" role="alert" style={{ color: C.secondary }}>
                {state.message}
              </p>
            </div>
          )}
          {state.status === "done" && (
            <>
              <PuzzleRanking puzzleId={id} hideTitle />
              <Link to={`/crossword/${id}`} className="flex items-center justify-center gap-2 w-full py-3 mt-6 bg-primary hover:bg-secondary text-white font-black font-mono transition-colors">
                <Icon size={16} icon="play_arrow" /> {T.play}
              </Link>
            </>
          )}
        </main>
      </div>
      <Footer />
    </>
  );
}
