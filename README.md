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

## EAS build profiles

This repo includes `eas.json` with:

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

## Smaller Android downloads

The original 184.75 MB download was an `assembleDebug` APK built from commit
`e148792`, with Expo 57 / React Native 0.86 dependencies. This branch uses that
build-tested dependency snapshot rather than the older Expo 51 release-tag
snapshot. It also uses the legacy FileSystem entry point required by the existing
text-import API on current Expo versions.

The new **Build small Android APKs** GitHub Actions workflow builds
`assembleRelease`, embeds the JavaScript/Hermes bundle, enables R8 code shrinking
and resource shrinking, and compresses native libraries and the JS bundle.
Camera, local OCR models, document import, editing, and storage are retained.
Compression reduces download size; installed size will be larger.

Two independent APKs avoid shipping multiple CPUs' native libraries together:

- **arm64-v8a**: most current Android phones.
- **armeabi-v7a**: older 32-bit ARM phones.

Both require Android 7.0+ (API 24). These APKs exclude x86 emulator/phone binaries.
For emulator development, override `reactNativeArchitectures` explicitly.
The default EAS `preview` profile includes both ARM architectures for convenience;
`preview-arm64` and `preview-arm32` produce the smaller single-architecture APKs.
The `production` profile still builds an AAB for Play's per-device delivery.

The workflow verifies the embedded bundle, expected ABI, non-debuggable manifest,
and APK signature. A **60 MB per-APK ceiling** prevents accidental size regressions;
this is a guardrail, not a measured size claim. Actual sizes and reduction against
the original APK are reported in workflow summaries and prerelease notes.

### Signing and testing

GitHub Actions uses the generated Expo project's **public test signing key** for
these release-variant testing APKs. They are not production-signed builds. Use EAS
with managed private signing credentials for production distribution. A smaller
release APK does not establish compatibility on every phone: verify cold launch
without Metro, airplane-mode OCR and storage, imports, and editing on a real phone.
An update may fail if the old APK has a different signing certificate. Preserve
your timetable before uninstalling anything; uninstalling deletes local data.

### Build locally

With Node 22, JDK 17, and an Android SDK installed:

```bash
npm ci
npm run typecheck
CI=1 npx expo prebuild --platform android --no-install
cd android
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
cd ..
python3 scripts/check-apk.py android/app/build/outputs/apk/release/app-release.apk --abi arm64-v8a
```

Use `armeabi-v7a` for a 32-bit phone. Never use `assembleDebug` for a standalone
download: it normally expects a running Metro development server.

### Verified build size (v1.0.1-small-8)

[Download the optimized testing APKs](https://github.com/Valcaversa7/allinone/releases/tag/v1.0.1-small-8).
[Successful build and automated checks](https://github.com/Valcaversa7/allinone/actions/runs/34774548217).

| APK | Download bytes | Decimal MB | Reduction from original |
| --- | ---: | ---: | ---: |
| Original debug APK | 184,748,470 | 184.75 | — |
| ARM64 release variant | 17,429,700 | 17.43 | 90.6% |
| ARM32 release variant | 15,865,040 | 15.87 | 91.4% |

These are actual published asset sizes, not estimates. The signing and physical-device
testing caveats above still apply.
