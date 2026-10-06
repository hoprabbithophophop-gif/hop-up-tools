// 作る画面の「ヒント」欄（HarmonyPalette に無い、足した物）。
// ハロプロ: YouTube は HELLO! VIDEO の台帳から題名・曲名で検索する。結果のサムネイルを押すと拡大の窓で再生して見られ（見る）、窓の「この位置でヒントにする」か題名側を押すと選ぶ（決める）。URL を貼った時は台帳にあるか確かめ、無ければ受け付けない
// その他: YouTube の URL を貼ると時刻が欄に入る（直せる）
// 選んだ YouTube はその場で埋め込み、開始時刻の位置で止めて出す。「今の位置にする」で時刻を入れられる
// どちらのジャンルも YouTube 以外のリンクは「リンク」として貼れる（再生しない）
import React, { useEffect, useRef, useState } from "react";
import type { Genre, HintRef } from "../../../lib/crossword/puzzleStore";
import {
  isCatalogVideo,
  searchCatalogChapters,
  searchCatalogVideos,
  type CatalogChapter,
  type CatalogVideo,
} from "../../../lib/crossword/puzzleStore";
import { formatTime, parseTimeInput, parseYouTubeUrl, linkProblem } from "../../../lib/crossword/youtubeUrl";
import { C } from "../style";
import { HintPlayer, type HintPlayerApi } from "./HintPlayer";
import { useDialog } from "./useDialog";

// 再生できない動画（削除・非公開・埋め込み禁止）を選んだ時の知らせ
const UNUSABLE = "この動画はヒントに使えません。";
// リンクの決まりに合わない時（Hop 決定 2026-10-04）
const LINK_RULE = "リンクは https から始まる URL だけ使えます。"; // Hop 決定 2026-10-06

export interface Selected {
  hint: HintRef;
  label: string;
}

interface HintFieldProps {
  genre: Genre;
  onChange: (hint: HintRef | null) => void;
  resetKey: number; // 変わったら欄を空にする（追加した後・ジャンルを変えた後）
  inputClassName: string;
  /** 登録済みのカギを直すとき、resetKey が変わった時点でこのヒントが選ばれた状態にする */
  initial?: Selected | null;
  /** 上の札（label）と結び付けるための id（検索・URL の欄に付ける） */
  inputId?: string;
}

