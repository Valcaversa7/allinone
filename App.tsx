import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  describeEntryGrouping,
  formatDayNumber,
  formatDayTileMonth,
  formatDayTileWeekday,
  formatImportedAt,
  formatLongDate,
  getDateWindow,
  getEntriesForDate,
  labelForDay,
  shiftDate,
  startOfDay,
  toIsoDate,
  weekdayFromIsoDate,
  weekdayOrder,
} from './src/utils/dates';
import { buildImportSourceFromAsset, extractTextFromSource, PickedImportSource } from './src/utils/importer';
import { normaliseTimeValue, parseTimetableText } from './src/utils/parser';
import { clearSavedTimetable, loadSavedTimetable, saveTimetable } from './src/utils/storage';
import { DraftImport, ScheduleEntry, TimetableData, WeekdayKey } from './src/types/timetable';

type TabKey = 'schedule' | 'timetable' | 'settings';

type Notice = {
  tone: 'success' | 'error';
  message: string;
};

type ProcessingState = {
  active: boolean;
  label: string;
};

type EntryEditorState = {
  target: 'draft' | 'saved';
  isNew: boolean;
  originalId?: string;
  subject: string;
  startTime: string;
  endTime: string;
  room: string;
  faculty: string;
  notes: string;
  day?: WeekdayKey;
  date: string;
};

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function classCount(entries: ScheduleEntry[]): number {
  return entries.filter((entry) => !entry.isBreak).length;
}

