import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getSupabase } from "@/lib/supabase";
import YouTubePlayer, { type YouTubePlayerApi } from "../hi-tension/components/YouTubePlayer";
import HandsCanvas, { type HandsCanvasApi } from "../hi-tension/components/HandsCanvas";
import type { HiSession } from "../hi-tension/api";
import { toVideoSec } from "./skeleton";
import { findBuiltInSong } from "./builtInSongs";
import { ensureCanWrite } from "@/lib/anonAuth";
import HumanCheckGate from "@/components/HumanCheckGate";
import { ALL_MEMBERS } from "@/data/members";
import { isLight } from "@/lib/colorUtils";

/**
 * 置く画面。
 *
 * 画面いっぱいに収める（スクロールしない）。上から順に、動画・色えらび・跳ねる面／振り返り・！ボタン。
 * 常時出るのは3つだけ（曲へ／再生・停止／！）。
 * 跳ねる面はハイ！テンションの客席（HandsCanvas）をそのまま使い、絵だけ「！の入った吹き出し」にしている。
 * 動画の上には何も重ねない。
 *
 * 止まっているあいだは、狙いやすいように大きな再生ボタンを叩く面の上に前面表示する
 * （動画の上には重ねない）。再生が始まったら消え、いまの小さい停止ボタンだけが残る。
 *
 * すでに集まっているぶん（登録済みのコール・過去の参加者の叩き）は、跳ねる面にそのまま流す。
 *
 * メンカラ（推しメンの色）はペンライトの色替えと同じ感覚で、！を叩くたびに変えてよい。
 * 選んでいる色は！ボタン自体を染めて今どの色で叩いているか分かるようにする。
 * 色えらびは丸だけ（名前ラベルは出さない）。公式ペンライトの矢印送りと同じ操作で、
 * 曲中に小さい丸を狙わなくても矢印の連打で目当ての色まで行ける。
 *
 * 叩いた結果（棚に置く1行=1曲を通しで叩いたぶん）は、
 *   ・動画が終わったとき
 *   ・叩きが1個以上ある状態で「曲へ」で離れようとしたとき
 * に振り返りの画面（置いたものが時刻順に並ぶ一覧）を挟んでから送る。
 * 文言はすべて仮置き（あとで差し替える前提。※【仮】マークはUIに出さない）。
 */

type Video = { video_id: string; offset_sec: number; rate: number; label: string | null };

/** 振り返り画面を何が呼び出したか。ボタンの並びが変わる */
type ReviewTrigger = "ended" | "back";

/** 1回の「！」。時刻・そのとき選んでいた色・その色が誰の色か・付けた言葉（棚に送る用） */
type MarkEntry = { id: number; sec: number; colorHex: string; memberId: string | null; word: string | null };

/** 色えらびの1粒（＝チップ）。表示名は出さないので色さえ引ければよい */
type ChipMember = { name: string; color: string };

/**
 * 色えらびの読み元が棚に繋がらないとき用の代わり。src/data/members.ts の今の並び。
 * ツアー時点の名簿でも今の在籍でもないので最後の手段（画面を死なせないためだけに使う）。
 */
function fallbackChipMembers(groupName: string): ChipMember[] {
  return ALL_MEMBERS.filter((m) => m.group === groupName).map((m) => ({ name: m.name, color: m.color }));
}

/** 端末に覚えさせる「最後に選んでいた色」。並び順やお気に入りまでは作り込まない。 */
const LAST_COLOR_KEY = "call_center:last_selected_member_id";
function getLastSelectedColorId(): string | null {
  try { return localStorage.getItem(LAST_COLOR_KEY); } catch { return null; }
}
function setLastSelectedColorId(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_COLOR_KEY, id);
    else localStorage.removeItem(LAST_COLOR_KEY);
  } catch { /* ignore (プライベートモード等) */ }
}

/**
 * 送信前の下書き（叩いたぶん一式）。端末に置くだけで棚には送らない。
 * 曲・動画ごとに分ける（動画を切り替えると秒の物差しが変わるため、混ぜない）。
 */
function draftKey(slug: string, videoId: string): string {
  return `call_center:draft:${slug}:${videoId}`;
}
/** 壊れた下書きで画面を死なせないよう、形が怪しい要素は捨てて読む */
function loadDraft(slug: string, videoId: string): MarkEntry[] {
  try {
    const raw = localStorage.getItem(draftKey(slug, videoId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m): m is MarkEntry =>
      !!m && typeof m === "object"
      && typeof (m as MarkEntry).id === "number"
      && typeof (m as MarkEntry).sec === "number"
      && typeof (m as MarkEntry).colorHex === "string",
    );
  } catch {
    return [];
  }
}
function saveDraft(slug: string, videoId: string, marks: MarkEntry[]): void {
  try {
    if (marks.length === 0) { localStorage.removeItem(draftKey(slug, videoId)); return; }
    localStorage.setItem(draftKey(slug, videoId), JSON.stringify(marks));
  } catch { /* ignore (プライベートモード等) */ }
}
function clearDraft(slug: string, videoId: string): void {
  try { localStorage.removeItem(draftKey(slug, videoId)); } catch { /* ignore */ }
}

/** 明るいグレー。値の発明はしない前提の1つ ※仮の明度 */
const NEUTRAL_HEX = "#d0d0d0";

/**
 * メンバーIDから色を引く。src/data/members.ts（/profile と同じメンバー表）が正。ID=氏名。
 * 見つからなければ（＝メンバーではない）中立のグレーを返す。白は現役メンバーカラー
 * （松本わかな・井上玲音・石井泉羽・中山夏月姫・橋田歩果）と衝突するので使わない。
 */
function resolveMemberColor(id: string): string {
  return ALL_MEMBERS.find((m) => m.name === id)?.color ?? NEUTRAL_HEX;
}

/** 選んでいる色（未選択＝null／メンバー＝氏名）から、実際に表示する色を引く */
function colorIdToHex(id: string | null): string {
  if (id === null) return NEUTRAL_HEX;
  return resolveMemberColor(id);
}
/** 選んでいる色から、棚に送る「メンバーID」を引く。未選択はメンバーではないのでnull */
function colorIdToMemberId(id: string | null): string | null {
  return id;
}

/**
 * 棚の1行を「メンバー(色)ごとの疑似セッション」に分ける。
 * 同じ行でも！を叩いたときの色がバラバラなことがあるので、色ごとに別の跳ねる粒として扱う。
 * session_hash は行ID＋メンバーIDから決定的に作る（再取得のたびに席がワープしないように）。
 */
