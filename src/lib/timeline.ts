import type { Phase } from '../data/schema';

export type Timeline = { phases: Phase[]; starts: number[]; total: number };

export function buildTimeline(phases: Phase[]): Timeline {
  const starts: number[] = [];
  let t = 0;
  for (const p of phases) {
    starts.push(t);
    t += p.durationSec;
  }
  return { phases, starts, total: t };
}

export type Position = { index: number; phase: Phase; start: number; elapsedInPhase: number; remainingInPhase: number };

export function positionAt(tl: Timeline, elapsed: number): Position | undefined {
  if (!tl.phases.length) return undefined;
  const e = Math.min(Math.max(0, elapsed), tl.total);
  let i = tl.starts.length - 1;
  while (i > 0 && tl.starts[i] > e) i--;
  if (e >= tl.starts[i] + tl.phases[i].durationSec && i < tl.phases.length - 1) i++;
  const start = tl.starts[i];
  const phase = tl.phases[i];
  return { index: i, phase, start, elapsedInPhase: e - start, remainingInPhase: Math.max(0, start + phase.durationSec - e) };
}
