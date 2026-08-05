/**
 * 曲の骨組み（拍・小節頭・区間）の読み込み。
 *
 * 骨組みはデータベースではなく、アプリと一緒に配る静的ファイルから読む。
 * 一度決まったら変わらないデータなので、毎回データベースへ取りに行く必要がない。
 * 置き場所は public/call-center/songs/<曲ID>.json（scripts/song-structure/publish.py が作る）。
 */

export type Section = {
  order: number;
  startSec: number;
  endSec: number;
  startTick: number;
  endTick: number;
  labelAuto: string;
  name: string | null;
  group: number;
};

export type Skeleton = {
  slug: string;
  /** 骨組みの照合番号。データベース側の記録と突き合わせて食い違いを見つける */
  digest: string;
  bpm: number;
  /** 1拍あたりの目盛り数（480） */
  ppq: number;
  /** 曲の0拍目が音源の何秒目か */
  firstBeatSec: number;
  silenceHead: number;
  /** 音が鳴り終わる時刻 */
  soundEnd: number | null;
  /** ここまでが解析器の出した拍。これ以降は曲の終わりまで継ぎ足した推定値 */
  beatsMeasured: number | null;
  beats: number[];
  downbeats: number[];
  sections: Section[];
};

const cache = new Map<string, Promise<Skeleton>>();

export function loadSkeleton(slug: string): Promise<Skeleton> {
  let p = cache.get(slug);
  if (!p) {
    p = fetch(`/call-center/songs/${slug}.json`).then((r) => {
      if (!r.ok) throw new Error(`骨組みが見つかりません: ${slug}`);
      return r.json() as Promise<Skeleton>;
    });
    cache.set(slug, p);
  }
  return p;
}

/** マス（8分音符）の一覧。1拍を2つに割る。 */
export type Cell = {
  /** 目盛り。1拍=ppq、マスはその半分 */
  tick: number;
  /** そのマスが始まる時刻（秒） */
  sec: number;
  /** 小節の頭か */
  isBarStart: boolean;
  /** 拍の頭か（裏拍でないか） */
  isBeat: boolean;
  /** 解析器が取った拍ではなく、継ぎ足した推定値の範囲か */
  estimated: boolean;
};

/**
 * 拍と小節頭から、8分音符のマスを組み立てる。
 * マスの幅は拍に比例させる（実時間には比例させない）ので、
 * ここでは並び順と時刻だけを持ち、幅は画面側が一律に決める。
 */
export function buildCells(sk: Skeleton): Cell[] {
  const downs = new Set(sk.downbeats.map((d) => d.toFixed(3)));
  const measured = sk.beatsMeasured ?? sk.beats.length;
  const half = sk.ppq / 2;
  const cells: Cell[] = [];

  for (let i = 0; i < sk.beats.length; i++) {
    const t = sk.beats[i];
    const next = sk.beats[i + 1];
    cells.push({
      tick: i * sk.ppq,
      sec: t,
      isBarStart: downs.has(t.toFixed(3)),
      isBeat: true,
      estimated: i >= measured,
    });
    // 裏拍。次の拍が分かるときだけ置く
    if (next !== undefined) {
      cells.push({
        tick: i * sk.ppq + half,
        sec: (t + next) / 2,
        isBarStart: false,
        isBeat: false,
        estimated: i >= measured,
      });
    }
  }
  return cells;
}

/** マスを小節ごとに分ける。変拍子の小節はそのまま短い行になる。 */
export function groupByBar(cells: Cell[]): Cell[][] {
  const bars: Cell[][] = [];
  let cur: Cell[] = [];
  for (const c of cells) {
    if (c.isBarStart && cur.length > 0) {
      bars.push(cur);
      cur = [];
    }
    cur.push(c);
  }
  if (cur.length > 0) bars.push(cur);
  return bars;
}

/** その時刻がどの区間に入るか。 */
export function sectionAt(sk: Skeleton, sec: number): Section | null {
  for (const s of sk.sections) {
    if (sec >= s.startSec && sec < s.endSec) return s;
  }
  return null;
}
