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
import compareCalibRaw from "./compareCalib.json";
import omakeRaw from "./omake.json";
import omakeChusenRaw from "./omakeChusen.json";
import furusatoRaw from "./furusato.json";

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
  endSec?: number;     // 曲の終わり秒(主にハロ！ステ単体再生の停止用)。無ければ区間end/最後まで
  full?: boolean;      // true=全編1曲のフル動画(OMAKEスタジオカバー)。false/未指定=ダイジェスト抜粋
  caption?: string;    // 動画モーダル下部の説明文の上書き(OMAKE=スタジオカバー/抽選会など)。無ければ既定文
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
interface HaloEntry { member: string; songCore: string; videoId: string; startSec: number; date: string; endSec?: number }
const haloMapKey = (member: string, songCore: string) => `${member}|${songCore}`;
const HALO_BY_KEY = new Map<string, VideoLink[]>();
for (const h of haloRaw as HaloEntry[]) {
  const key = haloMapKey(h.member, h.songCore);
  const arr = HALO_BY_KEY.get(key) ?? [];
  arr.push({ showNo: "", member: h.member, songCore: h.songCore, videoId: h.videoId, startSec: h.startSec, startLabel: h.date ? `ハロ！ステ ${h.date}` : "ハロ！ステ", ...(h.endSec !== undefined ? { endSec: h.endSec } : {}) });
  HALO_BY_KEY.set(key, arr);
}

/** (メンバー×曲) のハロ！ステ公式歌唱（無ければ空配列） */
export function haloVideos(member: string, songCore: string): VideoLink[] {
  return HALO_BY_KEY.get(haloMapKey(member, songCore)) ?? [];
}

// 歌い比べの位置合わせ用アンカー（videoId → 曲頭を指す秒。音声解析で校正済みの版のみ）。
// これがある版同士は「再生時刻 − アンカー = 曲頭からの経過秒」が共有でき、位置を保って切替できる。
export const COMPARE_ANCHOR = compareAnchorsRaw as Record<string, number>;

// 黒フェード検出で校正した frame 精度のアンカー／曲終わり（実測 residual < 1フレーム）。
// (videoId, startSec) 単位。ある版はこれを優先し、無ければ旧 COMPARE_ANCHOR / segmentEnd にフォールバック。
interface CalibEntry { videoId: string; startSec: number; anchor: number; end: number | null }
const CALIB = new Map<string, { anchor: number; end: number }>();
for (const c of compareCalibRaw as CalibEntry[]) {
  CALIB.set(`${c.videoId}|${c.startSec}`, { anchor: c.anchor, end: c.end ?? Infinity });
}

/** 位置合わせ用の曲頭秒。校正値(videoId+startSec) → startSec の順にフォールバック。
 * ※旧 COMPARE_ANCHOR は videoId 単位で、同一動画に複数曲があるハロステ/メドレーで
 *   別の曲へジャンプしてしまうため使わない(例: iKDrnDYa0CU の上國料たしかなこと→植村会いたい)。 */
export function compareAnchor(videoId: string, startSec: number): number {
  return CALIB.get(`${videoId}|${startSec}`)?.anchor ?? startSec;
}

/** この曲区間の終わり秒（null は Infinity）。校正値が無ければ従来の segmentEnd。 */
export function compareEnd(videoId: string, startSec: number): number {
  const c = CALIB.get(`${videoId}|${startSec}`);
  return c ? c.end : segmentEnd(videoId, startSec);
}

// OMAKE: The Ballad 楽曲のスタジオソロカバー（各ユニット公式チャンネルの単独MV/歌唱動画）。
// 公演には紐付かず 1動画=全編1曲。単体再生は startSec=0 / endSec なし（最後まで）。
export interface OmakeEntry {
  member: string;
  songCore: string;
  artist: string;   // 原曲アーティスト
  videoId: string;
  channel: string;  // 投稿元の公式チャンネル
}
export const OMAKE: OmakeEntry[] = omakeRaw as OmakeEntry[];

/** OmakeEntry を単体再生/聴き比べ用の VideoLink に変換（showNo=""、全編1曲なので startSec=0）。
 *  校正アンカーの無いスタジオ音源のため、compareAnchor/compareEnd は startSec(=0)/Infinity に
 *  フォールバックし「頭合わせ同期・全編ループ」になる。startLabel には投稿チャンネルを入れる。 */
export function omakeVideo(e: OmakeEntry): VideoLink {
  return {
    showNo: "", member: e.member, songCore: e.songCore, videoId: e.videoId,
    startSec: 0, startLabel: e.channel, full: true,
    caption: "公式チャンネル配信のスタジオソロカバー（全編）を再生しています。",
  };
}

// OMAKE: 歌唱順抽選会（各会場ブロックで歌唱順をくじ引きする公式の舞台裏動画。OMAKE CHANNEL）。
// 曲ではなくイベントなので member 位置に「歌唱順抽選会（+チーム）」、songCore に「日付 会場」を入れる。
export interface ChusenEntry {
  date: string;    // "7/11・12"
  venue: string;   // "中野サンプラザ"
  team: string;    // "A"/"B"/"C" または "" (チーム分けのある回のみ)
  videoId: string;
}
export const OMAKE_CHUSEN: ChusenEntry[] = omakeChusenRaw as ChusenEntry[];

/** ChusenEntry を単体再生用の VideoLink に変換（全編・startSec=0）。 */
export function chusenVideo(e: ChusenEntry): VideoLink {
  return {
    showNo: "", member: e.team ? `歌唱順抽選会 ${e.team}チーム` : "歌唱順抽選会",
    songCore: `${e.date} ${e.venue}`, videoId: e.videoId,
    startSec: 0, startLabel: e.date, full: true,
    caption: "公式チャンネルの歌唱順抽選会（舞台裏・全編）を再生しています。",
  };
}

export const SHOW_BY_NO = new Map<string, Show>(SHOWS.map((s) => [s.no, s]));

/** 公演を「月→日→開演時刻」で時系列に並べる数値キー（未知の公演は末尾）。SONGS/MEMBERSの公演内訳の並びに使う。 */
export function showSortKey(showNo: string): number {
  const s = SHOW_BY_NO.get(showNo);
  if (!s) return Number.MAX_SAFE_INTEGER;
  const md = s.date.match(/(\d+)\/(\d+)/);
  const month = md ? Number(md[1]) : 99;
  const day = md ? Number(md[2]) : 99;
  const t = s.start.match(/(\d+):(\d+)/);
  const mins = t ? Number(t[1]) * 60 + Number(t[2]) : 0;
  return (month * 100 + day) * 10000 + mins;
}

// スケジュールシートの出演者に名前がある「個人」だけの集合。
// MEMBERS（メンバーで探す）は個人のみに絞る。全員/ユニット①〜⑥/グループ名/
// デュエット はここに含まれない（SONGS・SHOWSには残る）。
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

// 「どの公演のふるさと？」用: 各公演のダイジェスト内「ふるさと」全員合唱パートのサビ区間(ロゴ除外済み)＋編成人数＋出演メンバー。
export interface FurusatoShow {
  videoId: string;
  showNo: string;
  date: string;    // "9/26(土)"
  start: string;   // "14:30"
  venue: string;
  pref: string;
  startSec: number; // サビ開始
  endSec: number;   // サビ終わり(ロゴ手前)
  n: number;        // 編成人数(4/6/8)
  members: string[];
}
export const FURUSATO = furusatoRaw as FurusatoShow[];
