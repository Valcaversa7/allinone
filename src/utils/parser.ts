import { compareTimes, weekdayFromIsoDate, weekdayOrder } from './dates';
import { ScheduleEntry, WeekdayKey } from '../types/timetable';

type ParseContext = {
  day?: WeekdayKey;
  date?: string;
  rangeStart?: string;
  rangeEnd?: string;
};

type ParseResult = {
  entries: ScheduleEntry[];
  warnings: string[];
};

const weekdayLookup: Record<string, WeekdayKey> = {
  mon: 'monday',
  monday: 'monday',
  tue: 'tuesday',
  tues: 'tuesday',
  tuesday: 'tuesday',
  wed: 'wednesday',
  weds: 'wednesday',
  wednesday: 'wednesday',
  thu: 'thursday',
  thur: 'thursday',
  thurs: 'thursday',
  thursday: 'thursday',
  fri: 'friday',
  friday: 'friday',
  sat: 'saturday',
  saturday: 'saturday',
  sun: 'sunday',
  sunday: 'sunday',
};

const monthLookup: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const timeRangeRegex = /(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)/i;
const roomRegex = /\b(room|lab|hall|block|auditorium|studio|seminar)\b/i;
const facultyRegex = /\b(faculty|teacher|lecturer|prof(?:essor)?\.?|dr\.?)\b/i;
const breakRegex = /\b(break|lunch|recess)\b/i;

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueWarnings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normaliseLine(line: string): string {
  return line.replace(/[\u2012\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
}

export function normaliseTimeValue(value: string): string {
  const match = value
    .trim()
    .toUpperCase()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);

  if (!match) {
    return value.trim();
  }

  let [, rawHour, rawMinutes = '00', meridiem] = match;
  let hour = Number(rawHour);

  if (meridiem === 'AM' && hour === 12) {
    hour = 0;
  }

  if (meridiem === 'PM' && hour !== 12) {
    hour += 12;
  }

  return `${String(hour).padStart(2, '0')}:${rawMinutes}`;
}

function extractWeekday(value: string): WeekdayKey | undefined {
  const match = value
    .toLowerCase()
    .match(/\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday|s)?|thu(?:r|rs|ursday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/);
  if (!match) {
    return undefined;
  }

  return weekdayLookup[match[1].toLowerCase()];
}

function parseDateValue(day: number, month: number, year?: number): string {
  const finalYear = year
    ? year < 100
      ? 2000 + year
      : year
    : new Date().getFullYear();

  const date = new Date(finalYear, month, day);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function extractDate(value: string): string | undefined {
  const isoMatch = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const slashMatch = value.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]) - 1;
    const year = slashMatch[3] ? Number(slashMatch[3]) : undefined;
    return parseDateValue(day, month, year);
  }

  const dayMonthMatch = value.match(/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{2,4}))?\b/i);
  if (dayMonthMatch) {
    const day = Number(dayMonthMatch[1]);
    const month = monthLookup[dayMonthMatch[2].toLowerCase()];
    const year = dayMonthMatch[3] ? Number(dayMonthMatch[3]) : undefined;
    return parseDateValue(day, month, year);
  }

  const monthDayMatch = value.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s*(\d{2,4}))?\b/i);
  if (monthDayMatch) {
    const month = monthLookup[monthDayMatch[1].toLowerCase()];
    const day = Number(monthDayMatch[2]);
    const year = monthDayMatch[3] ? Number(monthDayMatch[3]) : undefined;
    return parseDateValue(day, month, year);
  }

  return undefined;
}

function extractDateRange(value: string): Pick<ParseContext, 'rangeStart' | 'rangeEnd'> | undefined {
  const matches = Array.from(
    value.matchAll(
      /(\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?|\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{2,4})?)/gi,
    ),
  );

  if (matches.length < 2 || !/(\bto\b|-|–|—)/i.test(value)) {
    return undefined;
  }

  const rangeStart = extractDate(matches[0][0]);
  const rangeEnd = extractDate(matches[1][0]);

  if (!rangeStart || !rangeEnd) {
    return undefined;
  }

  return { rangeStart, rangeEnd };
}

