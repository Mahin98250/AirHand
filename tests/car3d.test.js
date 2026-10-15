import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const engine = readFileSync(new URL("../car3d-engine.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("3D engine uses Three.js and Rapier rigid-body physics", () => {
  assert.match(engine, /three@0\.180\.0\/build\/three\.module\.js/);
  assert.match(engine, /@dimforge\/rapier3d-compat@0\.17\.3/);
  assert.match(engine, /new RAPIER\.World/);
  assert.match(engine, /world\.step\(\)/);
  assert.match(engine, /world\.castRayAndGetNormal/);
  assert.match(engine, /addForceAtPoint/);
  assert.match(engine, /applyTorqueImpulse/);
  assert.match(engine, /ColliderDesc\.cuboid/);
});

test("Air Drive has a selectable 3D canvas and accessible mode status", () => {
  assert.match(html, /id="drive3dCanvas"/);
  assert.match(html, /id="drive3dToggle"/);
  assert.match(html, /id="drive3dStatus"/);
  assert.match(app, /import\("\.\/car3d-engine\.js"\)/);
  assert.match(app, /createCarGame3D/);
});

test("hand gestures control throttle, brake, nitro and steering", () => {
  assert.match(app, /driveGestureThrottle = pedalPose === "Fist"/);
  assert.match(app, /driveGestureBrake = pedalPose === "OpenPalm"/);
  assert.match(app, /driveGestureBoost = pedalPose === "ThumbsUp"/);
  assert.match(app, /driveSteering\.update\(hands\[0\], hands\[1\], now\)/);
  assert.match(app, /updateDriveGestureControls\(null, null\)/);
  assert.match(app, /drive3dInstance\.setControls/);
});

test("3D physics is paused or reset with the existing Air Drive lifecycle", () => {
  assert.match(app, /drive3dInstance\.pause\(\)/);
  assert.match(app, /drive3dInstance\.resume\(\)/);
  assert.match(app, /drive3dInstance\.reset\(\)/);
  assert.match(app, /drive3dInstance\.dispose\(\)/);
});

test("PWA caches the same-origin 3D module and can cache jsDelivr game dependencies", () => {
  assert.match(worker, /airhand-shell-v6/);
  assert.match(worker, /"\.\/car3d-engine\.js"/);
  assert.match(worker, /https:\/\/cdn\.jsdelivr\.net/);
  assert.match(worker, /is3DDependency && response\.type === "cors"/);
  assert.match(readme, /### 3D gesture controls/);
});
