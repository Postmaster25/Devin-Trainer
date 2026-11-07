import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import plan from '../data/plan.json';
import { validatePlan, type Phase } from '../data/schema';
import { addDays, planDate, weekContaining, daysBetween } from './dates';
import { buildCues, durationClips, numberClips, wattClips, allClipIds } from './cues';
import { buildTimeline, positionAt } from './timeline';
import { TimerEngine } from './engine';
import { resolveWatts, fmtPower } from './watts';
import { nextSameTypeSlot, resolveWorkout, rawWorkout, hasTimer } from './planUtils';

const manifest = JSON.parse(readFileSync(new URL('../../public/audio/audio-manifest.json', import.meta.url), 'utf8'));

describe('plan.json', () => {
  const result = validatePlan(plan);
  it('validates against the schema', () => expect(result.ok).toBe(true));
  const p = result.ok ? result.plan : undefined!;
  it('has 31 weeks of 7 days', () => {
    expect(p.weeks.map((w) => w.number)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    p.weeks.forEach((w) => expect(w.days.map((d) => d.offset)).toEqual([0, 1, 2, 3, 4, 5, 6]));
  });
  it('keeps short titles and expands warm-ups', () => {
    const w9 = rawWorkout(p, '9-2-0')!;
    expect(w9.title).toBe('SS 2 x 15');
    expect(w9.phases.filter((x) => x.group === 'Warm-up (WU-S)').map((x) => x.durationSec)).toEqual([360, 30, 60, 30, 60, 60]);
    const v4 = rawWorkout(p, '23-3-0')!;
    expect(v4.title).toBe('V4 4 x 4');
    expect(v4.phases.filter((x) => x.group === 'Warm-up (WU-V)').map((x) => x.durationSec)).toEqual([480, 180, 30, 30, 30, 30, 30, 30, 60]);
  });
  it('indoor timed workout totals match the stated minutes', () => {
    for (const w of p.weeks) for (const d of w.days) for (const wo of d.workouts) {
      if (hasTimer(wo) && wo.type !== 'V30') expect(buildTimeline(wo.phases).total / 60).toBe(wo.totalMinutes);
    }
  });
  it('marks RP1, SEG and L1 outdoor', () => {
    expect(rawWorkout(p, '22-5-0')!.indoor).toBe(false);
    expect(rawWorkout(p, '21-5-0')!.indoor).toBe(false);
    expect(rawWorkout(p, '1-5-0')!.indoor).toBe(false);
  });
  it('stores %FTP that reproduces documented watts at the reference FTP', () => {
    for (const w of p.weeks) for (const d of w.days) for (const wo of d.workouts) for (const ph of wo.phases) {
      if (!ph.power) continue;
      const r = resolveWatts(ph.power, p.referenceFtp)!;
      if (ph.power.lowW) expect(r.low).toBe(ph.power.lowW);
      if (ph.power.highW) expect(r.high).toBe(ph.power.highW);
    }
  });
});

describe('dates', () => {
  it('derives plan dates from the start date', () => {
    expect(planDate('2026-10-19', 1, 0)).toBe('2026-10-19');
    expect(planDate('2026-10-19', 31, 5)).toBe('2027-05-22');
    expect(addDays('2027-03-13', 1)).toBe('2027-03-14'); // across DST
    expect(daysBetween('2026-11-01', '2026-11-08')).toBe(7);
  });
  it('finds and clamps the current week', () => {
    expect(weekContaining('2026-10-19', '2026-11-07', 1, 31)).toBe(3);
    expect(weekContaining('2026-12-01', '2026-11-07', 1, 31)).toBe(1);
    expect(weekContaining('2025-01-01', '2026-11-07', 1, 31)).toBe(31);
  });
});

describe('watts', () => {
  it('computes absolute watts from FTP', () => {
    expect(fmtPower({ lowPct: 87.23, highPct: 90.21 }, 235)).toBe('205–212 W');
    expect(fmtPower({ lowPct: 87.23, highPct: 90.21 }, 260)).toBe('227–235 W');
    expect(fmtPower({ highPct: 55.32 }, 235)).toBe('≤130 W');
  });
});

describe('cue vocabulary', () => {
  it('composes numbers and durations', () => {
    expect(numberClips(205)).toEqual(['n205']);
    expect(numberClips(450)).toEqual(['n4', 'hundred', 'n50']);
    expect(numberClips(500)).toEqual(['n5', 'hundred']);
    expect(durationClips(720)).toEqual(['n12', 'minutes']);
    expect(durationClips(90)).toEqual(['n1', 'minute', 'n30', 'seconds']);
    expect(durationClips(30)).toEqual(['n30', 'seconds']);
    expect(wattClips({ lowPct: 87.23 }, 235)).toEqual(['n205', 'watts']);
    expect(wattClips({ lowPct: 87.23, highPct: 90.21 }, 235)).toEqual(['n205', 'to', 'n212', 'watts']);
  });
  it('every clip used by every workout exists in the manifest', () => {
    const p = validatePlan(plan);
    if (!p.ok) throw new Error();
    for (const ftp of [150, 235, 400]) {
      for (const w of p.plan.weeks) for (const d of w.days) for (const wo of d.workouts) {
        if (!hasTimer(wo)) continue;
        for (const id of allClipIds(buildCues(wo.phases, { ftp, maxNumber: manifest.maxNumber }))) expect(manifest.clips[id], id).toBeTruthy();
      }
    }
  });
});

describe('cue schedule', () => {
  const work = (sec: number, extra: Partial<Phase> = {}): Phase => ({ name: 'Sweet spot', kind: 'work', durationSec: sec, group: 'Main set', power: { lowPct: 87.23 }, ...extra });
  const rec = (sec: number): Phase => ({ name: 'Recovery', kind: 'recovery', durationSec: sec, group: 'Main set', power: { highPct: 55.32 } });
  const phases: Phase[] = [
    { name: 'Easy', kind: 'warmup', durationSec: 60, group: 'Warm-up (WU-S)' },
    work(720), rec(300), work(720),
    { name: 'Spin easy', kind: 'cooldown', durationSec: 300, group: 'Cool-down (CD-5)' },
  ];
  const cues = buildCues(phases, { ftp: 235 });
  const at = (t: number) => cues.filter((c) => c.at === t).map((c) => c.clips.join(' '));

  it('announces the warm-up and the next interval at T-15', () => {
    expect(at(0)).toEqual(['warm_up n1 minute']);
    expect(at(45)).toEqual(['next_interval_15 n205 watts for n12 minutes']);
  });
  it('counts down 5..1 into and out of each work interval', () => {
    expect([55, 56, 57, 58, 59].flatMap(at)).toEqual(['n5', 'n4', 'n3', 'n2', 'n1']);
    expect(at(60)).toEqual(['go']);
    expect([775, 776, 777, 778, 779].flatMap(at)).toEqual(['n5', 'n4', 'n3', 'n2', 'n1']);
    expect(at(780)).toEqual(['rest']);
  });
  it('announces cool-down duration and completion', () => {
    const end = 60 + 720 + 300 + 720;
    expect(at(end)).toEqual(['cool_down n5 minutes']);
    expect(at(end + 300)).toEqual(['workout_complete']);
  });
  it('skips the T-15 announcement when rest is 30 s or less', () => {
    const short = buildCues([rec(60), work(30), rec(15), work(30)], { ftp: 235 });
    expect(short.filter((c) => c.kind === 'announce')).toHaveLength(1);
  });
  it('moves long announcements earlier so they finish before the countdown', () => {
    const clipMs = Object.fromEntries(Object.entries(manifest.clips).map(([k, v]) => [k, (v as { durationMs: number }).durationMs]));
    const c = buildCues([rec(300), work(600, { power: { lowPct: 87.23, highPct: 90.21 } })], { ftp: 235, clipMs, gapMs: 120 });
    const ann = c.find((x) => x.kind === 'announce')!;
    const len = ann.clips.reduce((a, id) => a + clipMs[id] / 1000, 0) + (ann.clips.length - 1) * 0.12;
    expect(ann.at + len).toBeLessThanOrEqual(300 - 5);
    expect(ann.at).toBeGreaterThanOrEqual(300 - 30);
  });
});

describe('timeline and engine', () => {
  it('locates the current phase', () => {
    const tl = buildTimeline([{ name: 'a', kind: 'steady', durationSec: 10 }, { name: 'b', kind: 'work', durationSec: 20 }]);
    expect(positionAt(tl, 0)!.index).toBe(0);
    expect(positionAt(tl, 10)!.index).toBe(1);
    expect(positionAt(tl, 25)!.remainingInPhase).toBe(5);
    expect(positionAt(tl, 99)!.remainingInPhase).toBe(0);
  });
  it('pauses and resumes on the performance clock', () => {
    let now = 0;
    const e = new TimerEngine(60, () => now);
    e.start();
    now = 10_000;
    expect(e.elapsed()).toBe(10);
    e.pause();
    now = 50_000;
    expect(e.elapsed()).toBe(10);
    e.resume();
    now = 55_000;
    expect(e.elapsed()).toBe(15);
    now = 200_000;
    expect(e.elapsed()).toBe(60);
    expect(e.state).toBe('finished');
  });
});

describe('repeat a missed workout', () => {
  const p = validatePlan(plan);
  if (!p.ok) throw new Error();
  it('targets the next session of the same type', () => {
    expect(nextSameTypeSlot(p.plan, '9-2-0')).toBe('10-2-0');
    expect(nextSameTypeSlot(p.plan, '17-3-0')).toBe('19-3-0');
  });
  it('substitutes the repeated workout in the target slot', () => {
    const r = resolveWorkout(p.plan, '10-2-0', { missed: { '9-2-0': true }, repeats: { '10-2-0': '9-2-0' } })!;
    expect(r.workout.title).toBe('SS 2 x 15');
    expect(r.repeatOf).toBe('9-2-0');
  });
});

describe('plan import validation', () => {
  it('rejects malformed plans with readable errors', () => {
    const r = validatePlan({ schemaVersion: 1, name: 'x', referenceFtp: 235, weeks: [{ number: 1, days: [{ offset: 9 }] }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/weeks\.0\.days\.0\.offset/);
  });
});
