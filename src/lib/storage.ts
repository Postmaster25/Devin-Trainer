import { get, set, del } from 'idb-keyval';
import { validatePlan, type Plan } from '../data/schema';
import { isValidISODate, todayISO } from './dates';

export type Settings = { startDate: string; ftp: number; gapMs: number };
export type Progress = {
  /** Workout keys flagged "missed target". */
  missed: Record<string, true>;
  /** target workout key -> source workout key it repeats. */
  repeats: Record<string, string>;
};

const SETTINGS_KEY = 'sub30.settings';
const PROGRESS_KEY = 'sub30.progress';
const PLAN_KEY = 'sub30.importedPlan';

export const DEFAULT_FTP = 235;
export const DEFAULT_GAP_MS = 120;

/** Loads settings; on first launch the plan start date defaults to today and is persisted. */
export function loadSettings(): Settings {
  let raw: Partial<Settings> = {};
  try {
    raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
  } catch {
    /* corrupt: reset */
  }
  const settings: Settings = {
    startDate: isValidISODate(raw.startDate) ? raw.startDate : todayISO(),
    ftp: typeof raw.ftp === 'number' && raw.ftp >= 50 && raw.ftp <= 600 ? raw.ftp : DEFAULT_FTP,
    gapMs: typeof raw.gapMs === 'number' && raw.gapMs >= 0 && raw.gapMs <= 500 ? raw.gapMs : DEFAULT_GAP_MS,
  };
  saveSettings(settings);
  return settings;
}

export function saveSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

const progressKey = (planName: string) => `${PROGRESS_KEY}:${planName}`;

export function loadProgress(planName: string): Progress {
  try {
    const p = JSON.parse(localStorage.getItem(progressKey(planName)) ?? '{}');
    return { missed: p.missed ?? {}, repeats: p.repeats ?? {} };
  } catch {
    return { missed: {}, repeats: {} };
  }
}

export function saveProgress(planName: string, p: Progress) {
  localStorage.setItem(progressKey(planName), JSON.stringify(p));
}

export async function loadImportedPlan(): Promise<Plan | undefined> {
  try {
    const data = await get(PLAN_KEY);
    if (!data) return undefined;
    const result = validatePlan(data);
    return result.ok ? result.plan : undefined;
  } catch {
    return undefined;
  }
}

export const saveImportedPlan = (plan: Plan) => set(PLAN_KEY, plan);
export const clearImportedPlan = () => del(PLAN_KEY);
