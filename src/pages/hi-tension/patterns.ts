// 振り練習のパターン一覧と、動画ごとの出現位置。
// 出現位置はみんなのタップ・ヒートマップ(1156人/36万タップ)との
// 正規化相互相関で検出し、BPM155の拍グリッドにスナップした値(2026-06-12)。
// - パターンA: 先頭フレーズ(11.563s)を型紙に検出。サビごとに2連続(16拍差)×3回。
//   最後の1箇所のみ相関0.67とやや低い(他は0.82〜0.97)＝要耳確認。
// - パターンB: 「4分×6＋8分×2＋キメ」の合成リズムテンプレートで検出。
//   2連続(16拍差)×2組(相関0.82〜0.96)。3組目(3:36〜)はhopの耳情報
//   (直前4拍からのタップ渋滞で自動検出が埋もれた)→拍スナップ後に
//   相関0.96/0.98で裏取り済み。テロップは振りより気持ち早く出る(hop確認)。

import type { ChoreoStep } from "./practiceEngine";
import { A_STEPS, A_BPM } from "./choreoA";
import { B_STEPS, B_BPM } from "./choreoB";

export type PracticePattern = {
  key: string;
  label: string;
  bpm: number;
  steps: ChoreoStep[];
  /** videoId → そのパターンが始まる時刻(ms)の一覧 */
  startsByVideo: Record<string, number[]>;
};

export const PATTERNS: PracticePattern[] = [
  {
    key: "A",
    label: "パターンA",
    bpm: A_BPM,
    steps: A_STEPS,
    startsByVideo: {
      mn1wkO0Ysbw: [11563, 17757, 95176, 101369, 234531, 240724],
    },
  },
  {
    key: "B",
    label: "パターンB",
    bpm: B_BPM,
    steps: B_STEPS,
    startsByVideo: {
      mn1wkO0Ysbw: [76595, 82789, 147821, 154015, 215950, 222144],
    },
  },
];

// 練習に使える動画
export type PracticeVideo = { id: string; label: string };
export const PRACTICE_VIDEOS: PracticeVideo[] = [
  { id: "mn1wkO0Ysbw", label: "LIVE映像" },
];

// 全出現に一律で掛ける時刻補正(ms)。タップデータ由来のズレを感じたらここで調整。
export const OFFSET_MS = 0;

// 初回に表示する説明文。文言はhopが書く(空文字の間はUIに出ない)。
export const INTRO_TEXT = "";
