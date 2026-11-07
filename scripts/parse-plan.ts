/**
 * Parses "Mueller Sub-30 Plan.md" into src/data/plan.json.
 * Run: npm run parse-plan
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlan, type Phase, type PowerTarget, type Workout, type Week, type Day } from '../src/data/schema.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(root, 'Mueller Sub-30 Plan.md');
const OUT = resolve(root, 'src/data/plan.json');

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const warnings: string[] = [];
const warn = (msg: string) => warnings.push(msg);

// ---------- markdown helpers ----------

type Table = { header: string[]; rows: string[][] };

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** All tables that appear after `heading` and before the next heading of the same or higher level. */
function tablesUnder(lines: string[], heading: string): Table[] {
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) throw new Error(`Heading not found: ${heading}`);
  const level = heading.match(/^#+/)![0].length;
  const tables: Table[] = [];
  let i = start + 1;
  while (i < lines.length) {
    const l = lines[i];
    const h = l.match(/^(#+)\s/);
    if (h && h[1].length <= level) break;
    if (l.trim().startsWith('|')) {
      const block: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) block.push(lines[i++]);
      const [head, , ...rest] = block;
      tables.push({ header: splitRow(head), rows: rest.map(splitRow) });
      continue;
    }
    i++;
  }
  return tables;
}

function headingsMatching(lines: string[], re: RegExp): string[] {
  return lines.filter((l) => re.test(l.trim())).map((l) => l.trim());
}

// ---------- value parsers ----------

let REF_FTP = 235;
const pct = (w: number) => Math.round((w / REF_FTP) * 10000) / 100;

function range(low: number | undefined, high: number | undefined, note?: string): PowerTarget {
  const t: PowerTarget = {};
  if (low !== undefined) Object.assign(t, { lowPct: pct(low), lowW: low });
  if (high !== undefined) Object.assign(t, { highPct: pct(high), highW: high });
  if (note) t.note = note;
  return t;
}

/** "130 to 165" | "130 or less" | "250 to 265 hard, ..." (first part) */
function parsePower(text: string): PowerTarget | undefined {
  let m = text.match(/(\d+)\s+to\s+(\d+)/);
  if (m) return range(+m[1], +m[2]);
  m = text.match(/(\d+)\s+or less/);
  if (m) return range(undefined, +m[1]);
  return undefined;
}

function parseClock(text: string): number | undefined {
  const m = text.match(/^(\d+):(\d{2})$/);
  return m ? +m[1] * 60 + +m[2] : undefined;
}

const tidy = (s: string) => s.replace(/(\d)\s+to\s+(\d)/g, '$1–$2').trim();

// ---------- building blocks ----------

type BlockStep = Omit<Phase, 'group'>;
type Block = { id: string; label: string; steps: BlockStep[] };

function parseBuildingBlocks(table: Table): { blocks: Record<string, Block>; rec: BlockStep } {
  const blocks: Record<string, Block> = {};
  let rec: BlockStep | undefined;
  for (const [blockCell, step, time, power, , hr] of table.rows) {
    const id = blockCell.split(/\s/)[0];
    const isCooldown = id.startsWith('CD');
    const label = isCooldown ? `Cool-down (${id})` : id.startsWith('WU') ? `Warm-up (${id})` : id;
    if (id === 'REC') {
      rec = { name: 'Recovery', kind: 'recovery', durationSec: 60, power: parsePower(power), hr: tidy(hr) };
      continue;
    }
    const b = (blocks[id] ??= { id, label, steps: [] });
    const reps = step.match(/^(\d+) x \((\d+) s hard, (\d+) s easy\)$/);
    if (reps) {
      const count = +reps[1];
      const [hardTxt, easyTxt = ''] = power.split(',');
      for (let i = 1; i <= count; i++) {
        b.steps.push({ name: 'Hard', kind: 'work', durationSec: +reps[2], power: parsePower(hardTxt), hr, rep: { index: i, count } });
        b.steps.push({ name: 'Easy', kind: 'recovery', durationSec: +reps[3], power: parsePower(easyTxt) });
      }
      const secs = parseClock(time);
      if (secs !== count * (+reps[2] + +reps[3])) warn(`${id} "${step}" time ${time} does not match reps`);
      continue;
    }
    const durationSec = parseClock(time);
    if (!durationSec) throw new Error(`Bad time "${time}" in block ${id}`);
    b.steps.push({ name: step, kind: isCooldown ? 'cooldown' : 'warmup', durationSec, power: parsePower(power), hr });
  }
  if (!rec) throw new Error('REC block missing');
  return { blocks, rec };
}

// ---------- workout library ----------

type LibEntry = {
  id: string; name: string; mainSet: string; power: string; pctText: string;
  hr: string; cadence: string; rpe: string; wucd: string;
};

function parseLibrary(table: Table): Record<string, LibEntry> {
  const lib: Record<string, LibEntry> = {};
  for (const [id, name, mainSet, power, pctText, hr, cadence, rpe, wucd] of table.rows) {
    lib[id] = { id, name, mainSet, power, pctText, hr, cadence, rpe, wucd };
  }
  return lib;
}

// ---------- workout builders ----------

let BLOCKS: Record<string, Block>;
let REC: BlockStep;
let LIB: Record<string, LibEntry>;

const min = (m: number) => Math.round(m * 60);

function blockPhases(id: string, extraNote?: string): Phase[] {
  const b = BLOCKS[id];
  if (!b) throw new Error(`Unknown block ${id}`);
  return b.steps.map((s, i) => ({ ...s, ...(s.hr ? { hr: tidy(s.hr) } : {}), group: b.label, ...(i === 0 && extraNote ? { note: extraNote } : {}) }));
}

function warmupFor(type: string): string | undefined {
  return LIB[type].wucd.match(/WU-[A-Z]/)?.[0];
}
function cooldownFor(type: string): string | undefined {
  return LIB[type].wucd.match(/CD-\d+/)?.[0];
}

function libTargets(type: string) {
  const e = LIB[type];
  return { hr: tidy(e.hr), cadence: tidy(e.cadence), rpe: tidy(e.rpe) };
}

function recovery(sec: number, name = 'Recovery'): Phase {
  return { ...REC, name, durationSec: sec, group: 'Main set' };
}

function repeated(
  reps: number, workSec: number, recSec: number,
  work: Omit<Phase, 'durationSec' | 'rep' | 'kind'>,
): Phase[] {
  const out: Phase[] = [];
  for (let i = 1; i <= reps; i++) {
    out.push({ ...work, kind: 'work', durationSec: workSec, rep: { index: i, count: reps } });
    if (i < reps) out.push(recovery(recSec));
  }
  return out;
}

const sumMinutes = (phases: Phase[]) => phases.reduce((a, p) => a + p.durationSec, 0) / 60;

const WORK_NAMES: Record<string, string> = { SS: 'Sweet spot', T: 'Threshold', V4: 'VO2', RP1: 'Climb pace', RP2: 'Surge' };
const LONG_NAMES: Record<string, string> = { SS: 'Sweet spot', T: 'Threshold', V4: 'VO2', RP1: 'Climb pace' };

const fmtRec = (m: number) => `${m} min recovery`;

function buildRide(cell: string): Workout {
  let m: RegExpMatchArray | null;

  // Parenthetical note at the end, e.g. "(instead of T, after the Mar 13 time trial)"
  const notes: string[] = [];
  const paren = cell.match(/\s*\(([^)]*)\)\s*$/);
  if (paren) {
    notes.push(rewriteNote(paren[1]));
    cell = cell.slice(0, paren.index).trim();
  }

  if ((m = cell.match(/^E1 easy, (\d+)$/))) {
    const total = +m[1];
    const t = libTargets('E1');
    return {
      type: 'E1', category: 'ride', title: `E1 ${total}`, indoor: true, totalMinutes: total,
      summary: `Easy ride, ${total} min steady (Z2)`, notes,
      phases: [{ name: 'Easy ride', kind: 'steady', durationSec: min(total), group: 'Steady', power: parsePower(LIB.E1.power), ...t }],
    };
  }

  if ((m = cell.match(/^E1 plus (\d+) x (\d+) s openers at minute (\d+), REC (\d+), (\d+) to (\d+) W, (\d+)$/))) {
    const [reps, sec, at, rec, lo, hi, total] = m.slice(1).map(Number);
    const t = libTargets('E1');
    const easy = parsePower(LIB.E1.power);
    const openers = repeated(reps, sec, min(rec), { name: 'Opener', group: 'Openers', power: range(lo, hi), cadence: t.cadence });
    openers.forEach((p) => p.kind === 'recovery' && (p.group = 'Openers'));
    const used = at * 60 + openers.reduce((a, p) => a + p.durationSec, 0);
    return {
      type: 'E1', category: 'ride', title: `E1 ${total} + ${reps} x ${sec}s`, indoor: true, totalMinutes: total,
      summary: `Easy ${total} min with ${reps} × ${sec} s openers at minute ${at}, ${rec} min easy between`, notes,
      phases: [
        { name: 'Easy ride', kind: 'steady', durationSec: min(at), group: 'Steady', power: easy, ...t },
        ...openers,
        { name: 'Easy ride', kind: 'steady', durationSec: total * 60 - used, group: 'Steady', power: easy, ...t },
      ],
    };
  }

  if ((m = cell.match(/^L1(?: easy)?, (\d+)$/))) {
    const total = +m[1];
    const t = libTargets('L1');
    if (total > 90) notes.push('Eat and drink after 90 min.');
    return {
      type: 'L1', category: 'ride', title: `L1 ${total}`, indoor: false, totalMinutes: total,
      summary: `Long ride, ${total} min steady, HR ${tidy(LIB.L1.hr)}`, notes,
      phases: [{ name: 'Long ride', kind: 'steady', durationSec: min(total), group: 'Steady', power: parsePower(LIB.L1.power), ...t }],
    };
  }

  if ((m = cell.match(/^(SS|T|V4|RP1) (\d+) x (\d+), REC (\d+)(?:, (\d+)(?: to (\d+))? W)?, (\d+)$/))) {
    const type = m[1];
    const [reps, work, rec] = [+m[2], +m[3], +m[4]];
    const total = +m[7];
    const lo = m[5] ? +m[5] : undefined;
    const hi = m[6] ? +m[6] : lo;
    const power = lo !== undefined ? range(lo, hi) : parsePower(LIB[type].power);
    const t = libTargets(type);
    const wu = warmupFor(type)!;
    const indoor = type !== 'RP1';
    const phases: Phase[] = [
      ...blockPhases(wu, type === 'RP1' ? 'On the ride in' : undefined),
      ...repeated(reps, min(work), min(rec), { name: WORK_NAMES[type], group: 'Main set', power, ...t }),
    ];
    const cd = cooldownFor(type) ?? 'CD-5';
    const remaining = total - sumMinutes(phases) - sumMinutes(blockPhases(cd));
    if (remaining > 0) {
      phases.push({ name: 'Rest of ride easy', kind: 'steady', durationSec: min(remaining), group: 'Steady', power: parsePower(LIB.L1.power), hr: tidy(LIB.L1.hr) });
    }
    phases.push(...blockPhases(cd));
    if (type === 'RP1') notes.push('Outdoors, ride the efforts by heart rate (155–165 bpm). On Mueller, sub-30 pace is about 6.3 mph, or about 1.05 mi and 305 ft per 10 minutes.');
    return {
      type, category: 'ride', title: `${type} ${reps} x ${work}`, indoor, totalMinutes: total,
      summary: `${LONG_NAMES[type]} ${reps} × ${work} min, ${fmtRec(rec)}${type === 'RP1' ? `, HR ${tidy(LIB.RP1.hr)}` : ''} · ${total} min`,
      notes, phases,
    };
  }

  if ((m = cell.match(/^V30 (\d+) sets x (\d+) reps, (\d+) between sets, hard (\d+) to (\d+) W, (\d+)$/))) {
    const [sets, reps, between, lo, hi, total] = m.slice(1).map(Number);
    const t = libTargets('V30');
    const phases: Phase[] = [...blockPhases('WU-V')];
    for (let s = 1; s <= sets; s++) {
      for (let r = 1; r <= reps; r++) {
        phases.push({ name: 'Hard', kind: 'work', durationSec: 30, group: 'Main set', power: range(lo, hi), ...t, rep: { index: r, count: reps }, set: { index: s, count: sets } });
        phases.push({ ...recovery(15, 'Easy'), set: { index: s, count: sets } });
      }
      if (s < sets) phases.push(recovery(min(between), 'Easy between sets'));
    }
    phases.push(...blockPhases('CD-5'));
    return {
      type: 'V30', category: 'ride', title: `V30 ${sets} x ${reps} x 30/15`, indoor: true, totalMinutes: total,
      summary: `VO2 30/15: ${sets} sets × ${reps} reps of 30 s hard, 15 s easy, ${between} min between sets · ${total} min`,
      notes, phases,
    };
  }

  if ((m = cell.match(/^TEST30 1 x 30, record the average, (\d+)$/))) {
    const total = +m[1];
    const e = LIB.TEST30;
    const power = parsePower(e.power) ?? parsePower(e.mainSet);
    return {
      type: 'TEST30', category: 'ride', title: 'TEST30 1 x 30', indoor: true, totalMinutes: total,
      summary: `30-minute all-out test, even pace; record the average · ${total} min`, notes,
      phases: [
        ...blockPhases('WU-V'),
        { name: '30-min test', kind: 'work', durationSec: 30 * 60, group: 'Main set', power: power ? { ...power, note: 'start here and hold it' } : undefined, hr: tidy(e.hr), rpe: tidy(e.rpe), cadence: e.cadence, note: 'All out, even pace. Record the average power.' },
        ...blockPhases('CD-10'),
      ],
    };
  }

  if ((m = cell.match(/^RAMP, (\d+), trainer$/))) {
    const total = +m[1];
    notes.push('Same ramp workout as Sep 28, to exhaustion. Record MAP (best 1 min); FTP is 75% of MAP. Run it in your trainer app.');
    return { type: 'RAMP', category: 'ride', title: 'RAMP', indoor: true, totalMinutes: total, summary: `Ramp test to exhaustion on the trainer · ${total} min`, notes, phases: [] };
  }

  if ((m = cell.match(/^SEG, about (\d+)$/))) {
    const total = +m[1];
    const e = LIB.SEG;
    notes.push('Warm up on the ride in with WU-V, rest 5 minutes at the start of the climb, then go. Log the time, average heart rate, weather and your weight. The time is the result; watts and heart rate are for the log.');
    const core: Phase[] = [
      ...blockPhases('WU-V', 'On the ride in'),
      { name: 'Rest at the start of the climb', kind: 'recovery', durationSec: 300, group: 'Main set' },
      { name: 'Segment effort', kind: 'work', durationSec: 30 * 60, group: 'Main set', hr: tidy(e.hr), rpe: tidy(e.rpe), note: 'Full effort. Target time 29:59 or faster (~30 min).' },
      ...blockPhases('CD-10'),
    ];
    const extra = total - sumMinutes(core);
    const phases = extra > 0
      ? [{ name: 'Ride in, easy', kind: 'steady' as const, durationSec: min(extra), group: 'Steady', power: parsePower(LIB.L1.power), hr: tidy(LIB.L1.hr) }, ...core]
      : core;
    return { type: 'SEG', category: 'ride', title: 'SEG', indoor: false, totalMinutes: total, summary: `Segment attempt, full effort · about ${total} min`, notes, phases };
  }

  throw new Error(`Unrecognised ride cell: "${cell}"`);
}

