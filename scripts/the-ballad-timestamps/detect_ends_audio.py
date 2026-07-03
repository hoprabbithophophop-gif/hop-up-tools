#!/usr/bin/env python3
"""compareCalib.json の end を「音声が減衰しきって無音に落ちる点」で校正する。

detect_ends.py は黒フェード開始(black_start=暗転開始)を end にしていたが、映像の暗転は
歌の余韻より先行するため、最後のファルセットの伸ばしがぶつ切りになった。ここでは
ffmpeg silencedetect で余韻が無音へ落ちる点(silence_start)を検出して end にする。

黒フェード位置(_tbends/blacks.json)は「曲区間の絞り込み」に再利用（次曲頭より手前だけ探索）。
音声のみ再DL。anchor / startSec は書き換えない（end のみ更新）。

env:
  TB_WORK   … 作業ディレクトリ（既定: ./_tbends、blacks.json をここから読む）
  TB_IDS    … カンマ区切りで対象を絞る（任意）
  TB_NOISE  … 無音とみなす音量閾値（既定: -45dB。低いほど余韻を長く含める）
  TB_SILDUR … 無音の最小継続秒（既定: 0.4。短い休符で切らないため）
"""
import os, re, json, subprocess, glob

DATA = os.path.join("src", "data", "the-ballad")
CALIB = os.path.join(DATA, "compareCalib.json")
WORK = os.environ.get("TB_WORK", "./_tbends")
BLACKS = os.path.join(WORK, "blacks.json")
os.makedirs(WORK, exist_ok=True)

NOISE = os.environ.get("TB_NOISE", "-45dB")
SILDUR = float(os.environ.get("TB_SILDUR", "0.4"))
HEAD_MARGIN = 1.0  # anchor 直後の休符/演出を曲末と誤認しないため


def download_audio(vid):
    base = os.path.join(WORK, vid + "_a")
    subprocess.run(
        ["python", "-m", "yt_dlp", "-f", "ba/bestaudio/worst",
         "--no-warnings", "-o", base + ".%(ext)s",
         f"https://www.youtube.com/watch?v={vid}"],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    g = glob.glob(base + ".*")
    return g[0] if g else None


def silence_starts(path):
    p = subprocess.run(
        ["ffmpeg", "-i", path, "-af", f"silencedetect=noise={NOISE}:d={SILDUR}", "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    return sorted(float(m.group(1)) for m in re.finditer(r"silence_start:\s*([\d.]+)", p.stderr))


def cleanup(vid):
    for f in glob.glob(os.path.join(WORK, vid + "_a.*")):
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

    sil_by = {}
    for i, vid in enumerate(ids, 1):
        path = download_audio(vid)
        if not path:
            print(f"[{i}/{len(ids)}] {vid} 音声DL失敗（スキップ）")
            continue
        sil_by[vid] = silence_starts(path)
        cleanup(vid)
        print(f"[{i}/{len(ids)}] {vid} silences={len(sil_by[vid])}")

    with open(os.path.join(WORK, "silences.json"), "w", encoding="utf-8") as f:
        json.dump(sil_by, f, ensure_ascii=False, indent=2)

    updated, report = 0, []
    for c in cal:
        vid, a = c["videoId"], c["anchor"]
        sil = sil_by.get(vid)
        if sil is None:
            continue
        # 次のセパレータの black_end = 次曲頭（探索上限）
        nexts = [e for (s, e) in blacks_by.get(vid, []) if s > a + HEAD_MARGIN]
        upper = min(nexts) if nexts else None
        # anchor〜次曲頭 の範囲で「最後の無音開始」= 余韻が消えた点
        cands = [t for t in sil if t > a + HEAD_MARGIN and (upper is None or t <= upper + 0.3)]
        if not cands:
            continue
        new_end = round(max(cands), 2)
        old = c.get("end")
        report.append((vid, c["startSec"], old, new_end, upper))
        c["end"] = new_end
        updated += 1

    dump_calib(cal)
    print(f"\nend更新(音声): {updated}/{len(cal)}")
    for vid, st, old, ne, up in report:
        vs_black = f"  (黒fade明け {up} / 差 {ne - up:+.2f}s)" if up is not None else ""
        print(f"  {vid}@{st} end {old} -> {ne}{vs_black}")


if __name__ == "__main__":
    main()
