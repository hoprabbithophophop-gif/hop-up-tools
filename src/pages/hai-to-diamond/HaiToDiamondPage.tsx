// 灰toダイヤモンド 💎 — 第1段（記録あり・みんなの💎も降る）
//
// 入口は💎ひとつ。押すとその場で曲が始まる（色は選ばない）。色は再生中に、画面下の
// 「一列でループする💎の帯」で選ぶ。真ん中に来た💎を押すと、その色の💎が画面の上から降る。
// 💎は動画の裏を通って画面の下に積もり、曲が進むにつれてカメラが引いて山が動画の背景になる。
// 動画は真ん中に固定（動画本体の上には何も描かない）。
// 再生開始はハイ！テンションと同じ流儀: ユーザーのタップの中で同期的に play() を呼ぶ。
import { useCallback, useEffect, useRef, useState } from "react";
import YouTubePlayer, { type YouTubePlayerApi } from "../hi-tension/components/YouTubePlayer";
import LoadingDots from "../hi-tension/components/LoadingDots";
import { ARENA_BG, ALL_HI_MEMBERS } from "../hi-tension/data";
import { findDiamondMember, GRADUATED_MEMBERS, DIAMOND_COLOR_ORDER, DIAMOND_COLOR_PAGES, DIAMOND_DEFAULT_MEMBER_ID } from "./members";
import { getLastSelectedMemberId, setLastSelectedMemberId, getOrCreateAnonymousSessionId } from "../hi-tension/storage";
import { submitHiSessions } from "../hi-tension/api";
import { fetchReplay, type ReplayRow } from "./replay";
import DiamondCanvas, { type DiamondCanvasApi } from "./DiamondCanvas";
import { stonesSettled, setStoneBakeHurry, stoneBakeReport, warmUpGemRenderer, requestStoneSpritesByHex } from "./gemSprites";
import DiamondEntry from "./DiamondEntry";
import EntryGem from "./EntryGem";
import DiamondColorCarousel from "./DiamondColorCarousel";
import DiamondColorPages from "./DiamondColorPages";
import DiamondCommentTicker, { TICKER_HEIGHT, type TickerComment } from "./DiamondCommentTicker";
import DiamondSettingsSheet, { getDiamondSettings, setDiamondSettings, type DiamondSettings } from "./DiamondSettingsSheet";
import BouncyNumber from "../hi-tension/components/BouncyNumber";

/** BEYOOOOONDS『灰toダイヤモンド』Promotion Edit（公式）。https://youtu.be/ImXkCr22kCU */
const VIDEO_ID = "_56xLKRcVYM";   // YOKOOOOOHAMA ARENA Live Edit.（2026-09-07 公開・Hop指定）。前の Promotion Edit は ImXkCr22kCU（記録の池は動画IDごとに別）
/** YouTube の必須要件。コメントを出す画面にはアップロード元のチャンネル名と動画タイトルを出す（2026-09-12）。
 *  文字は YouTube の oEmbed で確かめた正式な表記のまま */
const VIDEO_TITLE = "BEYOOOOONDS「灰toダイヤモンド」YOKOOOOOHAMA ARENA Live Edit.";
const VIDEO_CHANNEL = "BEYOOOOONDS";
/** 額縁（動画の周りの帯）の太さ(px) */
const FRAME = 14;
/** 動画の中身が縦横比16:9で200pxを割らないための、内側の幅の最低ライン(px)。
 *  YouTube の必須要件（埋め込みプレーヤーは200×200px以上）を、幅の狭い端末でも守るための下限 */
const MIN_VIDEO_WIDTH = 356;
/** 画面幅に合わせて額縁を詰めた太さ(px)を返す。狭い画面ほど額縁を薄くし、動画の中身の幅を MIN_VIDEO_WIDTH 以上に保つ。
 *  画面幅が MIN_VIDEO_WIDTH を割るところまでいったら額縁は 0 */
function computeFrame(): number {
  return Math.max(0, Math.min(FRAME, Math.floor((window.innerWidth - MIN_VIDEO_WIDTH) / 2)));
}
/** PCでは動画を縮めて置く（ハイ！テンションと同じ幅） */
const PC_VIDEO_WIDTH = 480;
/** シェア文面（Hop確定 2026-09-06・A案）。タグとURLは指定のものだけ。URLは仮のルート名。
 *  タグは公式のリリース用タグ #輝きなビヨちゃん を含まず、歌詞そのままでもないものに。
 *  「届くよ」を「届けよ」に変えたひねり入り（Hop決定 2026-09-07） */