// ---------- notes ----------

const NOTE_REWRITES: Record<string, string> = {
  'instead of T, after the Mar 13 time trial': 'Sweet spot instead of threshold, since Saturday was a full-effort time trial.',
  'instead of T, after the Apr 10 climb effort': 'Sweet spot instead of threshold, since Saturday was a full-effort climb.',
};
function rewriteNote(n: string): string {
  return NOTE_REWRITES[n] ?? n;
}

type Placement = { day: number | 'week'; text: string };

/** Week-table notes rewritten without absolute dates and placed on the day they refer to. */
const NOTE_PLACEMENTS: Record<string, Placement[]> = {
  'Start of plan': [{ day: 'week', text: 'Start of plan.' }],
  'First sweet spot, Nov 18': [{ day: 2, text: 'First sweet spot session. Start only after about three straight weeks of 3+ hours of riding a week with no asthma flare; otherwise ride easy and try next week. Review the interval plan with your doctor first.' }],
  'Nov 24: 3-mile run check': [{ day: 1, text: '3-mile run check: run 3 miles without stopping, easy pace, no pain.' }],
  'Wed kept short before the Jan 16 ramp test. Repeat the Sep 28 ramp test exactly. Log MAP, maximum heart rate and your weight': [
    { day: 2, text: "Kept short before Saturday's ramp test." },
    { day: 5, text: 'Repeat the Sep 28 ramp test exactly (same workout and trainer). Log MAP, maximum heart rate and your weight. Compare with Sep 28: 313 W MAP, 235 W FTP.' },
  ],
  'Easy Saturday after Thursday VO2': [{ day: 5, text: 'Easy Saturday after Thursday VO2.' }],
  'Test Mar 4; keep Saturday easy': [
    { day: 3, text: "30-minute all-out test, replacing this Thursday's ride. 200 W or more means trail conditions or pacing are the gap; about 175 W means raise power. Log the average heart rate of the last 20 minutes as your new LTHR." },
    { day: 5, text: "Keep Saturday easy after Thursday's test." },
  ],
  'Farm time trial, race pace; compare with Apr 24 (19:22)': [{ day: 5, text: 'Farm time trial, race pace. Compare with Apr 24, 2026 (19:22).' }],
  'Climb on Farmington Canyon Road or another steady climb': [{ day: 5, text: 'Climb on Farmington Canyon Road or another steady climb.' }],
  'Farmington Canyon Road climb, full effort; compare with Aug 17 (20:50 at HR 155)': [{ day: 5, text: 'Farmington Canyon Road climb, full effort. Compare with Aug 17, 2026 (20:50 at HR 155).' }],
  'Shorter Saturday, since Thursday is V30': [{ day: 5, text: 'Shorter Saturday, since Thursday is V30.' }],
  'Target 30:30 or faster': [{ day: 5, text: 'Mueller race segment. Target 30:30 or faster.' }],
  'Target under 30:00': [{ day: 5, text: 'Mueller race segment. Target under 30:00.' }],
};

