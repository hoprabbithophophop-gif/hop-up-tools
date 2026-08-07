import {
  ARIGATO_BEAT_BPM,
  ARIGATO_BEAT_CALLS,
  ARIGATO_BEAT_VIDEO,
} from "../hi-tension/arigatoBeatCalls";
import type { LocalCall } from "./localCalls";

/**
 * 棚に入れる前の曲を、アプリに同梱したまま見られるようにするための置き場。
 *
 * ありがとビートは、コール練習ツールのために既に採譜が済んでいる（109件）。
 * これを棚に入れるかどうかはまだ承認待ちなので、それまでの間、
 * リポジトリの中にあるデータをそのまま曲ページで開けるようにしておく。
 *
 * 棚に入れたら、この置き場からは外す。
 */

export type BuiltInSong = {
  slug: string;
  title: string;
  groupName: string;
  bpm: number;
  /** 見る動画。採譜の秒はこの動画のものなので、ずれは0 */
  videoId: string;
  videoLabel: string;
  calls: LocalCall[];
};

const beatSec = 60 / ARIGATO_BEAT_BPM;

/**
 * 音の切れ目の直し。
 *
 * 機械の見当では「おー／る／ぼ／ざ／わー」になるが、実際に叫ぶリズムは
 * 「おーる／ぼざ／わー」。単語の切れ目は文字だけからは分からないので、
 * 区切りを書いて示す（空白を入れた所で切れる）。
 *
 * ここで直すのは集約センターの表示だけ。公開中のコール練習クイズが使う
 * 元データには手を入れない。
 */
const SPLIT_FIX: Record<string, string> = {
  "おーるぼざわー": "おーる ぼざ わー",
};

export const BUILT_IN_SONGS: BuiltInSong[] = [
  {
    slug: "arigato-beat",
    title: "ありがとビート",
    groupName: "BEYOOOOONDS",
    bpm: ARIGATO_BEAT_BPM,
    videoId: ARIGATO_BEAT_VIDEO,
    videoLabel: "Stage Practice ver.",
    calls: ARIGATO_BEAT_CALLS.map((c) => ({
      t: c.t,
      lenSec: Math.round(c.lenBeats * beatSec * 1000) / 1000,
      note: SPLIT_FIX[c.note] ?? c.note,
    })),
  },
];

export function findBuiltInSong(slug: string): BuiltInSong | undefined {
  return BUILT_IN_SONGS.find((s) => s.slug === slug);
}
