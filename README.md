# Ride Training Plan (Mueller Sub-30 Trainer)

Mobile-first PWA (Vite + React + TypeScript) for iPhone that shows the Mueller Sub-30 schedule and runs indoor interval workouts with spoken cues stitched from a pre-generated clip library.

Live: https://postmaster25.github.io/Devin-Trainer/ (after the Pages workflow runs on `main`). Open it in Safari → Share → **Add to Home Screen**.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173/Devin-Trainer/
npm test           # unit tests (plan data, cue schedule, dates, engine)
npm run build      # production build + service worker into dist/
```

## Plan data

`Mueller Sub-30 Plan.md` is the source of truth. `npm run parse-plan` regenerates `src/data/plan.json`
(weeks 1–31 → day offsets 0–6 → workouts). Calendar dates are never stored; the app derives them as
`startDate + (week - 1) * 7 + offset`. Watt targets are stored as %FTP (`lowPct`/`highPct`) with the documented
watts at `referenceFtp` (`lowW`/`highW`); the app always displays and speaks absolute watts at the FTP in Settings.

The schema lives in `src/data/schema.ts` (zod). To import your own plan, use **Settings → Export plan JSON** as a
template, edit it, then **Import plan**. Imported plans are validated, stored in IndexedDB and replace the bundled
plan until you tap **Restore default plan**.

A workout gets a timer when `category` is `ride`, `indoor` is `true` and it has `phases`. Phase `kind` is one of
`warmup | work | recovery | steady | cooldown`; `work` phases drive the countdowns and announcements.

## Audio clips

The app never generates per-cue audio. `scripts/generate_audio.py` creates a fixed vocabulary once
(numbers 0–400, plus phrases such as "watts", "for", "minutes", "next interval starting in fifteen seconds",
"cool down", "workout complete") in `public/audio/` with `audio-manifest.json`. Each clip has leading silence
trimmed and a fixed tail of silence added so stitched words aren't clipped. At runtime the cues are sequenced
with Web Audio and an adjustable gap (Settings, default 120 ms).

```bash
python -m pip install -r scripts/requirements.txt   # edge-tts + a bundled ffmpeg (works on Windows)
python scripts/generate_audio.py                     # voice en-US-GuyNeural, rate -15%
python scripts/generate_audio.py --rate=-25% --voice en-US-AriaNeural --pad-ms 200
python scripts/generate_audio.py --list-voices
```

Cue schedule for indoor workouts:

- warm-up start: "Warm up, 15 minutes"; cool-down start: "Cool down, 5 minutes"
- 5-second spoken countdown into ("5 … 1, go") and out of every work interval
- rest longer than 30 s before a work interval: "Next interval starting in fifteen seconds: 205 to 212 watts for 12 minutes" (moved slightly earlier if needed so it ends before the countdown)
- end: "Workout complete"

All remaining cues are scheduled on the AudioContext clock when you start or resume, and a looping silent `<audio>`
element keeps the iOS audio session alive (and enables lock-screen play/pause), so cues continue with the screen off.

## Deploy

`.github/workflows/deploy.yml` builds and publishes `dist/` to GitHub Pages on every push to `main`
(repo Settings → Pages → Source: **GitHub Actions**).
