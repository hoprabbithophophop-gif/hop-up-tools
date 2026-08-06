/**
 * 動画の再生位置から「なめらかで、後戻りしない時計」を作る。
 *
 * YouTube に「いま何秒目？」と聞くと、返ってくる値は階段状にしか動かない
 * （0.1〜0.25秒ごとにまとめて進む）。毎コマそのまま使うと帯がカクつく。
 *
 * そこで、値が変わった瞬間だけ基準を取り直し、その間は実時計で進める。
 * 動画が止まっている間は進めない。シークしたときだけ即座に合わせ直す。
 *
 * 【この作りにした理由】
 * 前のやり方は、毎コマ「聞いた値」へ少しずつ寄せていた。ところが聞いた値は
 * 階段の途中では古いままなので、正しく先へ進んだ表示のほうが「ずれている」と
 * 判定され、後ろへ引き戻されていた。引き戻しが実時間の進みを上回ると、
 * 帯が一瞬だけ逆走する。これが「急に線が戻る」の正体だった。
 */

/** これ以上「聞いた値」が動かなければ、止まっている（一時停止・読み込み中）とみなす */
const STALL_MS = 400;
/** これ以上ずれていたら、途中で飛んだ（シーク）とみなして即合わせる */
const SEEK_SEC = 0.5;
/** ふだんのずれをどれだけ基準に反映するか。小さいほど表示が揺れない */
const PULL = 0.2;

export type PlayheadClock = (rawSec: number, perfMs: number) => number;

export function createPlayheadClock(): PlayheadClock {
  let anchorSec = -1; // 基準にした再生位置
  let anchorPerf = 0; // そのときの実時計
  let lastRaw = -1; // 前に聞いた値（変わったかを見るため）
  let lastChangePerf = 0; // 値が最後に動いた実時計
  let shown = -1; // 実際に見せている位置。ここより後ろへは戻さない

  return function read(rawSec: number, perfMs: number): number {
    if (anchorSec < 0) {
      anchorSec = rawSec;
      anchorPerf = perfMs;
      lastRaw = rawSec;
      lastChangePerf = perfMs;
      shown = rawSec;
      return rawSec;
    }

    const predicted = anchorSec + (perfMs - anchorPerf) / 1000;

    if (rawSec !== lastRaw) {
      lastRaw = rawSec;
      lastChangePerf = perfMs;
      const gap = rawSec - predicted;
      if (gap > SEEK_SEC || gap < -SEEK_SEC) {
        // 本当に飛んだ。ここだけは後ろへ戻ることを許す
        anchorSec = rawSec;
        anchorPerf = perfMs;
        shown = rawSec;
        return rawSec;
      }
      // ふだんは基準をそっと寄せるだけ。見せている位置は飛ばさない
      anchorSec = predicted + gap * PULL;
      anchorPerf = perfMs;
    } else if (perfMs - lastChangePerf > STALL_MS) {
      // 値が動かない＝止まっている。ここで進めるのをやめ、基準も置き直す
      anchorSec = rawSec;
      anchorPerf = perfMs;
      shown = Math.min(shown, rawSec);
      return rawSec;
    }

    const t = anchorSec + (perfMs - anchorPerf) / 1000;
    shown = t < shown ? shown : t; // ごく小さな後戻りは見せない
    return shown;
  };
}
