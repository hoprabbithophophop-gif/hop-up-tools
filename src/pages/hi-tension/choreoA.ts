// パターンA（hop指定 2026-06-12・確定）
// BPM155・16ステップ・全ステップ長1.0拍。
// 判定はゾーン通過列方式(practiceEngine.ts)。
// 同一動作の繰り返しは定義の参照共有で持つ(判定状態はステップごとに別管理)。

import type { ChoreoStep, ZoneId } from "./practiceEngine";

export const A_BPM = 155;

const trace = (zones: ZoneId[], lenBeats = 1): ChoreoStep => ({ def: { kind: "trace", zones }, lenBeats });
const hold = (zone: ZoneId, lenBeats = 1): ChoreoStep => ({ def: { kind: "hold", zone }, lenBeats });
const wiggle = (a: ZoneId, b: ZoneId, lenBeats = 1): ChoreoStep => ({ def: { kind: "wiggle", pair: [a, b] }, lenBeats });

const S_R_TO_L = trace(["UR", "UM", "UL"]); // 右上→真上→左上
const S_L_TO_R = trace(["UL", "UM", "UR"]); // 左上→真上→右上
const S_HOLD_UL = hold("UL");               // ホールド 左上
const S_PUSH = trace(["MM", "UR"]);         // 中央→右上(突き出し)

export const A_STEPS: ChoreoStep[] = [
  S_R_TO_L,            // 1
  S_L_TO_R,            // 2
  S_R_TO_L,            // 3  (1と同じ)
  S_HOLD_UL,           // 4
  S_L_TO_R,            // 5  (2と同じ)
  S_R_TO_L,            // 6  (1と同じ)
  S_PUSH,              // 7  突き出し1回目
  S_PUSH,              // 8  突き出し2回目(7の後いったん中央へ戻る)
  S_R_TO_L,            // 9  (1と同じ)
  S_L_TO_R,            // 10 (2と同じ)
  S_R_TO_L,            // 11 (1と同じ)
  S_HOLD_UL,           // 12 (4と同じ)
  wiggle("UL", "UM"),  // 13 小刻み 左上↔真上
  trace(["UM"]),       // 14 真上(頂点)
  trace(["UM", "MM"]), // 15 真上→中央(前に伸ばす動きの2D読み替え)
  trace(["MM", "UR"]), // 16 中央→右上(キメ)
];

// 練習に使える動画と、その動画内でパターンAが始まる時刻の一覧。
// phraseStartsMs はみんなのタップ・ヒートマップ(1156人/36万タップ)と
// 先頭フレーズ(11.563s)の正規化相互相関で検出し、BPM155の拍グリッドに
// スナップした値(2026-06-12)。構造=サビごとに2連続(16拍差)×3回。
// 最後の1箇所のみ相関0.67とやや低い(他は0.82〜0.97)＝要耳確認。
export type PracticeVideo = { id: string; label: string; phraseStartsMs: number[] };
export const PRACTICE_VIDEOS: PracticeVideo[] = [
  {
    id: "mn1wkO0Ysbw",
    label: "LIVE映像",
    phraseStartsMs: [11563, 17757, 95176, 101369, 234531, 240724],
  },
];

// 全出現に一律で掛ける時刻補正(ms)。タップデータ由来のズレを感じたらここで調整。
export const A_OFFSET_MS = 0;

// 初回に表示する説明文。文言はhopが書く(空文字の間はUIに出ない)。
export const INTRO_TEXT = "";