// ---------- non-ride days ----------

type Stage = { from: number; to: number; label: string; cells: string[] };

function parseStages(table: Table): Stage[] {
  return table.rows.map(([first, ...cells]) => {
    const m = first.match(/^(\d+)\.\s*([^,]+), weeks (\d+) to (\d+)/);
    if (!m) throw new Error(`Bad stage row: ${first}`);
    return { label: `Stage ${m[1]}: ${m[2].trim()}`, from: +m[3], to: +m[4], cells };
  });
}

function nonRide(cell: string, week: number, deload: boolean): Workout {
  const deloadNote = deload ? ['Deload week: cut volume by about a third.'] : [];
  if (/^Volt/i.test(cell)) {
    // "Volt, 1 to 2 light sets until May 4, then rest" -> light Volt through week 29, rest after.
    const light = cell.match(/^Volt, (.*) until May 4, then rest$/);
    if (light) {
      if (week >= 30) return restDay('Rest (Volt paused for the taper and race weeks)');
      return { type: 'VOLT', category: 'strength', title: 'Volt', indoor: true, summary: `Volt, ${light[1]}`, notes: deloadNote, phases: [] };
    }
    const detail = cell.match(/^Volt \((.*)\)$/)?.[1];
    return {
      type: 'VOLT', category: 'strength', title: 'Volt', indoor: true,
      summary: detail ? `Volt, ${detail}` : 'Volt total-body session (track and field distance plan)',
      notes: [...deloadNote, 'Add 2 to 3 core stability exercises at the end. No explosive work the day before the long ride.'],
      phases: [],
    };
  }
  if (/run/i.test(cell)) {
    const notes = [...deloadNote];
    if (week <= 2) notes.push('1 minute run, 1 minute walk for 20 minutes.');
    if (/strides/i.test(cell)) notes.push('4 to 6 strides: 15 s fast, 45 s easy.');
    notes.push('Easy means you could hold a conversation. Skip it if your calves or quads are tender.');
    return { type: 'RUN', category: 'run', title: 'Run', indoor: false, summary: cell, notes, phases: [] };
  }
  if (/^Rest/i.test(cell)) return restDay('Rest');
  throw new Error(`Unrecognised day cell: ${cell}`);
}

