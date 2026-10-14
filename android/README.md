# AirHand Mobile (Android)

This directory is the native Android app track. The existing browser app remains unchanged.

## Implemented foundation

- Native Kotlin Android app, Gradle configuration, and a dark dashboard.
- CameraX front-camera preview, started only after an explicit user action and camera permission.
- On-device MediaPipe Hand Landmarker live-stream inference over CameraX RGBA frames.
- The hand model is downloaded from the pinned official MediaPipe model URL during the build, checked against a SHA-256 digest and expected byte count, and packaged into the APK. It is not downloaded by the app at runtime.
- Frames are copied out of CameraX buffers before analysis, and the analyzer allows one inference frame in flight to bound memory pressure.
- Port of AirHand's basic normalized 21-landmark geometry thresholds and 115 ms gesture stabilization to Kotlin. It currently displays gesture labels; it does not perform system actions.
- Camera/inference cleanup when the Activity pauses or is destroyed; explicit stop button; emergency stop disables the gesture-dispatch gate.
- Voice recognition intent displays a transcript for review; recognized text is not automatically sent to a messaging app.
- Explicit Android Settings links for Accessibility and overlay permission.
- Accessibility service has a narrow navigation-action foundation (Back, Home, notifications, vertical swipes) guarded by a disabled-by-default safety gate.

## Important capability boundary

This is **not yet a complete hands-free controller**. Current milestone is live hand landmark detection and geometric gesture display only. It does not yet map the moving hand to a floating cursor or inject gestures into arbitrary app controls. The Accessibility gate remains disabled, and no cross-app action is automatically triggered from a detected pose. A dedicated gesture keyboard/IME and actual voice text insertion into target fields are also not implemented yet.

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

1. Visual hand skeleton overlay and cursor calibration on the preview, including mirror/rotation alignment.
2. Safe floating cursor with deliberate pinch-to-click, dwell and tracking-loss release.
3. Connect only specific, tested navigation commands to the disabled-by-default Accessibility service.
4. Dedicated AirHand gesture keyboard (InputMethodService) and opt-in voice typing into focused fields.
5. Device testing for latency, false clicks, battery/thermal load, interruption recovery, accessibility stop controls, and then a signed release APK.
