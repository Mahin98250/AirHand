

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function distance2D(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function validLandmarks(landmarks) {
  return Array.isArray(landmarks) && landmarks.length >= 21 &&
    landmarks.every(point => Number.isFinite(point?.x) && Number.isFinite(point?.y));
}

/**
 * Two-hand air-steering controller. Uses the angle between the wrists, relative
 * to a user-calibrated neutral pose, and smooths the result to reduce jitter.
 */
export class SteeringController {
  constructor({ maxTurnRadians = 0.48, smoothing = 0.42, minHandSpan = 0.12 } = {}) {
    this.maxTurnRadians = maxTurnRadians;
    this.smoothing = smoothing;
    this.minHandSpan = minHandSpan;
    this.neutralAngle = null;
    this.value = 0;
    this.confidence = 0;
    this.lastSeenAt = 0;
  }

  static getPairAngle(first, second, minHandSpan = 0.12) {
    if (!validLandmarks(first) || !validLandmarks(second)) return null;
    const hands = [first, second].sort((a, b) => a[0].x - b[0].x);
    const left = hands[0][0], right = hands[1][0];
    const span = distance2D(left, right);
    if (!Number.isFinite(span) || span < minHandSpan) return null;
    return { angle: Math.atan2(right.y - left.y, right.x - left.x), span };
  }

  calibrate(first, second) {
    const pair = SteeringController.getPairAngle(first, second, this.minHandSpan);
    if (!pair) return false;
    this.neutralAngle = pair.angle;
    this.value = 0;
    this.confidence = 1;
    return true;
  }

  update(first, second, now = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    const pair = SteeringController.getPairAngle(first, second, this.minHandSpan);
    if (!pair) {
      this.confidence = 0;
      // Ease back toward center rather than snapping the car when a hand disappears.
      this.value *= 0.72;
      return { value: this.value, confidence: 0, detected: false, calibrated: this.neutralAngle !== null };
    }
    this.lastSeenAt = now;
    if (this.neutralAngle === null) {
      this.neutralAngle = pair.angle;
      this.value = 0;
    }
    let delta = pair.angle - this.neutralAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    // Ignore small natural tremor, then map wheel rotation into a bounded steering range.
    const deadZone = 0.018;
    const corrected = Math.abs(delta) <= deadZone ? 0 : Math.sign(delta) * (Math.abs(delta) - deadZone);
    const target = clamp(corrected / this.maxTurnRadians, -1, 1);
    this.value += (target - this.value) * this.smoothing;
    this.confidence = clamp((pair.span - this.minHandSpan) / 0.20, 0.4, 1);
    return { value: this.value, confidence: this.confidence, detected: true, calibrated: true };
  }

  reset() {
    this.neutralAngle = null;
    this.value = 0;
    this.confidence = 0;
    this.lastSeenAt = 0;
  }
}
