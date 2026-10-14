import test from "node:test";
import assert from "node:assert/strict";
import { angleDegrees, clamp, CursorSmoother, detectGesture, distance2D, GestureStabilizer } from "../gesture-engine.js";

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
  assert.deepEqual(filter.update(0.3, 0.4), { x: 0.3, y: 0.4 });
  const still = filter.update(0.3005, 0.4005);
  assert.deepEqual(still, { x: 0.3, y: 0.4 });
  const moved = filter.update(0.8, 0.8);
  assert.ok(moved.x > 0.5 && moved.y > 0.5);
  assert.ok(moved.x < 0.8 && moved.y < 0.8);
});
