// Surface runtime problems in the UI so failures never look like silently dead buttons.
let airHandErrorShown = false;
function reportAirHandRuntimeError(message) {
  if (airHandErrorShown) return;
  airHandErrorShown = true;
  console.error("AirHand runtime error:", message);
  const title = document.getElementById("readyTitle");
  const detail = document.getElementById("readyText");
  if (title) title.textContent = "Controller error";
  if (detail) detail.textContent = String(message || "Unexpected error. Reload the page and try again.").slice(0, 180);
}
window.addEventListener("error", event => reportAirHandRuntimeError(event.message || "A script failed to load."));
window.addEventListener("unhandledrejection", event => reportAirHandRuntimeError(event.reason?.message || event.reason || "A background task failed."));

/**
 * Geometry-based gesture primitives for AirHand.
 * All distances are normalized by palm size so thresholds adapt to camera distance.
 */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleDegrees(a, vertex, c) {
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
  return
…[51313 chars truncated — re-run with head/grep/tail for full output]…
i = 0; i < 7; i++) {
    const x = ((i * 83 - game.score * 1.4) % (width + 60) + width + 60) % (width + 60);
    gameContext.fillStyle = "#cbdcf5";
    gameContext.beginPath();
    gameContext.arc(x, 24 + (i % 3) * 17, 1.5, 0, Math.PI * 2);
    gameContext.fill();
  }

  const playerX = width * .17;
  const playerTop = game.ground - 25 + game.playerY;
  gameContext.fillStyle = "#3778f6";
  roundRect(gameContext, playerX, playerTop, 24, 25, 7);
  gameContext.fillStyle = "#fff";
  gameContext.beginPath();
  gameContext.arc(playerX + 16, playerTop + 8, 2.3, 0, Math.PI * 2);
  gameContext.fill();
  gameContext.strokeStyle = "#3778f6";
  gameContext.lineWidth = 3.5;
  gameContext.lineCap = "round";
  gameContext.beginPath();
  gameContext.moveTo(playerX + 5, playerTop + 23);
  gameContext.lineTo(playerX + 2, playerTop + 29);
  gameContext.moveTo(playerX + 18, playerTop + 23);
  gameContext.lineTo(playerX + 22, playerTop + 28);
  gameContext.stroke();

  for (const star of game.stars) {
    const y = game.ground - star.lift + Math.sin(star.phase) * 3;
    gameContext.save();
    gameContext.translate(star.x, y);
    gameContext.rotate(star.phase * 0.12);
    gameContext.fillStyle = "#ffc44d";
    gameContext.strokeStyle = "#f1a72c";
    gameContext.lineWidth = 1.5;
    gameContext.beginPath();
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 === 0 ? star.size : star.size * 0.48;
      const angle = -Math.PI / 2 + i * Math.PI / 5;
      if (i === 0) gameContext.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      else gameContext.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    gameContext.closePath();
    gameContext.fill();
    gameContext.stroke();
    gameContext.restore();
  }
  for (const popup of game.popups) {
    gameContext.globalAlpha = clamp(popup.life / 0.9, 0, 1);
    gameContext.fillStyle = "#1e7a63";
    gameContext.font = "700 13px Manrope, sans-serif";
    gameContext.textAlign = "center";
    gameContext.fillText(popup.label, popup.x, popup.y);
    gameContext.globalAlpha = 1;
  }
  for (const obstacle of game.obstacles) {
    gameContext.fillStyle = "#ff9b70";
    roundRect(gameContext, obstacle.x, game.ground - obstacle.height, obstacle.width, obstacle.height, 4);
    gameContext.fillStyle = "#ffd0b8";
    gameContext.fillRect(obstacle.x + 4, game.ground - obstacle.height + 5, 3, Math.max(3, obstacle.height - 10));
  }
  $("score").textContent = String(Math.floor(game.score)).padStart(3, "0");
  $("bestScore").textContent = String(game.best).padStart(3, "0");
  if ($("starsCount")) $("starsCount").textContent = String(game.collected);
  if ($("comboCount")) $("comboCount").textContent = game.combo > 0 ? "x" + game.combo : "—";
}
function startGame() {
  cancelAnimationFrame(gameFrameRequest);
  game.playing = true;
  game.paused = false;
  game.score = 0;
  game.speed = 250;
  game.playerY = 0;
  game.velocityY = 0;
  game.obstacles = [];
  game.stars = [];
  game.popups = [];
  game.combo = 0;
  game.comboTimer = 0;
  game.collected = 0;
  lastStarMilestone = 0;
  game.starSpawnIn = 1.3;
  game.spawnIn = .65;
  lastGameFrame = 0;
  $("overlay").classList.add("hidden");
  renderGame();
  gameFrameRequest = requestAnimationFrame(gameFrame);
}
function gameFrame(now) {
  if (!game.playing || game.paused || currentMode !== "game") return;
  gameFrameRequest = requestAnimationFrame(gameFrame);
  const dt = Math.min(Math.max((now - (lastGameFrame || now)) / 1000, 0), .035);
  lastGameFrame = now;
  const width = gameCanvas.clientWidth;
  const height = gameCanvas.clientHeight;
  game.ground = height - 32;
  game.score += dt * 10;
  game.comboTimer = Math.max(0, game.comboTimer - dt);
  if (game.comboTimer === 0) game.combo = 0;
  const pace = game.difficulty === "chill"
    ? { base: 205, cap: 350, spawn: 1.36, minSpawn: 0.86 }
    : game.difficulty === "challenge"
      ? { base: 300, cap: 560, spawn: 0.78, minSpawn: 0.46 }
      : { base: 250, cap: 440, spawn: 1.05, minSpawn: 0.62 };
  game.speed = Math.min(pace.cap, pace.base + game.score * .42);
  game.velocityY += 1120 * dt;
  game.playerY = Math.min(0, game.playerY + game.velocityY * dt);
  if (game.playerY === 0) game.velocityY = 0;

  game.spawnIn -= dt;
  if (game.spawnIn <= 0) {
    const obstacleHeight = 19 + Math.random() * 18;
    game.obstacles.push({ x: width + 12, width: 17 + Math.random() * 9, height: obstacleHeight });
    game.spawnIn = Math.max(pace.minSpawn, pace.spawn + Math.random() * .55 - game.score / 280);
  }
  game.starSpawnIn -= dt;
  if (game.starSpawnIn <= 0) {
    game.stars.push({ x: width + 18, lift: 38 + Math.random() * 62, size: 8, phase: Math.random() * Math.PI * 2 });
    game.starSpawnIn = 1.4 + Math.random() * 1.25;
  }
  game.obstacles.forEach(obstacle => obstacle.x -= game.speed * dt);
  game.stars.forEach(star => { star.x -= game.speed * dt; star.phase += dt * 4; });
  game.stars = game.stars.filter(star => star.x > -20);
  game.popups.forEach(popup => { popup.life -= dt; popup.y -= dt * 24; });
  game.popups = game.popups.filter(popup => popup.life > 0);
  const playerX = width * .17;
  const playerTop = game.ground - 25 + game.playerY;
  const playerCenterX = playerX + 12;
  const playerCenterY = playerTop + 12;
  game.stars = game.stars.filter(star => {
    const starY = game.ground - star.lift;
    if (Math.abs(playerCenterX - star.x) < 21 && Math.abs(playerCenterY - starY) < 23) {
      game.combo = game.comboTimer > 0 ? game.combo + 1 : 1;
      game.comboTimer = 2.6;
      game.collected++;
      const bonus = 20 * Math.min(game.combo, 5);
      game.score += bonus;
      game.popups.push({ x: star.x, y: starY, label: "+" + bonus, life: 0.9 });
      playTone(620 + Math.min(game.combo, 5) * 90, 0.08);
      if (game.collected >= lastStarMilestone + 5) {
        lastStarMilestone = Math.floor(game.collected / 5) * 5;
        showToast("Star streak! " + game.collected + " collected ✨");
      }
      return false;
    }
    return true;
  });
  game.obstacles = game.obstacles.filter(obstacle => obstacle.x + obstacle.width > -2);

  const collision = game.obstacles.some(obstacle =>
    playerX + 21 > obstacle.x + 2 &&
    playerX + 4 < obstacle.x + obstacle.width - 1 &&
    playerTop + 24 > game.ground - obstacle.height + 2
  );
  if (collision) { endGame(); return; }
  renderGame();
}
function jump() {
  if (game.playerY >= -0.5 && game.velocityY >= 0) {
    game.velocityY = game.difficulty === "challenge" ? -445 : game.difficulty === "chill" ? -390 : -410;
    playTone(300, 0.055);
  }
}
function setSoundEnabled(enabled) {
  soundEnabled = enabled;
  savePreferences();
  if (soundEnabled && !audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioContext = new AudioContextClass();
    else soundEnabled = false;
  }
  if (soundEnabled && audioContext?.state === "suspended") audioContext.resume();
  $("soundToggle").textContent = soundEnabled ? "♫ Sound: on" : "♫ Sound: off";
  $("soundToggle").setAttribute("aria-pressed", String(soundEnabled));
  if (!soundEnabled && audioContext?.state === "running") audioContext.suspend();
  showToast(soundEnabled ? "Sound effects enabled." : "Sound effects muted.");
}
function playTone(frequency = 520, duration = 0.08) {
  if (!soundEnabled || !audioContext || audioContext.state !== "running") return;
  try {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.10, audioContext.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration + 0.015);
  } catch (error) { console.warn("Sound effect unavailable:", error); }
}
function cycleDifficulty() {
  const order = ["chill", "normal", "challenge"];
  const labels = { chill: "☁ Pace: chill", normal: "⚡ Pace: normal", challenge: "🔥 Pace: challenge" };
  game.difficulty = order[(order.indexOf(game.difficulty) + 1) % order.length];
  $("difficultyToggle").textContent = labels[game.difficulty];
  $("difficultyToggle").setAttribute("aria-pressed", String(game.difficulty === "challenge"));
  savePreferences();
  showToast("Runner pace: " + game.difficulty + ".");
}
function pauseGame(showOverlay = true) {
  if (!game.playing) return;
  game.paused = true;
  cancelAnimationFrame(gameFrameRequest);
  if (showOverlay) showGameOverlay("Paused", "Show an open palm or press resume to continue.", "Resume");
}
function resumeGame() {
  if (!game.playing) return startGame();
  game.paused = false;
  lastGameFrame = 0;
  $("overlay").classList.add("hidden");
  gameFrameRequest = requestAnimationFrame(gameFrame);
}
function endGame() {
  cancelAnimationFrame(gameFrameRequest);
  game.playing = false;
  game.paused = false;
  const score = Math.floor(game.score);
  if (score > game.best) {
    game.best = score;
    try { localStorage.setItem("airhand-best", String(game.best)); } catch { /* storage may be disabled in private browsing */ }
  }
  renderGame();
  showGameOverlay("Run complete · " + score + " points", "Best score: " + game.best + ". Pinch or tap to play again.", "Play again");
}
function showGameOverlay(title, message, button) {
  $("gameTitle").textContent = title;
  $("gameText").textContent = message;
  $("play").textContent = button;
  $("overlay").classList.remove("hidden");
}

