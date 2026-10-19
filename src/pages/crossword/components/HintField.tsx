// 作る画面の「ヒント」欄（HarmonyPalette に無い、足した物）。
// ハロプロ: YouTube は HELLO! VIDEO の台帳から題名・曲名で検索する。結果のサムネイルを押すと拡大の窓で再生して見られ（見る）、窓の「この位置でヒントにする」か題名側を押すと選ぶ（決める）。URL を貼った時は台帳にあるか確かめ、無ければ YouTube にチャンネル名を聞いて添える（聞けなければ使えない。Hop 決定 2026-10-19 案1）。形の崩れた YouTube の住所はリンクとしても通さない
// その他: YouTube の URL を貼ると時刻が欄に入る（直せる）
// 選んだ YouTube はその場で埋め込み、開始時刻の位置で止めて出す。「今の位置にする」で時刻を入れられる
// どちらのジャンルも YouTube 以外のリンクは「リンク」として貼れる（再生しない）
import React, { useEffect, useRef, useState } from "react";
import type { Genre, HintRef } from "../../../lib/crossword/puzzleStore";
import {
  isCatalogVideo,
  lookupVideoChannel,
  searchCatalogChapters,
  searchCatalogVideos,
  type CatalogChapter,
  type CatalogVideo,
} from "../../../lib/crossword/puzzleStore";
import { formatTime, parseTimeInput, parseYouTubeUrl, linkProblem, isYouTubeHost } from "../../../lib/crossword/youtubeUrl";
import { OFFICIAL_BLOGS, officialBlogSearchQuery, officialBlogSearchUrl } from "../../../data/officialBlogs";
import { OFFICIAL_ACCOUNT_GROUPS, officialXSearchQuery, officialXSearchUrl, officialIgSearchQuery, officialIgSearchUrl, igAccountUrl } from "../../../data/officialAccounts";
import { periodYears, type SearchPeriod } from "../../../lib/crossword/searchPeriod";
import { AccountTag } from "./HintView";
import { HINT_SOURCES, HintSourceBar, sourceOfUrl, type HintSource } from "./HintSourceBar";
import { C } from "../style";
import { HintPlayer, type HintPlayerApi } from "./HintPlayer";
import { useDialog } from "./useDialog";

