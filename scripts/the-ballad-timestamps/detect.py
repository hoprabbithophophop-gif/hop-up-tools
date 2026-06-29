#!/usr/bin/env python3
"""
The Ballad 2020 秋ツアー: 公式ダイジェスト動画の曲頭タイムスタンプ検出。

各ダイジェストは曲ごとに黒フェードで区切られている。ffmpeg blackdetect で
黒区間を取り、概要欄の曲順(N曲)に合わせて各曲の開始秒数を割り当てる。
（OCR不要・テロップは別途目視検証で確認済み）

出力: detect.jsonl （1行=1動画）。重い処理なのでここで一旦止め、
       マッチングは match.py で行う（再ダウンロード不要）。

env:
  SUPABASE_URL, SUPABASE_ANON_KEY  … 対象動画一覧の取得
  TB_WORK                          … 作業/出力ディレクトリ（既定: カレント）
  TB_LIMIT                         … 先頭N本だけ処理（検証用・任意）
"""
import os, re, json, subprocess, urllib.request, glob

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_ANON_KEY"]
WORK = os.environ.get("TB_WORK", ".")
LIMIT = int(os.environ.get("TB_LIMIT", "0"))
os.makedirs(WORK, exist_ok=True)
OUT = os.path.join(WORK, "detect.jsonl")
TMP = os.path.join(WORK, "dl")
os.makedirs(TMP, exist_ok=True)

MONTHS = {m: i + 1 for i, m in enumerate(
    ["January","February","March","April","May","June","July","August",
     "September","October","November","December"])}


def fetch_digests():
    q = "/rest/v1/youtube_videos?select=video_id,title,published_at&title=ilike.*Digest*&order=published_at"
    req = urllib.request.Request(URL + q, headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
    data = json.load(urllib.request.urlopen(req))
    return [d for d in data
            if "The Ballad" in d["title"] and "Summer COVERS" not in d["title"]]


def parse_title(title):
    """タイトルから (month, day) と開演時刻(最初の1つ)を取り出す。"""
    md = re.search(r"(January|February|March|April|May|June|July|August|"
                   r"September|October|November|December)\s*(\d{1,2})", title)
    month = MONTHS[md.group(1)] if md else None
    day = int(md.group(2)) if md else None
    sm = re.search(r"Start\s*(\d{1,2}:\d{2})", title)
    start = sm.group(1) if sm else None
    return month, day, start


def parse_songs(desc):
    """概要欄の ♪「曲名」歌唱者（グループ） を順番に。"""
    songs = []
    for line in desc.splitlines():
        if "♪" not in line:
            continue
        m = re.search(r"「([^」]+)」(.*)", line)
        if not m:
            continue
        song = m.group(1).strip()
        rest = m.group(2).strip().lstrip("（(").strip()
        member = re.split(r"[（(]", rest)[0].strip().replace("出演者全員", "全員")
        gm = re.search(r"[（(]([^（()）]*)[)）]", rest)
        group = gm.group(1).strip() if gm else ""
        songs.append({"song": song, "member": member, "group": group})
    return songs


def blackdetect(path):
    p = subprocess.run(
        ["ffmpeg", "-i", path, "-vf", "blackdetect=d=0.15:pix_th=0.10", "-an", "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = []
    for m in re.finditer(r"black_start:([\d.]+)\s+black_end:([\d.]+)", p.stderr):
        out.append((float(m.group(1)), float(m.group(2))))
    return out


def compute_starts(blacks, duration, n_songs):
    """黒区間→曲頭。先頭の縁(≈0)を除いたセパレータの black_end を曲頭とする。
    セパレータが N または N+1(末尾=アウトロ)のときに確定。それ以外はflag。"""
    seps = [(s, e) for (s, e) in blacks if s > 1.0]  # 冒頭の縁を除外
    seps.sort()
    ends = [e for (s, e) in seps]
    if len(ends) == n_songs:
        return ends, "ok"
    if len(ends) == n_songs + 1:
        return ends[:n_songs], "ok_trim_outro"
    return ends, "flag_count_mismatch"


def process(vid, title):
    month, day, start = parse_title(title)
    base = os.path.join(TMP, vid)
    # 360p + info-json を取得
    subprocess.run(
        ["python", "-m", "yt_dlp",
         "-f", "bv*[height<=360][ext=mp4]+ba/b[height<=360]/worst",
         "--write-info-json", "--no-warnings",
         "-o", base + ".%(ext)s",
         f"https://www.youtube.com/watch?v={vid}"],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    info_path = base + ".info.json"
    if not os.path.exists(info_path):
        return {"video_id": vid, "title": title, "status": "flag_no_info"}
    with open(info_path, encoding="utf-8") as f:
        info = json.load(f)
    desc = info.get("description", "")
    duration = info.get("duration")
    songs = parse_songs(desc)

    mp4 = None
    for ext in (".mp4", ".mkv", ".webm"):
        if os.path.exists(base + ext):
            mp4 = base + ext
            break
    status, starts = "flag_no_video", []
    blacks = []
    if mp4:
        blacks = blackdetect(mp4)
        starts, status = compute_starts(blacks, duration, len(songs))

    rec = {
        "video_id": vid, "title": title,
        "month": month, "day": day, "start": start,
        "duration": duration, "songCount": len(songs),
        "songs": songs, "starts": [round(x, 2) for x in starts],
        "blackCount": len(blacks), "status": status,
    }
    # 後片付け（動画/フレームは保持しない）
    for f in glob.glob(base + ".*"):
        try:
            os.remove(f)
        except OSError:
            pass
    return rec


def main():
    digests = fetch_digests()
    if LIMIT:
        digests = digests[:LIMIT]
    print(f"processing {len(digests)} digests")
    done = set()
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            for line in f:
                try:
                    done.add(json.loads(line)["video_id"])
                except Exception:
                    pass
    with open(OUT, "a", encoding="utf-8") as out:
        for i, d in enumerate(digests, 1):
            vid = d["video_id"]
            if vid in done:
                continue
            try:
                rec = process(vid, d["title"])
            except Exception as e:
                rec = {"video_id": vid, "title": d["title"], "status": f"error:{e}"}
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            out.flush()
            print(f"[{i}/{len(digests)}] {vid} {rec.get('status')} "
                  f"songs={rec.get('songCount')} starts={len(rec.get('starts', []))}")


if __name__ == "__main__":
    main()
