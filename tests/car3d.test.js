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
  assert.match(worker, /airhand-shell-v12/);
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
  assert.match(engine, /mobileGPU \? 512 : 1024/);
});


test("arcade physics locks vertical position and pitch/roll after each physics step", () => {
  assert.match(engine, /world\.step\(\);\s*keepCarGrounded\(\);\s*updateTrafficAndCollisions\(\)/);
  assert.match(engine, /function keepCarGrounded\(\)[\s\S]*?setTranslation\(\{ x: position\.x, y: 0\.9, z: position\.z \}, true\)/);
  assert.match(engine, /setLinvel\(\{ x: velocity\.x, y: 0, z: velocity\.z \}, true\)/);
  assert.match(engine, /setRotation\(\{ x: 0, y: Math\.sin\(yaw \/ 2\), z: 0, w: Math\.cos\(yaw \/ 2\) \}, true\)/);
  assert.match(engine, /setAngvel\(\{ x: 0, y: angular\.y, z: 0 \}, true\)/);
});

test("3D car spawn uses a low-contact collider and cannot spring-launch at startup", () => {
  assert.match(engine, /ColliderDesc\.cuboid\(0\.9, 0\.32, 1\.82\)[\s\S]*?\.setTranslation\(0, -0\.55, 0\)/);
  assert.match(engine, /\.setDensity\(330\)\.setFriction\(1\.15\)\.setRestitution\(0\)/);
  assert.match(engine, /const staticWheelLoad = carBody\.mass\(\) \* 9\.81 \/ 4/);
  assert.match(engine, /const tireLoad = staticWheelLoad \* 0\.25/);
  assert.doesNotMatch(engine, /const restLength = 0\.39, spring = 22000, damper = 3200/);
  assert.doesNotMatch(engine, /addForceAtPoint\(\{ x: 0, y: springForce, z: 0 \}/);
  assert.match(engine, /carBody\.applyImpulse\(\{ x: \(p\.x - t\.x\) \* 320, y: 0, z: \(p\.z - t\.z\) \* 320 \}/);
});

test("Ultra rendering mode remains adaptive and repeated scenery uses instancing", () => {
  assert.match(engine, /function setGraphicsMode\(mode = "auto"\)/);
  assert.match(engine, /qualityMode === "ultra"/);
  assert.match(engine, /new THREE\.InstancedMesh\(railGeo/);
  assert.match(engine, /new THREE\.InstancedMesh\(dashGeo/);
  assert.match(engine, /new THREE\.InstancedMesh\(trunkGeo/);
  assert.match(engine, /new THREE\.InstancedMesh\(hillGeo/);
  assert.match(engine, /const grain = 176 \+ Math\.random\(\) \* 48/);
  assert.match(app, /drive3dInstance\.setGraphicsMode/);
  assert.match(html, /id="driveGraphics"/);
});


test("paused 3D game does not keep scheduling animation frames", () => {
  assert.match(engine, /if \(frameId\) cancelAnimationFrame\(frameId\);\s*frameId = 0;\s*speed = 0/);
  assert.match(engine, /function start\(\)[\s\S]*?frameId = requestAnimationFrame\(frame\)/);
  assert.match(engine, /function resume\(\)[\s\S]*?if \(!frameId\) frameId = requestAnimationFrame\(frame\)/);
  assert.match(engine, /renderer\.render\(scene, camera\);\s*\}/);
});


test("3D renderer suspends background work and resumes only an active run", () => {
  assert.match(engine, /function handleVisibilityChange\(\)/);
  assert.match(engine, /if \(document\.hidden\) \{[\s\S]*?cancelAnimationFrame\(frameId\)[\s\S]*?frameId = 0/);
  assert.match(engine, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(engine, /document\.removeEventListener\("visibilitychange", handleVisibilityChange\)/);
});

test("mobile graphics adapt shadow load and expose live performance telemetry", () => {
  assert.match(engine, /const maxPixelRatio = mobileGPU \? 1\.5 : 2\.5/);
  assert.match(engine, /function applyShadowQuality\(\)/);
  assert.match(engine, /if \(mobileGPU && shadowsActive && slowFrameWindows >= 2\)/);
  assert.match(engine, /if \(mobileGPU && !shadowsActive && stableFrameWindows >= 3\)/);
  assert.match(engine, /fps: Math\.round\(1000 \/ Math\.max\(1, frameAverageMs\)\)/);
  assert.match(engine, /pixelRatio: renderer\.getPixelRatio\(\)/);
  assert.match(app, /const fps = \$\("driveFPS"\)/);
  assert.match(html, /id="driveFPS"/);
});

test("mobile cockpit provides readable graphics status and thumb-friendly touch controls", () => {
  assert.match(html, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(html, /backdrop-filter:blur\(12px\)/);
  assert.match(html, /min-height:48px/);
  assert.match(html, /drive-controls \.drive-pad #driveBrake\{grid-column:2\/4\}/);
  assert.match(app, /onGraphicsMode\(mode, pixelRatio, shadowsActive\)/);
});
