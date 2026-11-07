import { useAppState } from '../state';
import { href, navigate } from '../router';
import { fmtMonthDay, fmtWeekday, planDate, todayISO, weekContaining } from '../lib/dates';
import { fmtPower, primaryWorkPhase } from '../lib/watts';
import { rawWorkout, resolveWorkout, workoutKey } from '../lib/planUtils';
import { TopBar, isShortNote } from './common';

export default function ScheduleView({ weekNumber }: { weekNumber: number }) {
  const { plan, settings, progress, planSource } = useAppState();
  const weeks = [...plan.weeks].sort((a, b) => a.number - b.number);
  const week = weeks.find((w) => w.number === weekNumber) ?? weeks[0];
  const idx = weeks.indexOf(week);
  const today = todayISO();
  const currentWeek = weekContaining(settings.startDate, today, weeks[0].number, weeks[weeks.length - 1].number);
  const weekStart = planDate(settings.startDate, week.number, 0);
  const weekEnd = planDate(settings.startDate, week.number, 6);
  const go = (n: number) => navigate({ name: 'schedule', week: n }, true);

  return (
    <div className="page">
      <TopBar
        title={planSource === 'imported' ? plan.name : 'Sub-30 Plan'}
        right={
          <a className="icon-btn" href={href({ name: 'settings' })} aria-label="Settings">
            ⚙
          </a>
        }
      />

      <div className="week-nav">
        <button className="icon-btn" disabled={idx <= 0} onClick={() => go(weeks[idx - 1].number)} aria-label="Previous week">
          ‹
        </button>
        <select value={week.number} onChange={(e) => go(Number(e.target.value))} aria-label="Week">
          {weeks.map((w) => (
            <option key={w.number} value={w.number}>
              Week {w.number} · {fmtMonthDay(planDate(settings.startDate, w.number, 0))}
              {w.number === currentWeek ? ' (this week)' : ''}
            </option>
          ))}
        </select>
        <button className="icon-btn" disabled={idx >= weeks.length - 1} onClick={() => go(weeks[idx + 1].number)} aria-label="Next week">
          ›
        </button>
      </div>

      <div className="week-meta">
        <span>
          {fmtMonthDay(weekStart)} – {fmtMonthDay(weekEnd)}
        </span>
        {week.stage && <span className="muted">{week.stage}</span>}
        {week.deload && <span className="badge badge-deload">Deload</span>}
        {week.number !== currentWeek && (
          <button className="link-btn" onClick={() => go(currentWeek)}>
            Today
          </button>
        )}
      </div>
      {week.notes.length > 0 && (
        <ul className="week-notes">
          {week.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      <ol className="days">
        {[...week.days]
          .sort((a, b) => a.offset - b.offset)
          .map((day) => {
            const date = planDate(settings.startDate, week.number, day.offset);
            return (
              <li key={day.offset} className={`day ${date === today ? 'today' : ''}`}>
                <div className="day-date">
                  <span className="dow">{fmtWeekday(date)}</span>
                  <span className="dom">{fmtMonthDay(date)}</span>
                </div>
                <div className="day-items">
                  {day.notes.map((n, i) => (
                    <p key={`n${i}`} className="note">
                      {n}
                    </p>
                  ))}
                  {day.workouts.map((_, index) => {
                    const key = workoutKey({ week: week.number, offset: day.offset, index });
                    const r = resolveWorkout(plan, key, progress)!;
                    const w = r.workout;
                    const target = primaryWorkPhase(w);
                    const watts = w.indoor && target ? fmtPower(target.power, settings.ftp) : '';
                    const shortNotes = w.notes.filter((n) => isShortNote(n) && n !== 'Deload week.');
                    const hasLong = w.notes.some((n) => !isShortNote(n));
                    const content = (
                      <>
                        <div className="wo-head">
                          <span className={`wo-title cat-${w.category}`}>{w.title}</span>
                          {w.category === 'ride' && <span className={`chip ${w.indoor ? 'chip-indoor' : 'chip-outdoor'}`}>{w.indoor ? 'Indoor' : 'Outdoor'}</span>}
                          {progress.missed[key] && <span className="chip chip-missed">Missed target</span>}
                        </div>
                        <div className="wo-summary">
                          {w.summary}
                          {watts && <strong> · {watts}</strong>}
                        </div>
                        {r.repeatOf && <div className="wo-repeat">Repeat of week {r.repeatOf.split('-')[0]} ({rawWorkout(plan, key)?.title} replaced)</div>}
                        {shortNotes.map((n, i) => (
                          <div key={i} className="wo-note">
                            {n}
                          </div>
                        ))}
                        {hasLong && <div className="wo-note more">More notes in detail ›</div>}
                      </>
                    );
                    return w.category === 'ride' ? (
                      <a key={key} className="wo tappable" href={href({ name: 'workout', key })}>
                        {content}
                      </a>
                    ) : (
                      <div key={key} className={`wo ${w.category === 'rest' ? 'rest' : ''}`}>
                        {content}
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
      </ol>
      <p className="footer muted">FTP {settings.ftp} W · Week 1 starts {fmtMonthDay(settings.startDate)}</p>
    </div>
  );
}
