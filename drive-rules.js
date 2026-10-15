/**
 * Small, deterministic rules for Air Drive. Kept independent of rendering/physics
 * so safety-critical gameplay decisions can be tested without a browser or GPU.
 */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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
