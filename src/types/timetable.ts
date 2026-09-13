export type WeekdayKey =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export type ImportSourceKind = 'camera' | 'gallery' | 'document';

export type ExtractionConfidence = 'high' | 'medium' | 'low';

export type ImportSource = {
  id: string;
  kind: ImportSourceKind;
  name: string;
  uri: string;
  mimeType?: string;
  size?: number;
};

export type ScheduleEntry = {
  id: string;
  date?: string;
  day?: WeekdayKey;
  rangeStart?: string;
  rangeEnd?: string;
  startTime: string;
  endTime: string;
  subject: string;
  room?: string;
  faculty?: string;
  notes?: string;
  isBreak?: boolean;
  confidence: ExtractionConfidence;
  sourceLine?: string;
};

export type TimetableData = {
  id: string;
  source: ImportSource;
  importedAt: string;
  rawText: string;
  entries: ScheduleEntry[];
  warnings: string[];
};

export type DraftImport = TimetableData & {
  needsReview: boolean;
};
