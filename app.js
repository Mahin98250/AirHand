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
function detectGesture(landmarks, previousPinch = false, modelCategory = null, modelScore = 0) {
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
class GestureStabilizer {
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
class CursorSmoother {
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


const $ = id => document.getElementById(id);
const video = $("video");
const trackingCanvas = $("track");
const trackingContext = trackingCanvas.getContext("2d");
const gameCanvas = $("game");
const gameContext = gameCanvas.getContext("2d");
const cameraStage = $("stage");

let FilesetResolver = null;
let GestureRecognizer = null;
let HandLandmarker = null;
let gestureRecognizer = null;
let geometryOnlyFallback = false;
let mediaStream = null;
let cameraActive = false;
let trackingFrame = 0;
let gameFrameRequest = 0;
let lastVideoTime = -1;
let lastHandSeenAt = 0;
let lastHandLandmarks = null;
const TRACKING_LOSS_GRACE_MS = 180;
let fpsFrames = 0;
let fpsWindowStart = 0;
let currentMode = "cursor";
let lastStableGesture = "None";
let lastPeaceSwitch = 0;
let lastThumbToggle = 0;
let lastGameFrame = 0;
let stablePinch = false;
let dwellEnabled = false;
let dwellDurationMs = 850;
let interactionsLocked = false;
let dwellCandidate = null;
let dwellStartedAt = 0;
let dwellTriggeredTarget = null;
let dragSource = null;
let pageIsClosing = false;
let soundEnabled = false;
let cursorSensitivity = 0.22;
let mirrorCamera = true;
let showLandmarks = true;
const stabilizer = new GestureStabilizer(115);
const cursorFilter = new CursorSmoother(cursorSensitivity);
const DEFAULT_CURSOR_CALIBRATION = { minX: 0.08, maxX: 0.92, minY: 0.08, maxY: 0.92, calibrated: false };
const PREFERENCES_KEY = "airhand-preferences-v1";
function readPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "null");
    if (!saved || typeof saved !== "object") return null;
    return {
      cursorSensitivity: Number.isFinite(saved.cursorSensitivity) ? clamp(saved.cursorSensitivity, 0.12, 0.55) : 0.22,
      mirrorCamera: typeof saved.mirrorCamera === "boolean" ? saved.mirrorCamera : true,
      showLandmarks: typeof saved.showLandmarks === "boolean" ? saved.showLandmarks : true,
      dwellEnabled: typeof saved.dwellEnabled === "boolean" ? saved.dwellEnabled : false,
      dwellDurationMs: Number.isFinite(saved.dwellDurationMs) ? Math.round(clamp(saved.dwellDurationMs, 500, 1500) / 50) * 50 : 850,
      soundEnabled: typeof saved.soundEnabled === "boolean" ? saved.soundEnabled : false,
      difficulty: ["normal", "fast", "challenge"].includes(saved.difficulty) ? saved.difficulty : "normal"
    };
  } catch { return null; }
}
function savePreferences() {
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ cursorSensitivity, mirrorCamera, showLandmarks, dwellEnabled, dwellDurationMs, soundEnabled, difficulty: game.difficulty })); }
  catch { /* Preferences are optional when storage is unavailable or full. */ }
}
function loadCursorCalibration() {
  try {
    const saved = JSON.parse(localStorage.getItem("airhand-cursor-calibration") || "null");
    if (saved && Number.isFinite(saved.minX) && Number.isFinite(saved.maxX) &&
        Number.isFinite(saved.minY) && Number.isFinite(saved.maxY) &&
        saved.maxX - saved.minX > 0.12 && saved.maxY - saved.minY > 0.12) {
      return { ...saved, calibrated: true };
    }
  } catch { /* storage can be unavailable in private mode */ }
  return { ...DEFAULT_CURSOR_CALIBRATION };
}
let cursorCalibration = loadCursorCalibration();
const savedPreferences = readPreferences();
if (savedPreferences) {
  cursorSensitivity = savedPreferences.cursorSensitivity;
  cursorFilter.alpha = cursorSensitivity;
  mirrorCamera = savedPreferences.mirrorCamera;
  showLandmarks = savedPreferences.showLandmarks;
  dwellEnabled = savedPreferences.dwellEnabled;
  dwellDurationMs = savedPreferences.dwellDurationMs;
  soundEnabled = savedPreferences.soundEnabled;
}
let calibrationRun = null;
let calibrationFeedbackUntil = 0;
let calibrationFeedbackText = "";
let lastStarMilestone = 0;
let audioContext = null;
const SUPPORTED_MODEL_GESTURES = new Set(["Pointing_Up", "Victory", "Thumb_Up", "Open_Palm", "Closed_Fist"]);
const labels = {
  None: "No hand detected", Unclear: "Adjust your hand", Pinch: "Pinch",
  ThumbsUp: "Thumbs-up", Peace: "Peace sign", Point: "Pointing",
  OpenPalm: "Open palm", Fist: "Fist"
};
const game = {
  playing: false, paused: false, score: 0, best: readBestScore(),
  speed: 250, playerY: 0, velocityY: 0, obstacles: [], spawnIn: 0, ground: 0, stars: [], starSpawnIn: 1.3, combo: 0, comboTimer: 0, collected: 0, popups: [], difficulty: "normal"
};
let toastTimeout = null;

