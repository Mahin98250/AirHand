# AirHand Mobile (Android)

This directory is the native Android track. The existing browser-based AirHand app remains unchanged.

## Current implemented foundation

- Native Kotlin Android app with a dark dashboard and an opt-in camera preview.
- On-device MediaPipe Hand Landmarker inference over CameraX RGBA frames. The model is fetched by the CI workflow from the official model URL, checked against a pinned SHA-256 digest and exact byte count, then packaged in the APK.
- Kotlin gesture geometry/stabilization adapted from the existing browser engine: Point, Pinch, Peace, OpenPalm, ThumbsUp, Fist and Unclear labels.
- Camera analysis copies padded RGBA planes safely, corrects frame rotation and front-camera mirroring, closes CameraX buffers promptly, and bounds inference to one in-flight frame.
- Foreground camera service for explicit system-wide mode; persistent notification with Pause/Resume and Stop actions; floating cursor overlay; adaptive screen-space cursor smoothing.
- Five-second on-device cursor-range calibration in the preview screen. It learns normalized fingertip bounds, rejects incomplete/narrow movement, adds a safety margin, and stores only numeric calibration settings locally. The system-wide service loads the saved mapping when it starts.
- Guarded tap and long-press integration through Android Accessibility. A brief, steady pinch taps on release; holding a steady pinch for 550 ms requests a long press. Cursor drift past 28 dp cancels the interaction, and tracking loss or Pause discards pending actions. Open-palm vertical movement requests scroll; a Peace sign held for 1 second requests Back, a thumbs-up held for 1.35 seconds requests Home, and a fist held for 1.5 seconds requests Recent apps. Hold actions fire once per pose; release and re-form before using them again. These mappings still need physical-device false-trigger testing.
- User-selectable Android input method named AirHand Gesture Keyboard, with QWERTY and symbols, shift, delete, space, enter, and opt-in voice entry that commits recognized speech into the currently focused text field.
- Explicit entry points for camera, microphone, notification, overlay, and Accessibility settings. Emergency stop disables action dispatch and stops camera tracking.
- No app backend is used for camera frames or landmark inference. The voice recognizer is the device-selected Android speech-recognition service; availability and whether it processes speech offline depend on that provider.

## Current capability boundary

This is an early prototype, not a polished or fully validated hands-free product. The APK can be built with these components, but cursor alignment, pinch tap precision, scroll behavior, camera background restrictions, device-specific performance, IME voice recognition, and app compatibility still need testing on actual phones. We have not established reliable use in every app, and Android secure screens or restricted apps can block automation.

The built-in Accessibility service does not inspect window text or search arbitrary UI content. It only exposes a narrow, explicit set of taps, scrolling and system navigation gestures. AirHand does not automatically send messages. Review chat text before sending, and do not use gesture automation for payments, passwords, emergency calls or other safety-critical actions.

## Build and download the debug APK

The GitHub Actions workflow at .github/workflows/android-apk.yml:

1. Downloads the pinned MediaPipe hand model using android/download-hand-model.sh.
2. Verifies the file's SHA-256 digest and byte count.
3. Runs JVM unit tests for cursor smoothing and gesture safety gates.
4. Compiles the Android debug APK.
5. Verifies the APK exists and contains the model asset.
6. Uploads the APK as the **AirHand-Mobile-debug-APK** artifact.

Open the **[AirHand Android build page](https://github.com/Mahin98250/AirHand/actions/runs/38615582949)** and sign in to GitHub if prompted. Confirm the run says **Success**, scroll to **Artifacts**, and tap **AirHand-Mobile-debug-APK** to download its ZIP. Open the ZIP in My Files or another file manager, extract it, then install **app-debug.apk**. The raw `api.github.com/.../zip` artifact address is not a public direct-download URL; opening it without an authenticated GitHub session can show `Requires authentication` (401). Use the Actions run page and its Artifacts section instead.

Workflow artifacts expire after 14 days. For the newest tested build, open the latest successful **Build AirHand Mobile APK** run from the [Actions page](https://github.com/Mahin98250/AirHand/actions/workflows/android-apk.yml), confirm it says **Success**, then download **AirHand-Mobile-debug-APK** under Artifacts. Do not use a raw `api.github.com/.../zip` link; GitHub may return HTTP 401 unless the request is authenticated.

For the step-by-step phone setup, permissions, gesture reference, safety notes and troubleshooting, see the **[AirHand Android User Guide](../android-guide.html)**. Debug APKs are for testing, not Play Store distribution; signed release builds require a dedicated signing/release setup.

For a local Android Studio build, run:

    bash android/download-hand-model.sh

The downloaded model is ignored by Git so a large binary is not accidentally committed.

## First-time setup on an Android phone

1. Install the debug APK from a successful Actions artifact.
2. Open AirHand and grant camera permission when asked.
3. To use speech in the keyboard, grant microphone permission from the AirHand dashboard.
4. In AirHand, open Android Input Method settings and enable **AirHand Gesture Keyboard**. Then use **Choose active keyboard** to select it.
5. In Android Settings, enable **AirHand Gesture Actions** under Accessibility.
6. Grant AirHand the **Display over other apps** permission.
7. Grant notification permission on Android 13+ when asked. System-wide mode blocks startup if the Stop notification cannot be shown.
8. In AirHand, start the camera preview and tap **Calibrate cursor range · 5 seconds**. Sweep your index fingertip through the widest comfortable range, moving both horizontally and vertically. Repeat if the range is rejected. Calibration settings stay on the device.
9. Return to AirHand and tap **Start system-wide gesture control**. Confirm the explanation. The camera is active while the foreground service is running; the saved mapping is loaded when this service starts.
10. Test cursor movement and gestures in a harmless app first. Use the notification's Pause action to temporarily disable gesture input, or Stop / AirHand's Emergency stop to end control.

## Permission and privacy model

- Camera permission is requested after a direct user action; system-wide mode is explicit and shows an ongoing notification.
- Microphone permission is requested for the IME's use of SpeechRecognizer. The provider may require network access. The app asks for offline preference where supported but cannot guarantee offline speech.
- Accessibility and overlay capabilities require the user to enable them in Android Settings.
- Camera frames and hand inference remain on-device. MediaPipe may separately collect SDK usage/performance metrics according to its privacy notice: https://goo.gle/mediapipe-privacy.
- The persistent notification has separate Pause and Stop actions. Pause disables gesture injection but leaves camera tracking running; Stop releases camera/overlay resources.
- Camera access while other apps are in front is subject to Android version, foreground-service, permission and device-vendor restrictions.
- Secure windows, permission dialogs, banking/payment surfaces and restricted apps may prevent clicks.

## Next milestones

1. Physically validate cursor calibration, tap-on-release and long-press accuracy, rotation/mirroring and comfort across phone models and orientations.
2. Add pinch-drag support with cancellation on tracking loss, app changes, Pause, and service stop.
3. Test gesture keyboard insertion across chats, search fields, browsers and editors; add language/layout options.
4. Run physical-device tests for latency, false clicks, missed gestures, battery/thermal load, interruption recovery, and accessible stop controls.
5. Build and sign a release APK only after those tests, with a user-controlled key and documented release process.
