import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chooseSafeTrafficLane, getOffRoadRecoveryForce, isTrafficImpact } from "../drive-rules.js";

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
  assert.match(worker, /airhand-shell-v18/);
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


test("player sports-car model includes detailed bodywork, glazing, brakes and aero", () => {
  assert.match(engine, /Detailed player-only sports-coupe bodywork/);
  assert.match(engine, /const splitter = mesh/);
  assert.match(engine, /const grille = mesh/);
  assert.match(engine, /const windshield = mesh/);
  assert.match(engine, /const rearGlass = mesh/);
  assert.match(engine, /const disc = mesh/);
  assert.match(engine, /const caliper = mesh/);
  assert.match(engine, /const rearLightBar = mesh/);
  assert.match(engine, /const spoiler = mesh/);
  assert.match(engine, /if \(isPlayer\) \{[\s\S]*?Sport wheels: visible brake rotors/);
});

test("3D start snaps the follow camera and reuses physics descriptors", () => {
  assert.match(engine, /const wheelOffsets = \[[\s\S]*?front: false, left: false \}\s*\];/);
  assert.doesNotMatch(engine, /function applyCarPhysics\(dt\)[\s\S]*?const wheelOffsets = \[/);
  assert.match(engine, /function syncVisuals\(snapCamera = false\)/);
  assert.match(engine, /if \(snapCamera\) camera\.position\.copy\(tempV3\)/);
  assert.match(engine, /tempV3b\.set\(p\.x \+ forward\.x \* 4, p\.y \+ 0\.8, p\.z \+ forward\.z \* 4\)/);
  assert.match(engine, /function start\(\)[\s\S]*?keepCarGrounded\(\);\s*syncVisuals\(true\)/);
  assert.match(engine, /keepCarGrounded\(\);\s*syncVisuals\(true\);\s*publishTelemetry/);
});

test("arcade physics locks vertical position and pitch/roll after each physics step", () => {
  assert.match(engine, /world\.step\(\);\s*keepCarGrounded\(\);\s*updateTrackProgress\(\);\s*updateTrafficAndCollisions\(\)/);
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
  assert.match(engine, /const impactImpulse = clamp\(closingSpeed \* carBody\.mass\(\) \* 0\.1, 120, 1600\)/);
  assert.match(engine, /const overlapping = Math\.abs\(relativePosition\.x\) < 1\.72 && Math\.abs\(relativePosition\.z\) < 3\.45/);
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


test("3D driving uses speed-limited acceleration, bicycle-model steering, and distance-based progression", () => {
  assert.match(engine, /const speedHeadroom = clamp\(\(speedLimit - longitudinalSpeed\) \/ 7, 0, 1\)/);
  assert.match(engine, /Bicycle-model steering/);
  assert.match(engine, /const aerodynamicDrag = longitudinalSpeed \* Math\.abs\(longitudinalSpeed\) \* 0\.28/);
  assert.match(engine, /function updateTrackProgress\(\)/);
  assert.match(engine, /score \+= travelled \* 0\.8/);
  assert.match(engine, /wrappedForwardCrossing/);
  assert.match(engine, /laps, nitro: Math\.round\(nitro\)/);
});

test("traffic collisions use oriented overlap and near-misses require an actual pass", () => {
  assert.match(engine, /const relativePosition = rotateLocal/);
  assert.match(engine, /const overlapping = Math\.abs\(relativePosition\.x\) < 1\.72 && Math\.abs\(relativePosition\.z\) < 3\.45/);
  assert.match(engine, /const passedFrontToBack = item\.previousRelativeZ !== null/);
  assert.match(engine, /lateralGap >= 1\.72 && lateralGap < 2\.65/);
  assert.doesNotMatch(engine, /distance > 2\.6 && distance < 4\.2/);
});


test("traffic uses three safe lanes, reacts to closing player traffic, and changes lanes smoothly", () => {
  assert.match(engine, /const side = \[-3\.8, 0, 3\.8\]\[i % 3\]/);
  assert.match(engine, /homeLane: side, laneTarget: side, laneCooldown: 0/);
  assert.match(engine, /const playerClosing = gapToPlayer > 4 && gapToPlayer < 34/);
  assert.match(engine, /let blockedAhead = false/);
  assert.match(engine, /item\.lane \+= clamp\(item\.laneTarget - item\.lane, -2\.2 \* dt, 2\.2 \* dt\)/);
  assert.match(engine, /item\.t = \(item\.t \+ item\.cruiseSpeed \* difficulty \* dt \/ totalLength\) % 1/);
});

test("difficulty progresses gradually with score and laps, while steering and braking stay controlled", () => {
  assert.match(engine, /function getDifficulty\(\)[\s\S]*?Math\.floor\(score \/ 1800\) \* 0\.05 \+ laps \* 0\.04, 1, 1\.4/);
  assert.match(engine, /steeringResponse \+= \(controls\.steer - steeringResponse\) \* \(1 - Math\.exp\(-dt \* 7\.5\)\)/);
  assert.match(engine, /const brakingForce = Math\.min\(9200, 5200 \+ Math\.abs\(longitudinalSpeed\) \* 85\)/);
  assert.match(engine, /difficulty: Math\.round\(getDifficulty\(\) \* 100\) \/ 100/);
});


test("traffic impacts include rear-end, side-swipe, and deep overlap while ignoring harmless proximity", () => {
  assert.equal(isTrafficImpact({
    overlapping: true, playerSpeed: 22, longitudinalRelativeSpeed: -6,
    lateralRelativeSpeed: 0, deeplyOverlapping: false
  }), true, "a faster traffic car can strike the player from behind");
  assert.equal(isTrafficImpact({
    overlapping: true, playerSpeed: 14, longitudinalRelativeSpeed: 0.4,
    lateralRelativeSpeed: -3.2, deeplyOverlapping: false
  }), true, "a lane-change side impact is counted");
  assert.equal(isTrafficImpact({
    overlapping: true, playerSpeed: 6, longitudinalRelativeSpeed: 0.3,
    lateralRelativeSpeed: 0.2, deeplyOverlapping: true
  }), true, "deep overlap prevents cars passing through one another");
  assert.equal(isTrafficImpact({
    overlapping: false, playerSpeed: 22, longitudinalRelativeSpeed: 8,
    lateralRelativeSpeed: 0, deeplyOverlapping: false
  }), false, "nearby cars without overlap do not collide");
  assert.equal(isTrafficImpact({
    overlapping: true, playerSpeed: 2, longitudinalRelativeSpeed: 8,
    lateralRelativeSpeed: 0, deeplyOverlapping: false
  }), false, "stationary low-speed contact does not create damage");
});

test("off-road recovery pulls toward the track and damps outward lateral drift", () => {
  assert.ok(getOffRoadRecoveryForce(4, 0) < 0, "right-side offset gets a leftward force");
  assert.ok(getOffRoadRecoveryForce(-4, 0) > 0, "left-side offset gets a rightward force");
  assert.ok(getOffRoadRecoveryForce(0, 4) < 0, "outward rightward drift is damped");
  assert.ok(getOffRoadRecoveryForce(0, -4) > 0, "outward leftward drift is damped");
  assert.equal(getOffRoadRecoveryForce(100, 0), -4500, "recovery force is capped");
  assert.equal(getOffRoadRecoveryForce(-100, 0), 4500, "recovery force is capped symmetrically");
});

test("traffic changes only into a clear lane and waits when every lane is occupied", () => {
  const item = { t: 0.1, lane: -3.8, laneTarget: -3.8, homeLane: -3.8 };
  const base = {
    currentLane: -3.8,
    candidates: [-3.8, 0, 3.8],
    item,
    totalLength: 1000,
    playerClosing: true,
    gapToPlayer: 12,
    playerLaneOffset: -3.8
  };
  const trafficWithMiddleBlocked = [
    item,
    { t: 0.11, lane: 0, laneTarget: 0, homeLane: 0 }
  ];
  assert.equal(chooseSafeTrafficLane({ ...base, traffic: trafficWithMiddleBlocked }), 3.8);
  const allAlternativesBlocked = [
    ...trafficWithMiddleBlocked,
    { t: 0.12, lane: 3.8, laneTarget: 3.8, homeLane: 3.8 }
  ];
  assert.equal(chooseSafeTrafficLane({ ...base, traffic: allAlternativesBlocked }), null);
});

test("game-over state is reset deliberately and cannot be resumed before reset", () => {
  assert.match(engine, /let gameOver = false/);
  assert.match(engine, /offRoad = false; gameOver = false; accumulator = 0/);
  assert.match(engine, /if \(disposed \|\| gameOver\) return;/);
  assert.match(engine, /if \(disposed \|\| gameOver\) return; running = true/);
  assert.match(engine, /if \(damage >= 3 && !gameOver\)[\s\S]*?gameOver = true;\s*pause\(\)/);
  assert.match(engine, /getTelemetry: \(\) => \(\{ speed, score, best, damage, nearMisses, laps, nitro, offRoad, gameOver/);
});
