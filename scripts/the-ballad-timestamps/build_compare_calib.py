#!/usr/bin/env python3
"""聴き比べ対象(同一曲でソロ2版以上)を全曲 compareCalib.json 化する。

anchor = detect.jsonl の黒フェード明け(black_end=曲頭・小数)を流用、
end     = 音声RMSエンベロープの谷(次曲イントロ直前の無音底、detect_ends_valley と同方式)。
既存 compareCalib の版(4曲の精密anchor)は保持し、未校正曲だけ追加する。
Supabase不要・音声のみDL。全員曲(member=="全員")は聴き比べ対象外なので除外。

env:
  TB_WORK   … 作業ディレクトリ(既定 ./_tbcalib)
  TB_IDS    … videoId カンマ区切りで対象を絞る(検証用)
  TB_LIMIT  … 先頭N動画だけ処理(検証用)
"""
import os, re, json, math, array, subprocess, glob

DATA = os.path.join("src", "data", "the-ballad")
CALIB = os.path.join(DATA, "compareCalib.json")
DETECT = os.path.join("scripts", "the-ballad-timestamps", "detect.jsonl")
WORK = os.environ.get("TB_WORK", "./_tbcalib")
os.makedirs(WORK, exist_ok=True)
SR, WIN, TAIL = 8000, 800, 5.5


def dl(vid):
    base = os.path.join(WORK, vid)
    subprocess.run(
        ["python", "-m", "yt_dlp", "-f", "ba/bestaudio/worst", "--no-warnings",
         "-o", base + ".%(ext)s", f"https://www.youtube.com/watch?v={vid}"],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    g = glob.glob(base + ".*")
    return g[0] if g else None


def envelope(path, t0, t1):
    p = subprocess.run(
        ["ffmpeg", "-ss", str(t0), "-to", str(t1), "-i", path,
         "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"], capture_output=True)
    pcm = array.array("h")
    pcm.frombytes(p.stdout[: len(p.stdout) // 2 * 2])
    env = []
    for i in range(0, len(pcm) - WIN, WIN):
        s = 0
        for j in range(i, i + WIN):
            v = pcm[j]
            s += v * v
        env.append((round(t0 + i / SR, 3), 20 * math.log10(math.sqrt(s / WIN) / 32768 + 1e-9)))
    return env


def ffprobe_duration(path):
    p = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True)
    try:
        return float(p.stdout.strip())
    except ValueError:
        return None


def valley_end(path, anchor, upper):
    if upper is not None:
        hi = upper + 0.5
    else:
        dur = ffprobe_duration(path)  # 末尾曲は動画末尾までを探索範囲に
        hi = dur if dur else anchor + 120
    lo = max(anchor + 2.0, hi - TAIL)
    env = envelope(path, lo, hi)
    cand = [e for e in env if upper is None or e[0] < upper - 0.05]
    if not cand:
        cand = env
    if not cand:
        return None
    mn = min(cand, key=lambda e: e[1])
    return round(mn[0], 2)


def dump_calib(cal):
    lines = ["["]
    for i, c in enumerate(cal):
        lines.append("  " + json.dumps(c, ensure_ascii=False) + ("," if i < len(cal) - 1 else ""))
    lines.append("]")
    with open(CALIB, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main():
    # detect.jsonl: videoId -> starts(小数の曲頭列)
    det = {}
    with open(DETECT, encoding="utf-8") as f:
        for line in f:
            try:
                r = json.loads(line)
            except Exception:
                continue
            if r.get("starts"):
                det[r["video_id"]] = r["starts"]

    vl = [*json.load(open(os.path.join(DATA, "videoLinks.json"), encoding="utf-8")),
          *json.load(open(os.path.join(DATA, "videoLinksManual.json"), encoding="utf-8"))]

    # ソロ2版以上曲の版(videoId|startSec ユニーク)
    by_song = {}
    for v in vl:
        if v["member"] == "全員":
            continue
        by_song.setdefault(v["songCore"], {})[v["videoId"] + "|" + str(v["startSec"])] = v
    targets = []
    for song, uniq in by_song.items():
        if len(uniq) < 2:
            continue
        targets.extend(uniq.values())

    existing = json.load(open(CALIB, encoding="utf-8"))
    ex_keys = {c["videoId"] + "|" + str(c["startSec"]) for c in existing}

    if os.environ.get("TB_IDS"):
        want = set(os.environ["TB_IDS"].split(","))
        targets = [t for t in targets if t["videoId"] in want]

    # anchor(小数 black_end)+upper(次曲頭) を付与。既存(4曲精密)は保持=スキップ
    todo = []
    for v in targets:
        key = v["videoId"] + "|" + str(v["startSec"])
        if key in ex_keys:
            continue
        starts = det.get(v["videoId"])
        if not starts:
            continue
        match = [s for s in starts if round(s) == v["startSec"]]
        anchor = match[0] if match else min(starts, key=lambda s: abs(s - v["startSec"]))
        i = starts.index(anchor)
        upper = starts[i + 1] if i + 1 < len(starts) else None
        todo.append({"v": v, "anchor": round(anchor, 2), "upper": upper})

    by_vid = {}
    for t in todo:
        by_vid.setdefault(t["v"]["videoId"], []).append(t)
    vids = list(by_vid.keys())
    if os.environ.get("TB_LIMIT"):
        vids = vids[: int(os.environ["TB_LIMIT"])]

    added, fail = [], 0
    for n, vid in enumerate(vids, 1):
        path = dl(vid)
        if not path:
            fail += 1
            print(f"[{n}/{len(vids)}] {vid} DL失敗")
            continue
        for t in by_vid[vid]:
            end = valley_end(path, t["anchor"], t["upper"])
            if end is None or end - t["anchor"] < 30:
                # 黒フェード誤検出等で曲区間が壊れた版(尺が極端に短い/end取得不可)は弾く
                print(f"    skip {vid}@{t['v']['startSec']} (end={end}, 尺異常)")
                continue
            added.append({"videoId": vid, "startSec": t["v"]["startSec"], "anchor": t["anchor"], "end": end})
        for f in glob.glob(os.path.join(WORK, vid + ".*")):
            try:
                os.remove(f)
            except OSError:
                pass
        print(f"[{n}/{len(vids)}] {vid} +{len(by_vid[vid])}版")

    all_c = existing + added
    dump_calib(all_c)
    print(f"\n既存 {len(existing)}版 + 新規 {len(added)}版 = {len(all_c)}版 / DL失敗 {fail}動画")


if __name__ == "__main__":
    main()
