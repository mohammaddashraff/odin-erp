import { calendarDate, cairoCalendarDate } from './av8-domain';

/** First instant of a Cairo calendar date, including midnight DST jumps/overlaps. */
export function cairoDayStart(value: unknown) {
  const date = calendarDate(value), midnight = Date.parse(`${date}T00:00:00Z`);
  let low = midnight - 14 * 3600000, high = midnight + 14 * 3600000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (cairoCalendarDate(new Date(middle)) < date) low = middle + 1; else high = middle;
  }
  return new Date(low);
}
export function nextCalendarDate(value: unknown) { return new Date(Date.parse(`${calendarDate(value)}T00:00:00Z`) + 86400000).toISOString().slice(0,10); }
