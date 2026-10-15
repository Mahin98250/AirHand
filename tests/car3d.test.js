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
  assert.match(engine, /kinematicPositionBased/);
  assert.match(engine, /function advanceTraffic/);
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
  assert.match(worker, /airhand-shell-v9/);
  assert.match(worker, /"\.\/car3d-engine\.js"/);
  assert.match(worker, /https:\/\/cdn\.jsdelivr\.net/);
  assert.match(worker, /is3DDependency && response\.type === "cors"/);
  assert.match(readme, /### 3D gesture controls/);
});


test("3D renderer includes real road collision and adaptive visual quality", () => {
  assert.match(engine, /ColliderDesc\.trimesh\(new Float32Array\(roadPositions\), new Uint32Array\(roadIndices\)\)/);
  assert.match(engine, /CanvasTexture\(asphaltCanvas\)/);
  assert.match(engine, /function adaptQuality\(/);
  assert.match(engine, /renderer\.setPixelRatio\(target\)/);
  assert.match(engine, /mobileGPU \? 768 : 1536/);
});


test("3D suspension is preloaded and chassis mass is kept in a realistic range", () => {
  assert.match(engine, /\.setDensity\(330\)/);
  assert.match(engine, /const staticWheelLoad = carBody\.mass\(\) \* 9\.81 \/ 4/);
  assert.match(engine, /staticWheelLoad \+ \(restLength - suspensionLength\) \* spring - pointVelocity\.y \* damper/);
  assert.match(engine, /const restLength = 0\.39, spring = 22000, damper = 3200/);
});

test("Ultra rendering mode remains adaptive and repeated scenery uses instancing", () => {
  assert.match(engine, /function setGraphicsMode\(mode = "auto"\)/);
  assert.match(engine, /qualityMode === "ultra"/);
  assert.match(engine, /new THREE\.InstancedMesh\(railGeo/);
  assert.match(engine, /new THREE\.InstancedMesh\(dashGeo/);
  assert.match(engine, /new THREE\.InstancedMesh\(trunkGeo/);
  assert.match(app, /drive3dInstance\.setGraphicsMode/);
  assert.match(html, /id="driveGraphics"/);
});
