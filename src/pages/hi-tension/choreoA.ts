// パターンA（hop指定 2026-06-12・確定）
// BPM155・16ステップ・全ステップ長1.0拍。
// 判定はゾーン通過列方式(practiceEngine.ts)。
// 同一動作の繰り返しは定義の参照共有で持つ(判定状態はステップごとに別管理)。

import type { ChoreoStep, ZoneId } from "./practiceEngine";

export const A_BPM = 155;

const trace = (zones: ZoneId[], lenBeats = 1): ChoreoStep => ({ def: { kind: "trace", zones }, lenBeats });
const hold = (zone: ZoneId, lenBeats = 1): ChoreoStep => ({ def: { kind: "hold", zone }, lenBeats });

const S_R_TO_L = trace(["UR", "UM", "UL"]); // 右上→真上→左上
const S_L_TO_R = trace(["UL", "UM", "UR"]); // 左上→真上→右上
const S_HOLD_UL = hold("UL");               // ホールド 左上
const S_PUSH = trace(["MM", "UR"]);         // 中央→右上(突き出し)
const S_UL_UM = trace(["UL", "UM"]);        // 左上→真上

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
  S_UL_UM,             // 12 hop実機確認(2026-06-12): 12-13拍目は同じ振り×2
  S_UL_UM,             // 13 (旧仕様のホールド＋小刻みを置換)
  trace(["UM"]),       // 14 真上(頂点)
  trace(["UM", "MM"]), // 15 真上→中央(前に伸ばす動きの2D読み替え)
  trace(["MM", "UR"]), // 16 中央→右上(キメ)
];

// 出現位置・動画一覧・説明文プレースホルダは patterns.ts に集約。
