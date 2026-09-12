import * as FileSystem from 'expo-file-system';
import { recognizeText } from 'expo-ocr-kit';
import { Platform } from 'react-native';

import { ImportSource, ImportSourceKind } from '../types/timetable';

type MaybeWebFile = {
  text?: () => Promise<string>;
};

export type PickedImportSource = ImportSource & {
  webFile?: MaybeWebFile | null;
};

export type ExtractedSourceText = {
  rawText: string;
  warnings: string[];
};

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function extensionFromName(name: string): string {
  const segments = name.toLowerCase().split('.');
  return segments.length > 1 ? segments.at(-1) ?? '' : '';
}

function canReadAsText(source: PickedImportSource): boolean {
  const extension = extensionFromName(source.name);
  return source.mimeType?.startsWith('text/') || ['txt', 'csv', 'json', 'md'].includes(extension);
}

function isImageSource(source: PickedImportSource): boolean {
  const extension = extensionFromName(source.name);
  return source.mimeType?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(extension);
}

function isPdfSource(source: PickedImportSource): boolean {
  const extension = extensionFromName(source.name);
  return source.mimeType?.includes('pdf') || extension === 'pdf';
}

async function readTextSource(source: PickedImportSource): Promise<string> {
  if (Platform.OS === 'web' && source.webFile && typeof source.webFile.text === 'function') {
    return source.webFile.text();
  }

  return FileSystem.readAsStringAsync(source.uri, { encoding: FileSystem.EncodingType.UTF8 });
}

async function runNativeImageOcr(source: PickedImportSource): Promise<ExtractedSourceText> {
  const warnings: string[] = [];

  if (Platform.OS === 'web') {
    warnings.push('On-device OCR runs only in the Android or iPhone app build. Browser preview cannot analyze images offline.');
    return { rawText: '', warnings };
  }

  try {
    const result = await recognizeText(source.uri);
    const rawText = result.text?.trim() ?? '';

    if (!rawText) {
      warnings.push('The image was scanned on this device, but no timetable text could be read confidently.');
    }

    return { rawText, warnings };
  } catch {
    warnings.push('On-device OCR is unavailable in this runtime. Use a development build or release build instead of Expo Go.');
    return { rawText: '', warnings };
  }
}

export function buildImportSourceFromAsset(
  asset: {
    name?: string | null;
    uri: string;
    mimeType?: string | null;
    fileSize?: number;
    size?: number;
    file?: MaybeWebFile | null;
  },
  kind: ImportSourceKind,
): PickedImportSource {
  return {
    id: createId('source'),
    kind,
    name: asset.name || 'Timetable file',
    uri: asset.uri,
    mimeType: asset.mimeType ?? undefined,
    size: asset.fileSize ?? asset.size ?? undefined,
    webFile: asset.file ?? null,
  };
}

export async function extractTextFromSource(source: PickedImportSource): Promise<ExtractedSourceText> {
  const warnings: string[] = [];

  if (canReadAsText(source)) {
    const rawText = await readTextSource(source);
    return { rawText, warnings };
  }

  if (isImageSource(source)) {
    return runNativeImageOcr(source);
  }

  if (isPdfSource(source)) {
    warnings.push('The PDF was imported, but full offline PDF extraction is not implemented yet. Import a screenshot/photo of the timetable or review the detected text manually.');
    return { rawText: '', warnings };
  }

  warnings.push('This file was imported, but offline extraction is not available for this format yet. Review the import and add classes manually if needed.');
  return { rawText: '', warnings };
}
