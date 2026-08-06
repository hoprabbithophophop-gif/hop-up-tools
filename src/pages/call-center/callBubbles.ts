/**
 * コールを、画面に出す「吹き出し」の粒に割る。
 *
 * 「オイ！」のような短いコールは1つの吹き出しに収まるが、
 * 「ありがとう」のような長いコールを1つに詰めると読めない。
 * そこで長いものは声に出す単位（拍）ごとに割って、順番に並べる。
 *
 * 割る単位は文字ではなく「拍」にする。小さい「ゃゅょっ」や伸ばす「ー」、
 * 「！」は前の文字にくっついて1つの音になるため。
 * 「ウォオオッオ」なら ウォ／オ／オッ／オ の4つ。
 * ローマ字の連なり（Fu, BEYOOOOONDS）は途中で割らず1つの塊として扱う。
 */

export type CallBubble = {
  /** 曲の頭から何秒目か */
  t: number;
  text: string;
  /** 元は1つのコールで、それを割った2粒目以降か（見た目を弱めるのに使う） */
  cont: boolean;
};

/** 単独では音にならず、前の文字にくっつくもの */
const TRAILING = /[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮーｰ〜～!！?？♪、。]/;
const LATIN = /[A-Za-z0-9']/;

/** 1つの吹き出しにそのまま収める文字数の上限。これを超えたら割る */
const KEEP_WHOLE_CHARS = 3;

/** コール文を、声に出す単位（拍）へ割る。 */
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
 * コールの一覧を、画面に並べる吹き出しの粒へ広げる。
 *
 * @param calls 曲の秒で並んだコール
 * @param beatSec 1拍の長さ（秒）。分かっていれば半拍ずつ並べる。分からなければ長さを等分する
 */
export function toBubbles(
  calls: { t: number; lenSec: number; note: string }[],
  beatSec?: number,
): CallBubble[] {
  const out: CallBubble[] = [];
  for (const c of calls) {
    const text = c.note.trim();
    if (text === "") continue;
    if ([...text].length <= KEEP_WHOLE_CHARS) {
      out.push({ t: c.t, text, cont: false });
      continue;
    }
    const units = splitMora(text);
    if (units.length <= 1) {
      out.push({ t: c.t, text, cont: false });
      continue;
    }
    // 半拍ずつ並べる。ただし元の長さからはみ出すときは、その長さを等分する。
    let step = beatSec && beatSec > 0 ? beatSec / 2 : 0;
    if (step <= 0 || (c.lenSec > 0 && step * units.length > c.lenSec)) {
      step = c.lenSec > 0 ? c.lenSec / units.length : 0.2;
    }
    units.forEach((u, i) => out.push({ t: c.t + i * step, text: u, cont: i > 0 }));
  }
  return out.sort((a, b) => a.t - b.t);
}