function readBestScore() {
  try { return Number(localStorage.getItem("airhand-best") || 0); } catch { return 0; }
}
function showCalibrationFeedback(message, now = performance.now()) {
  calibrationFeedbackText = message;
  calibrationFeedbackUntil = now + 2600;
  $("gestureConfidence").textContent = message;
}
function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 2400);
}
function setReady(title, message) {
  $("readyTitle").textContent = title;
  $("readyText").textContent = message;
}
function updateCameraUI(active) {
  cameraActive = active;
  $("status").textContent = active ? "Camera on" : "Camera off";
  $("stage").classList.toggle("on", active);
  $("placeholder").classList.toggle("hidden", active);
  $("action").disabled = false;
  $("stopCamera").disabled = !active;
  $("calibrate").disabled = !active;
  $("action").textContent = active
    ? (currentMode === "cursor" ? "Re-center cursor →" : "Restart runner →")
    : "Enable camera →";
  $("start").textContent = active ? "◉ Camera enabled" : "◉  Enable camera";
  if ($("stopCamera")) $("stopCamera").disabled = !active;
  if ($("calibrate")) $("calibrate").disabled = !active;
  if (active) {
    $("start").disabled = false;
    setReady("Hand tracking is live", "Move your hand inside the camera frame.");
  } else {
    setReady("Waiting for camera", "Enable camera access to begin.");
  }
}

