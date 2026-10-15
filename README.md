# AirHand — Hand Gesture Controller

AirHand is a mobile-friendly browser app that turns webcam hand movements into a virtual cursor and an endless-runner game.

## Features

- **MediaPipe Gesture Recognizer** runs locally in the browser for standard hand poses, with stricter confidence gating for actions such as mode switching and pausing.
- **Custom pinch detection** measures thumb-to-index distance relative to palm size and uses hysteresis to reduce flickering.
- **Personal cursor calibration:** collect a five-second sweep of your index fingertip's comfortable motion range, then save the calibrated bounds on this device. Calibration fails clearly if the hand is missing or the movement range is too small.
- **Adaptive cursor smoothing** reduces small shakes while responding faster to larger movements.
- **Full-frame camera preview** adjusts to the camera's actual aspect ratio and uses `object-fit: contain` to avoid clipping fingertips.
- **Live framing guidance** tells you when your hand is near the frame edge or too close/small.
- **Hand Runner arcade mode:** increasingly difficult obstacles, floating collectible stars, combo multipliers, bonus points, personal best, three pace settings and optional sound effects.
- **Air Drive:** perspective road rendering with four selectable environments, custom car paint, two-hand steering, touch and keyboard controls, cruise/manual throttle, nitro boost, optional generated engine audio, near-miss rewards, three-hit vehicle damage, and a saved personal-best score.
- **Air Drive 3D:** Three.js rendering with a Rapier rigid-body physics world, raycast wheel suspension, spring/damper forces, tyre grip, steering torque, road barriers, traffic collisions, camera follow, and gesture-controlled acceleration, braking and nitro.
- **Mobile friendly inputs:** gesture control, tap/click and keyboard fallbacks, plus camera stop, mirror preview, landmarks and cursor response settings.
- Camera frames and gesture inference stay in the browser; there is no video upload or app backend.

## Live Demo

**Try AirHand:** https://mahin98250.github.io/AirHand/

Source code: https://github.com/Mahin98250/AirHand

## Air Drive controls

- **Steering:** rotate your two hands after calibration, or use A/D, the left/right arrows, or the on-screen steering buttons.
- **Acceleration:** cruise control starts enabled. Turn it off to use W / Up Arrow or hold **GAS** on the screen.
- **Brake and nitro:** hold Space or the on-screen **BRAKE** button to slow down; hold Shift or **NITRO** for a short boost.
- **Scenery and vehicle:** choose a sunset, coastal, night, or rain-soaked route and select a paint colour before or during a session.
- **Driving feedback:** pass close to traffic for near-miss bonuses and nitro recharge. Three impacts end the session; resetting starts a fresh run.
- **Pause and sound:** use P or the pause control, and enable the optional synthesised engine sound from the cockpit controls.

Air Drive includes two driving modes: a lightweight Canvas arcade mode and a 3D mode backed by Three.js and the Rapier physics engine. The 3D mode simulates a rigid-body chassis, raycast suspension, spring/damper forces, tyre grip, steering torque, road barriers and physical traffic collisions. It is a browser-based game prototype, not a licensed vehicle simulator.

### 3D gesture controls

- **Steering:** rotate both visible hands together as if turning a steering wheel. Calibrate your neutral hand position first.
- **Accelerate:** make a fist with the hand on the right side of the camera.
- **Brake:** open that hand into a flat palm.
- **Nitro:** show a thumbs-up with that hand.
- **Safety:** if the camera loses either hand, gesture pedals release. Touch and keyboard controls remain available as fallbacks.
- **Dependencies:** the 3D engine loads Three.js and Rapier from jsDelivr on first use. The service worker caches same-origin game code and supported CDN responses after they have been fetched successfully, but a first-time 3D load requires internet access.

## Run it

1. Open the repository with GitHub Pages enabled, or run a local static server in the repository directory.
2. For example, run `python -m http.server 8000` and open `http://localhost:8000`.
3. Press **Enable camera** and grant camera permission.

Camera access requires HTTPS or localhost. MediaPipe's JavaScript/WASM runtime and hand models are loaded from public CDNs, so internet access is required to start gesture recognition. The installable PWA caches the app shell so the interface can reopen offline after one successful online visit; **camera-based gesture recognition is not fully offline** because its runtime and model files are not precached.

## Install AirHand

- **Android / desktop Chromium:** open the GitHub Pages site over HTTPS and choose **Install app** when the button appears. You can also use the browser menu's install option.
- **iPhone / iPad:** open the site in Safari, tap **Share**, then **Add to Home Screen**.
- The service worker caches the HTML, local JavaScript, manifest and icon. It does not cache camera frames or third-party model files.
- The PWA is the browser-based gesture playground and can control only its own page. For tapping, scrolling feeds, Home/Back and app switching across Android apps, use the native **AirHand Mobile APK** and explicitly enable its Accessibility service and other required permissions. A PWA cannot inject system-wide touches.
- On desktop or other mobile platforms, system-wide control would require a separate platform-specific companion app or OS accessibility integration; browser-only mode stays inside the page.

