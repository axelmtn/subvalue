/** Count whole local calendar months; rolling presets are never subscription comparisons. */
export function fullCalendarMonths(range: {
  from: string;
  until: string;
  preset?: string;
  calendarMonths?: number | null;
}): number | null {
  if (range.preset === '7d' || range.preset === '30d') return null;
  // Browser timezone overrides must not change the server's calendar selection.
  if (range.calendarMonths !== undefined)
    return Number.isInteger(range.calendarMonths) &&
      range.calendarMonths! > 0 &&
      range.calendarMonths! <= 1200
      ? range.calendarMonths
      : null;
  const start = new Date(range.from),
    end = new Date(range.until);
  const boundary = (date: Date) =>
    Number.isFinite(+date) &&
    date.getDate() === 1 &&
    date.getHours() === 0 &&
    date.getMinutes() === 0 &&
    date.getSeconds() === 0 &&
    date.getMilliseconds() === 0;
  if (!boundary(start) || !boundary(end)) return null;
  const months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
  return months > 0 && months <= 1200 ? months : null;
}
/** Civil-date movement uses UTC arithmetic so DST never drops or repeats a day. */
export function shiftCalendarDays(day: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(days) || Math.abs(days) > 36600)
    return null;
  const date = new Date(day + 'T12:00:00.000Z');
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== day) return null;
  date.setUTCDate(date.getUTCDate() + days);
  const result = date.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}
export function shiftCalendarMonth(month: string, months: number): string | null {
  if (!/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(month) || !Number.isInteger(months))
    return null;
  const ordinal = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + months,
    year = Math.floor(ordinal / 12);
  return year >= 1900 && year <= 2199
    ? `${year}-${String((ordinal % 12) + 1).padStart(2, '0')}`
    : null;
}
