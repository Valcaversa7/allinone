import AsyncStorage from '@react-native-async-storage/async-storage';

import { TimetableData } from '../types/timetable';

const STORAGE_KEY = 'allinone/timetable';

export async function loadSavedTimetable(): Promise<TimetableData | null> {
  const value = await AsyncStorage.getItem(STORAGE_KEY);
  if (!value) {
    return null;
  }

  return JSON.parse(value) as TimetableData;
}

export async function saveTimetable(data: TimetableData): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export async function clearSavedTimetable(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
