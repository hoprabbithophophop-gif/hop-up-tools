import type { HiSession } from "./api";

// ハイ！テンションのBPM（hop指定）。LIVE/MVとも同曲なので全動画共通。
// LIVE映像も生バンドではなく音源（hop確認済み）＝テンポは一定。なので位相は曲全体で1つ
// （窓ごとの再推定は不要）。
export const HI_TENSION_BPM = 155;

const BUCKET_SEC = 0.05; // bucket_indices_20 の刻み（HandsCanvas と同じ）
const MIN_CROWD_TAPS = 200;     // 全体でこれ未満なら推定不能（データ不足＝判定を出さない）
const MIN_CONCENTRATION = 0.2;  // 円形平均の集中度ゲート。バラバラ＝位相情報なし（0..1）

/**
 * 自分の各タップの「最寄りの拍からのズレ」を求める。
 * 返り値: -0.5..+0.5（拍間隔に対する割合。負=拍より早い、正=遅い）。判定不能なら null。
 *
 * 拍グリッドの間隔は曲のBPM（=客観基準）から取り、グリッドの位置（位相）だけ
 * みんなのタップを拍間隔で折り畳んだ円形平均から推定する。
 * 「みんなの山＝正解」ではなく、みんなは目盛りの位置決めにだけ使う。
 * 曲の前後の空白（開始前・終了後）はみんなのタップの 0.5〜99.5 パーセンタイルで切る。
 */
export function analyzeBeatOffsets(
  sessions: HiSession[],
  selfTimestamps: number[],
  bpm: number = HI_TENSION_BPM,
): number[] | null {
  if (selfTimestamps.length === 0 || bpm <= 0) return null;
  const T = 60 / bpm; // 拍間隔（秒）

  // 全セッションのタップ時刻（秒）へ展開。古いビューは 0.1s 刻みを 0.05s スケールへ（HandsCanvasと同じ）。
  const crowd: number[] = [];
  for (const s of sessions) {
    const buckets = s.bucket_indices_20 ?? s.bucket_indices.map((b) => b * 2);
    for (const b of buckets) crowd.push(b * BUCKET_SEC + BUCKET_SEC / 2);
  }
  if (crowd.length < MIN_CROWD_TAPS) return null;

  // 曲の有効範囲（空白の除去）：外れ値に強いパーセンタイルで前後を切る。
  crowd.sort((a, b) => a - b);
  const lo = crowd[Math.floor(crowd.length * 0.005)];
  const hi = crowd[Math.min(crowd.length - 1, Math.ceil(crowd.length * 0.995))];
  if (hi - lo <= 0) return null;

  // 円形平均で位相を1つ推定：タップ時刻を拍間隔で折り畳み（角度化）、ベクトル和の向き＝拍頭。
  // ベクトル和の長さ/件数＝集中度（1=全タップが同位相、0=一様バラバラ）。低すぎたら判定を出さない。
  let sx = 0, sy = 0, cnt = 0;
  for (const t of crowd) {
    if (t < lo || t > hi) continue;
    const a = ((t % T) / T) * 2 * Math.PI;
    sx += Math.cos(a);
    sy += Math.sin(a);
    cnt++;
  }
  if (cnt < MIN_CROWD_TAPS) return null;
  if (Math.hypot(sx, sy) / cnt < MIN_CONCENTRATION) return null;
  const phase = ((Math.atan2(sy, sx) / (2 * Math.PI) + 1) % 1) * T; // 拍頭が T 周期のどこにあるか

  // 自分の各タップ：最寄りの拍からの符号付きズレへ。曲範囲外（空白）は対象外。
  const offsets: number[] = [];
  for (const t of selfTimestamps) {
    if (t < lo || t > hi) continue;
    let off = (((t - phase) % T) + T) % T;  // 0..T
    if (off > T / 2) off -= T;              // -T/2..T/2（負=早い、正=遅い）
    offsets.push(off / T);                  // 拍間隔に対する割合へ正規化
  }
  return offsets.length > 0 ? offsets : null;
}
