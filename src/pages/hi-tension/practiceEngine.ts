// 振りコピ判定エンジン（ゾーン通過列方式）
//
// パッドを3×3の9ゾーンに分割し、画面に付けたままなぞる指の
// 「ゾーン通過列」でステップ達成を判定する。スワイプ方向判定ではない。
// ゾーン境界にはヒステリシス（一度入ったゾーンは境界+マージンを越えるまで
// 出ない）を持たせ、境界ジッタによる多重カウントを防ぐ。
//
// 判定タイプは3種:
//   trace  = 指定チェックポイント(ゾーン)を順に通過
//   hold   = ステップの間、指定ゾーンから出ない
//   wiggle = 指定ゾーン間の跨ぎがN回以上
//
// タイミング: 各ステップが個別の長さ(拍数・小数可)を持つ。
// 判定ウィンドウはステップ長に比例して前後に広がる(下限ありで
// 短いステップほど相対的に広くなる)。閾値は全部 TUNING で調整可能。

export type ZoneId = "UL" | "UM" | "UR" | "ML" | "MM" | "MR" | "LL" | "LM" | "LR";

export const ZONE_LABEL: Record<ZoneId, string> = {
  UL: "左上", UM: "真上", UR: "右上",
  ML: "中段左", MM: "中央", MR: "中段右",
  LL: "左下", LM: "真ん中下", LR: "右下",
};

const GRID: ZoneId[][] = [
  ["UL", "UM", "UR"],
  ["ML", "MM", "MR"],
  ["LL", "LM", "LR"],
];

const ZONE_POS: Record<ZoneId, { row: number; col: number }> = {
  UL: { row: 0, col: 0 }, UM: { row: 0, col: 1 }, UR: { row: 0, col: 2 },
  ML: { row: 1, col: 0 }, MM: { row: 1, col: 1 }, MR: { row: 1, col: 2 },
  LL: { row: 2, col: 0 }, LM: { row: 2, col: 1 }, LR: { row: 2, col: 2 },
};

export const TUNING = {
  /** ゾーン境界ヒステリシス幅(パッド一辺=1に対する比) */
  hysteresis: 0.04,
  /** 判定ウィンドウの前後拡張(ステップ長に対する比) */
  windowCoef: 0.25,
  /** ウィンドウ拡張の下限(ms)。短いステップを相対的に広めにする */
  windowMinMs: 120,
  /** ホールド判定でステップ端を免除する割合(ステップ長比) */
  holdSlackCoef: 0.15,
  /** 小刻み(wiggle)の既定跨ぎ回数N */
  wiggleDefaultN: 2,
};

export type Tuning = typeof TUNING;

/** x,y(0..1) が属するゾーン(ヒステリシスなしの素の判定) */
export function zoneAt(x: number, y: number): ZoneId {
  const c = Math.min(2, Math.max(0, Math.floor(x * 3)));
  const r = Math.min(2, Math.max(0, Math.floor(y * 3)));
  return GRID[r][c];
}

/** ゾーンの矩形(0..1座標) */
export function zoneRect(z: ZoneId): { x0: number; y0: number; x1: number; y1: number } {
  const { row, col } = ZONE_POS[z];
  return { x0: col / 3, y0: row / 3, x1: (col + 1) / 3, y1: (row + 1) / 3 };
}

/** ヒステリシス付きゾーン判定。current の矩形を h だけ広げた範囲内なら留まる */
export function nextZone(current: ZoneId | null, x: number, y: number, h: number): ZoneId {
  if (current) {
    const r = zoneRect(current);
    if (x >= r.x0 - h && x <= r.x1 + h && y >= r.y0 - h && y <= r.y1 + h) return current;
  }
  return zoneAt(x, y);
}

// ---- 振りデータ ----

export type StepDef =
  | { kind: "trace"; zones: ZoneId[] }
  | { kind: "hold"; zone: ZoneId }
  | { kind: "wiggle"; pair: [ZoneId, ZoneId]; minCrossings?: number };

export type ChoreoStep = { def: StepDef; lenBeats: number };

/** ステップ表示用の説明(ゾーン名の列。文言はデータから機械生成) */
export function stepText(def: StepDef, tuning: Tuning): string {
  if (def.kind === "trace") return def.zones.map(z => ZONE_LABEL[z]).join("→");
  if (def.kind === "hold") return `ホールド ${ZONE_LABEL[def.zone]}`;
  const n = def.minCrossings ?? tuning.wiggleDefaultN;
  return `小刻み ${ZONE_LABEL[def.pair[0]]}↔${ZONE_LABEL[def.pair[1]]} ×${n}`;
}

// ---- タイムライン ----

export type TimedStep = {
  def: StepDef;
  /** ステップ本来の区間(フレーズ先頭からの相対ms) */
  startMs: number;
  endMs: number;
  /** 判定ウィンドウ(前後に拡張した区間) */
  winStartMs: number;
  winEndMs: number;
  /** hold用: 端を免除した監視区間 */
  holdStartMs: number;
  holdEndMs: number;
};

