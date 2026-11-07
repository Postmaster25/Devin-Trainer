#!/usr/bin/env python3
"""Generate the generic spoken-cue clip library for the trainer app.

One-time script. Produces public/audio/*.mp3 and public/audio/audio-manifest.json.
The app stitches these clips at runtime, so plan imports and FTP changes never
need new audio.

Usage (Windows, macOS or Linux):
    python -m pip install -r scripts/requirements.txt
    python scripts/generate_audio.py                 # defaults
    python scripts/generate_audio.py --rate=-20% --voice en-US-AriaNeural
    python scripts/generate_audio.py --list-voices

Requires internet access (Microsoft Edge neural voices via edge-tts). ffmpeg is
provided by the imageio-ffmpeg package, so nothing else needs installing.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import edge_tts
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "audio"

# Numbers 0..MAX_NUMBER get a whole-word clip each (watts, minutes, seconds, counts,
# countdown). Larger numbers are composed at runtime from "hundred" + smaller clips.
MAX_NUMBER = 400

# Phrase clips: id -> spoken text. Ids are referenced by src/lib/cues.ts.
PHRASES: dict[str, str] = {
    "watts": "watts",
    "to": "to",
    "for": "for",
    "and": "and",
    "of": "of",
    "hundred": "hundred",
    "minute": "minute",
    "minutes": "minutes",
    "second": "second",
    "seconds": "seconds",
    "hour": "hour",
    "hours": "hours",
    "interval": "interval",
    "set": "set",
    "go": "Go!",
    "rest": "Rest",
    "easy": "Easy",
    "warm_up": "Warm up",
    "cool_down": "Cool down",
    "next_interval_15": "Next interval starting in fifteen seconds",
    "workout_complete": "Workout complete. Nice work.",
    "workout_paused": "Paused",
    "workout_resumed": "Resuming",
    "audio_check": "Audio check",
}


def clip_list() -> dict[str, str]:
    clips = {f"n{i}": str(i) for i in range(0, MAX_NUMBER + 1)}
    clips.update(PHRASES)
    return clips


def ffmpeg_filter(pad_ms: int) -> str:
    # Trim edge-tts leading silence (~240 ms) and its long trailing silence (~1 s),
    # keeping a little of the natural decay, then pad a fixed tail of silence so
    # stitched words never get clipped.
    return (
        "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02,"
        "areverse,"
        "silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.08,"
        "areverse,"
        f"apad=pad_dur={pad_ms / 1000:.3f}"
    )


def run_ffmpeg(args: list[str]) -> None:
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([exe, "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def probe_duration_ms(path: Path) -> int:
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    proc = subprocess.run([exe, "-hide_banner", "-i", str(path), "-f", "null", "-"], capture_output=True, text=True)
    # Last "time=HH:MM:SS.xx" in ffmpeg's progress output is the decoded duration.
    times = [t for t in proc.stderr.replace("\r", "\n").split() if t.startswith("time=")]
    if not times:
        return 0
    h, m, s = times[-1][5:].split(":")
    return round((int(h) * 3600 + int(m) * 60 + float(s)) * 1000)


async def synth(clip_id: str, text: str, args: argparse.Namespace, sem: asyncio.Semaphore, tmp: Path) -> tuple[str, int]:
    out = OUT_DIR / f"{clip_id}.mp3"
    raw = tmp / f"{clip_id}.raw.mp3"
    async with sem:
        for attempt in range(4):
            try:
                await edge_tts.Communicate(text, args.voice, rate=args.rate, volume=args.volume, pitch=args.pitch).save(str(raw))
                break
            except Exception as exc:  # network hiccups: retry with backoff
                if attempt == 3:
                    raise RuntimeError(f"edge-tts failed for {clip_id!r}: {exc}") from exc
                await asyncio.sleep(1.5 * (attempt + 1))
        await asyncio.to_thread(
            run_ffmpeg,
            ["-i", str(raw), "-af", ffmpeg_filter(args.pad_ms), "-ac", "1", "-ar", "24000", "-codec:a", "libmp3lame", "-b:a", args.bitrate, str(out)],
        )
    return clip_id, await asyncio.to_thread(probe_duration_ms, out)


def write_silence() -> None:
    # Looping silent track used to keep the iOS audio session alive with the screen off.
    run_ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "10", "-codec:a", "libmp3lame", "-b:a", "32k", str(OUT_DIR / "silence.mp3")])


async def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--voice", default="en-US-GuyNeural", help="edge-tts voice (default: %(default)s)")
    p.add_argument("--rate", default="-15%", help="speech rate, e.g. -15%%, -25%%, +0%% (default: %(default)s)")
    p.add_argument("--volume", default="+0%", help="volume adjustment (default: %(default)s)")
    p.add_argument("--pitch", default="+0Hz", help="pitch adjustment (default: %(default)s)")
    p.add_argument("--pad-ms", type=int, default=150, help="trailing silence added to every clip (default: %(default)s)")
    p.add_argument("--bitrate", default="64k", help="mp3 bitrate (default: %(default)s)")
    p.add_argument("--concurrency", type=int, default=8)
    p.add_argument("--only", nargs="*", help="regenerate only these clip ids")
    p.add_argument("--list-voices", action="store_true")
    args = p.parse_args()

    if args.list_voices:
        for v in await edge_tts.list_voices():
            if v["Locale"].startswith("en-"):
                print(f'{v["ShortName"]:28} {v["Gender"]}')
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    clips = clip_list()
    todo = {k: v for k, v in clips.items() if not args.only or k in args.only}
    manifest_path = OUT_DIR / "audio-manifest.json"
    durations: dict[str, int] = {}
    if args.only and manifest_path.exists():
        durations = {k: v["durationMs"] for k, v in json.loads(manifest_path.read_text())["clips"].items()}

    sem = asyncio.Semaphore(args.concurrency)
    with tempfile.TemporaryDirectory() as tmp:
        tasks = [synth(k, v, args, sem, Path(tmp)) for k, v in todo.items()]
        done = 0
        for fut in asyncio.as_completed(tasks):
            clip_id, ms = await fut
            durations[clip_id] = ms
            done += 1
            if done % 25 == 0 or done == len(tasks):
                print(f"{done}/{len(tasks)} clips", flush=True)
    write_silence()

    manifest = {
        "version": 1,
        "voice": args.voice,
        "rate": args.rate,
        "padMs": args.pad_ms,
        "maxNumber": MAX_NUMBER,
        "clips": {k: {"file": f"{k}.mp3", "text": clips[k], "durationMs": durations.get(k, 0)} for k in clips},
    }
    manifest_path.write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"Wrote {len(clips)} clips + silence.mp3 to {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
