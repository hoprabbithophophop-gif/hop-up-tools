// パターンB（hop指定 2026-06-12・確定）
// BPM155・9カウント・合計8拍。カウント1〜6と9は4分音符(長さ1.0)、7・8は8分音符(0.5)。
// 判定はゾーン通過列方式(practiceEngine.ts)。

import type { ChoreoStep, ZoneId } from "./practiceEngine";

export const B_BPM = 155;

const trace = (zones: ZoneId[], lenBeats: number): ChoreoStep => ({ def: { kind: "trace", zones }, lenBeats });

export const B_STEPS: ChoreoStep[] = [
  trace(["UL"], 1),                         // 1 指1本のカウント開始位置
  trace(["UL", "UR"], 1),                   // 2
  trace(["UR", "ML"], 1),                   // 3
  trace(["ML", "MM"], 1),                   // 4
  trace(["MM", "LL"], 1),                   // 5
  trace(["LL", "LM", "MR", "UR", "UL"], 1), // 6 反時計回りに大きく回す軌道。終点は勢い重視で左上
  trace(["UL", "MR"], 0.5),                 // 7 倍速ここから
  trace(["MR", "UM"], 0.5),                 // 8
  trace(["UM", "UR"], 1),                   // 9 キメ
];
