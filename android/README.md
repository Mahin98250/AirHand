# AirHand Mobile (Android)

This directory is the native Android app track. The existing browser app remains unchanged.

## Implemented foundation

- Native Kotlin Android app, Gradle configuration, and a dark dashboard.
- CameraX front-camera preview, started only after an explicit user action and camera permission.
- On-device MediaPipe Hand Landmarker live-stream inference over CameraX RGBA frames.
- The hand model is downloaded from the pinned official MediaPipe model URL during the build, checked against a SHA-256 digest and expected byte count, and packaged into the APK. It is not downloaded by the app at runtime.
- Frames are copied out of CameraX buffers before analysis, and the analyzer allows one inference frame in flight to bound memory pressure.
- Port of AirHand's basic normalized 21-landmark geometry thresholds and 115 ms gesture stabilization to Kotlin.
- Explicitly started foreground camera service for system-wide mode, persistent notification with Stop action, and a floating cursor overlay.
- Pinch-to-click is edge-triggered and uses a stricter confidence threshold than navigation; hand loss clears the gesture state.
- Open-palm vertical hand movement scrolls, with a movement threshold and cooldown. A peace sign held for 900 ms triggers Back once, with a cooldown before another Back action.
- Central safety gates reject stale or low-confidence actions; system-wide control requires the user to enable Accessibility and overlay permissions and explicitly confirm Start.
- Dedicated Android keyboard (InputMethodService) with letters, numbers/symbols, space, backspace, enter, and voice typing into the currently focused editor. Speech recognition is opt-in and its transcript is committed only to the focused text field.
- The on-device model is pinned and checksum-verified at build time; camera frames are processed locally.

## Important capability boundary

This remains an **early prototype, not a validated production controller**. The code now includes a cursor, pinch click, open-palm scroll, long-hold Back, and a selectable keyboard with voice typing, but device-specific coordinate alignment, accidental-action rate, keyboard compatibility, camera lifecycle, and battery/thermal behavior still require physical testing. Some secure or restricted surfaces cannot be automated. No claim of reliable universal control is made.

## Build the debug APK

The GitHub Actions workflow at .github/workflows/android-apk.yml:

1. Downloads the pinned model via android/download-hand-model.sh.
2. Verifies the model SHA-256 digest and exact byte count.
3. Builds the Android debug APK.
4. Checks that the generated APK contains the verified model asset.
5. Uploads the APK as the AirHand-Mobile-debug-APK artifact.

Open the repository's Actions tab, select **Build AirHand Mobile APK**, open the newest completed successful run, and download its artifact. Extract the ZIP to obtain app-debug.apk. Only a successful run with the APK artifact counts as a build. Debug APKs are for testing, not Play Store distribution; a signed release APK needs separate signing and release setup.

To prepare the model asset for a local Android Studio build, run:

    bash android/download-hand-model.sh

This downloads a roughly 7.8 MB model and verifies its checksum. The generated file is ignored by Git so binaries are not accidentally committed.

## Permission and privacy model

- Camera permission is requested at runtime after a user action. Camera inference stops when the app leaves the foreground.
- Current manifest does not request microphone permission; voice input delegates to Android's speech-recognition intent, which may use the device's selected recognition provider and network.
- The hand-landmark model runs locally. Camera frames are processed on-device and are not uploaded by AirHand.
- MediaPipe may collect SDK usage/performance metrics according to its privacy notice; see https://goo.gle/mediapipe-privacy.
- Accessibility and overlay capabilities require user action in Android Settings. Secure windows, permission dialogs, banking/payment surfaces, and restricted apps may block automation.
- Keep a manual stop path. Do not automate emergency calls, payments, passwords, or other safety-critical actions.

## Next milestones

1. Physical-device calibration for cursor coordinates, mirror/rotation, screen insets, and different camera placements.
2. Add gesture guide/feedback and refine the open-palm scroll threshold after real-device trials.
3. Test the keyboard and voice typing in messaging apps, with confirmation before any message is sent.
4. Add automated native tests for command gating, tracking loss, cooldowns, and gesture-to-action mapping.
5. Measure latency, false clicks, battery/thermal load, interruption recovery, and stop behavior before preparing a signed release APK.