export function buildTimeline(steps: ChoreoStep[], bpm: number, tuning: Tuning): TimedStep[] {
  const beatMs = 60000 / bpm;
  const out: TimedStep[] = [];
  let t = 0;
  for (const s of steps) {
    const len = s.lenBeats * beatMs;
    const ext = Math.max(len * tuning.windowCoef, tuning.windowMinMs);
    const slack = len * tuning.holdSlackCoef;
    out.push({
      def: s.def,
      startMs: t,
      endMs: t + len,
      winStartMs: t - ext,
      winEndMs: t + len + ext,
      holdStartMs: t + slack,
      holdEndMs: t + len - slack,
    });
    t += len;
  }
  return out;
}

/** フレーズ全長(ms) */
export function phraseLenMs(steps: ChoreoStep[], bpm: number): number {
  const beatMs = 60000 / bpm;
  return steps.reduce((sum, s) => sum + s.lenBeats * beatMs, 0);
}

// ---- 判定 ----

export type StepResult = "pending" | "ok" | "miss";

export type StepState = {
  result: StepResult;
  /** trace: 次に通過すべきチェックポイントのindex */
  traceIdx: number;
  /** wiggle: これまでの跨ぎ回数 */
  crossings: number;
  /** hold: 監視区間中にゾーン外へ出たか */
  holdViolated: boolean;
  /** ウィンドウ中に一度でも指が付いていたか */
  touched: boolean;
};

const freshState = (): StepState => ({
  result: "pending", traceIdx: 0, crossings: 0, holdViolated: false, touched: false,
});

export class ChoreoJudge {
  readonly timeline: TimedStep[];
  states: StepState[];
  private tuning: Tuning;
  private lastZone: ZoneId | null = null;
  private lastT = -Infinity;

  constructor(timeline: TimedStep[], tuning: Tuning) {
    this.timeline = timeline;
    this.tuning = tuning;
    this.states = timeline.map(freshState);
  }

  reset() {
    this.states = this.timeline.map(freshState);
    this.lastZone = null;
    this.lastT = -Infinity;
  }

  /**
   * 毎フレーム呼ぶ。tMs=フレーズ先頭からの相対時刻、zone=現在ゾーン(指が離れていればnull)。
   * ゾーンの「入り」イベントは最も早いpendingステップが1つだけ消費する
   * (同一動作が連続するステップ同士のウィンドウ重なりで二重カウントしないため)。
   */
  update(tMs: number, zone: ZoneId | null) {
    const entered = zone !== null && zone !== this.lastZone ? zone : null;
    const from = entered ? this.lastZone : null;
    let entryConsumed = false;

    for (let i = 0; i < this.timeline.length; i++) {
      const s = this.timeline[i];
      const st = this.states[i];
      if (st.result !== "pending") continue;
      if (tMs < s.winStartMs) break; // timelineは時刻順なので以降も未到達

      // ウィンドウ終了 → 確定
      if (tMs > s.winEndMs) {
        st.result = this.finalize(s, st);
        continue;
      }

      if (zone) st.touched = true;

      // ウィンドウが今フレームで開いた瞬間、既に最初のチェックポイントに
      // 指が乗っていれば通過扱い(ホールド明け等で動かず始まるケース)
      if (
        s.def.kind === "trace" && st.traceIdx === 0 && zone &&
        this.lastT < s.winStartMs && tMs >= s.winStartMs &&
        zone === s.def.zones[0]
      ) {
        st.traceIdx = 1;
        if (st.traceIdx >= s.def.zones.length) st.result = "ok";
      }

      switch (s.def.kind) {
        case "trace": {
          if (st.result === "pending" && entered && !entryConsumed && entered === s.def.zones[st.traceIdx]) {
            st.traceIdx++;
            entryConsumed = true;
            if (st.traceIdx >= s.def.zones.length) st.result = "ok";
          }
          break;
        }
        case "hold": {
          if (tMs >= s.holdStartMs && tMs <= s.holdEndMs) {
            if (zone && zone !== s.def.zone) st.holdViolated = true;
          }
          if (tMs > s.holdEndMs) {
            st.result = st.touched && !st.holdViolated ? "ok" : "miss";
          }
          break;
        }
        case "wiggle": {
          if (entered && !entryConsumed && from) {
            const [a, b] = s.def.pair;
            const crossed = (from === a && entered === b) || (from === b && entered === a);
            if (crossed) {
              st.crossings++;
              entryConsumed = true;
              const n = s.def.minCrossings ?? this.tuning.wiggleDefaultN;
              if (st.crossings >= n) st.result = "ok";
            }
          }
          break;
        }
      }
    }

    this.lastZone = zone;
    this.lastT = tMs;
  }

  private finalize(s: TimedStep, st: StepState): StepResult {
    if (s.def.kind === "hold") return st.touched && !st.holdViolated ? "ok" : "miss";
    return "miss";
  }
}
