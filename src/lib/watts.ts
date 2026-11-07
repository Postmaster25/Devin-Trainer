import type { Phase, PowerTarget, Workout } from '../data/schema';

export type Watts = { low?: number; high?: number };

export const wattsFromPct = (pct: number, ftp: number) => Math.round((ftp * pct) / 100);

/** Absolute watts at the given FTP. Falls back to documented watts if a percent is missing. */
export function resolveWatts(power: PowerTarget | undefined, ftp: number): Watts | undefined {
  if (!power) return undefined;
  const low = power.lowPct !== undefined ? wattsFromPct(power.lowPct, ftp) : power.lowW;
  const high = power.highPct !== undefined ? wattsFromPct(power.highPct, ftp) : power.highW;
  if (low === undefined && high === undefined) return undefined;
  return { low, high };
}

export function fmtWatts(w: Watts | undefined): string {
  if (!w) return '';
  if (w.low !== undefined && w.high !== undefined) return w.low === w.high ? `${w.low} W` : `${w.low}–${w.high} W`;
  if (w.high !== undefined) return `≤${w.high} W`;
  return `≥${w.low} W`;
}

export const fmtPower = (power: PowerTarget | undefined, ftp: number) => fmtWatts(resolveWatts(power, ftp));

/** The main-set work phase that represents a workout's target. */
export function primaryWorkPhase(w: Workout): Phase | undefined {
  return (
    w.phases.find((p) => p.kind === 'work' && p.group === 'Main set' && p.power) ??
    w.phases.find((p) => p.kind === 'work' && !p.group?.startsWith('Warm-up') && p.power)
  );
}
