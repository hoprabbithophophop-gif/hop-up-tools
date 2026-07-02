// Hello! Project 2020 〜The Ballad〜 秋ツアー データ
// 元データ: 有志まとめスプレッドシート（セットリストは鳩スレ等を出典に作成）を1回変換した静的JSON。
// ツアーは完結済みのためデータは不変。

import showsRaw from "./shows.json";
import setlistRaw from "./setlist.json";
import videoLinksRaw from "./videoLinks.json";
import videoLinksManualRaw from "./videoLinksManual.json";
import memberOrderRaw from "./memberOrder.json";
import memberGroupRaw from "./memberGroup.json";
import memberColorRaw from "./memberColor.json";
import haloRaw from "./halostation.json";
import compareAnchorsRaw from "./compareAnchors.json";

export interface Show {
  no: string;          // 公演番号 "01"〜
  date: string;        // "9/19(土)"
  open: string;        // 開場 "13:30"
  start: string;       // 開演 "14:30"
  venue: string;       // 会場（都道府県の括弧は除去済み）
  pref: string;        // 都道府県
  performers: string[];
}

export interface SetlistEntry {
  showNo: string;      // 公演番号
  order: string;       // 歌唱順（"" = オープニング/全員曲）
  member: string;      // 歌唱者（"全員" を含む）
  songCore: string;    // 曲名（原曲アーティスト表記を除いたコア）
  artist: string;      // 原曲アーティスト
}

export interface VideoLink {
  showNo: string;
  member: string;
  songCore: string;
  videoId: string;     // YouTube動画ID
  startSec: number;    // 動画内で曲が始まる秒数
  startLabel: string;  // その回の開演時刻表記 "14:30" / "18:15" / "14:30/18:15"
}

// スペシャル扱いで集計に含めない公演（12/2 日本武道館 Special Number = 公演143）。
// 歌唱順が無い特別編成のため、ツアー本編の集計から除外する。
const EXCLUDED_SHOWS = new Set<string>(["143"]);

// shows.json から除外公演を除く
export const SHOWS = (showsRaw as Show[]).filter((s) => !EXCLUDED_SHOWS.has(s.no));

// setlist.json は容量削減のため短縮キー (s/o/m/c/a) で保存 → 読みやすい形へ展開
interface LeanEntry { s: string; o: string; m: string; c: string; a: string }
export const SETLIST: SetlistEntry[] = (setlistRaw as LeanEntry[])
  .filter((r) => !EXCLUDED_SHOWS.has(r.s))
  .map((r) => ({
    showNo: r.s,
    order: r.o,
    member: r.m,
    songCore: r.c,
    artist: r.a,
  }));

// 自動生成分 + 手動補正分をマージ（手動が後勝ち）
export const VIDEO_LINKS: VideoLink[] = [
  ...(videoLinksRaw as VideoLink[]),
  ...(videoLinksManualRaw as VideoLink[]),
].filter((v) => !EXCLUDED_SHOWS.has(v.showNo));

const videoKey = (showNo: string, member: string, songCore: string) =>
  `${showNo}|${member}|${songCore}`;

const videoMap = new Map<string, VideoLink>();
for (const v of VIDEO_LINKS) videoMap.set(videoKey(v.showNo, v.member, v.songCore), v);

/** 同一公演・同一メンバー・同一曲の公式ダイジェスト箇所を返す（無ければ undefined） */
export function findVideo(
  showNo: string,
  member: string,
  songCore: string
): VideoLink | undefined {
  return videoMap.get(videoKey(showNo, member, songCore));
}

// ダイジェスト等、1動画に複数曲が入っている場合の各曲区間の境界（同一動画内の全曲頭秒）。
const SEG_BY_VIDEO = new Map<string, number[]>();
for (const v of VIDEO_LINKS) {
  const arr = SEG_BY_VIDEO.get(v.videoId) ?? [];
  arr.push(v.startSec);
  SEG_BY_VIDEO.set(v.videoId, arr);
}
for (const arr of SEG_BY_VIDEO.values()) arr.sort((a, b) => a - b);

/** 同一動画内で startSec の次に来る曲頭の秒（＝この曲区間の終わり）。無ければ Infinity。 */
export function segmentEnd(videoId: string, startSec: number): number {
  const arr = SEG_BY_VIDEO.get(videoId);
  if (!arr) return Infinity;
  for (const s of arr) if (s > startSec + 0.5) return s;
  return Infinity;
}

// ハロ！ステ（Hello! Station 公式）のソロ歌唱。公演には紐付かず (メンバー×曲) で1本。
interface HaloEntry { member: string; songCore: string; videoId: string; startSec: number; date: string }
const haloMapKey = (member: string, songCore: string) => `${member}|${songCore}`;
const HALO_BY_KEY = new Map<string, VideoLink[]>();
for (const h of haloRaw as HaloEntry[]) {
  const key = haloMapKey(h.member, h.songCore);
  const arr = HALO_BY_KEY.get(key) ?? [];
  arr.push({ showNo: "", member: h.member, songCore: h.songCore, videoId: h.videoId, startSec: h.startSec, startLabel: h.date ? `ハロ！ステ ${h.date}` : "ハロ！ステ" });
  HALO_BY_KEY.set(key, arr);
}

/** (メンバー×曲) のハロ！ステ公式歌唱（無ければ空配列） */
export function haloVideos(member: string, songCore: string): VideoLink[] {
  return HALO_BY_KEY.get(haloMapKey(member, songCore)) ?? [];
}

// 歌い比べの位置合わせ用アンカー（videoId → 曲頭を指す秒。音声解析で校正済みの版のみ）。
// これがある版同士は「再生時刻 − アンカー = 曲頭からの経過秒」が共有でき、位置を保って切替できる。
export const COMPARE_ANCHOR = compareAnchorsRaw as Record<string, number>;

export const SHOW_BY_NO = new Map<string, Show>(SHOWS.map((s) => [s.no, s]));

// スケジュールシートの出演者に名前がある「個人」だけの集合。
// MEMBERS（メンバーで探す）は個人のみに絞る。全員/ユニット①〜⑥/グループ名/
// デュエット/上々軍団 はここに含まれない（SONGS・SHOWSには残る）。
export const INDIVIDUAL_MEMBERS = new Set<string>(SHOWS.flatMap((s) => s.performers));

// スプレッドシート「出演者(横軸)」の並び（所属ユニット順）。MEMBERS の表示順に使う。
const MEMBER_ORDER = memberOrderRaw as string[];
export const MEMBER_ORDER_INDEX = new Map<string, number>(
  MEMBER_ORDER.map((m, i) => [m, i])
);

// メンバー → 所属ユニット名（出演者(横軸) シートの表記そのまま）
export const MEMBER_GROUP = memberGroupRaw as Record<string, string>;

// メンバー → メンバーカラー（#rrggbb / 未登録は ""）。MINEの頭文字背景に使う
export const MEMBER_COLOR = memberColorRaw as Record<string, string>;

/** "全員" 等のグループ歌唱を除いたソロ歌唱者か */
export const isSolo = (member: string) => member !== "全員" && member.trim() !== "";

// 公演表示用ラベル: "9/19(土) 14:30 ハーモニーホール座間 大ホール"
export function showLabel(s: Show): string {
  return `${s.date} ${s.start} ${s.venue}`.trim();
}
