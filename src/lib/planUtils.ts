import type { Phase, Plan, Week, Workout } from '../data/schema';
import type { Progress } from './storage';
import { DEMO_KEY, DEMO_WORKOUT } from '../data/demo';

export type WorkoutRef = { week: number; offset: number; index: number };

export const workoutKey = (r: WorkoutRef) => `${r.week}-${r.offset}-${r.index}`;

export function parseKey(key: string): WorkoutRef | undefined {
  const m = key.match(/^(\d+)-(\d+)-(\d+)$/);
  return m ? { week: +m[1], offset: +m[2], index: +m[3] } : undefined;
}

export const findWeek = (plan: Plan, n: number): Week | undefined => plan.weeks.find((w) => w.number === n);

export function rawWorkout(plan: Plan, key: string): Workout | undefined {
  const r = parseKey(key);
  if (!r) return undefined;
  return findWeek(plan, r.week)?.days.find((d) => d.offset === r.offset)?.workouts[r.index];
}

export type ResolvedWorkout = { key: string; ref: WorkoutRef; workout: Workout; repeatOf?: string; demo?: boolean };

/** The workout scheduled at `key`, replaced by the repeated workout if a repeat targets this slot. */
export function resolveWorkout(plan: Plan, key: string, progress: Progress): ResolvedWorkout | undefined {
  if (key === DEMO_KEY) return { key, ref: { week: 0, offset: 0, index: 0 }, workout: DEMO_WORKOUT, demo: true };
  const ref = parseKey(key);
  const original = rawWorkout(plan, key);
  if (!ref || !original) return undefined;
  const src = progress.repeats[key];
  const repeated = src ? rawWorkout(plan, src) : undefined;
  return repeated ? { key, ref, workout: repeated, repeatOf: src } : { key, ref, workout: original };
}

/** Display name for a step, e.g. "Sweet spot rep 1 of 2". */
export function stepName(p: Phase): string {
  if (!p.rep) return p.name;
  const set = p.set ? `Set ${p.set.index} of ${p.set.count} · ` : '';
  return `${set}${p.name} rep ${p.rep.index} of ${p.rep.count}`;
}

/** Group label without the building-block code, e.g. "Warm-up (WU-S)" -> "Warm-up". */
export const groupLabel = (group: string | undefined) => (group ?? '').replace(/\s*\([^)]*\)\s*$/, '');

export const hasTimer = (w: Workout) => w.category === 'ride' && w.indoor && w.phases.length > 0;

/** All workout keys in plan order. */
export function orderedKeys(plan: Plan): string[] {
  const keys: string[] = [];
  for (const w of [...plan.weeks].sort((a, b) => a.number - b.number)) {
    for (const d of [...w.days].sort((a, b) => a.offset - b.offset)) {
      d.workouts.forEach((_, index) => keys.push(workoutKey({ week: w.number, offset: d.offset, index })));
    }
  }
  return keys;
}

/** Next scheduled slot after `key` with the same workout type (where a repeat would go). */
export function nextSameTypeSlot(plan: Plan, key: string): string | undefined {
  const type = rawWorkout(plan, key)?.type;
  if (!type) return undefined;
  const keys = orderedKeys(plan);
  const i = keys.indexOf(key);
  return keys.slice(i + 1).find((k) => rawWorkout(plan, k)?.type === type);
}