function hashSessionKey(rowId: string, memberKey: string): number {
  // FNV-1a 32bit
  let h = 0x811c9dc5;
  const s = `${rowId}:${memberKey}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mark_secs は numeric[] なので、PostgREST の版によっては要素が文字列で来ることがある。
// Number() で必ず数へ直してから使う（calls.start_sec 等、既存コードの numeric 変換と同じ流儀）。
// mark_words は 2026-08-15 に棚へ適用済み（scripts/song-structure/create-call-tap-sessions.sql の追記参照）。
// 言葉なしで送られた行は列ごと null で来る。
type TapRow = {
  id: string;
  mark_secs: (number | string)[] | null;
  mark_member_ids: (string | null)[] | null;
  mark_words: (string | null)[] | null;
  created_at: string;
};

function tapRowsToSessions(rows: TapRow[]): HiSession[] {
  const today = new Date().toISOString().slice(0, 10);
  const out: HiSession[] = [];
  for (const row of rows) {
    const secs = (row.mark_secs ?? []).map(Number);
    const memberIds = row.mark_member_ids ?? [];
    // メンバーID（未選択は "" ＝グレー）ごとに秒をまとめる
    const byMember = new Map<string, number[]>();
    secs.forEach((sec, i) => {
      const key = memberIds[i] ?? "";
      const arr = byMember.get(key) ?? [];
      arr.push(sec);
      byMember.set(key, arr);
    });
    const playedDate = row.created_at?.slice(0, 10) || today;
    for (const [key, memberSecs] of byMember) {
      out.push({
        session_hash: hashSessionKey(row.id, key),
        member_id: key, // "" は resolveMemberColor がメンバー無しとしてグレーを返す
        is_today: playedDate === today,
        bucket_indices: memberSecs.map((t) => Math.round(t * 10)),
        bucket_indices_20: memberSecs.map((t) => Math.round(t * 20)),
        played_date: playedDate,
      });
    }
  }
  return out;
}

/** 秒と言葉の対。候補チップの元データ（跳ねる面には使わない。tapRowsToSessions とは別に保持する） */
type WordPair = { sec: number; word: string };

/** 棚から読んだ行から「秒と言葉の対」だけを抜き出す（言葉が付いていないものは除く） */
function extractWordPairs(rows: TapRow[]): WordPair[] {
  const out: WordPair[] = [];
  for (const row of rows) {
    const secs = (row.mark_secs ?? []).map(Number);
    const words = row.mark_words ?? [];
    secs.forEach((sec, i) => {
      const w = words[i];
      if (w) out.push({ sec, word: w });
    });
  }
  return out;
}

/**
 * ある！の候補チップを作る。範囲はその！の秒の前後4拍（BPMが出せなければ前後2秒）。
 * 出どころは2つ: 棚から読んだ他の参加者の言葉（crowdWords）と、この参加で自分が
 * 既に付けた言葉（marks・対象自身は除く）。同じ言葉はまとめて多い順、最大8個。
 */
function candidateWords(target: MarkEntry, marks: MarkEntry[], crowdWords: WordPair[]): string[] {
  const beatSec = estimateBeatSec(marks);
  const windowSec = beatSec ? 4 * beatSec : 2;
  const lo = target.sec - windowSec;
  const hi = target.sec + windowSec;
  const counts = new Map<string, number>();
  const add = (w: string) => counts.set(w, (counts.get(w) ?? 0) + 1);
  for (const cw of crowdWords) {
    if (cw.sec >= lo && cw.sec <= hi) add(cw.word);
  }
  for (const mk of marks) {
    if (mk.id !== target.id && mk.word && mk.sec >= lo && mk.sec <= hi) add(mk.word);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);
}

/**
 * 直前に確定した言葉は、4拍の窓に関係なく常に先頭のチップに出す（連続する同じコールに効く）。
 * すでに候補に入っていれば先頭へ移すだけ、無ければ足して先頭に置く（最大8個は維持）。
 */
function withPinnedFirst(list: string[], pinned: string | null): string[] {
  if (!pinned) return list;
  const rest = list.filter((w) => w !== pinned);
  return [pinned, ...rest].slice(0, 8);
}

/** 見返すときに何秒巻き戻すか。BPMが出せなかったときの代わり ※仮 */
const REWIND_SEC = 5;

/** 配列の中央値。採譜画面（ArigatoBeatTapPage）の同名の関数と同じ計算 */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * 間隔を 0.375〜0.75秒（＝80〜160BPM）の窓へ、倍・半分で折り返す。
 * 80〜160BPMの窓。これより速い曲は半分に読まれるが、カウントイン用途では拍として破綻しない。
 * 倍・半分の完全な判別は叩きだけでは原理的にできないので、いずれ曲ごとの確定BPMを棚に持つ
 * （その時はそちらを最優先）。
 *
 * 単純な「全間隔の中央値」だと、1拍ごとに叩いた山（0.4秒台）と2拍ごとに叩いた山（0.8秒台）の
 * 谷間に中央値が落ちる欠陥がある（実データで確認済み: 素の中央値0.667秒=90BPM、実際は146BPM）。
 * 折り返してから中央値を取ることで、この谷間落ちを避ける。
 */
function foldToBeatWindow(x: number): number {
  let y = x;
  while (y < 0.375) y *= 2;
  while (y >= 0.75) y /= 2;
  return y;
}

/**
 * 秒の並びから、大まかな拍の長さ（秒）を見積もる。
 * 採譜画面と同じやり方: 隣り合う間隔のうち 0.15〜3秒 のものだけを集め（ふるい）、
 * それぞれを foldToBeatWindow で折り返してから中央値を取る。
 * 有効な間隔が少なすぎるとき（4個未満 ※仮）は null＝BPMが出せない扱いにする。
 */
function estimateBeatSecFromSecs(secsIn: number[]): number | null {
  const secs = [...secsIn].sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < secs.length; i++) {
    const d = secs[i] - secs[i - 1];
    if (d > 0.15 && d < 3) intervals.push(d);
  }
  if (intervals.length < 4) return null;
  return median(intervals.map(foldToBeatWindow));
}

/** この参加で叩いた間隔から拍の長さを見積もる（自分の marks 版） */
function estimateBeatSec(marks: MarkEntry[]): number | null {
  return estimateBeatSecFromSecs(marks.map((m) => m.sec));
}

/** 見返しのカウントイン先。対象の秒・拍の長さ・その！の色（カウントイン明けに出す） */
type PreviewTarget = { sec: number; beatSec: number; colorHex: string };

/** エラーの中身を一行にする。理由が分からないまま「送れません」だけだと調べようがないため */
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 「大きい文字」レーンの1粒。id は言葉ごとに振り直す通し番号で作る安定キー。
 * row（上下2段のどちらに置くか）は buildWordGroups の中で1回だけ決めて、以後は変えない
 * （再生位置が動くたびに窓に出入りする言葉の並びで row を決め直すと、そのつど段が入れ替わって
 * 縦にガタガタ動いて見える事故になる。実際に置く画面の実機で「言葉が縦に流れる」と報告があり、
 * 原因はこれだった）。
 */
type LaneGroup = { id: string; word: string; sec: number; count: number; row: number };

/**
 * crowdWords を「同じ言葉が近い時刻に複数」でまとめる。
 * 言葉ごとに秒を昇順に並べ、直前の点から beatSec 以内なら同じ塊として吸収する
 * （鎖状の簡単なクラスタリング。凝った物理は要らないという方針に合わせた作り）。
 * 代表秒は塊の中央値、人数は塊に入った件数。
 * 最後に全体を時刻順に並べ、隣り合う塊が同じ段にならないよう上下2段を交互に割り当てる
 * （crowdWords が変わったときしか呼ばないので、ここで決めた row は再生中ずっと固定）。
 */
function buildWordGroups(crowdWords: WordPair[], beatSec: number): LaneGroup[] {
  const byWord = new Map<string, number[]>();
  for (const cw of crowdWords) {
    const arr = byWord.get(cw.word) ?? [];
    arr.push(cw.sec);
    byWord.set(cw.word, arr);
  }
  const out: { id: string; word: string; sec: number; count: number }[] = [];
  for (const [word, secsIn] of byWord) {
    const secs = [...secsIn].sort((a, b) => a - b);
    let cluster: number[] = [];
    let seq = 0;
    const flush = () => {
      if (cluster.length === 0) return;
      out.push({ id: `${word}:${seq++}`, word, sec: median(cluster), count: cluster.length });
      cluster = [];
    };
    for (const s of secs) {
      if (cluster.length === 0 || s - cluster[cluster.length - 1] <= beatSec) cluster.push(s);
      else { flush(); cluster.push(s); }
    }
    flush();
  }
  return out
    .sort((a, b) => a.sec - b.sec)
    .map((g, i) => ({ ...g, row: i % 2 }));
}

/**
 * レーン上の1粒の見た目（横位置・大きさ・色・不透明度）を、いまの再生秒から計算してDOMへ直接書く。
 * 横位置は「その言葉の秒 − いまの再生秒」で決める: +4拍先＝右端、0拍（いま）＝中央、−4拍過去＝左端。
 * 縦位置(row)はここでは触らない（buildWordGroups で決めた固定値のまま。CSSのtopが受け持つ）。
 * 窓の端（±4拍）に近いところはフェード（入ってくる／出ていく）にする。
 */
function positionLaneItem(el: HTMLDivElement, g: LaneGroup, now: number, beatSec: number, halfW: number) {
  const windowSec = 4 * beatSec;
  const d = g.sec - now; // + は未来（右）、− は過去（左）
  const offsetPx = (d / windowSec) * halfW;
  const isPeak = Math.abs(d) <= beatSec / 2;
  const scale = isPeak ? Math.min(3, 1.6 + (g.count - 1) * 0.3) : 1;
  // 窓の端の手前1拍でフェード。入ってくる言葉／出ていく言葉が唐突に現れ・消えないように
  const fadeZone = Math.min(beatSec, windowSec);
  const dist = Math.abs(d);
  const opacity = dist > windowSec - fadeZone
    ? Math.max(0, 1 - (dist - (windowSec - fadeZone)) / fadeZone)
    : 1;
  el.style.transform = `translate(-50%, -50%) translateX(${offsetPx}px) scale(${scale})`;
  el.style.color = isPeak ? "#fff" : "#888";
  el.style.opacity = String(opacity);
}

/**
 * 「大きい文字」レーン。再生中、いまの位置の前後4拍にある言葉を右→左に流す
 * （カラオケのレーンと同じ考え方。いまの再生位置がレーンの中央。未来の言葉が右から入ってくる）。
 * 該当の拍の瞬間（代表秒の±半拍）だけ大きく・白くなる。窓の端でフェード。停止中・振り返り中は出さない。
 *
 * 毎フレームReactを再描画しない: 位置・大きさ・色・不透明度は直接DOM（ref経由）を動かし、
 * Reactの再描画（state更新）は「窓に入っている言葉の集合が変わったとき」だけに絞る。
 */
function WordLane({ playerRef, crowdWords, active }: {
  playerRef: { current: YouTubePlayerApi | null };
  crowdWords: WordPair[];
  active: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(0);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const [visibleItems, setVisibleItems] = useState<LaneGroup[]>([]);

  // 拍の長さは群衆の秒から見積もる（自分の marks ではない）。出せなければ0.5秒で仮置き
  const beatSec = useMemo(
    () => estimateBeatSecFromSecs(crowdWords.map((w) => w.sec)) ?? 0.5,
    [crowdWords],
  );
  const groups = useMemo(() => buildWordGroups(crowdWords, beatSec), [crowdWords, beatSec]);

  // レーンの実際の幅を控えておく（毎フレーム clientWidth を読むと余計なレイアウト計算になるため）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    widthRef.current = el.clientWidth;
    const ro = new ResizeObserver(() => { widthRef.current = el.clientWidth; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!active) { setVisibleItems([]); return; }
    let raf = 0;
    let lastKey = "";
    const windowSec = 4 * beatSec;
    const tick = () => {
      const now = playerRef.current?.getCurrentTime() ?? 0;
      const inWindow = groups.filter((g) => Math.abs(g.sec - now) <= windowSec);

      // 窓に入っている集合が変わったときだけReactを再描画。row は既に固定値として付いているので
      // ここでは並び替え・割り当て直しは一切しない（縦のガタつき事故の再発防止）
      const key = inWindow.map((g) => g.id).join(",");
      if (key !== lastKey) {
        lastKey = key;
        setVisibleItems(inWindow);
      }

      // 位置・大きさ・色・不透明度は毎フレーム、DOMへ直接書く（Reactを経由しない）
      const halfW = widthRef.current / 2;
      for (const g of inWindow) {
        const el = itemRefs.current.get(g.id);
        if (!el) continue;
        positionLaneItem(el, g, now, beatSec, halfW);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, groups, beatSec, playerRef]);

  if (!active || visibleItems.length === 0) return null;

  return (
    <div ref={containerRef} style={S.wordLane}>
      {visibleItems.map((it) => (
        <div
          key={it.id}
          ref={(el) => {
            if (el) {
              itemRefs.current.set(it.id, el);
              // マウントした瞬間に正しい位置へ書いておく（次のrAFまで中央にちらつくのを防ぐ）
              positionLaneItem(el, it, playerRef.current?.getCurrentTime() ?? 0, beatSec, widthRef.current / 2);
            } else {
              itemRefs.current.delete(it.id);
            }
          }}
          style={{ ...S.wordLaneItem, top: it.row === 0 ? "30%" : "70%" }}
        >
          {it.word}
        </div>
      ))}
    </div>
  );
}

export default function PlacePage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const playerRef = useRef<YouTubePlayerApi>(null);
  const handsRef = useRef<HandsCanvasApi>(null);
  const markIdRef = useRef(0);

  const [title, setTitle] = useState("");
  const [groupName, setGroupName] = useState("");
  const [video, setVideo] = useState<Video | null>(null);
  const [sessions, setSessions] = useState<HiSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  // 叩いたもの一つひとつ。棚へ送るときはここから秒の列・メンバーIDの列を取り出す。
  const [marks, setMarks] = useState<MarkEntry[]>([]);
  // 今選んでいる色（ペンライトの色替え）。null=色なし（既定＝グレー扱い）
  const [currentColor, setCurrentColor] = useState<string | null>(null);
  // 振り返りの「見返す」で、カウントイン中の対象。無ければ固定巻き戻しのまま（バナーも出さない）
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [previewStep, setPreviewStep] = useState<string | null>(null);
  // 見返し中、この秒を過ぎたら自動で止める（！の瞬間から4拍・BPM不明なら2秒ぶん流したら止める）
  const [previewStopAt, setPreviewStopAt] = useState<number | null>(null);
  // 棚から読んだ、他の参加者が付けた「秒と言葉の対」。候補チップの元データ
  const [crowdWords, setCrowdWords] = useState<WordPair[]>([]);
  // 振り返り画面で、今どの！の言葉を編集中か。行の本体を押すと開く（別画面にはしない）
  const [editingMarkId, setEditingMarkId] = useState<number | null>(null);
  const [wordDraft, setWordDraft] = useState("");
  // 直前に確定した言葉。次の候補チップの先頭に常に出す（同じコールの連続に効く）
  const [lastConfirmedWord, setLastConfirmedWord] = useState<string | null>(null);

  const [reviewTrigger, setReviewTrigger] = useState<ReviewTrigger | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // 送れたときの一言。これが無いと、数がゼロに戻るのが「消えた」ように見えて不安にさせる
  const [sendDone, setSendDone] = useState<string | null>(null);
  // 人間確認を出しているあいだ、答えが返るまで待つための受け皿（SongTapPage と同じ形）
  const [gate, setGate] = useState<((t: string | null) => void) | null>(null);

  const askForToken = () =>
    new Promise<string | null>((resolve) => {
      setGate(() => (t: string | null) => { setGate(null); resolve(t); });
    });

  // 色えらびに出すメンバー。曲に紐づくツアーの固定名簿→今の在籍→（棚に繋がらない時だけ）
  // members.ts の代用、の順で決まる。詳しくは effect 内のコメントを参照。
  const [chipMembers, setChipMembers] = useState<ChipMember[]>([]);

  // 色えらびの選択肢。グレー（色なし）・メンバー（公式の並び順）、の順で固定。
  // 白は既定色にしない（松本わかな・井上玲音・石井泉羽・中山夏月姫・橋田歩果の現役メンカラと衝突するため）
  const colorOptions = useMemo(
    () => [
      { id: null as string | null, hex: NEUTRAL_HEX },
      ...chipMembers.map((m) => ({ id: m.name as string | null, hex: m.color })),
    ],
    [chipMembers],
  );

  // 端末に覚えている色を復元。この曲の色えらびに無ければ復元しない
  // （どの丸も光っていないのに！ボタンだけ色付いている、という食い違いを避けるため）
  useEffect(() => {
    const remembered = getLastSelectedColorId();
    if (remembered && chipMembers.some((m) => m.name === remembered)) {
      setCurrentColor(remembered);
    }
  }, [chipMembers]);

  useEffect(() => {
    let alive = true;
    setError(null);

    // 画面を開いたとき、同じ曲・動画の下書きがあれば黙って復元する
    // （！の個数がヘッダーに出るので、復元されたことには気づける）。
    // 新しいIDが下書きのIDと衝突しないよう、採番カウンタを続きから始める
    const restoreDraft = (videoId: string) => {
      const draft = loadDraft(slug, videoId);
      if (draft.length === 0) return;
      setMarks(draft);
      markIdRef.current = Math.max(0, ...draft.map((m) => m.id));
    };

    // 棚に入っていない曲は同梱データで開く
    const builtIn = findBuiltInSong(slug);
    const openBuiltIn = () => {
      if (!builtIn) return false;
      setTitle(builtIn.title);
      setGroupName(builtIn.groupName);
      // 同梱データには曲もツアーも紐付いていない＝棚に繋がらない時と同じ代用でよい
      setChipMembers(fallbackChipMembers(builtIn.groupName));
      const v = builtIn.videos[0];
      if (v) {
        setVideo({ video_id: v.videoId, offset_sec: v.offsetSec, rate: 1, label: v.label });
        restoreDraft(v.videoId);
      }
      return true;
    };

    try {
      getSupabase()
        .from("song_structures")
        .select("id, title, group_name, tour_key, song_video_offsets(video_id, offset_sec, rate, label)")
        .eq("slug", slug)
        .maybeSingle()
        .then(({ data }) => {
          if (!alive) return;
          if (!data) { if (!openBuiltIn()) setError("この曲は見つかりませんでした"); return; }
          const d = data as unknown as { id: string; title: string; group_name: string; tour_key: string | null; song_video_offsets: Video[] };
          setTitle(d.title);
          setGroupName(d.group_name);
          const v = d.song_video_offsets?.[0];
          if (!v) { setError("この曲にはまだ動画が結び付いていません"); return; }
          setVideo({ video_id: v.video_id, offset_sec: Number(v.offset_sec), rate: Number(v.rate) || 1, label: v.label });
          restoreDraft(v.video_id);

          /**
           * 色えらびに出すメンバー。3段のフォールバック:
           * 1) 曲にツアーの紐付きがあれば tour_rosters（ツアー時点の固定名簿）
           * 2) 無ければ hello_members の今の在籍（並び順の欄が無いので、members.ts と
           *    同じ並びの名前はその順、無い名前は名前順で末尾に置く）
           * 3) どちらも読めなければ（棚に繋がらない等）members.ts の代用（画面を死なせない）
           */
          if (d.tour_key) {
            getSupabase()
              .from("tour_rosters")
              .select("name, color, display_order")
              .eq("tour_key", d.tour_key)
              .order("display_order", { ascending: true })
              .then(({ data: rosterRows }) => {
                if (!alive) return;
                if (!rosterRows || rosterRows.length === 0) { setChipMembers(fallbackChipMembers(d.group_name)); return; }
                setChipMembers((rosterRows as { name: string; color: string }[]).map((r) => ({ name: r.name, color: r.color })));
              }, () => { if (alive) setChipMembers(fallbackChipMembers(d.group_name)); });
          } else {
            getSupabase()
              .from("hello_members")
              .select("name, color")
              .eq("group_name", d.group_name)
              .eq("active", true)
              .not("color", "is", null)
              .then(({ data: activeRows }) => {
                if (!alive) return;
                if (!activeRows) { setChipMembers(fallbackChipMembers(d.group_name)); return; }
                const rows = (activeRows as { name: string; color: string | null }[])
                  .filter((r): r is { name: string; color: string } => !!r.color);
                if (rows.length === 0) { setChipMembers(fallbackChipMembers(d.group_name)); return; }
                // members.ts に同じ名前があればその並び順、無い名前は名前順で末尾に置く
                const order = new Map(ALL_MEMBERS.filter((m) => m.group === d.group_name).map((m, i) => [m.name, i]));
                rows.sort((a, b) => {
                  const ai = order.get(a.name) ?? Number.MAX_SAFE_INTEGER;
                  const bi = order.get(b.name) ?? Number.MAX_SAFE_INTEGER;
                  if (ai !== bi) return ai - bi;
                  return a.name.localeCompare(b.name, "ja");
                });
                setChipMembers(rows);
              }, () => { if (alive) setChipMembers(fallbackChipMembers(d.group_name)); });
          }

          // すでに登録されているコールを、跳ねる面に流すぶんとして読む
          getSupabase()
            .rpc("get_song_calls", { p_song_id: d.id })
            .then(({ data: rows }) => {
              if (!alive || !rows) return;
              const secs = (rows as { start_sec: number | null }[])
                .filter((r) => r.start_sec !== null)
                .map((r) => toVideoSec(Number(r.start_sec), Number(v.offset_sec), Number(v.rate) || 1));
              if (secs.length === 0) return;
              setSessions((prev) => [...prev, {
                session_hash: 424242,
                member_id: "", // 誰の色でもない＝グレー（resolveMemberColorが見つけられないIDにしている）
                is_today: true,
                bucket_indices: secs.map((t) => Math.round(t * 10)),
                bucket_indices_20: secs.map((t) => Math.round(t * 20)),
                played_date: new Date().toISOString().slice(0, 10),
              }]);
            }, () => { /* 読めなくても置く画面は成り立つ */ });

          // 過去の参加者が叩いたぶんも、同じ動画のものだけ跳ねる面に流す
          // （動画が違うと秒の物差しも違うので混ぜない＝ハイ！テンションの「動画ごとに客席を分ける」流儀と同じ）。
          // 件数はキリなく増えるので直近200行に絞る（過去のディスク負荷事故の再発防止）。
          // 読みに失敗しても置く画面は成り立つよう、黙って諦める（跳ねと候補が出ないだけ）。
          // mark_words は跳ねる面には使わない（tapRowsToSessions は今までどおり）。
          // 候補チップに使う「秒と言葉の対」だけ別途 crowdWords に持っておく。
          getSupabase()
            .from("call_tap_sessions")
            .select("id, mark_secs, mark_member_ids, mark_words, created_at")
            .eq("song_id", d.id)
            .eq("video_id", v.video_id)
            .order("created_at", { ascending: false })
            .limit(200)
            .then(({ data: tapRows }) => {
              if (!alive || !tapRows) return;
              const rows = tapRows as TapRow[];
              const crowd = tapRowsToSessions(rows);
              if (crowd.length > 0) setSessions((prev) => [...prev, ...crowd]);
              const words = extractWordPairs(rows);
              if (words.length > 0) setCrowdWords((prev) => [...prev, ...words]);
            }, () => { /* 読めなくても置く画面は成り立つ */ });
        }, () => { if (alive && !openBuiltIn()) setError("いま棚に繋がりません"); });
    } catch {
      if (!openBuiltIn()) setError("いま棚に繋がりません");
    }
    return () => { alive = false; };
  }, [slug]);

  // 叩いたぶんが変わるたびに下書きを端末へ保存する（送信前の保険）。
  // marksが空になったとき（送信成功後など）は保存側で自動的にキーごと消える
  useEffect(() => {
    if (!video) return;
    saveDraft(slug, video.video_id, marks);
  }, [marks, video, slug]);

  const onTime = (sec: number) => {
    handsRef.current?.onTimeUpdate(sec);

    // 見返しのカウントイン中なら、今どの段階か（5・6・7・8→！）を出す
    if (previewTarget) {
      const d = sec - previewTarget.sec; // + は対象を過ぎた
      const b = previewTarget.beatSec;
      let step: string | null = null;
      if (d >= -4 * b && d < -3 * b) step = "5";
      else if (d >= -3 * b && d < -2 * b) step = "6";
      else if (d >= -2 * b && d < -1 * b) step = "7";
      else if (d >= -1 * b && d < 0) step = "8";
      else if (d >= 0 && d < b) step = "mark";
      setPreviewStep((prev) => (prev === step ? prev : step));
    }

    // 見返し中、！の瞬間から決めた秒数ぶん流したら自動で止めて振り返りへ戻す
    if (previewStopAt !== null && sec >= previewStopAt) {
      playerRef.current?.pause();
      setPlaying(false);
      clearPreview();
    }
  };

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isPlaying()) { p.pause(); setPlaying(false); }
    else { p.play(); setPlaying(true); }
  };

  /**
   * YouTube側の状態変化。ネイティブの再生バーで手動停止したときも拾うため
   * （見返し中に手動で止めたときも、見返しの状態を終える）。
   * YT.PlayerState: 1=PLAYING, 2=PAUSED, 0=ENDED（ENDEDは既存の onEnded 側で扱う）
   */
  const onPlayerStateChange = (state: number) => {
    if (state === 1) setPlaying(true);
    else if (state === 2) {
      setPlaying(false);
      if (previewTarget || previewStopAt !== null) clearPreview();
    }
  };

  /** 見返しのカウントイン表示・自動停止の予約を消す（振り返り画面を開く・閉じる・離れるとき、手動停止時に呼ぶ） */
  const clearPreview = () => {
    setPreviewTarget(null);
    setPreviewStep(null);
    setPreviewStopAt(null);
  };

  /** 動画が最後まで再生された。叩きが1個以上あれば振り返りを出す */
  const onEnded = () => {
    setPlaying(false);
    if (marks.length > 0) { clearPreview(); setReviewTrigger("ended"); }
  };

  /** 色えらびの丸を直接押す */
  const pickColor = (id: string | null) => {
    setCurrentColor(id);
    setLastSelectedColorId(id);
  };

  /** 矢印での色送り（公式ペンライトの色替えと同じ操作）。delta=-1で前、+1で次 */
  const moveColor = (delta: number) => {
    const idx = colorOptions.findIndex((o) => o.id === currentColor);
    const base = idx === -1 ? 0 : idx;
    const next = (base + delta + colorOptions.length) % colorOptions.length;
    pickColor(colorOptions[next].id);
  };

  /** 押した瞬間（onPointerDown）に出す。指を離すのを待つとその分そのまま遅れて感じる。 */
  const pressMark = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const colorHex = colorIdToHex(currentColor);
    handsRef.current?.spawnSelf(colorHex);
    const sec = Math.round((playerRef.current?.getCurrentTime() ?? 0) * 1000) / 1000;
    const id = ++markIdRef.current;
    setMarks((arr) => [...arr, { id, sec, colorHex, memberId: colorIdToMemberId(currentColor), word: null }]);
  };

  /** 「曲へ」。叩きが残っていれば振り返りを挟む。ゼロならそのまま戻る */
  const handleBack = () => {
    if (marks.length > 0) { clearPreview(); setReviewTrigger("back"); return; }
    navigate(`/call-center/song/${slug}`);
  };

  /**
   * 振り返り画面の「見返す」。
   * この参加のタップ間隔からBPMが出せれば、対象の4拍前から再生してカウントイン
   * （5・6・7・8→その！の色で！）を出す。出せない・間隔が足りないときは、
   * これまでどおり固定 REWIND_SEC 秒の巻き戻しだけにする（カウントインのバナーも出さない）。
   * どちらの場合も、！の瞬間から一定時間（BPMが出せれば4拍・出せなければ2秒）流したら
   * 自動で止めて振り返りへ戻す（動画を最後まで見ないと戻れない、を避けるため）。
   * play() は「動画が終わった直後（ENDED状態）」だと内部で先頭(0秒)へ戻す仕様なので、
   * 先に play() を呼んでから seekTo で狙った位置へ上書きする（逆順だと 0秒に戻されて消える）。
   */
  const seekPreview = (target: MarkEntry) => {
    const beatSec = estimateBeatSec(marks);
    playerRef.current?.play();
    if (beatSec) {
      playerRef.current?.seekTo(Math.max(0, target.sec - 4 * beatSec));
      setPreviewTarget({ sec: target.sec, beatSec, colorHex: target.colorHex });
      setPreviewStep(null);
      setPreviewStopAt(target.sec + 4 * beatSec);
    } else {
      playerRef.current?.seekTo(Math.max(0, target.sec - REWIND_SEC));
      clearPreview();
      setPreviewStopAt(target.sec + 2);
    }
    setPlaying(true);
  };

  /** 振り返り画面の「×」。棚にはまだ送っていないので、画面の中の並びから外すだけでよい */
  const removeMark = (id: number) => {
    setMarks((arr) => arr.filter((m) => m.id !== id));
  };

  /**
   * 振り返り画面で、その行の色の丸を押したときの塗り替え。
   * 今チップ列で選んでいる色（currentColor）で、その！を上書きするだけ。
   * まだ送信前の画面内の値なので、取り消しは作らず「選び直して押し直せば済む」でよい。
   */
  const recolorMark = (id: number) => {
    const colorHex = colorIdToHex(currentColor);
    const memberId = colorIdToMemberId(currentColor);
    setMarks((arr) => arr.map((m) => (m.id === id ? { ...m, colorHex, memberId } : m)));
  };

  /** 振り返り画面で、行の本体を押すと言葉の入力に変わる（別画面にはしない） */
  const startEditWord = (m: MarkEntry) => {
    setEditingMarkId(m.id);
    setWordDraft(m.word ?? "");
  };

  /** 言葉の「確定」（入力欄から）。空で確定＝言葉を消す */
  const confirmWord = () => {
    const trimmed = wordDraft.trim();
    const word = trimmed === "" ? null : trimmed;
    setMarks((arr) => arr.map((m) => (m.id === editingMarkId ? { ...m, word } : m)));
    if (word) setLastConfirmedWord(word);
    setEditingMarkId(null);
    setWordDraft("");
  };

  /** 候補チップを押したとき。確定の1タップを省き、押したら即その言葉で決めて閉じる */
  const chooseWord = (word: string) => {
    setMarks((arr) => arr.map((m) => (m.id === editingMarkId ? { ...m, word } : m)));
    setLastConfirmedWord(word);
    setEditingMarkId(null);
    setWordDraft("");
  };

  /** 言葉の「やめる」。何も変えずに閉じる */
  const cancelWordEdit = () => {
    setEditingMarkId(null);
    setWordDraft("");
  };

  /** 送信エラーを画面に出す。理由を読む時間を確保するため少し長めに出しておく */
  const showSendError = (msg: string) => {
    setSendError(msg);
    setTimeout(() => setSendError(null), 9000);
  };

  /**
   * 叩いたぶんを棚へ送る。
   * 1) まだ入場していなければ人間確認を出す
   * 2) 曲の鍵（song_structures.id）を棚から引く（同梱データの仮の鍵ではなく本物の鍵が要る）
   * 3) 送る本人（匿名ログインのID）を添えて1行として入れる（秒・メンバーID・言葉の3つの並び）
   *
   * mark_words 列は 2026-08-15 に棚へ適用済み。
   * 送信に失敗しても画面が壊れないよう、失敗したらその場に留まる。
   * 失敗の理由（err.message）はそのまま画面に出す。原因が分からないまま握りつぶすと、
   * 手が空くまで何度も無駄に試すことになるため（オーナーの実機テストで実際に起きた）。
   * 「入場の確認」由来と「送信」由来を分けて出す。
   */
  const doSend = async (): Promise<boolean> => {
    if (!video || marks.length === 0) return false;
    setSendError(null);
    setSending(true);

    let ok: boolean;
    try {
      ok = await ensureCanWrite(askForToken);
    } catch (err) {
      setSending(false);
      showSendError(`入場の確認で止まりました（${errMessage(err)}）。時間をおいてもう一度`);
      return false;
    }
    if (!ok) {
      // 本人が確認をやめただけなので、失敗としては扱わない（赤いバナーは出さない）
      setSending(false);
      return false;
    }

    try {
      const db = getSupabase();
      const { data: row, error: e1 } = await db
        .from("song_structures").select("id").eq("slug", slug).maybeSingle();
      if (e1) throw e1;
      if (!row) throw new Error("この曲はまだ棚に登録されていません");

      const { data: userData, error: e2 } = await db.auth.getUser();
      if (e2) throw e2;
      if (!userData.user) throw new Error("入場情報を取得できませんでした");

      const { error: e3 } = await db.from("call_tap_sessions").insert({
        song_id: row.id,
        video_id: video.video_id,
        mark_secs: marks.map((m) => m.sec),
        mark_member_ids: marks.map((m) => m.memberId),
        mark_words: marks.map((m) => m.word),
        created_by: userData.user.id,
      });
      if (e3) throw e3;

      // 送れた＝この参加は1行として棚に乗った。次の通しはゼロから数え直す。
      // 数がゼロに戻る前に「送れた」と言う（黙って消すと、消えたように見えて不安にさせる）
      setSendDone(`！ ${marks.length}個 を送りました。ありがとうございました`);
      setTimeout(() => setSendDone(null), 6000);
      setMarks([]);
      setSending(false);
      return true;
    } catch (err) {
      setSending(false);
      showSendError(`送信で止まりました（${errMessage(err)}）。時間をおいてもう一度`);
      return false;
    }
  };

  const onReviewSend = async () => {
    const ok = await doSend();
    if (!ok) return; // 失敗。振り返り画面は開いたまま、その場に留まる
    clearPreview();
    cancelWordEdit();
    setReviewTrigger(null);
    if (reviewTrigger === "back") navigate(`/call-center/song/${slug}`);
  };

  /** 「まだ叩く」：振り返り画面を閉じるだけ、その場に留まって続きを叩ける */
  const onReviewKeepTapping = () => {
    clearPreview();
    cancelWordEdit();
    setReviewTrigger(null);
  };

  /** 「送らずに戻る」（back起点のみ）：送らずに離脱する。捨てる選択なので下書きも消す */
  const onReviewLeaveWithoutSending = () => {
    if (video) clearDraft(slug, video.video_id);
    clearPreview();
    cancelWordEdit();
    setReviewTrigger(null);
    navigate(`/call-center/song/${slug}`);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;

  if (error) {
    return (
      <div style={{ ...S.page, justifyContent: "center", alignItems: "center" }}>
        <p style={{ fontSize: 14 }}>{error}</p>
        <button style={S.play} onClick={() => navigate(`/call-center/song/${slug}`)}>曲へ</button>
      </div>
    );
  }

  const currentColorHex = colorIdToHex(currentColor);
  const markBg = currentColorHex;
  const markFg = isLight(currentColorHex) ? "#000" : "#fff";
  // 時刻順に並べて見せる（叩いた順とは限らない＝巻き戻して見返した後にまた叩く、があるため）
  const sortedMarks = [...marks].sort((a, b) => a.sec - b.sec);

  // 色えらび（丸だけ・名前は出さない）。公式ペンライトと同じく矢印でも送れる。
  // 振り返り画面でも出す＝行ごとの色の塗り直しに使うチップ列と同じもの（画面を増やさない）
  const colorPicker = (
    <div style={S.colorPickerRow}>
      <button type="button" style={S.arrowBtn} onClick={() => moveColor(-1)} aria-label="前の色">◀</button>
      <div style={S.dotsRow}>
        {colorOptions.map((opt) => {
          const selected = opt.id === currentColor;
          return (
            <button
              key={opt.id ?? "neutral"}
              type="button"
              onClick={() => pickColor(opt.id)}
              aria-label={opt.id === null ? "色なし" : opt.id}
              style={{
                ...S.dot,
                background: opt.hex,
                transform: selected ? "scale(1.35)" : "scale(1)",
                boxShadow: selected
                  ? "0 0 0 2px #fff, inset 0 0 0 1px rgba(0,0,0,0.35)"
                  : "inset 0 0 0 1px rgba(0,0,0,0.35)",
                zIndex: selected ? 1 : 0,
              }}
            />
          );
        })}
      </div>
      <button type="button" style={S.arrowBtn} onClick={() => moveColor(1)} aria-label="次の色">▶</button>
    </div>
  );

  return (
    <div style={S.page}>
      {gate && <HumanCheckGate onDone={gate} />}
      {sendError && <div style={S.errorBanner}>{sendError}</div>}
      {sendDone && <div style={S.doneBanner}>{sendDone}</div>}

      <div style={S.head}>
        <button style={S.back} onClick={handleBack}>曲へ</button>
        <span style={S.title}>{title}</span>
        <span style={S.count}>！ {marks.length}</span>
      </div>

      <div style={S.videoBox}>
        {video && (
          <YouTubePlayer
            ref={playerRef}
            videoId={video.video_id}
            onEnded={onEnded}
            onTimeUpdate={onTime}
            onPlayerStateChange={onPlayerStateChange}
          />
        )}
      </div>

      {reviewTrigger ? (
        /* 振り返り画面。動画は上に出たままなので「見返す」で流しながら一覧を読める */
        <div style={S.reviewWrap}>
          {previewTarget && (
            /* 見返しのカウントイン。動画の上には重ねない（一覧の上に小さく出すだけ） */
            <div style={S.countBanner}>
              <span style={{ color: previewStep === "mark" ? previewTarget.colorHex : "#cbd2dc" }}>
                {previewStep === "mark" ? "！" : previewStep ?? "見返し中…"}
              </span>
            </div>
          )}
          <div style={S.reviewList}>
            {sortedMarks.map((m) =>
              editingMarkId === m.id ? (
                /* 言葉の入力（行の本体を押すとここに変わる。別画面にはしない） */
                <div key={m.id} style={S.reviewRowEditing}>
                  <div style={S.reviewRowEditingTop}>
                    <span style={S.reviewTime}>{fmt(m.sec)}</span>
                    <input
                      type="text"
                      value={wordDraft}
                      onChange={(e) => setWordDraft(e.target.value)}
                      maxLength={12}
                      placeholder="ここに書く…"
                      style={S.wordInput}
                      autoFocus
                    />
                    <button type="button" style={S.wordConfirm} onClick={confirmWord}>確定</button>
                    <button type="button" style={S.reviewRemove} onClick={cancelWordEdit} aria-label="やめる">×</button>
                  </div>
                  {(() => {
                    // 押したら即その言葉で確定して閉じる（入力欄に入れるだけの1手を省く）。
                    // 直前に確定した言葉は、窓に入っていなくても常に先頭に出す
                    const candidates = withPinnedFirst(candidateWords(m, marks, crowdWords), lastConfirmedWord);
                    return candidates.length > 0 ? (
                      <div style={S.wordChipRow}>
                        {candidates.map((w) => (
                          <button key={w} type="button" style={S.wordChip} onClick={() => chooseWord(w)}>{w}</button>
                        ))}
                      </div>
                    ) : null;
                  })()}
                </div>
              ) : (
                <div key={m.id} style={S.reviewRow} onClick={() => startEditWord(m)}>
                  <span style={S.reviewTime}>{fmt(m.sec)}</span>
                  <button
                    type="button"
                    style={{ ...S.reviewDot, background: m.colorHex }}
                    onClick={(e) => { e.stopPropagation(); recolorMark(m.id); }}
                    aria-label="この！の色を、今えらんでいる色に塗り替える"
                  />
                  <span style={S.reviewWord}>{m.word ?? ""}</span>
                  <button type="button" style={S.reviewLink} onClick={(e) => { e.stopPropagation(); seekPreview(m); }}>見返す</button>
                  <button type="button" style={S.reviewRemove} onClick={(e) => { e.stopPropagation(); removeMark(m.id); }} aria-label="この！を消す">×</button>
                </div>
              )
            )}
          </div>
          {/* 色チップと一言は常時は出さない。言葉の編集中だけ出す（色直しの丸押しもそのあいだにできれば足りる） */}
          {editingMarkId !== null && (
            <>
              {colorPicker}
              <p style={S.reviewLede}>ちょっとタイミングずれたかも、とかはライブ感ということでいいじゃない。</p>
            </>
          )}
          <div style={S.reviewFooter}>
            <div style={S.reviewActions}>
              <button style={S.modalPrimary} onClick={onReviewSend} disabled={sending || marks.length === 0}>
                {sending ? "送っています…" : "これで送る"}
              </button>
              {reviewTrigger === "back" && (
                <button style={S.modalSecondary} onClick={onReviewLeaveWithoutSending} disabled={sending}>送らずに戻る</button>
              )}
              <button style={S.modalSecondary} onClick={onReviewKeepTapping} disabled={sending}>まだ叩く</button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* 跳ねる面。残りの高さを全部使う。動画の上には重ねない */}
          <div style={S.stage}>
            <HandsCanvas
              ref={handsRef}
              icon="mark"
              sessions={sessions}
              selfMemberId="nishida"
              selfSeatHash={7}
              resolveColor={resolveMemberColor}
              centerSelfPeak
              scaleCount={300}
              topMargin={150}
              // 吹き出しの表示幅の半分＋数px（！のテクスチャは吹き出し本体が256px角の枠に208px幅で
              // 収まる作り。BASE_SIZE基準の典型的な表示サイズの半分程度を見込んだ値）。
              // 端いっぱいに湧いても本体が枠外に出て文字が読めなくなるのを防ぐ
              sideMargin={50}
              bottomMargin={40}
              freezeAge
            />
            {/* 「大きい文字」レーン。再生中だけ（停止中・止まっているときは出さない） */}
            <WordLane playerRef={playerRef} crowdWords={crowdWords} active={playing} />
            {!playing && (
              /* 止まっているあいだだけ、狙いやすい大きな再生ボタンを前面に出す。
                 叩く面（このstage）の上には重ねてよいが、動画の上には重ねない
                 （stageは動画の外＝videoBoxの下なので問題ない）。再生が始まったら消える */
              <button type="button" style={S.bigPlay} onClick={togglePlay}>再生</button>
            )}
          </div>

          {colorPicker}

          <div style={S.btnRow}>
            <button
              type="button"
              style={{ ...S.mark, background: markBg, color: markFg }}
              onPointerDown={pressMark}
              onContextMenu={(e) => e.preventDefault()}
            >！</button>
          </div>
        </>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: {
    background: "#000", color: "#eee", height: "100dvh", overflow: "hidden",
    display: "flex", flexDirection: "column",
    maxWidth: 520, margin: "0 auto", padding: "8px 10px 10px",
    fontFamily: "'Hiragino Sans','Noto Sans JP',system-ui,sans-serif",
  },
  head: { display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto", marginBottom: 6 },
  back: { background: "none", border: 0, color: "#9aa0a6", fontSize: 12, cursor: "pointer", padding: 0, fontFamily: "inherit" },
  title: { fontSize: 15, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  count: { marginLeft: "auto", fontSize: 12, color: "#8a8a92", fontFamily: "ui-monospace,Menlo,Consolas,monospace", flexShrink: 0 },
  videoBox: { flex: "0 0 auto" },
  play: { background: "#1a1a1a", color: "#eee", border: 0, boxShadow: "inset 0 0 0 1px #444", padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  stage: { position: "relative", flex: "1 1 auto", minHeight: 0, background: "#0a0a0c", overflow: "hidden" },
  // 止まっているあいだだけ出す、狙いやすい大きな再生ボタン。stage(叩く面)の上端に重ねる。
  // stageは動画(videoBox)の外なので、これは動画には重ならない
  bigPlay: {
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 5,
    height: 110, background: "rgba(255,255,255,0.96)", color: "#000",
    border: 0, fontSize: 22, fontWeight: 900, cursor: "pointer", fontFamily: "inherit",
  },
  // 「大きい文字」レーン。跳ねる面の上部だけ・動画には重ねない。タップは透過（吹き出しや！ボタンを塞がない）
  wordLane: {
    position: "absolute", top: 0, left: 0, right: 0, height: 70,
    zIndex: 3, overflow: "hidden", pointerEvents: "none",
  },
  wordLaneItem: {
    position: "absolute", left: "50%", top: "30%",
    transform: "translate(-50%, -50%)",
    fontSize: 14, fontWeight: 800, color: "#888",
    whiteSpace: "nowrap", willChange: "transform, opacity",
    transition: "transform 150ms ease-out, color 150ms ease-out, opacity 200ms ease-out",
  },
  colorPickerRow: { display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto", padding: "8px 0 0" },
  arrowBtn: { flex: "0 0 auto", width: 26, height: 26, background: "#1a1a1a", color: "#eee", border: 0, boxShadow: "inset 0 0 0 1px #444", fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: 0 },
  dotsRow: { flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 3, padding: "0 6px" },
  dot: { flex: "0 1 22px", aspectRatio: "1", minWidth: 12, maxWidth: 22, borderRadius: "50%", border: 0, cursor: "pointer", padding: 0 },
  btnRow: { display: "flex", gap: 8, flex: "0 0 auto", marginTop: 8 },
  mark: { flex: 1, background: "#d0d0d0", color: "#000", border: 0, padding: "22px 10px", fontSize: 30, fontWeight: 900, lineHeight: 1, cursor: "pointer", fontFamily: "inherit" },
  reviewWrap: { flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", marginTop: 8 },
  countBanner: {
    flex: "0 0 auto", height: 40, marginBottom: 6,
    background: "rgba(255,255,255,0.06)", boxShadow: "inset 0 0 0 1px #333",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 22, fontWeight: 900, lineHeight: 1,
  },
  reviewList: { flex: "1 1 auto", minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 },
  // 行の本体を押すと言葉の入力に変わる＝押せる行なのでポインタを出す
  reviewRow: { display: "flex", alignItems: "center", gap: 10, padding: "9px 4px", boxShadow: "inset 0 -1px 0 #222", cursor: "pointer" },
  reviewTime: { fontSize: 13, fontFamily: "ui-monospace,Menlo,Consolas,monospace", color: "#eee", width: 62, flex: "0 0 auto" },
  // ボタン化（塗り直せる）ので、押せると分かるよう薄い輪郭を足す。地色が近いと見えにくいので二重にする
  reviewDot: {
    width: 18, height: 18, borderRadius: "50%", flex: "0 0 auto", padding: 0, border: 0, cursor: "pointer",
    boxShadow: "0 0 0 1px rgba(255,255,255,0.5), inset 0 0 0 1px rgba(0,0,0,0.35)",
  },
  // 付いた言葉の表示。無ければ空のまま＝残りの余白を見返す/×側へ渡すだけ（今までどおり秒だけの見た目）
  reviewWord: { flex: "1 1 auto", minWidth: 0, fontSize: 13, color: "#eee", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  reviewLink: { flex: "0 0 auto", background: "none", border: 0, color: "#7cf", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: "4px 6px" },
  reviewRemove: { flex: "0 0 auto", width: 30, height: 30, background: "none", color: "#9aa0a6", border: 0, boxShadow: "inset 0 0 0 1px #444", fontSize: 16, cursor: "pointer", fontFamily: "inherit" },
  // 言葉の入力中の行。押しても再度開かない（reviewRow と違い onClick を持たせない別の見た目）
  reviewRowEditing: { display: "flex", flexDirection: "column", gap: 6, padding: "9px 4px", boxShadow: "inset 0 -1px 0 #222" },
  reviewRowEditingTop: { display: "flex", alignItems: "center", gap: 8 },
  // 枠をはっきり出す（太め・白）＋背景を地色と地続きにしない。fontSize16px以上（未満だとiOSでズームが走る）
  wordInput: {
    flex: "1 1 auto", minWidth: 0, background: "#1c1c1e", color: "#fff",
    border: 0, boxShadow: "inset 0 0 0 2px #fff", padding: "8px 10px", fontSize: 16, fontFamily: "inherit",
  },
  wordConfirm: { flex: "0 0 auto", background: "none", color: "#7cf", border: 0, boxShadow: "inset 0 0 0 1px #444", padding: "6px 10px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  wordChipRow: { display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 70 },
  wordChip: { background: "none", color: "#cbd2dc", border: 0, boxShadow: "inset 0 0 0 1px #444", padding: "4px 8px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  reviewFooter: { flex: "0 0 auto", paddingTop: 10 },
  reviewLede: { fontSize: 12, lineHeight: 1.7, color: "#9aa0a6", margin: "0 0 10px" },
  reviewActions: { display: "flex", flexDirection: "column", gap: 8 },
  modalPrimary: { background: "#fff", color: "#000", border: 0, padding: "12px 14px", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" },
  modalSecondary: { background: "none", color: "#9aa0a6", border: 0, boxShadow: "inset 0 0 0 1px #444", padding: "12px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  errorBanner: {
    position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 150,
    background: "#000", color: "#fff", fontSize: 13, fontWeight: 700,
    padding: "12px 16px", textAlign: "center", boxShadow: "inset 0 1px 0 #333",
  },
  /** 送れたときの一言（エラーと同じ場所・白地で区別） */
  doneBanner: {
    position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 150,
    background: "#fff", color: "#000", fontSize: 13, fontWeight: 700,
    padding: "12px 16px", textAlign: "center",
  },
};
