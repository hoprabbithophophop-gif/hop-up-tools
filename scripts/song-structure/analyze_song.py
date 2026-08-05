#!/usr/bin/env python3
"""曲の骨組み(BPM・拍・小節頭・区間・曲頭の無音)を JSON 1枚にまとめる。

  python analyze_song.py <音声ファイル | YouTube の URL または動画ID> [オプション]

出力
  <out-dir>/<曲ID>/structure.json   骨組み本体
  <out-dir>/<曲ID>/click.wav        拍の位置にカチッと音を重ねた確認用音声(--click 指定時)

音源はこの PC の中だけで扱う。外部へ送信しない。歌詞は一切扱わない。
YouTube の URL/動画ID を渡した場合は音声のみ一時取得し、解析後に消す。
"""
from __future__ import annotations

import argparse
import array
import hashlib
import inspect
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

PPQ = 480  # 1拍あたりの目盛り数。定規は細かく作っておく

YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


# ---------------------------------------------------------------- 入力の解決

def looks_like_youtube(arg: str) -> str | None:
    """YouTube の URL か動画ID なら動画IDを返す。ローカルファイルなら None。"""
    if Path(arg).exists():
        return None
    if YT_ID.match(arg):
        return arg
    m = re.search(r"(?:v=|youtu\.be/|/shorts/)([A-Za-z0-9_-]{11})", arg)
    return m.group(1) if m else None


def fetch_audio(video_id: str, workdir: Path) -> tuple[Path, dict]:
    """音声だけを一時取得する。動画は落とさない。"""
    base = workdir / video_id
    subprocess.run(
        [sys.executable, "-m", "yt_dlp", "-f", "ba/bestaudio/worst",
         "--write-info-json", "--no-warnings",
         "-o", str(base) + ".%(ext)s",
         f"https://www.youtube.com/watch?v={video_id}"],
        check=True, capture_output=True, text=True, encoding="utf-8", errors="replace")
    info_path = base.with_suffix(".info.json")
    info = json.loads(info_path.read_text(encoding="utf-8")) if info_path.exists() else {}
    audio = next((p for p in workdir.glob(video_id + ".*")
                  if p.suffix not in (".json",)), None)
    if audio is None:
        raise SystemExit(f"音声を取得できなかった: {video_id}")
    return audio, {
        "kind": "youtube",
        "video_id": video_id,
        "title": info.get("title"),
        "uploader": info.get("uploader"),
        "duration": info.get("duration"),
    }


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------- 音の下ごしらえ

