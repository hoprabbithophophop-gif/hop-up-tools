/**
 * /api/hi-sessions の「切り分け」だけを受け持つ道具箱。
 *
 * ファイル名の先頭にアンダースコアを付けているのは、Cloudflare Pages Functions が
 * `_` 始まりのファイルを「外から叩ける入口」として扱わないため。つまりここは
 * hi-sessions.ts から呼ばれる裏方専用で、URL にはならない。
 *
 * やっていること（例え話）：
 *   客席の記録は「名前・日付などの札」と「いつ手を挙げたかの長い目盛り表」が
 *   1枚の紙に印刷された状態でやって来る。全員分をまとめて渡すと紙束が 7MB を超えて
 *   読み終わるまで席が決まらない。そこで
 *     ① 札の部分だけを抜いた「名簿」
 *     ② 目盛り表を 60 秒ずつに切った「区間」
 *   の2種類に分けて、必要な順に渡せるようにする。
 *
 * ここは外部（ネットワーク・キャッシュ）に一切触らない純粋な計算だけ。
 * だから手元の node でそのまま動かして、切り口がズレていないか検算できる。
 */

/** Supabase（hi_aggregations ビュー）から来る 1 行ぶんの形。 */
export type HiFullRow = {
  session_hash: number;
  member_id: string;
  is_today: boolean;
  bucket_indices: number[];
  /** PostgREST は値が無い列を undefined ではなく null で返すので、null も受ける。 */
  bucket_indices_20?: number[] | null;
  played_date: string;
  special_mode?: boolean;
  special_event_key?: string | null;
};

/** 名簿の 1 行。目盛り表（2つの配列）を抜き、代わりに「何回挙げたか」だけを持たせる。 */
export type HiRosterRow = {
  session_hash: number;
  member_id: string;
  is_today: boolean;
  played_date: string;
  special_mode?: boolean;
  special_event_key?: string | null;
  /** bucket_indices.length と同じ。歴代累計はこの数を足すだけで出せる。 */
  hi_count: number;
};

/** 区間の 1 行。誰の分かが分かる番号と、その 60 秒に入るタップだけ。 */
export type HiSegmentRow = {
  session_hash: number;
  bucket_indices: number[];
  bucket_indices_20?: number[];
};

/** 1 区間の長さ（秒）。 */
export const SEGMENT_SECONDS = 60;
/** bucket_indices は 0.1 秒刻み ＝ 60 秒で 600 目盛り。 */
export const BUCKETS_PER_SEGMENT_10 = SEGMENT_SECONDS * 10;
/** bucket_indices_20 は 0.05 秒刻み ＝ 60 秒で 1200 目盛り。 */
export const BUCKETS_PER_SEGMENT_20 = SEGMENT_SECONDS * 20;

/**
 * 名簿を作る。全行から目盛り表2列を抜き、hi_count を足す。
 * maxBucket（bucket_indices の最大値）も返す。クライアントは再生前に曲の長さを
 * 知らないので、「区間がいくつあるか」をこの数から逆算するため。
 */
export function buildRoster(rows: HiFullRow[]): { sessions: HiRosterRow[]; maxBucket: number } {
  const sessions: HiRosterRow[] = [];
  let maxBucket = 0;
  for (const row of rows) {
    const buckets = row.bucket_indices ?? [];
    for (const b of buckets) if (b > maxBucket) maxBucket = b;
    const out: HiRosterRow = {
      session_hash: row.session_hash,
      member_id: row.member_id,
      is_today: row.is_today,
      played_date: row.played_date,
      hi_count: buckets.length,
    };
    // 古いビューに無い列は「入れない」（undefined のまま）。クライアント側の
    // 「列が無ければ旧仕様で読み替える」判断を壊さないため。
    if (row.special_mode !== undefined) out.special_mode = row.special_mode;
    if (row.special_event_key !== undefined) out.special_event_key = row.special_event_key;
    sessions.push(out);
  }
  return { sessions, maxBucket };
}

/** maxBucket から区間の数を出す。0 件でも 1 区間は返す（空の輪が回らないように）。 */
export function segmentCount(maxBucket: number): number {
  if (!(maxBucket >= 0)) return 1;
  return Math.floor(maxBucket / BUCKETS_PER_SEGMENT_10) + 1;
}

/** 昇順に並んだ配列から [lo, hi) に入る部分だけを取り出す。 */
function sliceRange(values: number[] | null | undefined, lo: number, hi: number): number[] {
  if (!values || values.length === 0) return [];
  const out: number[] = [];
  for (const v of values) {
    if (v >= lo && v < hi) out.push(v);
  }
  return out;
}

/**
 * seg 番目の 60 秒区間を切り出す。
 * 0.1 秒刻みの列は [seg*600, (seg+1)*600)、0.05 秒刻みの列は [seg*1200, (seg+1)*1200)。
 * どちらの区切りも同じ実時間を指しているので、2つの列の中身は食い違わない。
 *
 * その 60 秒に 1 回も手を挙げていない人は行ごと落とす（大半の人は曲の一部でしか叩かない）。
 * 回（お祝い等）での絞り込みはここではしない。曲の終わりのリズム判定が全員のタップを
 * 使って拍の位置を推定するため、サーバー側で間引くとその物差しが狂う。
 * 画面に出す／出さないの選り分けは、今までどおりクライアントがやる。
 */
export function buildSegment(rows: HiFullRow[], seg: number): HiSegmentRow[] {
  const lo10 = seg * BUCKETS_PER_SEGMENT_10;
  const hi10 = lo10 + BUCKETS_PER_SEGMENT_10;
  const lo20 = seg * BUCKETS_PER_SEGMENT_20;
  const hi20 = lo20 + BUCKETS_PER_SEGMENT_20;

  const out: HiSegmentRow[] = [];
  for (const row of rows) {
    const cut10 = sliceRange(row.bucket_indices, lo10, hi10);
    const has20 = row.bucket_indices_20 != null;
    const cut20 = has20 ? sliceRange(row.bucket_indices_20, lo20, hi20) : [];
    // 両方とも空＝この 60 秒には居なかった人。行ごと落として転送量を減らす。
    if (cut10.length === 0 && cut20.length === 0) continue;
    const entry: HiSegmentRow = { session_hash: row.session_hash, bucket_indices: cut10 };
    // 細かい列を持っていない古い行には、こちらでも足さない。空配列を入れてしまうと
    // クライアントが「細かい列がある」と誤解して、粗い列からの読み替えをしなくなる。
    if (has20) entry.bucket_indices_20 = cut20;
    out.push(entry);
  }
  return out;
}
