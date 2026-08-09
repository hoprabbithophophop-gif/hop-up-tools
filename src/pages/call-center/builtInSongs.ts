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

export type BuiltInVideo = {
  videoId: string;
  /** この動画の何秒目が曲の頭か */
  offsetSec: number;
  label: string;
};

export type BuiltInSong = {
  slug: string;
  /** すでに棚（Supabase）に入っているか。入っていれば同梱データは使わない */
  inShelf?: boolean;
  title: string;
  groupName: string;
  bpm: number;
  videos: BuiltInVideo[];
  calls: LocalCall[];
};

const beatSec = 60 / ARIGATO_BEAT_BPM;

/**
 * 公式のコールレクチャー動画。コールが画面に出るので、この曲を知るならこちらが本命。
 *
 * ずれは既に測ってある。採譜はステージ練習の動画で取ってあり、レクチャーは
 * 同じ速さで頭出しだけ違う。最初のコールがレクチャーでは6.0秒（Hopが実測）で、
 * そこから1拍ぶん後ろに寄せると全体が合う——というのがコール練習ツールでの結論。
 * ここでも同じ値をそのまま使う。
 */
const LECTURE_VIDEO = "xr7_Z5ibZMA";
const LECTURE_FIRST_CALL_SEC = 6.0;

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

/**
 * （）で囲まれたものはコールではない。
 * レクチャー動画で言っていた心掛けや合いの手（「（かわいく）」など）なので、
 * 集約センターには載せない。コール練習ツールでも出題対象から外している。
 */
const isNotACall = (note: string) => /^[（(]/.test(note.trim());

export const BUILT_IN_SONGS: BuiltInSong[] = [
  {
    slug: "arigato-beat",
    // 2026-08-09 に棚へ入った。ここは記録として残すが、画面はもう棚から読む
    inShelf: true,
    title: "ありがとビート",
    groupName: "BEYOOOOONDS",
    bpm: ARIGATO_BEAT_BPM,
    videos: [
      {
        videoId: LECTURE_VIDEO,
        offsetSec: LECTURE_FIRST_CALL_SEC - ARIGATO_BEAT_CALLS[0].t + beatSec,
        label: "コールレクチャー",
      },
      { videoId: ARIGATO_BEAT_VIDEO, offsetSec: 0, label: "Stage Practice ver." },
    ],
    calls: ARIGATO_BEAT_CALLS.filter((c) => !isNotACall(c.note)).map((c) => ({
      t: c.t,
      lenSec: Math.round(c.lenBeats * beatSec * 1000) / 1000,
      note: SPLIT_FIX[c.note] ?? c.note,
    })),
  },
];

export function findBuiltInSong(slug: string): BuiltInSong | undefined {
  return BUILT_IN_SONGS.find((s) => s.slug === slug);
}
