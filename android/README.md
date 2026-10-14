# AirHand Mobile (Android)

This directory is the native Android app track. The existing browser app remains unchanged.

## Implemented foundation

- Native Kotlin app module, Gradle configuration, and dark dashboard.
- CameraX front-camera preview, started only by an explicit user tap after camera permission is granted.
- Camera lifecycle cleanup: the preview is unbound when the Activity pauses or is destroyed; an in-app stop button is also provided.
- Voice-recognition intent with visible transcript feedback. Recognized text is not automatically sent to a messaging app.
- Explicit links to Android Accessibility and overlay settings.
- Accessibility service with a narrow, guarded set of possible navigation actions (Back, Home, notifications, and vertical swipes).
- Central safety gate requires control to be enabled, confidence >= 0.80, and a fresh detection timestamp (<= 250 ms).
- Emergency stop disables the gesture-dispatch gate and stops the preview.

## Important capability boundary

This is **not yet a working hands-free gesture controller**. The live camera is only a preview; it is not yet analyzed by an on-device hand-landmark model. The app does not yet map hand movement into a floating cursor, taps, scrolls, or text input. The current voice path uses Android's speech-recognition intent and displays recognized text; it does not inject it into other apps.

Do not enable the Accessibility service expecting gestures to work yet. The next implementation milestone is a model-backed CameraX image analyzer and a tested adapter for the existing browser gesture-engine.js geometry/stabilization primitives.

## Build and artifact

The GitHub Actions workflow at .github/workflows/android-apk.yml builds a **debug APK** on Android project changes and uploads it as the AirHand-Mobile-debug-APK artifact.

1. Open the repository's Actions tab.
2. Select **Build AirHand Mobile APK** and open the newest run.
3. Wait for a successful run, then download AirHand-Mobile-debug-APK.
4. Extract the ZIP and install app-debug.apk after reviewing Android's installation warning.

Adding the workflow does not itself prove that a build completed. An APK is considered available only after GitHub Actions succeeds and publishes the artifact. Debug APKs are for testing, not Play Store distribution. A signed release APK still requires a deliberate signing/release setup.

## Permission and privacy model

- Camera permission is requested at runtime only after a user action. The preview is stopped when the app leaves the foreground.
- The current manifest does not request microphone permission; voice entry delegates to Android's speech-recognition app/intent, which may have its own permission and network behavior.
- Accessibility and overlay capabilities require the user to navigate to the corresponding Android Settings pages.
- No camera frames are uploaded by the preview screen. This should be re-evaluated explicitly if a future inference provider or service requires network access.
- Secure windows, permission dialogs, banking/payment surfaces, and restricted apps may prevent automation.
- Keep a manual stop route. Do not automate emergency calls, payments, passwords, or other safety-critical actions.

## Next milestones

1. On-device hand landmark inference over CameraX frames, with tracking-loss handling and explicit frame cleanup.
2. Gesture confidence/stability mapping that reuses and tests the existing AirHand gesture logic.
3. A floating cursor with safe pinch-to-click and bounded navigation/scroll actions.
4. Dedicated AirHand gesture keyboard (InputMethodService) plus opt-in voice insertion.
5. Device tests for latency, false clicks, battery/thermal use, interruptions, and accessible stop controls; then signed release build.
