# AirHand Mobile (Android)

This directory is the native Android application track for AirHand. The existing web app remains unchanged.

## Current foundation milestone

- Native Kotlin Android app module and Gradle configuration.
- Explicit runtime camera permission request.
- Explicit Android Settings entry points for Accessibility and overlay permissions.
- Voice recognition intent with visible transcript feedback; speech text is not sent automatically.
- Accessibility service with a narrow, guarded set of navigation actions (Back, Home, notifications, and vertical swipes).
- Central safety gate rejects actions unless control is enabled, confidence is at least 0.80, and the detection timestamp is no more than 250 ms old.
- A visible emergency-stop action disables gesture dispatch.

## Important: not yet a usable hands-free controller

This first foundation commit is **not** a completed hand-gesture system. It does not yet include live camera inference, a floating cursor, a gesture keyboard/IME, automatic gesture-to-command mapping, or a signed release APK. The dashboard deliberately says this clearly. Do not enable the accessibility service expecting gestures to work yet.

The web gesture-engine.js uses browser-compatible JavaScript and MediaPipe landmarks. The next integration step is to connect a supported on-device hand-landmark model to CameraX, then adapt the geometry/stabilization logic and test it against the same fixture cases. Avoid downloading executable/model assets without verifying their official source and license.

## Build

A GitHub Actions workflow builds a **debug APK** for Android changes and uploads it as an artifact:

1. Open the repository's Actions tab.
2. Select **Build AirHand Mobile APK** and open a successful run.
3. Download the **AirHand-Mobile-debug-APK** artifact.
4. Extract the ZIP to obtain app-debug.apk, then install it on your Android device after reviewing Android's installation warning.

The workflow has been added to the repository, but a build is not considered successful until an actual Actions run completes. Debug APKs are for testing and are not signed for Play Store distribution.

## Permission and safety model

- Camera permission is requested only after the user taps the camera button.
- Accessibility is enabled by the user in Android Settings; Android controls this permission.
- Overlay permission is requested through the system settings page, not silently granted.
- Voice recognition may use the device's selected speech-recognition provider and may require network access. The app does not automatically send the recognized text to a chat.
- Secure windows, permission dialogs, banking apps, and other restricted surfaces may not allow automation.
- Keep a physical/manual way to stop control. Never use gesture automation for emergency calls, payments, password entry, or other safety-critical actions.

## Roadmap

1. CameraX preview and lifecycle management.
2. On-device hand landmark inference and a tested adapter for the shared gesture primitives.
3. Floating cursor, pinch-to-click, and bounded scroll/back/home actions.
4. Dedicated AirHand gesture keyboard (Android Input Method Service) plus opt-in voice input.
5. Device-level tests, battery/thermal checks, accessibility review, and a properly signed release build.
