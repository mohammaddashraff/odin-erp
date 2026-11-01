import { cairoDayStart, nextCalendarDate } from './av8-operations-domain';
import { cairoCalendarDate } from './av8-domain';
describe('Cairo report filter boundaries', () => {
  it.each(['2026-01-31','2026-04-24','2026-07-01','2026-10-30','2024-02-29'])('finds the actual first instant of %s, without fixed offsets', date => {
    const start = cairoDayStart(date);
    expect(cairoCalendarDate(start)).toBe(date);
    expect(cairoCalendarDate(new Date(start.valueOf()-1)) < date).toBe(true);
    const next = cairoDayStart(nextCalendarDate(date));
    expect(cairoCalendarDate(new Date(next.valueOf()-1))).toBe(date);
  });
  it('keeps leap/month arithmetic as calendar dates', () => { expect(nextCalendarDate('2024-02-29')).toBe('2024-03-01'); });
});
