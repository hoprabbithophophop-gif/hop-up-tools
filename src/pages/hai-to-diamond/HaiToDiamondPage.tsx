// 灰toダイヤモンド 💎 — 第1段（記録あり・みんなの💎も降る）
//
// 入口は💎ひとつ。押すとその場で曲が始まる（色は選ばない）。色は再生中に、画面下の
// 「一列でループする💎の帯」で選ぶ。真ん中に来た💎を押すと、その色の💎が画面の上から降る。
// 💎は動画の裏を通って画面の下に積もり、曲が進むにつれてカメラが引いて山が動画の背景になる。
// 動画は真ん中に固定（動画本体の上には何も描かない）。
// 再生開始はハイ！テンションと同じ流儀: ユーザーのタップの中で同期的に play() を呼ぶ。
import { useCallback, useEffect, useRef, useState } from "react";
import YouTubePlayer, { type YouTubePlayerApi } from "../hi-tension/components/YouTubePlayer";
import { ARENA_BG } from "../hi-tension/data";
import { findDiamondMember, DIAMOND_COLOR_ORDER, DIAMOND_DEFAULT_MEMBER_ID } from "./members";
import { getLastSelectedMemberId, setLastSelectedMemberId, getOrCreateAnonymousSessionId } from "../hi-tension/storage";
import { submitHiSessions } from "../hi-tension/api";
import { fetchReplay, type ReplayRow } from "./replay";
import DiamondCanvas, { type DiamondCanvasApi } from "./DiamondCanvas";
import DiamondEntry from "./DiamondEntry";
import DiamondColorCarousel from "./DiamondColorCarousel";
import DiamondHeatStrip from "./DiamondHeatStrip";
import DiamondCommentTicker, { type TickerComment } from "./DiamondCommentTicker";
import DiamondSettingsSheet, { getDiamondSettings, setDiamondSettings, type DiamondSettings } from "./DiamondSettingsSheet";
import BouncyNumber from "../hi-tension/components/BouncyNumber";

/** BEYOOOOONDS『灰toダイヤモンド』Promotion Edit（公式）。https://youtu.be/ImXkCr22kCU */
const VIDEO_ID = "_56xLKRcVYM";   // YOKOOOOOHAMA ARENA Live Edit.（2026-09-07 公開・Hop指定）。前の Promotion Edit は ImXkCr22kCU（記録の池は動画IDごとに別）
/** 額縁（動画の周りの帯）の太さ(px) */
const FRAME = 14;
/** PCでは動画を縮めて置く（ハイ！テンションと同じ幅） */
const PC_VIDEO_WIDTH = 480;
/** シェア文面（Hop確定 2026-09-06・A案）。タグとURLは指定のものだけ。URLは仮のルート名。
 *  タグは公式のリリース用タグ #輝きなビヨちゃん を含まず、歌詞そのままでもないものに。
 *  「届くよ」を「届けよ」に変えたひねり入り（Hop決定 2026-09-07） */
