# AirHand — AI Hand Gesture Controller

AirHand is a mobile-friendly browser app that turns webcam hand movements into a virtual cursor and an endless-runner game.

## Features

- **MediaPipe Gesture Recognizer** runs locally in the browser for standard hand poses, with stricter confidence gating for actions such as mode switching and pausing.
- **Custom pinch detection** measures thumb-to-index distance relative to palm size and uses hysteresis to reduce flickering.
- **Personal cursor calibration:** collect a five-second sweep of your index fingertip's comfortable motion range, then save the calibrated bounds on this device. Calibration fails clearly if the hand is missing or the movement range is too small.
- **Adaptive cursor smoothing** reduces small shakes while responding faster to larger movements.
- **Full-frame camera preview** adjusts to the camera's actual aspect ratio and uses `object-fit: contain` to avoid clipping fingertips.
- **Live framing guidance** tells you when your hand is near the frame edge or too close/small.
- **Hand Runner arcade mode:** increasingly difficult obstacles, floating collectible stars, combo multipliers, bonus points, personal best, three pace settings and optional sound effects.
- **Mobile friendly inputs:** gesture control, tap/click and keyboard fallbacks, plus camera stop, mirror preview, landmarks and cursor response settings.
- Camera frames and gesture inference stay in the browser; there is no video upload or app backend.

## Run it

1. Open the repository with GitHub Pages enabled, or run a local static server in the repository directory.
2. For example, run `python -m http.server 8000` and open `http://localhost:8000`.
3. Press **Enable camera** and grant camera permission.

Camera access requires HTTPS or localhost. MediaPipe's JavaScript/WASM runtime and models are loaded from public CDNs, so internet access is required for the first launch. AirHand is not yet an offline-first PWA.

## Gesture controls

| Gesture | Action |
| --- | --- |
| Pointing up | Move the virtual cursor |
| Thumb + index pinch | Select a virtual desktop tile / jump |
| Peace sign (Victory) | Switch between cursor and runner |
| Open palm | Start or resume the runner |
| Thumbs-up | Pause the runner |
| Tap/click the game | Jump |
| Space key | Jump |
| P key | Pause/resume |
| 1 / 2 keys | Switch modes |

## Test and quality checks

Run `npm run check` and `npm test`. GitHub Actions runs the checks for each push and pull request. The current unit suite covers gesture math, model confidence mapping, cursor filtering, UI wiring, duplicate element IDs, camera framing and calibration paths.

## Honest limitations

- The virtual cursor only controls elements inside AirHand; a normal browser page cannot move the operating-system cursor or click arbitrary desktop apps.
- Calibration personalizes the mapping range, but it cannot compensate for every camera angle, lighting condition or hand occlusion.
- Automated browser smoke tests use a simulated camera. Physical webcam accuracy and comfort still need to be validated on real hardware.


## Precision engine (Phase 1)

- Cursor filtering adapts to movement speed and elapsed frame time: small motion is damped while fast sweeps catch up more quickly.
- Pinch uses separate press/release thresholds (0.28 / 0.43 palm-normalized distance) to reduce boundary flicker.
- The live status reports whether a gesture is stabilizing or stable, with classifier confidence when available and a separate heuristic indicator for geometry-based pinch.
- A brief 180 ms tracking-loss grace period preserves cursor/gesture state across transient inference misses; sustained loss releases the state.
- Automated regression tests cover smoothing response, pinch hysteresis, stability status, and the tracking grace policy.

**Physical validation still required:** real cameras and hands across bright/dim lighting, different distances and hand sizes, mirrored/non-mirrored preview, fast motion, temporary occlusion, and repeated pinch press/release. Automated tests do not establish real-world accuracy, and this release is not claimed to work offline.
