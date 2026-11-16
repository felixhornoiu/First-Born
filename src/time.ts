export const TZ = 'Europe/Bucharest';
export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Offset (ms) of Brașov local time from UTC at the given instant. */
export function tzOffset(ms: number): number {
  const p: Record<string, number> = {};
  for (const { type, value } of parts.formatToParts(ms)) p[type] = +value;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** Start of the local (Brașov) day containing `ms`. */
export function localMidnight(ms: number): number {
  const local = ms + tzOffset(ms);
  const mid = Math.floor(local / DAY) * DAY;
  return mid - tzOffset(mid - tzOffset(ms));
}

const fTime = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fDay = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short' });
const fDate = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' });
const fLong = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
export const fmtTime = (ms: number) => fTime.format(ms);
export const fmtWeekday = (ms: number) => fDay.format(ms);
export const fmtDate = (ms: number) => fDate.format(ms);
export const fmtLong = (ms: number) => fLong.format(ms);
