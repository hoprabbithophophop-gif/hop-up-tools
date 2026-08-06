/**
 * コールを、画面に出す粒（吹き出し1つぶん）に割る。
 *
 * 「オイ！」のような短いコールは1つに収まるが、「ありがとう」を1つに詰めると読めない。
 * 長いものは声に出す単位（拍）ごとに割って、順番に並べる。
 *
 * 割る単位は文字ではなく「音」にする。小さい「ゃゅょっ」や伸ばす「ー」、「！」は
 * 前の文字にくっついて1つの音になるため。「ウォオオッオ」なら ウォ／オ／オッ／オ の4つ。
 * ローマ字の連なり（Fu, BEYOOOOONDS）は途中で割らず1つの塊として扱う。
 *
 * 【いちばん大事なこと】
 * 粒は必ず目盛りの上に置く。目盛りから外れた位置に置くと、
 * 見る人には「拍に乗っている」ことが伝わらず、ただ文字が流れているだけになる。
 */

/** 目盛り1本 */
export type GridLine = {
  t: number;
  /** 拍の頭か（裏拍でないか） */
  beat: boolean;
  /** 小節の頭か */
  bar: boolean;
};

/** 画面に出す粒1つ */
export type CallUnit = {
  /** 曲の頭から何秒目か（目盛りの上に乗っている） */
  t: number;
  text: string;
  /** 何番目のコールから来たか */
  callIndex: number;
  /** そのコールの中で何番目の粒か */
  unitIndex: number;
  /** そのコールが何粒に割れたか */
  unitCount: number;
  /** 元のコール全文 */
  callText: string;
};

/** 単独では音にならず、前の文字にくっつくもの */
const TRAILING = /[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮーｰ〜～!！?？♪、。]/;
const LATIN = /[A-Za-z0-9']/;

/** 1つの吹き出しにそのまま収める文字数の上限。これを超えたら割る */
const KEEP_WHOLE_CHARS = 3;

/** コール文を、声に出す単位（音）へ割る。 */
export function splitMora(s: string): string[] {
  const out: string[] = [];
  for (const ch of [...s.trim()]) {
    const prev = out[out.length - 1];
    if (/\s/.test(ch)) continue; // 空白は音を持たない
    if (prev !== undefined && TRAILING.test(ch)) {
      out[out.length - 1] = prev + ch;
      continue;
    }
    if (prev !== undefined && LATIN.test(ch) && LATIN.test(prev[prev.length - 1])) {
      out[out.length - 1] = prev + ch; // ローマ字の単語は割らない
      continue;
    }
    out.push(ch);
  }
  return out;
}

/**
 * 8分（半拍）ごとの目盛りを作る。
 *
 * 骨組みがある曲は実測した拍から。無い曲は「1拍の長さ」と、
 * 最初のコールを起点にして等間隔で引く。
 */
export function buildGrid(opts: {
  beats?: number[];
  downbeats?: number[];
  beatSec?: number;
  anchorSec?: number;
  endSec: number;
}): GridLine[] {
  const { beats, downbeats, beatSec, anchorSec = 0, endSec } = opts;

  if (beats && beats.length > 1) {
    const downs = new Set((downbeats ?? []).map((d) => d.toFixed(3)));
    const out: GridLine[] = [];
    for (let i = 0; i < beats.length; i++) {
      const t = beats[i];
      out.push({ t, beat: true, bar: downs.has(t.toFixed(3)) });
      const next = beats[i + 1];
      if (next !== undefined) out.push({ t: (t + next) / 2, beat: false, bar: false });
    }
    return out;
  }

  if (beatSec && beatSec > 0) {
    const half = beatSec / 2;
    // 起点より前にも目盛りが要るので、0秒より手前まで戻してから引く
    let t = anchorSec - Math.ceil(anchorSec / half) * half;
    const out: GridLine[] = [];
    // 小節の頭は分からない（拍の数え始めが不明）ので、拍と裏拍だけ引く
    for (let k = 0; t <= endSec + beatSec && k < 20000; k++, t += half) {
      out.push({ t, beat: k % 2 === 0, bar: false });
    }
    return out;
  }

  return [];
}

/** 並んだ目盛りの中から、その時刻に一番近いものの位置（何本目か）を返す。 */
function snapIndex(grid: GridLine[], sec: number): number {
  let lo = 0;
  let hi = grid.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (grid[mid].t < sec) lo = mid + 1;
    else hi = mid;
  }
  const prev = Math.max(0, lo - 1);
  return Math.abs(sec - grid[prev].t) <= Math.abs(grid[lo].t - sec) ? prev : lo;
}

/**
 * コールの一覧を、画面に並べる粒へ広げる。
 *
 * コールの頭を目盛りに吸着させたうえで、そこから半拍ずつ置いていく。
 * こうすると、どの粒も必ず目盛りの上に立つ。
 */
export function toUnits(
  calls: { t: number; lenSec: number; note: string }[],
  beatSec: number | undefined,
  grid: GridLine[],
): CallUnit[] {
  const out: CallUnit[] = [];
  calls.forEach((c, callIndex) => {
    const callText = c.note.trim();
    if (callText === "") return;

    const units =
      [...callText].length <= KEEP_WHOLE_CHARS ? [callText] : splitMora(callText);

    // 目盛りがあるときは、目盛りそのものを1本ずつ辿る。
    // 秒数を等間隔で足すやり方だと、曲の途中でテンポが変わる曲で目盛りから外れてしまう。
    const startIdx = grid.length > 0 ? snapIndex(grid, c.t) : -1;
    const at = (i: number) => {
      if (startIdx < 0) {
        const step = beatSec && beatSec > 0 ? beatSec / 2 : (c.lenSec > 0 ? c.lenSec / Math.max(1, units.length) : 0.2);
        return c.t + i * step;
      }
      return grid[Math.min(startIdx + i, grid.length - 1)].t;
    };

    units.forEach((u, unitIndex) =>
      out.push({
        t: at(unitIndex),
        text: u,
        callIndex,
        unitIndex,
        unitCount: units.length,
        callText,
      }),
    );
  });
  return out.sort((a, b) => a.t - b.t);
}
