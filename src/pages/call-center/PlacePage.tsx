import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
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

type Video = { video_id: string; offset_sec: number; rate: number; label: string | null; end_sec: number | null };

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

/**
 * 自分が送信した棚の行ID（call_tap_sessions.id）の控え。曲・動画ごとに分ける。
 * 「送信済みの吹き出しのうち、これは自分の行だから消せる」の判定にだけ使う
 * （実際に消せるかどうかはRLSが本人＋24時間以内かで判定するので、ここは見た目の印だけの役割）。
 */
function sentRowsKey(slug: string, videoId: string): string {
  return `call_center:sent_rows:${slug}:${videoId}`;
}
function loadSentRowIds(slug: string, videoId: string): Set<string> {
  try {
    const raw = localStorage.getItem(sentRowsKey(slug, videoId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}
function addSentRowId(slug: string, videoId: string, id: string): Set<string> {
  const cur = loadSentRowIds(slug, videoId);
  cur.add(id);
  try { localStorage.setItem(sentRowsKey(slug, videoId), JSON.stringify([...cur])); } catch { /* ignore */ }
  return cur;
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

/**
 * 秒と言葉の対。候補チップの元データ（跳ねる面には使わない。tapRowsToSessions とは別に保持する）。
 * rowId = どの参加（棚の1行）の言葉か。1人が連続で並べた言葉（歌詞・コールの順番）を、
 * 別の参加者どうしの「同じ瞬間の競合候補」と誤認しないための手がかりに使う（WordLaneの束ね判定）。
 */
type WordPair = { sec: number; word: string; rowId: string };

/** 棚から読んだ行から「秒と言葉の対」だけを抜き出す（言葉が付いていないものは除く） */
function extractWordPairs(rows: TapRow[]): WordPair[] {
  const out: WordPair[] = [];
  for (const row of rows) {
    const secs = (row.mark_secs ?? []).map(Number);
    const words = row.mark_words ?? [];
    secs.forEach((sec, i) => {
      const w = words[i];
      if (w) out.push({ sec, word: w, rowId: row.id });
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

/**
 * 近すぎる！を1個に統合する（やり直しの重複対策）。
 * 下書きは中断・やり直しでも消えない作りなので、同じ曲を何度もやり直すと同じ場所に
 * ！が積み重なる。手で大量削除させないよう、16分音符未満（beatSec/4。出せなければ0.1秒）の
 * 間隔で近接するものを鎖状にまとめる（本物の最速連打=8分・約0.2秒間隔は巻き込まない）。
 *
 * 統合ルール: 代表は id が最大（＝一番後から追加された）markの秒を残す。
 * オーナーの使い方は「タイミングを直すために後から叩き直す」ので、修正のつもりの新しい叩きが
 * 古い方に吸収されて消えてしまわないよう、先頭（早い秒）ではなく新しい方を優先する。
 * word は塊の中で非nullのもののうち、複数あれば新しい方（idが大きい方）を優先。
 * memberId/colorHex は「色付き（memberId!=null）のうち、複数あれば新しい方を優先。色付きが無ければ新しい方（代表）」。
 */
function mergeCloseMarks(marksIn: MarkEntry[], beatSec: number | null): { merged: MarkEntry[]; removedCount: number } {
  if (marksIn.length === 0) return { merged: marksIn, removedCount: 0 };
  const threshold = beatSec ? beatSec / 4 : 0.1;
  const sorted = [...marksIn].sort((a, b) => a.sec - b.sec);
  const merged: MarkEntry[] = [];
  let cluster: MarkEntry[] = [sorted[0]];
  const flush = () => {
    if (cluster.length === 1) { merged.push(cluster[0]); return; }
    // 代表 = id最大（一番後から叩いた）もの
    const newest = cluster.reduce((a, b) => (b.id > a.id ? b : a));
    // word: 非nullのうち id が一番大きい（新しい）もの
    const worded = cluster.filter((m) => m.word !== null).sort((a, b) => b.id - a.id);
    const word = worded.length > 0 ? worded[0].word : null;
    // memberId/colorHex: 色付きのうち id が一番大きい（新しい）もの。無ければ代表(newest)のまま
    const colored = cluster.filter((m) => m.memberId !== null).sort((a, b) => b.id - a.id);
    const pick = colored.length > 0 ? colored[0] : newest;
    merged.push({
      id: newest.id,
      sec: newest.sec,
      colorHex: pick.colorHex,
      memberId: pick.memberId,
      word,
    });
  };
  for (let i = 1; i < sorted.length; i++) {
    const prevInCluster = cluster[cluster.length - 1];
    if (sorted[i].sec - prevInCluster.sec < threshold) {
      cluster.push(sorted[i]);
    } else {
      flush();
      cluster = [sorted[i]];
    }
  }
  flush();
  return { merged, removedCount: marksIn.length - merged.length };
}

/**
 * 言葉が空の！に、群衆（crowdWords）の言葉を自動で入れる。
 * 1人目が言葉を入れてくれた曲では、2人目以降は入力を頑張らなくていい、というコンセプト。
 *
 * word が null の！だけが対象（自分で既に入れた言葉には触らない）。その！の秒の±半拍以内
 * （beatSec/2。BPM不明なら0.25秒）にある群衆の言葉のうち、一番多いものを入れる
 * （同数なら秒が一番近いもの）。自動で入った言葉も、行を押せば普通の言葉として編集・削除できる
 * （特別扱いの状態は持たない）。
 */
function autoFillWords(marksIn: MarkEntry[], crowdWords: WordPair[], beatSec: number | null): MarkEntry[] {
  const windowSec = beatSec ? beatSec / 2 : 0.25;
  return marksIn.map((m) => {
    if (m.word !== null) return m;
    let bestWord: string | null = null;
    let bestCount = 0;
    let bestDist = Infinity;
    const counts = new Map<string, { count: number; minDist: number }>();
    for (const cw of crowdWords) {
      const dist = Math.abs(cw.sec - m.sec);
      if (dist > windowSec) continue;
      const entry = counts.get(cw.word);
      if (entry) { entry.count += 1; entry.minDist = Math.min(entry.minDist, dist); }
      else counts.set(cw.word, { count: 1, minDist: dist });
    }
    for (const [word, { count, minDist }] of counts) {
      if (count > bestCount || (count === bestCount && minDist < bestDist)) {
        bestWord = word;
        bestCount = count;
        bestDist = minDist;
      }
    }
    return bestWord ? { ...m, word: bestWord } : m;
  });
}

/** 見返しのカウントイン先。対象の秒・拍の長さ・その！の色（カウントイン明けに出す） */
type PreviewTarget = { sec: number; beatSec: number; colorHex: string };

/** エラーの中身を一行にする。理由が分からないまま「送れません」だけだと調べようがないため */
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 「大きい文字」レーンの1粒。id は言葉ごとに振り直す通し番号で作る安定キー */
// rank: 同じ瞬間（互いに±半拍以内）に複数の言葉の候補が並んだときの順位。1位=本線・最大。
// 2位・3位はその上に小さく積む段（rank-1がそのまま段数）。4位以降は束から外す＝出さない。
type LaneGroup = { id: string; word: string; sec: number; count: number; rank: number };

/** 束ね判定で「同じ参加が絡んでいるか」を見るための小さなヘルパー */
function hasCommonRow(a: Set<string>, b: Set<string>): boolean {
  for (const r of a) if (b.has(r)) return true;
  return false;
}

/**
 * crowdWords を「同じ言葉を複数の人が同じ瞬間に叩いたぶん」でまとめる。
 * 言葉ごとに秒を昇順に並べ、塊の先頭から半拍以内なら同じ塊として吸収する。
 * 1拍ごとの連続コール（それ それ それ それ）は別々の粒として残す（1拍以内の鎖式でまとめると
 * これらがくっついてしまう）。代表秒は塊の中央値、人数は塊に入った件数。塊に絡んだ rowId も控える。
 *
 * その後、時刻順に並べた塊どうしをさらに「同じ瞬間（互いに±半拍以内）」で束ねる
 * （＝別々の言葉が同じタイミングの競合候補として並ぶケース。「それ」「オイ」等の言い方違いを想定）。
 * ただし、1人が細かく並べた連続の言葉（歌詞・コールの決まった順番。例:「あーるじゃなしー」の
 * 「な」、「そーれでいいー」の1つ目の「い」）は競合候補ではないので、**すでに束の中にいる塊と
 * rowId が1つでも重なる塊は、その束には絶対に加えない**（＝束ねない・積まない・常に本線扱い）。
 * 束の中は人数の多い順（同数なら秒が早い方）で rank を振り、最大3件まで（4件目以降は出さない）。
 */
function buildWordGroups(crowdWords: WordPair[], beatSec: number): LaneGroup[] {
  const byWord = new Map<string, { sec: number; rowId: string }[]>();
  for (const cw of crowdWords) {
    const arr = byWord.get(cw.word) ?? [];
    arr.push({ sec: cw.sec, rowId: cw.rowId });
    byWord.set(cw.word, arr);
  }
  const out: { id: string; word: string; sec: number; count: number; rowIds: Set<string> }[] = [];
  for (const [word, entriesIn] of byWord) {
    const entries = [...entriesIn].sort((a, b) => a.sec - b.sec);
    let cluster: { sec: number; rowId: string }[] = [];
    let seq = 0;
    const flush = () => {
      if (cluster.length === 0) return;
      out.push({
        id: `${word}:${seq++}`,
        word,
        sec: median(cluster.map((c) => c.sec)),
        count: cluster.length,
        rowIds: new Set(cluster.map((c) => c.rowId)),
      });
      cluster = [];
    };
    for (const e of entries) {
      // まとめてよいのは「複数の人が同じ瞬間を叩いたぶん」だけ＝塊の先頭から半拍以内。
      // 前の点から1拍以内の鎖式だと、「それ それ それ それ」のような1拍ごとの連続コールが
      // 境目の揺れ次第でくっつき、4個が2塊に化ける実バグになった（実機で報告あり）。
      // 先頭から測ることで、塊がずるずる伸びて後続のコールを飲み込むことも防ぐ。
      if (cluster.length === 0 || e.sec - cluster[0].sec <= beatSec / 2) cluster.push(e);
      else { flush(); cluster.push(e); }
    }
    flush();
  }
  const sorted = out.sort((a, b) => a.sec - b.sec);

  // 「同じ瞬間の束」にまとめて rank を振る（同じ考え方で先頭からの半拍以内をひとまとめにする）。
  // ただし rowId が既存メンバーと重なる塊は、その束には加えず単独の束として扱う（＝rank1固定）
  const ranked: LaneGroup[] = [];
  let bundle: typeof sorted = [];
  const flushBundle = () => {
    if (bundle.length === 0) return;
    const orderedByRank = [...bundle].sort((a, b) => (b.count !== a.count ? b.count - a.count : a.sec - b.sec));
    orderedByRank.slice(0, 3).forEach((g, i) => {
      ranked.push({ id: g.id, word: g.word, sec: g.sec, count: g.count, rank: i + 1 });
    });
    bundle = [];
  };
  for (const g of sorted) {
    const sameRowAsExisting = bundle.some((b) => hasCommonRow(b.rowIds, g.rowIds));
    if (bundle.length === 0) {
      bundle.push(g);
    } else if (!sameRowAsExisting && g.sec - bundle[0].sec <= beatSec / 2) {
      bundle.push(g);
    } else {
      flushBundle();
      bundle.push(g);
    }
  }
  flushBundle();
  return ranked.sort((a, b) => a.sec - b.sec);
}

// 同じ瞬間に複数の言葉が並んだときの、rank別の大きさ倍率と縦の積み上げ量(px)。
// index = rank-1。rank1=本線（縦オフセット無し）、rank2・3はその上に小さく積む
const RANK_SCALE = [1, 0.7, 0.55];
const RANK_STACK_PX = [0, -18, -34];

/**
 * レーン上の1粒の見た目（横位置・大きさ・色・不透明度）を、いまの再生秒から計算してDOMへ直接書く。
 * 遠近を「大きさ×速さ」で表現する。
 *
 * 横位置は非線形: x = sign(d) × sqrt(|d|/窓) × 半幅（d=その言葉の秒−いまの秒）。
 * 線形(d/窓)と違い、遠い言葉ほど端の方でゆっくり、自分の瞬間が近づくほど速く中央を通り抜ける
 * （＝「近いほど動きが大きい」の遠近感）。
 *
 * 大きさ・不透明度は t=|d|/窓（0=いま〜1=窓の端）の連続値で決める:
 *   通常scale = 0.7 + 0.5×(1−t)（遠い=0.7倍、直近=1.2倍）に rank別倍率(RANK_SCALE)を掛ける
 *   その瞬間（±半拍）に白く大きく光るのは rank1（1位＝人数最多）だけ。通常scaleの2倍＋人数ボーナス
 *   （上限3倍）、色は白。rank2以降は光らない・大きくもならない＝常にグレーのまま
 *   （光る瞬間は「いま何て叫ぶか」の答えなので、2つ光ると新規が迷うため）
 *   不透明度 = 0.4 + 0.6×(1−t)（遠い端=0.4、中央付近=1）
 * 縦位置は rank に応じて RANK_STACK_PX ぶん本線から上へ積む（1案しかない瞬間は常にrank1＝本線のまま）。
 */
function positionLaneItem(el: HTMLDivElement, g: LaneGroup, now: number, beatSec: number, halfW: number) {
  const windowSec = 4 * beatSec;
  const d = g.sec - now; // + は未来（右）、− は過去（左）
  const t = Math.min(1, Math.abs(d) / windowSec);
  const x = Math.sign(d) * Math.sqrt(Math.abs(d) / windowSec) * halfW;
  const isPeak = g.rank === 1 && Math.abs(d) <= beatSec / 2;
  const rankScale = RANK_SCALE[g.rank - 1] ?? RANK_SCALE[RANK_SCALE.length - 1];
  const yOffset = RANK_STACK_PX[g.rank - 1] ?? RANK_STACK_PX[RANK_STACK_PX.length - 1];
  const baseScale = 0.7 + 0.5 * (1 - t);
  const scale = (isPeak ? Math.min(3, baseScale * 2 + (g.count - 1) * 0.2) : baseScale) * rankScale;
  const opacity = 0.4 + 0.6 * (1 - t);
  el.style.transform = `translate(-50%, -50%) translate(${x}px, ${yOffset}px) scale(${scale})`;
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
  // 注意: このコンポーネントは「窓に言葉が無いあいだは null を返す」ので、マウント時の
  // useEffect で一度だけ測る作りだと、まだ何も描いていない時点（幅0）を掴んだまま二度と
  // 測り直さない。幅0だと全言葉の横位置が中央に固定され「縦に流れて見える」実バグになった。
  // そのため測定は容器の ref コールバック（実際にDOMが生えた瞬間）で行う。
  const roRef = useRef<ResizeObserver | null>(null);
  const attachContainer = (el: HTMLDivElement | null) => {
    containerRef.current = el;
    roRef.current?.disconnect();
    roRef.current = null;
    if (el) {
      widthRef.current = el.clientWidth;
      const ro = new ResizeObserver(() => { widthRef.current = el.clientWidth; });
      ro.observe(el);
      roRef.current = ro;
    }
  };
  useEffect(() => () => { roRef.current?.disconnect(); }, []);

  useEffect(() => {
    if (!active) { setVisibleItems([]); return; }
    let raf = 0;
    let lastKey = "";
    const windowSec = 4 * beatSec;
    const tick = () => {
      const now = playerRef.current?.getCurrentTime() ?? 0;
      const inWindow = groups.filter((g) => Math.abs(g.sec - now) <= windowSec);

      // 窓に入っている集合が変わったときだけReactを再描画する（毎フレームは再描画しない）
      const key = inWindow.map((g) => g.id).join(",");
      if (key !== lastKey) {
        lastKey = key;
        setVisibleItems(inWindow);
      }

      // 位置・大きさ・色・不透明度は毎フレーム、DOMへ直接書く（Reactを経由しない）
      // 保険: 何かの理由で幅が0のままなら、その場で測り直す（幅0＝全部中央＝縦流れ事故の再発防止）
      if (widthRef.current === 0 && containerRef.current) widthRef.current = containerRef.current.clientWidth;
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
    <div ref={attachContainer} style={S.wordLane}>
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
          style={S.wordLaneItem}
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
  // 曲一覧の選択表示（サムネイルをタップ）から来たとき、どの動画を選んでいたか。
  // 見つからなければ（直接この曲を開いた等）先頭の動画を使う（既存のSongTapPageと同じ流儀）
  const [searchParams] = useSearchParams();
  const wantVideo = searchParams.get("v");
  const playerRef = useRef<YouTubePlayerApi>(null);
  const handsRef = useRef<HandsCanvasApi>(null);
  const markIdRef = useRef(0);
  // 通常再生中、下書きの！の通過検出に使う「直前のonTimeでの秒」。0初期化なので、初回tickで
  // 既にsecが0より先(復元直後の頭出し等)だと、そこまでの下書きがまとめて一度だけ湧く程度の実害のみ
  const lastPlaySecRef = useRef(0);
  // 吹き出しを押して確認モーダルが出ているあいだ、そのtapTagを控える（二重に開かないための判定用。
  // stateだけだと非同期のズレが心配なので、判定はこのrefで同期的に行う）
  const bubbleConfirmTagRef = useRef<string | null>(null);

  const [title, setTitle] = useState("");
  const [groupName, setGroupName] = useState("");
  const [video, setVideo] = useState<Video | null>(null);
  // 同じ曲に複数の動画が結び付いている場合の候補一覧。1本しか無ければチップは出さない
  const [videoOptions, setVideoOptions] = useState<Video[]>([]);
  // 動画を切り替えるとき、跳ねる面のデータを同じ曲IDで読み直すために控えておく
  const songIdRef = useRef<string | null>(null);
  // 動画依存の読み込み関数（useEffect内で定義）を、チップの切り替えハンドラから呼べるようにする受け皿
  const loadForVideoRef = useRef<((songId: string, v: Video) => void) | null>(null);
  // 棚から読んだ生の行（跳ねる面のsessions・候補チップのcrowdWords・送信済み！のタップ判定は
  // すべてここから作る＝派生値。棚の値を書き換えたとき(送信済み！の削除)ここだけ更新すれば
  // 他は自動で追従する（appendで積むとリフェッチのたびに二重表示になるため、置き換え式にした）
  const [rawTapRows, setRawTapRows] = useState<TapRow[]>([]);
  // 既に登録されているコール（get_song_calls由来の擬似セッション）。rawTapRowsとは出どころが違うので分ける
  const [registeredCallsSession, setRegisteredCallsSession] = useState<HiSession | null>(null);
  // 自分がこの曲・動画で送信した行ID（送信済みの！を押せる対象にするための印。localStorage由来）
  const [sentRowIds, setSentRowIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  // 振り返り画面の「！＋色チップ」置き場の表示可否。playing を直接使わずワンクッション置く。
  // playing が一瞬だけ true→false と揺れても（YouTube側のseek中の中間状態など）、この置き場が
  // 一瞬だけ出て消える＝再描画が入ってレイアウトが揺れる、を避けるための保険（250msだけ消灯を待つ）
  const [previewToolsVisible, setPreviewToolsVisible] = useState(false);
  const previewToolsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 叩いたもの一つひとつ。棚へ送るときはここから秒の列・メンバーIDの列を取り出す。
  const [marks, setMarks] = useState<MarkEntry[]>([]);
  // 今選んでいる色（ペンライトの色替え）。null=色なし（既定＝グレー扱い）
  const [currentColor, setCurrentColor] = useState<string | null>(null);
  // 振り返りの「見返す」で、カウントイン中の対象。無ければ固定巻き戻しのまま（バナーも出さない）
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [previewStep, setPreviewStep] = useState<string | null>(null);
  // 見返し中、この秒を過ぎたら自動で止める（！の瞬間から4拍・BPM不明なら2秒ぶん流したら止める）
  const [previewStopAt, setPreviewStopAt] = useState<number | null>(null);
  // previewStopAt の判定を「一度でも狙った巻き戻し位置を下回ってから」だけ有効にする安全弁。
  // seekTo() は非同期なので、直後の数tickは着地前の古い再生位置（＝曲の終わり付近など、
  // 狙った停止位置よりずっと先）を getCurrentTime() が返すことがある。無条件に
  // sec >= previewStopAt を見ていると、着地前のこの古い値で即座に誤爆して「見返し」が
  // 実質1tickで終わってしまう（＝叩き足す間もなく振り返りへ戻る）事故になる。
  const previewArmedRef = useRef(false);
  // 振り返り画面で、今どの！の言葉を編集中か。行の本体を押すと開く（別画面にはしない）
  const [editingMarkId, setEditingMarkId] = useState<number | null>(null);
  const [wordDraft, setWordDraft] = useState("");
  // 直前に確定した言葉。次の候補チップの先頭に常に出す（同じコールの連続に効く）
  const [lastConfirmedWord, setLastConfirmedWord] = useState<string | null>(null);

  const [reviewTrigger, setReviewTrigger] = useState<ReviewTrigger | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // 送信成功後のお礼画面。無ければ通常表示（振り返り画面／叩く画面）のまま
  const [thankYou, setThankYou] = useState<{ count: number } | null>(null);
  // 振り返りを開くときに近すぎる！を統合したら、その一言（控えめに一時表示）
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);
  // 振り返りの「×」で消した行の取り置き（直近が末尾）。誤って消した事故の取り消し用
  const [removedMarks, setRemovedMarks] = useState<MarkEntry[]>([]);
  const removedClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 人間確認を出しているあいだ、答えが返るまで待つための受け皿（SongTapPage と同じ形）
  const [gate, setGate] = useState<((t: string | null) => void) | null>(null);
  // 吹き出しを押したときの「この！を消す？」確認。tagがあれば表示（消す／やめるの決着でnullに戻す）
  const [bubbleConfirm, setBubbleConfirm] = useState<{ tag: string } | null>(null);
  // 送信済みの！を消せなかった（24時間超過・本人以外等）ときの一言
  const [sentDeleteNotice, setSentDeleteNotice] = useState<string | null>(null);

  const askForToken = () =>
    new Promise<string | null>((resolve) => {
      setGate(() => (t: string | null) => { setGate(null); resolve(t); });
    });

  // 跳ねる面に流すセッション一式。登録済みコール（あれば先頭）＋棚の行から作った疑似セッション。
  const sessions = useMemo<HiSession[]>(() => {
    const crowd = tapRowsToSessions(rawTapRows);
    return registeredCallsSession ? [registeredCallsSession, ...crowd] : crowd;
  }, [registeredCallsSession, rawTapRows]);

  // 棚から読んだ、他の参加者が付けた「秒と言葉の対」。候補チップの元データ
  const crowdWords = useMemo<WordPair[]>(() => extractWordPairs(rawTapRows), [rawTapRows]);

  // 自分が送った行のうち、跳ねる面のどの粒がどの(行ID, その行の中でのindex)に対応するかの索引。
  // tapRowsToSessions と同じ session_hash / bucket の作り方に合わせて組む（ずれると違う！を消してしまう）。
  const sentTapIndex = useMemo(() => {
    const map = new Map<string, { rowId: string; index: number }>();
    if (sentRowIds.size === 0) return map;
    const occurrenceCounters = new Map<string, number>(); // `${session_hash}:${bucket}` → 出現数
    for (const row of rawTapRows) {
      if (!sentRowIds.has(row.id)) continue;
      const secs = (row.mark_secs ?? []).map(Number);
      const memberIds = row.mark_member_ids ?? [];
      secs.forEach((sec, i) => {
        const key = memberIds[i] ?? "";
        const sessionHash = hashSessionKey(row.id, key);
        const bucket = Math.round(sec * 20);
        const counterKey = `${sessionHash}:${bucket}`;
        const occ = occurrenceCounters.get(counterKey) ?? 0;
        occurrenceCounters.set(counterKey, occ + 1);
        map.set(`${counterKey}:${occ}`, { rowId: row.id, index: i });
      });
    }
    return map;
  }, [rawTapRows, sentRowIds]);

  /** 群衆✋の1粒が「自分が送った行の、何番目の！か」を返す。HandsCanvasのgetBucketTapTagへ渡す */
  const getBucketTapTag = (session: HiSession, bucket: number, occurrenceIndex: number): string | undefined => {
    const hit = sentTapIndex.get(`${session.session_hash}:${bucket}:${occurrenceIndex}`);
    return hit ? `sent:${hit.rowId}:${hit.index}` : undefined;
  };

  // playing → previewToolsVisible。true化は即座、false化は250ms待ってから（瞬間的な揺り戻し対策）
  useEffect(() => {
    if (playing) {
      if (previewToolsHideTimerRef.current) { clearTimeout(previewToolsHideTimerRef.current); previewToolsHideTimerRef.current = null; }
      setPreviewToolsVisible(true);
    } else {
      previewToolsHideTimerRef.current = setTimeout(() => {
        setPreviewToolsVisible(false);
        previewToolsHideTimerRef.current = null;
      }, 250);
    }
    return () => {
      if (previewToolsHideTimerRef.current) { clearTimeout(previewToolsHideTimerRef.current); previewToolsHideTimerRef.current = null; }
    };
  }, [playing]);

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

  // 今の色えらびに居る人はその色（臨時ユニットの上書き・公演時点の名簿を反映）。居なければ members.ts
  const resolveChipColor = useCallback(
    (id: string) => chipMembers.find((m) => m.name === id)?.color ?? resolveMemberColor(id),
    [chipMembers],
  );
  const chipColorIdToHex = (id: string | null) => (id === null ? NEUTRAL_HEX : resolveChipColor(id));

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

    // 動画に紐づく分の読み込み（跳ねる面のデータ・下書き・送信済み印）。
    // 初回表示と、チップでの動画切り替えの両方から呼ぶ
    const loadForVideo = (songId: string, v: Video) => {
      setVideo(v);
      setMarks([]); // 切り替え前の曲の！を持ち越さない（下書きが無ければ空のまま）
      restoreDraft(v.video_id);
      setSentRowIds(loadSentRowIds(slug, v.video_id));

      getSupabase()
        .rpc("get_song_calls", { p_song_id: songId })
        .then(({ data: rows }) => {
          if (!alive) return;
          setRegisteredCallsSession(null);
          if (!rows) return;
          const secs = (rows as { start_sec: number | null }[])
            .filter((r) => r.start_sec !== null)
            .map((r) => toVideoSec(Number(r.start_sec), Number(v.offset_sec), Number(v.rate) || 1));
          if (secs.length === 0) return;
          setRegisteredCallsSession({
            session_hash: 424242,
            member_id: "", // 誰の色でもない＝グレー（resolveMemberColorが見つけられないIDにしている）
            is_today: true,
            bucket_indices: secs.map((t) => Math.round(t * 10)),
            bucket_indices_20: secs.map((t) => Math.round(t * 20)),
            played_date: new Date().toISOString().slice(0, 10),
          });
        }, () => { /* 読めなくても置く画面は成り立つ */ });

      // 過去の参加者が叩いたぶんも、同じ動画のものだけ跳ねる面に流す
      // （動画が違うと秒の物差しも違うので混ぜない＝ハイ！テンションの「動画ごとに客席を分ける」流儀と同じ）。
      // 件数はキリなく増えるので直近200行に絞る（過去のディスク負荷事故の再発防止）。
      getSupabase()
        .from("call_tap_sessions")
        .select("id, mark_secs, mark_member_ids, mark_words, created_at")
        .eq("song_id", songId)
        .eq("video_id", v.video_id)
        .order("created_at", { ascending: false })
        .limit(200)
        .then(({ data: tapRows }) => {
          if (!alive) return;
          setRawTapRows((tapRows as TapRow[]) ?? []);
        }, () => { /* 読めなくても置く画面は成り立つ */ });
    };
    loadForVideoRef.current = loadForVideo;

    // 棚に入っていない曲は同梱データで開く
    const builtIn = findBuiltInSong(slug);
    const openBuiltIn = () => {
      if (!builtIn) return false;
      setTitle(builtIn.title);
      setGroupName(builtIn.groupName);
      // 同梱データには曲もツアーも紐付いていない＝棚に繋がらない時と同じ代用でよい
      setChipMembers(fallbackChipMembers(builtIn.groupName));
      const v = builtIn.videos.find((x) => x.videoId === wantVideo) ?? builtIn.videos[0];
      if (v) {
        setVideo({ video_id: v.videoId, offset_sec: v.offsetSec, rate: 1, label: v.label, end_sec: null });
        restoreDraft(v.videoId);
        setSentRowIds(loadSentRowIds(slug, v.videoId));
      }
      return true;
    };

    try {
      getSupabase()
        .from("song_structures")
        .select("id, title, group_name, tour_key, song_video_offsets(video_id, offset_sec, rate, label, end_sec)")
        .eq("slug", slug)
        .maybeSingle()
        .then(({ data }) => {
          if (!alive) return;
          if (!data) { if (!openBuiltIn()) setError("この曲は見つかりませんでした"); return; }
          const d = data as unknown as { id: string; title: string; group_name: string; tour_key: string | null; song_video_offsets: Video[] };
          setTitle(d.title);
          setGroupName(d.group_name);
          const options = (d.song_video_offsets ?? []).map((v) => ({
            video_id: v.video_id, offset_sec: Number(v.offset_sec), rate: Number(v.rate) || 1,
            label: v.label, end_sec: v.end_sec !== null ? Number(v.end_sec) : null,
          }));
          const v = options.find((o) => o.video_id === wantVideo) ?? options[0];
          if (!v) { setError("この曲にはまだ動画が結び付いていません"); return; }
          songIdRef.current = d.id;
          setVideoOptions(options);
          loadForVideo(d.id, v);

          /**
           * 色えらびに出すメンバー。4段のフォールバック:
           * 0) member_color_overrides（臨時ユニット用の色の上書き。本来のメンカラと別の色を
           *    使う ConChu! 等はここにだけ名簿がある）。group_name から末尾の年号を落とした
           *    group_name_key で突き合わせ、1件以上あればここで確定して先へは進まない。
           *    並び順の欄が無いので 2) と同じ規則で並べる
           * 1) 曲にツアーの紐付きがあれば tour_rosters（ツアー時点の固定名簿）
           * 2) 無ければ hello_members の今の在籍（並び順の欄が無いので、members.ts と
           *    同じ並びの名前はその順、無い名前は名前順で末尾に置く）
           * 3) どちらも読めなければ（棚に繋がらない等）members.ts の代用（画面を死なせない）
           * 0) が0件・読めないときは 1)〜3) へそのまま進む（上書きが無いだけで名簿は別にあるため）
           */
          const loadFromRosterOrActive = () => {
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
          };
          const groupNameKey = d.group_name.replace(/\s*['’′]\d{2}\s*$/, "").trim();
          getSupabase()
            .from("member_color_overrides")
            .select("member_name, color")
            .eq("group_name_key", groupNameKey)
            .then(({ data: overrideRows }) => {
              if (!alive) return;
              if (!overrideRows || overrideRows.length === 0) { loadFromRosterOrActive(); return; }
              const rows = (overrideRows as { member_name: string; color: string }[])
                .map((r) => ({ name: r.member_name, color: r.color }));
              // members.ts に同じ名前があればその並び順、無い名前は名前順で末尾に置く
              const order = new Map(ALL_MEMBERS.filter((m) => m.group === d.group_name).map((m, i) => [m.name, i]));
              rows.sort((a, b) => {
                const ai = order.get(a.name) ?? Number.MAX_SAFE_INTEGER;
                const bi = order.get(b.name) ?? Number.MAX_SAFE_INTEGER;
                if (ai !== bi) return ai - bi;
                return a.name.localeCompare(b.name, "ja");
              });
              setChipMembers(rows);
            }, () => { if (alive) loadFromRosterOrActive(); });
        }, () => { if (alive && !openBuiltIn()) setError("現在通信できていません（集まったコールを読み込めません）"); });
    } catch {
      if (!openBuiltIn()) setError("現在通信できていません（集まったコールを読み込めません）");
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

    // 通常再生中（振り返り中ではない）、自分の下書きの！の秒を通過するたびに、群衆と同じ見た目で
    // 跳ねさせる（押して消せる目印tapTag=draft付き）。直前のsecと今回のsecの間に挟まった！だけを
    // 拾う「境界をまたいだか」判定なので、同じ通過で二重に湧くことはない（次のtickではもう
    // 境界の外＝lastPlaySecRefが進んでいるので再判定されない）。巻き戻すと自然にリセットされる
    // （戻った直後はsec<lastPlaySecRefになるので一旦何も拾わなくなり、そこから先へ進むとまた拾える）。
    if (!reviewTrigger) {
      const prevSec = lastPlaySecRef.current;
      if (sec > prevSec) {
        for (const m of marks) {
          if (m.sec > prevSec && m.sec <= sec) {
            handsRef.current?.spawnCrowdSelf(m.colorHex, `draft:${m.id}`);
          }
        }
      }
    }
    lastPlaySecRef.current = sec;

    // 長尺動画の終了位置（end_sec）を過ぎたら止める。YouTube側のendパラメータに任せているが、
    // 環境によっては効かないことがあるための保険（見返し機能のprevious StopAtと同じ考え方）。
    // 見返し中は別の停止ロジック(previewStopAt)が担当するので、通常再生中だけ見る
    if (!reviewTrigger && video?.end_sec != null && sec >= video.end_sec && playerRef.current?.isPlaying()) {
      playerRef.current.pause();
    }

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

    // 見返し中、！の瞬間から決めた秒数ぶん流したら自動で止めて振り返りへ戻す。
    // ただし seekTo() 直後で着地前の古い位置を拾っているだけの可能性があるので、
    // 一度でも狙った停止位置を下回るのを見てから（＝着地を確認してから）だけ判定する
    if (previewStopAt !== null) {
      if (!previewArmedRef.current) {
        if (sec < previewStopAt) previewArmedRef.current = true;
      } else if (sec >= previewStopAt) {
        playerRef.current?.pause();
        setPlaying(false);
        clearPreview();
        // 見返し中に叩き足した！があれば、振り返りに戻る時点で統合・自動補完を通す
        if (reviewTrigger) refineMarks();
      }
    }
  };

  /** 動画の候補が複数あるとき、チップで切り替える。切り替えた動画は先頭からの再生に戻る */
  const switchVideo = (v: Video) => {
    if (video?.video_id === v.video_id) return;
    const songId = songIdRef.current;
    if (!songId) return;
    setPlaying(false);
    lastPlaySecRef.current = 0;
    loadForVideoRef.current?.(songId, v);
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
      // 見返し中に手動で止めたときも、自動停止と同じく振り返りに戻る扱いにする
      if (reviewTrigger) refineMarks();
    }
  };

  /** 見返しのカウントイン表示・自動停止の予約を消す（振り返り画面を開く・閉じる・離れるとき、手動停止時に呼ぶ） */
  const clearPreview = () => {
    setPreviewTarget(null);
    setPreviewStep(null);
    setPreviewStopAt(null);
    previewArmedRef.current = false;
  };

  /**
   * marks を整える: ①近すぎる！（やり直しの重複）を統合 ②言葉が空の！に、群衆の言葉があれば
   * 自動で補う。振り返り画面を開くとき・見返し（プレビュー）から戻るときの両方から呼ぶ。
   * 統合が起きたら控えめな一言を一時表示する（自動補完は無言＝目立たせる話ではないため）。
   */
  const refineMarks = () => {
    const beatSec = estimateBeatSec(marks);
    const { merged, removedCount } = mergeCloseMarks(marks, beatSec);
    const filled = autoFillWords(merged, crowdWords, beatSec);
    setMarks(filled);
    if (removedCount > 0) {
      setMergeNotice(`重なっていた！を ${removedCount}個 まとめました`);
      setTimeout(() => setMergeNotice(null), 6000);
    }
  };

  /** 振り返り画面を開く。開く前に refineMarks を通す */
  const openReview = (trigger: ReviewTrigger) => {
    refineMarks();
    clearPreview();
    setReviewTrigger(trigger);
  };

  /** 動画が最後まで再生された。叩きが1個以上あれば振り返りを出す */
  const onEnded = () => {
    setPlaying(false);
    if (marks.length > 0) openReview("ended");
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
    const colorHex = chipColorIdToHex(currentColor);
    handsRef.current?.spawnSelf(colorHex);
    const sec = Math.round((playerRef.current?.getCurrentTime() ?? 0) * 1000) / 1000;
    const id = ++markIdRef.current;
    setMarks((arr) => [...arr, { id, sec, colorHex, memberId: colorIdToMemberId(currentColor), word: null }]);
  };

  // ！ボタンの押し込み見た目（HiTapButtonと同じ、白リング＋押下でわずかに縮む）。
  const [markPressed, setMarkPressed] = useState(false);
  const handleMarkDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    setMarkPressed(true);
    pressMark(e);
  };
  const handleMarkUp = () => setMarkPressed(false);
  const markBoxShadow = markPressed
    ? "0 0 0 3px rgba(255,255,255,0.92), 0 0 0 11px rgba(255,255,255,0.14)"
    : "0 0 0 3px rgba(255,255,255,0.92), 0 6px 20px rgba(0,0,0,0.4)";

  /** 「曲へ」。叩きが残っていれば振り返りを挟む。ゼロならそのまま戻る */
  const handleBack = () => {
    if (marks.length > 0) { openReview("back"); return; }
    navigate("/call-center");
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
    previewArmedRef.current = false; // 新しい見返しを始めるので、着地確認をやり直す
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

  /**
   * 振り返り画面の「×」。棚にはまだ送っていないので、画面の中の並びから外すだけでよい。
   * 誤って消した事故に備えて、消した行を6秒だけ取り置いて「取り消す」で戻せるようにする
   * （連続で消したら配列に積む。6秒は最後に消した時点から数え直す）。
   */
  const removeMark = (id: number) => {
    const target = marks.find((m) => m.id === id);
    setMarks((arr) => arr.filter((m) => m.id !== id));
    if (!target) return;
    setRemovedMarks((prev) => [...prev, target]);
    if (removedClearTimerRef.current) clearTimeout(removedClearTimerRef.current);
    removedClearTimerRef.current = setTimeout(() => {
      setRemovedMarks([]);
      removedClearTimerRef.current = null;
    }, 6000);
  };

  /** 「取り消す」：直近に消した行から順に marks へ戻す（秒順の位置には表示側のソートで自然に戻る） */
  const undoRemove = () => {
    if (removedMarks.length === 0) return;
    const last = removedMarks[removedMarks.length - 1];
    setMarks((arr) => [...arr, last]);
    const rest = removedMarks.slice(0, -1);
    setRemovedMarks(rest);
    if (rest.length === 0 && removedClearTimerRef.current) {
      clearTimeout(removedClearTimerRef.current);
      removedClearTimerRef.current = null;
    }
  };

  /** 送信済みの！を消せなかった（24時間超過・本人以外等）ときの一言を出す */
  const showSentDeleteError = () => {
    setSentDeleteNotice("もう直せません（送信から24時間まで）");
    setTimeout(() => setSentDeleteNotice(null), 6000);
  };

  /**
   * 跳ねる面の！を押したときの通知（オーナー最終決定：タップ→中空停止→確認モーダル）。
   * 押した瞬間はまだ何も止めない・消さない。確認が出ていないときだけ、その粒を凍結して
   * 「この！を消す？」を出す。確認中に別の粒を押しても無視する（先の確認を閉じるまで一つだけ）。
   */
  const onBubbleTap = (tag: string) => {
    if (bubbleConfirmTagRef.current) return;
    bubbleConfirmTagRef.current = tag;
    handsRef.current?.freezeBubble(tag);
    setBubbleConfirm({ tag });
  };

  /** 確認の「やめる」：何もなかったことにして、凍結した粒の動きを再開する */
  const cancelBubbleConfirm = () => {
    const tag = bubbleConfirmTagRef.current;
    bubbleConfirmTagRef.current = null;
    setBubbleConfirm(null);
    if (tag) handsRef.current?.resolveBubble(tag, "resume");
  };

  /**
   * 確認の「消す」：凍結した粒を縮めて消し、tagの中身（draft/sent）に応じて実際の削除を行う。
   * draft = まだ送っていない下書き。既存の removeMark をそのまま使う（振り返り側の×と同じ扱い）。
   * sent = 既に送信済みの行。棚をUPDATE（最後の1個ならDELETE）して消す。undoは無い
   * （確認モーダルを挟んだのでこれでよい、というオーナー決定）。
   */
  const confirmBubbleDelete = async () => {
    const tag = bubbleConfirmTagRef.current;
    bubbleConfirmTagRef.current = null;
    setBubbleConfirm(null);
    if (!tag) return;
    handsRef.current?.resolveBubble(tag, "remove");
    if (tag.startsWith("draft:")) {
      const id = Number(tag.slice("draft:".length));
      if (!Number.isNaN(id)) removeMark(id);
    } else if (tag.startsWith("sent:")) {
      const rest = tag.slice("sent:".length);
      const sep = rest.lastIndexOf(":");
      if (sep > 0) {
        const rowId = rest.slice(0, sep);
        const index = Number(rest.slice(sep + 1));
        if (!Number.isNaN(index)) await deleteSentMark(rowId, index);
      }
    }
  };

  /**
   * 送信済みの行から！を1つ消す。RLS（本人＋24時間以内）が通れば成功。
   * 通らない場合はエラーを投げずに0件更新で返ってくる（RLSの仕様）ので、更新できた行数で判定する。
   * 最後の1個を消すときは、空配列の行を棚に残さないよう行ごとDELETEする
   * （UPDATE用のDELETEポリシーも既に用意されている）。
   */
  const deleteSentMark = async (rowId: string, index: number) => {
    const row = rawTapRows.find((r) => r.id === rowId);
    if (!row) { showSentDeleteError(); return; }
    const secs = row.mark_secs ?? [];
    const db = getSupabase();
    try {
      if (secs.length <= 1) {
        const { data, error } = await db.from("call_tap_sessions").delete().eq("id", rowId).select("id");
        if (error) throw error;
        if (!data || data.length === 0) { showSentDeleteError(); return; }
        setRawTapRows((prev) => prev.filter((r) => r.id !== rowId));
      } else {
        const memberIds = row.mark_member_ids ?? [];
        const words = row.mark_words ?? [];
        const newSecs = secs.filter((_, i) => i !== index);
        const newMemberIds = memberIds.filter((_, i) => i !== index);
        const newWords = words.filter((_, i) => i !== index);
        const { data, error } = await db.from("call_tap_sessions")
          .update({ mark_secs: newSecs, mark_member_ids: newMemberIds, mark_words: newWords })
          .eq("id", rowId)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0) { showSentDeleteError(); return; }
        setRawTapRows((prev) => prev.map((r) => (r.id !== rowId ? r : {
          ...r, mark_secs: newSecs, mark_member_ids: newMemberIds, mark_words: newWords,
        })));
      }
    } catch {
      showSentDeleteError();
    }
  };

  /**
   * 振り返り画面で、その行の色の丸を押したときの塗り替え。
   * 今チップ列で選んでいる色（currentColor）で、その！を上書きするだけ。
   * まだ送信前の画面内の値なので、取り消しは作らず「選び直して押し直せば済む」でよい。
   */
  const recolorMark = (id: number) => {
    const colorHex = chipColorIdToHex(currentColor);
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
      showSendError(`確認の手続きで止まりました（${errMessage(err)}）。時間をおいてもう一度`);
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
      if (!row) throw new Error("この曲はまだ受付を始めていません");

      const { data: userData, error: e2 } = await db.auth.getUser();
      if (e2) throw e2;
      if (!userData.user) throw new Error("確認の手続きがうまくいきませんでした");

      // 送信直前にも念のため近すぎる！の統合を通す（振り返り後に追加で叩いて重ねた場合の保険）。
      // ここでは一言は出さない（振り返りを開いたときの一言で十分。ここは保険なので静かに）
      const { merged } = mergeCloseMarks(marks, estimateBeatSec(marks));

      const { data: insertedRow, error: e3 } = await db.from("call_tap_sessions").insert({
        song_id: row.id,
        video_id: video.video_id,
        mark_secs: merged.map((m) => m.sec),
        mark_member_ids: merged.map((m) => m.memberId),
        mark_words: merged.map((m) => m.word),
        created_by: userData.user.id,
      }).select("id").single();
      if (e3) throw e3;

      // 送った行のIDを端末に控える（送信済みの吹き出しを「これは自分の行」として押せる対象にする用）
      if (insertedRow?.id) setSentRowIds(addSentRowId(slug, video.video_id, insertedRow.id));

      // 送れた＝この参加は1行として棚に乗った。次の通しはゼロから数え直す。
      // 黙って数がゼロに戻ると「消えた」ように見えて不安にさせるので、お礼の画面に切り替える
      setMarks([]);
      setThankYou({ count: merged.length });
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
    if (reviewTrigger === "back") navigate("/call-center");
  };

  /**
   * 「まだ叩く（もう一度頭から）」：ラベルどおり必ず頭から再生し直す。
   * 見返し（プレビュー）を途中で止めた状態でこれを押すと、直前の見返し位置から再生される
   * 食い違いが実機で報告されたため、seekTo(0) を必ず通す。
   * play() は「動画が終わった直後(ENDED状態)」だと内部で先頭(0秒)へ戻す仕様があるので、
   * 先に play() を呼んでから seekTo(0) で確実に頭へ上書きする（seekPreview と同じ順序）。
   */
  const onReviewKeepTapping = () => {
    clearPreview();
    cancelWordEdit();
    playerRef.current?.play();
    playerRef.current?.seekTo(0);
    setPlaying(true);
    setReviewTrigger(null);
  };

  /**
   * 「送らずに戻る」（back起点のみ）：送らずに離脱する。
   * 下書きは消さずに残す（端末の中のメモなので容量の実害なし。戻ってきたら続きから編集できる。
   * 消えるのは送信が成功したときだけ）。オーナー決定 2026-08-16。
   */
  const onReviewLeaveWithoutSending = () => {
    clearPreview();
    cancelWordEdit();
    setReviewTrigger(null);
    navigate("/call-center");
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;

  if (error) {
    return (
      <div style={{ ...S.page, justifyContent: "center", alignItems: "center" }}>
        <p style={{ fontSize: 14 }}>{error}</p>
        <button style={S.play} onClick={() => navigate("/call-center")}>曲の一覧へ</button>
      </div>
    );
  }

  if (thankYou) {
    // 送信成功後のお礼画面（振り返り画面の代わりに出す）。storyboard v4 SCREEN 5（オーナー承認済み）。
    // Xへの投稿はあくまで任意＝「しない」でも一覧へ普通に戻れる。文言はオーナー確定分（2026-08-17）。
    const shareText = `${title}のコール、登録してみました。\n知っているコールへの一票も、まだ無いコールの追加もできます。\n再生して、コールのタイミングで「！」をタップ。見返して、言葉も入力できます。\n#コール情報集約センター`;
    const pageUrl = `${window.location.origin}/call-center/song/${slug}/place`;
    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(pageUrl)}`;
    return (
      <div style={{ ...S.page, justifyContent: "center" }}>
        <h1 style={S.thankYouTitle}>ご協力ありがとうございます。</h1>
        <p style={S.thankYouBody}>また情報提供いただけますよう職員一同お待ちしております。</p>
        <p style={S.thankYouCount}>！ {thankYou.count}個 を受け付けました</p>
        <div style={S.thankYouTweetBox}>
          {shareText}
          <div style={S.thankYouTweetLink}>{pageUrl}</div>
        </div>
        <div style={S.thankYouActions}>
          <a
            href={tweetUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...S.modalPrimary, display: "block", textAlign: "center", textDecoration: "none" }}
          >Xに投稿する</a>
          <button type="button" style={S.modalSecondary} onClick={() => navigate("/call-center")}>しない</button>
        </div>
      </div>
    );
  }

  const currentColorHex = chipColorIdToHex(currentColor);
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
      {sentDeleteNotice && <div style={S.errorBanner}>{sentDeleteNotice}</div>}
      {bubbleConfirm && (
        /* 吹き出しを押したときの確認。動画は再生を続けたまま、動画の上には重ねない
           （下端固定のバナー。押した粒はHandsCanvas側で既に凍結済み） */
        <div style={S.bubbleConfirmBanner}>
          <span>この！を消す？</span>
          <button type="button" style={S.bubbleConfirmBtn} onClick={confirmBubbleDelete}>消す</button>
          <button type="button" style={S.bubbleConfirmBtnGhost} onClick={cancelBubbleConfirm}>やめる</button>
        </div>
      )}

      <div style={S.head}>
        <button style={S.back} onClick={handleBack}>曲の一覧へ</button>
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
            startSeconds={video.offset_sec}
            endSeconds={video.end_sec ?? undefined}
          />
        )}
      </div>

      {/* 動画の候補が複数あるときだけ出す。1本しか無い曲では何も表示しない（今までどおり） */}
      {videoOptions.length > 1 && (
        <div style={S.videoChipRow}>
          {videoOptions.map((v, i) => (
            <button
              key={v.video_id}
              type="button"
              style={v.video_id === video?.video_id ? { ...S.videoChip, ...S.videoChipOn } : S.videoChip}
              onClick={() => switchVideo(v)}
            >{v.label || `動画${i + 1}`}</button>
          ))}
        </div>
      )}

      {reviewTrigger ? (
        /* 振り返り画面。動画は上に出たままなので「見返す」で流しながら一覧を読める */
        <div style={S.reviewWrap}>
          {mergeNotice && (
            /* 近すぎる！を統合したときの一言。控えめに一時表示（エラーバナーと同じ流儀） */
            <div style={S.mergeNotice}>{mergeNotice}</div>
          )}
          {removedMarks.length > 0 && (
            /* ×で消した行の取り消し案内。誤って消した事故対策 */
            <div style={S.mergeNotice}>
              {removedMarks.length}件 消しました
              <button type="button" style={S.undoLink} onClick={undoRemove}>取り消す</button>
            </div>
          )}
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
                      placeholder="コールの言葉（12文字まで）"
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
            {/* これで送る／送らずに戻る／まだ叩く: 一覧の一番下（全行の後ろ）に置く。
                固定表示にせず、スクロールして最後まで届いて初めて押せる位置にすることで
                「一通り見てから送る」動線にする（常時アクティブで画面内にいるのはおかしい、という指摘） */}
            <div style={S.reviewActionsInList}>
              <button style={S.modalPrimary} onClick={onReviewSend} disabled={sending || marks.length === 0}>
                {sending ? "送っています…" : "これで送る"}
              </button>
              {reviewTrigger === "back" && (
                <button style={S.modalSecondary} onClick={onReviewLeaveWithoutSending} disabled={sending}>送らずに戻る（続きはあとで）</button>
              )}
              <button style={S.modalSecondary} onClick={onReviewKeepTapping} disabled={sending}>まだ叩く（もう一度頭から）</button>
            </div>
          </div>
          {/* 色チップ＋！ボタンの専用置き場。振り返りリスト(reviewList)とは別の、通常フローの
              置き場（このdiv自体はここに書いた条件でしか現れない普通の兄弟要素。absoluteでリストの
              裏に敷いていない）。出ているあいだ、上の reviewList はその分だけ高さが縮む。
              常時は出さない。言葉の編集中・見返し中（プレビュー再生中）のどちらかで出す
              （二重に出ないよう条件を1つにまとめる。色直しの丸押し／見返し中の追加叩きに使う）。
              見返し中だけ！ボタンも出す＝叩き足せる。編集中だけ一言も出す。
              見返し中の判定は playing を直接使わず previewToolsVisible（250msのワンクッション）を使う。 */}
          {(editingMarkId !== null || previewToolsVisible) && (
            <>
              {colorPicker}
              {previewToolsVisible && (
                <div style={S.btnRow}>
                  <button
                    type="button"
                    style={{ ...S.mark, background: markBg, color: markFg, boxShadow: markBoxShadow, transform: markPressed ? "scale(0.92)" : "scale(1)" }}
                    onPointerDown={handleMarkDown}
                    onPointerUp={handleMarkUp}
                    onPointerLeave={handleMarkUp}
                    onPointerCancel={handleMarkUp}
                    onContextMenu={(e) => e.preventDefault()}
                  >！</button>
                </div>
              )}
              {editingMarkId !== null && (
                <p style={S.reviewLede}>ちょっとタイミングずれたかも、とかはライブ感ということでいいじゃない。</p>
              )}
            </>
          )}
        </div>
      ) : (
        // 動画より下を、高さ1/3ずつの3段に割る（上=言葉レーン／中=跳ねる面／下=色えらび＋！ボタン）。
        // 吹き出しが！ボタンの真後ろから跳んで隠れる問題を、段を分けることで解消する
        <div style={S.belowVideo}>
          {/* 上段: 言葉レーン。段の縦中央=レーンの縦中央（WordLane内部は親いっぱいに広がる作り） */}
          <div style={S.laneSection}>
            <WordLane playerRef={playerRef} crowdWords={crowdWords} active={playing} />
          </div>

          {/* 中段: 跳ねる面。alignBottomのまま＝この段の下端から跳び上がる。動画の上には重ねない */}
          <div style={S.stage}>
            <HandsCanvas
              ref={handsRef}
              icon="mark"
              sessions={sessions}
              selfMemberId="nishida"
              selfSeatHash={7}
              resolveColor={resolveChipColor}
              alignBottom
              skipSquash
              // 自分の！は中央固定なので、群衆の粒がたまたま中央に湧くと完全に重なって見えなくなる。
              // 中央帯を避け、湧くたびに小さな左右ゆらぎを足す（少し重なるのは良いが完全一致は避ける）
              avoidCenterX
              // 中段が低くなった分、絵自体を約半分に縮めて頭からしっぽまで収める（跳躍量は変えない）
              iconScale={0.5}
              scaleCount={300}
              // 段が1/3に狭まった分、上下の余白はごく小さくする。跳躍80px＋吹き出し自体の高さは
              // この段(だいたい100〜120px程度を想定)に収まりきらないことがあるが、余白を大きく取って
              // 吹き出しを潰すより、多少上の段(言葉レーン)に跳躍がはみ出すほうを優先する
              // （オーナー指定）。※実機での見た目確認はできていない
              topMargin={10}
              // 吹き出しの表示幅の半分＋数px（！のテクスチャは吹き出し本体が256px角の枠に208px幅で
              // 収まる作り。BASE_SIZE基準の典型的な表示サイズの半分程度を見込んだ値）。
              // 端いっぱいに湧いても本体が枠外に出て文字が読めなくなるのを防ぐ
              sideMargin={50}
              bottomMargin={10}
              freezeAge
              onBubbleTap={onBubbleTap}
              getBucketTapTag={getBucketTapTag}
            />
          </div>

          {/* 下段: ！ボタン＋色えらび（！を先に） */}
          <div style={S.bottomSection}>
            <div style={S.btnRow}>
              <button
                type="button"
                style={{ ...S.mark, background: markBg, color: markFg, opacity: playing ? 1 : 0.4, boxShadow: markBoxShadow, transform: markPressed ? "scale(0.92)" : "scale(1)" }}
                onPointerDown={handleMarkDown}
                onPointerUp={handleMarkUp}
                onPointerLeave={handleMarkUp}
                onPointerCancel={handleMarkUp}
                onContextMenu={(e) => e.preventDefault()}
                disabled={!playing}
              >！</button>
            </div>

            {colorPicker}
          </div>

          {!playing && (
            /* 再生していない（一時停止中も含む）あいだ、中段（跳ねる面）だけを1枚の再生ボタンで覆う。
               上段（言葉レーン）・下段（色えらび・！ボタン）は透過。！ボタン自体は disabled で押せない。
               HandsCanvasはアンマウントしない（覆いの下でPixiJSはそのまま動き続ける＝作り直しを避ける）。
               動画自体はこの外(videoBox)にあるので、動画の上には重ならない */
            <button type="button" style={S.midPlayOverlay} onClick={togglePlay}>▶ 再生してコールを見る</button>
          )}
        </div>
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
  // 動画の複数候補チップ。動画エリアのすぐ下、迷わない程度に控えめに
  videoChipRow: { flex: "0 0 auto", display: "flex", gap: 6, padding: "6px 0", overflowX: "auto" },
  videoChip: {
    flex: "0 0 auto", background: "none", color: "#9aa0a6",
    boxShadow: "inset 0 0 0 1px #444", padding: "5px 10px", fontSize: 11, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
  },
  videoChipOn: { background: "#fff", color: "#000", boxShadow: "none" },
  play: { background: "#1a1a1a", color: "#eee", border: 0, boxShadow: "inset 0 0 0 1px #444", padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  // 動画より下の全部（言葉レーン・跳ねる面・色えらび＋！ボタン）を包む器。3段は各 flex:1 で
  // 高さ1/3ずつに均等分割する。止まっているとき、中段(跳ねる面)だけを midPlayOverlay で覆う
  belowVideo: { position: "relative", flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" },
  // 上段: 言葉レーン専用の器（WordLane はこの中いっぱいに広がる）
  laneSection: { position: "relative", flex: 1, minHeight: 0, overflow: "hidden" },
  // 中段: 跳ねる面
  stage: { position: "relative", flex: 1, minHeight: 0, background: "#0a0a0c", overflow: "hidden" },
  // 下段: ！ボタン＋色えらび。段の中で縦中央寄せ
  bottomSection: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center" },
  // 止まっている（一時停止含む）あいだ、中段(跳ねる面)を中心に高さ1/2ぶんを覆う1枚の再生ボタン。
  // 上段・下段は透過のまま（言葉レーン・色えらび・！ボタンが見える。！ボタン自体は別途disabled）
  midPlayOverlay: {
    position: "absolute", left: 0, right: 0, top: "25%", height: "50%", zIndex: 20,
    background: "#fff", color: "#000",
    border: 0, fontSize: 24, fontWeight: 900, cursor: "pointer", fontFamily: "inherit",
  },
  // 「大きい文字」レーン。段(laneSection)いっぱいに広がる。タップは透過（下の段のボタンを塞がない）
  wordLane: {
    position: "absolute", inset: 0,
    overflow: "hidden", pointerEvents: "none",
  },
  // 1行だけ（上下の段分けはしない）。縦は常に中央
  wordLaneItem: {
    position: "absolute", left: "50%", top: "50%",
    transform: "translate(-50%, -50%)",
    fontSize: 14, fontWeight: 800, color: "#888",
    whiteSpace: "nowrap", willChange: "transform, opacity",
    transition: "transform 150ms ease-out, color 150ms ease-out, opacity 200ms ease-out",
  },
  colorPickerRow: { display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto", padding: "8px 0 0" },
  arrowBtn: { flex: "0 0 auto", width: 26, height: 26, background: "#1a1a1a", color: "#eee", border: 0, boxShadow: "inset 0 0 0 1px #444", fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: 0 },
  dotsRow: { flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 3, padding: "0 6px" },
  dot: { flex: "0 1 22px", aspectRatio: "1", minWidth: 12, maxWidth: 22, borderRadius: "50%", border: 0, cursor: "pointer", padding: 0 },
  btnRow: { display: "flex", gap: 8, flex: "0 0 auto", marginTop: 8, justifyContent: "center" },
  // ！ボタン。ハイ！テンションの✋ボタン（HiTapButton）と同じ丸い見た目に揃える
  mark: {
    width: 120, height: 120, flexShrink: 0, borderRadius: "50%",
    border: 0, fontSize: 60, fontWeight: 900, lineHeight: 1, cursor: "pointer", fontFamily: "inherit",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
    touchAction: "manipulation", userSelect: "none", WebkitTapHighlightColor: "transparent",
    transition: "transform 0.12s, box-shadow 0.12s",
  },
  reviewWrap: { flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", marginTop: 8 },
  mergeNotice: { flex: "0 0 auto", fontSize: 11, color: "#9aa0a6", textAlign: "center", marginBottom: 6 },
  undoLink: { background: "none", border: 0, color: "#7cf", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: "0 0 0 6px" },
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
  reviewLede: { fontSize: 12, lineHeight: 1.7, color: "#9aa0a6", margin: "0 0 10px" },
  // 送信ボタン一式。一覧の最後の行として置く（スクロールしないと届かない位置）
  reviewActionsInList: {
    display: "flex", flexDirection: "column", gap: 8,
    marginTop: 12, paddingTop: 14, boxShadow: "inset 0 1px 0 #222",
  },
  modalPrimary: { background: "#fff", color: "#000", border: 0, padding: "12px 14px", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" },
  modalSecondary: { background: "none", color: "#9aa0a6", border: 0, boxShadow: "inset 0 0 0 1px #444", padding: "12px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  errorBanner: {
    position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 150,
    background: "#000", color: "#fff", fontSize: 13, fontWeight: 700,
    padding: "12px 16px", textAlign: "center", boxShadow: "inset 0 1px 0 #333",
  },
  // 吹き出しを押したときの「この！を消す？」確認。動画の上には重ねない下端固定バナー
  bubbleConfirmBanner: {
    position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 160,
    background: "#000", color: "#fff", fontSize: 13, fontWeight: 700,
    padding: "12px 16px", textAlign: "center", boxShadow: "inset 0 1px 0 #333",
    display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
  },
  bubbleConfirmBtn: { background: "#fff", color: "#000", border: 0, padding: "8px 14px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" },
  bubbleConfirmBtnGhost: { background: "none", color: "#9aa0a6", border: 0, boxShadow: "inset 0 0 0 1px #444", padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  // 送信成功後のお礼画面
  thankYouTitle: { fontSize: 19, fontWeight: 900, margin: "0 0 10px" },
  thankYouBody: { fontSize: 13, lineHeight: 1.8, color: "#cbd2dc", margin: "0 0 16px" },
  thankYouCount: { fontSize: 12, color: "#8a8a92", fontFamily: "ui-monospace,Menlo,Consolas,monospace", margin: "0 0 20px" },
  thankYouTweetBox: {
    fontSize: 13, lineHeight: 1.7, color: "#eee", whiteSpace: "pre-line",
    boxShadow: "inset 0 0 0 1px #444", padding: "12px 14px", marginBottom: 20,
  },
  thankYouTweetLink: { fontSize: 12, color: "#7cf", marginTop: 8, wordBreak: "break-all" },
  thankYouActions: { display: "flex", flexDirection: "column", gap: 8 },
};
