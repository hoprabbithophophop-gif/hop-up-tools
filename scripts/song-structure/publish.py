#!/usr/bin/env python3
"""骨組みを、アプリと一緒に配る場所へ書き出す。

  python publish.py

`songs/<曲ID>/structure.json` から必要な部分だけを取り出して
`public/song-skeletons/<曲ID>.json` に置く。ここに置いたものが
そのままサイトの一部として配信される。

置き場所を `public/call-center/` の下にしてはいけない。サイトの中に実在の
フォルダができると、Cloudflare がページの住所より先にそのフォルダを見に行き、
/call-center が「中身が無い」で弾かれる。手元の開発サーバーでは起きず、
本番でだけ出る噛み合わせ。

出さないもの
  ・音源の指紋とファイルサイズ（内部の照合用。外に出す必要がない）
  ・目盛りの対応表（1拍=480 と拍の秒数から計算で出せる）
  ・各拍が小節の何拍目か（小節頭の位置から計算で出せる）
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
SONGS = HERE / "songs"
OUT = HERE.parent.parent / "public" / "song-skeletons"


def digest(doc: dict) -> str:
    core = json.dumps({"beats": doc["beats"], "downbeats": doc["downbeats"]},
                      separators=(",", ":"))
    return hashlib.sha256(core.encode()).hexdigest()[:12]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    dirs = sorted(p for p in SONGS.iterdir() if (p / "structure.json").exists())
    print(f"{len(dirs)}曲ぶんを {OUT} へ")
    for d in dirs:
        doc = json.loads((d / "structure.json").read_text(encoding="utf-8"))
        out = {
            "slug": d.name,
            "digest": digest(doc),
            "bpm": doc["bpm"]["primary"],
            "ppq": doc["ticks"]["ppq"],
            "firstBeatSec": doc["beats"][0],
            "silenceHead": doc["silence_head"],
            "soundEnd": doc.get("sound_end"),
            "beatsMeasured": doc.get("beats_measured"),
            "beats": doc["beats"],
            "downbeats": doc["downbeats"],
            "sections": [
                {
                    "order": s["index"],
                    "startSec": s["start"],
                    "endSec": s["end"],
                    "startTick": s["start_tick"],
                    "endTick": s["end_tick"],
                    "labelAuto": s["label"],
                    "name": s.get("name"),
                    "group": s["group"],
                }
                for s in doc["segments"]
            ],
        }
        p = OUT / f"{d.name}.json"
        p.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n",
                     encoding="utf-8")
        print(f"  {d.name:<22}{p.stat().st_size / 1024:>6.1f}KB  照合番号 {out['digest']}")


if __name__ == "__main__":
    main()
