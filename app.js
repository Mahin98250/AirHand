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
let SteeringController = null;
let driveSteering = null;
let driveKeyboardSteer = null;
let gestureRecognizer = null;
let geometryOnlyFallback = false;
let mediaStream = null;
let cameraActive = false;
let trackingFrame = 0;
let gameFrameRequest = 0;
let driveFrameRequest = 0;
let lastVideoTime = -1;
let lastHandSeenAt = 0;
let lastHandLandmarks = null;
const TRACKING_LOSS_GRACE_MS = 180;
const INFERENCE_ERROR_GRACE_MS = 180;
let inferenceErrorSince = 0;
let fpsFrames = 0;
let fpsWindowStart = 0;
let currentMode = "cursor";
const drive = { playing: false, paused: false, crashed: false, score: 0, best: 0, speed: 0, steer: 0, roadOffset: 0, spawnIn: 0.8, traffic: [], lastFrame: 0, lane: 0, braking: false, throttle: false, cruise: true, boosting: false, nitro: 100, damage: 0, nearMisses: 0, combo: 0, shake: 0, scene: "sunset", carColor: "#28bfea", sound: false, audioContext: null, engineOsc: null, engineFilter: null, engineGain: null };
try { drive.best = Math.max(0, Number(localStorage.getItem("airhand-drive-best")) || 0); } catch { /* storage is optional */ }
let drive3dEnabled = true;
let drive3dLoading = false;
let drive3dInstance = null;
let driveGestureThrottle = false;
let driveGestureBrake = false;
let driveGestureBoost = false;
let driveCanvas = null;
let driveContext = null;
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
function describeCameraError(error) {
  const name = error?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") return "Camera permission was blocked. Allow camera access in browser or site settings, then try again.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No camera was found. Connect or enable a camera, then try again.";
  if (name === "NotReadableError" || name === "TrackStartError") return "The camera is busy or unavailable. Close other apps using it, then try again.";
  if (name === "OverconstrainedError") return "This camera cannot meet the requested video settings. Try another camera or browser.";
  if (name === "AbortError") return "Camera startup was interrupted. Try enabling the camera again.";
  return error?.message || "Camera could not start. Check permissions and try again.";
}

