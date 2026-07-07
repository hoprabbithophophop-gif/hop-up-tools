#!/usr/bin/env python3
"""
detect.jsonl（動画ごとの曲頭タイムスタンプ）を、スプレッドシート由来の
setlist.json / shows.json に突合して videoLinks.json を生成する。

突合キー: 公演日(月日) × 歌唱者 × 曲名（正規化）。
同日に別会場(別チーム)の公演があっても、歌唱者+曲が一致する公演だけに紐付くため
誤爆しない。再ダウンロード不要・何度でも再実行可。

env:
  TB_WORK   … detect.jsonl のあるディレクトリ（既定: カレント）
  TB_DATA   … 出力先 src/data/the-ballad（既定: ./src/data/the-ballad）
"""
import os, re, json, unicodedata

WORK = os.environ.get("TB_WORK", ".")
DATA = os.environ.get("TB_DATA", os.path.join("src", "data", "the-ballad"))
DETECT = os.path.join(WORK, "detect.jsonl")
# ダイジェストのタイトル会場(英語)→日本語会場名の対応（同時刻・複数会場の取り違え防止に使う）
VENUE_MAP = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "venueMap.json"), encoding="utf-8"))


def norm_song(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    s = re.sub(r"\s+", "", s)
    s = s.replace("〜", "~").replace("～", "~")
    return s.lower()


def norm_member(m: str) -> str:
    m = unicodedata.normalize("NFKC", m or "")
    return re.sub(r"\s+", "", m)


def parse_show_date(date_str: str):
    """ '9/19(土)' -> (9, 19) """
    m = re.match(r"\s*(\d{1,2})/(\d{1,2})", date_str or "")
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)


def title_venue(title: str):
    """タイトルの会場名(英語)を venueMap で日本語会場名へ。会場名に「・」があっても全体を取る。無ければ None。"""
    m = re.search(r"[・･·]\s*(.+?)[-–\s]*Diges", title or "", re.I)
    if not m:
        return None
    return VENUE_MAP.get(re.sub(r"[^a-z0-9]", "", m.group(1).lower()))


def main():
    with open(os.path.join(DATA, "shows.json"), encoding="utf-8") as f:
        shows = json.load(f)
    with open(os.path.join(DATA, "setlist.json"), encoding="utf-8") as f:
        setlist = json.load(f)  # lean: s/o/m/c/a

    # showNo -> (month, day) / 開演時刻
    show_md = {s["no"]: parse_show_date(s["date"]) for s in shows}
    show_start = {s["no"]: (s.get("start") or "").strip() for s in shows}
    # 会場名 -> その会場の公演番号集合（同時刻・別会場の動画を取り違えないための会場照合）
    venue_shows = {}
    for s in shows:
        venue_shows.setdefault(s["venue"], set()).add(s["no"])

    # (md, normMember, normSong) -> list of {showNo, songCore, start}
    index = {}
    for e in setlist:
        md = show_md.get(e["s"])
        if not md or md[0] is None:
            continue
        key = (md, norm_member(e["m"]), norm_song(e["c"]))
        index.setdefault(key, []).append(
            {"showNo": e["s"], "songCore": e["c"], "start": show_start.get(e["s"], "")})

    links = {}            # (showNo,member,songCore) -> link
    unmatched = []        # 概要欄にあるが setlist と一致しなかった曲
    flagged = []          # status が ok でない動画
    stats = {"videos": 0, "ok_videos": 0, "song_rows": 0, "matched_rows": 0}

    with open(DETECT, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            stats["videos"] += 1
            if not rec.get("status", "").startswith("ok"):
                flagged.append({"video_id": rec["video_id"], "title": rec.get("title"),
                                "status": rec.get("status"),
                                "songCount": rec.get("songCount"),
                                "blackCount": rec.get("blackCount")})
                continue
            stats["ok_videos"] += 1
            md = (rec.get("month"), rec.get("day"))
            vid = rec["video_id"]
            # タイトルから開演時刻ラベル（"14:30" / "18:15" / "14:30/18:15"）。省略しない。
            tl = re.search(r"Start\s*([0-9]{1,2}:[0-9]{2}(?:/[0-9]{1,2}:[0-9]{2})?)", rec.get("title", ""))
            time_label = tl.group(1) if tl else (rec.get("start") or "")
            start_set = set(time_label.split("/")) if time_label else set()
            # この動画のタイトル会場に一致する公演だけに絞る（同時刻・複数会場の誤爆防止）
            allowed = venue_shows.get(title_venue(rec.get("title", "")))
            songs = rec.get("songs", [])
            starts = rec.get("starts", [])
            for song, start in zip(songs, starts):
                stats["song_rows"] += 1
                key = (md, norm_member(song["member"]), norm_song(song["song"]))
                cands = index.get(key)
                if cands and allowed is not None:
                    cands = [c for c in cands if c["showNo"] in allowed]
                # 開演時刻で公演を特定（合体版は両方にマッチ）。
                # ただし開演が1つも一致しない場合は日付一致で拾う（公演番号が重複している
                # show36=10/10オリックス昼夜のような元データのクセを救済）。
                if cands and start_set:
                    f = [c for c in cands if c["start"] in start_set]
                    if f:
                        cands = f
                if not cands:
                    unmatched.append({"video_id": vid, "date": f"{md[0]}/{md[1]}",
                                      "member": song["member"], "song": song["song"]})
                    continue
                stats["matched_rows"] += 1
                for c in cands:
                    k = (c["showNo"], song["member"], c["songCore"])
                    if k not in links:  # 最初（=最短開始）を採用
                        links[k] = {
                            "showNo": c["showNo"],
                            "member": song["member"],
                            "songCore": c["songCore"],
                            "videoId": vid,
                            "startSec": int(round(start)),
                            "startLabel": time_label,
                        }

    out_links = sorted(links.values(), key=lambda x: (x["showNo"], x["member"], x["songCore"]))
    with open(os.path.join(DATA, "videoLinks.json"), "w", encoding="utf-8") as f:
        json.dump(out_links, f, ensure_ascii=False)

    report = {
        "stats": stats,
        "videoLinks": len(out_links),
        "shows_with_video": len(set(l["showNo"] for l in out_links)),
        "flagged_videos": flagged,
        "unmatched_songs": unmatched,
    }
    with open(os.path.join(WORK, "match-report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(json.dumps({
        "videoLinks": len(out_links),
        "shows_with_video": report["shows_with_video"],
        "stats": stats,
        "flagged_videos": len(flagged),
        "unmatched_songs": len(unmatched),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