const looksLikeUrl = (t: string) => /^https?:\/\//i.test(t.trim());
const thumbUrl = (id: string) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/default.jpg`;
const dateText = (iso: string | null) => (iso ? iso.slice(0, 10).replace(/-/g, "/") : "");

// 120×90 の原寸のまま出す（拡大・縮小・切り抜きをしない）
const Thumb: React.FC<{ id: string }> = ({ id }) => (
  <img
    src={thumbUrl(id)}
    width={120}
    height={90}
    alt=""
    loading="lazy"
    className="shrink-0 block"
    style={{ width: 120, height: 90, maxWidth: "none" }}
  />
);

// 押すと拡大して再生する（見る）。押せることが分かるよう再生の印を重ねる（印は画像の上で、プレイヤーの上ではない）
const ThumbButton: React.FC<{ id: string; onClick: () => void; label: string }> = ({ id, onClick, label }) => (
  <button type="button" onClick={onClick} className="relative shrink-0 block" aria-label={label} style={{ width: 120, height: 90 }}>
    <Thumb id={id} />
    <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
      <span aria-hidden="true" className="material-symbols-outlined leading-none" style={{ fontSize: "32px", color: C.white, background: "rgba(0,0,0,0.55)", padding: 4 }}>play_arrow</span>
    </span>
  </button>
);

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="px-3 pt-2 pb-1 text-[0.6875rem] font-bold uppercase tracking-[0.1em]" style={{ color: C.secondary }}>
    {children}
  </p>
);

export const HintField: React.FC<HintFieldProps> = ({ genre, onChange, resetKey, inputClassName, initial, inputId }) => {
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<Selected | null>(null);
  const [timeText, setTimeText] = useState("0:00");
  const [results, setResults] = useState<CatalogVideo[]>([]);
  const [chapterResults, setChapterResults] = useState<CatalogChapter[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const playerRef = useRef<HintPlayerApi>(null);
  // サムネイルを押して拡大して見ている動画（見る）。窓の中の「この位置でヒントにする」で選ぶ（決める）
  const [preview, setPreview] = useState<Selected | null>(null);
  const previewRef = useRef<HintPlayerApi>(null);
  // 拡大して見る窓のキーボードの作法（2026-10-06 アクセシビリティの直し）
  const previewDialog = useDialog({ active: !!preview, onClose: () => setPreview(null) });

  useEffect(() => {
    // 空に戻す時は、走っている検索・確かめの返事を捨てる（古い返事で欄が埋まらないように）
    seq.current++;
    setBusy(false);
    setText("");
    setSelected(initial ?? null);
    setTimeText(initial?.hint.kind === "youtube" ? formatTime(initial.hint.startSec) : "0:00");
    setResults([]);
    setChapterResults([]);
    setMessage("");
  }, [resetKey]);

  // 選んだヒントと時刻を親に知らせる。時刻が読めない間は「まだ無い」扱い
  useEffect(() => {
    if (!selected) return onChange(null);
    if (selected.hint.kind === "youtube") {
      const sec = parseTimeInput(timeText);
      onChange(sec === null ? null : { ...selected.hint, startSec: sec });
    } else onChange(selected.hint);
  }, [selected, timeText]);

  const choose = (s: Selected) => {
    setSelected(s);
    setResults([]);
    setChapterResults([]);
    setMessage("");
    if (s.hint.kind === "youtube") setTimeText(formatTime(s.hint.startSec));
  };

  const handleText = (v: string) => {
    setText(v);
    setMessage("");
    const my = ++seq.current;
    const t = v.trim();
    if (!t) {
      setResults([]);
      setChapterResults([]);
      return;
    }
    if (looksLikeUrl(t)) {
      setResults([]);
      setChapterResults([]);
      const yt = parseYouTubeUrl(t);
      if (yt) {
        if (genre === "hello") {
          setBusy(true);
          isCatalogVideo(yt.videoId)
            .then((ok) => {
              if (my !== seq.current) return;
              if (ok) choose({ hint: { kind: "youtube", videoId: yt.videoId, startSec: yt.startSec }, label: t });
              else setMessage("ハロプロのヒントに使える YouTube は、HELLO! VIDEO に載っている動画だけです。題名や曲名で検索して選んでください。");
            })
            .catch(() => my === seq.current && setMessage("動画を確かめられませんでした。時間をおいてもう一度お試しください。"))
            .finally(() => my === seq.current && setBusy(false));
        } else {
          choose({ hint: { kind: "youtube", videoId: yt.videoId, startSec: yt.startSec }, label: t });
        }
        return;
      }
      if (linkProblem(t)) {
        setMessage(LINK_RULE);
        return;
      }
      choose({ hint: { kind: "link", url: t }, label: t });
      return;
    }
    if (genre === "hello") {
      // 題名と、曲・場面の区切りの両方で検索（打ち終わりを 300ms 待つ）
      window.setTimeout(() => {
        if (my !== seq.current) return;
        setBusy(true);
        Promise.all([searchCatalogVideos(t), searchCatalogChapters(t)])
          .then(([vids, chaps]) => {
            if (my !== seq.current) return;
            setResults(vids);
            setChapterResults(chaps);
            if (vids.length === 0 && chaps.length === 0) setMessage("見つかりませんでした。");
          })
          .catch(() => my === seq.current && setMessage("動画を探せませんでした。時間をおいてもう一度お試しください。"))
          .finally(() => my === seq.current && setBusy(false));
      }, 300);
    } else {
      setMessage("URL を貼ってください。");
    }
  };

  if (selected) {
    const isYt = selected.hint.kind === "youtube";
    const sec = isYt ? parseTimeInput(timeText) : null;
    const timeOk = !isYt || sec !== null;
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2 px-3 py-2 bg-surface-container-low">
          <span className="text-[0.6875rem] font-bold uppercase tracking-[0.1em] shrink-0 pt-0.5" style={{ color: C.secondary }}>
            {isYt ? "YouTube" : "リンク"}
          </span>
          <span className="flex-1 text-sm break-all" style={{ color: C.ink }}>{selected.label}</span>
          <button
            type="button"
            onClick={() => {
              seq.current++;
              setBusy(false);
              setSelected(null);
              setText("");
            }}
            className="shrink-0 p-0.5 hover:bg-surface-container-high transition-colors"
            aria-label="ヒントを外す"
          >
            <span aria-hidden="true" className="material-symbols-outlined leading-none" style={{ fontSize: "16px", color: C.secondary }}>close</span>
          </button>
        </div>
        {isYt && (
          <div className="flex items-center gap-2 flex-wrap">
            <label htmlFor={inputId ? `${inputId}-time` : undefined} className="text-xs font-bold shrink-0" style={{ color: C.secondary }}>開始時刻</label>
            <input
              id={inputId ? `${inputId}-time` : undefined}
              value={timeText}
              onChange={(e) => setTimeText(e.target.value)}
              placeholder="1:23"
              inputMode="numeric"
              className={inputClassName}
              style={{ maxWidth: 120 }}
            />
            <button
              type="button"
              onClick={() => {
                const t = playerRef.current?.getCurrentTime();
                if (typeof t === "number") setTimeText(formatTime(Math.max(0, Math.floor(t))));
              }}
              className="shrink-0 flex items-center gap-1 px-3 py-2 text-xs font-bold hover:opacity-80 transition-opacity"
              style={{ background: C.black, color: C.white }}
            >
              <span aria-hidden="true" className="material-symbols-outlined leading-none" style={{ fontSize: "16px" }}>pin_drop</span>
              今の位置にする
            </button>
          </div>
        )}
        {!timeOk && <p className="text-xs" style={{ color: C.error }}>時刻は「1:23」の形で入れてください。</p>}
        {selected.hint.kind === "youtube" && (
          <HintPlayer
            key={selected.hint.videoId}
            ref={playerRef}
            videoId={selected.hint.videoId}
            startSec={sec}
            onUnavailable={() => {
              // 削除・非公開・埋め込みが許可されていない動画は、解く人が見られないので選べなくする（Hop 決定 2026-10-04）
              setSelected(null);
              setMessage(UNUSABLE);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <input
        id={inputId}
        value={text}
        onChange={(e) => handleText(e.target.value)}
        placeholder={genre === "hello" ? "動画の題名・曲名で検索、または URL を貼る" : "YouTube などの URL を貼る"}
        className={inputClassName}
      />
      {busy && <p className="text-xs" style={{ color: C.secondary }}>読み込み中…</p>}
      {(results.length > 0 || chapterResults.length > 0) && (
        <div className="max-h-96 overflow-y-auto bg-surface-container-low">
          {results.length > 0 && (
            <>
              <SectionLabel>動画</SectionLabel>
              <ul>
                {results.map((r) => (
                  <li key={r.video_id} className="flex items-start gap-3 px-3 py-2">
                    <ThumbButton
                      id={r.video_id}
                      label={`${r.title} を再生して見る`}
                      onClick={() => setPreview({ hint: { kind: "youtube", videoId: r.video_id, startSec: 0 }, label: r.title })}
                    />
                    <button
                      type="button"
                      onClick={() => choose({ hint: { kind: "youtube", videoId: r.video_id, startSec: 0 }, label: r.title })}
                      className="flex-1 min-w-0 text-left hover:bg-surface-container-high transition-colors"
                    >
                      <span className="block min-w-0">
                        <span className="block text-sm" style={{ color: C.ink }}>{r.title}</span>
                        {r.channel_name && <span className="block text-xs" style={{ color: C.secondary }}>{r.channel_name}</span>}
                        {r.published_at && <span className="block text-xs" style={{ color: C.secondary }}>{dateText(r.published_at)}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {chapterResults.length > 0 && (
            <>
              <SectionLabel>曲・場面</SectionLabel>
              <ul>
                {chapterResults.map((c) => (
                  <li key={`${c.video_id}-${c.seq}`} className="flex items-start gap-3 px-3 py-2">
                    <ThumbButton
                      id={c.video_id}
                      label={`${c.song_title} を再生して見る`}
                      onClick={() => setPreview({ hint: { kind: "youtube", videoId: c.video_id, startSec: c.startSec }, label: `${c.song_title} / ${c.videoTitle}` })}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        choose({
                          hint: { kind: "youtube", videoId: c.video_id, startSec: c.startSec },
                          label: `${c.song_title} / ${c.videoTitle}`,
                        })
                      }
                      className="flex-1 min-w-0 text-left hover:bg-surface-container-high transition-colors"
                    >
                      <span className="block min-w-0">
                        <span className="block text-sm font-bold" style={{ color: C.ink }}>{c.song_title}</span>
                        {c.group_name && <span className="block text-xs" style={{ color: C.secondary }}>{c.group_name}</span>}
                        <span className="block text-xs" style={{ color: C.secondary }}>{c.videoTitle}</span>
                        <span className="block text-xs" style={{ color: C.secondary }}>{formatTime(c.startSec)} から</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {message && <p className="text-xs" style={{ color: C.secondary }}>{message}</p>}

      {/* 拡大して見る窓。動画の上には何も重ねず、操作は動画の下に置く（YouTube の決まり） */}
      {preview && preview.hint.kind === "youtube" && (
        <div
          ref={previewDialog}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={(e) => e.target === e.currentTarget && setPreview(null)}
          role="dialog"
          aria-modal="true"
          aria-label={preview.label}
        >
          <div className="w-full max-w-[640px] bg-white p-4 space-y-3">
            <p className="text-sm font-bold" style={{ color: C.ink }}>{preview.label}</p>
            <HintPlayer
              key={`preview-${preview.hint.videoId}-${preview.hint.startSec}`}
              ref={previewRef}
              videoId={preview.hint.videoId}
              startSec={preview.hint.startSec}
              onUnavailable={() => {
                setPreview(null);
                setMessage(UNUSABLE);
              }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const t = previewRef.current?.getCurrentTime();
                  const start = typeof t === "number" && t > 0 ? Math.floor(t) : preview.hint.kind === "youtube" ? preview.hint.startSec : 0;
                  if (preview.hint.kind === "youtube") choose({ hint: { ...preview.hint, startSec: start }, label: preview.label });
                  setPreview(null);
                }}
                className="flex-1 flex items-center justify-center gap-1 px-3 py-3 text-sm font-bold hover:opacity-80 transition-opacity"
                style={{ background: C.black, color: C.white }}
              >
                <span aria-hidden="true" className="material-symbols-outlined leading-none" style={{ fontSize: "16px" }}>pin_drop</span>
                この位置でヒントにする
              </button>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="px-4 py-3 text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors"
                style={{ color: C.ink }}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
