// Virtual Video Time (VVT) — 専門家提案によるレイヤー分離型同期の論理層。
// YouTube プレイヤーの実時間（actual）はバッファリング・コマ落ち等でガタつくため、
// performance.now() で滑らかに進む内部時計（VVT）を持ち、actual との乖離を緩やかに
// 線形補正する。これにより HandsCanvas（✋描画）は動画のガタつきに振り回されず
// 滑らかに進行し、第3段階で✋同期を VVT 基準にすることで端末間の完璧なシンクロを
// 実現する基盤になる。
//
// 仕組み:
//   - anchor.t0（サーバー時刻）を全端末共通の「曲開始ゼロ地点」として VVT を初期化
//   - 毎フレーム VVT を等倍速で進める
//   - actual との乖離 diff = actual - VVT を計算
//   - |diff| < 30ms: 補正なし（デッドバンド）
//   - 30ms 〜 1.5s: r = clamp(diff * 0.2, -0.05, 0.05) で緩やかに引き寄せ（最大 ±5%/秒）
//   - |diff| > 1.5s: 強制ジャンプ（VVT = actual）でリセット
//   - PLAYING 開始から 1.5 秒は grace 期間として補正無効
//   - dt > 1.0 秒（タブ切り替え戻り等）は強制ジャンプで wall time に追いつく

export class VirtualVideoTimeKeeper {
  private vvt: number = 0;              // 現在のVVT（秒）
  private lastTickTime: number = 0;     // 前回の performance.now()（ミリ秒）
  private isActive: boolean = false;
  private playStartedTime: number = 0;  // start() を呼んだ時刻（ミリ秒）
  private anchorT0: number = 0;         // 基準となったサーバー時刻（ミリ秒）
  private clockOffset: number = 0;      // サーバー時刻とのオフセット（ミリ秒）

  private readonly MAX_CORRECTION_RATE = 0.05; // 秒間最大 50ms 補正（5%）
  private readonly GRACE_DURATION_MS = 1500;   // 開始 1.5 秒は補正無効
  private readonly JUMP_THRESHOLD_SEC = 1.5;   // 1.5 秒以上のズレは強制ジャンプ
  private readonly DEAD_BAND_SEC = 0.03;       // 30ms 以内のズレは補正しない
  private readonly TAB_RESUME_DT_SEC = 1.0;    // dt がこれを超えたらタブ復帰と判定

  /** 再生開始時に呼ぶ。anchor.t0（サーバー時刻 ms）からの経過時間を初期 VVT にする。 */
  start(anchorT0: number, clockOffset: number) {
    this.anchorT0 = anchorT0;
    this.clockOffset = clockOffset;
    const now = performance.now();
    this.lastTickTime = now;
    this.playStartedTime = now;
    this.isActive = true;
    const currentGlobalTime = Date.now() + this.clockOffset;
    this.vvt = Math.max(0, (currentGlobalTime - this.anchorT0) / 1000);
  }

  stop() {
    this.isActive = false;
  }

  isRunning(): boolean {
    return this.isActive;
  }

  /** 毎フレーム呼び出し。actualTime（=player.getCurrentTime()）を渡す。
   *  player が未準備（actualTime <= 0）の場合は補正をスキップして等倍自走のみ。 */
  update(actualTime: number): number {
    if (!this.isActive) return this.vvt;

    const now = performance.now();
    const dt = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;

    // タブ復帰等で dt が極端に大きい場合は wall time に強制ジャンプ
    if (dt > this.TAB_RESUME_DT_SEC) {
      const currentGlobalTime = Date.now() + this.clockOffset;
      this.vvt = Math.max(0, (currentGlobalTime - this.anchorT0) / 1000);
      return this.vvt;
    }

    // 1. 等倍自走
    this.vvt += dt;

    // PLAYING 開始から GRACE_DURATION_MS 内は補正無効
    if (now - this.playStartedTime < this.GRACE_DURATION_MS) {
      return this.vvt;
    }

    // actualTime が無効（player 未準備 / buffering で 0）なら補正スキップ
    if (actualTime <= 0) {
      return this.vvt;
    }

    // 2. 乖離計算
    const diff = actualTime - this.vvt;
    const absDiff = Math.abs(diff);

    // 3. 補正量決定
    if (absDiff > this.JUMP_THRESHOLD_SEC) {
      // 致命的なズレは強制ジャンプ
      this.vvt = actualTime;
    } else if (absDiff > this.DEAD_BAND_SEC) {
      // 緩やかな線形補正（diff の 20% を目標、最大 ±5%/秒でクランプ）
      const targetRate = diff * 0.2;
      const correctionRate = Math.min(
        this.MAX_CORRECTION_RATE,
        Math.max(-this.MAX_CORRECTION_RATE, targetRate),
      );
      this.vvt += correctionRate * dt;
    }

    return this.vvt;
  }

  getVVT(): number {
    return this.vvt;
  }
}