async function startCamera() {
  if (cameraActive) return;
  geometryOnlyFallback = false;
  $("start").disabled = true;
  $("start2").disabled = true;
  $("action").disabled = true;
  setReady("Starting camera…", "Allow camera access if the browser asks.");
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access requires HTTPS or localhost in a supported browser.");
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 60 } }
    });
    video.srcObject = mediaStream;
    await video.play();
    fitCameraFrameToVideo();
    if (!video.videoWidth) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Camera started but did not provide video dimensions. Try switching cameras or reloading.")), 8000);
        video.addEventListener("loadedmetadata", () => { clearTimeout(timeout); resolve(); }, { once: true });
      });
      fitCameraFrameToVideo();
    }

    // Load MediaPipe only after the UI has already initialized and the user starts the camera.
    // A CDN outage must not prevent navigation and non-camera controls from working.
    if (!FilesetResolver) {
      const mediaPipeModule = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/vision_bundle.mjs");
      FilesetResolver = mediaPipeModule.FilesetResolver;
      GestureRecognizer = mediaPipeModule.GestureRecognizer;
      HandLandmarker = mediaPipeModule.HandLandmarker;
    }
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm"
    );
    const modelOptions = {
      runningMode: "VIDEO", numHands: 1,
      minHandDetectionConfidence: 0.62,
      minHandPresenceConfidence: 0.60,
      minTrackingConfidence: 0.60
    };
    try {
      gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
        ...modelOptions,
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
          delegate: "GPU"
        }
      });
    } catch (gpuError) {
      console.warn("Gesture model GPU initialization failed; trying CPU.", gpuError);
      try {
        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
          ...modelOptions,
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "CPU"
          }
        });
      } catch (modelError) {
        console.warn("Gesture model unavailable; falling back to landmark geometry.", modelError);
        const handModel = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
        try {
          gestureRecognizer = await HandLandmarker.createFromOptions(vision, {
            ...modelOptions,
            baseOptions: { modelAssetPath: handModel, delegate: "GPU" }
          });
        } catch (fallbackGpuError) {
          console.warn("Landmark GPU initialization failed; trying CPU.", fallbackGpuError);
          gestureRecognizer = await HandLandmarker.createFromOptions(vision, {
            ...modelOptions,
            baseOptions: { modelAssetPath: handModel, delegate: "CPU" }
          });
        }
        geometryOnlyFallback = true;
      }
    }

    stabilizer.reset();
    lastStableGesture = "None";
    stablePinch = false;
    lastVideoTime = -1;
    fpsFrames = 0;
    fpsWindowStart = performance.now();
    resizeCanvases();
    updateCameraUI(true);
    trackingFrame = requestAnimationFrame(trackFrame);
    if (geometryOnlyFallback) {
      setReady("Fallback tracking is live", "Gesture model unavailable; geometric detection is active.");
      showToast("Using landmark-based gesture fallback.");
    } else {
      showToast("Camera ready — show your hand.");
    }
  } catch (error) {
    console.error("AirHand camera startup failed:", error);
    stopMediaTracks();
    if (gestureRecognizer) { gestureRecognizer.close(); gestureRecognizer = null; }
    geometryOnlyFallback = false;
    video.srcObject = null;
    cameraStage.style.aspectRatio = "";
    cameraStage.classList.remove("portrait-feed");
    updateCameraUI(false);
    setReady("Camera couldn't start", error?.message || "Check camera permission, then try again.");
    showToast(error?.message || "Unable to start the camera.");
  } finally {
    $("start").disabled = false;
    $("start2").disabled = false;
    $("action").disabled = false;
  }
}

