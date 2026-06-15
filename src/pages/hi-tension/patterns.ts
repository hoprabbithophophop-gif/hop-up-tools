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
  /** 曲のどこかを表す名前(hop指定 2026-06-13)。シェア文・予告バナーで使う */
  label: string;
  /** 結果一覧やステータスの狭い場所で使う短縮形 */
  shortLabel: string;
  bpm: number;
  steps: ChoreoStep[];
  /** videoId → そのパターンが始まる時刻(ms)の一覧 */
  startsByVideo: Record<string, number[]>;
};

// LIVE映像(mn1wkO0Ysbw)での出現位置。
const LIVE_A = [11563, 17757, 95176, 101369, 234531, 240724];
const LIVE_B = [76595, 82789, 147821, 154015, 215950, 222144];

// MV(WU-IF-cLPCY)はオケが同一音源なので、LIVEの位置＋定数オフセット。
// 仮置き+500msに対しhopが実機の微調整UIで「+200msがちょうど良い」と
// 確定(2026-06-13)したため +700ms に焼き込み済み。
// ※MV編集差(間奏カット等)があれば後半はズレる＝後半は要耳確認。
const MV_OFFSET_MS = 700;

// Stage Practice ver.(ZLs8GVsbEgY)もオケ同一音源なので、LIVEの位置＋定数オフセット。
// hop測定: 最初のラララの振りが Stage Practice 12.9s / LIVE 11.563s → 差 +1337ms（仮・実機の微調整UIで詰める）。
const STAGE_OFFSET_MS = 12900 - 11563;

export const PATTERNS: PracticePattern[] = [
  {
    key: "A",
    label: "ラララ〜のとこ",
    shortLabel: "ラララ",
    bpm: A_BPM,
    steps: A_STEPS,
    startsByVideo: {
      mn1wkO0Ysbw: LIVE_A,
      "WU-IF-cLPCY": LIVE_A.map(s => s + MV_OFFSET_MS),
      ZLs8GVsbEgY: LIVE_A.map(s => s + STAGE_OFFSET_MS),
    },
  },
  {
    key: "B",
    label: "1〜9のとこ",
    shortLabel: "1〜9",
    bpm: B_BPM,
    steps: B_STEPS,
    startsByVideo: {
      mn1wkO0Ysbw: LIVE_B,
      "WU-IF-cLPCY": LIVE_B.map(s => s + MV_OFFSET_MS),
      ZLs8GVsbEgY: LIVE_B.map(s => s + STAGE_OFFSET_MS),
    },
  },
];

// 練習に使える動画
export type PracticeVideo = { id: string; label: string };
export const PRACTICE_VIDEOS: PracticeVideo[] = [
  { id: "mn1wkO0Ysbw", label: "LIVE映像" },
  { id: "WU-IF-cLPCY", label: "MV" },
  { id: "ZLs8GVsbEgY", label: "Stage Practice" },
];

// 全出現に一律で掛ける時刻補正(ms)。タップデータ由来のズレを感じたらここで調整。
export const OFFSET_MS = 0;

// 初回に表示する説明文(hop指定 2026-06-13・文言そのまま・アレンジ禁止)。
export const INTRO_TEXT = "とりあえず右腕を動かす向きさえ\n身に付ければなんとかなる！…かも？";
