import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '../state';
import { href, navigate } from '../router';
import { buildTimeline, positionAt } from '../lib/timeline';
import { TimerEngine } from '../lib/engine';
import { allClipIds, buildCues, type Cue } from '../lib/cues';
import { cuePlayer } from '../lib/audio';
import { fmtClock, fmtDuration } from '../lib/format';
import { fmtPower } from '../lib/watts';
import { groupLabel, hasTimer, resolveWorkout, stepName } from '../lib/planUtils';
import { clearMediaSession, setMediaHandlers, setMediaMetadata, setMediaPlaybackState } from '../lib/mediaSession';
import type { Phase } from '../data/schema';
import { TopBar } from './common';

type Status = 'loading' | 'ready' | 'running' | 'paused' | 'finished';

const DRIFT_TOLERANCE = 0.25;

function intervalLabel(p: Phase): string | undefined {
  if (!p.rep) return undefined;
  const warm = p.group?.startsWith('Warm-up');
  const base = `${warm ? 'Warm-up burst' : 'Interval'} ${p.rep.index} of ${p.rep.count}`;
  return p.set ? `Set ${p.set.index} of ${p.set.count} · ${base}` : base;
}

export default function TimerView({ workoutKey }: { workoutKey: string }) {
  const { plan, settings, progress } = useAppState();
  const resolved = resolveWorkout(plan, workoutKey, progress);
  const workout = resolved?.workout;
  const timeline = useMemo(() => buildTimeline(workout?.phases ?? []), [workout]);

  const engineRef = useRef<TimerEngine | null>(null);
  const cuesRef = useRef<Cue[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [elapsed, setElapsed] = useState(0);
  const [showTotal, setShowTotal] = useState(false);
  const [audioWarning, setAudioWarning] = useState<string>();
  const statusRef = useRef(status);
  statusRef.current = status;

  // Load audio clips needed for this workout's cues.
  useEffect(() => {
    if (!workout || !hasTimer(workout)) return;
    let cancelled = false;
    engineRef.current = new TimerEngine(timeline.total);
    cuePlayer.gapMs = settings.gapMs;
    (async () => {
      try {
        const manifest = await cuePlayer.manifest();
        const cues = buildCues(workout.phases, {
          ftp: settings.ftp,
          maxNumber: manifest.maxNumber,
          clipMs: cuePlayer.clipDurations(manifest),
          gapMs: settings.gapMs,
        });
        cuesRef.current = cues;
        const missing = await cuePlayer.load(allClipIds(cues));
        if (missing.length) setAudioWarning(`Missing audio clips: ${missing.join(', ')}`);
      } catch (e) {
        setAudioWarning(`Audio unavailable: ${(e as Error).message}`);
      }
      if (cancelled) return;
      setStatus('ready');
      if (sessionStorage.getItem('sub30.autostart') === workoutKey) {
        sessionStorage.removeItem('sub30.autostart');
        begin(false);
      }
    })();
    return () => {
      cancelled = true;
      cuePlayer.cancel();
      cuePlayer.stopKeepAlive();
      clearMediaSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workout, timeline]);

  const pause = useCallback(() => {
    const eng = engineRef.current;
    if (!eng || eng.state !== 'running') return;
    eng.pause();
    cuePlayer.cancel();
    cuePlayer.stopKeepAlive();
    setMediaPlaybackState('paused');
    setElapsed(eng.elapsed());
    setStatus('paused');
  }, []);

  const resume = useCallback(() => {
    const eng = engineRef.current;
    if (!eng || eng.state !== 'paused') return;
    cuePlayer.unlock();
    eng.resume();
    cuePlayer.scheduleFrom(cuesRef.current, eng.elapsed());
    setMediaPlaybackState('playing');
    setStatus('running');
  }, []);

  const complete = useCallback((spoken: boolean) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.finish();
    if (spoken) {
      cuePlayer.cancel();
      void cuePlayer.say(['workout_complete']);
    }
    setStatus('finished');
    setElapsed(eng.elapsed());
    setMediaPlaybackState('none');
    setTimeout(() => {
      cuePlayer.stopKeepAlive();
      clearMediaSession();
    }, 5000);
  }, []);

  function begin(fromGesture: boolean) {
    const eng = engineRef.current;
    if (!eng || !workout) return;
    if (fromGesture) cuePlayer.unlock();
    cuePlayer.startKeepAlive();
    eng.start(0);
    cuePlayer.scheduleFrom(cuesRef.current, 0);
    setMediaMetadata(workout.title, workout.summary);
    setMediaHandlers({ play: resume, pause, stop: () => complete(true) });
    setMediaPlaybackState('playing');
    setStatus('running');
  }

  // Display loop + drift correction.
  useEffect(() => {
    if (status !== 'running') return;
    let raf = 0;
    const tick = () => {
      const eng = engineRef.current!;
      const e = eng.elapsed();
      setElapsed(e);
      if (eng.state === 'finished') {
        complete(false); // the completion cue is already scheduled on the audio clock
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // rAF stops when hidden; an interval keeps state roughly current for drift checks.
    const iv = window.setInterval(() => {
      const eng = engineRef.current!;
      const e = eng.elapsed();
      if (eng.state === 'finished') return complete(false);
      const ae = cuePlayer.audioElapsed();
      if (cuePlayer.state !== 'running') {
        void cuePlayer.resumeContext().then(() => cuePlayer.resync(cuesRef.current, eng.elapsed()));
      } else if (ae !== undefined && Math.abs(ae - e) > DRIFT_TOLERANCE) {
        cuePlayer.resync(cuesRef.current, e);
      }
    }, 5000);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const eng = engineRef.current!;
      void cuePlayer.resumeContext().then(() => {
        if (eng.state === 'running') cuePlayer.resync(cuesRef.current, eng.elapsed());
      });
    };
    document.addEventListener('visibilitychange', onVisible);
    const offState = cuePlayer.onStateChange(() => {
      const eng = engineRef.current!;
      if (cuePlayer.state === 'running' && eng.state === 'running') cuePlayer.resync(cuesRef.current, eng.elapsed());
    });
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisible);
      offState();
    };
  }, [status, complete]);

  if (!resolved || !workout) {
    return (
      <div className="page">
        <TopBar title="Not found" back="#/" />
      </div>
    );
  }
  const back = href({ name: 'workout', key: workoutKey });
  if (!hasTimer(workout)) {
    return (
      <div className="page">
        <TopBar title={workout.title} back={back} />
        <p className="pad">This workout has no indoor timer.</p>
      </div>
    );
  }

  const pos = positionAt(timeline, elapsed)!;
  const phase = pos.phase;
  const next = timeline.phases[pos.index + 1];
  const watts = fmtPower(phase.power, settings.ftp);
  const label = intervalLabel(phase);
  const progressPct = (elapsed / timeline.total) * 100;

  return (
    <div className={`page timer kind-${phase.kind} ${status}`}>
      <TopBar title={workout.title} back={status === 'running' ? undefined : back} />
      <div className="progress">
        <div style={{ width: `${progressPct}%` }} />
      </div>
      <div className="timer-meta">
        <span>Elapsed {fmtClock(elapsed)}</span>
        <span>Remaining {fmtClock(timeline.total - elapsed)}</span>
      </div>

      {status === 'finished' ? (
        <div className="timer-body">
          <div className="phase-name-big">Workout complete</div>
          <div className="muted">{fmtClock(elapsed)} ridden</div>
          <div className="title-row center">
            <button className="btn btn-primary" onClick={() => navigate({ name: 'workout', key: workoutKey })}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="timer-body">
          <div className="phase-group-label">{groupLabel(phase.group)}</div>
          <div className="phase-name-big">{phase.name}</div>
          {label && <div className="interval">{label}</div>}
          <div className="watts-big">
            {watts ? (
              <>
                {watts.replace(/ W$/, '')}
                <span className="watts-unit"> W</span>
              </>
            ) : (
              '—'
            )}
          </div>
          {phase.hr && (
            <div className="hr-big">
              <span className="hr-unit">♥ HR</span> {phase.hr}
            </div>
          )}
          <div className="phase-targets center">
            {phase.rpe && <span>RPE {phase.rpe}</span>}
            {phase.cadence && <span>{phase.cadence} rpm</span>}
          </div>
          <button className="countdown" onClick={() => setShowTotal((v) => !v)} aria-label="Toggle phase remaining or total elapsed">
            <span className="countdown-label">{showTotal ? 'Total elapsed' : 'Phase remaining'}</span>
            <span className="countdown-value">{fmtClock(showTotal ? elapsed : pos.remainingInPhase)}</span>
          </button>
          {next ? (
            <div className="next">
              <span className="muted">Next</span> <span className="seg">{stepName(next)}</span> ·{' '}
              <span className="seg">{fmtDuration(next.durationSec)}</span>
              {next.power && (
                <>
                  {' '}
                  · <strong className="seg">{fmtPower(next.power, settings.ftp)}</strong>
                </>
              )}
            </div>
          ) : (
            <div className="next muted">Last phase</div>
          )}
        </div>
      )}

      {audioWarning && <p className="callout error small">{audioWarning}</p>}

      <div className="controls">
        {status === 'loading' && <button className="btn btn-block" disabled>Loading audio…</button>}
        {status === 'ready' && (
          <button className="btn btn-primary btn-block" onClick={() => begin(true)}>
            Start
          </button>
        )}
        {status === 'running' && (
          <button className="btn btn-block" onClick={pause}>
            Pause
          </button>
        )}
        {status === 'paused' && (
          <button className="btn btn-primary btn-block" onClick={resume}>
            Resume
          </button>
        )}
        {(status === 'running' || status === 'paused') && (
          <button className="btn btn-danger btn-block" onClick={() => confirm('Finish this workout now?') && complete(true)}>
            Finish
          </button>
        )}
      </div>
    </div>
  );
}