function looksLikeHeading(line: string): boolean {
  if (timeRangeRegex.test(line)) {
    return false;
  }

  const weekday = extractWeekday(line);
  const date = extractDate(line);
  if (!weekday && !date) {
    return false;
  }

  const cleaned = line
    .replace(/[:|,-]/g, ' ')
    .replace(/\b(schedule|timetable|week|semester|term|effective|from|to)\b/gi, ' ')
    .replace(/\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday|s)?|thu(?:r|rs|ursday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi, ' ')
    .replace(/\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/g, ' ')
    .replace(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi, ' ')
    .replace(/\d{1,4}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.length <= 12;
}

function parseDelimitedRows(rawText: string): ParseResult | null {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) {
    return null;
  }

  const separator = lines[0].includes('\t')
    ? '\t'
    : lines[0].includes(',')
      ? ','
      : lines[0].includes(';')
        ? ';'
        : lines[0].includes('|')
          ? '|'
          : null;

  if (!separator) {
    return null;
  }

  const headers = lines[0].split(separator).map((header) => header.trim().toLowerCase());
  const hasSubjectHeader = headers.some((header) => header.includes('subject') || header.includes('class'));
  const hasTimeHeader = headers.some((header) => header.includes('start') || header.includes('time'));
  if (!hasSubjectHeader || !hasTimeHeader) {
    return null;
  }

  const indexOf = (matcher: (header: string) => boolean) => headers.findIndex(matcher);
  const dayIndex = indexOf((header) => header.includes('day'));
  const dateIndex = indexOf((header) => header === 'date' || header.includes('date'));
  const startIndex = indexOf((header) => header.includes('start'));
  const endIndex = indexOf((header) => header.includes('end'));
  const subjectIndex = indexOf((header) => header.includes('subject') || header.includes('class'));
  const roomIndex = indexOf((header) => header.includes('room') || header.includes('location'));
  const facultyIndex = indexOf((header) => header.includes('faculty') || header.includes('teacher') || header.includes('lecturer'));

  const entries: ScheduleEntry[] = [];
  const warnings: string[] = [];

  lines.slice(1).forEach((line, index) => {
    const cells = line.split(separator).map((cell) => cell.trim());
    const date = dateIndex >= 0 ? extractDate(cells[dateIndex]) : undefined;
    const day = dayIndex >= 0 ? extractWeekday(cells[dayIndex]) : date ? weekdayFromIsoDate(date) : undefined;
    const startTime = startIndex >= 0 ? normaliseTimeValue(cells[startIndex]) : '';
    const endTime = endIndex >= 0 ? normaliseTimeValue(cells[endIndex]) : '';
    const subject = subjectIndex >= 0 ? cells[subjectIndex] : '';

    if (!subject || !startTime || !endTime) {
      warnings.push(`Skipped row ${index + 2} because the time or subject was incomplete.`);
      return;
    }

    entries.push({
      id: createId('entry'),
      date,
      day,
      startTime,
      endTime,
      subject,
      room: roomIndex >= 0 ? cells[roomIndex] || undefined : undefined,
      faculty: facultyIndex >= 0 ? cells[facultyIndex] || undefined : undefined,
      confidence: day || date ? 'high' : 'medium',
      sourceLine: line,
    });
  });

  return { entries, warnings: uniqueWarnings(warnings) };
}

function extractDetails(detailsRaw: string): Pick<ScheduleEntry, 'subject' | 'room' | 'faculty' | 'notes' | 'isBreak'> {
  const details = detailsRaw.replace(/^[|,:;\-\s]+/, '').trim();
  if (!details) {
    return { subject: '' };
  }

  const normalized = details.includes('|')
    ? details
    : details.includes('\t')
      ? details.replace(/\t+/g, '|')
      : details.replace(/\s{2,}/g, ' | ');

  const parts = normalized
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

  let subject = parts[0] ?? details;
  let room = '';
  let faculty = '';
  const notes: string[] = [];

  if (!parts.length && details.includes('@')) {
    const [subjectPart, roomPart] = details.split('@').map((part) => part.trim());
    subject = subjectPart;
    room = roomPart ?? '';
  }

  parts.slice(1).forEach((part) => {
    const cleaned = part.replace(/^(room|faculty|teacher|lecturer)\s*:?\s*/i, '').trim();

    if (!room && roomRegex.test(part)) {
      room = cleaned || part;
      return;
    }

    if (!faculty && facultyRegex.test(part)) {
      faculty = cleaned || part;
      return;
    }

    if (!room && /^[A-Z]{1,4}-?\d{1,4}$/i.test(part)) {
      room = part;
      return;
    }

    notes.push(part);
  });

  if (!room && subject.includes('@')) {
    const [subjectPart, roomPart] = subject.split('@').map((part) => part.trim());
    subject = subjectPart;
    room = roomPart ?? '';
  }

  const isBreak = breakRegex.test(subject);

  return {
    subject: subject.replace(/^subject\s*:?\s*/i, '').trim(),
    room: room || undefined,
    faculty: faculty || undefined,
    notes: notes.length ? notes.join(' | ') : undefined,
    isBreak,
  };
}

function parseEntryLine(line: string, context: ParseContext): ScheduleEntry | null {
  const match = line.match(timeRangeRegex);
  if (!match || match.index === undefined) {
    return null;
  }

  const startTime = normaliseTimeValue(match[1]);
  const endTime = normaliseTimeValue(match[2]);
  const before = line.slice(0, match.index).trim();
  const after = line.slice(match.index + match[0].length).trim();

  const explicitDate = extractDate(before) ?? extractDate(line);
  const explicitDay = extractWeekday(before) ?? extractWeekday(line) ?? (explicitDate ? weekdayFromIsoDate(explicitDate) : undefined) ?? context.day;
  const details = extractDetails(after || before.replace(/^.*?:/, '').trim());

  if (!details.subject) {
    return null;
  }

  return {
    id: createId('entry'),
    date: explicitDate ?? context.date,
    day: explicitDay ?? context.day,
    rangeStart: context.rangeStart,
    rangeEnd: context.rangeEnd,
    startTime,
    endTime,
    subject: details.subject,
    room: details.room,
    faculty: details.faculty,
    notes: details.notes,
    isBreak: details.isBreak,
    confidence: explicitDate || explicitDay || context.day || context.date ? 'high' : 'medium',
    sourceLine: line,
  };
}