// Restore safe preferences after controls exist. The interaction lock is intentionally never persisted.
$("sensitivity").value = String(cursorSensitivity);
$("sensitivityValue").textContent = Math.round(cursorSensitivity * 100) + "%";
$("mirrorToggle").checked = mirrorCamera;
video.style.transform = mirrorCamera ? "scaleX(-1)" : "none";
$("landmarkToggle").checked = showLandmarks;
$("dwellToggle").checked = dwellEnabled;
$("dwellValue").textContent = dwellEnabled ? "On · " + dwellDurationMs + " ms" : "Off";
$("dwellDuration").value = String(dwellDurationMs);
$("dwellDurationValue").textContent = dwellDurationMs + " ms";
$("soundToggle").textContent = soundEnabled ? "♫ Sound: on" : "♫ Sound: off";
$("soundToggle").setAttribute("aria-pressed", String(soundEnabled));
$("difficultyToggle").textContent = ({ normal: "⚡ Pace: normal", fast: "⚡ Pace: fast", challenge: "🔥 Pace: challenge" })[game.difficulty];
$("difficultyToggle").setAttribute("aria-pressed", String(game.difficulty === "challenge"));

$("start").addEventListener("click", startCamera);
$("start2").addEventListener("click", startCamera);
$("stopCamera").addEventListener("click", stopCamera);
$("calibrate").addEventListener("click", startCursorCalibration);
$("soundToggle").addEventListener("click", () => setSoundEnabled(!soundEnabled));
$("difficultyToggle").addEventListener("click", cycleDifficulty);
$("landmarkToggle").addEventListener("change", event => { showLandmarks = event.target.checked; savePreferences(); });
$("mirrorToggle").addEventListener("change", event => {
  mirrorCamera = event.target.checked;
  video.style.transform = mirrorCamera ? "scaleX(-1)" : "none";
  calibrationRun = null;
  cursorCalibration = { ...DEFAULT_CURSOR_CALIBRATION };
  try { localStorage.removeItem("airhand-cursor-calibration"); } catch { /* optional preference */ }
  $("calibrate").textContent = "Calibrate cursor";
  $("calibrate").disabled = !cameraActive;
  if (cameraActive) $("gestureConfidence").textContent = "Preview changed — recalibrate for best cursor accuracy";
  savePreferences();
});
$("sensitivity").addEventListener("input", event => { cursorSensitivity = Number(event.target.value); cursorFilter.alpha = cursorSensitivity; $("sensitivityValue").textContent = Math.round(cursorSensitivity * 100) + "%"; savePreferences(); });
$("dwellToggle").addEventListener("change", event => {
  dwellEnabled = event.target.checked;
  resetDwellProgress();
  $("dwellValue").textContent = dwellEnabled ? "On · " + dwellDurationMs + " ms" : "Off";
  $("interactionLockStatus").textContent = interactionsLocked ? "Interactions locked" : (dwellEnabled ? "Dwell ready · pause over a tile" : "Pinch to drag · release to drop");
  showToast(dwellEnabled ? "Dwell click enabled." : "Dwell click disabled.");
  savePreferences();
});
$("dwellDuration").addEventListener("input", event => {
  dwellDurationMs = Number(event.target.value);
  $("dwellDurationValue").textContent = dwellDurationMs + " ms";
  if (dwellEnabled) $("dwellValue").textContent = "On · " + dwellDurationMs + " ms";
  resetDwellProgress();
  savePreferences();
});
$("interactionLock").addEventListener("click", () => {
  interactionsLocked = !interactionsLocked;
  if (interactionsLocked) { cancelVirtualDrag("Interactions locked"); resetDwellProgress(); }
  const button = $("interactionLock");
  button.setAttribute("aria-pressed", String(interactionsLocked));
  button.textContent = interactionsLocked ? "🔒 Interactions locked" : "🔓 Interactions unlocked";
  $("interactionLockStatus").textContent = interactionsLocked ? "Locked · cursor moves, clicks and drag are disabled" : "Unlocked · pinch to drag, dwell optional";
  showToast(interactionsLocked ? "Interactions locked — cursor movement continues." : "Interactions unlocked.");
});
$("resetPreferences").addEventListener("click", () => {
  try { localStorage.removeItem(PREFERENCES_KEY); localStorage.removeItem("airhand-cursor-calibration"); } catch { /* Storage may be unavailable. */ }
  cursorSensitivity = 0.22; cursorFilter.alpha = cursorSensitivity; mirrorCamera = true; showLandmarks = true;
  dwellEnabled = false; dwellDurationMs = 850; soundEnabled = false; game.difficulty = "normal";
  cursorCalibration = { ...DEFAULT_CURSOR_CALIBRATION };
  $("sensitivity").value = "0.22"; $("sensitivityValue").textContent = "22%";
  $("mirrorToggle").checked = true; video.style.transform = "scaleX(-1)"; $("landmarkToggle").checked = true;
  $("dwellToggle").checked = false; $("dwellValue").textContent = "Off"; $("dwellDuration").value = "850"; $("dwellDurationValue").textContent = "850 ms";
  setSoundEnabled(false); $("difficultyToggle").textContent = "⚡ Pace: normal"; $("difficultyToggle").setAttribute("aria-pressed", "false");
  $("calibrate").textContent = "Calibrate cursor"; $("calibrate").disabled = !cameraActive; resetDwellProgress(); savePreferences();
  showToast("Settings reset to defaults.");
});
$("action").addEventListener("click", () => {
  if (!cameraActive) return startCamera();
  if (currentMode === "drive") { if (drive.playing) { drive.playing = false; startDrive(); } else startDrive(); return; }
  if (currentMode === "cursor") {
    cursorFilter.reset(.5, .5);
    $("cursor").style.left = "50%";
    $("cursor").style.top = "50%";
    showToast("Cursor re-centered.");
  } else startGame();
});
document.querySelectorAll(".tab").forEach(button => button.addEventListener("click", () => switchMode(button.dataset.mode)));
$("play").addEventListener("click", () => {
  if (game.playing && game.paused) resumeGame();
  else startGame();
});
$("drivePlay").addEventListener("click", () => { if (currentMode !== "drive") switchMode("drive"); startDrive(); });
$("driveCalibrate").addEventListener("click", calibrateDriveSteering);
$("driveReset").addEventListener("click", () => { drive.playing = false; drive.steer = 0; if (driveSteering) driveSteering.reset(); $("driveTitle").textContent = "Ready to drive?"; $("driveText").textContent = "Show both hands like you are holding a steering wheel, then calibrate."; $("drivePlay").textContent = "Start engine"; $("driveOverlay").classList.remove("hidden"); renderDrive(); });
document.querySelector(".gamebox").addEventListener("pointerdown", event => {
  // The overlay covers the canvas after a run ends; allow tapping its background to restart.
  if (event.target.closest("#play") || currentMode !== "game") return;
  if (!game.playing) startGame();
  else if (!game.paused) jump();
});
window.addEventListener("keydown", event => {
  if (event.repeat || event.target?.matches?.("button, input, select, textarea")) return;
  if (currentMode === "drive" && ["ArrowLeft", "ArrowRight", "KeyA", "KeyD"].includes(event.code)) {
    event.preventDefault();
    drive.steer = (event.code === "ArrowLeft" || event.code === "KeyA") ? -0.85 : 0.85;
    return;
  }
  if (event.code === "Space" && currentMode === "drive") {
    event.preventDefault();
    if (!drive.playing) startDrive(); else { drive.steer = 0; }
    return;
  }
  if (event.code === "Space" && currentMode === "game") {
    event.preventDefault();
    if (!game.playing) startGame();
    else if (!game.paused) jump();
    return;
  }
  if (event.key.toLowerCase() === "p" && currentMode === "game" && game.playing) {
    if (game.paused) resumeGame();
    else pauseGame();
    return;
  }
  if (event.key === "1") switchMode("cursor");
  if (event.key === "2") switchMode("game");
});
window.addEventListener("keyup", event => {
  if (currentMode === "drive" && ["ArrowLeft", "ArrowRight", "KeyA", "KeyD"].includes(event.code)) drive.steer = 0;
});
window.addEventListener("resize", () => { resizeCanvases(); fitDriveCanvas(); renderDrive(); });
window.addEventListener("pageshow", () => {
  if (cameraActive && mediaStream?.getVideoTracks().every(track => track.readyState === "ended")) handleCameraTrackEnded();
});
video.addEventListener("loadedmetadata", fitCameraFrameToVideo);
window.addEventListener("pagehide", () => {
  pageIsClosing = true;
  cancelAnimationFrame(gameFrameRequest);
  stopCamera();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && game.playing && !game.paused) pauseGame(true);
});
updateCameraUI(false);
resizeCanvases();
fitDriveCanvas();
renderDrive();
window.__AIRHAND_READY__ = true;