export const SHARE_TAG = "#銀河to銀河届けよ";
const SHARE_URL = "https://hop-up-tools.pages.dev/hai-to-diamond";
function buildShareText(count: number): string {
  const firstLine = count === 0
    ? "下の💎をタップで💎が降ってくる！BEYOOOOONDSに輝いてほしい分だけをキラキラにしましょう！"
    : `灰toダイヤモンドに合わせて 💎を ${count.toLocaleString()}個 降らせました`;
  return `${firstLine}\n${SHARE_TAG}\n${SHARE_URL}`;
}
function shareToX(count: number) {
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(buildShareText(count))}`, "_blank", "noopener,noreferrer");
}
/** 他の人の💎を1回の時刻更新（0.1秒）で出す上限。大勢の同時押しで一気に固まらないための蓋。設定「みんなの💎」で変わる。
 *  標準は 20（Hop決定 2026-09-13。25 から下げて、同時に飛ぶ数＝描く枚数を減らす）。「かるくする」の 6 は【仮】 */
const OTHERS_PER_TICK: Record<DiamondSettings["crowd"], number> = { full: 20, light: 6, self: 0 };
/** 動画の枠の上端を、画面の上端から固定でどれだけ空けるか(px)【仮】。
 *  入口の見出し（題名・副題・お知らせの導線）の直下に置く。SE（375×667）では動画を画面の
 *  真ん中に置くと下の余白が足りず、流れるコメントの3行目が色えらびのボタンに重なっていたため、
 *  真ん中寄せをやめて上へ固定した（Hop決定 2026-09-12）。
 *  入口の見出しの下端が約99pxなのでその直下。SE では Safari のバーの分だけ画面が縮むので、
 *  コメントの余白をここで稼ぐ（Hop決定 2026-09-12） */
const VIDEO_TOP_PX = 108;
/** 数字の縁取りの色。白だと白系の文字が膨らむので、💎の選択中の縁と同じ透過の高いグレー（Hop指示 2026-09-08）【仮】 */
const NUMBER_OUTLINE = "rgba(154,160,166,0.5)";
/** 曲の終わり（秒）。プロモーション動画は音が終わった後に無音の黒画面（別動画への案内枠）が続くので、そこで終了扱いにする（Hop指定 2026-09-07: 4:35.9） */
const SONG_END = 280;   // Live Edit. は全長 280 秒。音が終わる時刻は未確認なので今は全長【仮】。Promotion Edit の時は 275.9 だった
/** 積もった山を一斉に夜空へ放って星空にする時刻（秒）【仮】。
 *  曲の最後のフレーズ「Let's Shine Together!」（4:29 付近）＝ハッシュタグ #銀河to銀河届けよ の「届けよ」に合わせる（Hop決定 2026-09-08）。
 *  Live Edit. 基準の値なので、動画を差し替えたら測り直す */
const LAUNCH_TIME = 268.5;   // 4:28.5。「Let's Shine Together!」に合わせて実機で聴いて確定（Hop決定 2026-09-08）
/** 「選んだ色が一番輝いた瞬間」の前後の幅（秒）【仮】 */
const HIGHLIGHT_BEFORE = 5;
const HIGHLIGHT_AFTER = 5;
/** 流れるコメントを、動画の額縁の下端からどれだけ空けて置くか(px)【仮】。
 *  以前はここに「盛り上がりの帯」があったが、まんべんなく押されると全区間が明るくなって差が出ないため外した（Hop決定 2026-09-13） */
const COMMENT_GAP = 4;
/** 流れるコメントと色えらびの器の間に必ず空けておく隙間(px)【仮】 */
const TICKER_BAND_GAP = 4;
/** アップロード元のチャンネル名と動画タイトルの、1行ぶんの高さ(px)【仮】。
 *  幅に入りきらなければ2行に折り返すので、実際の高さは描いてから測る。この値は測る前の見込み */
const CREDIT_LINE_HEIGHT = 16;
/** 動画の中身の高さの下限(px)。YouTube の必須要件で、埋め込みのプレーヤーは 200×200px を下回れない。
 *  幅が MIN_VIDEO_WIDTH に届かない端末では 16:9 のままだと 200px を割るので、ここで下支えする */
const MIN_VIDEO_HEIGHT = 200;
/** 横向きの時に画面いっぱいに出す案内。文面はこのまま（Hop決定 2026-09-12） */
const LANDSCAPE_NOTICE = "現状、横画面での再生には対応しておりません。縦画面にしてお楽しみください。";
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

/** みんなの💎を色ごとに配るための、色→番号の表。0.1秒ごとに作り直さないよう、読み込み時に1回だけ組む。
 *  中身は findDiamondMember が返しうる人＝ハイ！テンションの名簿＋卒業メンバー。
 *  同じ色の人が複数いれば同じ番号になり、その色の個数は合算して数える */
const SPAWN_COLORS: string[] = [];
const SPAWN_COLOR_INDEX = new Map<string, number>();
for (const m of [...ALL_HI_MEMBERS, ...GRADUATED_MEMBERS]) {
  if (SPAWN_COLOR_INDEX.has(m.color)) continue;
  SPAWN_COLOR_INDEX.set(m.color, SPAWN_COLORS.length);
  SPAWN_COLORS.push(m.color);
}
const SPAWN_SLOTS = SPAWN_COLORS.length;
/** 0.1秒ごとの配分に使う作業用の並び。毎回作り直さず、使う前に0に戻して使い回す */
const tickCounts = new Int32Array(SPAWN_SLOTS);
const tickQuota = new Int32Array(SPAWN_SLOTS);
const tickFrac = new Float64Array(SPAWN_SLOTS);
/** 色ごとに、最後に💎を飛ばした実時間(performance.now)。0 は一度も飛ばしていない。
 *  動画の時刻ではなく実時間で持つので、頭出しで動画の時刻が飛んでも矛盾しない */
const lastSpawnAt = new Float64Array(SPAWN_SLOTS);
/** 色ごとに、上限に入りきらず出せなかった登録が残っているか（1=残っている） */
const spawnBacklog = new Uint8Array(SPAWN_SLOTS);
/** 出番の無い色を救う間隔(ms)【仮】。この間ずっと飛んでいない色は、登録が残っていれば1個必ず飛ばす */
const RESCUE_WINDOW_MS = 5000;

/** その0.1秒ぶんの色ごとの個数(counts)から、上限(budget)の中で色ごとに何個飛ばすかを決めて quota に入れる。
 *  総数が上限以下なら全部出す。超えていたら 上限 × その色の個数 ÷ 総数 を切り捨てで配り、
 *  余った枠は端数の大きい色から順に1つずつ配る。
 *  そのあと、直近 RESCUE_WINDOW_MS のあいだ一度も飛んでいないのに登録が残っている色へ、
 *  その回に一番多く出す色から1枠だけ譲る（譲る側は1個は残す）。
 *  frac・backlog は作業用の並びで、この中で書き換える */
export function allocateSpawnQuota(
  counts: Int32Array, quota: Int32Array, frac: Float64Array,
  lastAt: Float64Array, backlog: Uint8Array,
  slots: number, total: number, budget: number, now: number, rescueMs: number,
): void {
  if (total <= budget) {
    for (let i = 0; i < slots; i++) quota[i] = counts[i];
  } else {
    let given = 0;
    for (let i = 0; i < slots; i++) {
      const n = counts[i];
      if (n === 0) { quota[i] = 0; frac[i] = 0; continue; }
      const exact = (budget * n) / total;
      const q = Math.floor(exact);
      quota[i] = q;
      frac[i] = exact - q;
      given += q;
    }
    while (given < budget) {
      let best = -1;
      let bestFrac = -1;
      for (let i = 0; i < slots; i++) {
        if (counts[i] === 0) continue;
        if (frac[i] > bestFrac) { bestFrac = frac[i]; best = i; }
      }
      if (best < 0) break;
      quota[best]++;
      frac[best] = -1;                              // 同じ色へ二度配らない印
      given++;
    }
    for (let i = 0; i < slots; i++) {
      if (quota[i] > 0) continue;
      if (counts[i] === 0 && backlog[i] === 0) continue;   // 登録が本当に無い色は対象外
      if (lastAt[i] !== 0 && now - lastAt[i] < rescueMs) continue;
      let donor = -1;
      let donorQuota = 1;                           // 譲る側にも1個は残す
      for (let j = 0; j < slots; j++) {
        if (quota[j] > donorQuota) { donorQuota = quota[j]; donor = j; }
      }
      if (donor < 0) break;
      quota[donor]--;
      quota[i] = 1;
    }
  }
  // 飛ばし残しの控えを更新する。出し切れなかった色は残っている印を立て、
  // 1個でも飛ばせた色だけ印を消す。この0.1秒に登録が無かった色は前の印をそのまま持ち越す
  for (let i = 0; i < slots; i++) {
    if (counts[i] > quota[i]) backlog[i] = 1;
    else if (quota[i] > 0) backlog[i] = 0;
  }
}

/** 画面下の帯に並べる色。並びは members.ts の DIAMOND_COLOR_ORDER のまま。中身は変わらないので1度だけ作る */
const DIAMOND_COLOR_OPTIONS = DIAMOND_COLOR_ORDER.map((id) => ({ id, color: findDiamondMember(id)?.color ?? "#ffffff" }));
/** ユニットごとのページに並べる色。こちらも中身は変わらないので1度だけ作る */
const DIAMOND_COLOR_PAGE_OPTIONS = DIAMOND_COLOR_PAGES.map((ids) => ids.map((id) => ({ id, color: findDiamondMember(id)?.color ?? "#ffffff" })));
/** 焼く順番と、入口が待つ色（Hop決定 2026-09-14）。
 *  まず自分の色、次に自分の色と同じページの色まで焼けたら入口を開く。残りは近いページから順に裏で焼く。
 *  戻り値: entry=入口が待つ色（自分のページ）、order=焼く順番の全色 */
function bakePlan(memberId: string): { entry: string[]; order: string[] } {
  const hexOf = (id: string) => findDiamondMember(id)?.color;
  const own = Math.max(0, DIAMOND_COLOR_PAGES.findIndex((p) => p.includes(memberId)));
  const pages = DIAMOND_COLOR_PAGES.map((ids, i) => ({ ids, d: Math.abs(i - own) })).sort((a, b) => a.d - b.d);
  const order: string[] = [];
  const ownHex = hexOf(memberId);
  if (ownHex) order.push(ownHex);
  for (const p of pages) for (const id of p.ids) { const h = hexOf(id); if (h && !order.includes(h)) order.push(h); }
  const entry = DIAMOND_COLOR_PAGES[own].map(hexOf).filter((h): h is string => !!h);
  return { entry, order };
}
/** 焼き上がりを何ミリ秒ごとに見に行くか */
const GEMS_POLL_MS = 200;
/** ここまで経ったら、焼き上がっていなくても待つのをやめる【仮】。
 *  遅い端末で入口に閉じ込めないための保険 */
const GEMS_WAIT_CAP_MS = 15000;
/** 動画の用意をこれだけ待っても届かなければ「読み込めなかった」扱いにする(ms)【仮】。
 *  YouTube 側は失敗を知らせずに黙ることがあるので、失敗の知らせとは別にこの保険で拾う */
const VIDEO_WAIT_CAP_MS = 15000;   // 30秒は待たせすぎで離脱される（Hop指示 2026-09-14）
/** ページを開いてからここまで待っても支度がそろわなかったら、
 *  入口の案内文を待たせている旨に切り替える【仮】。石だけでなく動画も含めた支度全体の話 */
const SLOW_NOTICE_MS = 5000;

/** 読み込み画面の重ね順【仮】。入口・動画・設定の板のどれよりも手前 */
const LOADING_Z = 50;
/** 支度が長引いた時に読み込み画面へ出す文。入口の案内文と同じ【仮】の文言をそのまま使う */
const LOADING_SLOW_TEXT = "準備に少し時間がかかっています";

const loadingScreenStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: LOADING_Z,
  background: ARENA_BG,
  color: "#e8eaed",
  fontFamily: "Inter, 'Noto Sans JP', sans-serif",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.9rem",
};
const loadingSlowTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "0.875rem",
  fontWeight: 600,
  color: "#9aa0a6",
  textAlign: "center",
  lineHeight: 1.5,
};
const loadingBakeNoteStyle: React.CSSProperties = {
  position: "absolute",
  right: 12,
  bottom: 12,
  fontSize: 12,
  color: "rgba(255,255,255,0.45)",
};
/** ページ全体の読み込み画面。💎の絵が焼き上がるまでの間、入口の中身も動画も置かずにこれだけを出す。
 *  動画の上に幕を張る形にはしない（YouTube API 規約）ので、この間はプレーヤーそのものを置かない */
function DiamondLoadingScreen({ loadingSlow, reduceMotion, bakeNote }: { loadingSlow: boolean; reduceMotion: boolean; bakeNote?: string }) {
  return (
    <div data-testid="diamond-loading-screen" style={loadingScreenStyle}>
      {/* 印は動画の読み込みと同じメンバーカラーの丸（LoadingDots）。動き軽減の時は跳ねを止める */}
      {reduceMotion && <style>{`.diamond-loading-still * { animation: none !important; }`}</style>}
      <div className={reduceMotion ? "diamond-loading-still" : undefined} aria-hidden="true">
        <LoadingDots />
      </div>
      {loadingSlow && <p style={loadingSlowTextStyle}>{LOADING_SLOW_TEXT}</p>}
      {bakeNote && <span style={loadingBakeNoteStyle}>{bakeNote}</span>}
    </div>
  );
}

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
  /** いま1回の最中か（動画の再生の合図を受け取る側から見るための控え） */
  const startedRef = useRef(false);
  /** 1回ぶんの支度。合図を受け取る関数の方が先に組み立てられるので、控え越しに呼ぶ */
  const beginSessionRef = useRef<(() => void) | null>(null);
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
  /** 動画が届いて再生ボタンを押せる状態になったか。届く前は入口の案内文を「読み込んでいます」にする */
  const [videoReady, setVideoReady] = useState(false);
  /** 💎の立体の絵が色ぜんぶぶん焼き上がったか。焼き上がる前に曲が始まると、
   *  焼けていない色の席に代わりの平らな板が貼られて石と混ざるので、それまで再生を止めておく。
   *  一度立ったら下ろさない＝「最初に戻る」で入口へ帰っても、焼けた絵はそのまま残っている */
  const [gemsReady, setGemsReady] = useState(false);
  /** 焼き上がりまでにかかった時間の読み取り。main 以外の枝でだけ入口の右下に出す */
  const [bakeNote, setBakeNote] = useState<string | undefined>(undefined);
  // 入口の間は画面がほぼ止まっているので、💎の絵を急いで焼かせる。
  // 元のペースへ戻すのは再生が始まる beginSession の中
  useEffect(() => { setStoneBakeHurry(true); }, []);
  // 💎の絵を焼き始めるのは、これまで DiamondCanvas の役目だった。読み込み画面の間は
  // その層をまだ置かないので、焼く支度と注文はページ側からも出しておく。
  // 同じ色を二度頼んでも二度焼きはされないので、後から DiamondCanvas が頼み直しても無駄にはならない
  /** 焼く順番と入口が待つ色。開いた時の色で決める（色を替えるのは再生中で、その時はもう入口を出ている） */
  const [plan] = useState(() => bakePlan(memberId));
  useEffect(() => {
    warmUpGemRenderer();
    for (const hex of plan.order) requestStoneSpritesByHex(hex);
  }, [plan]);
  // 焼き上がりを見に行く。ページを開いた時点から始め、自分のページの色が済むか、
  // 保険の時間が過ぎたら止める。遅い端末で入口に閉じ込めないための保険つき。
  // 以前は14色ぜんぶを待っていたが、スマートフォンで9秒近く待たせていた（Hop実測 2026-09-13）。
  // 残りは裏で焼き続け、焼けていない色の他の人の💎は出さない＝平らな代わりの絵は出さない（Hop決定 2026-09-14）
  useEffect(() => {
    if (gemsReady) return;
    const check = () => {
      if (__SHOW_VERSION__) {
        // 読み取りを先に取る。ここで済みになると見に行くのが止まるので、
        // 後回しにすると焼き上がりの秒数を一度も出せないまま終わる
        const r = stoneBakeReport();
        if (r.started) setBakeNote((r.done ? "焼き " : "焼き中 ") + (r.ms / 1000).toFixed(1) + "秒");
      }
      if (stonesSettled(plan.entry)) setGemsReady(true);
    };
    check();
    const poll = setInterval(check, GEMS_POLL_MS);
    const cap = setTimeout(() => setGemsReady(true), GEMS_WAIT_CAP_MS);
    return () => { clearInterval(poll); clearTimeout(cap); };
  }, [gemsReady, plan]);
  /** 動画が読み込めなかったか。失敗の知らせを受けたか、VIDEO_WAIT_CAP_MS 待っても用意ができない時に立つ */
  const [videoFailed, setVideoFailed] = useState(false);
  useEffect(() => {
    if (videoReady) return;
    const t = setTimeout(() => setVideoFailed(true), VIDEO_WAIT_CAP_MS);
    return () => clearTimeout(t);
  }, [videoReady]);
  const handleVideoError = useCallback((code: number) => {
    console.warn("[hai-to-diamond] video failed:", code);
    setVideoFailed(true);
  }, []);
  /** 「もう一度」。動画部品だけ作り直す手が無いので、ページごと読み直す */
  const retryVideo = useCallback(() => { location.reload(); }, []);
  /** 動画も石もそろって、再生ボタンを押せる状態になったか */
  const entryReady = videoReady && gemsReady;
  /** 押せるようになるまでの支度が長引いているか。入口の案内文を、待たせている旨に切り替えるのに使う */
  const [loadingSlow, setLoadingSlow] = useState(false);
  // ページを開いた時から数えて、動画と石の両方がそろわないまま SLOW_NOTICE_MS 経ったら合図を立てる。
  // どちらが先にそろっても、残りを待っている間は立ちうる。両方そろえば用済みなので下ろす
  useEffect(() => {
    if (entryReady) { setLoadingSlow(false); return; }
    const t = setTimeout(() => setLoadingSlow(true), SLOW_NOTICE_MS);
    return () => clearTimeout(t);
  }, [entryReady]);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  /** 一時停止中（YouTube純正の操作で止められた間）。曲の途中で押しても💎が降らないようにするための状態。
   *  ハイライト再生中の一時停止はここに含めない（区間再生なので、いつも通り無視する） */
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
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
  const othersTotalRef = useRef<number | null>(null);
  useEffect(() => { othersTotalRef.current = othersTotal; }, [othersTotal]);
  /** 累計の下限。曲が終わった時の「みんなの累計＋自分の数」を控えておく。
   *  集計の窓口は45秒ぶん結果を溜めているので、送った直後に読み直しても自分の分がまだ入っていない。
   *  そのまま出すと、入口の累計が終了画面の累計より少なく見える（Hop報告 2026-09-08）。
   *  窓口から返った数とこの下限の大きい方を出せば、下回ることは無く、他の人の分が入れば普通に増える */
  const totalFloorRef = useRef(0);
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
  /** 動画の矩形の下端の位置と、額縁の左端・幅。その下に置く流れるコメント・入口・設定の置き場所の基準 */
  const [underBox, setUnderBox] = useState<{ top: number; left: number; width: number } | null>(null);
  /** 色えらびの器の上端。ここまでに入る行数だけコメントを流す＝下の2行が色えらびの裏に隠れない */
  const bandRef = useRef<HTMLDivElement>(null);
  const [bandTop, setBandTop] = useState<number | null>(null);
  /** チャンネル名と動画タイトルの実際の高さ(px)。1行に入れば16、折り返せば32あたり。
   *  描いてから測って、そのぶんコメントに使える高さを減らす */
  const [creditHeight, setCreditHeight] = useState(CREDIT_LINE_HEIGHT);
  /** いま押されて全文を出しているコメント。無ければコメントは今までどおり流れる */
  const [openComment, setOpenComment] = useState<TickerComment | null>(null);
  /** 額縁の太さ(px)。スマホ（isTouchDevice）では画面幅に合わせて詰める。PC は常に FRAME のまま */
  const [frame, setFrame] = useState<number>(() => (isTouchDevice() ? computeFrame() : FRAME));
  /** 窓の大きさ。横向きかどうかと、横向きの時の動画の大きさを決めるのに使う */
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => {
      if (isTouchDevice()) setFrame(computeFrame());   // PC の額縁は画面幅で変えない
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  /** 横向き。スマホを寝かせた時だけ。この間は中身を出さず、画面いっぱいに案内だけを出す */
  const landscape = isTouchDevice() && viewport.w > viewport.h;
  // 横へ倒したら動画を止める。縦に戻しても自動では再生しない＝人が動画の再生ボタンを押す
  useEffect(() => {
    if (landscape) playerRef.current?.pause();
  }, [landscape]);
  // 入口でも測る（入口の案内と累計を、動画の矩形の下端に合わせて置くため）
  useEffect(() => {
    const measure = () => {
      const box = videoBoxRef.current;
      const frameEl = box?.parentElement;                 // 額縁ぶんの余白を持つ div
      const root = frameEl?.parentElement;                // ページの div
      if (!box || !frameEl || !root) return;
      const vr = box.getBoundingClientRect();
      const fr = frameEl.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      setNumbersBottom(rr.bottom - vr.top + frame);   // 曲が終わった後の数字とボタンが動画の上の余白に収まるよう、12px の下駄を外した（2026-09-12）。額縁は画面幅で薄くなるので、その時の太さを使う
      setUnderBox({ top: vr.bottom - rr.top, left: fr.left - rr.left, width: fr.width });
      const band = bandRef.current;
      if (band) {
        const rect = band.getBoundingClientRect();
        if (rect.height > 0) setBandTop(rect.top - rr.top);
      }
    };
    measure();
    window.addEventListener("resize", measure);
    // Safari は下のバーが出入りすると、窓そのものの大きさは変わらないまま見えている高さだけ縮む。
    // その変わり目も聞いておく＝バーが出て色えらびが上がってきた時にも追いつける
    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    // 色えらびの器は下端が固定なので、中身が入れ替わって高さが変わると上端が動く。
    // 器の大きさの変わり目も測り直しの合図にする
    const band = bandRef.current;
    const ro = band ? new ResizeObserver(measure) : null;
    if (band) ro?.observe(band);
    return () => {
      window.removeEventListener("resize", measure);
      vv?.removeEventListener("resize", measure);
      ro?.disconnect();
    };
    // gemsReady は、読み込み画面が消えて本編の器が初めて置かれる合図。
    // ここを入れておかないと、器が無い間に測って諦めたまま測り直さない
  }, [started, frame, landscape, gemsReady]);

  /** チャンネル名と動画タイトルの器。描かれた時に高さを測り、折り返しで高さが変われば測り直す */
  const creditRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const measure = () => setCreditHeight(Math.round(el.getBoundingClientRect().height) || CREDIT_LINE_HEIGHT);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
      const fetched = rows.reduce((acc, r) => acc + r.counts.reduce((a, c) => a + c, 0), 0);
      setOthersTotal(Math.max(fetched, totalFloorRef.current));
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
  const setPausedBoth = (v: boolean) => { pausedRef.current = v; setPaused(v); };

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
    setPausedBoth(false);
    setFinalCount(tapsRef.current.length);
    totalFloorRef.current = (othersTotalRef.current ?? 0) + tapsRef.current.length;
    setPeakTime(canvasRef.current?.getPeakTime() ?? null);
    setEnded(true);
    submitOnce();
  }, [submitOnce]);

  const handleEnded = useCallback(() => { finish(); }, [finish]);

  /** 動画が届いた合図。入口の案内文を「読み込んでいます」から「押すとはじまります」へ切り替える */
  const handleVideoReady = useCallback(() => { setVideoReady(true); }, []);

  // 動画上の YouTube 純正の再生ボタンから始めた場合も拾う。1=再生中 / 2=一時停止 / 0=終了。3=読み込み中は触らない。
  // 再生中に一時停止(2)が来たら「一時停止中」を立て、再生(1)に戻ったら下ろす（Hop決定 2026-09-08）
  const handlePlayerStateChange = useCallback((state: number) => {
    if (highlightRef.current) return;               // ハイライト再生中は再生扱いにしない（💎ボタンも記録も増やさない・一時停止もいつも通り無視）
    if (state === 1 && !startedRef.current) { beginSessionRef.current?.(); return; }   // 入口で動画の再生ボタンが押された＝ここから1回が始まる
    if (state === 1) { setEnded(false); setPlayingBoth(true); setPausedBoth(false); }
    else if (state === 0) finish();
    else if (state === 2 && playingRef.current) setPausedBoth(true);
  }, [finish]);

  /** 曲を1回ぶん始める支度。
   *  再生そのものはここから呼ばない＝動画自身の再生ボタンを押してもらう（Hop決定 2026-09-10）。
   *  外側のボタンから呼んで始めた再生は YouTube 側で1回として数えられていない疑いが強く、
   *  このツールは公式動画の再生回数に足すために作っているため。
   *  呼ばれるのは、動画が実際に再生に入った合図（onPlayerStateChange の 1）を受け取った時 */
  const beginSession = useCallback(() => {
    setStoneBakeHurry(false);   // ここから先は動画が動くので、まだ焼き残っている色は元のゆっくりしたペースで
    canvasRef.current?.setMode(settingsRef.current.scene);   // 山かミラーボールか。reset より先に（設定「💎の見せ方」）
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
    setVideoTimeSec(0);
    setPeakTime(null);
    setEnded(false);
    setOpenComment(null);   // 前の回で開いたままの全文の板は持ち越さない
    startedRef.current = true;
    setStarted(true);
    setPlayingBoth(true);
    setPausedBoth(false);
  }, [loadReplay]);
  useEffect(() => { beginSessionRef.current = beginSession; }, [beginSession]);

  /** 最初に戻る＝入口へ */
  const handleBackToStart = useCallback(() => {
    highlightRef.current = null;
    seekPendingRef.current = null;
    setHighlighting(false);
    setEnded(false);
    setPlayingBoth(false);
    setPausedBoth(false);
    setOpenComment(null);
    startedRef.current = false;
    setStarted(false);
    // 動画はサムネイルと再生ボタンの状態に戻す＝ページを開いた直後と同じ見え方。
    // 頭へ巻き戻して一時停止する形だと、端末の「再生中」の札が残り、1コマ目が止まったまま見える。
    // 公式の手引きでも、一時停止は「続きを見る時」、見終わった後は別の止め方に分けている（Hop決定 2026-09-11）
    playerRef.current?.cueVideo(VIDEO_ID);
    loadReplay();   // 入口の累計を読み直す（自分の分は下限で守られる）
  }, [loadReplay]);

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

  /** 終了画面の💎を左右に送って、色を1つ隣へ替える。いま選んでいる色そのものを替える（次の回の最初の色にもなる） */
  const cycleColor = useCallback((dir: 1 | -1) => {
    const n = DIAMOND_COLOR_ORDER.length;
    const i = DIAMOND_COLOR_ORDER.indexOf(memberIdRef.current as typeof DIAMOND_COLOR_ORDER[number]);
    handlePickColor(DIAMOND_COLOR_ORDER[((i < 0 ? 0 : i) + dir + n) % n]);
  }, [handlePickColor]);
  const endGemSwipeRef = useRef<number | null>(null);

  const handleTimeUpdate = useCallback((t: number) => {
    // 頭出しを頼んだ直後の古い時刻は捨てる。そのまま使うと、飛ぶ前の時刻で
    // ハイライトの終わりを過ぎたと勘違いしたり、関係ない場所のみんなの💎が降ったりする
    const sp = seekPendingRef.current;
    if (sp) {
      if (Math.abs(t - sp.target) <= 1.5 || performance.now() > sp.until) seekPendingRef.current = null;
      else return;
    }
    canvasRef.current?.setTime(t, SONG_END);
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
    if (cur < last) { last = cur - 1; spawnBacklog.fill(0); }        // 巻き戻し（頭出し等）。飛ばし残しの控えも捨てる
    if (cur - last > 40) { last = cur - 40; spawnBacklog.fill(0); }  // 大きく飛んだ時は直近2秒ぶんだけ
    const budget = OTHERS_PER_TICK[settingsRef.current.crowd];
    if (budget > 0) {
      // まずこの0.1秒ぶんの登録を色ごとに数える。同じ色の人が複数いれば合算される
      tickCounts.fill(0);
      let total = 0;
      for (let b = last + 1; b <= cur; b++) {
        const entries = bucketMapRef.current.get(b);
        if (!entries) continue;
        for (const [c, n] of entries) {
          if (n <= 0) continue;
          const i = SPAWN_COLOR_INDEX.get(c);
          if (i === undefined) continue;
          tickCounts[i] += n;
          total += n;
        }
      }
      const now = performance.now();
      allocateSpawnQuota(tickCounts, tickQuota, tickFrac, lastSpawnAt, spawnBacklog, SPAWN_SLOTS, total, budget, now, RESCUE_WINDOW_MS);
      for (let i = 0; i < SPAWN_SLOTS; i++) {
        const q = tickQuota[i];
        if (q <= 0) continue;
        const c = SPAWN_COLORS[i];
        // まだ焼けていない色は出さない。平らな代わりの絵で飛ばすより出さない方がよい（Hop決定 2026-09-14）。
        // 端末が本物を描けない場合は「済み」扱いになるので、その時は今までどおり平らな絵で出る
        if (!stonesSettled([c])) continue;
        for (let k = 0; k < q; k++) canvasRef.current?.spawn(c);
        lastSpawnAt[i] = now;
      }
    }
    lastBucketRef.current = cur;
  }, [finish]);

  /** 💎ボタン1回ぶん。再生中（かつ一時停止していない）だけ受け付ける。
   *  ユニットごとのページからは押した💎の色（pickedId）が渡る。一列の帯からは渡らないので、
   *  その時は真ん中に来ている色＝いま選ばれている色を使う。
   *  origin は押した💎のボタンの中心。画面座標で渡す。💎はそのすぐ上から飛び立つ */
  const handleRecord = useCallback((pickedId?: string, origin?: { x: number; y: number }): boolean => {
    if (!playingRef.current || pausedRef.current) return false;
    const id = pickedId ?? memberIdRef.current;
    const hex = findDiamondMember(id)?.color ?? "#ffffff";
    tapsRef.current.push({ t: playerRef.current?.getCurrentTime() ?? 0, memberId: id });
    canvasRef.current?.spawn(hex, true, origin);
    setLiveCount(tapsRef.current.length);
    return true;
  }, []);

  /** 一列の帯からの1回ぶん。帯は真ん中の色しか押せないので色は渡らず、ボタンの位置だけ渡る */
  const handleRecordFromRow = useCallback((origin?: { x: number; y: number }): boolean => {
    return handleRecord(undefined, origin);
  }, [handleRecord]);

  /** 触れた瞬間に降らせた1つを取り消す（指が滑ってスワイプになった時） */
  const handleRecordCancel = useCallback(() => {
    if (tapsRef.current.length === 0) return;
    tapsRef.current.pop();
    canvasRef.current?.undoLastSpawn();
    setLiveCount(tapsRef.current.length);
  }, []);

  /** 流れるコメントの置き場所と、色えらびに掛からない高さの上限。
   *  上限が出せない間（まだ測れていない間）は今までどおり3行のまま流す。
   *  コメントの上にチャンネル名と動画タイトルの1行が入るので、その高さも引いておく */
  const creditTop = underBox ? underBox.top + frame + COMMENT_GAP : 0;
  const commentTop = creditTop + creditHeight;
  const commentMaxHeight = underBox && bandTop != null ? bandTop - commentTop - TICKER_BAND_GAP : undefined;
  /** コメント全文を開いている時の高さ。下のボタンを隠すので画面の下端（セーフエリアの手前）まで目一杯広げる */
  const openCommentHeight = `calc(100dvh - ${commentTop}px - 0.75rem - env(safe-area-inset-bottom))`;
  /** 開いているコメントを YouTube で見る行き先。札が揃っていなければ道を出さない */
  const openCommentUrl = openComment?.commentId && openComment?.videoId
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(openComment.videoId)}&lc=${encodeURIComponent(openComment.commentId)}`
    : null;

  // 💎の絵が焼き上がるまでは、入口も動画も置かずに読み込み画面だけを出す。
  // 動画の上に幕を張る形（プレーヤーへの重ね物）にはしない（YouTube API 規約）
  if (!gemsReady) {
    return <DiamondLoadingScreen loadingSlow={loadingSlow} reduceMotion={settings.reduceMotion} bakeNote={bakeNote} />;
  }

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
      {/* 横向きの案内。中身の代わりにこれだけを出す（Hop決定 2026-09-12） */}
      {landscape && (
        <div
          data-testid="diamond-landscape-notice"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 1.5rem",
            textAlign: "center",
            fontSize: 14,
            lineHeight: 1.6,
            color: "#e8eaed",
          }}
        >
          {LANDSCAPE_NOTICE}
        </div>
      )}

      {/* 入口。本編（プレイヤー込み）は常時マウントし、その上に重ねる＝「はじめる」の時点でプレイヤーが準備済み */}
      {!started && (
        <div style={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: landscape ? "none" : undefined }}>
          {/* 動画の下端がまだ測れていない間は設定を開かない。開くと板の置き場所が決まらず
              画面の真ん中＝動画の上に出てしまう。見た目は変えず、押しても何も起きないだけ */}
          <DiamondEntry landscape={landscape} gemColor={color} videoBottom={underBox?.top ?? null} videoReady={entryReady} loadingSlow={loadingSlow} total={othersTotal === null ? null : Math.max(othersTotal, totalFloorRef.current)} videoFailed={videoFailed && !videoReady} onRetry={retryVideo} onOpenSettings={() => { if (underBox) setSettingsOpen(true); }} reduceMotion={settings.reduceMotion} />
        </div>
      )}
      {settingsOpen && !landscape && (
        <DiamondSettingsSheet avoidBottom={underBox?.top} settings={settings} onChange={handleSettingsChange} onClose={() => setSettingsOpen(false)} />
      )}

      {/* 光と💎の層と動画は、横向きの間も作り直さずそのまま持っておく＝縦に戻した時に
          それまでの回数も球の様子も消えない。代わりにこの器ごと画面の外へ逃がす。
          案内をプレーヤーの上に重ねる形にはしない（YouTube API 規約） */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          ...(landscape ? { transform: "translateX(-200vw)", pointerEvents: "none" as const } : {}),
        }}
      >
        {/* 光と💎の層。動画の裏（zIndex 0） */}
        <DiamondCanvas ref={canvasRef} videoBoxRef={videoBoxRef} frame={frame} reduceMotion={settings.reduceMotion} />

        {/* 動画。入口の見出しの直下に固定。SE で下のコメントと色えらびが重ならないように上へ寄せた（Hop決定 2026-09-12）。
            額縁ぶんの余白を空け、背景は透明にして裏のキャンバスの額縁を見せる */}
        <div
          style={{
            position: "absolute",
            // 入口の間は動画を入口の上に出す＝真ん中に動画が見えていて、その再生ボタンを押せる（Hop決定 2026-09-10）
            zIndex: started ? 2 : 20,
            top: VIDEO_TOP_PX,
            left: "50%",
            transform: "translate(-50%, 0)",
            padding: frame,
            width: isTouchDevice() ? "100%" : PC_VIDEO_WIDTH + FRAME * 2,
            maxWidth: "100%",
            boxSizing: "border-box",
          }}
        >
          <div ref={videoBoxRef}>
            <YouTubePlayer ref={playerRef} videoId={VIDEO_ID} onEnded={handleEnded} onTimeUpdate={handleTimeUpdate} onPlayerStateChange={handlePlayerStateChange} onReady={handleVideoReady} onError={handleVideoError} startCover={false} loadingCover={false} minHeight={MIN_VIDEO_HEIGHT} />
          </div>
          {/* 元の映像を YouTube で開く（プレイヤーの外＝規約OK）。別タブ。曲が終わった時だけ、動画の直下に置く
              （画面下の帯から移動・文言短縮。Hop指示 2026-09-14） */}
          {ended && (
            <a
              href={`https://youtu.be/${VIDEO_ID}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "block", marginTop: 8, textAlign: "center", fontSize: "0.75rem", fontWeight: 600, color: "#9aa0a6", textDecoration: "underline", textUnderlineOffset: "0.2rem" }}
            >
              YouTubeで開く
            </a>
          )}
        </div>
      </div>

      {/* 流れるコメント。動画の額縁の下（動画の矩形の外）に置く。
          本文に分:秒があるものはその時刻に、無いものはランダムな順で右から左へ流れる。
          すぐ上にアップロード元のチャンネル名と動画タイトルを置く（YouTube の必須要件）。
          幅に入りきらなければ2行に折り返して全文出す（Hop決定 2026-09-12）。
          1件押されている間は、流れる代わりに同じ場所へ全文の板を出す。
          横向きは案内だけを出すので描かない */}
      {started && underBox && (playing || highlighting) && !landscape && (
        <div
          style={{
            position: "absolute",
            zIndex: 3,
            top: creditTop,
            left: underBox.left,
            width: underBox.width,
            pointerEvents: "none",
          }}
        >
          <div
            ref={creditRef}
            data-testid="diamond-video-credit"
            style={{
              fontSize: 12,
              lineHeight: `${CREDIT_LINE_HEIGHT}px`,
              color: "#9aa0a6",
              textShadow: "0 0 8px rgba(0,0,0,0.8)",
            }}
          >
            {VIDEO_CHANNEL} ／ {VIDEO_TITLE}
          </div>
          {/* 流れるコメント。コメント全文を開いている間も破棄せずその場で一時停止する */}
          <div style={{ visibility: openComment ? "hidden" : "visible" }}>
            <DiamondCommentTicker
              comments={comments}
              currentTime={videoTimeSec}
              reduceMotion={settings.reduceMotion}
              maxHeight={commentMaxHeight}
              onOpen={setOpenComment}
              paused={Boolean(openComment)}
            />
          </div>

          {openComment && (
            // 全文の板。閉じるボタンまたは枠外を押せば閉じて流れに戻る。
            // 背景は半透明＋すりガラスで💎が透けて見えるようにする（Hop要望 2026-09-12）
            <div
              data-testid="diamond-comment-open"
              onClick={() => setOpenComment(null)}
              style={{
                position: "absolute",
                top: creditHeight,
                left: 0,
                right: 0,
                pointerEvents: "auto",
                height: openCommentHeight,
                maxHeight: openCommentHeight,
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                gap: "0.4rem",
                padding: "0.5rem 0.6rem",
                background: "rgba(10,12,18,0.72)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
                borderRadius: 4,
                border: "1px solid rgba(255,255,255,0.15)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
                cursor: "pointer",
              }}
            >
              {/* 投稿者名、YouTubeへの道、閉じるボタンを1行に並べる */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.6rem", flexShrink: 0 }}>
                <div style={{ minWidth: 0, fontSize: 12, lineHeight: "16px", color: "#9aa0a6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {openComment.author}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexShrink: 0 }}>
                  {openCommentUrl && (
                    <a
                      href={openCommentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{ fontSize: 12, lineHeight: "16px", color: "#9aa0a6", textDecoration: "underline", textUnderlineOffset: "0.2rem", whiteSpace: "nowrap" }}
                    >
                      YouTube で見る
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setOpenComment(null); }}
                    style={{
                      background: "rgba(255,255,255,0.1)",
                      border: "1px solid rgba(255,255,255,0.3)",
                      borderRadius: 4,
                      color: "#e8eaed",
                      fontSize: 11,
                      lineHeight: "14px",
                      padding: "2px 8px",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    閉じる
                  </button>
                </div>
              </div>
              {/* 本文は途中で切らずに全部。入りきらない分は指で送る */}
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ flex: 1, minHeight: 0, overflowY: "auto", fontSize: 14, lineHeight: 1.5, color: "#dfe6f5", whiteSpace: "pre-wrap", wordBreak: "break-word", overscrollBehavior: "contain" }}
              >
                {openComment.text}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 数字は動画の上の空きに置く（Hop指示 2026-09-06）。再生中は自分の回数、曲が終わったら歴代累計も並ぶ。
          横向きは案内だけを出すので描かない */}
      {started && (playing || ended) && !landscape && (
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
            gap: "0.3rem",
            textAlign: "center",
            pointerEvents: "none",
            // 数字の裏に暗い帯を敷いて読みやすくする。帯はこのブロックの高さぶんだけ＝上下は
            // マスクで10pxだけ透明へ溶かし、境目に線が出ないようにする（Hop指示 2026-09-14）
            background: "rgba(7,8,12,0.72)",
            WebkitMaskImage: "linear-gradient(transparent, #000 10px, #000 calc(100% - 10px), transparent)",
            maskImage: "linear-gradient(transparent, #000 10px, #000 calc(100% - 10px), transparent)",
            // 動画の上の空きは画面の高さに関わらず約245px。2段に収めるため詰めてある（2段にした直後は上段が画面の上へ切れた）
            padding: "10px 0",
          }}
        >
          {ended ? (
            // 動画の上の空きは約120pxしか無いので1段に収める。主役は「あなたの💎」で、大きさの差で順位を付ける
            // （2段に分けると上段が画面の上へ切れた・2026-09-14）
            <div style={{ display: "flex", gap: "1.4rem", justifyContent: "center", alignItems: "flex-end" }}>
              <div>
                <p style={endLabelStyle}>あなたの💎</p>
                <BouncyNumber value={finalCount} color={color} size="2.2rem" outlineColor={NUMBER_OUTLINE} />
              </div>
              <div>
                <p style={endLabelStyle}>歴代累計</p>
                <BouncyNumber value={(othersTotal ?? 0) + finalCount} color={color} size="1.3rem" outlineColor={NUMBER_OUTLINE} />
              </div>
              {/* 色ごとの一番輝いた時刻。💎を左右にスワイプ（または ‹ › ）で色を1つずつ送る。
                  データは再生中に全色ぶん手元で計算済みなので、ここで通信は起きない（Hop指示 2026-09-14）。
                  替えるのは「いま選んでいる色」そのものなので、見返す先と数字の色も一緒に変わる */}
              {!highlighting && (
                <div
                  style={{ pointerEvents: "auto", display: "flex", flexDirection: "column", alignItems: "center", touchAction: "pan-y" }}
                  onPointerDown={(e) => { endGemSwipeRef.current = e.clientX; }}
                  onPointerUp={(e) => {
                    const x0 = endGemSwipeRef.current;
                    endGemSwipeRef.current = null;
                    if (x0 == null) return;
                    const dx = e.clientX - x0;
                    if (dx <= -END_GEM_SWIPE_PX) cycleColor(1);
                    else if (dx >= END_GEM_SWIPE_PX) cycleColor(-1);
                  }}
                  onPointerCancel={() => { endGemSwipeRef.current = null; }}
                >
                  <p style={endLabelStyle}>一番輝いた瞬間</p>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.1rem" }}>
                    <button type="button" aria-label="前の色" onClick={() => cycleColor(-1)} style={endGemArrowStyle}>‹</button>
                    <EntryGem size={30} color={color} animate={!settings.reduceMotion} />
                    <button type="button" aria-label="次の色" onClick={() => cycleColor(1)} style={endGemArrowStyle}>›</button>
                  </div>
                  {/* 時刻そのものを「その色が一番輝いた瞬間」を見返す入口にする。別のボタンは置かない（Hop指示 2026-09-14） */}
                  {peakTime != null ? (
                    <button
                      type="button"
                      onClick={handleHighlight}
                      style={{ fontSize: "1.1rem", fontWeight: 700, color, fontVariantNumeric: "tabular-nums", lineHeight: 1.2, background: "none", border: "none", padding: "6px 12px", textDecoration: "underline", textUnderlineOffset: "3px", cursor: "pointer", pointerEvents: "auto", fontFamily: "inherit" }}
                    >
                      {fmtClock(peakTime)}
                    </button>
                  ) : (
                    <span style={{ fontSize: "1.1rem", fontWeight: 700, color, fontVariantNumeric: "tabular-nums", lineHeight: 1.2, padding: "6px 12px", display: "inline-block" }}>—</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", gap: "1.8rem", justifyContent: "center", alignItems: "flex-end" }}>
              <div>
                <p style={endLabelStyle}>あなたの💎</p>
                <BouncyNumber value={liveCount} color={color} size="2.2rem" outlineColor={NUMBER_OUTLINE} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 画面下。再生中とハイライト中は色えらび（設定「色の並び」でユニットごとのページか一列の帯）、
          曲が終わったら最初に戻る・シェア・本編リンク・断り書き。
          横向きは案内だけを出すので描かない。
          コメント全文を開いている間も、コメントに高さを譲るため隠す */}
      {!landscape && !openComment && (
      <div
        ref={bandRef}
        style={{
          position: "absolute",
          zIndex: 3,
          left: 0,
          right: 0,
          // iPhone のホームバーに掛からないよう、端末が空けてほしいと言っている下の余白を足す。
          // index.html の指定で画面の端まで描く形にしてあるので、この余白は自分で足さないと入らない
          bottom: "calc(0.5rem + env(safe-area-inset-bottom))",
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
            settings.colorLayout === "row" ? (
              <DiamondColorCarousel
                options={DIAMOND_COLOR_OPTIONS}
                selectedId={memberId}
                onSelect={handlePickColor}
                onRecord={handleRecordFromRow}
                onRecordCancel={handleRecordCancel}
                inviting={liveCount === 0}
                reduceMotion={settings.reduceMotion}
                disabled={paused}
              />
            ) : (
              <DiamondColorPages
                pages={DIAMOND_COLOR_PAGE_OPTIONS}
                selectedId={memberId}
                onSelect={handlePickColor}
                onRecord={handleRecord}
                onRecordCancel={handleRecordCancel}
                inviting={liveCount === 0}
                reduceMotion={settings.reduceMotion}
                disabled={paused}
              />
            )
          ) : highlighting ? (
            // 見返している間も色を選び直せる。選ぶとその色が一番輝いた瞬間へ飛び直す。
            // onRecord を渡さない＝押しても💎は降らない
            settings.colorLayout === "row" ? (
              <DiamondColorCarousel
                options={DIAMOND_COLOR_OPTIONS}
                selectedId={memberId}
                onSelect={handlePickColor}
                reduceMotion={settings.reduceMotion}
              />
            ) : (
              <DiamondColorPages
                pages={DIAMOND_COLOR_PAGE_OPTIONS}
                selectedId={memberId}
                onSelect={handlePickColor}
                reduceMotion={settings.reduceMotion}
              />
            )
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
              {/* 断り書き＋Font Awesome の帰属（CC BY 4.0）。ハイ！テンションの終了画面と同じ文言。
                  YouTubeへの道はこの帯から動画の直下へ移した（Hop指示 2026-09-14） */}
              <p style={{ margin: "0.2rem 0 0", fontSize: "0.75rem", color: "#777", textAlign: "center", lineHeight: 1.5, textShadow: "0 0 8px rgba(0,0,0,0.8)" }}>
                楽曲・映像の著作権は権利者に帰属します。<br />
                権利者からの申し出により直ちに公開を停止します。<br />
                <span style={{ fontSize: "0.625rem", color: "#6b7076" }}>Gem icon by Font Awesome (CC BY 4.0)</span>
              </p>
            </>
          ) : null}
        </div>
      </div>
      )}
    </div>
  );
}

/** 終了画面の💎の左右のスワイプで色を替える時の、指の動きの下限(px)【仮】 */
const END_GEM_SWIPE_PX = 24;
/** 秒を「分:秒」にする（終了画面の一番輝いた時刻） */
function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
const endGemArrowStyle: React.CSSProperties = {
  background: "none", border: "none", color: "#e8eaed", fontSize: "1.2rem", lineHeight: 1, padding: "0.4rem 0.35rem", cursor: "pointer", textShadow: "none",
};
const endLabelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "#aab0b6",
  margin: "0 0 0.3rem",
};