function sanitizeSource(source: PickedImportSource): TimetableData['source'] {
  return {
    id: source.id,
    kind: source.kind,
    name: source.name,
    uri: source.uri,
    mimeType: source.mimeType,
    size: source.size,
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function openEditorForEntry(entry: ScheduleEntry, target: 'draft' | 'saved'): EntryEditorState {
  return {
    target,
    isNew: false,
    originalId: entry.id,
    subject: entry.subject,
    startTime: entry.startTime,
    endTime: entry.endTime,
    room: entry.room ?? '',
    faculty: entry.faculty ?? '',
    notes: entry.notes ?? '',
    day: entry.day,
    date: entry.date ?? '',
  };
}

function createNewEditor(target: 'draft' | 'saved', fallbackDay: WeekdayKey): EntryEditorState {
  return {
    target,
    isNew: true,
    subject: '',
    startTime: '09:00',
    endTime: '10:00',
    room: '',
    faculty: '',
    notes: '',
    day: fallbackDay,
    date: '',
  };
}

function isValidTime(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value);
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function buildEntryFromEditor(editor: EntryEditorState): ScheduleEntry | null {
  const subject = editor.subject.trim();
  const startTime = normaliseTimeValue(editor.startTime);
  const endTime = normaliseTimeValue(editor.endTime);
  const date = editor.date.trim();
  const normalizedDate = date ? date : undefined;
  const derivedDay = normalizedDate ? weekdayFromIsoDate(normalizedDate) : editor.day;

  if (
    !subject ||
    !isValidTime(startTime) ||
    !isValidTime(endTime) ||
    (normalizedDate ? !isValidIsoDate(normalizedDate) : !derivedDay)
  ) {
    return null;
  }

  return {
    id: editor.originalId ?? createId('entry'),
    date: normalizedDate,
    day: derivedDay,
    startTime,
    endTime,
    subject,
    room: editor.room.trim() || undefined,
    faculty: editor.faculty.trim() || undefined,
    notes: editor.notes.trim() || undefined,
    confidence: 'high',
    isBreak: /\b(break|lunch|recess)\b/i.test(subject),
  };
}

function sortEntries(entries: ScheduleEntry[]): ScheduleEntry[] {
  return [...entries].sort((first, second) => {
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

    return first.startTime.localeCompare(second.startTime);
  });
}

function groupEntries(entries: ScheduleEntry[]): Array<{ title: string; items: ScheduleEntry[] }> {
  const groups = new Map<string, ScheduleEntry[]>();

  sortEntries(entries).forEach((entry) => {
    const key = describeEntryGrouping(entry);
    const existing = groups.get(key) ?? [];
    existing.push(entry);
    groups.set(key, existing);
  });

  return Array.from(groups.entries()).map(([title, items]) => ({ title, items }));
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('schedule');
  const [selectedDate, setSelectedDate] = useState(startOfDay(new Date()));
  const [savedTimetableState, setSavedTimetableState] = useState<TimetableData | null>(null);
  const [draftImport, setDraftImport] = useState<DraftImport | null>(null);
  const [processing, setProcessing] = useState<ProcessingState>({ active: true, label: 'Loading timetable' });
  const [isReady, setIsReady] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sourcePickerVisible, setSourcePickerVisible] = useState(false);
  const [editorState, setEditorState] = useState<EntryEditorState | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const saved = await loadSavedTimetable();
        if (saved) {
          setSavedTimetableState(saved);
        }
      } catch {
        setNotice({ tone: 'error', message: 'Saved timetable could not be loaded.' });
      } finally {
        setProcessing({ active: false, label: '' });
        setIsReady(true);
      }
    };

    load();
  }, []);

  const savedClassesForDate = useMemo(() => {
    if (!savedTimetableState) {
      return [];
    }

    return getEntriesForDate(selectedDate, savedTimetableState.entries).filter((entry) => !entry.isBreak);
  }, [savedTimetableState, selectedDate]);

  const dateWindow = useMemo(() => getDateWindow(selectedDate, 5), [selectedDate]);
  const groupedTimetableEntries = useMemo(
    () => groupEntries(savedTimetableState?.entries ?? []),
    [savedTimetableState],
  );

  const processPickedSource = async (source: PickedImportSource) => {
    setSourcePickerVisible(false);
    setNotice(null);
    setProcessing({ active: true, label: 'Analyzing on this device' });

    try {
      const extracted = await extractTextFromSource(source);
      setProcessing({ active: true, label: 'Organizing classes on this device' });

      const parsed = extracted.rawText.trim()
        ? parseTimetableText(extracted.rawText)
        : { entries: [] as ScheduleEntry[], warnings: ['No readable text was found yet. Review the import and correct it if needed.'] };

      const nextDraft: DraftImport = {
        id: createId('timetable'),
        source: sanitizeSource(source),
        importedAt: new Date().toISOString(),
        rawText: extracted.rawText,
        entries: sortEntries(parsed.entries),
        warnings: uniqueStrings([...extracted.warnings, ...parsed.warnings]),
        needsReview: parsed.entries.length === 0 || extracted.warnings.length > 0,
      };

      setDraftImport(nextDraft);
    } catch {
      setNotice({ tone: 'error', message: 'The timetable could not be imported on this device. Try a clearer image or a different file.' });
    } finally {
      setProcessing({ active: false, label: '' });
    }
  };

  const handlePickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled) {
      return;
    }

    const file = result.assets[0] as typeof result.assets[0] & { file?: { text?: () => Promise<string> } | null };
    await processPickedSource(buildImportSourceFromAsset(file, 'document'));
  };

  const handlePickFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setNotice({ tone: 'error', message: 'Photo library access is required to import a timetable image.' });
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets[0] as typeof result.assets[0] & { file?: { text?: () => Promise<string> } | null };
    await processPickedSource(buildImportSourceFromAsset(asset, 'gallery'));
  };

  const handlePickFromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setNotice({ tone: 'error', message: 'Camera access is required to capture a timetable photo.' });
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets[0] as typeof result.assets[0] & { file?: { text?: () => Promise<string> } | null };
    await processPickedSource(buildImportSourceFromAsset(asset, 'camera'));
  };

  const handleReprocessDraft = () => {
    if (!draftImport) {
      return;
    }

    const parsed = parseTimetableText(draftImport.rawText);
    setDraftImport({
      ...draftImport,
      entries: sortEntries(parsed.entries),
      warnings: uniqueStrings(parsed.warnings),
      needsReview: parsed.entries.length === 0 || parsed.warnings.length > 0,
    });
  };

  const handleSaveDraft = async () => {
    if (!draftImport) {
      return;
    }

    if (classCount(draftImport.entries) === 0) {
      setNotice({ tone: 'error', message: 'Add at least one class before saving the timetable.' });
      return;
    }

    const finalData: TimetableData = {
      ...draftImport,
      entries: sortEntries(draftImport.entries),
      warnings: uniqueStrings(draftImport.warnings),
    };

    await saveTimetable(finalData);
    setSavedTimetableState(finalData);
    setDraftImport(null);
    setActiveTab('schedule');
    setNotice({ tone: 'success', message: 'Timetable imported.' });
  };

  const handleClearSaved = async () => {
    await clearSavedTimetable();
    setSavedTimetableState(null);
    setActiveTab('schedule');
    setNotice({ tone: 'success', message: 'Timetable removed.' });
  };

  const beginEditingSaved = (entry: ScheduleEntry) => setEditorState(openEditorForEntry(entry, 'saved'));
  const beginEditingDraft = (entry: ScheduleEntry) => setEditorState(openEditorForEntry(entry, 'draft'));

  const openNewSavedEntry = () => setEditorState(createNewEditor('saved', weekdayFromIsoDate(toIsoDate(selectedDate))));
  const openNewDraftEntry = () => setEditorState(createNewEditor('draft', weekdayFromIsoDate(toIsoDate(selectedDate))));

  const handleSaveEditor = async () => {
    if (!editorState) {
      return;
    }

    const nextEntry = buildEntryFromEditor(editorState);
    if (!nextEntry) {
      setNotice({ tone: 'error', message: 'Each class needs a subject, start time, end time, and either a day or an exact date.' });
      return;
    }

    if (editorState.target === 'draft' && draftImport) {
      const nextEntries = editorState.isNew
        ? [...draftImport.entries, nextEntry]
        : draftImport.entries.map((entry) => (entry.id === editorState.originalId ? { ...entry, ...nextEntry } : entry));

      setDraftImport({ ...draftImport, entries: sortEntries(nextEntries) });
    }

    if (editorState.target === 'saved' && savedTimetableState) {
      const nextEntries = editorState.isNew
        ? [...savedTimetableState.entries, nextEntry]
        : savedTimetableState.entries.map((entry) => (entry.id === editorState.originalId ? { ...entry, ...nextEntry } : entry));

      const nextTimetable = { ...savedTimetableState, entries: sortEntries(nextEntries) };
      setSavedTimetableState(nextTimetable);
      await saveTimetable(nextTimetable);
    }

    setEditorState(null);
    setNotice({ tone: 'success', message: 'Class updated.' });
  };

  const handleDeleteEditorEntry = async () => {
    if (!editorState?.originalId) {
      return;
    }

    if (editorState.target === 'draft' && draftImport) {
      setDraftImport({
        ...draftImport,
        entries: draftImport.entries.filter((entry) => entry.id !== editorState.originalId),
      });
    }

    if (editorState.target === 'saved' && savedTimetableState) {
      const nextTimetable = {
        ...savedTimetableState,
        entries: savedTimetableState.entries.filter((entry) => entry.id !== editorState.originalId),
      };
      setSavedTimetableState(nextTimetable);
      await saveTimetable(nextTimetable);
    }

    setEditorState(null);
    setNotice({ tone: 'success', message: 'Class removed.' });
  };

  const renderNotice = () => {
    if (!notice) {
      return null;
    }

    return (
      <View style={[styles.notice, notice.tone === 'error' ? styles.noticeError : styles.noticeSuccess]}>
        <Text style={styles.noticeText}>{notice.message}</Text>
        <Pressable onPress={() => setNotice(null)} hitSlop={10}>
          <Text style={styles.noticeDismiss}>Close</Text>
        </Pressable>
      </View>
    );
  };

  const renderEntryList = (
    entries: ScheduleEntry[],
    onEdit: (entry: ScheduleEntry) => void,
    emptyTitle: string,
    emptyBody?: string,
  ) => {
    if (!entries.length) {
      return (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>{emptyTitle}</Text>
          {emptyBody ? <Text style={styles.emptyBody}>{emptyBody}</Text> : null}
        </View>
      );
    }

    return (
      <View style={styles.listBlock}>
        {entries.map((entry, index) => (
          <Pressable key={entry.id} style={[styles.entryRow, index > 0 && styles.entryRowDivider]} onPress={() => onEdit(entry)}>
            <View style={styles.entryTimeBlock}>
              <Text style={styles.entryTime}>{entry.startTime}</Text>
              <Text style={styles.entryDash}>–</Text>
              <Text style={styles.entryTime}>{entry.endTime}</Text>
            </View>
            <View style={styles.entryBodyBlock}>
              <Text style={styles.entrySubject}>{entry.subject}</Text>
              {entry.room ? <Text style={styles.entryMeta}>{entry.room}</Text> : null}
              {entry.faculty ? <Text style={styles.entryMeta}>{entry.faculty}</Text> : null}
              {entry.notes ? <Text style={styles.entryNotes}>{entry.notes}</Text> : null}
            </View>
            <Text style={styles.editLabel}>Edit</Text>
          </Pressable>
        ))}
      </View>
    );
  };

  const renderImportReview = () => {
    if (!draftImport) {
      return null;
    }

    const importCount = classCount(draftImport.entries);

    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
          {renderNotice()}
          <View style={styles.headerBlock}>
            <Text style={styles.screenTitle}>{importCount > 0 ? 'Timetable imported' : 'Review import'}</Text>
            <Text style={styles.screenSubtitle}>
              {importCount > 0
                ? `${importCount} classes found. Review the detected schedule before saving it.`
                : 'Review the imported timetable and correct anything the on-device scan could not read confidently.'}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Imported file</Text>
            <Text style={styles.detailText}>{draftImport.source.name}</Text>
            <Text style={styles.detailSubtext}>{draftImport.source.kind.toUpperCase()}</Text>
          </View>

          {draftImport.warnings.length ? (
            <View style={styles.warningSection}>
              <Text style={styles.warningTitle}>Needs review</Text>
              {draftImport.warnings.map((warning) => (
                <Text key={warning} style={styles.warningText}>
                  • {warning}
                </Text>
              ))}
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Detected timetable text</Text>
            <TextInput
              multiline
              value={draftImport.rawText}
              onChangeText={(value) => setDraftImport({ ...draftImport, rawText: value })}
              textAlignVertical="top"
              style={styles.textArea}
              placeholder="If anything was missed, paste or correct the timetable text here."
              placeholderTextColor="#7d7d7d"
            />
            <View style={styles.buttonRow}>
              <Pressable style={styles.primaryButton} onPress={handleReprocessDraft}>
                <Text style={styles.primaryButtonText}>Process timetable</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={openNewDraftEntry}>
                <Text style={styles.secondaryButtonText}>Add class</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Detected classes</Text>
            {renderEntryList(
              draftImport.entries.filter((entry) => !entry.isBreak),
              beginEditingDraft,
              'No classes found yet',
              'Process the timetable text or add classes manually.',
            )}
          </View>

          <View style={styles.buttonRow}>
            <Pressable style={styles.primaryButton} onPress={handleSaveDraft}>
              <Text style={styles.primaryButtonText}>Save timetable</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setDraftImport(null)}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyStateWrap}>
      <Text style={styles.emptyStateTitle}>Add your timetable</Text>
      <Text style={styles.emptyStateBody}>
        Upload a photo, screenshot, or PDF of your timetable and we'll organize your classes by day.
      </Text>
      <Pressable style={styles.primaryButton} onPress={() => setSourcePickerVisible(true)}>
        <Text style={styles.primaryButtonText}>Upload timetable</Text>
      </Pressable>
      <View style={styles.supportedBlock}>
        <Text style={styles.supportedTitle}>Supported imports</Text>
        <Text style={styles.supportedText}>Camera or photo</Text>
        <Text style={styles.supportedText}>Screenshot or gallery image</Text>
        <Text style={styles.supportedText}>PDF and text-based documents</Text>
      </View>
    </View>
  );

  const renderScheduleScreen = () => {
    if (!savedTimetableState) {
      return renderEmptyState();
    }

    return (
      <ScrollView contentContainerStyle={styles.screenContent}>
        {renderNotice()}
        <View style={styles.headerBlock}>
          <Text style={styles.screenTitle}>Schedule</Text>
          <Text style={styles.screenSubtitle}>What class do I have today, and when?</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.dateHeaderRow}>
            <Pressable style={styles.smallButton} onPress={() => setSelectedDate(shiftDate(selectedDate, -1))}>
              <Text style={styles.smallButtonText}>Previous day</Text>
            </Pressable>
            <Pressable style={styles.smallButton} onPress={() => setSelectedDate(shiftDate(selectedDate, 1))}>
              <Text style={styles.smallButtonText}>Next day</Text>
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayStrip}>
            {dateWindow.map((date) => {
              const selected = date.toDateString() === selectedDate.toDateString();
              return (
                <Pressable
                  key={date.toISOString()}
                  onPress={() => setSelectedDate(date)}
                  style={[styles.dayTile, selected && styles.dayTileSelected]}
                >
                  <Text style={[styles.dayTileWeekday, selected && styles.dayTileTextSelected]}>{formatDayTileWeekday(date)}</Text>
                  <Text style={[styles.dayTileNumber, selected && styles.dayTileTextSelected]}>{formatDayNumber(date)}</Text>
                  <Text style={[styles.dayTileMonth, selected && styles.dayTileTextSelected]}>{formatDayTileMonth(date)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{formatLongDate(selectedDate)}</Text>
          {renderEntryList(savedClassesForDate, beginEditingSaved, 'No classes', "You're free today.")}
        </View>
      </ScrollView>
    );
  };

  const renderTimetableScreen = () => {
    if (!savedTimetableState) {
      return renderEmptyState();
    }

    return (
      <ScrollView contentContainerStyle={styles.screenContent}>
        {renderNotice()}
        <View style={styles.headerBlock}>
          <Text style={styles.screenTitle}>Timetable</Text>
          <Text style={styles.screenSubtitle}>Review the imported schedule and edit anything that needs fixing.</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.summaryRow}>
            <View>
              <Text style={styles.detailText}>{savedTimetableState.source.name}</Text>
              <Text style={styles.detailSubtext}>Imported {formatImportedAt(savedTimetableState.importedAt)}</Text>
            </View>
            <Pressable style={styles.smallButton} onPress={openNewSavedEntry}>
              <Text style={styles.smallButtonText}>Add class</Text>
            </Pressable>
          </View>
        </View>

        {groupedTimetableEntries.map((group) => (
          <View key={group.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{group.title}</Text>
            {renderEntryList(group.items, beginEditingSaved, 'No classes', undefined)}
          </View>
        ))}
      </ScrollView>
    );
  };

  const renderSettingsScreen = () => (
    <ScrollView contentContainerStyle={styles.screenContent}>
      {renderNotice()}
      <View style={styles.headerBlock}>
        <Text style={styles.screenTitle}>Settings</Text>
        <Text style={styles.screenSubtitle}>Manage imports and timetable data.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Import</Text>
        <Pressable style={styles.primaryButton} onPress={() => setSourcePickerVisible(true)}>
          <Text style={styles.primaryButtonText}>{savedTimetableState ? 'Replace timetable' : 'Upload timetable'}</Text>
        </Pressable>
        {savedTimetableState ? (
          <Pressable
            style={styles.secondaryButton}
            onPress={() =>
              setDraftImport({
                ...savedTimetableState,
                warnings: uniqueStrings(savedTimetableState.warnings),
                needsReview: false,
              })
            }
          >
            <Text style={styles.secondaryButtonText}>Review imported data</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Current timetable</Text>
        {savedTimetableState ? (
          <>
            <Text style={styles.detailText}>{savedTimetableState.source.name}</Text>
            <Text style={styles.detailSubtext}>{classCount(savedTimetableState.entries)} classes saved</Text>
            <Pressable style={styles.secondaryButton} onPress={handleClearSaved}>
              <Text style={styles.secondaryButtonText}>Remove timetable</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.detailSubtext}>No timetable has been saved yet.</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About this build</Text>
        <Text style={styles.detailSubtext}>Image analysis runs on the device using native OCR on Android and iPhone builds.</Text>
        <Text style={styles.detailSubtext}>There is no backend or API requirement for timetable parsing in this app.</Text>
        <Text style={styles.detailSubtext}>Text files and structured documents can be processed directly offline.</Text>
        <Text style={styles.detailSubtext}>PDF offline extraction is not finished yet, so PDF imports may still need manual review.</Text>
      </View>
    </ScrollView>
  );

  const renderMainApp = () => (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.appShell}>
        <View style={styles.contentArea}>
          {activeTab === 'schedule' && renderScheduleScreen()}
          {activeTab === 'timetable' && renderTimetableScreen()}
          {activeTab === 'settings' && renderSettingsScreen()}
        </View>

        <View style={styles.tabBar}>
          {(['schedule', 'timetable', 'settings'] as TabKey[]).map((tab) => {
            const active = tab === activeTab;
            return (
              <Pressable key={tab} style={[styles.tabItem, active && styles.tabItemActive]} onPress={() => setActiveTab(tab)}>
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.charAt(0).toUpperCase() + tab.slice(1)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Modal visible={sourcePickerVisible} transparent animationType="slide" onRequestClose={() => setSourcePickerVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Upload timetable</Text>
            <Text style={styles.modalBody}>Choose where to import the timetable from. Image analysis runs on the phone in native app builds.</Text>
            <Pressable style={styles.modalOption} onPress={handlePickFromCamera}>
              <Text style={styles.modalOptionText}>Take photo</Text>
            </Pressable>
            <Pressable style={styles.modalOption} onPress={handlePickFromLibrary}>
              <Text style={styles.modalOptionText}>Choose from gallery</Text>
            </Pressable>
            <Pressable style={styles.modalOption} onPress={handlePickDocument}>
              <Text style={styles.modalOptionText}>Choose PDF or document</Text>
            </Pressable>
            <Pressable style={styles.modalCancel} onPress={() => setSourcePickerVisible(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(editorState)} transparent animationType="slide" onRequestClose={() => setEditorState(null)}>
        <View style={styles.modalBackdrop}>
          <ScrollView contentContainerStyle={styles.editorWrap} keyboardShouldPersistTaps="handled">
            <View style={styles.editorCard}>
              <Text style={styles.modalTitle}>{editorState?.isNew ? 'Add class' : 'Edit class'}</Text>
              <Text style={styles.modalBody}>Update the imported information if anything was unclear.</Text>

              <Text style={styles.fieldLabel}>Subject</Text>
              <TextInput
                value={editorState?.subject ?? ''}
                onChangeText={(value) => setEditorState((current) => (current ? { ...current, subject: value } : current))}
                style={styles.fieldInput}
                placeholder="Engineering Mathematics"
                placeholderTextColor="#7d7d7d"
              />

              <View style={styles.inlineFields}>
                <View style={styles.inlineField}>
                  <Text style={styles.fieldLabel}>Start</Text>
                  <TextInput
                    value={editorState?.startTime ?? ''}
                    onChangeText={(value) => setEditorState((current) => (current ? { ...current, startTime: value } : current))}
                    style={styles.fieldInput}
                    placeholder="09:00"
                    placeholderTextColor="#7d7d7d"
                  />
                </View>
                <View style={styles.inlineField}>
                  <Text style={styles.fieldLabel}>End</Text>
                  <TextInput
                    value={editorState?.endTime ?? ''}
                    onChangeText={(value) => setEditorState((current) => (current ? { ...current, endTime: value } : current))}
                    style={styles.fieldInput}
                    placeholder="10:00"
                    placeholderTextColor="#7d7d7d"
                  />
                </View>
              </View>

              <Text style={styles.fieldLabel}>Day</Text>
              <View style={styles.weekdayPicker}>
                {weekdayOrder.map((day) => {
                  const active = day === editorState?.day;
                  return (
                    <Pressable
                      key={day}
                      style={[styles.weekdayButton, active && styles.weekdayButtonActive]}
                      onPress={() => setEditorState((current) => (current ? { ...current, day } : current))}
                    >
                      <Text style={[styles.weekdayButtonText, active && styles.weekdayButtonTextActive]}>{labelForDay(day).slice(0, 3)}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Exact date (optional)</Text>
              <TextInput
                value={editorState?.date ?? ''}
                onChangeText={(value) => setEditorState((current) => (current ? { ...current, date: value } : current))}
                style={styles.fieldInput}
                placeholder="2026-09-15"
                placeholderTextColor="#7d7d7d"
                autoCapitalize="none"
              />

              <Text style={styles.fieldLabel}>Room</Text>
              <TextInput
                value={editorState?.room ?? ''}
                onChangeText={(value) => setEditorState((current) => (current ? { ...current, room: value } : current))}
                style={styles.fieldInput}
                placeholder="Room 204"
                placeholderTextColor="#7d7d7d"
              />

              <Text style={styles.fieldLabel}>Faculty</Text>
              <TextInput
                value={editorState?.faculty ?? ''}
                onChangeText={(value) => setEditorState((current) => (current ? { ...current, faculty: value } : current))}
                style={styles.fieldInput}
                placeholder="Dr. Rao"
                placeholderTextColor="#7d7d7d"
              />

              <Text style={styles.fieldLabel}>Notes</Text>
              <TextInput
                value={editorState?.notes ?? ''}
                onChangeText={(value) => setEditorState((current) => (current ? { ...current, notes: value } : current))}
                style={[styles.fieldInput, styles.notesInput]}
                multiline
                textAlignVertical="top"
                placeholder="Optional notes"
                placeholderTextColor="#7d7d7d"
              />

              <View style={styles.buttonRow}>
                <Pressable style={styles.primaryButton} onPress={handleSaveEditor}>
                  <Text style={styles.primaryButtonText}>Save class</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => setEditorState(null)}>
                  <Text style={styles.secondaryButtonText}>Close</Text>
                </Pressable>
              </View>

              {!editorState?.isNew ? (
                <Pressable style={styles.deleteButton} onPress={handleDeleteEditorEntry}>
                  <Text style={styles.deleteButtonText}>Delete class</Text>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );

  if (!isReady || processing.active) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.processingScreen}>
          <ActivityIndicator size="small" color="#111111" />
          <Text style={styles.processingTitle}>{processing.label || 'Loading'}</Text>
          <Text style={styles.processingBody}>Please wait while the timetable is read and organized on this device.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (draftImport) {
    return renderImportReview();
  }

  return renderMainApp();
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  appShell: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  contentArea: {
    flex: 1,
  },
  screenContent: {
    padding: 20,
    gap: 18,
    paddingBottom: 28,
  },
  processingScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: '#ffffff',
  },
  processingTitle: {
    color: '#111111',
    fontSize: 18,
    fontWeight: '700',
  },
  processingBody: {
    color: '#666666',
    fontSize: 14,
    textAlign: 'center',
  },
  notice: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  noticeSuccess: {
    borderColor: '#d1d5db',
    backgroundColor: '#f5f5f5',
  },
  noticeError: {
    borderColor: '#d4d4d4',
    backgroundColor: '#fafafa',
  },
  noticeText: {
    flex: 1,
    color: '#111111',
    fontSize: 14,
  },
  noticeDismiss: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '700',
  },
  headerBlock: {
    gap: 6,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111111',
    letterSpacing: -0.3,
  },
  screenSubtitle: {
    color: '#5a5a5a',
    fontSize: 15,
    lineHeight: 22,
  },
  section: {
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 10,
    padding: 16,
    gap: 14,
    backgroundColor: '#ffffff',
  },
  warningSection: {
    borderWidth: 1,
    borderColor: '#d4d4d4',
    borderRadius: 10,
    padding: 16,
    gap: 8,
    backgroundColor: '#fafafa',
  },
  warningTitle: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '700',
  },
  warningText: {
    color: '#4b4b4b',
    fontSize: 14,
    lineHeight: 20,
  },
  sectionTitle: {
    color: '#111111',
    fontSize: 18,
    fontWeight: '700',
  },
  detailText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
  detailSubtext: {
    color: '#666666',
    fontSize: 14,
    lineHeight: 20,
  },
  textArea: {
    minHeight: 220,
    borderWidth: 1,
    borderColor: '#d4d4d4',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#111111',
    backgroundColor: '#ffffff',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  primaryButton: {
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 8,
    backgroundColor: '#111111',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#111111',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cfcfcf',
  },
  secondaryButtonText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '700',
  },
  emptyStateWrap: {
    padding: 20,
    gap: 18,
  },
  emptyStateTitle: {
    color: '#111111',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  emptyStateBody: {
    color: '#5a5a5a',
    fontSize: 16,
    lineHeight: 24,
  },
  supportedBlock: {
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 10,
    padding: 16,
    gap: 8,
  },
  supportedTitle: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '700',
  },
  supportedText: {
    color: '#5a5a5a',
    fontSize: 14,
  },
  dateHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  smallButton: {
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d4d4d4',
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  smallButtonText: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '700',
  },
  dayStrip: {
    gap: 10,
  },
  dayTile: {
    width: 78,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#d4d4d4',
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#ffffff',
    gap: 4,
  },
  dayTileSelected: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  dayTileWeekday: {
    color: '#111111',
    fontSize: 12,
    fontWeight: '700',
  },
  dayTileNumber: {
    color: '#111111',
    fontSize: 24,
    fontWeight: '800',
  },
  dayTileMonth: {
    color: '#111111',
    fontSize: 12,
    fontWeight: '700',
  },
  dayTileTextSelected: {
    color: '#ffffff',
  },
  listBlock: {
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    overflow: 'hidden',
  },
  entryRow: {
    flexDirection: 'row',
    padding: 14,
    gap: 14,
    alignItems: 'flex-start',
    backgroundColor: '#ffffff',
  },
  entryRowDivider: {
    borderTopWidth: 1,
    borderTopColor: '#ececec',
  },
  entryTimeBlock: {
    width: 76,
    gap: 2,
  },
  entryTime: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '700',
  },
  entryDash: {
    color: '#9a9a9a',
    fontSize: 13,
  },
  entryBodyBlock: {
    flex: 1,
    gap: 4,
  },
  entrySubject: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '700',
  },
  entryMeta: {
    color: '#4b4b4b',
    fontSize: 14,
  },
  entryNotes: {
    color: '#6f6f6f',
    fontSize: 13,
    lineHeight: 18,
  },
  editLabel: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyPanel: {
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    padding: 18,
    gap: 6,
    backgroundColor: '#ffffff',
  },
  emptyTitle: {
    color: '#111111',
    fontSize: 18,
    fontWeight: '700',
  },
  emptyBody: {
    color: '#5a5a5a',
    fontSize: 14,
    lineHeight: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#e5e5e5',
    backgroundColor: '#ffffff',
  },
  tabItem: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    borderTopWidth: 2,
    borderTopColor: 'transparent',
  },
  tabItemActive: {
    borderTopColor: '#111111',
  },
  tabLabel: {
    color: '#666666',
    fontSize: 13,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: '#111111',
    fontWeight: '800',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    color: '#111111',
    fontSize: 22,
    fontWeight: '800',
  },
  modalBody: {
    color: '#5a5a5a',
    fontSize: 14,
    lineHeight: 20,
  },
  modalOption: {
    borderWidth: 1,
    borderColor: '#d4d4d4',
    borderRadius: 8,
    paddingVertical: 15,
    paddingHorizontal: 14,
    backgroundColor: '#ffffff',
  },
  modalOptionText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '700',
  },
  modalCancel: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalCancelText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '700',
  },
  editorWrap: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  editorCard: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 20,
    gap: 12,
  },
  fieldLabel: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '700',
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: '#d4d4d4',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: '#111111',
    fontSize: 15,
    backgroundColor: '#ffffff',
  },
  notesInput: {
    minHeight: 100,
  },
  inlineFields: {
    flexDirection: 'row',
    gap: 10,
  },
  inlineField: {
    flex: 1,
    gap: 8,
  },
  weekdayPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  weekdayButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#d4d4d4',
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  weekdayButtonActive: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  weekdayButtonText: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '700',
  },
  weekdayButtonTextActive: {
    color: '#ffffff',
  },
  deleteButton: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#d4d4d4',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  deleteButtonText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '700',
  },
});