function stopMediaTracks() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
}
function stopCamera() {
  cancelVirtualDrag("Camera stopped");
  resetDwellProgress();
  cameraActive = false;
  cancelAnimationFrame(trackingFrame);
  // Keep the runner alive: it also supports keyboard and pointer controls without a camera.
  stopMediaTracks();
  if (gestureRecognizer) { gestureRecognizer.close(); gestureRecognizer = null; }
  geometryOnlyFallback = false;
  video.srcObject = null;
  trackingContext.clearRect(0, 0, trackingCanvas.width, trackingCanvas.height);
  stabilizer.reset();
  lastHandSeenAt = 0;
  lastHandLandmarks = null;
  calibrationRun = null;
  $("calibrate").disabled = true;
  $("calibrate").textContent = cursorCalibration.calibrated ? "Recalibrate" : "Calibrate cursor";
  lastStableGesture = "None";
  stablePinch = false;
  $("gesture").textContent = "Waiting for hand";
  updateCameraUI(false);
}
function fitCameraFrameToVideo() {
  if (!video.videoWidth || !video.videoHeight) return;
  // Match the preview container to the actual camera aspect ratio so no fingers are cropped.
  cameraStage.style.aspectRatio = video.videoWidth + " / " + video.videoHeight;
  cameraStage.classList.toggle("portrait-feed", video.videoHeight > video.videoWidth);
  resizeCanvases();
}
function resizeCanvases() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const trackRect = cameraStage.getBoundingClientRect();
  trackingCanvas.width = Math.max(1, Math.round(trackRect.width * ratio));
  trackingCanvas.height = Math.max(1, Math.round(trackRect.height * ratio));
  trackingContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  const gameRect = gameCanvas.getBoundingClientRect();
  if (gameRect.width > 0 && gameRect.height > 0) {
    gameCanvas.width = Math.max(1, Math.round(gameRect.width * ratio));
    gameCanvas.height = Math.max(1, Math.round(gameRect.height * ratio));
    gameContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  renderGame();
}
function landmarkPoint(landmark, width, height) {
  return { x: (mirrorCamera ? 1 - landmark.x : landmark.x) * width, y: landmark.y * height };
}
const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]
];
function drawLandmarks(landmarks, width, height) {
  if (!showLandmarks) return;
  trackingContext.lineWidth = 2;
  trackingContext.strokeStyle = "#77a9ff";
  for (const [a, b] of CONNECTIONS) {
    const first = landmarkPoint(landmarks[a], width, height);
    const second = landmarkPoint(landmarks[b], width, height);
    trackingContext.beginPath();
    trackingContext.moveTo(first.x, first.y);
    trackingContext.lineTo(second.x, second.y);
    trackingContext.stroke();
  }
  landmarks.forEach((landmark, index) => {
    const p = landmarkPoint(landmark, width, height);
    trackingContext.beginPath();
    trackingContext.arc(p.x, p.y, index === 8 ? 5 : 2.6, 0, Math.PI * 2);
    trackingContext.fillStyle = index === 8 ? "#3778f6" : "#fff";
    trackingContext.fill();
    trackingContext.lineWidth = 1.3;
    trackingContext.strokeStyle = "#3778f6";
    trackingContext.stroke();
  });
}
function trackFrame(now) {
  if (!cameraActive || !gestureRecognizer) return;
  trackingFrame = requestAnimationFrame(trackFrame);
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  let result;
  try {
    result = geometryOnlyFallback
      ? gestureRecognizer.detectForVideo(video, now)
      : gestureRecognizer.recognizeForVideo(video, now);
  } catch (error) {
    console.warn("Skipping a frame after inference error:", error);
    return;
  }
  const width = cameraStage.clientWidth;
  const height = cameraStage.clientHeight;
  trackingContext.clearRect(0, 0, width, height);

  if (result.landmarks?.length) {
    const landmarks = result.landmarks[0];
    lastHandSeenAt = now;
    lastHandLandmarks = landmarks;
    const wasCalibrating = !!calibrationRun;
    if (wasCalibrating) collectCalibrationSample(landmarks[8], now);
    drawLandmarks(landmarks, width, height);
    const category = geometryOnlyFallback ? null : selectBestModelGesture(result.gestures?.[0] || []);
    const raw = detectGesture(landmarks, stablePinch, category?.categoryName || null, category?.score || 0);
    if (!wasCalibrating) {
      if (now < calibrationFeedbackUntil) {
        $("gestureConfidence").textContent = calibrationFeedbackText;
      } else {
        const frameGuidance = getHandFrameGuidance(landmarks);
        $("gestureConfidence").textContent = frameGuidance || (raw.source === "model"
          ? "Model confidence " + Math.round((raw.confidence || 0) * 100) + "%"
          : raw.gesture === "Pinch" ? "Pinch distance normalized to palm size" : "Landmark geometry fallback");
      }
    }
    const stable = stabilizer.update(raw.gesture, now);
    const stability = stabilizer.getStatus(now);
    $("gesture").textContent = labels[stable] || labels.Unclear;
    if (!wasCalibrating && now >= calibrationFeedbackUntil) {
      const confidence = raw.source === "model" || raw.gesture === "Pinch"
        ? Math.round((raw.confidence ?? 0.7) * 100) + "% confidence"
        : "landmark match";
      $("gestureConfidence").textContent = (stability.stable ? "Stable" : "Stabilizing") +
        " · " + confidence + " · " + (stability.durationMs / 1000).toFixed(1) + "s";
    }
    updateCursor(landmarks[8]);
    if (stable !== lastStableGesture) {
      if (!wasCalibrating) handleStableGesture(stable, lastStableGesture, now, landmarks, raw.source);
      lastStableGesture = stable;
    }
  } else {
    // Brief model dropouts are common during fast movement. Preserve the last
    // state briefly, but never indefinitely; after the grace window release actions.
    const lossAge = lastHandSeenAt ? now - lastHandSeenAt : Infinity;
    if (lastHandLandmarks && lossAge <= TRACKING_LOSS_GRACE_MS) {
      if (!calibrationRun) updateCursor(lastHandLandmarks[8]);
      $("gesture").textContent = "Tracking paused";
      if (now >= calibrationFeedbackUntil) {
        $("gestureConfidence").textContent = "Reacquiring hand · " +
          Math.max(0, TRACKING_LOSS_GRACE_MS - lossAge).toFixed(0) + "ms grace";
      }
      return;
    }
    lastHandLandmarks = null;
    stabilizer.reset();
    stablePinch = false;
    if (lastStableGesture !== "None") {
      handleStableGesture("None", lastStableGesture, now, null);
      lastStableGesture = "None";
    }
    $("gesture").textContent = "No hand detected";
    if (calibrationRun) {
      const remaining = Math.max(0, 5 - (now - calibrationRun.startedAt) / 1000);
      if (remaining > 0) {
        $("gestureConfidence").textContent = "Calibration waiting for hand · " + remaining.toFixed(1) + "s";
      } else {
        calibrationRun = null;
        $("calibrate").disabled = false;
        $("calibrate").textContent = cursorCalibration.calibrated ? "Recalibrate" : "Calibrate cursor";
        showCalibrationFeedback("No hand captured — show your index finger and try again", now);
        showToast("Calibration stopped because no hand was detected.");
      }
    } else if (now < calibrationFeedbackUntil) {
      $("gestureConfidence").textContent = calibrationFeedbackText;
    } else {
      $("gestureConfidence").textContent = "Keep your hand in view";
    }
  }

  fpsFrames++;
  if (now - fpsWindowStart >= 1000) {
    $("fps").textContent = String(Math.round(fpsFrames * 1000 / (now - fpsWindowStart)));
    fpsFrames = 0;
    fpsWindowStart = now;
  }
}
function getHandFrameGuidance(landmarks) {
  const xs = landmarks.map(point => point.x);
  const ys = landmarks.map(point => point.y);
  const left = Math.min(...xs), right = Math.max(...xs);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  if (left < 0.055 || right > 0.945 || top < 0.055 || bottom > 0.945) {
    return "Hand near frame edge — move it back toward the center";
  }
  const spanX = right - left, spanY = bottom - top;
  if (spanX > 0.78 || spanY > 0.82) return "Hand too close — move it a little farther away";
  if (spanX < 0.16 && spanY < 0.2) return "Hand is small — move it a little closer";
  return "";
}
function selectBestModelGesture(categories) {
  return categories
    .filter(category => SUPPORTED_MODEL_GESTURES.has(category.categoryName))
    .sort((a, b) => b.score - a.score)[0] || null;
}
function startCursorCalibration() {
  if (!cameraActive) { showToast("Enable the camera first."); return; }
  calibrationFeedbackUntil = 0;
  calibrationFeedbackText = "";
  calibrationRun = { startedAt: performance.now(), minX: 1, maxX: 0, minY: 1, maxY: 0, frames: 0, step: -1 };
  cursorFilter.reset(0.5, 0.5);
  $("calibrate").disabled = true;
  $("calibrate").textContent = "Calibrating…";
  setCalibrationTarget(0);
  $("gestureConfidence").textContent = "Follow the target: top-left, top-right, bottom-right, bottom-left";
  showToast("Guided calibration started — follow the blue target with your cursor.");
}
function setCalibrationTarget(step) {
  const target = $("calibrationTarget");
  const positions = [
    { left: "8%", top: "12%", label: "TOP LEFT" },
    { left: "92%", top: "12%", label: "TOP RIGHT" },
    { left: "92%", top: "88%", label: "BOTTOM RIGHT" },
    { left: "8%", top: "88%", label: "BOTTOM LEFT" }
  ];
  const position = positions[Math.max(0, Math.min(3, step))];
  target.style.left = position.left; target.style.top = position.top;
  target.title = position.label; target.dataset.target = position.label;
  target.classList.remove("hidden");
}
function collectCalibrationSample(indexTip, now) {
  if (!calibrationRun) return false;
  const x = mirrorCamera ? 1 - indexTip.x : indexTip.x;
  calibrationRun.minX = Math.min(calibrationRun.minX, x);
  calibrationRun.maxX = Math.max(calibrationRun.maxX, x);
  calibrationRun.minY = Math.min(calibrationRun.minY, indexTip.y);
  calibrationRun.maxY = Math.max(calibrationRun.maxY, indexTip.y);
  calibrationRun.frames++;
  const elapsed = now - calibrationRun.startedAt;
  const step = Math.min(3, Math.floor(elapsed / 1250));
  if (step !== calibrationRun.step) { calibrationRun.step = step; setCalibrationTarget(step); }
  const remaining = Math.max(0, 5 - elapsed / 1000);
  const steps = ["top-left", "top-right", "bottom-right", "bottom-left"];
  $("gestureConfidence").textContent = "Guided calibration · " + steps[step] + " · " + remaining.toFixed(1) + "s";
  if (remaining > 0) return true;

  const run = calibrationRun;
  $("calibrationTarget").classList.add("hidden");
  calibrationRun = null;
  const spanX = run.maxX - run.minX;
  const spanY = run.maxY - run.minY;
  if (run.frames < 20 || spanX < 0.16 || spanY < 0.18) {
    $("calibrate").disabled = false;
    $("calibrate").textContent = "Calibrate cursor";
    showCalibrationFeedback("Not enough movement captured — try a wider, slower sweep", now);
    showToast("Calibration needs a wider range. Try again and move in all directions.");
    return false;
  }
  const padX = Math.max(0.025, spanX * 0.12);
  const padY = Math.max(0.025, spanY * 0.12);
  cursorCalibration = {
    minX: clamp(run.minX - padX, 0, 0.9),
    maxX: clamp(run.maxX + padX, 0.1, 1),
    minY: clamp(run.minY - padY, 0, 0.9),
    maxY: clamp(run.maxY + padY, 0.1, 1),
    calibrated: true
  };
  try { localStorage.setItem("airhand-cursor-calibration", JSON.stringify(cursorCalibration)); } catch { /* optional preference */ }
  cursorFilter.reset(0.5, 0.5);
  $("calibrate").disabled = false;
  $("calibrate").textContent = "Recalibrate";
  showCalibrationFeedback("Cursor calibrated to your range", now);
  showToast("Cursor calibrated! Your movement range is saved on this device.");
  playTone(740, 0.09);
  return false;
}
function mapCalibratedRange(value, min, max) {
  return clamp((value - min) / Math.max(0.001, max - min), 0, 1);
}
function updateCursor(indexTip, now = performance.now()) {
  const targetX = mirrorCamera ? 1 - indexTip.x : indexTip.x;
  const mappedX = mapCalibratedRange(targetX, cursorCalibration.minX, cursorCalibration.maxX);
  const mappedY = mapCalibratedRange(indexTip.y, cursorCalibration.minY, cursorCalibration.maxY);
  const point = cursorFilter.update(mappedX, mappedY);
  $("cursor").style.left = (clamp(point.x, 0.01, 0.99) * 100) + "%";
  $("cursor").style.top = (clamp(point.y, 0.05, 0.95) * 100) + "%";
  $("cursor").style.opacity = currentMode === "cursor" ? "1" : ".28";
  document.querySelectorAll(".mini").forEach(tile => tile.classList.remove("hovered"));
  if (currentMode === "cursor") {
    const rect = document.querySelector(".cards").getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + clamp(point.x, 0.01, 0.99) * rect.width, rect.top + clamp(point.y, 0.05, 0.95) * rect.height)?.closest(".mini");
    if (target) target.classList.add("hovered");
    document.querySelectorAll(".mini.drop-target").forEach(tile => tile.classList.remove("drop-target"));
    if (dragSource && target && target !== dragSource) target.classList.add("drop-target");
    updateDwellTarget(target, now);
  }
}
function getVirtualTargetAtCursor() {
  const rect = document.querySelector(".cards").getBoundingClientRect();
  return document.elementFromPoint(rect.left + clamp(cursorFilter.x, 0.01, 0.99) * rect.width, rect.top + clamp(cursorFilter.y, 0.05, 0.95) * rect.height)?.closest(".mini") || null;
}
function selectVirtualTarget(target, action = "selected") {
  if (!target) return;
  document.querySelectorAll(".mini").forEach(tile => tile.classList.remove("selected"));
  target.classList.add("selected");
  const names = { explore: "Explore", create: "Create", discover: "Discover" };
  showToast((names[target.dataset.tile] || "Tile") + (action === "selected" ? " selected" : " · " + action));
}
function resetDwellProgress() {
  dwellCandidate = null; dwellStartedAt = 0; dwellTriggeredTarget = null;
  const progress = $("dwellProgress");
  if (progress) { progress.classList.remove("active"); progress.querySelector("span").style.width = "0%"; }
}
function updateDwellTarget(target, now = performance.now()) {
  const progress = $("dwellProgress"), fill = progress.querySelector("span");
  if (!dwellEnabled || interactionsLocked || stablePinch || calibrationRun || !target) {
    resetDwellProgress(); return;
  }
  if (target !== dwellCandidate) { dwellCandidate = target; dwellStartedAt = now; dwellTriggeredTarget = null; }
  const ratio = clamp((now - dwellStartedAt) / dwellDurationMs, 0, 1);
  progress.classList.add("active"); fill.style.width = (ratio * 100) + "%";
  if (ratio >= 1 && dwellTriggeredTarget !== target) {
    dwellTriggeredTarget = target; selectVirtualTarget(target, "Dwell click");
    $("interactionLockStatus").textContent = "Dwell selection · " + (target.dataset.tile || "tile");
    playTone(640, 0.055);
  }
}
function beginVirtualDrag() {
  if (currentMode !== "cursor" || interactionsLocked) {
    if (interactionsLocked) { $("interactionLockStatus").textContent = "Interactions locked · unlock to use pinch or dwell"; showToast("Interactions are locked."); }
    return;
  }
  const target = getVirtualTargetAtCursor();
  if (!target) { dragSource = null; $("interactionLockStatus").textContent = "No tile under cursor · move over a tile first"; showToast("Move over a tile before pinching to drag."); return; }
  dragSource = target; dragSource.classList.add("dragging", "selected");
  resetDwellProgress();
  $("interactionLockStatus").textContent = "Dragging " + (target.dataset.tile || "tile") + " · release over a tile";
  $("gestureConfidence").textContent = "Dragging · release pinch over another tile to drop";
}
function cancelVirtualDrag(reason = "Drag cancelled") {
  if (!dragSource) return;
  dragSource.classList.remove("dragging", "drop-target");
  dragSource.classList.remove("selected"); dragSource = null;
  document.querySelectorAll(".mini.drop-target").forEach(tile => tile.classList.remove("drop-target"));
  $("interactionLockStatus").textContent = reason + " · no tile moved";
}
function finishVirtualDrag() {
  if (!dragSource) { const target = getVirtualTargetAtCursor(); if (target && currentMode === "cursor" && !interactionsLocked) selectVirtualTarget(target); return; }
  const source = dragSource, target = getVirtualTargetAtCursor();
  source.classList.remove("dragging"); dragSource = null;
  document.querySelectorAll(".mini.drop-target").forEach(tile => tile.classList.remove("drop-target"));
  if (interactionsLocked) { source.classList.remove("selected"); $("interactionLockStatus").textContent = "Interactions locked · drag cancelled"; showToast("Drag cancelled because interactions are locked."); return; }
  if (target && target !== source) {
    const tiles = [...document.querySelectorAll(".mini")], a = tiles.indexOf(source), b = tiles.indexOf(target);
    if (a < b) target.after(source); else target.before(source);
    selectVirtualTarget(source, "dropped"); $("interactionLockStatus").textContent = "Drop complete · " + (source.dataset.tile || "tile"); showToast("Tile moved into position.");
  } else if (target === source) { selectVirtualTarget(source); $("interactionLockStatus").textContent = "Drag ended · tile unchanged"; }
  else { source.classList.remove("selected"); $("interactionLockStatus").textContent = "Drop cancelled · release over a tile"; showToast("Drag cancelled — release over a tile to drop."); }
}
function handleStableGesture(gesture, previous, now, landmarks = null, source = null) {
  const reliableDiscreteGesture = geometryOnlyFallback || source === "model";
  if (reliableDiscreteGesture && gesture === "Peace" && previous !== "Peace" && now - lastPeaceSwitch > 950) {
    lastPeaceSwitch = now;
    switchMode(currentMode === "cursor" ? "game" : "cursor");
    showToast(currentMode === "game" ? "Hand Runner selected" : "Air Cursor selected");
  }
  if (gesture === "Pinch" && previous !== "Pinch") {
    stablePinch = true;
    if (currentMode === "cursor") beginVirtualDrag();
    else if (currentMode === "game" && !game.playing) startGame();
    else if (game.playing && !game.paused) jump();
  } else if (previous === "Pinch") {
    stablePinch = false;
    finishVirtualDrag();
  }

  if (currentMode === "game") {
    if (reliableDiscreteGesture && gesture === "OpenPalm" && !game.playing) startGame();
    else if (reliableDiscreteGesture && gesture === "OpenPalm" && game.paused) resumeGame();
    if (reliableDiscreteGesture && gesture === "ThumbsUp" && previous !== "ThumbsUp" &&
      now - lastThumbToggle > 900 && game.playing) {
      lastThumbToggle = now;
      if (game.paused) resumeGame();
      else pauseGame();
    }
  }
}
function activateVirtualTarget() {
  const virtualDesktop = document.querySelector(".cards");
  const rect = virtualDesktop.getBoundingClientRect();
  const x = rect.left + cursorFilter.x * rect.width;
  const y = rect.top + cursorFilter.y * rect.height;
  const target = document.elementFromPoint(x, y)?.closest(".mini");
  if (!target) {
    showToast("Pinch detected — move over a tile to select it.");
    return;
  }
  document.querySelectorAll(".mini").forEach(tile => tile.classList.remove("selected"));
  target.classList.add("selected");
  const index = [...document.querySelectorAll(".mini")].indexOf(target);
  showToast(["Explore", "Create", "Discover"][index] + " selected");
}

