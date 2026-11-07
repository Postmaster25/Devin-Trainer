import { useEffect, useRef, useState } from 'react';
import { useAppState, DEFAULT_PLAN } from '../state';
import { validatePlan } from '../data/schema';
import { fmtFullDate, fmtWeekday, isValidISODate, planDate, todayISO } from '../lib/dates';
import { cuePlayer, type AudioManifest } from '../lib/audio';
import { durationClips, wattClips } from '../lib/cues';
import { DEFAULT_FTP } from '../lib/storage';
import { TopBar } from './common';
import { href } from '../router';
import { DEMO_KEY } from '../data/demo';

export default function SettingsView() {
  const { plan, planSource, settings, updateSettings, importPlan, restoreDefaultPlan, updateProgress } = useAppState();
  const [ftpText, setFtpText] = useState(String(settings.ftp));
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string; errors?: string[] }>();
  const [manifest, setManifest] = useState<AudioManifest>();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const lastWeek = Math.max(...plan.weeks.map((w) => w.number));

  useEffect(() => {
    cuePlayer.manifest().then(setManifest).catch(() => undefined);
  }, []);
  useEffect(() => {
    cuePlayer.gapMs = settings.gapMs;
  }, [settings.gapMs]);

  const commitFtp = () => {
    const n = Math.round(Number(ftpText));
    if (n >= 50 && n <= 600) updateSettings({ ftp: n });
    else setFtpText(String(settings.ftp));
  };

  const testAudio = async () => {
    cuePlayer.unlock();
    cuePlayer.gapMs = settings.gapMs;
    const sweetSpot = { lowPct: 87.23 };
    try {
      await cuePlayer.say(['next_interval_15', ...wattClips(sweetSpot, settings.ftp, manifest?.maxNumber), 'for', ...durationClips(12 * 60, manifest?.maxNumber)]);
    } finally {
      cuePlayer.stopKeepAlive();
    }
  };

  const importText = async (text: string) => {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      setImportMsg({ ok: false, text: `That is not valid JSON: ${(e as Error).message}` });
      return;
    }
    const result = validatePlan(data);
    if (!result.ok) {
      setImportMsg({ ok: false, text: 'The plan does not match the schema:', errors: result.errors });
      return;
    }
    await importPlan(result.plan);
    setImportMsg({ ok: true, text: `Imported "${result.plan.name}" (${result.plan.weeks.length} weeks).` });
    setPasteOpen(false);
    setPasteText('');
  };

  const exportPlan = () => {
    const blob = new Blob([JSON.stringify(plan, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${plan.name.replace(/[^\w-]+/g, '-').toLowerCase()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="page">
      <TopBar title="Settings" back="#/" />
      <div className="pad settings">
        <section>
          <h3>Plan start date</h3>
          <input
            type="date"
            value={settings.startDate}
            onChange={(e) => isValidISODate(e.target.value) && updateSettings({ startDate: e.target.value })}
          />
          <div className="row">
            <button className="btn btn-small" onClick={() => updateSettings({ startDate: todayISO() })}>
              Use today
            </button>
          </div>
          <p className="muted small">
            Week 1 starts {fmtFullDate(settings.startDate)}; week {lastWeek} ends {fmtFullDate(planDate(settings.startDate, lastWeek, 6))}.
            {fmtWeekday(settings.startDate) !== fmtWeekday('2026-10-19') && ' The plan was written with weeks starting on Monday.'}
          </p>
        </section>

        <section>
          <h3>FTP</h3>
          <div className="row">
            <input
              type="number"
              inputMode="numeric"
              min={50}
              max={600}
              value={ftpText}
              onChange={(e) => setFtpText(e.target.value)}
              onBlur={commitFtp}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <span>W</span>
            {settings.ftp !== DEFAULT_FTP && (
              <button className="btn btn-small" onClick={() => (updateSettings({ ftp: DEFAULT_FTP }), setFtpText(String(DEFAULT_FTP)))}>
                Reset to {DEFAULT_FTP}
              </button>
            )}
          </div>
          <p className="muted small">All watt targets on screen and in audio are computed from this FTP (plan written at {plan.referenceFtp} W).</p>
        </section>

        <section>
          <h3>Audio cues</h3>
          <label className="small">
            Gap between words: {settings.gapMs} ms
            <input type="range" min={0} max={300} step={10} value={settings.gapMs} onChange={(e) => updateSettings({ gapMs: Number(e.target.value) })} />
          </label>
          <div className="row wrap">
            <button className="btn" onClick={testAudio}>
              Test audio
            </button>
            <a className="btn btn-link" href={href({ name: 'workout', key: DEMO_KEY })}>
              Demo ride (4 min)
            </a>
          </div>
          {manifest && (
            <p className="muted small">
              Voice {manifest.voice}, rate {manifest.rate}. Make sure the ringer switch is not muting Safari if you hear nothing.
            </p>
          )}
        </section>

        <section>
          <h3>Plan</h3>
          <p className="small">
            Using <strong>{plan.name}</strong> ({planSource === 'imported' ? 'imported' : 'built-in'}, {plan.weeks.length} weeks).
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void f.text().then(importText);
              e.target.value = '';
            }}
          />
          <div className="row wrap">
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Import from file
            </button>
            <button className="btn" onClick={() => setPasteOpen((o) => !o)}>
              Paste JSON
            </button>
            <button className="btn" onClick={exportPlan}>
              Export plan JSON
            </button>
            {planSource === 'imported' && (
              <button
                className="btn"
                onClick={async () => {
                  if (confirm(`Restore the built-in "${DEFAULT_PLAN.name}"?`)) {
                    await restoreDefaultPlan();
                    setImportMsg({ ok: true, text: 'Restored the default plan.' });
                  }
                }}
              >
                Restore default plan
              </button>
            )}
          </div>
          {pasteOpen && (
            <div className="paste">
              <textarea
                aria-label="Plan JSON"
                placeholder='{"name": "...", "weeks": [...]}'
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <button className="btn btn-primary" disabled={!pasteText.trim()} onClick={() => void importText(pasteText)}>
                Validate and import
              </button>
            </div>
          )}
          {importMsg && (
            <div className={`callout ${importMsg.ok ? '' : 'error'}`}>
              {importMsg.text}
              {importMsg.errors && (
                <ul>
                  {importMsg.errors.map((e, i) => (
                    <li key={i}>
                      <code>{e}</code>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <button
            className="link-btn small"
            onClick={() => confirm('Clear all missed-target flags and repeats for this plan?') && updateProgress(() => ({ missed: {}, repeats: {} }))}
          >
            Clear missed flags and repeats
          </button>
        </section>
      </div>
    </div>
  );
}
