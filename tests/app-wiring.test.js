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

test("the external AI runtime loads only after the page controls are wired", () => {
  assert.doesNotMatch(app, /^import .*https:\\/\\/cdn\\.jsdelivr\\.net/m);
  assert.match(app, /await import\\("https:\\/\\/cdn\\.jsdelivr\\.net\\/@mediapipe\\/tasks-vision/);
  assert.match(app, /Camera access requires HTTPS or localhost/);
});

test("the primary user controls have click handlers", () => {
  for (const id of ["start", "start2", "stopCamera", "action", "play"]) {
    assert.match(app, new RegExp('\\$\\("' + id + '"\\)\\.addEventListener'));
  }
  assert.match(app, /querySelectorAll\\("\\.tab"\\)/);
});

test("the app uses the Gesture Recognizer and local pinch fallback", () => {
  assert.match(app, /GestureRecognizer\.createFromOptions/);
  assert.match(app, /recognizeForVideo/);
  assert.match(app, /detectGesture\(landmarks, stablePinch/);
  assert.match(app, /requestAnimationFrame\(trackFrame\)/);
  assert.match(app, /requestAnimationFrame\(gameFrame\)/);
});
