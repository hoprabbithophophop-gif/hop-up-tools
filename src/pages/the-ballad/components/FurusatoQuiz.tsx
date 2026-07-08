// The Ballad ふるさとイントロドン（OMAKEから起動するモーダルクイズ）
// 各公演のダイジェスト内「ふるさと」全員合唱パート(サビ29秒前後・ロゴ除外済み)を流し、
// 歌声と衣装から「どの公演か」を3択で当てる。編成(4→6→8人)で難易度が上がる。全10問。
// 見た目は docs/DESIGN.md 準拠（黒アクセント / オフホワイト背景 / 角丸0 / ボーダーなし / 英大文字ラベル）。
// プレイヤーは hi-tension 方式(常時ready・タップ内 loadVideo)で iOS でも音あり再生。
import { useEffect, useRef, useState } from "react";
import { FURUSATO, type FurusatoShow } from "@/data/the-ballad";
import { C, labelStyle } from "../ui";
import { MemberEmph } from "./Emph";
import YouTubePlayer, { type YouTubePlayerApi } from "./YouTubePlayer";
import { useBackClose } from "@/hooks/useBackClose";

// 難易度の出題プラン（易→難）: 4人×3 → 6人×3 → 8人×4 の全10問
const PLAN: number[] = [4, 4, 4, 6, 6, 6, 8, 8, 8, 8];

interface Question {
  correct: FurusatoShow;
  choices: FurusatoShow[];
}

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
const memberKey = (f: FurusatoShow) => [...f.members].sort().join(",");

function buildQuestions(): Question[] {
  // 編成別に、同一メンバー(memberKey)を1グループにまとめる。固定メンバーの隣県公演・昼夜は
  // 見分けられないので「1つ」として扱い、選択肢には必ず別メンバーの公演だけを並べる。
  const groups: Record<number, Map<string, FurusatoShow[]>> = { 4: new Map(), 6: new Map(), 8: new Map() };
  for (const f of FURUSATO) {
    const g = groups[f.n];
    if (!g) continue;
    const k = memberKey(f);
    if (!g.has(k)) g.set(k, []);
    g.get(k)!.push(f);
  }
  // 各メンバーグループの代表1公演(ランダム)を出題プールにする
  const reps: Record<number, FurusatoShow[]> = { 4: [], 6: [], 8: [] };
  for (const n of [4, 6, 8]) for (const [, shows] of groups[n]) reps[n].push(shuffle(shows)[0]);

  const usedKeys = new Set<string>();
  const qs: Question[] = [];
  for (const n of PLAN) {
    const list = reps[n] ?? [];
    const pool = list.filter((f) => !usedKeys.has(memberKey(f)));
    const correct = (pool.length ? shuffle(pool) : shuffle(list))[0];
    if (!correct) continue;
    usedKeys.add(memberKey(correct));
    // 選択肢は全部「別メンバー」= correct とも互いにも memberKey が違う公演から2つ
    const usedInQ = new Set([memberKey(correct)]);
    const distract: FurusatoShow[] = [];
    for (const f of shuffle(list)) {
      if (distract.length >= 2) break;
      const k = memberKey(f);
      if (usedInQ.has(k)) continue;
      usedInQ.add(k);
      distract.push(f);
    }
    qs.push({ correct, choices: shuffle([correct, ...distract]) });
  }
  return qs;
}

// X(旧Twitter)シェア。文面は暫定(hop確認まで最小限・ハッシュタグなし)。Web Intent方式。
const SHARE_URL = "https://hop-up-tools.pages.dev/the-ballad";
function shareToX(ok: number, total: number) {
  const text = ["The Ballad ふるさとイントロドン", `${total}問中 ${ok}問正解`, "#TheBalladふるさとイントロドン", SHARE_URL].join("\n");
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}

function BackClose({ onClose }: { onClose: () => void }) {
  useBackClose(onClose);
  return null;
}