## Gesture controls

These browser gestures operate only inside the AirHand page. They do not control other apps or the operating system.

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


## Phase 2 — Precision interaction

- **Pinch-and-hold drag:** pinch over a workspace tile, move while holding the pinch, and release over another tile to reorder it. Releasing outside a tile cancels the drop.
- **Optional dwell click:** enable the checkbox in Air Cursor settings, then hold the cursor over a tile for 850 ms to select it. Dwell is off by default and pauses while pinching or calibrating.
- **Guided cursor calibration:** a blue target steps through the workspace's four corners during the existing five-second range-capture flow. Follow it with the cursor and move across a comfortable range; insufficient movement is rejected.
- Cursor response remains adjustable. Runner controls remain separate from cursor drag/dwell behavior.

**Still requires physical validation:** camera-based target following, drag start/release reliability, dwell timing with natural hand jitter, and calibration behavior across lighting, camera angles, and different hand sizes. Automated tests and simulated browser checks do not establish real-world accuracy. AirHand is not claimed to work fully offline.


## Phase 3 — Safe interaction controls

- **Interaction lock:** the cursor can keep moving while pinch, drag and dwell selections are disabled. Unlock explicitly to re-enable them.
- **Adjustable dwell click:** choose 500–1500 ms in 50 ms increments; default is 850 ms. Changing the delay resets the current dwell timer.
- **Drag feedback and cleanup:** the potential drop target is highlighted; completion and cancellation are reported. Mode changes and camera stop cancel an active drag so a stale drag cannot persist.

**Physical checks still required:** test the lock with real gestures, dwell timing under natural jitter, and drag/drop across different lighting, hand sizes and camera positions. Browser tests validate software behavior only; no claim of physical accuracy or fully offline operation is made.


## Phase 4 — Preferences and recovery

- Cursor sensitivity, mirror preview, landmark visibility, dwell enablement/duration, sound, and runner difficulty are saved locally with validated ranges and safe defaults.
- The interaction lock is intentionally **not** persisted, so a previous locked state cannot surprise the user on a new visit.
- **Reset settings** clears saved preferences and cursor calibration and restores defaults.
- Storage errors are handled gracefully; settings remain usable when browser storage is unavailable.

**Still required:** manually verify persistence and reset behavior in the target browser and validate all hand-controlled interactions with a physical camera. Browser automation does not prove real-world gesture accuracy.


## Phase 5 — Reliability and accessibility

- Camera startup failures now explain common permission-denied, missing-device, busy-camera, unsupported-constraint, and interrupted-start cases with recovery guidance.
- If the active camera track ends unexpectedly, AirHand stops stale tracking state and tells the user how to reconnect and restart.
- Camera status and recovery messages use polite live regions; the camera preview and game canvas have accessible descriptions, and interactive controls have visible keyboard focus.
- Automated regression coverage checks camera recovery wiring and the new accessibility hooks.

**Still requires physical validation:** revoke camera permission and retry on Android/desktop, unplug or switch cameras where supported, background and restore the mobile browser, and test keyboard navigation with a screen reader. Automated tests do not establish device-specific camera behavior or full accessibility conformance.


## Phase 6 — Tracking interruption safety

- A brief inference error is tolerated; if inference stays broken for 180 ms, AirHand clears stale gesture state and reports that tracking is retrying.
- Hand loss or sustained inference errors cancel an active drag instead of treating the last cursor position as a deliberate pinch release. This avoids accidental drops/selections from stale coordinates.
- Regression tests verify the grace policy and that tracking-loss handling cannot commit a drag through the normal release handler.

**Still requires physical validation:** deliberately occlude the hand during a pinch/drag, move quickly in and out of frame, and test camera/model recovery on Android and desktop browsers. Automated tests validate the state-handling path, not physical tracking accuracy.


## Phase 7 — Air Drive (first playable build)

- Adds a third **Air Drive** mode with a perspective road, projected lane markings and roadside posts, a player car, oncoming traffic, speed/score HUD, collisions and restart. This is a lightweight pseudo-3D canvas scene, not a full WebGL/physics simulation.
- MediaPipe is configured to track up to two hands. The air-steering controller uses the angle between the wrists relative to a neutral calibration pose, with a dead zone, bounded steering, smoothing, hand-span validation and confidence feedback.
- Keyboard backup steering (Left/Right or A/D) allows the game loop to be exercised without a webcam. The camera and hand models are still loaded only when the user enables the camera.
- Automated tests cover steering calibration, rotation response, close-hand rejection and missing-hand behavior.

**Important validation limit:** the steering math and game loop have automated coverage, but camera-driven steering accuracy, left/right direction on mirrored camera previews, and real-device performance still need physical testing. This is a first playable prototype; no real-world accuracy claim is made.