def decode_pcm(path: Path, sr: int, mono: bool = True) -> array.array:
    """ffmpeg で 16bit PCM に開く。"""
    cmd = ["ffmpeg", "-v", "error", "-i", str(path)]
    if mono:
        cmd += ["-ac", "1"]
    cmd += ["-ar", str(sr), "-f", "s16le", "-"]
    p = subprocess.run(cmd, capture_output=True, check=True)
    pcm = array.array("h")
    pcm.frombytes(p.stdout[: len(p.stdout) // 2 * 2])
    return pcm


def measure_silence_head(path: Path, thresh_db: float = -50.0,
                         sr: int = 8000, win: int = 400) -> float:
    """曲頭の無音の長さ(秒)。窓ごとの音量を見て、最初に音が立ち上がる点を返す。"""
    pcm = decode_pcm(path, sr)
    for i in range(0, len(pcm) - win, win):
        s = 0
        for j in range(i, i + win):
            v = pcm[j]
            s += v * v
        db = 20 * math.log10(math.sqrt(s / win) / 32768 + 1e-9)
        if db > thresh_db:
            return round(i / sr, 3)
    return 0.0


# ---------------------------------------------------------------- 目盛りの計算

def measure_silence_tail(path: Path, thresh_db: float = -50.0,
                         sr: int = 8000, win: int = 400) -> float:
    """音が鳴り終わる時刻（秒）。最後に音が出ていた窓の終わりを返す。"""
    pcm = decode_pcm(path, sr)
    last = 0.0
    for i in range(0, len(pcm) - win, win):
        s = 0
        for j in range(i, i + win):
            v = pcm[j]
            s += v * v
        db = 20 * math.log10(math.sqrt(s / win) / 32768 + 1e-9)
        if db > thresh_db:
            last = (i + win) / sr
    return round(last, 3)


def extend_beats(beats: list[float], sound_end: float, bars: int = 4,
                 beats_per_bar: int = 4) -> tuple[list[float], int]:
    """最後の拍から「音が鳴り終わる時刻＋指定の小節数」まで拍を継ぎ足す。

    解析器は曲の終盤で拍を振るのをやめることがある（余韻やロングトーンで
    拍が取りにくくなるため）。そのままだと曲の最後にコールを置けないので、
    直近の間隔をそのまま延長して補う。
    どこから継ぎ足したかは呼び出し側で記録すること。
    """
    if len(beats) < 8:
        return beats, 0
    tail = [beats[i + 1] - beats[i] for i in range(len(beats) - 9, len(beats) - 1)]
    step = sorted(tail)[len(tail) // 2]
    if step <= 0:
        return beats, 0
    limit = sound_end + step * beats_per_bar * bars
    out = list(beats)
    added = 0
    while out[-1] + step <= limit:
        out.append(round(out[-1] + step, 4))
        added += 1
    return out, added


def time_to_tick(t: float, beats: list[float]) -> int:
    """秒 → 目盛り。拍と拍の間は等分して割り当てる。曲頭より前は負の値になる。"""
    if not beats:
        return 0
    if len(beats) == 1:
        return 0
    if t <= beats[0]:
        step = beats[1] - beats[0]
        return int(round((t - beats[0]) / step * PPQ)) if step > 0 else 0
    if t >= beats[-1]:
        step = beats[-1] - beats[-2]
        extra = (t - beats[-1]) / step if step > 0 else 0
        return int(round((len(beats) - 1 + extra) * PPQ))
    lo, hi = 0, len(beats) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if beats[mid] <= t:
            lo = mid
        else:
            hi = mid
    step = beats[hi] - beats[lo]
    frac = (t - beats[lo]) / step if step > 0 else 0
    return int(round((lo + frac) * PPQ))


def bpm_candidates(reported: float | None, beats: list[float]) -> dict:
    """BPM。倍/半分の取り違えがあり得るので、割れたら候補を全部残す。"""
    cands: list[dict] = []
    if reported:
        cands.append({"bpm": round(float(reported), 3), "from": "allin1"})
    if len(beats) >= 4:
        gaps = sorted(beats[i + 1] - beats[i] for i in range(len(beats) - 1))
        median = gaps[len(gaps) // 2]
        if median > 0:
            derived = 60.0 / median
            cands.append({"bpm": round(derived, 3), "from": "拍の間隔の中央値"})
            for factor, name in ((0.5, "半分"), (2.0, "倍")):
                v = derived * factor
                if 40.0 <= v <= 240.0:
                    cands.append({"bpm": round(v, 3), "from": f"拍の間隔の中央値の{name}"})
    seen, uniq = set(), []
    for c in cands:
        key = round(c["bpm"], 1)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(c)
    return {"primary": uniq[0]["bpm"] if uniq else None, "candidates": uniq}


def group_segments(segments: list[dict]) -> list[dict]:
    """同じラベルの区間に同じ棚番号を振る。"""
    order: dict[str, int] = {}
    out = []
    for s in segments:
        label = s["label"]
        if label not in order:
            order[label] = len(order)
        out.append({**s, "group": order[label]})
    return out


# ---------------------------------------------------------------- 確認用の音

def write_click_track(path: Path, out: Path, beats: list[float],
                      downbeats: list[float], sr: int = 22050) -> None:
    """拍の位置にカチッと音を重ねた音声を書き出す。小節頭は高い音にする。"""
    pcm = decode_pcm(path, sr)
    buf = array.array("h", pcm)
    downset = {round(d, 3) for d in downbeats}
    dur = int(sr * 0.02)
    for t in beats:
        freq = 1600.0 if round(t, 3) in downset else 900.0
        start = int(t * sr)
        for n in range(dur):
            idx = start + n
            if idx >= len(buf):
                break
            env = 1.0 - n / dur
            click = int(9000 * env * math.sin(2 * math.pi * freq * n / sr))
            v = buf[idx] // 2 + click
            buf[idx] = max(-32768, min(32767, v))
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(sr), "-ac", "1",
         "-i", "-", str(out)],
        input=buf.tobytes(), check=True)


# ---------------------------------------------------------------- 解析本体

def run_allin1(audio: Path, workdir: Path, device: str):
    from allin1 import analyze

    wanted = {
        "paths": str(audio),
        "out_dir": str(workdir / "struct"),
        "demix_dir": str(workdir / "demix"),
        "spec_dir": str(workdir / "spec"),
        "device": device,
        "keep_byproducts": False,
        "multiprocess": False,
    }
    params = inspect.signature(analyze).parameters
    kwargs = {k: v for k, v in wanted.items() if k in params}
    unknown = sorted(set(wanted) - set(kwargs))
    if unknown:
        print(f"  (この版の allin1 には無い指定を外した: {', '.join(unknown)})")
    return analyze(**kwargs)


def to_dict(result) -> dict:
    """allin1 の結果を素の辞書にする。"""
    beats = [round(float(b), 4) for b in getattr(result, "beats", []) or []]
    downbeats = [round(float(b), 4) for b in getattr(result, "downbeats", []) or []]
    segments = [{"start": round(float(s.start), 4),
                 "end": round(float(s.end), 4),
                 "label": str(s.label)}
                for s in (getattr(result, "segments", []) or [])]
    return {
        "bpm_reported": getattr(result, "bpm", None),
        "beats": beats,
        "downbeats": downbeats,
        "beat_positions": [int(x) for x in (getattr(result, "beat_positions", []) or [])],
        "segments": segments,
    }


# ---------------------------------------------------------------- 入口

def extend_tail_mode(song_dir: Path, bars: int) -> None:
    """すでにある骨組みの拍を、曲の終わりまで継ぎ足す。

    解析をやり直さずに、拍だけを補う。音源は骨組みに書いてある動画IDから
    取り直して、鳴り終わる時刻を測るためだけに使い、終わったら消す。
    """
    path = song_dir / "structure.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    vid = (doc.get("source") or {}).get("video_id")
    if not vid:
        print(f"  {song_dir.name}: 動画IDが無いので飛ばす")
        return
    if doc.get("beats_measured"):
        print(f"  {song_dir.name}: すでに継ぎ足し済み")
        return

    work = Path(tempfile.mkdtemp(prefix="extend-"))
    try:
        audio, _ = fetch_audio(vid, work)
        sound_end = measure_silence_tail(audio)
        beats = doc["beats"]
        before = len(beats)
        newbeats, added = extend_beats(beats, sound_end, bars=bars)
        if added == 0:
            print(f"  {song_dir.name}: 継ぎ足し不要"
                  f"（最後の拍 {beats[-1]:.2f}秒 / 音の終わり {sound_end:.2f}秒）")
            doc["beats_measured"] = before
            doc["sound_end"] = sound_end
            path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
                            encoding="utf-8")
            return

        # 小節の並びも続ける（1,2,3,4 の繰り返し）
        pos = doc.get("beat_positions") or []
        downs = list(doc.get("downbeats") or [])
        p = pos[-1] if pos else 4
        for i in range(before, len(newbeats)):
            p = 1 if p >= 4 else p + 1
            pos.append(p)
            if p == 1:
                downs.append(newbeats[i])

        doc["beats"] = newbeats
        doc["beat_positions"] = pos
        doc["downbeats"] = downs
        doc["beats_measured"] = before      # ここまでが解析器の出したもの
        doc["sound_end"] = sound_end
        for s in doc["segments"]:
            s["start_tick"] = time_to_tick(s["start"], newbeats)
            s["end_tick"] = time_to_tick(s["end"], newbeats)
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
        print(f"  {song_dir.name}: {added}拍 継ぎ足した"
              f"（{beats[before-1]:.2f}秒 → {newbeats[-1]:.2f}秒 /"
              f" 音の終わり {sound_end:.2f}秒）")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main() -> None:
    if "--extend-tail" in sys.argv:
        ap = argparse.ArgumentParser(description="拍を曲の終わりまで継ぎ足す")
        ap.add_argument("--extend-tail", action="store_true")
        ap.add_argument("--out-dir", default="songs")
        ap.add_argument("--bars", type=int, default=4,
                        help="音が鳴り終わってから何小節ぶん残すか（既定4）")
        ap.add_argument("ids", nargs="*", help="曲ID（省略すると全部）")
        a = ap.parse_args()
        root = Path(a.out_dir).resolve()
        dirs = [root / i for i in a.ids] if a.ids else sorted(
            p for p in root.iterdir() if (p / "structure.json").exists())
        print(f"{len(dirs)}曲ぶん")
        for d in dirs:
            try:
                extend_tail_mode(d, a.bars)
            except Exception as e:
                print(f"  {d.name}: 失敗 {e}")
        return

    ap = argparse.ArgumentParser(description="曲の骨組みを JSON にまとめる")
    ap.add_argument("input", help="音声ファイル、または YouTube の URL / 動画ID")
    ap.add_argument("--id", help="曲ID(省略時はファイル名または動画IDから)")
    ap.add_argument("--out-dir", default="songs", help="出力先の親フォルダ(既定: songs)")
    ap.add_argument("--click", action="store_true", help="拍に音を重ねた確認用音声も書き出す")
    ap.add_argument("--device", default="cpu", help="cpu / cuda(既定: cpu)")
    ap.add_argument("--force", action="store_true", help="既にある structure.json を上書きする")
    args = ap.parse_args()

    workdir = Path(tempfile.mkdtemp(prefix="songstruct-"))
    fetched = False
    try:
        vid = looks_like_youtube(args.input)
        if vid:
            print(f"音声を取得中: {vid}")
            audio, source = fetch_audio(vid, workdir)
            fetched = True
            song_id = args.id or vid
        else:
            audio = Path(args.input).resolve()
            if not audio.exists():
                raise SystemExit(f"ファイルが見つからない: {audio}")
            source = {"kind": "file", "name": audio.name}
            song_id = args.id or audio.stem

        out_dir = Path(args.out_dir).resolve() / song_id
        out_json = out_dir / "structure.json"
        if out_json.exists() and not args.force:
            raise SystemExit(
                f"すでに骨組みがある: {out_json}\n"
                f"上書きしてよければ --force を付けて実行する")

        # 前回この曲に人が付けた区間の名前。解析し直しても消さずに引き継ぐ。
        prev_names: list = []
        if out_json.exists():
            try:
                prev = json.loads(out_json.read_text(encoding="utf-8"))
                prev_names = [s.get("name") for s in prev.get("segments", [])]
            except (json.JSONDecodeError, OSError):
                prev_names = []

        source["sha256"] = sha256_of(audio)
        source["bytes"] = audio.stat().st_size

        print(f"曲頭の無音を測定中 …")
        silence_head = measure_silence_head(audio)

        print(f"骨組みを解析中 … (CPU だと数分かかる)")
        raw = to_dict(run_allin1(audio, workdir, args.device))

        beats = raw["beats"]
        segments = group_segments(raw["segments"])
        # 区間の数が前回と変わったら番号の対応が崩れるので、そのときは引き継がない
        carry = prev_names if len(prev_names) == len(segments) else []
        if prev_names and not carry:
            print("※ 区間の数が前回と変わったので、付けていた名前は引き継がなかった")
        for i, s in enumerate(segments):
            s["index"] = i
            s["start_tick"] = time_to_tick(s["start"], beats)
            s["end_tick"] = time_to_tick(s["end"], beats)
            s["label_source"] = "allin1"   # 機械が出したラベル。記録として残す
            s["name"] = carry[i] if i < len(carry) else None  # 人が付ける名前

        doc = {
            "song_id": song_id,
            "bpm": bpm_candidates(raw["bpm_reported"], beats),
            "beats": beats,
            "downbeats": raw["downbeats"],
            "beat_positions": raw["beat_positions"],
            "segments": segments,
            "silence_head": silence_head,
            "ticks": {
                "ppq": PPQ,
                "beats": [i * PPQ for i in range(len(beats))],
                "downbeats": [time_to_tick(d, beats) for d in raw["downbeats"]],
            },
            "source": source,
            "analyzer": {"name": "allin1", "device": args.device},
        }

        out_dir.mkdir(parents=True, exist_ok=True)
        out_json.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
                            encoding="utf-8")
        print(f"\n書き出した: {out_json}")

        if args.click:
            click_path = out_dir / "click.wav"
            print(f"確認用音声を作成中 …")
            write_click_track(audio, click_path, beats, raw["downbeats"])
            print(f"書き出した: {click_path}")

        # 耳で確かめるための区間一覧
        print(f"\nBPM: {doc['bpm']['primary']}  "
              f"(候補 {len(doc['bpm']['candidates'])}件)")
        print(f"曲頭の無音: {silence_head} 秒 / 拍 {len(beats)}個 / 小節頭 {len(raw['downbeats'])}個")
        print("\n区間の境目(この秒に飛ばして耳で確かめる):")
        for s in segments:
            m, sec = divmod(s["start"], 60)
            shown = s["name"] or f"{s['label']}(機械の判定)"
            print(f"  [{s['index']:2d}] {int(m):02d}:{sec:06.3f}  {shown:<20} (棚{s['group']})")
    finally:
        if fetched:
            shutil.rmtree(workdir, ignore_errors=True)
        else:
            shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    main()
