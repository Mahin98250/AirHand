# AirHand — AI Hand Gesture Controller

AirHand is a browser-based hand tracking and gesture control demo. Use your webcam to move an in-page virtual cursor or play an endless runner.

## Features

- **MediaPipe Gesture Recognizer:** trained, on-device gesture classification for pointing, peace/victory, thumbs-up, open palm and fist.
- **Custom pinch detection:** uses thumb-to-index distance normalized by palm size, with separate pinch/release thresholds (hysteresis).
- **Temporal stability filter:** discrete gestures must remain consistent briefly before they activate, reducing accidental mode changes and jumps.
- **Adaptive cursor smoothing:** a small dead zone suppresses tracking jitter while larger movements get a faster response.
- **Runner game:** randomized obstacles, jump physics, collision detection, live score and locally saved best score.
- **Controls:** stop camera, switch mirrored preview, toggle landmarks, adjust cursor response, and manually tap the game to jump.
- Webcam frames are processed in the browser. There is no video upload or app backend.

## Run it

1. Open the repository with GitHub Pages enabled, or run a local static server from the repository directory.
2. For example, run `python -m http.server 8000` and open `http://localhost:8000`.
3. Press **Enable camera** and grant camera permission.

Camera access requires HTTPS or localhost. MediaPipe's JavaScript/WASM runtime and gesture model are loaded from public CDNs on first use, so the first launch needs an internet connection. The application has no server-side video processing, but the current release is not yet an offline-first PWA.

## Gesture controls

| Gesture | Action |
| --- | --- |
| Pointing up | Move the virtual in-page cursor |
| Thumb + index pinch | Select a virtual desktop tile / jump |
| Peace sign (Victory) | Switch between cursor and runner |
| Open palm | Start or resume the runner |
| Thumbs-up | Pause the runner |
| Tap/click the game canvas | Jump as a manual fallback |

## Test and quality checks

Run the automated tests with `npm test` and JavaScript syntax checks with `npm run check`. GitHub Actions runs these checks on pushes and pull requests.

## Honest limitations

- The cursor is confined to the AirHand webpage. Ordinary browser pages cannot move the operating-system cursor or click arbitrary desktop applications without a separately installed native companion.
- The built-in model recognizes a small set of standard gestures. Pinch is detected geometrically; accuracy depends on lighting, hand angle, distance, camera quality and device performance.
- The automated tests validate gesture math, filters and app wiring. A physical webcam test is still required to measure real-world recognition accuracy and responsiveness.
