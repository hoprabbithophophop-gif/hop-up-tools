#!/usr/bin/env python3
"""ある動画の中で、曲が何秒目から始まっているかを測る。

  python measure_offset.py <基準の音源> <合わせたい動画> [--first-beat 秒]

基準の音源＝骨組みを取った配信音源。合わせたい動画＝ライブ映像やMV。
どちらも音声ファイルか、YouTube の URL / 動画ID を渡せる。

【やり方】波形そのものは突き合わせない。ライブ映像は歌が生なので波形が一致しないため。
代わりに「音の強弱の移り変わり」を並べて、いちばん重なる位置を探す。
伴奏に同じ音源を使っていれば、歌が違っても強弱の山谷はそろう。

出力
  ずれ        基準の音源が、動画の何秒目から始まっているか
  重なり具合  1.0に近いほど確か。0.3を下回るときは信用しない
  0拍目       --first-beat を渡すと、その動画での曲の0拍目を計算して出す
"""
from __future__ import annotations

import argparse
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from analyze_song import decode_pcm, fetch_audio, looks_like_youtube  # noqa: E402

SR = 8000
HOP = 80          # 10ミリ秒ごとに1つ
MIN_SCORE = 0.30  # これを下回ったら信用しない


def envelope(path: Path) -> np.ndarray:
    """音の強弱の移り変わり（10ミリ秒ごと）。"""
    pcm = np.frombuffer(decode_pcm(path, SR).tobytes(), dtype=np.int16).astype(np.float32)
    n = len(pcm) // HOP
    frames = pcm[: n * HOP].reshape(n, HOP)
    rms = np.sqrt((frames ** 2).mean(axis=1) + 1e-9)
    env = np.log10(rms + 1.0)
    # 急な変化だけを見る（全体の音量差を打ち消すため）
    env = np.diff(env, prepend=env[0])
    env = np.clip(env, 0, None)          # 音が立ち上がる瞬間だけ残す
    return env


def normalize(x: np.ndarray) -> np.ndarray:
    x = x - x.mean()
    s = x.std()
    return x / s if s > 0 else x


def best_lag(base: np.ndarray, target: np.ndarray) -> tuple[int, float]:
    """base が target の何フレーム目から始まるか。"""
    a, b = normalize(target), normalize(base)
    n = 1 << (len(a) + len(b)).bit_length()
    corr = np.fft.irfft(np.fft.rfft(a, n) * np.conj(np.fft.rfft(b, n)), n)
    corr = corr[: len(a)]
    lag = int(np.argmax(corr))
    score = float(corr[lag] / math.sqrt(len(a) * len(b)))
    return lag, score


def resolve(arg: str, workdir: Path) -> tuple[Path, bool]:
    vid = looks_like_youtube(arg)
    if vid:
        audio, _ = fetch_audio(vid, workdir)
        return audio, True
    p = Path(arg).resolve()
    if not p.exists():
        raise SystemExit(f"ファイルが見つからない: {p}")
    return p, False


def main() -> None:
    ap = argparse.ArgumentParser(description="動画の中で曲が何秒目から始まるかを測る")
    ap.add_argument("base", help="基準の音源（骨組みを取ったもの）")
    ap.add_argument("target", help="合わせたい動画")
    ap.add_argument("--first-beat", type=float, default=None,
                    help="基準の音源での曲の0拍目（秒）")
    args = ap.parse_args()

    workdir = Path(tempfile.mkdtemp(prefix="offset-"))
    try:
        print("音声を用意中 …")
        bp, _ = resolve(args.base, workdir)
        tp, _ = resolve(args.target, workdir)

        print("強弱の移り変わりを取り出し中 …")
        be, te = envelope(bp), envelope(tp)
        print(f"  基準 {len(be) * HOP / SR:.1f}秒 / 相手 {len(te) * HOP / SR:.1f}秒")

        lag, score = best_lag(be, te)
        offset = lag * HOP / SR

        print()
        print(f"ずれ       : {offset:.3f} 秒")
        print(f"重なり具合 : {score:.3f}", end="")
        print("  ← 低い。信用しないこと" if score < MIN_SCORE else "  （0.3以上なら確か）")
        if args.first_beat is not None:
            print(f"0拍目      : {offset + args.first_beat:.3f} 秒"
                  f"（基準の {args.first_beat} 秒 ＋ ずれ）")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    main()