function handleCameraTrackEnded() {
  if (!cameraActive) return;
  stopCamera();
  setReady("Camera connection lost", "The camera stopped unexpectedly. Check browser permission or reconnect it, then enable the camera again.");
  showToast("Camera disconnected — reconnect and try again.");
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
    if (!SteeringController) {
      const steeringModule = await import("./steering-engine.js");
      SteeringController = steeringModule.SteeringController;
      driveSteering = new SteeringController({ maxTurnRadians: 0.48, smoothing: 0.42, inverted: false });
    }
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
      runningMode: "VIDEO", numHands: 2,
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
    inferenceErrorSince = 0;
    lastVideoTime = -1;
    fpsFrames = 0;
    fpsWindowStart = performance.now();
    resizeCanvases();
    updateCameraUI(true);
    mediaStream?.getVideoTracks().forEach(track => track.addEventListener("ended", handleCameraTrackEnded, { once: true }));
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
    setReady("Camera couldn't start", describeCameraError(error));
    showToast(describeCameraError(error));
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
  inferenceErrorSince = 0;
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
    inferenceErrorSince = 0;
  } catch (error) {
    console.warn("Skipping a frame after inference error:", error);
    if (!inferenceErrorSince) inferenceErrorSince = now;
    if (now - inferenceErrorSince >= INFERENCE_ERROR_GRACE_MS) {
      // A broken inference loop must not leave a pinch/drag latched forever.
      // Tracking failure is not an intentional release, so cancel instead of dropping at stale coordinates.
      lastHandLandmarks = null;
      stabilizer.reset();
      stablePinch = false;
      if (lastStableGesture !== "None") {
        cancelVirtualDrag("Tracking interrupted");
        resetDwellProgress();
        lastStableGesture = "None";
      }
      $("gesture").textContent = "Tracking interrupted";
      $("gestureConfidence").textContent = "Hand inference failed · retrying";
    }
    return;
  }
  const width = cameraStage.clientWidth;
  const height = cameraStage.clientHeight;
  trackingContext.clearRect(0, 0, width, height);

  if (result.landmarks?.length) {
    const landmarks = result.landmarks[0];
    driveLatestHands = result.landmarks;
    if (currentMode === "drive") {
      const hands = result.landmarks;
      driveLatestHands = hands;
      if (hands.length >= 2) {
        const steering = driveSteering.update(hands[0], hands[1], now);
        if (driveKeyboardSteer === null) drive.steer = steering.value;
        $("driveGuidance").textContent = steering.detected
          ? "Two hands locked · steering confidence " + Math.round(steering.confidence * 100) + "%"
          : "Keep both hands apart and inside the frame";
      } else {
        const steering = driveSteering.update(null, null, now);
        drive.steer = steering.value;
        $("driveGuidance").textContent = "Need two hands · keep both hands visible";
      }
      updateDriveGestureControls(hands, result.gestures);
      syncDrive3DControls();
      renderDrive();
    }
    lastHandSeenAt = now;
    lastHandLandmarks = landmarks;
    const wasCalibrating = !!calibrationRun;
    if (wasCalibrating) collectCalibrationSample(landmarks[8], now);
    if (currentMode === "drive" && result.landmarks.length > 1) {
      result.landmarks.forEach(hand => drawLandmarks(hand, width, height));
    } else drawLandmarks(landmarks, width, height);
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
    if (currentMode === "drive") {
      driveLatestHands = null;
      const steering = driveSteering?.update(null, null, now);
      if (steering) drive.steer = steering.value;
      $("driveGuidance").textContent = "Need two hands · keep both hands visible";
      updateDriveGestureControls(null, null);
    }
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
      // Losing the hand is not a deliberate pinch release: never commit a drop
      // using the last cursor position. Cancel the interaction and require reacquisition.
      cancelVirtualDrag("Tracking lost");
      resetDwellProgress();
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
  if (currentMode !== "drive" && reliableDiscreteGesture && gesture === "Peace" && previous !== "Peace" && now - lastPeaceSwitch > 950) {
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
  if (currentMode === "drive" && mode !== "drive") {
    saveDriveBest();
    if (drive3dInstance) drive3dInstance.pause();
    driveGestureThrottle = false; driveGestureBrake = false; driveGestureBoost = false;
    drive.playing = false;
    drive.paused = false;
    if (driveFrameRequest) cancelAnimationFrame(driveFrameRequest);
    driveFrameRequest = 0;
    updateDriveAudio();
  }
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
  $("driveView").classList.toggle("hidden", mode !== "drive");
  $("modeTitle").textContent = mode === "cursor" ? "Air Cursor" : mode === "game" ? "Hand Runner" : "Air Drive";
  $("cursor").style.opacity = mode === "cursor" ? "1" : ".28";
  $("action").textContent = cameraActive ? (mode === "cursor" ? "Re-center cursor →" : mode === "game" ? "Restart runner →" : "Start / restart drive →") : "Enable camera →";
  if (mode === "cursor") {
    if (game.playing) pauseGame(false);
  } else if (mode === "game") {
    game.playing = false;
    game.paused = false;
    drive.playing = false;
    showGameOverlay("Ready, set, jump.", "Show an open palm to start. Pinch to jump over obstacles.", "Play runner");
    resizeCanvases();
  } else {
    game.playing = false;
    game.paused = false;
    drive.playing = false;
    if (driveSteering) driveSteering.reset();
    drive.steer = 0;
    $("drivePause").textContent = "Ⅱ Pause";
    $("driveTitle").textContent = "Ready to drive?";
    $("driveText").textContent = "Choose a scene, then start the engine. Cruise control is on by default; you can switch to manual throttle.";
    $("drivePlay").textContent = "Start engine";
    $("driveOverlay").classList.remove("hidden");
    updateDriveAudio();
    fitDriveCanvas();
    renderDrive();
  }
}
function fitDriveCanvas() {
  driveCanvas = $("driveCanvas");
  if (!driveCanvas) return;
  driveContext = driveCanvas.getContext("2d");
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = driveCanvas.clientWidth || 800;
  const height = Math.round(width / 1.55);
  if (driveCanvas.width !== Math.round(width * ratio) || driveCanvas.height !== Math.round(height * ratio)) {
    driveCanvas.width = Math.round(width * ratio);
    driveCanvas.height = Math.round(height * ratio);
  }
  driveContext.setTransform(ratio, 0, 0, ratio, 0, 0);
}
function driveRoadGeometry(width, height, y) {
  const horizon = height * 0.29;
  const t = clamp((y - horizon) / (height - horizon), 0, 1);
  const half = 18 + t * width * 0.455;
  // A slow, continuous bend makes the road feel like a track instead of a vibrating ribbon.
  const curve = Math.sin(drive.roadOffset * 0.012 + t * 2.55) * width * 0.085 * t;
  // Small camera follow only: do not cancel the player's actual lane position.
  const cameraFollow = drive.lane * width * 0.025 * t;
  return { t, center: width * 0.5 + curve - cameraFollow, half, y };
}
function drawDriveCar(ctx, x, y, scale, color = "#43d8ff", steering = 0, player = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(clamp(steering, -1, 1) * 0.045);
  ctx.scale(scale, scale);
  // Soft ground shadow.
  ctx.fillStyle = "#06101bcc";
  ctx.beginPath(); ctx.ellipse(0, 25, 31, 9, 0, 0, Math.PI * 2); ctx.fill();
  // Rear tyres and wheel wells.
  ctx.fillStyle = "#080d13";
  roundRect(ctx, -31, -5, 9, 25, 3);
  roundRect(ctx, 22, -5, 9, 25, 3);
  ctx.fillStyle = "#536274";
  ctx.fillRect(-29, 2, 5, 10); ctx.fillRect(24, 2, 5, 10);
  // Low, wide body silhouette.
  ctx.fillStyle = "#101c2a";
  ctx.beginPath();
  ctx.moveTo(-27, 17); ctx.lineTo(-30, 2); ctx.lineTo(-25, -17);
  ctx.quadraticCurveTo(-22, -28, -13, -31); ctx.lineTo(13, -31);
  ctx.quadraticCurveTo(23, -27, 26, -17); ctx.lineTo(30, 2);
  ctx.lineTo(27, 17); ctx.quadraticCurveTo(0, 25, -27, 17); ctx.closePath(); ctx.fill();
  const body = ctx.createLinearGradient(-29, -20, 29, 14);
  body.addColorStop(0, player ? "#a6f4ff" : "#fff0e3");
  body.addColorStop(0.12, color);
  body.addColorStop(0.55, color);
  body.addColorStop(1, "#15283d");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-25, 12); ctx.lineTo(-25, -3); ctx.lineTo(-20, -18);
  ctx.quadraticCurveTo(-17, -25, -10, -27); ctx.lineTo(10, -27);
  ctx.quadraticCurveTo(17, -25, 20, -18); ctx.lineTo(25, -3);
  ctx.lineTo(25, 12); ctx.quadraticCurveTo(0, 21, -25, 12); ctx.closePath(); ctx.fill();
  // Rear window, roofline and glossy body highlights.
  ctx.fillStyle = "#071927";
  ctx.beginPath(); ctx.moveTo(-15, -18); ctx.lineTo(-10, -25); ctx.lineTo(10, -25); ctx.lineTo(15, -18); ctx.lineTo(18, -8); ctx.lineTo(-18, -8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#6cb7d6";
  ctx.beginPath(); ctx.moveTo(-12, -19); ctx.lineTo(-8, -24); ctx.lineTo(0, -24); ctx.lineTo(0, -10); ctx.lineTo(-16, -10); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#c7f5ff55"; ctx.fillRect(-17, -5, 34, 2);
  // Rear spoiler and bumper.
  ctx.fillStyle = "#0a1623"; ctx.fillRect(-23, -13, 46, 4);
  ctx.fillStyle = "#26394b"; ctx.fillRect(-23, 13, 46, 4);
  // Diffuser fins, vents and exhaust details give the rear silhouette more depth.
  ctx.fillStyle = "#09121c"; for (let vent = -2; vent <= 2; vent++) ctx.fillRect(vent * 5 - 1, 14, 2, 3);
  ctx.fillStyle = "#8da4b7"; ctx.fillRect(-6, 18, 4, 2); ctx.fillRect(2, 18, 4, 2);
  ctx.fillStyle = "#080d14"; ctx.fillRect(-10, 16, 20, 3);
  // Distinct brake/tail lamps.
  ctx.fillStyle = "#ff334f"; ctx.fillRect(-22, 5, 8, 5); ctx.fillRect(14, 5, 8, 5);
  ctx.fillStyle = "#ff244a44"; ctx.fillRect(-25, 3, 13, 9); ctx.fillRect(12, 3, 13, 9);
  ctx.fillStyle = "#ffb0b5"; ctx.fillRect(-21, 5, 5, 2); ctx.fillRect(16, 5, 5, 2);
  if (player && drive.braking) {
    ctx.fillStyle = "#ff536b88";
    ctx.beginPath(); ctx.ellipse(-18, 9, 11, 5, 0, 0, Math.PI * 2); ctx.ellipse(18, 9, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function drawDriveTree(ctx, x, y, size, side, depth) {
  const foliage = drive.scene === "night" ? ["#0b211f", "#10342f", "#194a39"] : drive.scene === "rain" ? ["#163b34", "#225647", "#2b6b4a"] : drive.scene === "coast" ? ["#2a5c4d", "#397a58", "#5b9b64"] : ["#183e36", "#255d43", "#347a50"];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.fillStyle = foliage[0];
  ctx.beginPath(); ctx.ellipse(0, 4, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = drive.scene === "night" ? "#342f31" : "#684d3c";
  ctx.fillRect(-2.3, -12, 4.6, 18);
  for (let layer = 0; layer < 3; layer++) {
    ctx.fillStyle = foliage[Math.min(2, layer)];
    ctx.beginPath();
    const yy = -14 - layer * 9;
    ctx.moveTo(0, yy - 18); ctx.lineTo(-12 + layer * 2, yy + 4);
    ctx.lineTo(12 - layer * 2, yy + 4); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = "#c7e9b633";
  ctx.beginPath(); ctx.ellipse(side * -2, -29, 3, 9, -.25, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
const DRIVE_SCENES = Object.freeze({
  sunset: { label: "Golden-hour hills", skyTop: "#10253e", skyMid: "#527f9d", skyLow: "#f0b887", skyEnd: "#e7d5b2", mountainFar: "#344f69", mountainNear: "#506d68", grassTop: "#426f53", grassBottom: "#193f35", asphaltTop: "#414b57", asphaltMid: "#303943", asphaltBottom: "#202832", sun: true, stars: false, wet: false, rain: false },
  coast: { label: "Coastal highway", skyTop: "#0c4666", skyMid: "#63b7c8", skyLow: "#d6e9cf", skyEnd: "#c9dfb5", mountainFar: "#456d80", mountainNear: "#719d91", grassTop: "#5d9b6b", grassBottom: "#1f5b4f", asphaltTop: "#59636b", asphaltMid: "#3c4851", asphaltBottom: "#27333d", sun: true, stars: false, wet: false, rain: false },
  night: { label: "Night drive", skyTop: "#030918", skyMid: "#0b1d38", skyLow: "#172844", skyEnd: "#1b2e41", mountainFar: "#18263a", mountainNear: "#1a3440", grassTop: "#183c39", grassBottom: "#081b25", asphaltTop: "#202a38", asphaltMid: "#141d29", asphaltBottom: "#0c131d", sun: false, stars: true, wet: false, rain: false },
  rain: { label: "Rain-soaked road", skyTop: "#1b2938", skyMid: "#475a6b", skyLow: "#74828b", skyEnd: "#59656e", mountainFar: "#374954", mountainNear: "#344e4b", grassTop: "#34554b", grassBottom: "#112e2b", asphaltTop: "#394b5d", asphaltMid: "#202e3b", asphaltBottom: "#101b26", sun: false, stars: false, wet: true, rain: true }
});
function renderDrive() {
  if (!$("driveCanvas")) return;
  if (!driveContext || !driveCanvas.width) fitDriveCanvas();
  if (!driveContext) return;
  const width = driveCanvas.clientWidth || 800, height = Math.round((driveCanvas.clientWidth || 800) / 1.55);
  const ctx = driveContext;
  const scene = DRIVE_SCENES[drive.scene] || DRIVE_SCENES.sunset;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  if (drive.shake > 0) ctx.translate((Math.random() - 0.5) * drive.shake * 9, (Math.random() - 0.5) * drive.shake * 6);
  const horizon = height * 0.29;
  // Evening sky, sun glow and soft cloud bands.
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, scene.skyTop); sky.addColorStop(0.42, scene.skyMid); sky.addColorStop(0.72, scene.skyLow); sky.addColorStop(1, scene.skyEnd);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
  const sunX = width * 0.76, sunY = height * 0.19;
  if (scene.sun) {
    const glow = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, height * 0.22);
    glow.addColorStop(0, "#fff6d9c7"); glow.addColorStop(0.35, "#ffd8a44a"); glow.addColorStop(1, "#ffd8a400");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height * 0.5);
    ctx.fillStyle = "#fff0cc";
    ctx.beginPath(); ctx.arc(sunX, sunY, Math.max(8, height * 0.025), 0, Math.PI * 2); ctx.fill();
  }
  if (scene.stars) {
    for (let i = 0; i < 46; i++) {
      const sx = (i * 73.17 + (i % 4) * 11) % width;
      const sy = (i * 29.13) % Math.max(1, height * 0.27);
      ctx.fillStyle = i % 5 === 0 ? "#dff5ffbb" : "#dff5ff66";
      ctx.fillRect(sx, sy, i % 5 === 0 ? 1.8 : 1, i % 5 === 0 ? 1.8 : 1);
    }
  }
  for (let i = 0; i < 5; i++) {
    const cx = (((i * 0.237 + drive.roadOffset * 0.00012) % 1.25) - 0.1) * width;
    const cy = height * (0.09 + (i % 3) * 0.055);
    ctx.fillStyle = "#fff4e91d";
    ctx.beginPath(); ctx.ellipse(cx, cy, width * (0.045 + (i % 2) * 0.018), height * 0.014, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Layered mountain silhouettes give the horizon scale.
  ctx.fillStyle = scene.mountainFar; ctx.beginPath(); ctx.moveTo(0, height * .39);
  for (let x = 0; x <= width + 36; x += 36) ctx.lineTo(x, height * (.25 + ((Math.sin(x * .025) + 1) * .065)));
  ctx.lineTo(width, height * .49); ctx.lineTo(0, height * .49); ctx.fill();
  ctx.fillStyle = scene.mountainNear; ctx.beginPath(); ctx.moveTo(0, height * .43);
  for (let x = 0; x <= width + 48; x += 48) ctx.lineTo(x, height * (.34 + ((Math.sin(x * .018 + 2) + 1) * .045)));
  ctx.lineTo(width, height * .55); ctx.lineTo(0, height * .55); ctx.fill();
  // Grass verge with gently moving perspective bands.
  const ground = ctx.createLinearGradient(0, horizon, 0, height);
  ground.addColorStop(0, scene.grassTop); ground.addColorStop(1, scene.grassBottom);
  ctx.fillStyle = ground; ctx.fillRect(0, horizon, width, height - horizon);
  for (let i = 0; i < 13; i++) {
    const phase = ((i / 13 + drive.roadOffset * 0.0018) % 1 + 1) % 1;
    const y = horizon + (height - horizon) * phase * phase;
    ctx.fillStyle = i % 2 ? "#c6d2a10b" : "#061e2020";
    ctx.fillRect(0, y, width, 2 + phase * 6);
  }
  // Trees and roadside markers approach the player to reinforce forward motion.
  for (let i = 0; i < 17; i++) {
    const depth = ((i / 17 + drive.roadOffset * 0.0027) % 1 + 1) % 1;
    const y = horizon + (height - horizon) * depth * depth;
    const road = driveRoadGeometry(width, height, y);
    const size = 0.17 + depth * 1.02;
    for (const side of [-1, 1]) {
      const x = road.center + side * (road.half + 23 + depth * width * 0.17);
      drawDriveTree(ctx, x, y, size, side, depth);
      const postH = 3 + depth * 21;
      ctx.fillStyle = "#dfe9e7";
      ctx.fillRect(x - side * 7, y - postH, 2 + depth * 2, postH);
      ctx.fillStyle = "#ffd27b";
      ctx.fillRect(x - side * 7, y - postH, 2 + depth * 2, Math.max(2, postH * .22));
    }
  }
  // Build a perspective-correct road surface with wide shoulders.
  const samples = 44;
  const shoulderPoints = [];
  for (let i = 0; i <= samples; i++) {
    const depth = i / samples, y = horizon + (height - horizon) * depth * depth;
    const road = driveRoadGeometry(width, height, y);
    shoulderPoints.push([road.center - road.half * 1.09, y]);
  }
  for (let i = samples; i >= 0; i--) {
    const depth = i / samples, y = horizon + (height - horizon) * depth * depth;
    const road = driveRoadGeometry(width, height, y);
    shoulderPoints.push([road.center + road.half * 1.09, y]);
  }
  ctx.beginPath(); shoulderPoints.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
  ctx.fillStyle = "#d2c8b1"; ctx.fill();
  const roadPoints = [];
  for (let i = 0; i <= samples; i++) {
    const depth = i / samples, y = horizon + (height - horizon) * depth * depth;
    const road = driveRoadGeometry(width, height, y);
    roadPoints.push([road.center - road.half, y]);
  }
  for (let i = samples; i >= 0; i--) {
    const depth = i / samples, y = horizon + (height - horizon) * depth * depth;
    const road = driveRoadGeometry(width, height, y);
    roadPoints.push([road.center + road.half, y]);
  }
  ctx.beginPath(); roadPoints.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
  const asphalt = ctx.createLinearGradient(0, horizon, 0, height);
  asphalt.addColorStop(0, scene.asphaltTop); asphalt.addColorStop(0.55, scene.asphaltMid); asphalt.addColorStop(1, scene.asphaltBottom);
  ctx.fillStyle = asphalt; ctx.fill();
  // Perspective grain gives the asphalt subtle directional texture.
  for (let i = 0; i < 24; i++) {
    const depth = ((i / 24 + drive.roadOffset * 0.0013) % 1 + 1) % 1;
    const y = horizon + (height - horizon) * depth * depth;
    const road = driveRoadGeometry(width, height, y);
    const x = road.center + Math.sin(i * 2.4 + drive.roadOffset * .002) * road.half * .72;
    ctx.strokeStyle = "#c9d5df0b"; ctx.lineWidth = .5 + depth;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(i) * (2 + depth * 5), y + 4 + depth * 13); ctx.stroke();
  }
  // Fine asphalt flecks remain low contrast so the road stays readable.
  for (let i = 0; i < 170; i++) {
    const seed = (i * 73.17) % 1;
    const depth = ((i * 0.61803398875) % 1);
    const y = horizon + (height - horizon) * depth * depth;
    const road = driveRoadGeometry(width, height, y);
    const x = road.center + (seed * 2 - 1) * road.half * .94;
    ctx.fillStyle = i % 2 ? "#d9e0e20a" : "#07121a18";
    ctx.fillRect(x, y, 1 + depth * 1.4, 1 + depth * 1.4);
  }
  if (scene.wet) {
    // Water sheen and broken reflections stretch toward the viewer on wet tarmac.
    for (let i = 0; i < 18; i++) {
      const depth = ((i / 18 + drive.roadOffset * 0.0011) % 1 + 1) % 1;
      const y = horizon + (height - horizon) * depth * depth;
      const road = driveRoadGeometry(width, height, y);
      const offset = Math.sin(i * 8.7) * road.half * 0.48;
      ctx.strokeStyle = i % 3 === 0 ? "#d8f3ff2d" : "#9ac7e116";
      ctx.lineWidth = 0.5 + depth * 2.2;
      ctx.beginPath(); ctx.moveTo(road.center + offset, y); ctx.lineTo(road.center + offset + Math.sin(i) * depth * 16, y + 2 + depth * 14); ctx.stroke();
    }
  }
  // Red-white rumble strips and solid road-edge lines.
  for (let i = 0; i < samples; i++) {
    const d1 = i / samples, d2 = (i + 1) / samples;
    const y1 = horizon + (height - horizon) * d1 * d1, y2 = horizon + (height - horizon) * d2 * d2;
    const r1 = driveRoadGeometry(width, height, y1), r2 = driveRoadGeometry(width, height, y2);
    ctx.strokeStyle = i % 2 < 1 ? "#f1f0e8" : "#d56d62";
    ctx.lineWidth = 1 + d2 * 7;
    ctx.beginPath(); ctx.moveTo(r1.center - r1.half, y1); ctx.lineTo(r2.center - r2.half, y2);
    ctx.moveTo(r1.center + r1.half, y1); ctx.lineTo(r2.center + r2.half, y2); ctx.stroke();
  }
  ctx.strokeStyle = "#f3f0df"; ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(driveRoadGeometry(width, height, horizon).center - driveRoadGeometry(width, height, horizon).half, horizon);
  ctx.lineTo(driveRoadGeometry(width, height, height).center - driveRoadGeometry(width, height, height).half, height);
  ctx.moveTo(driveRoadGeometry(width, height, horizon).center + driveRoadGeometry(width, height, horizon).half, horizon);
  ctx.lineTo(driveRoadGeometry(width, height, height).center + driveRoadGeometry(width, height, height).half, height);
  ctx.stroke();
  // Two broken white lane separators are projected along the actual bending road.
  for (const laneMark of [-1 / 3, 1 / 3]) {
    for (let i = 0; i < 15; i++) {
      const depth = ((i / 15 + drive.roadOffset * 0.0044) % 1 + 1) % 1;
      const endDepth = Math.min(1, depth + 0.023 + depth * 0.036);
      const y1 = horizon + (height - horizon) * depth * depth;
      const y2 = horizon + (height - horizon) * endDepth * endDepth;
      const r1 = driveRoadGeometry(width, height, y1), r2 = driveRoadGeometry(width, height, y2);
      ctx.strokeStyle = "#f8f6e9";
      ctx.globalAlpha = 0.45 + depth * 0.5;
      ctx.lineWidth = 0.8 + depth * 4.2;
      ctx.beginPath(); ctx.moveTo(r1.center + laneMark * r1.half, y1); ctx.lineTo(r2.center + laneMark * r2.half, y2); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  if (scene.stars) {
    // A soft headlight pool opens up the asphalt ahead during night driving.
    const beamTopY = horizon + 7;
    const beamBaseY = height * 0.84;
    const beamTop = driveRoadGeometry(width, height, beamTopY);
    const beamBase = driveRoadGeometry(width, height, beamBaseY);
    const beam = ctx.createLinearGradient(0, beamBaseY, 0, beamTopY);
    beam.addColorStop(0, "#c3eaff20"); beam.addColorStop(0.45, "#b0ddff0d"); beam.addColorStop(1, "#b0ddff00");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(beamBase.center - beamBase.half * 0.42, beamBaseY);
    ctx.lineTo(beamTop.center - beamTop.half * 0.15, beamTopY);
    ctx.lineTo(beamTop.center + beamTop.half * 0.15, beamTopY);
    ctx.lineTo(beamBase.center + beamBase.half * 0.42, beamBaseY);
    ctx.closePath(); ctx.fill();
  }
  // Traffic is sorted far-to-near so nearby vehicles correctly sit on top of distant ones.
  const trafficByDepth = [...drive.traffic].sort((a, b) => a.depth - b.depth);
  for (const car of trafficByDepth) {
    const depth = car.depth, y = horizon + (height - horizon) * depth * depth;
    const road = driveRoadGeometry(width, height, y);
    const x = road.center + car.lane * road.half * 0.62;
    drawDriveCar(ctx, x, y, (0.12 + depth * 0.9) * (car.type === "van" ? 1.14 : 1), car.color, 0, false);
  }
  // Player car is anchored lower in the scene; lane movement is intentionally strong and visible.
  const playerY = height * 0.875;
  const playerRoad = driveRoadGeometry(width, height, playerY);
  const playerX = playerRoad.center + drive.lane * playerRoad.half * 0.62;
  // Nitro trails flare behind the car and soften as the charge runs out.
  if (drive.boosting && drive.nitro > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 7; i++) {
      const spread = (i - 3) * 5;
      const flame = ctx.createLinearGradient(playerX + spread, playerY + 4, playerX + spread, playerY + 48 + Math.random() * 14);
      flame.addColorStop(0, "#75f4ffdd"); flame.addColorStop(0.35, "#3db5ff99"); flame.addColorStop(1, "#3d8aff00");
      ctx.fillStyle = flame;
      ctx.beginPath(); ctx.moveTo(playerX + spread, playerY + 3); ctx.lineTo(playerX + spread - 2.5, playerY + 34); ctx.lineTo(playerX + spread + 2.5, playerY + 34); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  // A soft cyan reflection beneath the player's car.
  const carGlow = ctx.createRadialGradient(playerX, playerY + 9, 2, playerX, playerY + 9, 48);
  carGlow.addColorStop(0, "#4ee9ff30"); carGlow.addColorStop(1, "#4ee9ff00");
  ctx.fillStyle = carGlow; ctx.fillRect(playerX - 55, playerY - 28, 110, 70);
  drawDriveCar(ctx, playerX, playerY, 1.16, drive.carColor, drive.steer, true);
  // High-speed peripheral streaks add a little sense of acceleration without hiding the track.
  if (drive.speed > 150) {
    ctx.strokeStyle = "#e2f6ff22"; ctx.lineWidth = 1;
    const intensity = clamp((drive.speed - 150) / 70, 0, 1);
    for (let i = 0; i < 10; i++) {
      const yy = horizon + ((i * 0.137 + drive.roadOffset * 0.004) % 0.7 + 0.15) * (height - horizon);
      const side = i % 2 ? 1 : -1;
      const xx = side < 0 ? width * 0.05 : width * 0.95;
      ctx.globalAlpha = intensity;
      ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + side * -14, yy + 12 + intensity * 12); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  if (scene.rain) {
    // Fine rain streaks add motion without obscuring the road or controls.
    ctx.save();
    ctx.strokeStyle = "#d4e9ff6d";
    ctx.lineCap = "round";
    for (let i = 0; i < 105; i++) {
      const x = (i * 71.3 + drive.roadOffset * 1.4) % (width + 24) - 12;
      const y = (i * 43.9 + drive.roadOffset * 2.2) % (height + 16) - 8;
      const length = 3 + (i % 5) * 1.4;
      ctx.lineWidth = i % 4 === 0 ? 1.1 : 0.6;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2.5, y + length); ctx.stroke();
    }
    ctx.restore();
  }
  // Gentle edge vignette frames the action and HUD.
  const vignette = ctx.createLinearGradient(0, 0, width, 0);
  vignette.addColorStop(0, "#06101d55"); vignette.addColorStop(0.15, "#06101d00"); vignette.addColorStop(0.85, "#06101d00"); vignette.addColorStop(1, "#06101d55");
  ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
  // Steering wheel indicator with a responsive needle.
  const wheelX = width * 0.5, wheelY = height * 0.88;
  ctx.strokeStyle = "#e8f5ff85"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(wheelX, wheelY, 25, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
  ctx.strokeStyle = drive.boosting ? "#a4f8ff" : "#69e6ff"; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(wheelX, wheelY); ctx.lineTo(wheelX + drive.steer * 22, wheelY - 24); ctx.stroke();
  ctx.restore();
  $("driveSpeed").textContent = String(Math.round(drive.speed));
  $("driveScore").textContent = String(Math.floor(drive.score)).padStart(4, "0");
  const best = $("driveBest"); if (best) best.textContent = String(Math.max(drive.best, Math.floor(drive.score))).padStart(4, "0");
  $("driveSteer").textContent = drive.braking ? "BRAKE" : drive.boosting ? "BOOST" : drive.steer < -.15 ? "LEFT" : drive.steer > .15 ? "RIGHT" : Math.abs(drive.lane) > .74 ? "OFF ROAD" : "CENTER";
  const damage = $("driveDamage"); if (damage) damage.textContent = drive.damage + "/3";
  const misses = $("driveNearMisses"); if (misses) misses.textContent = String(drive.nearMisses);
  const nitroFill = $("driveNitroFill"); if (nitroFill) nitroFill.style.width = drive.nitro + "%";
  const nitroValue = $("driveNitroValue"); if (nitroValue) nitroValue.textContent = Math.round(drive.nitro) + "%";
}
function syncDrive3DControls() {
  if (!drive3dEnabled || !drive3dInstance) return;
  drive3dInstance.setControls({
    steer: drive.steer,
    throttle: drive.cruise || drive.throttle || driveGestureThrottle,
    brake: drive.braking || driveGestureBrake,
    boost: drive.boosting || driveGestureBoost
  });
}
function updateDriveGestureControls(hands, gestureResults) {
  if (!drive3dEnabled) return;
  if (!Array.isArray(hands) || hands.length < 2) {
    driveGestureThrottle = false;
    driveGestureBrake = false;
    driveGestureBoost = false;
    syncDrive3DControls();
    return;
  }
  // Use the hand on the right side of the camera for pedals, leaving both wrists
  // available for steering. If a hand disappears, all gesture pedals release.
  let pedalHandIndex = 0;
  for (let i = 1; i < hands.length; i++) {
    if (hands[i]?.[0]?.x > hands[pedalHandIndex]?.[0]?.x) pedalHandIndex = i;
  }
  const category = selectBestModelGesture(gestureResults?.[pedalHandIndex] || []);
  const pedalPose = detectGesture(
    hands[pedalHandIndex],
    false,
    category?.categoryName || null,
    category?.score || 0
  ).gesture;
  driveGestureThrottle = pedalPose === "Fist";
  driveGestureBrake = pedalPose === "OpenPalm";
  driveGestureBoost = pedalPose === "ThumbsUp";
  syncDrive3DControls();
}
async function ensureDrive3D() {
  if (drive3dInstance) return true;
  if (drive3dLoading) {
    while (drive3dLoading) await new Promise(resolve => setTimeout(resolve, 60));
    return !!drive3dInstance;
  }
  drive3dLoading = true;
  const box = $("driveCanvas")?.parentElement;
  const status = $("drive3dStatus");
  if (status) status.textContent = "Loading 3D renderer and physics…";
  if (box) box.classList.add("drive-3d-active");
  try {
    const { createCarGame3D } = await import("./car3d-engine.js");
    drive3dInstance = await createCarGame3D($("drive3dCanvas"), {
      onTelemetry(data) {
        drive.speed = data.speed;
        drive.score = data.score;
        drive.damage = data.damage;
        drive.nearMisses = data.nearMisses;
        drive.nitro = data.nitro;
        if (data.score > drive.best) {
          drive.best = data.score;
          try { localStorage.setItem("airhand-drive-best", String(drive.best)); } catch { /* storage optional */ }
        }
        $("driveSpeed").textContent = String(data.speed);
        $("driveScore").textContent = String(data.score).padStart(4, "0");
        $("driveBest").textContent = String(Math.max(drive.best, data.best || 0)).padStart(4, "0");
        $("driveSteer").textContent = data.surface || "CENTER";
        $("driveDamage").textContent = data.damage + "/3";
        $("driveNearMisses").textContent = String(data.nearMisses);
        $("driveNitroFill").style.width = data.nitro + "%";
        $("driveNitroValue").textContent = data.nitro + "%";
      },
      onCollision(data) {
        showToast("Collision · " + data.remaining + " vehicle condition points remaining.");
      },
      onNearMiss(data) {
        showToast("Near miss +" + (data.score - Math.floor(drive.score)) + " · nitro recharged");
      },
      onGameOver(data) {
        drive.score = data.score;
        drive.damage = data.damage;
        drive.nearMisses = data.nearMisses;
        endDrive();
      },
      onScene(name) {
        const statusText = $("drive3dStatus");
        if (statusText) statusText.textContent = "3D physics active · " + (DRIVE_SCENES[name]?.label || name);
      }
    });
    drive3dInstance.setScene(drive.scene);
    drive3dInstance.setCarColour(drive.carColor);
    syncDrive3DControls();
    if (status) status.textContent = "3D physics ready · gestures and touch controls enabled";
    return true;
  } catch (error) {
    if (box) box.classList.remove("drive-3d-active");
    if (status) status.textContent = "3D engine unavailable · classic mode is ready";
    console.error("Air Drive 3D failed to initialise:", error);
    showToast("3D engine could not load. Check your internet connection; classic drive is available.");
    return false;
  } finally {
    drive3dLoading = false;
  }
}
function setDriveSound(enabled) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (enabled && !AudioContextClass) {
    drive.sound = false;
    showToast("Engine audio is not supported in this browser.");
    return;
  }
  drive.sound = !!enabled;
  if (drive.sound && !drive.audioContext) {
    try {
      drive.audioContext = new AudioContextClass();
      drive.engineOsc = drive.audioContext.createOscillator();
      drive.engineFilter = drive.audioContext.createBiquadFilter();
      drive.engineGain = drive.audioContext.createGain();
      drive.engineOsc.type = "sawtooth";
      drive.engineFilter.type = "lowpass";
      drive.engineFilter.frequency.value = 420;
      drive.engineGain.gain.value = 0;
      drive.engineOsc.connect(drive.engineFilter);
      drive.engineFilter.connect(drive.engineGain);
      drive.engineGain.connect(drive.audioContext.destination);
      drive.engineOsc.start();
    } catch (error) {
      drive.sound = false;
      console.warn("Air Drive audio unavailable:", error);
    }
  }
  if (drive.audioContext && drive.sound) drive.audioContext.resume().catch(() => {});
  if (drive.engineGain && drive.audioContext) {
    drive.engineGain.gain.setTargetAtTime(drive.sound && drive.playing ? 0.025 : 0, drive.audioContext.currentTime, 0.08);
  }
  const button = $("driveSound");
  if (button) {
    button.setAttribute("aria-pressed", String(drive.sound));
    button.textContent = drive.sound ? "♫ Engine sound: ON" : "♫ Engine sound: OFF";
  }
}
function updateDriveAudio() {
  if (!drive.sound || !drive.audioContext || !drive.engineOsc || !drive.engineGain) return;
  const time = drive.audioContext.currentTime;
  drive.engineOsc.frequency.setTargetAtTime(38 + drive.speed * 0.72 + (drive.boosting ? 22 : 0), time, 0.07);
  if (drive.engineFilter) drive.engineFilter.frequency.setTargetAtTime(300 + drive.speed * 5.5, time, 0.1);
  drive.engineGain.gain.setTargetAtTime(drive.playing && !drive.paused ? 0.012 + drive.speed / 12000 + (drive.boosting ? 0.012 : 0) : 0, time, 0.1);
}
function saveDriveBest() {
  const score = Math.floor(drive.score);
  if (score <= drive.best) return;
  drive.best = score;
  try { localStorage.setItem("airhand-drive-best", String(drive.best)); } catch { /* storage may be disabled */ }
}
function pauseDrive() {
  if (!drive.playing || drive.paused) return;
  drive.paused = true;
  if (drive3dEnabled && drive3dInstance) drive3dInstance.pause();
  if (driveFrameRequest) cancelAnimationFrame(driveFrameRequest);
  driveFrameRequest = 0;
  drive.throttle = false;
  drive.boosting = false;
  $("drivePause").textContent = "▶ Resume";
  $("driveTitle").textContent = "Pit stop · paused";
  $("driveText").textContent = "Take a breath, then resume. Your score, traffic and vehicle condition are preserved.";
  $("drivePlay").textContent = "Resume drive";
  $("driveOverlay").classList.remove("hidden");
  updateDriveAudio();
  syncDrive3DControls();
}
function resumeDrive() {
  if (!drive.playing || !drive.paused) return;
  if (driveFrameRequest) cancelAnimationFrame(driveFrameRequest);
  driveFrameRequest = 0;
  drive.paused = false;
  drive.lastFrame = 0;
  $("driveOverlay").classList.add("hidden");
  $("drivePause").textContent = "Ⅱ Pause";
  updateDriveAudio();
  if (drive3dEnabled && drive3dInstance) drive3dInstance.resume();
  syncDrive3DControls();
  driveFrameRequest = requestAnimationFrame(driveFrame);
}
async function startDrive() {
  saveDriveBest();
  if (driveFrameRequest) cancelAnimationFrame(driveFrameRequest);
  driveFrameRequest = 0;
  drive.playing = true;
  drive.paused = false;
  drive.crashed = false;
  drive.braking = false;
  drive.throttle = false;
  drive.boosting = false;
  drive.score = 0;
  drive.speed = 0;
  drive.roadOffset = 0;
  drive.spawnIn = 1.25;
  drive.traffic = [];
  drive.lastFrame = 0;
  drive.lane = 0;
  drive.nitro = 100;
  drive.damage = 0;
  drive.nearMisses = 0;
  drive.combo = 0;
  drive.shake = 0;
  $("drivePause").textContent = "Ⅱ Pause";
  $("driveCruise").setAttribute("aria-pressed", String(drive.cruise));
  $("driveCruise").textContent = drive.cruise ? "Cruise control: ON" : "Cruise control: OFF";
  $("driveCruise").setAttribute("aria-pressed", String(drive.cruise));
  $("driveCruise").textContent = drive.cruise ? "Cruise control: ON" : "Cruise control: OFF";
  if (drive3dEnabled) {
    $("drivePlay").disabled = true;
    const ready = await ensureDrive3D();
    $("drivePlay").disabled = false;
    if (!ready) {
      drive3dEnabled = false;
      $("drive3dToggle").setAttribute("aria-pressed", "false");
      $("drive3dToggle").textContent = "🚗 3D physics: OFF";
      $("driveCanvas").parentElement.classList.remove("drive-3d-active");
      startDrive();
      return;
    }
    drive3dInstance.setScene(drive.scene);
    drive3dInstance.setCarColour(drive.carColor);
    drive3dInstance.reset();
    drive3dInstance.start();
    $("driveOverlay").classList.add("hidden");
    updateDriveAudio();
    syncDrive3DControls();
    driveFrameRequest = requestAnimationFrame(driveFrame);
    return;
  }
  $("driveOverlay").classList.add("hidden");
  renderDrive();
  updateDriveAudio();
  driveFrameRequest = requestAnimationFrame(driveFrame);
}
function endDrive() {
  saveDriveBest();
  drive.playing = false;
  drive.paused = false;
  if (driveFrameRequest) cancelAnimationFrame(driveFrameRequest);
  driveFrameRequest = 0;
  drive.crashed = true;
  drive.braking = false;
  drive.throttle = false;
  drive.boosting = false;
  driveGestureThrottle = false; driveGestureBrake = false; driveGestureBoost = false;
  if (drive3dEnabled && drive3dInstance) drive3dInstance.pause();
  $("drivePause").textContent = "Ⅱ Pause";
  $("driveTitle").textContent = "Session over · vehicle needs service";
  $("driveText").textContent = "Distance score " + Math.floor(drive.score) + " · Near misses " + drive.nearMisses + " · Damage " + drive.damage + "/3. Reset to take another drive.";
  $("drivePlay").textContent = "Drive again";
  $("driveOverlay").classList.remove("hidden");
  updateDriveAudio();
}
function driveFrame(now) {
  if (!drive.playing || drive.paused || currentMode !== "drive") return;
  if (drive3dEnabled && drive3dInstance) {
    syncDrive3DControls();
    driveFrameRequest = requestAnimationFrame(driveFrame);
    return;
  }
  const dt = Math.min(Math.max((now - (drive.lastFrame || now)) / 1000, 0), 0.04);
  drive.lastFrame = now;

  // Light arcade-simulation physics: throttle builds speed, coasting rolls down gradually,
  // braking sheds speed quickly, and nitro briefly raises the speed ceiling.
  if (drive.braking) {
    drive.speed = Math.max(0, drive.speed - dt * (drive.speed > 120 ? 158 : 112));
  } else if (drive.cruise || drive.throttle) {
    drive.speed = Math.min(drive.boosting && drive.nitro > 0 ? 265 : 220, drive.speed + dt * (drive.boosting ? 42 : 25));
  } else {
    drive.speed = Math.max(0, drive.speed - dt * 7.5);
  }
  if (drive.boosting && drive.nitro > 0 && !drive.braking) {
    drive.nitro = Math.max(0, drive.nitro - dt * 34);
  } else {
    drive.boosting = false;
    drive.nitro = Math.min(100, drive.nitro + dt * 8.5);
  }
  drive.score += dt * drive.speed * 0.12;
  drive.roadOffset += dt * drive.speed * (drive.boosting ? 1.32 : 1);
  const steeringStrength = 4.6 + Math.min(2.8, drive.speed / 75);
  drive.lane += (clamp(drive.steer, -0.92, 0.92) - drive.lane) * (1 - Math.exp(-dt * steeringStrength));
  drive.lane = clamp(drive.lane, -0.98, 0.98);
  if (Math.abs(drive.lane) > 0.74 && drive.speed > 35) {
    drive.speed = Math.max(24, drive.speed - dt * 22);
    drive.shake = Math.max(drive.shake, 0.06);
  }
  drive.shake = Math.max(0, drive.shake - dt);
  drive.spawnIn -= dt;
  if (drive.spawnIn <= 0 && drive.speed > 18) {
    const lanes = [-0.66, 0, 0.66];
    const freeLanes = lanes.filter(lane => !drive.traffic.some(car => car.depth < 0.38 && Math.abs(car.lane - lane) < 0.2));
    const available = freeLanes.length ? freeLanes : lanes;
    const palette = ["#ff7468", "#f2bb4e", "#818cf8", "#f0f3f6", "#64d6a2", "#e5a4ff"];
    drive.traffic.push({
      depth: 0.025,
      lane: available[Math.floor(Math.random() * available.length)],
      color: palette[Math.floor(Math.random() * palette.length)],
      passed: false,
      hit: false,
      type: Math.random() < 0.18 ? "van" : "car"
    });
    drive.spawnIn = Math.max(0.62, 1.85 - drive.speed / 300 + Math.random() * 0.55);
  }
  drive.traffic.forEach(car => { car.depth += dt * (0.12 + drive.speed / 900); });

  const impact = drive.speed > 34
    ? drive.traffic.find(car => !car.hit && car.depth > 0.78 && car.depth < 0.94 && Math.abs(car.lane - drive.lane) < 0.27)
    : null;
  if (impact) {
    impact.hit = true;
    drive.damage += 1;
    drive.speed = Math.max(26, drive.speed * 0.48);
    drive.score = Math.max(0, drive.score - 30);
    drive.shake = 0.42;
    drive.traffic = drive.traffic.filter(car => !car.hit);
    showToast("Impact detected · " + (3 - drive.damage) + " vehicle condition points left.");
    if (drive.damage >= 3) {
      renderDrive();
      endDrive();
      return;
    }
  } else {
    for (const car of drive.traffic) {
      if (!car.passed && car.depth >= 0.94) {
        car.passed = true;
        const separation = Math.abs(car.lane - drive.lane);
        if (separation >= 0.27 && separation < 0.5) {
          drive.nearMisses += 1;
          drive.combo += 1;
          drive.score += 90 + Math.min(10, drive.combo) * 5;
          drive.nitro = Math.min(100, drive.nitro + 10);
          showToast("Near miss +" + (90 + Math.min(10, drive.combo) * 5) + " · nitro recharged");
        } else if (separation >= 0.5) {
          drive.combo = 0;
        }
      }
    }
  }
  drive.traffic = drive.traffic.filter(car => car.depth < 1.08);
  renderDrive();
  updateDriveAudio();
  driveFrameRequest = requestAnimationFrame(driveFrame);
}

function calibrateDriveSteering() {
  if (!driveSteering) { showToast("Enable the camera first so AirHand can load two-hand tracking."); return; }
  const hands = lastHandLandmarks;
  // The regular gesture loop stores the primary hand; use the most recent full result cache for steering.
  if (!driveLatestHands || driveLatestHands.length < 2 || !driveSteering.calibrate(driveLatestHands[0], driveLatestHands[1])) {
    $("driveGuidance").textContent = "Show both hands, spread them apart, and hold still to calibrate";
    showToast("Two visible hands are needed to calibrate steering."); return;
  }
  drive.steer = 0; driveKeyboardSteer = null; $("driveGuidance").textContent = "Calibrated ✓ · turn right; HUD must say RIGHT. If not, toggle Reverse steering."; showToast("Air steering calibrated!");
}
let driveLatestHands = null;

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
$("drivePlay").addEventListener("click", () => { if (currentMode !== "drive") switchMode("drive"); if (drive.playing && drive.paused) resumeDrive(); else startDrive(); });
$("drivePause").addEventListener("click", () => { if (!drive.playing) { showToast("Start a drive first."); return; } if (drive.paused) resumeDrive(); else pauseDrive(); });
$("drive3dToggle").addEventListener("click", () => {
  if (drive.playing) {
    drive.playing = false; drive.paused = false;
    if (driveFrameRequest) cancelAnimationFrame(driveFrameRequest);
    driveFrameRequest = 0;
    if (drive3dInstance) drive3dInstance.pause();
    $("driveOverlay").classList.remove("hidden");
    $("driveTitle").textContent = "Driving mode changed";
    $("driveText").textContent = "Choose your driving mode, then start a new session. The current run has been paused.";
    $("drivePlay").textContent = "Start engine";
  }
  drive3dEnabled = !drive3dEnabled;
  $("drive3dToggle").setAttribute("aria-pressed", String(drive3dEnabled));
  $("drive3dToggle").textContent = drive3dEnabled ? "🚗 3D physics: ON" : "🚗 3D physics: OFF";
  const box = $("driveCanvas").parentElement;
  box.classList.toggle("drive-3d-active", drive3dEnabled && !!drive3dInstance);
  if (drive3dEnabled) {
    drive.cruise = false;
    $("driveCruise").setAttribute("aria-pressed", "false");
    $("driveCruise").textContent = "Cruise control: OFF";
    $("drive3dStatus").textContent = drive3dInstance ? "3D physics ready · gestures and touch controls enabled" : "3D physics loads when you start the engine";
    showToast("3D physics selected · two-hand steering, fist gas, open-palm brake, thumbs-up nitro.");
  } else {
    $("drive3dStatus").textContent = "Classic drive selected · no 3D physics loaded";
    showToast("Classic drive selected.");
  }
});
$("driveCruise").addEventListener("click", () => {
  drive.cruise = !drive.cruise;
  $("driveCruise").setAttribute("aria-pressed", String(drive.cruise));
  $("driveCruise").textContent = drive.cruise ? "Cruise control: ON" : "Cruise control: OFF";
  showToast(drive.cruise ? "Cruise control enabled." : "Manual throttle enabled · hold GAS or W / ↑.");
});
$("driveScene").addEventListener("change", event => {
  drive.scene = DRIVE_SCENES[event.target.value] ? event.target.value : "sunset";
  if (drive3dInstance) drive3dInstance.setScene(drive.scene);
  renderDrive();
  showToast("Scenery: " + DRIVE_SCENES[drive.scene].label);
});
document.querySelectorAll("[data-drive-car]").forEach(button => button.addEventListener("click", () => {
  drive.carColor = button.dataset.driveCar;
  if (drive3dInstance) drive3dInstance.setCarColour(drive.carColor);
  document.querySelectorAll("[data-drive-car]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
  renderDrive();
  showToast("Vehicle paint updated.");
}));
$("driveSound").addEventListener("click", () => setDriveSound(!drive.sound));
$("driveCalibrate").addEventListener("click", calibrateDriveSteering);
$("driveInvert").addEventListener("click", () => {
  if (!driveSteering) { showToast("Enable the camera first, then adjust steering direction."); return; }
  driveSteering.inverted = !driveSteering.inverted;
  driveSteering.value = 0;
  drive.steer = 0;
  $("driveInvert").setAttribute("aria-pressed", String(driveSteering.inverted));
  $("driveInvert").textContent = driveSteering.inverted ? "↔ Reverse steering: ON" : "↔ Reverse steering: OFF";
  $("driveGuidance").textContent = driveSteering.inverted
    ? "Reverse steering ON · turn right and check the HUD says RIGHT"
    : "Reverse steering OFF · turn right and check the HUD says RIGHT";
  showToast(driveSteering.inverted ? "Steering direction reversed." : "Steering direction restored.");
});
$("driveReset").addEventListener("click", () => { saveDriveBest(); if (drive3dInstance) drive3dInstance.pause(); drive.playing = false; drive.paused = false; drive.braking = false; drive.throttle = false; drive.boosting = false; driveGestureThrottle = false; driveGestureBrake = false; driveGestureBoost = false; driveKeyboardSteer = null; drive.steer = 0; if (driveSteering) driveSteering.reset(); if (drive3dEnabled && drive3dInstance) drive3dInstance.reset(); $("drivePause").textContent = "Ⅱ Pause"; $("driveTitle").textContent = "Ready to drive?"; $("driveText").textContent = "Choose a scene, then start the engine. Cruise control is on by default; you can switch to manual throttle."; $("drivePlay").textContent = "Start engine"; $("driveOverlay").classList.remove("hidden"); updateDriveAudio(); syncDrive3DControls(); renderDrive(); });
function bindDriveHold(id, onPress, onRelease) {
  const button = $(id);
  if (!button) return;
  const release = event => {
    if (event) event.preventDefault();
    button.classList.remove("active");
    onRelease();
  };
  button.addEventListener("pointerdown", event => {
    event.preventDefault();
    button.classList.add("active");
    try { button.setPointerCapture(event.pointerId); } catch {}
    onPress();
  });
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
}
const restoreDriveHandSteering = () => {
  driveKeyboardSteer = null;
  drive.steer = driveSteering?.value ?? 0;
};
bindDriveHold("driveLeft", () => { driveKeyboardSteer = -0.85; drive.steer = -0.85; }, restoreDriveHandSteering);
bindDriveHold("driveRight", () => { driveKeyboardSteer = 0.85; drive.steer = 0.85; }, restoreDriveHandSteering);
bindDriveHold("driveBrake", () => { drive.braking = true; }, () => { drive.braking = false; });
bindDriveHold("driveThrottle", () => { drive.throttle = true; }, () => { drive.throttle = false; });
bindDriveHold("driveBoost", () => { if (drive.nitro > 1) drive.boosting = true; }, () => { drive.boosting = false; });

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
    driveKeyboardSteer = (event.code === "ArrowLeft" || event.code === "KeyA") ? -0.85 : 0.85;
    drive.steer = driveKeyboardSteer;
    return;
  }
  if (currentMode === "drive" && ["ArrowUp", "KeyW"].includes(event.code)) {
    event.preventDefault(); drive.throttle = true; return;
  }
  if (currentMode === "drive" && ["ShiftLeft", "ShiftRight"].includes(event.code)) {
    event.preventDefault(); if (drive.nitro > 1) drive.boosting = true; return;
  }
  if (event.code === "Space" && currentMode === "drive") {
    event.preventDefault();
    if (!drive.playing) startDrive(); else { drive.braking = true; }
    return;
  }
  if (event.key.toLowerCase() === "p" && currentMode === "drive" && drive.playing) {
    if (drive.paused) resumeDrive(); else pauseDrive();
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
  if (currentMode === "drive" && ["ArrowLeft", "ArrowRight", "KeyA", "KeyD"].includes(event.code)) { driveKeyboardSteer = null; drive.steer = driveSteering?.value ?? 0; }
  if (currentMode === "drive" && ["ArrowUp", "KeyW"].includes(event.code)) drive.throttle = false;
  if (currentMode === "drive" && ["ShiftLeft", "ShiftRight"].includes(event.code)) drive.boosting = false;
  if (currentMode === "drive" && event.code === "Space") drive.braking = false;
});
window.addEventListener("blur", () => { driveKeyboardSteer = null; drive.braking = false; drive.throttle = false; drive.boosting = false; document.querySelectorAll(".drive-pad button").forEach(button => button.classList.remove("active")); if (currentMode === "drive") drive.steer = driveSteering?.value ?? 0; updateDriveAudio(); });
window.addEventListener("resize", () => { resizeCanvases(); fitDriveCanvas(); renderDrive(); });
window.addEventListener("pageshow", () => {
  if (cameraActive && mediaStream?.getVideoTracks().every(track => track.readyState === "ended")) handleCameraTrackEnded();
});
video.addEventListener("loadedmetadata", fitCameraFrameToVideo);
window.addEventListener("pagehide", () => {
  pageIsClosing = true;
  cancelAnimationFrame(gameFrameRequest);
  if (driveFrameRequest) cancelAnimationFrame(driveFrameRequest);
  driveFrameRequest = 0;
  saveDriveBest();
  drive.playing = false;
  drive.paused = false;
  drive.boosting = false;
  updateDriveAudio();
  stopCamera();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && game.playing && !game.paused) pauseGame(true);
  if (document.hidden && currentMode === "drive" && drive.playing && !drive.paused) pauseDrive();
});
updateCameraUI(false);
resizeCanvases();
fitDriveCanvas();
renderDrive();
window.__AIRHAND_READY__ = true;
