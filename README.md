# allinone

Mobile-first Expo React Native app for students to import a timetable and turn it into a date-based class schedule.

## Offline-first approach

This app is designed so timetable analysis happens on the device.

- No backend service is required for timetable parsing.
- No API call is used to extract classes from images.
- Image OCR uses the phone's native OCR engine through `expo-ocr-kit`.
- Text, CSV, and JSON timetable files can be parsed locally.

## Current offline support

### Works offline in native app builds

- Camera import
- Gallery image import
- On-device OCR for timetable images
- Local parsing into structured classes
- Local storage of the saved timetable

### Partially supported

- PDF import is available, but full offline PDF extraction is not finished yet.
- For PDFs, the current flow may require manual review or importing a screenshot/photo of the timetable instead.

## MVP flow

1. Upload a timetable from camera, gallery, PDF, or document.
2. Extract timetable text where possible on the device.
3. Parse it into structured schedule entries.
4. Review and edit detected classes.
5. Open the schedule and see only the classes for the selected date.

## Screens

- **Schedule** — date selector with previous/next day navigation and a simple class list.
- **Timetable** — full imported timetable with edit, delete, and add-class support.
- **Settings** — replace timetable, review imported data, and clear saved data.

## Data model

Each class is stored as structured data similar to:

```json
{
  "date": "2026-09-15",
  "day": "tuesday",
  "startTime": "09:00",
  "endTime": "10:00",
  "subject": "Engineering Mathematics",
  "room": "Room 204",
  "faculty": "Dr Rao"
}
```

Optional fields stay empty if they were not confidently detected.

## Important build note

`expo-ocr-kit` uses native code, so on-device OCR does **not** run inside Expo Go.
Use a native development build or release build instead.

Typical local workflow:

```bash
npm install
npx expo prebuild
npx expo run:android
```

or

```bash
npx expo run:ios
```

## APK build setup

This repo includes:

- `eas.json` for optional Expo/EAS cloud builds
- `.github/workflows/android-apk.yml` for GitHub Actions APK builds without requiring an Expo account

The GitHub Actions workflow:

- runs `expo prebuild` for Android
- builds an installable debug APK with Gradle
- uploads the APK as a workflow artifact
- can also attach the APK to a GitHub release tag when manually triggered

To trigger from GitHub:

1. Open **Actions**
2. Choose **Build Android APK**
3. Click **Run workflow**
4. Optionally enter a release tag such as `v0.1.0-mobile-mvp`

## EAS build profiles

This repo also includes `eas.json` with:

- `development` for a dev client
- `preview` for an installable Android APK
- `production` for an Android app bundle

Typical cloud build commands:

```bash
npx eas build --platform android --profile preview
```

```bash
npx eas build --platform android --profile production
```

## Browser preview

The sandbox browser preview is only for UI testing.
It cannot represent real offline phone OCR behavior.
