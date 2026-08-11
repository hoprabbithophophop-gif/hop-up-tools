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
/** 書いた人が「ここで切る」と示すもの。空白と中黒 */
const SEPARATOR = /[\s・･/／|｜]/;

/** かなの母音。「とう」「せい」のように、伸ばす音を1つにまとめるのに使う */
const VOWEL_O = "おこそとのほもよろをごぞどぼぽょオコソトノホモヨロヲゴゾドボポョ";
const VOWEL_E = "えけせてねへめれげぜでべぺエケセテネヘメレゲゼデベペ";

/**
 * 前の音に、この文字がくっついて1つの音になるか。
 * 「ありがとう」の「う」は前の「と」を伸ばす音なので「とう」で1つ。
 * ここで見るのは伸ばす働きの2つだけにしてある。同じ母音が続くだけで
 * まとめてしまうと、「ウォオオッオ」のように1音ずつ叫ぶものが潰れるため。
 */
function isLongVowelTail(prev: string, ch: string): boolean {
  const last = prev[prev.length - 1];
  if (ch === "う" || ch === "ウ") return VOWEL_O.includes(last);
  if (ch === "い" || ch === "イ") return VOWEL_E.includes(last);
  return false;
}

/** 1つの吹き出しにそのまま収める文字数の上限。これを超えたら割る */
const KEEP_WHOLE_CHARS = 3;

/**
 * コール文を、声に出す単位（音）へ割る。
 *
 * 機械の見当が実際のリズムと違うことはある（「おーるぼざわー」を
 * 「おーる／ぼざ／わー」と切りたい、など）。単語の切れ目は文字だけからは
 * 分からないので、**採譜するときに空白か「・」を入れれば、そこで切れる。**
 */
export function splitMora(s: string): string[] {
  const text = s.trim();

  // 書いた人が区切りを入れているなら、その通りに切る。機械の見当は使わない。
  // 「おーる ぼざ わー」と書けば、そのまま3つになる。
  if (SEPARATOR.test(text)) {
    const parts = text
      .split(new RegExp(SEPARATOR.source, "g"))
      .map((p) => p.trim())
      .filter((p) => p !== "");
    if (parts.length > 1) return parts;
  }

  // 区切りが無いときだけ、機械が音の切れ目を見当で決める。
  const out: string[] = [];
  for (const ch of [...text]) {
    const prev = out[out.length - 1];
    if (prev !== undefined) {
      if (TRAILING.test(ch) || isLongVowelTail(prev, ch)) {
        out[out.length - 1] = prev + ch;
        continue;
      }
      if (LATIN.test(ch) && LATIN.test(prev[prev.length - 1])) {
        out[out.length - 1] = prev + ch; // ローマ字の単語は途中で割らない
        continue;
      }
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

    /*
     * 音をどの間隔で並べるか。
     *
     * **そのコールの長さ（何拍かけて言うか）を使う。** これは採譜した人が
     * 「読み上げ終えるまでにこれだけかかる」と記録した値で、勝手に決めてよいものではない。
     * 「ありがとう」は3.5拍、「ウォオッオッオッオー」は6拍かけて言う。
     * 全部を半拍で置くと、長いコールほど早口になって実際と合わなくなる。
     *
     * そのうえで、置く場所は目盛りに吸着させる（拍に乗っていることが見えるように）。
     * 長さが分からないときだけ、半拍を既定にする。
     */
    const spanSec = c.lenSec > 0 ? c.lenSec : (beatSec ?? 0.4) * 0.5 * units.length;
    const stepSec = spanSec / units.length;
    const startIdx = grid.length > 0 ? snapIndex(grid, c.t) : -1;
    let lastIdx = -1;
    const at = (i: number) => {
      const raw = c.t + i * stepSec;
      if (grid.length === 0) return raw;
      let idx = i === 0 ? startIdx : snapIndex(grid, raw);
      if (idx <= lastIdx) idx = lastIdx + 1; // 同じ目盛りに2つ重ねない
      idx = Math.min(idx, grid.length - 1);
      lastIdx = idx;
      return grid[idx].t;
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
