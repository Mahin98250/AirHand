import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const referencedIds = new Set([...app.matchAll(/\$\("([^"]+)"\)/g)].map(match => match[1]));

test("every statically referenced UI ID exists in index.html", () => {
  const missing = [...referencedIds].filter(id => !htmlIds.has(id));
  assert.deepEqual(missing, [], "Missing HTML IDs: " + missing.join(", "));
});

test("the browser loads one deferred classic script and bundles local helpers", () => {
  assert.ok(html.includes('<script defer src="./app.js?v=airhand-20261014-6"></script>'));
  assert.ok(app.includes("function detectGesture("));
  assert.ok(app.includes("function reportAirHandRuntimeError("));
  assert.ok(app.includes("window.__AIRHAND_READY__ = true"));
});

test("camera preview follows the source aspect ratio to prevent cropped fingers", () => {
  assert.ok(app.includes("function fitCameraFrameToVideo()"));
  assert.ok(app.includes("function getHandFrameGuidance(landmarks)"));
  assert.ok(app.includes("function startCursorCalibration()"));
  assert.ok(app.includes("function collectCalibrationSample(indexTip, now)"));
  assert.ok(app.includes("localStorage.setItem(\"airhand-cursor-calibration\""));
  assert.ok(app.includes("function cycleDifficulty()"));
  assert.ok(app.includes("const reliableDiscreteGesture = geometryOnlyFallback || source === \"model\";"));
  assert.ok(app.includes("function setSoundEnabled(enabled)"));
  assert.ok(app.includes("game.stars.push"));
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
