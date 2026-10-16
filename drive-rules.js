/**
 * Small, deterministic rules for Air Drive. Kept independent of rendering/physics
 * so safety-critical gameplay decisions can be tested without a browser or GPU.
 */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function projectPointToSegment2D(point, start, end) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared > 1e-9
    ? clamp(((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared, 0, 1)
    : 0;
  const x = start.x + dx * t;
  const z = start.z + dz * t;
  return { x, z, t, distance: Math.hypot(point.x - x, point.z - z) };
}

/**
 * True only when the car crosses the start/finish plane forwards, inside the
 * track's lateral bounds. Position is measured in world X/Z; tangent is the
 * normalized forward direction at the start point.
 */
export function crossedStartLine({ previous, current, start, tangent, speed, halfWidth }) {
  if (!(speed > 4) || !previous || !current || !start || !tangent) return false;
  const sideBefore = (previous.x - start.x) * tangent.x + (previous.z - start.z) * tangent.z;
  const sideAfter = (current.x - start.x) * tangent.x + (current.z - start.z) * tangent.z;
  if (!(sideBefore < 0 && sideAfter >= 0)) return false;
  const fraction = sideBefore / (sideBefore - sideAfter);
  const crossingX = previous.x + (current.x - previous.x) * fraction;
  const crossingZ = previous.z + (current.z - previous.z) * fraction;
  const lateral = (crossingX - start.x) * -tangent.z + (crossingZ - start.z) * tangent.x;
  return Math.abs(lateral) <= halfWidth;
}

/** Exact 2D separating-axis test for two oriented rectangular vehicle footprints. */
export function orientedBoxesOverlap2D({
  a, yawA, halfWidthA, halfLengthA,
  b, yawB, halfWidthB, halfLengthB
}) {
  const axes = [
    { x: Math.cos(yawA), z: -Math.sin(yawA) },
    { x: Math.sin(yawA), z: Math.cos(yawA) },
    { x: Math.cos(yawB), z: -Math.sin(yawB) },
    { x: Math.sin(yawB), z: Math.cos(yawB) }
  ];
  const delta = { x: b.x - a.x, z: b.z - a.z };
  for (const axis of axes) {
    const distance = Math.abs(delta.x * axis.x + delta.z * axis.z);
    const radiusA =
      halfWidthA * Math.abs(Math.cos(yawA) * axis.x - Math.sin(yawA) * axis.z) +
      halfLengthA * Math.abs(Math.sin(yawA) * axis.x + Math.cos(yawA) * axis.z);
    const radiusB =
      halfWidthB * Math.abs(Math.cos(yawB) * axis.x - Math.sin(yawB) * axis.z) +
      halfLengthB * Math.abs(Math.sin(yawB) * axis.x + Math.cos(yawB) * axis.z);
    if (distance > radiusA + radiusB) return false;
  }
  return true;
}

/**
 * Signed bicycle-model yaw target. Forward is local -Z, so right steering maps
 * to negative yaw; reversing flips the sign. A stationary vehicle never pivots
 * from steering alone.
 */
export function getTargetYawRate(longitudinalSpeed, steering, {
  wheelbase = 2.9,
  maxYawRate = 1.05,
  minMovingSpeed = 0.75
} = {}) {
  if (!Number.isFinite(longitudinalSpeed) || !Number.isFinite(steering)) return 0;
  const input = clamp(steering, -1, 1);
  const speed = longitudinalSpeed;
  if (Math.abs(speed) < minMovingSpeed || Math.abs(input) < 0.015) return 0;
  const steerAuthority = clamp(1 - Math.abs(speed) / 36, 0.45, 1);
  const bicycleRate = Math.abs(speed) * Math.tan(Math.abs(input) * 0.62) /
    Math.max(0.5, wheelbase) * steerAuthority;
  return -Math.sign(speed) * Math.sign(input) * clamp(bicycleRate, 0, maxYawRate);
}

export function isTrafficImpact({
  overlapping,
  playerSpeed,
  longitudinalRelativeSpeed = 0,
  lateralRelativeSpeed = 0,
  deeplyOverlapping = false
}) {
  if (!overlapping || playerSpeed <= 3) return false;
  return Math.abs(longitudinalRelativeSpeed) > 2 ||
    Math.abs(lateralRelativeSpeed) > 2 ||
    deeplyOverlapping === true;
}

/**
 * signedOffset is positive to the right of the sampled track centreline.
 * Return a force along the track normal: opposite the offset and outward drift.
 */
/**
 * Reward only movement in the forward direction of the track while the car is
 * on the road. Lateral drift, reversing and off-road shortcuts earn no distance score.
 */
export function getForwardTrackScoreDelta({ previous, current, tangent, onTrack, scale = 0.8 }) {
  if (!onTrack || !previous || !current || !tangent) return 0;
  const tangentLength = Math.hypot(tangent.x, tangent.z);
  if (tangentLength < 1e-6 || !Number.isFinite(tangentLength)) return 0;
  const dx = current.x - previous.x;
  const dz = current.z - previous.z;
  const forwardDistance = (dx * tangent.x + dz * tangent.z) / tangentLength;
  return Math.max(0, forwardDistance) * Math.max(0, scale);
}

/** Keep a collision latched only while the two footprints remain in contact. */
export function updateCollisionContactLatch({ overlapping, alreadyHit }) {
  return Boolean(overlapping && alreadyHit);
}

export function getOffRoadRecoveryForce(signedOffset, lateralTrackSpeed) {
  const offset = Number.isFinite(signedOffset) ? signedOffset : 0;
  const lateralSpeed = Number.isFinite(lateralTrackSpeed) ? lateralTrackSpeed : 0;
  return clamp(-offset * 1100 - lateralSpeed * 380, -4500, 4500);
}

/**
 * Select a lane only when it has a clear nearby gap. Include other cars'
 * intended targets so two vehicles do not both merge into the same lane.
 * Return null when every alternative is unsafe.
 */
export function chooseSafeTrafficLane({
  currentLane,
  candidates,
  traffic,
  item,
  totalLength,
  playerClosing,
  gapToPlayer,
  playerLaneOffset
}) {
  let bestLane = null;
  let bestPenalty = Infinity;

  for (const candidate of candidates) {
    if (Math.abs(candidate - currentLane) < 1.0) continue;

    let blocked = false;
    for (const other of traffic) {
      if (other === item) continue;
      const along = ((other.t - item.t + 1) % 1) * totalLength;
      const separation = Math.min(along, totalLength - along);
      const targetLane = Number.isFinite(other.laneTarget) ? other.laneTarget : other.lane;
      if (separation < 19 &&
          (Math.abs(other.lane - candidate) < 2.3 || Math.abs(targetLane - candidate) < 2.3)) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    // Never move into the player's lane while the player is actively closing.
    if (playerClosing && gapToPlayer < 27 &&
        Math.abs(candidate - playerLaneOffset) < 2.35) continue;

    const penalty = Math.abs(candidate - item.homeLane) > 0.1 ? 0.15 : 0;
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestLane = candidate;
    }
  }

  return bestLane;
}
