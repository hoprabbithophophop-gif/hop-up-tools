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

export const A_STEPS: ChoreoStep[] = [
  S_R_TO_L,            // 1
  S_L_TO_R,            // 2
  S_R_TO_L,            // 3  (1と同じ)
  S_HOLD_UL,           // 4
  S_L_TO_R,            // 5  (2と同じ)
  S_R_TO_L,            // 6  (1と同じ)
  // 7-8拍目: 突き出し×2(hop指定 2026-06-12: 8分音符で1ゾーンずつ)
  trace(["MM"], 0.5),  // 7拍目表 中央
  trace(["UR"], 0.5),  // 7拍目裏 右上(突き出し1回目)
  trace(["MM"], 0.5),  // 8拍目表 いったん中央へ戻る
  trace(["UR"], 0.5),  // 8拍目裏 右上(突き出し2回目)
  S_R_TO_L,            // 9  (1と同じ)
  S_L_TO_R,            // 10 (2と同じ)
  S_R_TO_L,            // 11 (1と同じ)
  // 12-13拍目(hop実機確認 2026-06-12): 細かい動きは8分音符で1ゾーンずつ
  // 切り替えて見せる(2ゾーンまとめると薄い側を見落とすため)
  trace(["UL"], 0.5),  // 12拍目表
  trace(["UM"], 0.5),  // 12拍目裏
  trace(["UL"], 0.5),  // 13拍目表
  trace(["UM"], 0.5),  // 13拍目裏
  trace(["UM"]),       // 14拍目 真上(頂点)
  trace(["UM", "MM"]), // 15拍目 真上→中央(前に伸ばす動きの2D読み替え)
  trace(["MM", "UR"]), // 16拍目 中央→右上(キメ)
];

// 出現位置・動画一覧・説明文プレースホルダは patterns.ts に集約。
