/** Local-calendar date helpers. Dates are stored as "YYYY-MM-DD" strings. */

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isValidISODate(iso: unknown): iso is string {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return toISODate(parseISODate(iso)) === iso;
}

export function todayISO(now = new Date()): string {
  return toISODate(now);
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Whole days from a to b (b - a), DST-safe. */
export function daysBetween(a: string, b: string): number {
  const ua = Date.UTC(...(a.split('-').map(Number) as [number, number, number]));
  const ub = Date.UTC(...(b.split('-').map(Number) as [number, number, number]));
  return Math.round((ub - ua) / 86_400_000);
}

/** Calendar date of a plan day: startDate + (week - 1) * 7 + offset. */
export function planDate(startDate: string, week: number, offset: number): string {
  return addDays(startDate, (week - 1) * 7 + offset);
}

/** Week number containing `date`, clamped to [firstWeek, lastWeek]. */
export function weekContaining(startDate: string, date: string, firstWeek: number, lastWeek: number): number {
  const week = Math.floor(daysBetween(startDate, date) / 7) + 1;
  return Math.min(lastWeek, Math.max(firstWeek, week));
}

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const MONTH_DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const FULL = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

export const fmtWeekday = (iso: string) => WEEKDAY.format(parseISODate(iso));
export const fmtMonthDay = (iso: string) => MONTH_DAY.format(parseISODate(iso));
export const fmtFullDate = (iso: string) => FULL.format(parseISODate(iso));
