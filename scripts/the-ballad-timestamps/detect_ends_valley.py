#!/usr/bin/env python3
"""compareCalib.json の end を「音量エンベロープの谷（次曲イントロ直前）」で校正する。

silencedetect 版(detect_ends_audio.py)は無音区間の入り口(silence_start)で切っていたため、
余韻の減衰尾がぶつ切りになった。さらに谷が閾値(-55dB)に届かない版(加賀等)では余韻の
途中で切れていた。ここでは生PCMのRMSエンベロープを見て:
  終盤で減衰 → 谷(無音) → 次曲イントロが黒フェード中に立ち上がる
の「次曲イントロが立ち上がる直前」を end にする。余韻フル＋ループの瞬断が谷(無音)で
起きる＝ぶつ切りしない＋次曲も入らない。

黒フェード位置(_tbends/blacks.json)で曲の終盤範囲を絞る。音声のみ再DL。anchor/startSec不変。

env:
  TB_WORK    … 作業ディレクトリ(既定 ./_tbends、blacks.json をここから読む)
  TB_IDS     … カンマ区切りで対象を絞る(任意)
  TB_RECOVER … 次曲イントロとみなす復活閾値dB(既定 -45)
"""
import os, re, json, math, array, subprocess, glob

DATA = os.path.join("src", "data", "the-ballad")
CALIB = os.path.join(DATA, "compareCalib.json")
WORK = os.environ.get("TB_WORK", "./_tbends")
BLACKS = os.path.join(WORK, "blacks.json")
os.makedirs(WORK, exist_ok=True)

RECOVER = float(os.environ.get("TB_RECOVER", "-45"))  # これを超えたら次曲イントロとみなす
SR = 8000
WIN = 800  # 0.1s
TAIL = 5.5  # 曲終盤の探索窓(秒)


def download_audio(vid):
    base = os.path.join(WORK, vid + "_v")
    subprocess.run(
        ["python", "-m", "yt_dlp", "-f", "ba/bestaudio/worst", "--no-warnings",
         "-o", base + ".%(ext)s", f"https://www.youtube.com/watch?v={vid}"],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    g = glob.glob(base + ".*")
    return g[0] if g else None


def envelope(path, t0, t1):
    """[t0,t1] の 0.1s RMS エンベロープ [(t, dB), ...]。"""
    p = subprocess.run(
        ["ffmpeg", "-ss", str(t0), "-to", str(t1), "-i", path,
         "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
        capture_output=True)
    pcm = array.array("h")
    pcm.frombytes(p.stdout[: len(p.stdout) // 2 * 2])
    env = []
    for i in range(0, len(pcm) - WIN, WIN):
        s = 0
        for j in range(i, i + WIN):
            v = pcm[j]
            s += v * v
        db = 20 * math.log10(math.sqrt(s / WIN) / 32768 + 1e-9)
        env.append((round(t0 + i / SR, 3), db))
    return env


def find_end(env, upper):
    """曲末の谷(無音の底)を end にする。次曲イントロは黒フェード中に先行するので、
    谷底で止めれば余韻フル＋ループの瞬断が無音で起きる＋次曲は入らない。
    次曲イントロを狙って攻めると、検出が甘い版で次曲の頭が混入するため底で止める。"""
    if not env:
        return None
    # 次曲頭(black_end)より手前に絞り、次曲本体側の谷を拾わない
    cand = [e for e in env if upper is None or e[0] < upper - 0.05]
    if not cand:
        cand = env
    mn = min(cand, key=lambda e: e[1])
    return round(mn[0], 2)


def cleanup(vid):
    for f in glob.glob(os.path.join(WORK, vid + "_v.*")):
        try:
            os.remove(f)
        except OSError:
            pass


def dump_calib(cal):
    lines = ["["]
    for i, c in enumerate(cal):
        lines.append("  " + json.dumps(c, ensure_ascii=False) + ("," if i < len(cal) - 1 else ""))
    lines.append("]")
    with open(CALIB, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main():
    with open(CALIB, encoding="utf-8") as f:
        cal = json.load(f)
    blacks_by = json.load(open(BLACKS, encoding="utf-8")) if os.path.exists(BLACKS) else {}

    ids = sorted({c["videoId"] for c in cal})
    if os.environ.get("TB_IDS"):
        want = set(os.environ["TB_IDS"].split(","))
        ids = [v for v in ids if v in want]

    paths = {}
    for i, vid in enumerate(ids, 1):
        p = download_audio(vid)
        if not p:
            print(f"[{i}/{len(ids)}] {vid} 音声DL失敗")
            continue
        paths[vid] = p
        print(f"[{i}/{len(ids)}] {vid} ok")

    updated, report = 0, []
    for c in cal:
        vid, a = c["videoId"], c["anchor"]
        path = paths.get(vid)
        if not path:
            continue
        # 次のセパレータの black_end = 次曲頭(探索上限)
        nexts = [e for (s, e) in blacks_by.get(vid, []) if s > a + 1.0]
        upper = min(nexts) if nexts else None
        hi = (upper if upper is not None else a + 120) + 0.5
        lo = max(a + 2.0, hi - TAIL)
        env = envelope(path, lo, hi)
        new_end = find_end(env, upper)
        if new_end is None or new_end <= a:
            continue
        old = c.get("end")
        report.append((vid, c["startSec"], old, new_end, upper))
        c["end"] = new_end
        updated += 1

    for vid in paths:
        cleanup(vid)
    dump_calib(cal)
    print(f"\nend更新(谷): {updated}/{len(cal)}")
    for vid, st, old, ne, up in report:
        d = "" if old is None else f" ({ne - old:+.2f}s)"
        print(f"  {vid}@{st} end {old} -> {ne}{d}  次曲頭={up}")


if __name__ == "__main__":
    main()
