import { useState } from 'react';
import type { Phase } from '../data/schema';
import { useAppState } from '../state';
import { href, navigate } from '../router';
import { fmtFullDate, fmtMonthDay, fmtWeekday, planDate } from '../lib/dates';
import { fmtDuration } from '../lib/format';
import { fmtPower, primaryWorkPhase } from '../lib/watts';
import { hasTimer, nextSameTypeSlot, parseKey, rawWorkout, resolveWorkout } from '../lib/planUtils';
import { cuePlayer } from '../lib/audio';
import { TopBar } from './common';

type Row = { phase: Phase; count: number };

/** Collapse repeated steps in a group (e.g. 4 reps + 3 recoveries) into one row each with a count. */
function collapse(phases: Phase[]): { group: string; rows: Row[]; seconds: number }[] {
  const groups: { group: string; phases: Phase[] }[] = [];
  for (const p of phases) {
    const g = p.group ?? '';
    const last = groups[groups.length - 1];
    if (last && last.group === g) last.phases.push(p);
    else groups.push({ group: g, phases: [p] });
  }
  return groups.map(({ group, phases: ps }) => {
    const rows: Row[] = [];
    const sig = (p: Phase) => JSON.stringify([p.name, p.kind, p.durationSec, p.power, p.hr, p.rpe, p.cadence, p.note]);
    for (const p of ps) {
      const existing = rows.find((r) => sig(r.phase) === sig(p));
      if (existing && (p.rep || p.set || p.kind === 'recovery')) existing.count++;
      else rows.push({ phase: p, count: 1 });
    }
    return { group, rows, seconds: ps.reduce((a, p) => a + p.durationSec, 0) };
  });
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export default function WorkoutDetail({ workoutKey }: { workoutKey: string }) {
  const { plan, settings, progress, updateProgress } = useAppState();
  const [copied, setCopied] = useState(false);
  const r = resolveWorkout(plan, workoutKey, progress);
  if (!r) {
    return (
      <div className="page">
        <TopBar title="Not found" back="#/" />
        <p className="pad">That workout is not in the current plan.</p>
      </div>
    );
  }
  const { workout: w, ref } = r;
  const date = planDate(settings.startDate, ref.week, ref.offset);
  const back = href({ name: 'schedule', week: ref.week });
  const target = primaryWorkPhase(w);
  const missed = !!progress.missed[workoutKey];
  const sourceKey = r.repeatOf ?? workoutKey;
  const repeatTarget = Object.entries(progress.repeats).find(([, src]) => src === sourceKey && src !== undefined)?.[0];
  const nextSlot = nextSameTypeSlot(plan, workoutKey);
  const slotLabel = (key: string) => {
    const k = parseKey(key)!;
    const d = planDate(settings.startDate, k.week, k.offset);
    return `${fmtWeekday(d)}, ${fmtMonthDay(d)} (week ${k.week})`;
  };

  const toggleMissed = () =>
    updateProgress((p) => {
      const m = { ...p.missed };
      if (m[workoutKey]) delete m[workoutKey];
      else m[workoutKey] = true;
      return { ...p, missed: m };
    });
  const scheduleRepeat = () =>
    nextSlot && updateProgress((p) => ({ ...p, repeats: { ...p.repeats, [nextSlot]: sourceKey } }));
  const removeRepeat = (target: string) =>
    updateProgress((p) => {
      const repeats = { ...p.repeats };
      delete repeats[target];
      return { ...p, repeats };
    });

  const start = () => {
    cuePlayer.unlock(); // inside the tap gesture, required by iOS
    sessionStorage.setItem('sub30.autostart', workoutKey);
    navigate({ name: 'timer', key: workoutKey });
  };

  return (
    <div className="page">
      <TopBar title={`Week ${ref.week}`} back={back} />
      <div className="pad">
        <p className="muted">{fmtFullDate(date)}</p>
        <div className="title-row">
          <h2 className="wo-big-title">{w.title}</h2>
          <button
            className="btn btn-small"
            onClick={async () => {
              setCopied(await copyText(w.title));
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? 'Copied' : 'Copy title'}
          </button>
        </div>
        <p className="summary">
          {w.summary}
          {w.indoor && target && <strong> · {fmtPower(target.power, settings.ftp)}</strong>}
        </p>
        <div className="chips">
          {w.category === 'ride' && <span className={`chip ${w.indoor ? 'chip-indoor' : 'chip-outdoor'}`}>{w.indoor ? 'Indoor' : 'Outdoor'}</span>}
          {w.totalMinutes && <span className="chip">{w.totalMinutes} min</span>}
          {missed && <span className="chip chip-missed">Missed target</span>}
        </div>
        {r.repeatOf && (
          <p className="callout">
            Repeat of week {parseKey(r.repeatOf)!.week}. Originally scheduled: {rawWorkout(plan, workoutKey)?.title}.{' '}
            <button className="link-btn" onClick={() => removeRepeat(workoutKey)}>
              Restore original
            </button>
          </p>
        )}

        {w.notes.length > 0 && (
          <ul className="notes">
            {w.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}

        {hasTimer(w) && (
          <button className="btn btn-primary btn-block" onClick={start}>
            Start workout
          </button>
        )}
        {w.category === 'ride' && !w.indoor && <p className="muted small">Outdoor ride: use the heart rate, RPE and time targets. No timer.</p>}
        {w.category === 'ride' && w.indoor && !w.phases.length && <p className="muted small">No step-by-step timer for this one; run it in your trainer app.</p>}

        {w.phases.length > 0 && (
          <section className="phases">
            <h3>Phases</h3>
            {collapse(w.phases).map((g, gi) => (
              <div key={gi} className="phase-group">
                <div className="phase-group-head">
                  <span>{g.group}</span>
                  <span className="muted">{fmtDuration(g.seconds)}</span>
                </div>
                {g.rows.map(({ phase: p, count }, i) => (
                  <div key={i} className={`phase-row kind-${p.kind}`}>
                    <div className="phase-main">
                      <span className="phase-name">
                        {count > 1 ? `${count} × ` : ''}
                        {p.name}
                      </span>
                      <span className="phase-dur">{fmtDuration(p.durationSec)}</span>
                    </div>
                    <div className="phase-targets">
                      {p.power && <span className="t-watts">{fmtPower(p.power, settings.ftp)}</span>}
                      {p.power?.note && <span>{p.power.note}</span>}
                      {p.hr && <span>HR {p.hr}</span>}
                      {p.rpe && <span>RPE {p.rpe}</span>}
                      {p.cadence && <span>{p.cadence} rpm</span>}
                    </div>
                    {p.note && <div className="phase-note">{p.note}</div>}
                  </div>
                ))}
              </div>
            ))}
          </section>
        )}

        {w.category === 'ride' && (
          <section className="missed">
            <label className="toggle">
              <input type="checkbox" checked={missed} onChange={toggleMissed} />
              <span>Missed target on this ride</span>
            </label>
            {missed && !repeatTarget && nextSlot && (
              <button className="btn btn-block" onClick={scheduleRepeat}>
                Repeat this workout on {slotLabel(nextSlot)}
              </button>
            )}
            {missed && !nextSlot && !repeatTarget && <p className="muted small">No later {w.type} session to replace.</p>}
            {repeatTarget && repeatTarget !== workoutKey && (
              <p className="callout">
                Repeats on {slotLabel(repeatTarget)}, replacing {rawWorkout(plan, repeatTarget)?.title}.{' '}
                <button className="link-btn" onClick={() => removeRepeat(repeatTarget)}>
                  Undo
                </button>
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
