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

test("the app uses the Gesture Recognizer and local pinch fallback", () => {
  assert.match(app, /GestureRecognizer\.createFromOptions/);
  assert.match(app, /recognizeForVideo/);
  assert.match(app, /detectGesture\(landmarks, stablePinch/);
  assert.match(app, /requestAnimationFrame\(trackFrame\)/);
  assert.match(app, /requestAnimationFrame\(gameFrame\)/);
});
