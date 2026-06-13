// パターンA（hop指定 2026-06-12・確定）
// BPM155・16ステップ・全ステップ長1.0拍。
// 判定はゾーン通過列方式(practiceEngine.ts)。
// 同一動作の繰り返しは定義の参照共有で持つ(判定状態はステップごとに別管理)。

import type { ChoreoStep, ZoneId } from "./practiceEngine";

export const A_BPM = 155;

// note = その動きのhopの呼び名(2026-06-13確定・アドバイスで使う)。
const trace = (zones: ZoneId[], lenBeats = 1, note?: string): ChoreoStep => ({ def: { kind: "trace", zones }, lenBeats, note });
const hold = (zone: ZoneId, lenBeats = 1, note?: string): ChoreoStep => ({ def: { kind: "hold", zone }, lenBeats, note });

const S_R_TO_L = trace(["UR", "UM", "UL"], 1, "ラララ"); // 右上→真上→左上
const S_L_TO_R = trace(["UL", "UM", "UR"], 1, "ラララ"); // 左上→真上→右上
const S_HOLD_UL = hold("UL", 1, "一拍ホールド");         // ホールド 左上
const PUSH = "ハイ！ハイ！";   // 突き出し×2
const WIGGLE = "ララララ！";   // 左上↔真上の小刻み

export const A_STEPS: ChoreoStep[] = [
  S_R_TO_L,            // 1
  S_L_TO_R,            // 2
  S_R_TO_L,            // 3  (1と同じ)
  S_HOLD_UL,           // 4
  S_L_TO_R,            // 5  (2と同じ)
  S_R_TO_L,            // 6  (1と同じ)
  // 7-8拍目: 突き出し×2(hop指定 2026-06-12: 8分音符で1ゾーンずつ)
  trace(["MM"], 0.5, PUSH),  // 7拍目表 中央
  trace(["UR"], 0.5, PUSH),  // 7拍目裏 右上(突き出し1回目)
  trace(["MM"], 0.5, PUSH),  // 8拍目表 いったん中央へ戻る
  trace(["UR"], 0.5, PUSH),  // 8拍目裏 右上(突き出し2回目)
  S_R_TO_L,            // 9  (1と同じ)
  S_L_TO_R,            // 10 (2と同じ)
  S_R_TO_L,            // 11 (1と同じ)
  // 12-13拍目(hop実機確認 2026-06-12): 細かい動きは8分音符で1ゾーンずつ
  // 切り替えて見せる(2ゾーンまとめると薄い側を見落とすため)
  trace(["UL"], 0.5, WIGGLE),  // 12拍目表
  trace(["UM"], 0.5, WIGGLE),  // 12拍目裏
  trace(["UL"], 0.5, WIGGLE),  // 13拍目表
  trace(["UM"], 0.5, WIGGLE),  // 13拍目裏
  trace(["UM"], 1, "ハイ！テンションのハイ！"),       // 14拍目 真上(頂点)
  trace(["UM", "MM"], 1, "ハイ！テンションのテン"),   // 15拍目 真上→中央(前に伸ばす)
  trace(["MM", "UR"], 1, "ハイ！テンションのション"), // 16拍目 中央→右上(キメ)
];

// 出現位置・動画一覧・説明文プレースホルダは patterns.ts に集約。
