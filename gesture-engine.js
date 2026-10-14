/**
 * Geometry-based gesture primitives for AirHand.
 * All distances are normalized by palm size so thresholds adapt to camera distance.
 */
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function angleDegrees(a, vertex, c) {
  const ax = a.x - vertex.x, ay = a.y - vertex.y;
  const cx = c.x - vertex.x, cy = c.y - vertex.y;
  const denominator = Math.hypot(ax, ay) * Math.hypot(cx, cy);
  if (!denominator) return 0;
  const cosine = clamp((ax * cx + ay * cy) / denominator, -1, 1);
  return Math.acos(cosine) * 180 / Math.PI;
}

function validLandmarks(landmarks) {
  return Array.isArray(landmarks) && landmarks.length >= 21 &&
    landmarks.every(p => Number.isFinite(p?.x) && Number.isFinite(p?.y));
}

function fingerIsExtended(landmarks, mcp, pip, tip) {
  const jointAngle = angleDegrees(landmarks[mcp], landmarks[pip], landmarks[tip]);
  const wristToPip = distance2D(landmarks[0], landmarks[pip]);
  const wristToTip = distance2D(landmarks[0], landmarks[tip]);
  // Joint extension is less dependent on the hand's rotation than tip height alone.
  return jointAngle >= 145 && wristToTip >= wristToPip * 1.045;
}

function thumbIsExtended(landmarks, palmScale) {
  const thumbAngle = angleDegrees(landmarks[2], landmarks[3], landmarks[4]);
  const thumbToIndexBase = distance2D(landmarks[4], landmarks[5]);
  return thumbAngle >= 118 && thumbToIndexBase / palmScale >= 0.48;
}

/**
 * Recognize a gesture from MediaPipe's 21 normalized hand landmarks.
 * previousPinch enables a small hysteresis band to avoid pinch flicker.
 */
export function detectGesture(landmarks, previousPinch = false, modelCategory = null, modelScore = 0) {
  if (!validLandmarks(landmarks)) {
    return { gesture: "None", fingers: null, pinchRatio: Infinity, palmScale: 0 };
  }

  const palmScale = Math.max(distance2D(landmarks[0], landmarks[9]), 0.0001);
  const fingers = {
    index: fingerIsExtended(landmarks, 5, 6, 8),
    middle: fingerIsExtended(landmarks, 9, 10, 12),
    ring: fingerIsExtended(landmarks, 13, 14, 16),
    pinky: fingerIsExtended(landmarks, 17, 18, 20)
  };
  const thumbExtended = thumbIsExtended(landmarks, palmScale);
  const pinchRatio = distance2D(landmarks[4], landmarks[8]) / palmScale;
  // Hysteresis separates the press threshold from the wider release threshold.
  // The latch stays engaged through small landmark jitter around the boundary.
  const pinchThreshold = previousPinch ? 0.43 : 0.28;

  if (pinchRatio < pinchThreshold) {
    const pinchStrength = clamp((0.43 - pinchRatio) / (0.43 - 0.18), 0, 1);
    return {
      gesture: "Pinch", fingers, pinchRatio, palmScale, thumbExtended,
      source: "geometry", confidence: Math.round((0.55 + pinchStrength * 0.45) * 100) / 100
    };
  }

  // Prefer MediaPipe's trained classifier for supported canned gestures.
  // Keep a geometric fallback for unclear poses and the custom pinch gesture.
  const modelMapping = {
    Pointing_Up: "Point",
    Victory: "Peace",
    Thumb_Up: "ThumbsUp",
    Open_Palm: "OpenPalm",
    Closed_Fist: "Fist"
  };
  // Higher thresholds for poses that would switch modes or pause the game.
  const confidenceThresholds = {
    Pointing_Up: 0.58,
    Victory: 0.70,
    Thumb_Up: 0.66,
    Open_Palm: 0.58,
    Closed_Fist: 0.62
  };
  const requiredConfidence = confidenceThresholds[modelCategory] ?? 1;
  if (modelMapping[modelCategory] && modelScore >= requiredConfidence) {
    return {
      gesture: modelMapping[modelCategory], fingers, pinchRatio, palmScale,
      thumbExtended, source: "model", confidence: modelScore
    };
  }

  const { index, middle, ring, pinky } = fingers;
  const curledCount = [index, middle, ring, pinky].filter(Boolean).length;

  // A thumbs-up has curled fingers and a thumb tip raised above its base.
  const thumbRaised = landmarks[4].y < landmarks[3].y - 0.015 &&
    landmarks[4].y < landmarks[0].y - 0.025;
  if (thumbExtended && thumbRaised && curledCount === 0) {
    return { gesture: "ThumbsUp", fingers, pinchRatio, palmScale, thumbExtended };
  }
  if (index && middle && !ring && !pinky) {
    return { gesture: "Peace", fingers, pinchRatio, palmScale, thumbExtended };
  }
  if (index && !middle && !ring && !pinky) {
    return { gesture: "Point", fingers, pinchRatio, palmScale, thumbExtended };
  }
  if (index && middle && ring && pinky && thumbExtended) {
    return { gesture: "OpenPalm", fingers, pinchRatio, palmScale, thumbExtended };
  }
  if (!index && !middle && !ring && !pinky && !thumbExtended) {
    return { gesture: "Fist", fingers, pinchRatio, palmScale, thumbExtended };
  }
  return { gesture: "Unclear", fingers, pinchRatio, palmScale, thumbExtended };
}