function switchMode(mode) {
  if (currentMode !== mode) cancelVirtualDrag("Mode changed");
  resetDwellProgress();
  currentMode = mode;
  document.querySelectorAll(".tab").forEach(button => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  $("cursorView").classList.toggle("hidden", mode !== "cursor");
  $("gameView").classList.toggle("hidden", mode !== "game");
  $("modeTitle").textContent = mode === "cursor" ? "Air Cursor" : "Hand Runner";
  $("cursor").style.opacity = mode === "cursor" ? "1" : ".28";
  $("action").textContent = cameraActive ? (mode === "cursor" ? "Re-center cursor →" : "Restart runner →") : "Enable camera →";
  if (mode === "cursor") {
    if (game.playing) pauseGame(false);
  } else {
    game.playing = false;
    game.paused = false;
    showGameOverlay("Ready, set, jump.", "Show an open palm to start. Pinch to jump over obstacles.", "Play runner");
    resizeCanvases();
  }
}
function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
}
function renderGame() {
  const width = gameCanvas.clientWidth;
  const height = gameCanvas.clientHeight;
  if (!width || !height) return;
  game.ground = height - 32;
  gameContext.clearRect(0, 0, width, height);
  const sky = gameContext.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#edf4ff");
  sky.addColorStop(1, "#fbfcff");
  gameContext.fillStyle = sky;
  gameContext.fillRect(0, 0, width, height);
  gameContext.fillStyle = "#e0eafd";
  gameContext.beginPath();
  gameContext.ellipse(width * .72, height * .92, width * .48, height * .23, 0, Math.PI, Math.PI * 2);
  gameContext.fill();
  gameContext.strokeStyle = "#cfdef4";
  gameContext.lineWidth = 1;
  gameContext.beginPath();
  gameContext.moveTo(0, game.ground);
  gameContext.lineTo(width, game.ground);
  gameContext.stroke();

  for (let i = 0; i < 7; i++) {
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
document.querySelector(".gamebox").addEventListener("pointerdown", event => {
  // The overlay covers the canvas after a run ends; allow tapping its background to restart.
  if (event.target.closest("#play") || currentMode !== "game") return;
  if (!game.playing) startGame();
  else if (!game.paused) jump();
});
window.addEventListener("keydown", event => {
  if (event.repeat || event.target?.matches?.("button, input, select, textarea")) return;
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
window.addEventListener("resize", resizeCanvases);
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
window.__AIRHAND_READY__ = true;