function normaliseJsonEntry(value: Record<string, unknown>): ScheduleEntry | null {
  const subject = String(value.subject ?? value.class ?? value.title ?? '').trim();
  const startTime = String(value.startTime ?? value.start ?? '').trim();
  const endTime = String(value.endTime ?? value.end ?? '').trim();
  const parsedDate = value.date ? extractDate(String(value.date)) ?? String(value.date) : undefined;
  const parsedDay = value.day ? extractWeekday(String(value.day)) : parsedDate ? weekdayFromIsoDate(parsedDate) : undefined;

  if (!subject || !startTime || !endTime) {
    return null;
  }

  return {
    id: createId('entry'),
    date: parsedDate,
    day: parsedDay,
    rangeStart: value.rangeStart ? String(value.rangeStart) : undefined,
    rangeEnd: value.rangeEnd ? String(value.rangeEnd) : undefined,
    startTime: normaliseTimeValue(startTime),
    endTime: normaliseTimeValue(endTime),
    subject,
    room: value.room ? String(value.room) : undefined,
    faculty: value.faculty ? String(value.faculty) : undefined,
    notes: value.notes ? String(value.notes) : undefined,
    isBreak: breakRegex.test(subject),
    confidence: 'high',
  };
}

function parseJson(rawText: string): ParseResult | null {
  try {
    const parsed = JSON.parse(rawText) as unknown;
    const records = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { entries?: unknown }).entries)
        ? ((parsed as { entries: unknown[] }).entries as unknown[])
        : null;

    if (!records) {
      return null;
    }

    const entries = records
      .map((record) => (typeof record === 'object' && record !== null ? normaliseJsonEntry(record as Record<string, unknown>) : null))
      .filter((entry): entry is ScheduleEntry => Boolean(entry));

    return entries.length ? { entries, warnings: [] } : null;
  } catch {
    return null;
  }
}

export function parseTimetableText(rawText: string): ParseResult {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { entries: [], warnings: ['Add timetable text before processing the import.'] };
  }

  const jsonResult = parseJson(trimmed);
  if (jsonResult) {
    return sortEntries(jsonResult);
  }

  const delimitedResult = parseDelimitedRows(trimmed);
  if (delimitedResult && delimitedResult.entries.length) {
    return sortEntries(delimitedResult);
  }

  const warnings: string[] = [];
  const entries: ScheduleEntry[] = [];
  const lines = trimmed.split(/\r?\n/).map(normaliseLine).filter(Boolean);
  let context: ParseContext = {};

  lines.forEach((line, index) => {
    const range = extractDateRange(line);
    if (range) {
      context = { ...context, ...range };
    }

    if (looksLikeHeading(line)) {
      const headingDate = extractDate(line);
      context = {
        ...context,
        day: extractWeekday(line) ?? (headingDate ? weekdayFromIsoDate(headingDate) : undefined) ?? context.day,
        date: headingDate ?? undefined,
      };
      return;
    }

    const entry = parseEntryLine(line, context);
    if (!entry) {
      if (timeRangeRegex.test(line)) {
        warnings.push(`Line ${index + 1} included a time range but could not be fully organized.`);
      }
      return;
    }

    if (!entry.date && !entry.day) {
      warnings.push(`Line ${index + 1} was skipped because no day or date could be identified.`);
      return;
    }

    entries.push(entry);
  });

  if (!entries.length) {
    warnings.push('No classes were confidently detected. Review the extracted text and add missing day or time details.');
  }

  return sortEntries({ entries, warnings: uniqueWarnings(warnings) });
}

function sortEntries(result: ParseResult): ParseResult {
  const entries = [...result.entries].sort((first, second) => {
    if (first.date && second.date && first.date !== second.date) {
      return first.date.localeCompare(second.date);
    }

    if (first.date && !second.date) {
      return -1;
    }

    if (!first.date && second.date) {
      return 1;
    }

    const firstDayIndex = first.day ? weekdayOrder.indexOf(first.day) : 99;
    const secondDayIndex = second.day ? weekdayOrder.indexOf(second.day) : 99;

    if (firstDayIndex !== secondDayIndex) {
      return firstDayIndex - secondDayIndex;
    }

    return compareTimes(first.startTime, second.startTime);
  });

  return { entries, warnings: uniqueWarnings(result.warnings) };
}