export default function FurusatoQuiz({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const playerRef = useRef<YouTubePlayerApi | null>(null);
  const [phase, setPhase] = useState<"ready" | "playing" | "result">("ready");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [qIdx, setQIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [results, setResults] = useState<{ q: Question; picked: string; ok: boolean }[]>([]);
  // 回答するまでサビをリピート再生するための参照(onEnded内で最新値を見る)
  const pickedRef = useRef<string | null>(null);
  const currentQRef = useRef<Question | null>(null);
  useEffect(() => { pickedRef.current = picked; }, [picked]);
  const [reviewIdx, setReviewIdx] = useState(-1); // リザルトで動画を見返し中の問題index(-1=なし)
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!visible) {
      playerRef.current?.pause();
      setPhase("ready");
      setResults([]);
      setPicked(null);
      setReviewIdx(-1);
    }
  }, [visible]);

  const playQuestion = (q: Question) => {
    currentQRef.current = q;
    playerRef.current?.unMute();
    playerRef.current?.loadVideo(q.correct.videoId, { startSeconds: q.correct.startSec, endSeconds: q.correct.endSec });
  };

  // サビ終わり(endSec到達=onEnded)で、まだ回答してなければ同じサビをリピート再生する。
  const handleEnded = () => {
    if (!pickedRef.current && currentQRef.current) {
      const q = currentQRef.current;
      playerRef.current?.loadVideo(q.correct.videoId, { startSeconds: q.correct.startSec, endSeconds: q.correct.endSec });
    }
  };

  const startGame = () => {
    const qs = buildQuestions();
    setQuestions(qs);
    setQIdx(0);
    setPicked(null);
    setResults([]);
    setReviewIdx(-1);
    setPhase("playing");
    if (qs[0]) playQuestion(qs[0]); // タップ内で音ありロード(iOS対策)
  };

  const choose = (show: FurusatoShow) => {
    if (picked) return;
    const q = questions[qIdx];
    const ok = show.showNo === q.correct.showNo;
    setPicked(show.showNo);
    setResults((r) => [...r, { q, picked: show.showNo, ok }]);
  };

  const next = () => {
    const ni = qIdx + 1;
    if (ni >= questions.length) {
      playerRef.current?.pause();
      setPhase("result");
      return;
    }
    setQIdx(ni);
    setPicked(null);
    playQuestion(questions[ni]);
  };

  const okCount = results.filter((r) => r.ok).length;
  const q = questions[qIdx];

  return (
    <div
      ref={scrollRef}
      style={{
        position: "fixed", inset: 0, background: C.bg, zIndex: 1200,
        opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none", transition: "opacity 0.12s",
        overflowY: "auto", color: C.body, fontFamily: "Inter, 'Noto Sans JP', sans-serif",
      }}
    >
      {visible && <BackClose onClose={onClose} />}
      <div style={{ maxWidth: 460, margin: "0 auto", padding: "1.6rem 1.4rem 3.2rem", minHeight: "100%", boxSizing: "border-box" }}>
        {/* ヘッダー（閉じるのみ。タイトルは起動画面の日本語大見出しに集約） */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: "1.2rem" }}>
          <button onClick={() => window.history.back()} aria-label="閉じる" style={{ background: "transparent", border: "none", color: C.faint, fontSize: "1rem", cursor: "pointer", padding: "0.2rem 0.4rem" }}>✕</button>
        </div>

        {/* 動画（常時マウント＝iOS ready保持。playing、またはリザルトで見返し中に表示） */}
        <div style={{ width: "100%", display: (phase === "playing" || (phase === "result" && reviewIdx >= 0)) ? "block" : "none" }}>
          <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", background: "#000" }}>
            <div style={{ position: "absolute", inset: 0 }}>
              <YouTubePlayer ref={playerRef} containerId="furusato-quiz-player" onEnded={handleEnded} />
            </div>
          </div>
        </div>

        {/* ===== 起動画面 ===== */}
        {phase === "ready" && (
          <div style={{ textAlign: "center", padding: "3.2rem 0 1.6rem" }}>
            <h1 style={{ fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.03em", color: C.ink, margin: "0 0 0.8rem", lineHeight: 1.15 }}>
              The Ballad<br />ふるさとイントロドン
            </h1>
            <p style={{ fontSize: "0.85rem", color: C.meta, margin: "0 0 2.4rem", lineHeight: 1.8 }}>
              全公演で歌われた「ふるさと」の全員合唱。<br />歌声と衣装から、どの公演か当てよう。
            </p>
            <button onClick={startGame} style={ctaBtn}>スタート</button>
          </div>
        )}

        {/* ===== ゲーム画面 ===== */}
        {phase === "playing" && q && (
          <div>
            <p style={{ ...labelStyle, margin: "1rem 0 0.6rem" }}>Q {qIdx + 1} / {questions.length}</p>
            <p style={{ fontSize: "0.8rem", color: C.meta, textAlign: "center", margin: "0 0 1rem" }}>
              歌声、衣装から推測してどの公演か当てよう。
            </p>
            <div>
              {q.choices.map((ch) => {
                const isCorrect = ch.showNo === q.correct.showNo;
                const isPicked = picked === ch.showNo;
                const revealed = picked !== null;
                // 正誤は赤緑を使わず、正解=黒反転／自分の誤答=トーンダウンで表す（DESIGN.md）。
                const revealCorrect = revealed && isCorrect;
                const revealWrongPick = revealed && isPicked && !isCorrect;
                const bg = revealCorrect ? C.ink : revealWrongPick ? "#eceef0" : revealed ? "#f3f4f5" : C.card;
                const fg = revealCorrect ? "#fff" : revealWrongPick ? C.hair : C.body;
                const metaFg = revealCorrect ? "rgba(255,255,255,0.7)" : revealWrongPick ? C.hair : C.meta;
                return (
                  <button key={ch.showNo} onClick={() => choose(ch)} disabled={revealed}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "0.8rem 1rem", marginBottom: 2, border: "none", background: bg, color: fg, cursor: revealed ? "default" : "pointer", transition: "background 0.12s" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
                      <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>{ch.date} {ch.start}</span>
                      {revealCorrect && <span style={{ ...labelStyle, color: "#fff" }}>Correct</span>}
                      {revealWrongPick && <span style={{ ...labelStyle, color: C.hair }}>Your pick</span>}
                    </div>
                    <div style={{ fontSize: "0.72rem", color: metaFg, margin: "0.15rem 0 0.3rem" }}>{ch.venue}（{ch.pref}）</div>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", fontSize: "0.68rem", color: metaFg, lineHeight: 1.55 }}>
                      {ch.members.map((m, i) => (
                        <span key={i} style={{ whiteSpace: "nowrap" }}>
                          {i > 0 && <span style={{ color: revealCorrect ? "rgba(255,255,255,0.4)" : C.hair, margin: "0 0.15rem" }}>・</span>}
                          <MemberEmph member={m} big="0.68rem" small="0.68rem" inkColor={metaFg} />
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
            {picked && (
              <button onClick={next} style={{ ...ctaBtn, marginTop: "1.4rem" }}>
                {qIdx + 1 >= questions.length ? "結果を見る" : "次の問題へ"}
              </button>
            )}
          </div>
        )}

        {/* ===== リザルト画面 ===== */}
        {phase === "result" && (
          <div style={{ padding: "1rem 0" }}>
            <div style={{ textAlign: "center", margin: "1.6rem 0 2rem" }}>
              <p style={labelStyle}>Result</p>
              <div style={{ fontSize: "3.2rem", fontWeight: 900, letterSpacing: "-0.04em", color: C.ink, lineHeight: 1.05, margin: "0.4rem 0 0" }}>
                {okCount}<span style={{ fontSize: "1.2rem", color: C.faint, fontWeight: 700 }}> / {results.length}</span>
              </div>
              <p style={{ fontSize: "0.9rem", color: C.body, fontWeight: 700, margin: "0.4rem 0 0" }}>
                {okCount === results.length ? "全問正解。耳がいいね。" : okCount >= results.length * 0.7 ? "かなりの通。" : okCount >= results.length * 0.4 ? "いい線いってる。" : "また挑戦してね。"}
              </p>
            </div>

            {/* 間違いの振り返り */}
            {results.some((r) => !r.ok) && (
              <div style={{ marginBottom: "2rem" }}>
                <p style={{ ...labelStyle, marginBottom: "0.6rem" }}>Review — 間違えた問題の答え</p>
                {results.map((r, i) => {
                  if (r.ok) return null;
                  const c = r.q.correct;
                  const reviewing = reviewIdx === i;
                  return (
                    <button key={i} onClick={() => {
                      setReviewIdx(i);
                      playerRef.current?.unMute();
                      playerRef.current?.loadVideo(c.videoId, { startSeconds: c.startSec, endSeconds: c.endSec });
                      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                    }} style={{ display: "block", width: "100%", textAlign: "left", background: reviewing ? C.cardHover : C.card, border: "none", padding: "0.8rem 1rem", marginBottom: 2, cursor: "pointer" }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem" }}>
                        <p style={{ ...labelStyle, color: C.hair, margin: 0 }}>Q{i + 1}</p>
                        <span style={{ fontSize: "0.65rem", fontWeight: 700, color: reviewing ? C.ink : C.meta, flexShrink: 0 }}>{reviewing ? "▶ 再生中" : "▶ サビを聴く"}</span>
                      </div>
                      <div style={{ fontSize: "0.85rem", fontWeight: 700, color: C.ink, margin: "0.15rem 0" }}>{c.date} {c.start} {c.venue}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", fontSize: "0.68rem", color: C.meta, lineHeight: 1.55 }}>
                        {c.members.map((m, k) => (
                          <span key={k} style={{ whiteSpace: "nowrap" }}>
                            {k > 0 && <span style={{ color: C.hair, margin: "0 0.15rem" }}>・</span>}
                            <MemberEmph member={m} big="0.68rem" small="0.68rem" inkColor={C.meta} />
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* ボタン（ありがとビート準拠: もう一度→ポスト→ホーム） */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.6rem" }}>
              <button onClick={startGame} style={{ ...ctaBtn, maxWidth: 280 }}>もう一度</button>
              <button onClick={() => shareToX(okCount, results.length)} style={{ ...ghostBtn, maxWidth: 280 }}>𝕏 結果をポスト</button>
              <button onClick={() => window.history.back()} style={{ ...ghostBtn, maxWidth: 280 }}>ホームに戻る</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// CTA＝黒背景・白文字・角丸0（DESIGN.md primary）
const ctaBtn: React.CSSProperties = {
  width: "100%", padding: "0.85rem", border: "none", background: C.ink, color: "#fff",
  fontSize: "0.9rem", fontWeight: 700, letterSpacing: "0.02em", cursor: "pointer",
};
// サブ＝白背景・黒文字・ゴーストボーダー・角丸0
const ghostBtn: React.CSSProperties = {
  width: "100%", padding: "0.85rem", border: `1px solid ${C.line}`, background: C.card, color: C.ink,
  fontSize: "0.9rem", fontWeight: 700, cursor: "pointer",
};
const subChip: React.CSSProperties = {
  padding: "0.3rem 0.7rem", border: `1px solid ${C.line}`, background: C.card, color: C.body,
  fontSize: "0.7rem", fontWeight: 700, cursor: "pointer",
};
