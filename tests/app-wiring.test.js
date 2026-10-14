import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const referencedIds = new Set([...app.matchAll(/\$\("([^"]+)"\)/g)].map(match => match[1]));
const allHtmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);

test("HTML uses unique IDs so every click handler targets exactly one control", () => {
  assert.equal(allHtmlIds.length, new Set(allHtmlIds).size, "Duplicate HTML IDs make controls ambiguous");
});

test("every statically referenced UI ID exists in index.html", () => {
  const missing = [...referencedIds].filter(id => !htmlIds.has(id));
  assert.deepEqual(missing, [], "Missing HTML IDs: " + missing.join(", "));
});

test("the browser loads one deferred classic script and bundles local helpers", () => {
  assert.ok(html.includes('<script defer src="./app.js?v=airhand-20261014-18"></script>'));
  assert.ok(app.includes("function detectGesture("));
  assert.ok(app.includes("function reportAirHandRuntimeError("));
  assert.ok(app.includes("window.__AIRHAND_READY__ = true"));
});

test("camera preview follows the source aspect ratio to prevent cropped fingers", () => {
  assert.ok(app.includes("function fitCameraFrameToVideo()"));
  assert.ok(app.includes("function getHandFrameGuidance(landmarks)"));
  assert.ok(app.includes("function startCursorCalibration()"));
  assert.ok(app.includes("function collectCalibrationSample(indexTip, now)"));
  assert.ok(app.includes("Calibration waiting for hand"));
  assert.ok(app.includes("Calibration stopped because no hand was detected."));
  assert.ok(app.includes("function showCalibrationFeedback(message"));
  assert.ok(app.includes("calibrationFeedbackUntil"));
  assert.ok(app.includes("localStorage.setItem(\"airhand-cursor-calibration\""));
  assert.ok(app.includes("function cycleDifficulty()"));
  assert.ok(app.includes('document.querySelector(".gamebox").addEventListener("pointerdown"'));
  assert.ok(app.includes('else if (currentMode === "game" && !game.playing) startGame();'));
  assert.ok(app.includes("const reliableDiscreteGesture = geometryOnlyFallback || source === \"model\";"));
  assert.ok(app.includes("function setSoundEnabled(enabled)"));
  assert.ok(app.includes("game.stars.push"));
  assert.ok(app.includes('game.combo > 0 ? "x" + game.combo : "—"'));
  assert.ok(app.includes("Hand near frame edge"));
  assert.ok(app.includes("Hand too close"));
  assert.ok(app.includes('cameraStage.style.aspectRatio = video.videoWidth + " / " + video.videoHeight'));
  assert.ok(html.includes("object-fit:contain"));
  assert.ok(html.includes(".stage.portrait-feed{max-width:420px;margin-inline:auto;max-height:none}"));
});

test("the page does not statically import the external AI CDN", () => {
  assert.equal(app.includes('import { FilesetResolver'), false);
  assert.ok(app.includes('await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/vision_bundle.mjs")'));
  assert.ok(app.includes("Camera access requires HTTPS or localhost"));
});

test("the primary controls have click handlers", () => {
  for (const id of ["start", "start2", "stopCamera", "calibrate", "soundToggle", "difficultyToggle", "action", "play"]) {
    assert.ok(app.includes('$("'+id+'").addEventListener'), "Missing click listener for " + id);
  }
  assert.ok(app.includes('querySelectorAll(".tab")'), "Mode tabs should be interactive");
});

test("the app uses the Gesture Recognizer and local pinch fallback", () => {
  assert.ok(app.includes("GestureRecognizer.createFromOptions"));
  assert.ok(app.includes("recognizeForVideo"));
  assert.ok(app.includes("detectGesture(landmarks, stablePinch"));
  assert.ok(app.includes("requestAnimationFrame(trackFrame)"));
  assert.ok(app.includes("requestAnimationFrame(gameFrame)"));
});


test("Phase 2 exposes optional dwell-click and drag-and-drop interaction", () => {
  assert.ok(html.includes('id="dwellToggle"'));
  assert.ok(html.includes('id="dwellProgress"'));
  assert.ok(html.includes('id="calibrationTarget"'));
  assert.ok(app.includes("function updateDwellTarget(target"));
  assert.ok(app.includes("function beginVirtualDrag()"));
  assert.ok(app.includes("function finishVirtualDrag()"));
  assert.ok(app.includes('$("dwellToggle").addEventListener("change"'));
  assert.ok(app.includes("release pinch over another tile to drop"));
});

test("guided calibration cycles through four workspace corners", () => {
  assert.ok(app.includes("function setCalibrationTarget(step)"));
  for (const corner of ['"TOP LEFT"','"TOP RIGHT"','"BOTTOM RIGHT"','"BOTTOM LEFT"']) assert.ok(app.includes(corner));
  assert.ok(app.includes("Guided calibration · "));
});


test("guided calibration starts all extrema from sentinels so every corner can be measured", () => {
  assert.ok(app.includes("minX: 1, maxX: 0, minY: 1, maxY: 0, frames: 0, step: -1"));
});


test("Phase 3 has an interaction lock and adjustable dwell duration", () => {
  assert.ok(html.includes('id="interactionLock"'));
  assert.ok(html.includes('id="interactionLockStatus"'));
  assert.ok(html.includes('id="dwellDuration"'));
  assert.ok(app.includes("let interactionsLocked = false"));
  assert.ok(app.includes('$("interactionLock").addEventListener("click"'));
  assert.ok(app.includes('$("dwellDuration").addEventListener("input"'));
  assert.ok(app.includes("if (!dwellEnabled || interactionsLocked || stablePinch || calibrationRun || !target)"));
});

test("Phase 3 provides drag feedback and cleans up drag state on mode or camera changes", () => {
  assert.ok(app.includes('function cancelVirtualDrag(reason = "Drag cancelled")'));
  assert.ok(app.includes('cancelVirtualDrag("Camera stopped")'));
  assert.ok(app.includes('cancelVirtualDrag("Mode changed")'));
  assert.ok(app.includes('target.classList.add("drop-target")'));
  assert.ok(app.includes("Drop complete · "));
  assert.ok(app.includes("Drop cancelled · release over a tile"));
});


test("Phase 4 persists validated preferences without persisting the interaction lock", () => {
  assert.ok(html.includes('id="resetPreferences"'));
  assert.ok(app.includes('const PREFERENCES_KEY = "airhand-preferences-v1"'));
  assert.ok(app.includes("function readPreferences()"));
  assert.ok(app.includes("function savePreferences()"));
  assert.ok(app.includes("clamp(saved.cursorSensitivity, 0.12, 0.55)"));
  assert.ok(app.includes('localStorage.removeItem(PREFERENCES_KEY)'));
  assert.equal(app.includes("interactionsLocked, dwellDurationMs"), false);
});


test("Phase 5 explains common camera permission and device failures", () => {
  assert.ok(app.includes("function describeCameraError(error)"));
  for (const name of ["NotAllowedError", "NotFoundError", "NotReadableError", "OverconstrainedError", "AbortError"]) {
    assert.ok(app.includes(name), "Missing camera error mapping: " + name);
  }
  assert.ok(app.includes("function handleCameraTrackEnded()"));
  assert.ok(app.includes('track.addEventListener("ended", handleCameraTrackEnded'));
  assert.ok(app.includes("Camera connection lost"));
});

test("Phase 5 adds accessible live status, canvas descriptions, and visible keyboard focus", () => {
  assert.ok(html.includes('id="status" class="status" role="status" aria-live="polite"'));
  assert.ok(html.includes('id="readyTitle" role="status" aria-live="polite"'));
  assert.ok(html.includes('aria-label="Live camera preview for hand tracking"'));
  assert.ok(html.includes('aria-label="Hand Runner game. Use Space to jump and P to pause."'));
  assert.ok(html.includes('button:focus-visible,input:focus-visible,.tab:focus-visible'));
});
