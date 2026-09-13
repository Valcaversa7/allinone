import { ScheduleEntry, WeekdayKey } from '../types/timetable';

export const weekdayOrder: WeekdayKey[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const weekdaysByJsIndex: WeekdayKey[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function shiftDate(date: Date, days: number): Date {
  const next = startOfDay(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function getDateWindow(anchor: Date, total = 5): Date[] {
  const offset = Math.floor(total / 2);
  return Array.from({ length: total }, (_, index) => shiftDate(anchor, index - offset));
}

export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function weekdayFromDate(date: Date): WeekdayKey {
  return weekdaysByJsIndex[date.getDay()];
}

export function weekdayFromIsoDate(value: string): WeekdayKey {
  return weekdayFromDate(new Date(`${value}T00:00:00`));
}

export function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function formatImportedAt(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatDayTileWeekday(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(date).toUpperCase();
}

export function formatDayTileMonth(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(date).toUpperCase();
}

export function formatDayNumber(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit' }).format(date);
}

export function compareTimes(first: string, second: string): number {
  return minutesFromTime(first) - minutesFromTime(second);
}

export function minutesFromTime(value: string): number {
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function matchesDate(entry: ScheduleEntry, date: Date): boolean {
  const iso = toIsoDate(date);
  if (entry.date) {
    return entry.date === iso;
  }

  const weekday = weekdayFromDate(date);
  if (entry.day !== weekday) {
    return false;
  }

  if (entry.rangeStart && iso < entry.rangeStart) {
    return false;
  }

  if (entry.rangeEnd && iso > entry.rangeEnd) {
    return false;
  }

  return true;
}

export function getEntriesForDate(date: Date, entries: ScheduleEntry[]): ScheduleEntry[] {
  return [...entries].filter((entry) => matchesDate(entry, date)).sort((first, second) => compareTimes(first.startTime, second.startTime));
}

export function labelForDay(day: WeekdayKey): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

export function describeEntryGrouping(entry: ScheduleEntry): string {
  if (entry.date) {
    return formatLongDate(new Date(`${entry.date}T00:00:00`));
  }

  return entry.day ? labelForDay(entry.day) : 'Unassigned';
}
