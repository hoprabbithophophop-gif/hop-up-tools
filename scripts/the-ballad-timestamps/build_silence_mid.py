#!/usr/bin/env python3
"""全compareCalib版のendを、無音区間(曲の音末〜次曲の音頭)の中盤に厳密設定する。

前回(gap>1.0で谷底とdetect upperの中間)はブツ切りが残った。原因は
detectのupperが映像(黒フェード)基準で次曲の実際の音頭とズレること、
谷底が音末そのものでないこと。今回は波形で無音区間の両端を厳密に取る:
  song_end   = upper手前で最後に音(dB>SND)があった点 = 曲の音末
  next_start = song_end後で最初に音(dB>SND)に戻る点 = 次曲の音頭
  end        = (song_end + next_start) / 2  = 無音区間の中盤

env(TB_IDS)で対象を絞れる(検証用)。末尾曲(upper無し)は据置。
"""
import os, json, math, array, subprocess, glob

DATA = os.path.join("src", "data", "the-ballad")
CALIB = os.path.join(DATA, "compareCalib.json")
DETECT = os.path.join("scripts", "the-ballad-timestamps", "detect.jsonl")
WORK = "./_tbmid"
os.makedirs(WORK, exist_ok=True)
SR, WIN = 8000, 800
SND = -40  # dBがこれを超えたら「音あり」、下回れば「無音」


def dl(vid):
    base = os.path.join(WORK, vid)
    g = glob.glob(base + ".*")
    if g:
        return g[0]
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


det = {}
for line in open(DETECT, encoding="utf-8"):
    try:
        r = json.loads(line)
    except Exception:
        continue
    if r.get("starts"):
        det[r["video_id"]] = r["starts"]

cal = json.load(open(CALIB, encoding="utf-8"))
want = set(os.environ["TB_IDS"].split(",")) if os.environ.get("TB_IDS") else None
by_vid = {}
for c in cal:
    if want and c["videoId"] not in want:
        continue
    by_vid.setdefault(c["videoId"], []).append(c)

changed = 0
for n, (vid, cs) in enumerate(by_vid.items(), 1):
    path = dl(vid)
    if not path:
        print(f"[{n}/{len(by_vid)}] {vid} DL失敗", flush=True)
        continue
    starts = det.get(vid, [])
    for c in cs:
        nexts = [s for s in starts if s > c["end"] - 1.5]
        if not nexts:
            continue  # 末尾曲(次曲頭なし)は据置
        upper = min(nexts)
        env = envelope(path, max(0, c["end"] - 4), upper + 2.5)
        before = [(t, db) for t, db in env if t < upper - 0.1]
        snd = [t for t, db in before if db > SND]
        if not snd:
            continue
        song_end = snd[-1]  # 曲の音末(upper手前で最後に音があった点)
        after = [(t, db) for t, db in env if t > song_end + 0.2]
        nxt = [t for t, db in after if db > SND]
        next_start = nxt[0] if nxt else upper  # 次曲の音頭
        new_end = round((song_end + next_start) / 2, 2)
        c["_dbg"] = f"songend={song_end} next={next_start} end={c['end']}->{new_end}"
        c["end"] = new_end
        changed += 1
    for f in glob.glob(os.path.join(WORK, vid + ".*")):
        try:
            os.remove(f)
        except OSError:
            pass
    print(f"[{n}/{len(by_vid)}] {vid} done", flush=True)

for c in cal:
    if os.environ.get("TB_DEBUG") and "_dbg" in c:
        print(f"  {c['videoId']}|{c['startSec']} {c['_dbg']}", flush=True)
    c.pop("_dbg", None)

lines = ["["]
for i, c in enumerate(cal):
    lines.append("  " + json.dumps(c, ensure_ascii=False) + ("," if i < len(cal) - 1 else ""))
lines.append("]")
open(CALIB, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(f"\n{changed}版のendを無音区間の中盤に更新", flush=True)
