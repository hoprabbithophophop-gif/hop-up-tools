#!/usr/bin/env python3
"""compareCalib.json の各版に end（曲の実終端）を黒フェードから付与する。

detect.py は黒フェード「明け」(black_end)＝曲頭しか出さず、compareCalib の end は
「次曲の登録 startSec」を流用していたため、聴き比べの末尾に次曲が食い込んでいた。
ここでは対象動画を再解析して黒フェード「開始」(black_start)＝曲の終わりを取り、
各版の end = anchor より後の最初の black_start に更新する。

Supabase 不要（対象 videoId は compareCalib.json から取得）。DL→blackdetect→削除。
anchor / startSec は書き換えない（end のみ更新・差分最小）。

env:
  TB_WORK … 一時DLディレクトリ（既定: ./_tbends）
  TB_IDS  … カンマ区切りで対象を絞る（任意・既定は compareCalib 全 videoId）
"""
import os, re, json, subprocess, glob

DATA = os.path.join("src", "data", "the-ballad")
CALIB = os.path.join(DATA, "compareCalib.json")
WORK = os.environ.get("TB_WORK", "./_tbends")
os.makedirs(WORK, exist_ok=True)

# anchor 直後の演出黒を曲終端と誤認しないためのマージン（秒）
HEAD_MARGIN = 1.0


def blackdetect(path):
    """detect.py と同一パラメータ。 (black_start, black_end) のリストを返す。"""
    p = subprocess.run(
        ["ffmpeg", "-i", path, "-vf", "blackdetect=d=0.15:pix_th=0.10", "-an", "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = []
    for m in re.finditer(r"black_start:([\d.]+)\s+black_end:([\d.]+)", p.stderr):
        out.append((float(m.group(1)), float(m.group(2))))
    return out


def download(vid):
    base = os.path.join(WORK, vid)
    subprocess.run(
        ["python", "-m", "yt_dlp",
         "-f", "bv*[height<=360][ext=mp4]+ba/b[height<=360]/worst",
         "--no-warnings", "-o", base + ".%(ext)s",
         f"https://www.youtube.com/watch?v={vid}"],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    for ext in (".mp4", ".mkv", ".webm"):
        if os.path.exists(base + ext):
            return base + ext
    return None


def cleanup(vid):
    for f in glob.glob(os.path.join(WORK, vid + ".*")):
        try:
            os.remove(f)
        except OSError:
            pass


def dump_calib(cal):
    """元の「1要素1行」整形を保って書き出す（差分を end の値だけに留める）。"""
    lines = ["["]
    for i, c in enumerate(cal):
        comma = "," if i < len(cal) - 1 else ""
        lines.append("  " + json.dumps(c, ensure_ascii=False) + comma)
    lines.append("]")
    with open(CALIB, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main():
    with open(CALIB, encoding="utf-8") as f:
        cal = json.load(f)

    ids = sorted({c["videoId"] for c in cal})
    if os.environ.get("TB_IDS"):
        want = set(os.environ["TB_IDS"].split(","))
        ids = [v for v in ids if v in want]

    blacks_by = {}
    for i, vid in enumerate(ids, 1):
        path = download(vid)
        if not path:
            print(f"[{i}/{len(ids)}] {vid} DL失敗（スキップ）")
            continue
        bl = blackdetect(path)
        blacks_by[vid] = [[round(s, 2), round(e, 2)] for s, e in bl]
        cleanup(vid)
        print(f"[{i}/{len(ids)}] {vid} blacks={len(bl)}")

    # 監査用に生の黒フェード区間を残す
    with open(os.path.join(WORK, "blacks.json"), "w", encoding="utf-8") as f:
        json.dump(blacks_by, f, ensure_ascii=False, indent=2)

    # end 更新: anchor より後（+HEAD_MARGIN）の最初の black_start
    updated, skipped = 0, []
    for c in cal:
        bl = blacks_by.get(c["videoId"])
        if not bl:
            continue
        cands = [s for (s, e) in bl if s > c["anchor"] + HEAD_MARGIN]
        if cands:
            new_end = round(min(cands), 2)
            old = c.get("end")
            c["end"] = new_end
            delta = "" if old is None else f" (旧 {old} → {new_end}, {new_end - old:+.2f}s)"
            print(f"  {c['videoId']}@{c['startSec']} end={new_end}{delta}")
            updated += 1
        else:
            # anchor 以降に黒フェードなし＝動画末尾までがこの曲（最後の曲）
            skipped.append(f"{c['videoId']}@{c['startSec']}")

    dump_calib(cal)
    print(f"\nend更新: {updated}/{len(cal)}  末尾曲/黒無し: {len(skipped)} {skipped}")


if __name__ == "__main__":
    main()
