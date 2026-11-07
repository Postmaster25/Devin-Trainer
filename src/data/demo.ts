import type { Workout } from './schema';

export const DEMO_KEY = 'demo';

/** A ~4-minute ride that triggers every cue type: warm-up, T-15 announcement, countdowns, rest/easy, cool-down, completion. */
export const DEMO_WORKOUT: Workout = {
  type: 'DEMO',
  category: 'ride',
  title: 'DEMO 3 x 30s',
  summary: 'Short demo ride to hear every audio cue · about 4 min',
  indoor: true,
  totalMinutes: 4,
  notes: ['Not part of the plan. Listen for the warm-up, the 15-second announcements, the countdowns, cool-down and completion.'],
  phases: [
    { name: 'Easy', kind: 'warmup', durationSec: 45, group: 'Warm-up', power: { lowPct: 50, highPct: 60 }, hr: 'under 130', rpe: '2' },
    { name: 'Hard', kind: 'work', durationSec: 30, group: 'Main set', power: { lowPct: 105, highPct: 110 }, hr: '155–165', rpe: '8', rep: { index: 1, count: 3 } },
    { name: 'Recovery', kind: 'recovery', durationSec: 45, group: 'Main set', power: { highPct: 55 }, hr: 'under 140', rpe: '2' },
    { name: 'Hard', kind: 'work', durationSec: 30, group: 'Main set', power: { lowPct: 105, highPct: 110 }, hr: '155–165', rpe: '8', rep: { index: 2, count: 3 } },
    { name: 'Easy', kind: 'recovery', durationSec: 20, group: 'Main set', power: { highPct: 55 }, rpe: '2' },
    { name: 'Hard', kind: 'work', durationSec: 20, group: 'Main set', power: { lowPct: 120 }, hr: '160+', rpe: '9', rep: { index: 3, count: 3 } },
    { name: 'Spin easy', kind: 'cooldown', durationSec: 60, group: 'Cool-down', power: { highPct: 55 }, rpe: '1–2' },
  ],
};