/**
 * Debounces discrete gesture changes. A lost hand clears immediately;
 * meaningful gestures must persist briefly before they can trigger actions.
 */
export class GestureStabilizer {
  constructor(holdMs = 110) {
    this.holdMs = holdMs;
    this.stable = "None";
    this.candidate = "None";
    this.candidateSince = 0;
  }

  reset() {
    this.stable = "None";
    this.candidate = "None";
    this.candidateSince = 0;
  }

  update(next, now = performance.now()) {
    if (!next || next === "None") {
      this.reset();
      return this.stable;
    }
    if (next !== this.candidate) {
      this.candidate = next;
      this.candidateSince = now;
      return this.stable;
    }
    if (next !== this.stable && now - this.candidateSince >= this.holdMs) {
      this.stable = next;
      this.stableSince = now;
    }
    return this.stable;
  }

  getStatus(now = performance.now()) {
    if (this.stable === "None") {
      return { stable: false, durationMs: Math.max(0, now - this.candidateSince), candidate: this.candidate };
    }
    return {
      stable: this.candidate === this.stable,
      durationMs: Math.max(0, now - (this.stableSince || this.candidateSince)),
      candidate: this.candidate
    };
  }
}

/** Adaptive low-pass cursor filter: calmer for tiny shakes, quicker for larger moves. */
export class CursorSmoother {
  constructor(alpha = 0.22) {
    this.alpha = alpha;
    this.x = 0.5;
    this.y = 0.5;
    this.initialized = false;
  }

  reset(x = 0.5, y = 0.5) {
    this.x = clamp(x, 0, 1);
    this.y = clamp(y, 0, 1);
    this.initialized = true;
  }

  update(x, y, now = (typeof performance !== "undefined" ? performance.now() : Date.now())) {
    x = clamp(x, 0, 1);
    y = clamp(y, 0, 1);
    if (!this.initialized) {
      this.reset(x, y);
      this.lastAt = now;
      return { x: this.x, y: this.y };
    }
    const elapsedMs = Math.max(1, Math.min(100, now - (this.lastAt ?? now - 16)));
    this.lastAt = now;
    const delta = Math.hypot(x - this.x, y - this.y);
    const deadZone = 0.0014;
    if (delta <= deadZone) return { x: this.x, y: this.y };
    // Keep small movements calm, but let intentional fast sweeps catch up quickly.
    const speed = delta / elapsedMs * 1000;
    const targetAlpha = speed > 1.8 || delta > 0.16 ? 0.72
      : speed > 0.65 || delta > 0.055 ? 0.44
      : this.alpha;
    const factor = 1 - Math.pow(1 - clamp(targetAlpha, 0.08, 0.78), elapsedMs / 16.67);
    this.x += (x - this.x) * factor;
    this.y += (y - this.y) * factor;
    return { x: this.x, y: this.y };
  }
}
