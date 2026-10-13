/** The chosen day is the first day the person can no longer open the file. */

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function calendarDaysBetween(from: Date, to: Date): number {
  const a = startOfLocalDay(from).getTime();
  const b = startOfLocalDay(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** UTC instant for the start of `day` in the local timezone. */
export function expiryInstant(day: Date): string {
  return startOfLocalDay(day).toISOString();
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function weekday(date: Date): string {
  return WEEKDAYS[date.getDay()] ?? "that day";
}

function monthDay(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "until Saturday" when the day is within the next two weeks. */
export function untilPhrase(iso: string, now = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "until that day";
  const days = calendarDaysBetween(now, at);
  if (days > 0 && days <= 13) return `until ${weekday(at)}`;
  if (days === 0) return "until today";
  return `until ${monthDay(at)}`;
}

/** "Access ended Saturday" when that day was this week. */
export function endedPhrase(iso: string, now = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "Access ended";
  const days = calendarDaysBetween(at, now);
  if (days >= 0 && days <= 7) return `Access ended ${weekday(at)}`;
  return `Access ended ${monthDay(at)}`;
}

export interface CalendarDay {
  iso: string;
  inMonth: boolean;
  disabled: boolean;
  label: string;
  number: number;
}

/** Six weeks, Sunday first. Days up to today are disabled. */
export function monthGrid(anchor: Date, today = new Date()): CalendarDay[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const todayStart = startOfLocalDay(today).getTime();
  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    days.push({
      iso: expiryInstant(date),
      inMonth: date.getMonth() === anchor.getMonth(),
      disabled: startOfLocalDay(date).getTime() <= todayStart,
      label: `${weekday(date)}, ${date.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
      })}`,
      number: date.getDate(),
    });
  }
  return days;
}
