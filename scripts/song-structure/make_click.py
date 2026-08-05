#!/usr/bin/env python3
"""すでにある骨組みから、拍にカチッと音を重ねた確認用音声を作り直す。

  python make_click.py [曲ID …]     （曲IDを省略すると songs/ の全部）

解析のときに音源は消しているので、骨組みに書いてある動画IDから取り直す。
作り終わったら音源はまた消す。残るのは click.mp3 だけ。

耳で確かめること
  ・曲頭：カチッと鳴り始める位置が、演奏の1拍目と合っているか
  　（セリフや前奏には鳴らないのが正しい）
  ・終盤：ずれていないか。だんだんずれるならBPMの取り違え
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from analyze_song import fetch_audio, write_click_track  # noqa: E402

SONGS = Path(__file__).parent / "songs"


def build(song_dir: Path) -> None:
    doc = json.loads((song_dir / "structure.json").read_text(encoding="utf-8"))
    vid = (doc.get("source") or {}).get("video_id")
    if not vid:
        print(f"  {song_dir.name}: 動画IDが骨組みに入っていないので飛ばす")
        return

    work = Path(tempfile.mkdtemp(prefix="click-"))
    try:
        audio, _ = fetch_audio(vid, work)
        wav = work / "click.wav"
        write_click_track(audio, wav, doc["beats"], doc["downbeats"])
        mp3 = song_dir / "click.mp3"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav),
                        "-b:a", "128k", str(mp3)], check=True)
        size = mp3.stat().st_size / 1024 / 1024
        print(f"  {song_dir.name}: できた（{size:.1f}MB / 拍{len(doc['beats'])}個）")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main() -> None:
    ids = sys.argv[1:]
    dirs = [SONGS / i for i in ids] if ids else sorted(
        p for p in SONGS.iterdir() if (p / "structure.json").exists())
    print(f"{len(dirs)}曲ぶん作る")
    for d in dirs:
        if not (d / "structure.json").exists():
            print(f"  {d.name}: 骨組みが無い")
            continue
        try:
            build(d)
        except Exception as e:
            print(f"  {d.name}: 失敗 {e}")


if __name__ == "__main__":
    main()