export const SHARE_TAG = "#銀河to銀河届けよ";
const SHARE_URL = "https://hop-up-tools.pages.dev/hai-to-diamond";
function buildShareText(count: number): string {
  return `灰toダイヤモンドに合わせて 💎を ${count.toLocaleString()}個 降らせました\n${SHARE_TAG}\n${SHARE_URL}`;
}
function shareToX(count: number) {
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(buildShareText(count))}`, "_blank", "noopener,noreferrer");
}
/** 他の人の💎を1回の時刻更新（0.1秒）で出す上限。大勢の同時押しで一気に固まらないための蓋【仮】。設定「みんなの💎」で変わる */
const OTHERS_PER_TICK: Record<DiamondSettings["crowd"], number> = { full: 25, light: 6, self: 0 };
/** 動画の縦の位置（画面の上端からの割合）。50% が真ん中。少し上に寄せて、下の帯とコメントの場所を空ける【仮】 */
const VIDEO_TOP = "42%";
/** 曲の終わり（秒）。プロモーション動画は音が終わった後に無音の黒画面（別動画への案内枠）が続くので、そこで終了扱いにする（Hop指定 2026-09-07: 4:35.9） */
const SONG_END = 280;   // Live Edit. は全長 280 秒。音が終わる時刻は未確認なので今は全長【仮】。Promotion Edit の時は 275.9 だった
/** 積もった山を一斉に夜空へ放って星空にする時刻（秒）【仮】。
 *  曲の最後のフレーズ「Let's Shine Together!」（4:29 付近）＝ハッシュタグ #銀河to銀河届けよ の「届けよ」に合わせる（Hop決定 2026-09-08）。
 *  Live Edit. 基準の値なので、動画を差し替えたら測り直す */
const LAUNCH_TIME = 268.5;   // 4:28.5。「Let's Shine Together!」に合わせて実機で聴いて確定（Hop決定 2026-09-08）
/** 「選んだ色が一番輝いた瞬間」の前後の幅（秒）【仮】 */
const HIGHLIGHT_BEFORE = 5;
const HIGHLIGHT_AFTER = 5;
/** 盛り上がりの帯を何区間に割るか【仮】 */
const HEAT_BINS = 200;
/** 盛り上がりの帯を動画の額縁の下端からどれだけ空けて置くか(px)【仮】 */
const HEAT_GAP = 8;
/** 帯の器の高さ(px)。額縁の余白＋隙間＋帯本体＋光の滲みのぶん【仮】 */
const HEAT_BOX_HEIGHT = FRAME + HEAT_GAP + 6 + 10;
/** 流れるコメントを、盛り上がりの帯の器の下からどれだけ空けて置くか(px)【仮】。
 *  帯の器には光の滲みのぶんまで含まれているので、その下端を起点にする＝滲みに文字が重ならない */
const COMMENT_GAP = 8;
/** 記録が送れなかった時に、もう一度送るまで待つ時間(ms)。
 *  受け口は1つのIPにつき1分10件までなので、1分の窓が空くのを待ってから出し直す */
const RESEND_WAIT_MS = 61_000;
/** 送り直しを試す回数の上限 */
const RESEND_MAX = 3;

/** みんなの記録（集計）を「0.05秒刻みの時刻 → [色, 個数] の並び」の帳簿にする */
type BucketEntry = [color: string, count: number];
function buildBucketMap(rows: ReplayRow[]): Map<number, BucketEntry[]> {
  const map = new Map<number, BucketEntry[]>();
  for (const r of rows) {
    const c = findDiamondMember(r.member_id)?.color;
    if (!c) continue;
    for (let i = 0; i < r.buckets.length; i++) {
      const b = r.buckets[i];
      const arr = map.get(b);
      const e: BucketEntry = [c, r.counts[i] ?? 0];
      if (arr) arr.push(e); else map.set(b, [e]);
    }
  }
  return map;
}

/** みんなの記録を、曲を等間隔に割った区間ごとの「盛り上がり具合」（0〜1）に均す。
 *  そのまま数を使うと一部の山だけが真っ白になるので、平方根を取ってから一番多い区間で割る */
function buildHeatLevels(rows: ReplayRow[]): number[] {
  const acc = new Array<number>(HEAT_BINS).fill(0);
  for (const r of rows) {
    for (let i = 0; i < r.buckets.length; i++) {
      const sec = r.buckets[i] / 20;                       // 0.05秒刻みの時刻番号 → 秒
      const idx = Math.floor((sec / SONG_END) * HEAT_BINS);
      if (idx < 0 || idx >= HEAT_BINS) continue;
      acc[idx] += r.counts[i] ?? 0;
    }
  }
  const sq = acc.map((n) => Math.sqrt(n));
  let max = 0;
  for (const v of sq) if (v > max) max = v;
  if (max <= 0) return acc.map(() => 0);
  return sq.map((v) => v / max);
}

/** 画面下の帯に並べる色。並びは members.ts の DIAMOND_COLOR_ORDER のまま。中身は変わらないので1度だけ作る */
const DIAMOND_COLOR_OPTIONS = DIAMOND_COLOR_ORDER.map((id) => ({ id, color: findDiamondMember(id)?.color ?? "#ffffff" }));

function isTouchDevice(): boolean {
  return /iPhone|iPad|iPod|Android/.test(navigator.userAgent);
}

/** 最初の色。前回この端末で最後に使った色、無ければ（または今の並びに無いIDなら）西田さんのホットピンク */
function initialMemberId(): string {
  const last = getLastSelectedMemberId();
  return last && DIAMOND_COLOR_ORDER.includes(last) ? last : DIAMOND_DEFAULT_MEMBER_ID;
}

export default function HaiToDiamondPage() {
  const playerRef = useRef<YouTubePlayerApi>(null);
  const canvasRef = useRef<DiamondCanvasApi>(null);
  const videoBoxRef = useRef<HTMLDivElement>(null);
  /** 自分がタップした「動画時刻（秒）」と「その時に選んでいた色のメンバーID」。曲の終わりに色ごとにまとめて送る */
  const tapsRef = useRef<{ t: number; memberId: string }[]>([]);
  /** いま選んでいる色（メンバーID）。入口に戻っても持ち越す＝次の回の最初の色になる */
  const [memberId, setMemberId] = useState<string>(initialMemberId);
  /** 長押しの連打は押し始めの時点の値を抱え込むので、色は state ではなくこの控えから読む */
  const memberIdRef = useRef(memberId);
  /** 入口の💎を押して曲を始めたか。false の間は入口を出す */
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  /** 曲が終わった後の画面（自分の回数・最初に戻る・シェア）。再生開始で消える */
  const [ended, setEnded] = useState(false);
  const [finalCount, setFinalCount] = useState(0);
  /** ハイライト再生中（終了画面から「選んだ色が一番輝いた瞬間」を見ている間）。終わる時刻を持つ */
  const highlightRef = useRef<{ end: number } | null>(null);
  const [highlighting, setHighlighting] = useState(false);
  /** その回で山を夜空へ放したか。1回だけ呼ぶための控え（「はじめる」でまた false に戻る） */
  const launchedRef = useRef(false);
  /** 頭出し（seek）を頼んだ直後の控え。時刻は0.1秒ごとの見に行きなので、頭出しが効く前に
   *  古い時刻が届く。飛び先の近くに来るまで（または期限切れまで）その時刻は無視する */
  const seekPendingRef = useRef<{ target: number; until: number } | null>(null);
  /** いま選んでいる色が一番輝いた時刻。無ければ見返すボタンを出さない */
  const [peakTime, setPeakTime] = useState<number | null>(null);
  /** 再生中の自分の回数（動画の上に出す）。ページは小さいのでタップごとの再描画で足りる */
  const [liveCount, setLiveCount] = useState(0);
  /** みんなの累計（集計の合計）。読み込み前は null＝入口に「0」を出さない */
  const [othersTotal, setOthersTotal] = useState<number | null>(null);
  /** 盛り上がりの帯の元データ（区間ごとの0〜1）と、いま再生している位置（0〜1） */
  const [heatLevels, setHeatLevels] = useState<number[]>([]);
  const [progress, setProgress] = useState(0);
  /** 動画に付いている YouTube のコメント。動画の下に流す。取れなければ空のまま＝何も出ない */
  const [comments, setComments] = useState<TickerComment[]>([]);
  /** 流れるコメントに渡す動画時刻（秒）。本文の分:秒と見比べるだけなので1秒刻みに丸める＝
   *  0.1秒ごとの見に行きのたびにページ全体を描き直さない */
  const [videoTimeSec, setVideoTimeSec] = useState(0);
  const [settings, setSettings] = useState<DiamondSettings>(getDiamondSettings);
  const settingsRef = useRef(settings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 数字ブロックの下端＝動画の額縁の上端。動画の位置を測って決める（画面サイズで変わる） */
  const numbersRef = useRef<HTMLDivElement>(null);
  const [numbersBottom, setNumbersBottom] = useState<number | string>("60%");
  /** 盛り上がりの帯の置き場所。器の上端は動画の矩形の下端そのもの＝光の滲みが動画に掛からない */
  const [heatBox, setHeatBox] = useState<{ top: number; left: number; width: number } | null>(null);
  useEffect(() => {
    if (!started) return;
    const measure = () => {
      const box = videoBoxRef.current;
      const frameEl = box?.parentElement;                 // 額縁ぶんの余白を持つ div
      const root = frameEl?.parentElement;                // ページの div
      if (!box || !frameEl || !root) return;
      const vr = box.getBoundingClientRect();
      const fr = frameEl.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      setNumbersBottom(rr.bottom - vr.top + FRAME + 12);
      setHeatBox({ top: vr.bottom - rr.top, left: fr.left - rr.left, width: fr.width });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [started]);
  // 動画に付いているコメントを読む。再生が始まってから1回だけ（入口では要らない）。
  // 失敗しても何も言わずに空のまま＝コメントの帯は出ない
  useEffect(() => {
    if (!started) return;
    let stale = false;
    fetch(`/api/hai-to-diamond-comments?video_id=${encodeURIComponent(VIDEO_ID)}`, { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => { if (!stale && Array.isArray(rows)) setComments(rows as TickerComment[]); })
      .catch(() => { /* コメントは無くても本編は成り立つので黙って諦める */ });
    return () => { stale = true; };
  }, [started]);

  const handleSettingsChange = useCallback((next: DiamondSettings) => {
    settingsRef.current = next;
    setSettings(next);
    setDiamondSettings(next);
  }, []);
  /** みんなの記録（動画時刻の帳簿）。読み込み前は空 */
  const bucketMapRef = useRef<Map<number, BucketEntry[]>>(new Map());
  const lastBucketRef = useRef(-1);
  /** まだ送れていない記録（メンバーID → 押した時刻の並び）。送れたぶんから消していく */
  const pendingRef = useRef<Map<string, number[]>>(new Map());
  /** 曲の終わりに記録を色ごとにまとめる作業を済ませたか（1回だけ） */
  const groupedRef = useRef(false);
  /** いま送信中か（曲の終わりの合図が二重に来ても、送りが重ならないようにする） */
  const sendingRef = useRef(false);
  const resendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resendCountRef = useRef(0);

  // みんなの記録（集計）を読む。入口を開いた時と、「はじめる」のたびに読み直す。
  // 開いた時の1回だけだと、同じページで2回目を遊んだ時や、その間に他の人（別の端末の自分も）が遊んだ分が
  // 歴代累計に入らない（Hop報告 2026-09-07: PCで1287→8619、続けてスマホで1317→8649）
  const loadReplay = useCallback(() => {
    fetchReplay(VIDEO_ID).then((rows) => {
      bucketMapRef.current = buildBucketMap(rows);
      setOthersTotal(rows.reduce((acc, r) => acc + r.counts.reduce((a, c) => a + c, 0), 0));
      setHeatLevels(buildHeatLevels(rows));
      // 色ごとの総数（額縁の順位の基準）。同じ色のメンバーが複数いれば合算
      const totals: Record<string, number> = {};
      for (const r of rows) {
        const c = findDiamondMember(r.member_id)?.color;
        if (!c) continue;
        totals[c] = (totals[c] ?? 0) + r.counts.reduce((a, n) => a + n, 0);
      }
      canvasRef.current?.setColorTotals(totals);
    }).catch((e) => console.warn("[hai-to-diamond] replay fetch failed:", e));
  }, []);
  useEffect(() => { loadReplay(); }, [loadReplay]);
  // 送り直し待ちのタイマーは、ページを離れる時に片付ける
  useEffect(() => () => { if (resendTimerRef.current) clearTimeout(resendTimerRef.current); }, []);

  const color = findDiamondMember(memberId)?.color ?? "#ffffff";

  const setPlayingBoth = (v: boolean) => { playingRef.current = v; setPlaying(v); };

  /** まだ送れていない記録を、色ごとに分けたまま1回の送信でまとめて送る（受け口が複数の色を受ける形・2026-09-07）。
   *  回線の不調などで断られたらそのまま取っておき、時間を空けてもう一度出し直す。送れたら帳簿を空にするので二重には送らない */
  const flushPending = useCallback(() => {
    if (sendingRef.current || pendingRef.current.size === 0) return;
    sendingRef.current = true;
    (async () => {
      try {
        const r = await submitHiSessions({
          sessions: [...pendingRef.current.entries()].map(([memberId, timestamps]) => ({ memberId, timestamps })),
          anonymousSessionId: getOrCreateAnonymousSessionId(),
          videoId: VIDEO_ID,
        });
        if (r.ok) pendingRef.current.clear();
        else console.warn("[hai-to-diamond] save failed:", r.error);
      } catch (e) {
        console.warn("[hai-to-diamond] save failed:", e);
      }
      sendingRef.current = false;
      if (pendingRef.current.size > 0 && resendCountRef.current < RESEND_MAX && !resendTimerRef.current) {
        resendCountRef.current += 1;
        resendTimerRef.current = setTimeout(() => {
          resendTimerRef.current = null;
          flushPending();
        }, RESEND_WAIT_MS);
      }
    })();
  }, []);

  /** 曲が終わったら自分の記録を送る。色ごとに分けて1回でまとめて（押していなければ送らない） */
  const submitOnce = useCallback(() => {
    if (!groupedRef.current) {
      groupedRef.current = true;
      const grouped = new Map<string, number[]>();
      for (const tap of tapsRef.current) {
        const arr = grouped.get(tap.memberId);
        if (arr) arr.push(tap.t); else grouped.set(tap.memberId, [tap.t]);
      }
      pendingRef.current = grouped;
    }
    flushPending();
  }, [flushPending]);

  const finish = useCallback(() => {
    setPlayingBoth(false);
    setFinalCount(tapsRef.current.length);
    setPeakTime(canvasRef.current?.getPeakTime() ?? null);
    setEnded(true);
    submitOnce();
  }, [submitOnce]);

  const handleEnded = useCallback(() => { finish(); }, [finish]);

  // 動画上の YouTube 純正の再生ボタンから始めた場合も拾う。1=PLAYING / 0=ENDED。PAUSED は触らない【仮】
  const handlePlayerStateChange = useCallback((state: number) => {
    if (highlightRef.current) return;               // ハイライト再生中は再生扱いにしない（💎ボタンも記録も増やさない）
    if (state === 1) { setEnded(false); setPlayingBoth(true); }
    else if (state === 0) finish();
  }, [finish]);

  /** 入口の💎＝ハイ！テンションと同じく、このタップの中で同期的に再生を始める（iOS Safari 対策）。
   *  プレイヤーは入口の裏で先に読み込み済み */
  const handleStart = useCallback(() => {
    playerRef.current?.play();
    canvasRef.current?.reset();   // 前の回の山を消して最初から（Hop報告 2026-09-07）
    const hex = findDiamondMember(memberIdRef.current)?.color;
    if (hex) canvasRef.current?.setOwnColor(hex);
    highlightRef.current = null;
    seekPendingRef.current = null;
    launchedRef.current = false;   // 次の回はまた山から
    setHighlighting(false);
    loadReplay();
    tapsRef.current = [];
    pendingRef.current.clear();
    groupedRef.current = false;
    resendCountRef.current = 0;
    if (resendTimerRef.current) { clearTimeout(resendTimerRef.current); resendTimerRef.current = null; }
    lastBucketRef.current = -1;
    setLiveCount(0);
    setProgress(0);
    setVideoTimeSec(0);
    setPeakTime(null);
    setEnded(false);
    setStarted(true);
    setPlayingBoth(true);
  }, [loadReplay]);

  /** 最初に戻る＝入口へ */
  const handleBackToStart = useCallback(() => {
    highlightRef.current = null;
    seekPendingRef.current = null;
    setHighlighting(false);
    setEnded(false);
    setPlayingBoth(false);
    setStarted(false);
  }, []);

  /** その色が一番輝いた瞬間の前後を見返す。山はそのまま、カメラも止める */
  const jumpToHighlight = useCallback((peak: number) => {
    const start = Math.max(0, peak - HIGHLIGHT_BEFORE);
    const end = Math.min(SONG_END, peak + HIGHLIGHT_AFTER);
    highlightRef.current = { end };
    seekPendingRef.current = { target: start, until: performance.now() + 800 };
    // 流れるコメントに渡す時刻も飛び先へ合わせる。曲の終わりの時刻(280秒)のまま見返しを始めると、
    // 曲の終わり際に付いた分:秒のコメントが、見返しの頭でまとめて流れてしまう
    setVideoTimeSec(Math.floor(start));
    setHighlighting(true);
    canvasRef.current?.setHoldCamera(true);
    lastBucketRef.current = Math.floor(start * 20) - 1;
    playerRef.current?.seekTo(start);
    playerRef.current?.play();
  }, []);

  /** 終了画面から、いま選んでいる色の瞬間を見返す */
  const handleHighlight = useCallback(() => {
    const peak = canvasRef.current?.getPeakTime();
    if (peak == null) return;
    jumpToHighlight(peak);
  }, [jumpToHighlight]);

  /** 色えらび。再生中は次に降る💎の色が変わる。
   *  ハイライト再生中は、その色が一番輝いた瞬間へ飛び直す（その色に記録が無ければ何もしない） */
  const handlePickColor = useCallback((id: string) => {
    const hex = findDiamondMember(id)?.color;
    if (!hex) return;
    if (highlightRef.current) {
      const peak = canvasRef.current?.getPeakTime(hex) ?? null;
      if (peak == null) return;                    // その色は一度も上位に来ていない＝飛び先が無いので選択も変えない
      memberIdRef.current = id;
      setMemberId(id);
      setLastSelectedMemberId(id);
      canvasRef.current?.setOwnColor(hex);
      setPeakTime(peak);
      jumpToHighlight(peak);
      return;
    }
    memberIdRef.current = id;
    setMemberId(id);
    setLastSelectedMemberId(id);
    canvasRef.current?.setOwnColor(hex);
    setPeakTime(canvasRef.current?.getPeakTime(hex) ?? null);
  }, [jumpToHighlight]);

  const handleTimeUpdate = useCallback((t: number) => {
    // 頭出しを頼んだ直後の古い時刻は捨てる。そのまま使うと、飛ぶ前の時刻で
    // ハイライトの終わりを過ぎたと勘違いしたり、関係ない場所のみんなの💎が降ったりする
    const sp = seekPendingRef.current;
    if (sp) {
      if (Math.abs(t - sp.target) <= 1.5 || performance.now() > sp.until) seekPendingRef.current = null;
      else return;
    }
    canvasRef.current?.setTime(t, SONG_END);
    // 盛り上がりの帯の印。0.1秒ごとに全部描き直すと重いので、位置が 1/500 変わった時だけ動かす
    const p = Math.min(1, Math.max(0, Math.round((t / SONG_END) * 500) / 500));
    setProgress((prev) => (prev === p ? prev : p));
    // 流れるコメントに渡す時刻。1秒刻みなので、秒が変わった時だけ知らせる
    const sec = Math.floor(t);
    setVideoTimeSec((prev) => (prev === sec ? prev : sec));
    // 曲の最後のフレーズで、積もった山を一斉に夜空へ放って星空にする（1回だけ）。
    // ハイライト再生中は起こさない（もう星空なので、山に戻ってはいない）
    if (!highlightRef.current && playingRef.current && !launchedRef.current && t >= LAUNCH_TIME) {
      launchedRef.current = true;
      canvasRef.current?.launchToSky();
    }
    // ハイライト再生: 区間の終わりで止めて終了画面に戻る
    const hl = highlightRef.current;
    if (hl) {
      if (t >= hl.end) {
        playerRef.current?.pause();
        highlightRef.current = null;
        setHighlighting(false);
      }
    } else if (playingRef.current && t >= SONG_END) {
      // 音が終わった後の無音・黒画面は見せない
      playerRef.current?.pause();
      finish();
      return;
    }
    // みんなの💎: 前回の時刻からいままでに押された分を、その人の色で降らせる
    const cur = Math.floor(t * 20);
    let last = lastBucketRef.current;
    if (cur < last) last = cur - 1;                 // 巻き戻し（頭出し等）
    if (cur - last > 40) last = cur - 40;           // 大きく飛んだ時は直近2秒ぶんだけ
    let budget = OTHERS_PER_TICK[settingsRef.current.crowd];
    for (let b = last + 1; b <= cur && budget > 0; b++) {
      const entries = bucketMapRef.current.get(b);
      if (!entries) continue;
      for (const [c, n] of entries) {
        for (let k = 0; k < n; k++) { if (budget-- <= 0) break; canvasRef.current?.spawn(c); }
        if (budget <= 0) break;
      }
    }
    lastBucketRef.current = cur;
  }, [finish]);

  /** 💎ボタン1回ぶん。再生中だけ受け付ける。色は押したその瞬間に選ばれているものを使う */
  const handleRecord = useCallback((): boolean => {
    if (!playingRef.current) return false;
    const id = memberIdRef.current;
    const hex = findDiamondMember(id)?.color ?? "#ffffff";
    tapsRef.current.push({ t: playerRef.current?.getCurrentTime() ?? 0, memberId: id });
    canvasRef.current?.spawn(hex, true);
    setLiveCount(tapsRef.current.length);
    return true;
  }, []);

  /** 触れた瞬間に降らせた1つを取り消す（指が滑ってスワイプになった時） */
  const handleRecordCancel = useCallback(() => {
    if (tapsRef.current.length === 0) return;
    tapsRef.current.pop();
    canvasRef.current?.undoLastSpawn();
    setLiveCount(tapsRef.current.length);
  }, []);

  return (
    <div
      style={{
        position: "relative",
        height: "100dvh",
        overflow: "hidden",
        overscrollBehavior: "none",   // 連打中に指が滑っても画面が引っ張られないように（Hop報告 2026-09-07）
        background: ARENA_BG,
        color: "#e8eaed",
        fontFamily: "Inter, 'Noto Sans JP', sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 入口。本編（プレイヤー込み）は常時マウントし、その上に重ねる＝「はじめる」の時点でプレイヤーが準備済み */}
      {!started && (
        <div style={{ position: "absolute", inset: 0, zIndex: 10 }}>
          <DiamondEntry total={othersTotal} onStart={handleStart} onOpenSettings={() => setSettingsOpen(true)} reduceMotion={settings.reduceMotion} />
        </div>
      )}
      {settingsOpen && (
        <DiamondSettingsSheet settings={settings} onChange={handleSettingsChange} onClose={() => setSettingsOpen(false)} />
      )}

      {/* 光と💎の層。動画の裏（zIndex 0） */}
      <DiamondCanvas ref={canvasRef} videoBoxRef={videoBoxRef} frame={FRAME} reduceMotion={settings.reduceMotion} />

      {/* 動画。画面の縦の真ん中より少し上に固定（Hop指示 2026-09-08。下の帯とコメントの流れ道の場所を空ける）。
          額縁ぶんの余白を空け、背景は透明にして裏のキャンバスの額縁を見せる */}
      <div
        style={{
          position: "absolute",
          zIndex: 2,
          top: VIDEO_TOP,
          left: "50%",
          transform: "translate(-50%, -50%)",
          padding: FRAME,
          width: isTouchDevice() ? "100%" : PC_VIDEO_WIDTH + FRAME * 2,
          maxWidth: "100%",
          boxSizing: "border-box",
        }}
      >
        <div ref={videoBoxRef}>
          <YouTubePlayer ref={playerRef} videoId={VIDEO_ID} onEnded={handleEnded} onTimeUpdate={handleTimeUpdate} onPlayerStateChange={handlePlayerStateChange} />
        </div>
      </div>

      {/* 盛り上がりの帯。器の上端は動画の矩形の下端に合わせ、はみ出しを切り落とす＝
          帯の光の滲みが上へ広がっても動画には掛からない（YouTube API 規約） */}
      {started && heatBox && (
        <div
          style={{
            position: "absolute",
            zIndex: 3,
            top: heatBox.top,
            left: heatBox.left,
            width: heatBox.width,
            height: HEAT_BOX_HEIGHT,
            paddingTop: FRAME + HEAT_GAP,
            boxSizing: "border-box",
            overflow: "hidden",
            pointerEvents: "none",
          }}
        >
          <DiamondHeatStrip levels={heatLevels} progress={progress} />
        </div>
      )}

      {/* 流れるコメント。盛り上がりの帯の器のさらに下（動画の矩形の外）に置く。
          本文に分:秒があるものはその時刻に、無いものはランダムな順で右から左へ流れる */}
      {started && heatBox && (playing || highlighting) && (
        <div
          style={{
            position: "absolute",
            zIndex: 3,
            top: heatBox.top + HEAT_BOX_HEIGHT + COMMENT_GAP,
            left: heatBox.left,
            width: heatBox.width,
            pointerEvents: "none",
          }}
        >
          <DiamondCommentTicker comments={comments} currentTime={videoTimeSec} reduceMotion={settings.reduceMotion} />
        </div>
      )}

      {/* 数字は動画の上の空きに置く（Hop指示 2026-09-06）。再生中は自分の回数、曲が終わったら歴代累計も並ぶ */}
      {started && (playing || ended) && (
        <div
          ref={numbersRef}
          style={{
            position: "absolute",
            zIndex: 3,
            left: 0,
            right: 0,
            bottom: numbersBottom,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.7rem",
            textAlign: "center",
            textShadow: "0 0 12px rgba(0,0,0,0.6)",
            pointerEvents: "none",
          }}
        >
          <div style={{ display: "flex", gap: "1.8rem", justifyContent: "center", alignItems: "flex-end" }}>
            <div>
              <p style={endLabelStyle}>あなたの💎</p>
              <BouncyNumber value={ended ? finalCount : liveCount} color={color} size="2.2rem" />
            </div>
            {ended && (
              <div>
                <p style={endLabelStyle}>歴代累計</p>
                <BouncyNumber value={(othersTotal ?? 0) + finalCount} color={color} size="1.6rem" />
              </div>
            )}
          </div>
          {/* 上は数字の情報、下はこの画面を離れる操作、という分け方に合わせて、見返すボタンは数字の下に置く（Hop指示 2026-09-07） */}
          {ended && !highlighting && peakTime != null && (
            <button
              type="button"
              onClick={handleHighlight}
              style={{ pointerEvents: "auto", whiteSpace: "nowrap", padding: "0.6rem 1.2rem", background: "rgba(14,16,22,0.85)", color: "#f5f7fa", border: "1px solid rgba(255,255,255,0.5)", fontSize: "0.875rem", fontWeight: 700, letterSpacing: "0.05em", cursor: "pointer", textShadow: "none" }}
            >
              選んだ色が一番輝いた瞬間
            </button>
          )}
        </div>
      )}

      {/* 画面下。再生中とハイライト中は💎の帯（真ん中が今の色）、
          曲が終わったら最初に戻る・シェア・本編リンク・断り書き */}
      <div
        style={{
          position: "absolute",
          zIndex: 3,
          left: 0,
          right: 0,
          bottom: "1.6rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.6rem",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.6rem",
            // 中身（💎の帯）は画面の真ん中を基準に左右へ並ぶので、この塊は画面幅いっぱいに広げる。
            // 幅が中身なりだと帯の真ん中が画面の真ん中からずれる
            maxWidth: "100%",
            boxSizing: "border-box",
            ...(playing || highlighting ? { width: "100%" } : {}),
            // 曲の終わりは山の💎が後ろに重なるので、文字が読めるよう薄い暗い帯を敷く（Hop決定 2026-09-06）
            ...(ended && !highlighting ? { background: "rgba(7,8,12,0.72)", padding: "0.9rem 1.2rem 0.6rem", borderRadius: 4 } : {}),
          }}
        >
          {playing ? (
            <DiamondColorCarousel
              options={DIAMOND_COLOR_OPTIONS}
              selectedId={memberId}
              onSelect={handlePickColor}
              onRecord={handleRecord}
              onRecordCancel={handleRecordCancel}
              inviting={liveCount === 0}
              reduceMotion={settings.reduceMotion}
            />
          ) : highlighting ? (
            // 見返している間も色を選び直せる。選ぶとその色が一番輝いた瞬間へ飛び直す。
            // onRecord を渡さない＝真ん中を押しても💎は降らない
            <DiamondColorCarousel
              options={DIAMOND_COLOR_OPTIONS}
              selectedId={memberId}
              onSelect={handlePickColor}
              reduceMotion={settings.reduceMotion}
            />
          ) : ended ? (
            // ボタンは横並び。縦に積むと帯が高くなって動画に重なる（Hop指示 2026-09-07）
            <>
              <div style={{ display: "flex", flexDirection: "row", gap: "0.6rem", alignItems: "center", justifyContent: "center", width: "min(100%, 360px)" }}>
                <button
                  type="button"
                  onClick={handleBackToStart}
                  style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", padding: "0.8rem 0.4rem", background: "#f1f3f5", color: "#0e1016", border: "none", fontSize: "0.875rem", fontWeight: 700, letterSpacing: "0.05em", cursor: "pointer" }}
                >
                  最初に戻る
                </button>
                <button
                  type="button"
                  onClick={() => shareToX(finalCount)}
                  style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", padding: "0.8rem 0.4rem", background: "rgba(14,16,22,0.85)", color: "#f5f7fa", border: "1px solid rgba(255,255,255,0.5)", fontSize: "0.875rem", fontWeight: 700, letterSpacing: "0.05em", cursor: "pointer" }}
                >
                  𝕏 でシェア
                </button>
              </div>
              {/* 元の映像を YouTube で開く（プレイヤーの外＝規約OK）。別タブ */}
              <a
                href={`https://youtu.be/${VIDEO_ID}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: "0.75rem", fontWeight: 600, color: "#9aa0a6", textDecoration: "underline", textUnderlineOffset: "0.2rem" }}
              >
                ▶ 本編の映像を見る
              </a>
              {/* 断り書き＋Font Awesome の帰属（CC BY 4.0）。ハイ！テンションの終了画面と同じ文言 */}
              <p style={{ margin: "0.2rem 0 0", fontSize: "0.625rem", color: "#777", textAlign: "center", lineHeight: 1.6, textShadow: "0 0 8px rgba(0,0,0,0.8)" }}>
                楽曲・映像の著作権は権利者に帰属します。<br />
                権利者からの申し出により直ちに公開を停止します。<br />
                <span style={{ fontSize: "0.5rem", color: "#999" }}>Gem icon by Font Awesome (CC BY 4.0)</span>
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const endLabelStyle: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "#aab0b6",
  margin: "0 0 0.3rem",
};