// 再生できない動画（削除・非公開・埋め込み禁止）を選んだ時の知らせ
const UNUSABLE = "この動画はヒントに使えません。";
// リンクの決まりに合わない時（Hop 決定 2026-10-04）
const LINK_RULE = "リンクは https から始まる URL だけ使えます。"; // Hop 決定 2026-10-06
// 動画番号が読めない形の YouTube の住所（? 抜け・番号の字足らず）。一般のリンクとしては通さない（2026-10-19 抜け穴ふさぎ）【仮】
const YT_FORM = "YouTube の URL の形が違います。動画のページの URL をそのまま貼ってください。";
// チャンネル名を聞けなかった（削除・非公開・埋め込み禁止・通信）【仮】
const YT_UNKNOWN = "この動画を確かめられませんでした。削除・非公開・埋め込み禁止になっていないかご確認ください。";
// 台帳に無い動画に添える一言（ハロプロだけ。Hop 2026-10-19「公式情報をヒントにしてもらえると」）【仮】
const CHECK_OFFICIAL = "公式の発信か確かめてください。";

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
  // 出どころの印（Hop 決定 2026-10-19 案A-2）。初期は YouTube。URL を貼ると行き先に合わせて切り替わる
  const [source, setSource] = useState<HintSource>("yt");
  // 公式ブログを探す（アメブロの印の時だけ。Google の site: 検索を新しいタブで開くだけ）
  const [blogGroupKey, setBlogGroupKey] = useState(OFFICIAL_BLOGS[0].key);
  const [blogKeyword, setBlogKeyword] = useState("");
  // 公式の投稿を探す（X の印の時だけ。x.com の検索を新しいタブで開くだけ。Hop 決定 2026-10-19「公式サイトに載っている分だけ」）
  const [xGroupKey, setXGroupKey] = useState(OFFICIAL_ACCOUNT_GROUPS[0].key);
  const [xKeyword, setXKeyword] = useState("");
  // いつごろ（年・月。アメブロと X で共通。空なら期間なし。Hop 依頼 2026-10-19 案A）
  const [periodYear, setPeriodYear] = useState("");
  const [periodMonth, setPeriodMonth] = useState("");
  // 「コピー」の結果の一言
  const [copied, setCopied] = useState("");
  // 公式アカウントを開く（Instagram の印の時だけ。Instagram は言葉で探せないので、アカウントのページを開くだけ）
  const [igHandle, setIgHandle] = useState(OFFICIAL_ACCOUNT_GROUPS[0].ig[0]);
  const [igKeyword, setIgKeyword] = useState("");
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
    setSource(!initial ? "yt" : initial.hint.kind === "youtube" ? "yt" : sourceOfUrl(initial.hint.url));
    setBlogKeyword("");
    setXKeyword("");
    setIgKeyword("");
    setPeriodYear("");
    setPeriodMonth("");
    setCopied("");
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
      setSource(sourceOfUrl(t));
      const yt = parseYouTubeUrl(t);
      if (yt) {
        // 台帳にある動画はそのまま。無い動画（外のチャンネル）はチャンネル名を聞いて添える。聞けない動画は使えない（Hop 決定 2026-10-19 案1）
        setBusy(true);
        (genre === "hello" ? isCatalogVideo(yt.videoId) : Promise.resolve(false))
          .catch(() => false)
          .then(async (inCatalog) => {
            if (inCatalog) return { hint: { kind: "youtube" as const, videoId: yt.videoId, startSec: yt.startSec }, label: t };
            const channel = await lookupVideoChannel(yt.videoId);
            if (!channel) return null;
            return { hint: { kind: "youtube" as const, videoId: yt.videoId, startSec: yt.startSec, channel }, label: t };
          })
          .then((picked) => {
            if (my !== seq.current) return;
            if (picked) choose(picked);
            else setMessage(YT_UNKNOWN);
          })
          .finally(() => my === seq.current && setBusy(false));
        return;
      }
      if (isYouTubeHost(t)) {
        setMessage(YT_FORM);
        return;
      }
      if (linkProblem(t)) {
        setMessage(LINK_RULE);
        return;
      }
      choose({ hint: { kind: "link", url: t }, label: t });
      return;
    }
    if (genre === "hello" && source === "yt") {
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
    const picked = selected.hint;
    const isYt = picked.kind === "youtube";
    const sec = isYt ? parseTimeInput(timeText) : null;
    const timeOk = !isYt || sec !== null;
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2 px-3 py-2 bg-surface-container-low">
          <span data-hint-kind="" className="text-[0.6875rem] font-bold uppercase tracking-[0.1em] shrink-0 pt-0.5" style={{ color: C.secondary }}>
            {picked.kind === "youtube" ? "YouTube" : (HINT_SOURCES.find((s) => s.key === sourceOfUrl(picked.url))?.label ?? "リンク")}
          </span>
          <span className="flex-1 min-w-0 text-sm break-all" style={{ color: C.ink }}>
            {selected.label}
            {selected.hint.kind === "youtube" && selected.hint.channel && (
              <span data-hint-channel="" className="block text-xs pt-1" style={{ color: C.secondary }}>
                {`チャンネル: ${selected.hint.channel}`}
                {genre === "hello" && ` ${CHECK_OFFICIAL}`}
              </span>
            )}
            {/* X・Instagram は URL のアカウント名を公式サイトの名簿と照らして札を添える（ハロプロだけ。止めはしない） */}
            {picked.kind === "link" && genre === "hello" && <AccountTag url={picked.url} className="block text-xs pt-1" />}
          </span>
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

  const selectClassName = "flex-1 min-w-0 h-10 bg-surface-container-low px-2 text-base focus:outline-none focus:shadow-[inset_0_-2px_0_#000]";
  const period: SearchPeriod | null = periodYear ? { year: Number(periodYear), month: periodMonth ? Number(periodMonth) : undefined } : null;
  const blogGroup = OFFICIAL_BLOGS.find((g) => g.key === blogGroupKey) ?? OFFICIAL_BLOGS[0];
  const blogSearchHref = blogKeyword.trim() ? officialBlogSearchUrl(blogGroup, blogKeyword, period) : null;
  const blogSearchText = blogKeyword.trim() ? officialBlogSearchQuery(blogGroup, blogKeyword, period) : null;
  const xGroup = OFFICIAL_ACCOUNT_GROUPS.find((g) => g.key === xGroupKey) ?? OFFICIAL_ACCOUNT_GROUPS[0];
  const xSearchHref = xKeyword.trim() ? officialXSearchUrl(xGroup, xKeyword, period) : null;
  const xSearchText = xKeyword.trim() ? officialXSearchQuery(xGroup, xKeyword, period) : null;
  const igSearchHref = igKeyword.trim() ? officialIgSearchUrl(igHandle, igKeyword, period) : null;
  const igSearchText = igKeyword.trim() ? officialIgSearchQuery(igHandle, igKeyword, period) : null;
  // 組み立てた検索の言葉をそのままクリップボードにコピーする（X や Google の画面で手直しして使えるように。Hop 依頼 2026-10-19）
  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("コピーしました。");
    } catch {
      setCopied("コピーできませんでした。");
    }
  };
  const copyButton = (text: string | null, testId: string) => (
    <button
      type="button"
      data-helper-copy={testId}
      data-copy-text={text ?? ""}
      disabled={!text}
      onClick={() => text && copyText(text)}
      className={`shrink-0 inline-flex items-center gap-1 h-10 px-3 text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors whitespace-nowrap ${text ? "" : "opacity-40 cursor-default"}`}
      style={{ color: C.ink }}
      aria-label="検索の言葉をコピー"
    >
      <span aria-hidden="true" className="material-symbols-outlined leading-none" style={{ fontSize: "16px" }}>content_copy</span>
      コピー
    </button>
  );
  // いつごろ（年・月）。選ばなければ期間なし
  const periodPicker = (
    <div data-helper-period="" className="basis-full flex gap-2">
      <select aria-label="いつごろ（年）" value={periodYear} onChange={(e) => { setPeriodYear(e.target.value); if (!e.target.value) setPeriodMonth(""); }} className={selectClassName} style={{ color: C.ink }}>
        <option value="">いつごろ（年）</option>
        {periodYears().map((y) => (
          <option key={y} value={String(y)}>{`${y}年`}</option>
        ))}
      </select>
      <select aria-label="いつごろ（月）" value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} disabled={!periodYear} className={`${selectClassName} ${periodYear ? "" : "opacity-40"}`} style={{ color: C.ink }}>
        <option value="">月を選ばない</option>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <option key={m} value={String(m)}>{`${m}月`}</option>
        ))}
      </select>
    </div>
  );
  // 探す補助のボタン（アメブロ・X で同じ見た目）
  const helperLink = (href: string | null, label: string, testId: string) => (
    <a
      data-helper-link={testId}
      href={href ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      aria-disabled={!href}
      onClick={(e) => { if (!href) e.preventDefault(); }}
      className={`flex-1 inline-flex items-center justify-center h-10 px-3 text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors whitespace-nowrap ${href ? "" : "opacity-40 cursor-default"}`}
      style={{ color: C.ink }}
    >
      {label}
    </a>
  );
  // 出どころごとの欄の説明【仮】
  const placeholder =
    source === "yt"
      ? genre === "hello"
        ? "動画の題名・曲名で検索、または URL を貼る"
        : "YouTube の URL を貼る"
      : source === "ameblo"
        ? "記事の URL を貼る"
        : source === "x" || source === "ig"
          ? "公式アカウントの投稿の URL を貼る"
          : "公式サイトなどの URL を貼る";
  return (
    <div className="space-y-2">
      <HintSourceBar value={source} onChange={(s) => { setSource(s); setMessage(""); setCopied(""); setResults([]); setChapterResults([]); }} idPrefix={inputId ? `${inputId}-src` : undefined} />
      {/* 公式ブログを探す（アメブロの印・ハロプロだけ。Hop 依頼 2026-10-19。棚は触らず Google を新しいタブで開くだけ） */}
      {source === "ameblo" && genre === "hello" && (
        <div data-blog-search="" className="flex flex-wrap items-stretch gap-2">
          <input
            aria-label="公式ブログを探す言葉"
            value={blogKeyword}
            onChange={(e) => { setBlogKeyword(e.target.value); setCopied(""); }}
            placeholder="公式ブログを探す言葉（例: 武道館）"
            className={`${inputClassName} basis-full min-w-0`}
          />
          <select
            aria-label="公式ブログのグループ"
            value={blogGroupKey}
            onChange={(e) => setBlogGroupKey(e.target.value)}
            className={`${selectClassName} basis-full`}
            style={{ color: C.ink }}
          >
            {OFFICIAL_BLOGS.map((g) => (
              <option key={g.key} value={g.key}>{g.label}</option>
            ))}
          </select>
          {periodPicker}
          <div className="basis-full flex gap-2">
            {helperLink(blogSearchHref, "公式ブログを探す", "blog")}
            {copyButton(blogSearchText, "blog")}
          </div>
          {copied && <p className="basis-full text-xs" style={{ color: C.secondary }}>{copied}</p>}
        </div>
      )}
      {/* 公式の投稿を探す（X の印・ハロプロだけ。公式サイトに載っているグループのアカウントの投稿を x.com で新しい順に探す） */}
      {source === "x" && genre === "hello" && (
        <div data-x-search="" className="flex flex-wrap items-stretch gap-2">
          <input
            aria-label="公式の投稿を探す言葉"
            value={xKeyword}
            onChange={(e) => { setXKeyword(e.target.value); setCopied(""); }}
            placeholder="公式の投稿を探す言葉（例: 武道館）"
            className={`${inputClassName} basis-full min-w-0`}
          />
          <select
            aria-label="公式アカウントのグループ"
            value={xGroupKey}
            onChange={(e) => setXGroupKey(e.target.value)}
            className={`${selectClassName} basis-full`}
            style={{ color: C.ink }}
          >
            {OFFICIAL_ACCOUNT_GROUPS.map((g) => (
              <option key={g.key} value={g.key}>{g.label}</option>
            ))}
          </select>
          {periodPicker}
          <div className="basis-full flex gap-2">
            {helperLink(xSearchHref, "公式の投稿を探す", "x")}
            {copyButton(xSearchText, "x")}
          </div>
          {copied && <p className="basis-full text-xs" style={{ color: C.secondary }}>{copied}</p>}
        </div>
      )}
      {/* 公式アカウントの投稿を探す（Instagram の印・ハロプロだけ。グループの次にメンバーのアカウントが続く。名前はアカウント名のまま）。
          Instagram 自身に期間の指定が無いので、言葉と期間は Google（site:instagram.com/アカウント名）に頼む。Google が拾っている投稿だけが対象（Hop 決定 2026-10-19） */}
      {source === "ig" && genre === "hello" && (
        <div data-ig-open="" className="flex flex-wrap items-stretch gap-2">
          <input
            aria-label="公式の投稿を探す言葉"
            value={igKeyword}
            onChange={(e) => { setIgKeyword(e.target.value); setCopied(""); }}
            placeholder="公式の投稿を探す言葉（例: 武道館）"
            className={`${inputClassName} basis-full min-w-0`}
          />
          <select
            aria-label="公式アカウント"
            value={igHandle}
            onChange={(e) => setIgHandle(e.target.value)}
            className={`${selectClassName} basis-full`}
            style={{ color: C.ink }}
          >
            {OFFICIAL_ACCOUNT_GROUPS.map((g) => (
              <optgroup key={g.key} label={g.label}>
                {g.ig.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {periodPicker}
          <div className="basis-full flex gap-2">
            {helperLink(igSearchHref, "Google で探す", "ig-search")}
            {copyButton(igSearchText, "ig")}
          </div>
          <div className="basis-full flex">{helperLink(igAccountUrl(igHandle), "Instagram で開く", "ig")}</div>
          {copied && <p className="basis-full text-xs" style={{ color: C.secondary }}>{copied}</p>}
        </div>
      )}
      <input
        id={inputId}
        value={text}
        onChange={(e) => handleText(e.target.value)}
        placeholder={placeholder}
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
