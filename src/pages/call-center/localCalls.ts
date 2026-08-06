/**
 * 採譜したコールの、当面の置き場（この端末の中だけ）。
 *
 * 本来の置き場はデータベースの `calls` の棚だが、そこへ書き込むには
 * 匿名ログインが有効になっている必要があり、まだ有効になっていない。
 * それが済むまでの間、採譜した結果をこの端末に持っておいて、
 * 曲ページの帯にそのまま流せるようにしておく。
 *
 * 持ち方は「曲の時計で何秒目か」。動画ごとの秒ではないので、
 * 同じ曲の別の動画に切り替えても同じコールがそのまま乗る。
 */

export type LocalCall = {
  /** 曲の頭から何秒目か（動画の秒ではない） */
  t: number;
  /** 長さ（秒） */
  lenSec: number;
  note: string;
};

const keyOf = (slug: string) => `call-center:calls:${slug}`;

export function loadLocalCalls(slug: string): LocalCall[] {
  try {
    const raw = localStorage.getItem(keyOf(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is LocalCall => x && typeof x.t === "number" && typeof x.note === "string")
      .map((x) => ({ t: x.t, lenSec: typeof x.lenSec === "number" ? x.lenSec : 0.4, note: x.note }))
      .sort((a, b) => a.t - b.t);
  } catch {
    return []; // 壊れていたら無かったことにする（採譜のやり直しは効くが、画面は壊さない）
  }
}

export function saveLocalCalls(slug: string, calls: LocalCall[]): void {
  try {
    localStorage.setItem(keyOf(slug), JSON.stringify(calls));
  } catch {
    /* 端末の空きが無いときは黙って諦める。採譜ツール側の下書きは別に残っている */
  }
}
