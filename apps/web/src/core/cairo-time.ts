export const operationalTimezone = 'Africa/Cairo';

/** Calendar dates stay calendar dates; operational instants are always Cairo. */
export function cairoDateTime(value: string | Date = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: operationalTimezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export const cairoToday = () => cairoDateTime().slice(0, 10);

export function cairoInstant(local: string): string {
  if (!local) return '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error('Choose a valid Cairo date and time');
  const guess = Date.parse(local + ':00Z');
  // Derive offsets from IANA data on both sides of a possible DST transition.
  const offsets = new Set([-36, 0, 36].map(hours => {
    const instant = guess + hours * 3600000;
    return Date.parse(cairoDateTime(new Date(instant)) + ':00Z') - instant;
  }));
  const candidates = [...offsets].map(offset => guess - offset)
    .filter(instant => cairoDateTime(new Date(instant)) === local).sort((a, b) => a - b);
  if (!candidates.length) throw new Error('This Cairo time does not exist because of daylight saving; choose another time');
  // During the repeated autumn hour, consistently select its first occurrence.
  return new Date(candidates[0]).toISOString();
}
