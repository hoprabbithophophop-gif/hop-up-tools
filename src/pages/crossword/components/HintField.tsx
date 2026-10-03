// 作る画面の「ヒント」欄（HarmonyPalette に無い、足した物）。
// ハロプロ: YouTube は HELLO! VIDEO の台帳から題名で検索して選ぶ。URL を貼った時は台帳にあるか確かめ、無ければ受け付けない
// その他: YouTube の URL を貼ると時刻が欄に入る（直せる）
// どちらのジャンルも YouTube 以外のリンクは「リンク」として貼れる
import React, { useEffect, useRef, useState } from "react";
import type { Genre, HintRef } from "../../../lib/crossword/puzzleStore";
import { isCatalogVideo, searchCatalogVideos, type CatalogVideo } from "../../../lib/crossword/puzzleStore";
import { formatTime, parseTimeInput, parseYouTubeUrl } from "../../../lib/crossword/youtubeUrl";
import { C } from "../style";

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
}

const looksLikeUrl = (t: string) => /^https?:\/\//i.test(t.trim());

export const HintField: React.FC<HintFieldProps> = ({ genre, onChange, resetKey, inputClassName, initial }) => {
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<Selected | null>(null);
  const [timeText, setTimeText] = useState("0:00");
  const [results, setResults] = useState<CatalogVideo[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    setText("");
    setSelected(initial ?? null);
    setTimeText(initial?.hint.kind === "youtube" ? formatTime(initial.hint.startSec) : "0:00");
    setResults([]);
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
      return;
    }
    if (looksLikeUrl(t)) {
      setResults([]);
      const yt = parseYouTubeUrl(t);
      if (yt) {
        if (genre === "hello") {
          setBusy(true);
          isCatalogVideo(yt.videoId)
            .then((ok) => {
              if (my !== seq.current) return;
              if (ok) choose({ hint: { kind: "youtube", videoId: yt.videoId, startSec: yt.startSec }, label: t });
              else setMessage("ハロプロのヒントに使える YouTube は、HELLO! VIDEO に載っている動画だけです。題名で検索して選んでください。");
            })
            .catch(() => my === seq.current && setMessage("動画を確かめられませんでした。時間をおいてもう一度お試しください。"))
            .finally(() => my === seq.current && setBusy(false));
        } else {
          choose({ hint: { kind: "youtube", videoId: yt.videoId, startSec: yt.startSec }, label: t });
        }
        return;
      }
      choose({ hint: { kind: "link", url: t }, label: t });
      return;
    }
    if (genre === "hello") {
      // 題名で検索（打ち終わりを 300ms 待つ）【仮】
      window.setTimeout(() => {
        if (my !== seq.current) return;
        setBusy(true);
        searchCatalogVideos(t)
          .then((rows) => {
            if (my !== seq.current) return;
            setResults(rows);
            if (rows.length === 0) setMessage("見つかりませんでした。");
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
    const timeOk = !isYt || parseTimeInput(timeText) !== null;
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2 px-3 py-2 bg-surface-container-low">
          <span className="text-[0.6875rem] font-bold uppercase tracking-[0.1em] shrink-0 pt-0.5" style={{ color: C.secondary }}>
            {isYt ? "YouTube" : "Link"}
          </span>
          <span className="flex-1 text-sm break-all" style={{ color: C.ink }}>{selected.label}</span>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setText("");
            }}
            className="shrink-0 p-0.5 hover:bg-surface-container-high transition-colors"
            aria-label="ヒントを外す"
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: "16px", color: C.secondary }}>close</span>
          </button>
        </div>
        {isYt && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-bold shrink-0" style={{ color: C.secondary }}>開始時刻</label>
            <input
              value={timeText}
              onChange={(e) => setTimeText(e.target.value)}
              placeholder="1:23"
              inputMode="numeric"
              className={inputClassName}
              style={{ maxWidth: 120 }}
            />
          </div>
        )}
        {!timeOk && <p className="text-xs" style={{ color: C.error }}>時刻は「1:23」の形で入れてください。</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <input
        value={text}
        onChange={(e) => handleText(e.target.value)}
        placeholder={genre === "hello" ? "動画の題名で検索、または URL を貼る" : "YouTube などの URL を貼る"}
        className={inputClassName}
      />
      {busy && <p className="text-xs" style={{ color: C.secondary }}>Loading...</p>}
      {results.length > 0 && (
        <ul className="max-h-56 overflow-y-auto bg-surface-container-low">
          {results.map((r) => (
            <li key={r.video_id}>
              <button
                type="button"
                onClick={() => choose({ hint: { kind: "youtube", videoId: r.video_id, startSec: 0 }, label: r.title })}
                className="w-full text-left px-3 py-2 hover:bg-surface-container-high transition-colors"
              >
                <span className="block text-sm" style={{ color: C.ink }}>{r.title}</span>
                {r.channel_name && <span className="block text-xs" style={{ color: C.secondary }}>{r.channel_name}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && <p className="text-xs" style={{ color: C.secondary }}>{message}</p>}
    </div>
  );
};
