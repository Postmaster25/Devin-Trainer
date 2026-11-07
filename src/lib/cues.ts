import type { Phase, PowerTarget } from '../data/schema';
import { buildTimeline } from './timeline';
import { resolveWatts } from './watts';

/** A spoken cue: a sequence of clip ids starting at `at` seconds into the workout. */
export type Cue = { at: number; clips: string[]; kind: CueKind };
export type CueKind = 'countdown' | 'go' | 'announce' | 'phase' | 'complete';

export type CueOptions = {
  ftp: number;
  /** Highest number with a dedicated clip (manifest.maxNumber). */
  maxNumber?: number;
  /** Clip durations in ms, used to keep announcements clear of the countdown. */
  clipMs?: Record<string, number>;
  gapMs?: number;
};

const COUNTDOWN = 5;
const ANNOUNCE_LEAD = 15;
const ANNOUNCE_MIN_REST = 30;
const ONES = 20;

export function numberClips(n: number, maxNumber = 400): string[] {
  n = Math.round(n);
  if (n < 0) return [];
  if (n <= maxNumber) return [`n${n}`];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [...numberClips(hundreds, maxNumber), 'hundred', ...(rest ? numberClips(rest, maxNumber) : [])].filter(
    (c) => c !== 'n0' || n === 0,
  );
}

export function durationClips(sec: number, maxNumber = 400): string[] {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const out: string[] = [];
  // Durations of 2 hours or less read as minutes ("90 minutes").
  const mins = h && s > 7200 ? m : h * 60 + m;
  if (h && s > 7200) out.push(...numberClips(h, maxNumber), h === 1 ? 'hour' : 'hours');
  if (mins) out.push(...numberClips(mins, maxNumber), mins === 1 ? 'minute' : 'minutes');
  if (r || !out.length) out.push(...numberClips(r, maxNumber), r === 1 ? 'second' : 'seconds');
  return out;
}

export function wattClips(power: PowerTarget | undefined, ftp: number, maxNumber = 400): string[] {
  const w = resolveWatts(power, ftp);
  if (!w) return [];
  if (w.low !== undefined && w.high !== undefined && w.low !== w.high) {
    return [...numberClips(w.low, maxNumber), 'to', ...numberClips(w.high, maxNumber), 'watts'];
  }
  const v = w.low ?? w.high!;
  return [...numberClips(v, maxNumber), 'watts'];
}

export function cueLengthSec(clips: string[], clipMs: Record<string, number> | undefined, gapMs: number): number {
  if (!clipMs) return 0;
  return clips.reduce((a, c) => a + (clipMs[c] ?? 600) / 1000, 0) + (Math.max(0, clips.length - 1) * gapMs) / 1000;
}

/**
 * Cue schedule:
 * - warm-up / cool-down start: name + duration
 * - every work interval: 5-second countdown into it ("5 … 1, go") and out of it ("5 … 1")
 * - rest > 30 s before a work interval: at T-15 "Next interval starting in 15 seconds: {watts} watts for {duration}"
 * - end of ride: "workout complete"
 */
export function buildCues(phases: Phase[], opts: CueOptions): Cue[] {
  const { ftp, maxNumber = 400, clipMs, gapMs = 120 } = opts;
  const tl = buildTimeline(phases);
  const cues: Cue[] = [];
  const num = (n: number) => numberClips(n, maxNumber);

  const groupDuration = (from: number) => {
    const g = phases[from].group;
    let sec = 0;
    for (let i = from; i < phases.length && phases[i].group === g; i++) sec += phases[i].durationSec;
    return sec;
  };

  phases.forEach((p, i) => {
    const start = tl.starts[i];
    const end = start + p.durationSec;
    const prev = phases[i - 1];
    const startsGroup = !prev || prev.group !== p.group;

    if (startsGroup && p.group?.startsWith('Warm-up')) {
      cues.push({ at: start, kind: 'phase', clips: ['warm_up', ...durationClips(groupDuration(i), maxNumber)] });
    }
    if (p.kind === 'cooldown' && (!prev || prev.kind !== 'cooldown')) {
      cues.push({ at: start, kind: 'phase', clips: ['cool_down', ...durationClips(groupDuration(i), maxNumber)] });
    }

    if (p.kind === 'work') {
      if (prev && prev.kind !== 'work' && prev.durationSec > ANNOUNCE_MIN_REST) {
        const clips = ['next_interval_15', ...wattClips(p.power, ftp, maxNumber), 'for', ...durationClips(p.durationSec, maxNumber)];
        // Finish the announcement at least half a second before the countdown begins.
        const latestEnd = start - COUNTDOWN - 0.5;
        const len = cueLengthSec(clips, clipMs, gapMs);
        const at = Math.max(tl.starts[i - 1], Math.min(start - ANNOUNCE_LEAD, latestEnd - len));
        cues.push({ at, kind: 'announce', clips });
      }
      if (prev && prev.kind !== 'work') {
        for (let k = COUNTDOWN; k >= 1; k--) {
          if (start - k >= tl.starts[i - 1]) cues.push({ at: start - k, kind: 'countdown', clips: num(k) });
        }
        cues.push({ at: start, kind: 'go', clips: ['go'] });
      }
      if (p.durationSec >= 2 * COUNTDOWN) {
        for (let k = COUNTDOWN; k >= 1; k--) cues.push({ at: end - k, kind: 'countdown', clips: num(k) });
        const next = phases[i + 1];
        if (next && next.kind === 'recovery') cues.push({ at: end, kind: 'phase', clips: [next.durationSec > ONES ? 'rest' : 'easy'] });
      }
    }
  });

  if (phases.length) cues.push({ at: tl.total, kind: 'complete', clips: ['workout_complete'] });
  return cues.sort((a, b) => a.at - b.at);
}

export const allClipIds = (cues: Cue[]) => [...new Set(cues.flatMap((c) => c.clips))];
