import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { angleDegrees, clamp, CursorSmoother, detectGesture, distance2D, GestureStabilizer, SteeringController } from "../gesture-engine.js";
import { SteeringController as LiveSteeringController } from "../steering-engine.js";

function baseHand() {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  points[0] = { x: 0.5, y: 0.8 };
  points[9] = { x: 0.5, y: 0.5 };
  points[4] = { x: 0.5, y: 0.45 };
  points[8] = { x: 0.6, y: 0.45 };
  return points;
}

test("geometry helpers handle common coordinates", () => {
  assert.equal(distance2D({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.ok(Math.abs(angleDegrees({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }) - 180) < 1e-7);
  assert.equal(clamp(-2, 0, 1), 0);
  assert.equal(clamp(0.4, 0, 1), 0.4);
  assert.equal(clamp(2, 0, 1), 1);
});

test("invalid landmarks fail safely without a recognized gesture", () => {
  assert.equal(detectGesture(null).gesture, "None");
  assert.equal(detectGesture([{ x: 0, y: 0 }]).gesture, "None");
  const invalid = baseHand();
  invalid[4] = { x: Number.NaN, y: 0 };
  assert.equal(detectGesture(invalid).gesture, "None");
});

test("pinch thresholds are normalized to palm size and have hysteresis", () => {
  const hand = baseHand();
  // Distance between thumb tip and index tip is 0.333 palm lengths.
  assert.notEqual(detectGesture(hand, false).gesture, "Pinch");
  assert.equal(detectGesture(hand, true).gesture, "Pinch");

  const scaled = hand.map(point => ({ x: 0.2 + point.x * 0.5, y: 0.1 + point.y * 0.5 }));
  assert.equal(detectGesture(scaled, true).gesture, "Pinch");
  hand[8] = { x: 0.52, y: 0.45 };
  assert.equal(detectGesture(hand, false).gesture, "Pinch");
});

test("MediaPipe model labels are preferred when classifier confidence is sufficient", () => {
  const hand = baseHand();
  assert.equal(detectGesture(hand, false, "Victory", 0.91).gesture, "Peace");
  assert.equal(detectGesture(hand, false, "Thumb_Up", 0.88).gesture, "ThumbsUp");
  assert.notEqual(detectGesture(hand, false, "Victory", 0.2).gesture, "Peace");
  assert.notEqual(detectGesture(hand, false, "Victory", 0.66).gesture, "Peace");
  assert.equal(detectGesture(hand, false, "Pointing_Up", 0.60).gesture, "Point");
  hand[8] = { x: 0.52, y: 0.45 };
  assert.equal(detectGesture(hand, false, "Open_Palm", 0.99).gesture, "Pinch");
});

test("gesture stabilizer waits for a consistent gesture and clears on hand loss", () => {
  const filter = new GestureStabilizer(100);
  assert.equal(filter.update("Point", 1000), "None");
  assert.equal(filter.update("Point", 1050), "None");
  assert.equal(filter.update("Point", 1100), "Point");
  assert.equal(filter.update("Peace", 1110), "Point");
  assert.equal(filter.update("Peace", 1209), "Point");
  assert.equal(filter.update("Peace", 1210), "Peace");
  assert.equal(filter.update("None", 1211), "None");
});

test("cursor smoother initializes promptly and suppresses micro-jitter", () => {
  const filter = new CursorSmoother(0.2);
  assert.deepEqual(filter.update(0.3, 0.4, 0), { x: 0.3, y: 0.4 });
  const still = filter.update(0.3005, 0.4005, 16);
  assert.deepEqual(still, { x: 0.3, y: 0.4 });
  const moved = filter.update(0.8, 0.8, 32);
  assert.ok(moved.x > 0.5 && moved.y > 0.5);
  assert.ok(moved.x < 0.8 && moved.y < 0.8);
});


test("pinch press and release thresholds have a wider hysteresis gap", () => {
  const hand = baseHand();
  hand[8] = { x: 0.59, y: 0.45 }; // ratio about 0.30: outside press threshold
  assert.notEqual(detectGesture(hand, false).gesture, "Pinch");
  assert.equal(detectGesture(hand, true).gesture, "Pinch"); // still held until release threshold
  hand[8] = { x: 0.63, y: 0.45 }; // ratio about 0.43: release
  assert.notEqual(detectGesture(hand, true).gesture, "Pinch");
});

test("adaptive smoothing responds faster to a large sweep than a tiny adjustment", () => {
  const small = new CursorSmoother(0.18);
  small.update(0.5, 0.5, 0);
  const smallStep = small.update(0.54, 0.5, 16);
  const large = new CursorSmoother(0.18);
  large.update(0.5, 0.5, 0);
  const largeStep = large.update(0.9, 0.5, 16);
  assert.ok(largeStep.x - 0.5 > (smallStep.x - 0.5) * 5);
  assert.ok(largeStep.x < 0.9 && smallStep.x < 0.54);
});

test("gesture stability status reports stable versus candidate timing", () => {
  const filter = new GestureStabilizer(100);
  filter.update("Point", 1000);
  assert.equal(filter.getStatus(1050).stable, false);
  filter.update("Point", 1100);
  assert.equal(filter.getStatus(1150).stable, true);
  assert.equal(filter.getStatus(1150).candidate, "Point");
});

test("the engine exposes explicit short tracking grace policy in the live app", () => {
  const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.ok(source.includes("const TRACKING_LOSS_GRACE_MS = 180"));
  assert.ok(source.includes("Reacquiring hand"));
  assert.ok(source.includes("lastHandLandmarks"));
});


test("two-hand steering calibrates neutral and maps wrist rotation with smoothing", () => {
  const hand = (x, y) => { const points = Array.from({ length: 21 }, () => ({ x, y })); points[0] = { x, y }; return points; };
  const steering = new SteeringController({ smoothing: 1, maxTurnRadians: 0.8 });
  const left = hand(0.25, 0.5), right = hand(0.75, 0.5);
  assert.equal(steering.calibrate(left, right), true);
  assert.equal(steering.update(left, right, 10).value, 0);
  const turnedRight = hand(0.75, 0.25);
  const result = steering.update(left, turnedRight, 20);
  assert.ok(Math.abs(result.value) > 0.4 && Math.abs(result.value) <= 1);
  assert.equal(result.detected, true);
  assert.ok(result.confidence > 0);
});

test("two-hand steering rejects hands too close and safely recenters when tracking is lost", () => {
  const hand = (x, y) => { const points = Array.from({ length: 21 }, () => ({ x, y })); points[0] = { x, y }; return points; };
  const steering = new SteeringController({ smoothing: 1 });
  assert.equal(steering.calibrate(hand(0.45, 0.5), hand(0.52, 0.5)), false);
  const left = hand(0.25, 0.5), right = hand(0.75, 0.5);
  steering.calibrate(left, right);
  steering.update(left, hand(0.75, 0.25));
  const lost = steering.update(null, null);
  assert.equal(lost.detected, false);
  assert.ok(Math.abs(lost.value) < 1);
  assert.equal(lost.confidence, 0);
});


test("Phase 8 live steering responds to small wheel turns with quicker smoothing", () => {
  const hand = (x, y) => { const points = Array.from({ length: 21 }, () => ({ x, y })); points[0] = { x, y }; return points; };
  const steering = new LiveSteeringController();
  const left = hand(0.25, 0.5), right = hand(0.75, 0.5);
  assert.equal(steering.calibrate(left, right), true);
  const result = steering.update(left, hand(0.75, 0.455), 20);
  assert.ok(Math.abs(result.value) > 0.05, "a small wrist-line rotation should visibly steer");
  assert.ok(steering.smoothing >= 0.4);
  assert.ok(steering.maxTurnRadians <= 0.5);
});


test("Air Drive steering direction matches the driver's right-turn and left-turn intent", () => {
  const hand = (x, y) => {
    const points = Array.from({ length: 21 }, () => ({ x, y }));
    points[0] = { x, y };
    return points;
  };
  const left = hand(0.25, 0.5);
  const neutralRight = hand(0.75, 0.5);
  const controller = new LiveSteeringController();
  assert.equal(controller.calibrate(left, neutralRight), true);
  // With the right wrist moving down, the imaginary wheel rotates right.
  const rightTurn = controller.update(left, hand(0.75, 0.56), 20);
  assert.ok(rightTurn.value > 0, "right-turn gesture must steer right");
  controller.reset();
  assert.equal(controller.calibrate(left, neutralRight), true);
  // With the right wrist moving up, the imaginary wheel rotates left.
  const leftTurn = controller.update(left, hand(0.75, 0.44), 20);
  assert.ok(leftTurn.value < 0, "left-turn gesture must steer left");
});