function restDay(summary: string): Workout {
  return { type: 'REST', category: 'rest', title: 'Rest', indoor: false, summary, notes: [], phases: [] };
}

// ---------- main ----------

function main() {
  const md = readFileSync(SOURCE, 'utf8');
  const lines = md.split(/\r?\n/);

  const ftpMatch = md.match(/\*\*FTP is (\d+) W\.\*\*/);
  if (ftpMatch) REF_FTP = +ftpMatch[1];

  const bb = parseBuildingBlocks(tablesUnder(lines, '### Building blocks')[0]);
  BLOCKS = bb.blocks;
  REC = bb.rec;
  LIB = parseLibrary(tablesUnder(lines, '### Workout library')[0]);
  const stages = parseStages(tablesUnder(lines, '## Weekly plan')[0]);
  const deloadWeeks = new Set(
    (md.match(/Every fourth week is a deload \(weeks ([\d, and]+)\)/)?.[1] ?? '').match(/\d+/g)?.map(Number) ?? [],
  );

  const weeks: Week[] = [];
  for (const heading of headingsMatching(lines, /^### Weeks \d+ to \d+/)) {
    for (const table of tablesUnder(lines, heading)) {
      const rideCols = table.header
        .map((h, i) => ({ i, day: DAY_NAMES.indexOf(h.match(/^(\w{3}) ride$/)?.[1] ?? '') }))
        .filter((c) => c.day >= 0);
      const notesCol = table.header.indexOf('Notes');
      for (const row of table.rows) {
        const number = +row[0];
        const stage = stages.find((s) => number >= s.from && number <= s.to);
        if (!stage) throw new Error(`No stage for week ${number}`);
        let rawNote = notesCol >= 0 ? row[notesCol] : '';
        let deload = deloadWeeks.has(number);
        const weekNotes: string[] = [];
        if (/^Deload\b/.test(rawNote)) {
          deload = true;
          rawNote = rawNote.replace(/^Deload\.?\s*/, '');
        }
        if (/^Taper\b/.test(rawNote)) {
          weekNotes.push('Taper: about 30% less volume, a few short openers, and no new hard work.');
          rawNote = rawNote.replace(/^Taper\.?\s*/, '');
        }
        if (deload) weekNotes.unshift('Deload week: cut volume by about a third, same days and watts.');

        const days: Day[] = [];
        for (let offset = 0; offset < 7; offset++) {
          const rideCol = rideCols.find((c) => c.day === offset);
          let workout: Workout;
          if (rideCol) {
            workout = buildRide(row[rideCol.i]);
            if (deload) workout.notes.unshift('Deload week.');
          } else if (offset === 6) {
            workout = restDay('Sunday off');
          } else {
            workout = nonRide(stage.cells[offset], number, deload);
          }
          days.push({ offset, notes: [], workouts: [workout] });
        }

        if (rawNote) {
          const placements = NOTE_PLACEMENTS[rawNote];
          if (!placements) {
            warn(`Week ${number}: unplaced note "${rawNote}" kept as a week note`);
            weekNotes.push(rawNote);
          } else {
            for (const p of placements) {
              if (p.day === 'week') weekNotes.push(p.text);
              else days[p.day].workouts[0].notes.push(p.text);
            }
          }
        }

        weeks.push({ number, stage: stage.label, deload, notes: weekNotes, days });
      }
    }
  }

  // Sanity: computed phase totals vs stated totals for indoor timed workouts.
  for (const w of weeks) {
    for (const d of w.days) {
      for (const wo of d.workouts) {
        if (wo.indoor && wo.phases.length && wo.totalMinutes) {
          const sum = sumMinutes(wo.phases);
          if (Math.abs(sum - wo.totalMinutes) > 0.01) warn(`Week ${w.number} ${DAY_NAMES[d.offset]} ${wo.title}: phases ${sum} min vs stated ${wo.totalMinutes}`);
        }
      }
    }
  }

  const plan = { schemaVersion: 1 as const, name: 'Mueller Sub-30 Plan', referenceFtp: REF_FTP, weeks };
  const result = validatePlan(plan);
  if (!result.ok) throw new Error(`Generated plan failed validation:\n${result.errors.join('\n')}`);
  if (weeks.length !== 31) warn(`Expected 31 weeks, got ${weeks.length}`);

  writeFileSync(OUT, JSON.stringify(result.plan, null, 1) + '\n');
  console.log(`Wrote ${OUT}: ${weeks.length} weeks`);
  warnings.forEach((w) => console.warn(`warning: ${w}`));
}

main();
