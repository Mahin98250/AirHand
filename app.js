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
  const pinchThreshold = previousPinch ? 0.39 : 0.29;

  if (pinchRatio < pinchThreshold) {
    return { gesture: "Pinch", fingers, pinchRatio, palmScale, thumbExtended, source: "geometry" };
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
    }
    return this.stable;
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

  update(x, y) {
    x = clamp(x, 0, 1);
    y = clamp(y, 0, 1);
    if (!this.initialized) {
      this.reset(x, y);
      return { x: this.x, y: this.y };
    }
    const delta = Math.hypot(x - this.x, y - this.y);
    const deadZone = 0.0018;
    if (delta <= deadZone) return { x: this.x, y: this.y };
    const responsiveness = delta > 0.12 ? 0.62 : delta > 0.04 ? 0.38 : this.alpha;
    const factor = Math.max(this.alpha, responsiveness);
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
let fpsFrames = 0;
let fpsWindowStart = 0;
let currentMode = "cursor";
let lastStableGesture = "None";
let lastPeaceSwitch = 0;
let lastThumbToggle = 0;
let lastGameFrame = 0;
let stablePinch = false;
let pageIsClosing = false;
let cursorSensitivity = 0.22;
let mirrorCamera = true;
let showLandmarks = true;
const stabilizer = new GestureStabilizer(115);
const cursorFilter = new CursorSmoother(cursorSensitivity);
const SUPPORTED_MODEL_GESTURES = new Set(["Pointing_Up", "Victory", "Thumb_Up", "Open_Palm", "Closed_Fist"]);
const labels = {
  None: "No hand detected", Unclear: "Adjust your hand", Pinch: "Pinch",
  ThumbsUp: "Thumbs-up", Peace: "Peace sign", Point: "Pointing",
  OpenPalm: "Open palm", Fist: "Fist"
};
const game = {
  playing: false, paused: false, score: 0, best: readBestScore(),
  speed: 250, playerY: 0, velocityY: 0, obstacles: [], spawnIn: 0, ground: 0
};
let toastTimeout = null;

function readBestScore() {
  try { return Number(localStorage.getItem("airhand-best") || 0); } catch { return 0; }
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
  $("action").textContent = active
    ? (currentMode === "cursor" ? "Re-center cursor →" : "Restart runner →")
    : "Enable camera →";
  $("start").textContent = active ? "◉ Camera enabled" : "◉  Enable camera";
  if ($("stopCamera")) $("stopCamera").disabled = !active;
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
  cameraActive = false;
  cancelAnimationFrame(trackingFrame);
  // Keep the runner alive: it also supports keyboard and pointer controls without a camera.
  stopMediaTracks();
  if (gestureRecognizer) { gestureRecognizer.close(); gestureRecognizer = null; }
  geometryOnlyFallback = false;
  video.srcObject = null;
  trackingContext.clearRect(0, 0, trackingCanvas.width, trackingCanvas.height);
  stabilizer.reset();
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
    drawLandmarks(landmarks, width, height);
    const category = geometryOnlyFallback ? null : selectBestModelGesture(result.gestures?.[0] || []);
    const raw = detectGesture(landmarks, stablePinch, category?.categoryName || null, category?.score || 0);
    const frameGuidance = getHandFrameGuidance(landmarks);
    $("gestureConfidence").textContent = frameGuidance || (raw.source === "model"
      ? "Model confidence " + Math.round((raw.confidence || 0) * 100) + "%"
      : raw.gesture === "Pinch" ? "Pinch distance normalized to palm size" : "Landmark geometry fallback");
    const stable = stabilizer.update(raw.gesture, now);
    $("gesture").textContent = labels[stable] || labels.Unclear;
    updateCursor(landmarks[8]);
    if (stable !== lastStableGesture) {
      handleStableGesture(stable, lastStableGesture, now, landmarks);
      lastStableGesture = stable;
    }
  } else {
    stabilizer.reset();
    stablePinch = false;
    if (lastStableGesture !== "None") {
      handleStableGesture("None", lastStableGesture, now, null);
      lastStableGesture = "None";
    }
    $("gesture").textContent = "No hand detected";
    $("gestureConfidence").textContent = "Keep your hand in view";
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
function updateCursor(indexTip) {
  const targetX = mirrorCamera ? 1 - indexTip.x : indexTip.x;
  const point = cursorFilter.update(targetX, indexTip.y);
  $("cursor").style.left = (clamp(point.x, 0.01, 0.99) * 100) + "%";
  $("cursor").style.top = (clamp(point.y, 0.05, 0.95) * 100) + "%";
  $("cursor").style.opacity = currentMode === "cursor" ? "1" : ".28";
  document.querySelectorAll(".mini").forEach(tile => tile.classList.remove("hovered"));
  if (currentMode === "cursor") {
    const rect = document.querySelector(".cards").getBoundingClientRect();
    const target = document.elementFromPoint(
      rect.left + clamp(point.x, 0.01, 0.99) * rect.width,
      rect.top + clamp(point.y, 0.05, 0.95) * rect.height
    )?.closest(".mini");
    if (target) target.classList.add("hovered");
  }
}
function handleStableGesture(gesture, previous, now) {
  if (gesture === "Peace" && previous !== "Peace" && now - lastPeaceSwitch > 950) {
    lastPeaceSwitch = now;
    switchMode(currentMode === "cursor" ? "game" : "cursor");
    showToast(currentMode === "game" ? "Hand Runner selected" : "Air Cursor selected");
  }
  if (gesture === "Pinch" && previous !== "Pinch") {
    stablePinch = true;
    if (currentMode === "cursor") activateVirtualTarget();
    else if (game.playing && !game.paused) jump();
  } else if (previous === "Pinch") {
    stablePinch = false;
  }

  if (currentMode === "game") {
    if (gesture === "OpenPalm" && !game.playing) startGame();
    else if (gesture === "OpenPalm" && game.paused) resumeGame();
    if (gesture === "ThumbsUp" && previous !== "ThumbsUp" &&
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

  for (const obstacle of game.obstacles) {
    gameContext.fillStyle = "#ff9b70";
    roundRect(gameContext, obstacle.x, game.ground - obstacle.height, obstacle.width, obstacle.height, 4);
    gameContext.fillStyle = "#ffd0b8";
    gameContext.fillRect(obstacle.x + 4, game.ground - obstacle.height + 5, 3, Math.max(3, obstacle.height - 10));
  }
  $("score").textContent = String(Math.floor(game.score)).padStart(3, "0");
  $("bestScore").textContent = String(game.best).padStart(3, "0");
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
  game.speed = Math.min(440, 250 + game.score * .42);
  game.velocityY += 1120 * dt;
  game.playerY = Math.min(0, game.playerY + game.velocityY * dt);
  if (game.playerY === 0) game.velocityY = 0;

  game.spawnIn -= dt;
  if (game.spawnIn <= 0) {
    const obstacleHeight = 19 + Math.random() * 18;
    game.obstacles.push({ x: width + 12, width: 17 + Math.random() * 9, height: obstacleHeight });
    game.spawnIn = Math.max(.62, 1.05 + Math.random() * .55 - game.score / 280);
  }
  game.obstacles.forEach(obstacle => obstacle.x -= game.speed * dt);
  game.obstacles = game.obstacles.filter(obstacle => obstacle.x + obstacle.width > -2);

  const playerX = width * .17;
  const playerTop = game.ground - 25 + game.playerY;
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
    game.velocityY = -410;
  }
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

$("start").addEventListener("click", startCamera);
$("start2").addEventListener("click", startCamera);
$("stopCamera").addEventListener("click", stopCamera);
$("landmarkToggle").addEventListener("change", event => { showLandmarks = event.target.checked; });
$("mirrorToggle").addEventListener("change", event => { mirrorCamera = event.target.checked; video.style.transform = mirrorCamera ? "scaleX(-1)" : "none"; });
$("sensitivity").addEventListener("input", event => { cursorSensitivity = Number(event.target.value); cursorFilter.alpha = cursorSensitivity; $("sensitivityValue").textContent = Math.round(cursorSensitivity * 100) + "%"; });
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
gameCanvas.addEventListener("pointerdown", () => {
  if (currentMode === "game" && game.playing && !game.paused) jump();
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
