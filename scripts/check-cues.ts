/**
 * Lists work intervals where the T-15 announcement forces the countdown down to 3 s, or where even that
 * does not fit. Usage: npx tsx scripts/check-cues.ts [ftp] [gapMs]
 */
import { readFileSync } from 'node:fs';
import { planCues } from '../src/lib/cues';
import { validatePlan } from '../src/data/schema';

const ftp = Number(process.argv[2] ?? 235);
const gapMs = Number(process.argv[3] ?? 120);
const manifest = JSON.parse(readFileSync(new URL('../public/audio/audio-manifest.json', import.meta.url), 'utf8'));
const clipMs = Object.fromEntries(Object.entries(manifest.clips).map(([k, v]) => [k, (v as { durationMs: number }).durationMs]));
const res = validatePlan(JSON.parse(readFileSync(new URL('../src/data/plan.json', import.meta.url), 'utf8')));
if (!res.ok) throw new Error(res.errors.join('\n'));

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
let short = 0;
let conflicts = 0;
for (const week of res.plan.weeks) {
  for (const day of week.days) {
    for (const w of day.workouts) {
      if (!w.phases.length) continue;
      const { cues, conflicts: cs } = planCues(w.phases, { ftp, maxNumber: manifest.maxNumber, clipMs, gapMs });
      const where = `Week ${week.number} ${days[day.offset]} ${w.title}`;
      const announces = cues.filter((c) => c.kind === 'announce');
      for (const a of announces) {
        const go = cues.find((c) => c.kind === 'go' && c.at > a.at)!;
        const count = cues.filter((c) => c.kind === 'countdown' && c.at >= go.at - 5 && c.at < go.at).length;
        if (count < 5) {
          short++;
          console.log(`3-s countdown: ${where} at ${Math.floor(go.at / 60)}:${String(Math.round(go.at % 60)).padStart(2, '0')}`);
        }
      }
      for (const c of cs) {
        conflicts++;
        console.log(`DOES NOT FIT: ${where} phase ${c.phaseIndex} (${w.phases[c.phaseIndex].name}), rest ${c.restSec}s, announcement ${c.announceSec.toFixed(1)}s`);
      }
    }
  }
}
console.log(`FTP ${ftp}, gap ${gapMs} ms: ${short} interval(s) with a 3-s countdown, ${conflicts} that do not fit.`);
