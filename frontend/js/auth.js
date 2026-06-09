/**
 * auth.js — Phase 3 & 4 (v6 — Voice-guided liveness)
 *
 * WHAT'S NEW IN v6
 * ─────────────────
 * Web Speech API (window.speechSynthesis) is used to give the user clear,
 * spoken instructions at every stage. No library, no CDN, no backend — it is
 * built into every modern browser (Chrome, Edge, Firefox, Safari).
 *
 * Voice design principles applied:
 *  • One authoritative voice selected at boot (prefers a local English voice,
 *    falls back to any available voice).
 *  • speak() is non-blocking: it fires and the pipeline continues immediately.
 *    This means the voice speaks while the camera is already watching.
 *  • speakAndWait() is used only before a challenge begins, giving the user
 *    time to hear the instruction before detection starts.
 *  • Interruption-safe: every new speak() call cancels any in-progress speech
 *    so instructions never pile up or overlap.
 *  • Confirmations ("Good!", "Perfect") are short positive feedback after
 *    each challenge passes — no silence between steps.
 *  • Result outcomes (Access granted / Access denied) are spoken clearly.
 *
 * VOICE CALL MAP (in pipeline order):
 *  Boot ready       → "System ready. Click Start Authentication."
 *  Calibration      → "Please look straight at the camera and hold still."
 *  Head turn LEFT   → "Now slowly turn your head to the left."
 *  Turn confirmed   → "Good. Now look straight ahead."
 *  Head turn RIGHT  → "Now slowly turn your head to the right."
 *  Turn confirmed   → "Good. Now look straight ahead."
 *  Blink prompt     → "Please blink once naturally."
 *  Blink confirmed  → "Thank you. Checking your identity now."
 *  Match found      → "Identity confirmed. Welcome, [name]."
 *  Access granted   → "Access granted."
 *  No match         → "Face not recognised. Access denied."
 *  Liveness fail    → "Liveness check failed. Please try again."
 *  Calibration fail → "Calibration failed. Please keep your face in frame."
 *
 * ARCHITECTURE (unchanged from v5)
 * ──────────────────────────────────
 *  MediaPipe Face Mesh  — liveness (yaw ratio + calibrated EAR blink)
 *  face-api.js          — recognition (128-dim descriptor matching)
 */

"use strict";

// ── Constants ─────────────────────────────────────────────────────────────────
const MODELS_URL      = "/assets/models";
const API_DESCRIPTORS = "/api/auth/descriptors";
const API_DECISION    = "/api/auth/decision";

const LM = {
  NOSE_TIP:     1,
  L_EYE_OUTER: 33,
  R_EYE_OUTER: 263,
  L_EYE: [33,  160, 158, 133, 153, 144],
  R_EYE: [362, 385, 387, 263, 373, 380],
};

const YAW_THRESHOLD   = 0.09;
const CALIBRATION_MS  = 1500;
const HEAD_WINDOW_MS  = 10000;
const CENTRE_HOLD_MS  = 800;
const EAR_CLOSE_RATIO = 0.72;
const EAR_OPEN_RATIO  = 0.88;
const BLINK_WINDOW_MS = 8000;
const YAW_HISTORY     = 3;

const DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 });
const MATCH_THRESHOLD  = 0.52;

// ── State ─────────────────────────────────────────────────────────────────────
let isRunning        = false;
let cameraStream     = null;
let storedEmbeddings = [];
let faceMesh         = null;
let mpCamera         = null;
let latestLandmarks  = null;

// ── DOM ───────────────────────────────────────────────────────────────────────
const video             = document.getElementById("video");
const overlayCanvas     = document.getElementById("overlay");
const cameraStatus      = document.getElementById("cameraStatus");
const startAuthBtn      = document.getElementById("startAuthBtn");
const authAgainBtn      = document.getElementById("authAgainBtn");
const tryAgainBtn       = document.getElementById("tryAgainBtn");
const processingMessage = document.getElementById("processingMessage");
const livenessBanner    = document.getElementById("livenessBanner");
const challengeIcon     = document.getElementById("challengeIcon");
const challengeText     = document.getElementById("challengeText");
const grantedName       = document.getElementById("grantedName");
const grantedRole       = document.getElementById("grantedRole");
const deniedReason      = document.getElementById("deniedReason");

const ctx = overlayCanvas.getContext("2d");

// ══════════════════════════════════════════════════════════════════════════════
//  VOICE ENGINE  — Web Speech API (speechSynthesis)
//
//  Browsers require at least one user gesture before audio can play.
//  The "Start Authentication" button click satisfies this requirement,
//  so all speak() calls after that point work without restriction.
//  The boot-ready prompt fires on button-enabled, which is after models load
//  (still within the same page session, no gesture needed for synthesis).
// ══════════════════════════════════════════════════════════════════════════════
let _voice = null;   // selected SpeechSynthesisVoice

function initVoice() {
  if (!window.speechSynthesis) return;   // browser doesn't support it

  function pickVoice() {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;

    // Preference order:
    //  1. Google UK English Female  (Chrome, very natural)
    //  2. Microsoft Zira / Aria / Jenny  (Edge)
    //  3. Any en-GB voice
    //  4. Any en-US voice
    //  5. First available voice
    const preferred = [
      "Google UK English Female",
      "Microsoft Zira Desktop - English (United States)",
      "Microsoft Aria Online (Natural) - English (United States)",
      "Microsoft Jenny Online (Natural) - English (United States)",
    ];
    for (const name of preferred) {
      const v = voices.find((v) => v.name === name);
      if (v) { _voice = v; return; }
    }
    _voice =
      voices.find((v) => v.lang.startsWith("en-GB")) ||
      voices.find((v) => v.lang.startsWith("en"))    ||
      voices[0];
  }

  pickVoice();
  // Chrome loads voices asynchronously
  speechSynthesis.onvoiceschanged = pickVoice;
}

/**
 * speak(text, options)
 * Fire-and-forget: cancels any current speech, then speaks immediately.
 * Returns a Promise that resolves when speech ends (or instantly if
 * speechSynthesis is unavailable).
 *
 * @param {string}  text
 * @param {object}  [opts]
 * @param {number}  [opts.rate=1.0]   — speech rate (0.5 – 2.0)
 * @param {number}  [opts.pitch=1.0]  — pitch (0.0 – 2.0)
 * @param {number}  [opts.volume=1.0] — volume (0.0 – 1.0)
 * @param {boolean} [opts.wait=false] — if true, caller awaits speech end
 */
function speak(text, opts = {}) {
  if (!window.speechSynthesis) return Promise.resolve();

  speechSynthesis.cancel();   // stop anything currently playing

  return new Promise((resolve) => {
    const utt       = new SpeechSynthesisUtterance(text);
    utt.voice       = _voice  || null;
    utt.rate        = opts.rate   ?? 1.0;
    utt.pitch       = opts.pitch  ?? 1.05;
    utt.volume      = opts.volume ?? 1.0;
    utt.lang        = "en-US";
    utt.onend       = resolve;
    utt.onerror     = resolve;   // don't let a speech error stall the pipeline
    speechSynthesis.speak(utt);
  });
}

/**
 * speakAndWait(text, opts)
 * Speaks and AWAITS completion before returning — use before a challenge
 * so the user hears the full instruction before detection starts.
 */
async function speakAndWait(text, opts = {}) {
  await speak(text, { ...opts, wait: true });
}

// ══════════════════════════════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════════════════════════════
async function boot() {
  initVoice();
  setStatus("Loading models...");
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
    ]);
    setStatus("Starting camera...");
    await startCamera();
    await initMediaPipe();
    setStatus("Ready — click Start Authentication");
    startAuthBtn.disabled = false;
    // Voice prompt after models are ready (still needs user gesture to unlock
    // audio context in some browsers, so we speak on button click instead)
  } catch (err) {
    setStatus("Setup failed: " + err.message, "error");
    console.error("[Auth] Boot error:", err);
  }
}

async function startCamera() {
  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" },
    audio: false,
  });
  video.srcObject = cameraStream;
  await new Promise((res) => { video.onloadedmetadata = res; });
  overlayCanvas.width  = video.videoWidth;
  overlayCanvas.height = video.videoHeight;
}

function initMediaPipe() {
  return new Promise((resolve, reject) => {
    faceMesh = new FaceMesh({
      locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
    });
    faceMesh.setOptions({
      maxNumFaces:            1,
      refineLandmarks:        true,
      minDetectionConfidence: 0.6,
      minTrackingConfidence:  0.6,
    });
    faceMesh.onResults((results) => {
      latestLandmarks =
        results.multiFaceLandmarks?.length > 0
          ? results.multiFaceLandmarks[0]
          : null;
      drawIdleOverlay();
    });
    mpCamera = new Camera(video, {
      onFrame: async () => { if (faceMesh) await faceMesh.send({ image: video }); },
      width: 640, height: 480,
    });
    mpCamera.start().then(resolve).catch(reject);
  });
}

function drawIdleOverlay() {
  if (isRunning) return;
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!latestLandmarks) return;
  drawBox(ctx, landmarksBoundingBox(latestLandmarks), "#64748b", "Face detected — ready");
}

// ══════════════════════════════════════════════════════════════════════════════
//  GEOMETRY
// ══════════════════════════════════════════════════════════════════════════════
function lmPx(lm) {
  return { x: lm.x * overlayCanvas.width, y: lm.y * overlayCanvas.height };
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function getYawRatio(lm) {
  const nose = lmPx(lm[LM.NOSE_TIP]);
  const lEye = lmPx(lm[LM.L_EYE_OUTER]);
  const rEye = lmPx(lm[LM.R_EYE_OUTER]);
  const dL = dist(nose, lEye), dR = dist(nose, rEye);
  return dL / (dL + dR);
}

function earFromIndices(lm, idx) {
  const [p0,p1,p2,p3,p4,p5] = idx.map((i) => lmPx(lm[i]));
  return (dist(p1,p5) + dist(p2,p4)) / (2 * dist(p0,p3));
}

function getBinocularEAR(lm) {
  return (earFromIndices(lm, LM.L_EYE) + earFromIndices(lm, LM.R_EYE)) / 2;
}

function median(arr) {
  const s = [...arr].sort((a,b) => a-b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2;
}

function landmarksBoundingBox(lm) {
  const xs = lm.map((l) => l.x * video.videoWidth);
  const ys = lm.map((l) => l.y * video.videoHeight);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function nextMPFrame() { return new Promise((r) => requestAnimationFrame(r)); }

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN PIPELINE
// ══════════════════════════════════════════════════════════════════════════════
startAuthBtn.addEventListener("click", async () => {
  if (isRunning) return;
  isRunning = true;

  resetSteps();
  showPanel("processing");
  const embeddingsPromise = loadStoredEmbeddings();

  // First speak() after user gesture — audio context now unlocked in all browsers
  speak("Starting authentication. Please look straight at the camera.");

  // ── Stage 1: Calibration ─────────────────────────────────────────────────
  setStep(1, "active", "Calibrating...");
  livenessBanner.style.display = "flex";
  setChallengeUI("📐", "Hold still — calibrating your face...");
  setStatus("Look straight at the camera. Hold still.");
  setProcessing("Calibrating face baseline...");

  const calib = await runCalibration();
  if (!calib) {
    speak("Calibration failed. Please keep your face in frame and try again.");
    return livenessFailure("Calibration failed — keep your face in frame and hold still.");
  }

  const { baselineYaw, baselineEAR } = calib;
  const earClosed = baselineEAR * EAR_CLOSE_RATIO;
  const earOpen   = baselineEAR * EAR_OPEN_RATIO;
  console.log(`[Calib] yaw=${baselineYaw.toFixed(3)} EAR=${baselineEAR.toFixed(3)} ` +
              `closed<${earClosed.toFixed(3)} open>${earOpen.toFixed(3)}`);

  // ── Stage 2: Random head-turn challenges ─────────────────────────────────
  const turnOrder = Math.random() < 0.5 ? ["left", "right"] : ["right", "left"];

  for (const dir of turnOrder) {
    const emoji = dir === "left" ? "⬅️" : "➡️";
    const word  = dir === "left" ? "LEFT"  : "RIGHT";
    const spoken = dir === "left" ? "left"  : "right";

    setChallengeUI(emoji, `Slowly turn your head <strong>${word}</strong>`);
    setStatus(`Turn your head ${word}...`);
    setStep(1, "active", `Turn ${word}...`);
    setProcessing(`Head turn: ${word}`);

    // Speak instruction and wait for it to finish before watching for the turn
    await speakAndWait(`Now slowly turn your head to the ${spoken}. Keep turning until you hear a confirmation.`);

    const turned = await runHeadTurn(dir, baselineYaw);
    if (!turned) {
      speak(`Head turn ${spoken} was not detected. Please try again.`);
      return livenessFailure(`Head turn ${word} not detected — turn your head clearly to the ${spoken}.`);
    }

    // Confirmed — positive feedback + centre prompt
    speak("Good. Now look straight ahead.");
    setChallengeUI("🎯", "Good! Look straight ahead again.");
    setStatus("Return to centre...");
    await waitForCentre(baselineYaw);
  }

  // ── Stage 3: Blink ───────────────────────────────────────────────────────
  setChallengeUI("👁️", "Now please <strong>BLINK</strong> once naturally");
  setStatus("Blink once...");
  setStep(1, "active", "Blink...");
  setProcessing("Blink detection...");

  await speakAndWait("Now please blink once, naturally. Just a normal blink.");

  const blinked = await runBlink(earClosed, earOpen);
  if (!blinked) {
    speak("Blink was not detected. Please try again.");
    return livenessFailure("Blink not detected — please blink naturally once when prompted.");
  }

  speak("Thank you. Checking your identity now. Please hold still.");
  setStep(1, "pass", "Live ✓");
  livenessBanner.style.display = "none";

  // ── Stage 4: Recognition ─────────────────────────────────────────────────
  setStep(2, "active", "Matching...");
  setProcessing("Comparing face — hold still...");
  setStatus("Hold still for recognition...");

  await embeddingsPromise;
  const match = await runRecognition();

  if (!match) {
    speak("Face not recognised. Access denied. Please contact an administrator if this is an error.");
    setStep(2, "fail", "Not recognised");
    setStep(3, "fail", "Denied ✗");
    await postDecision(1, 0, null);
    showDenied("Face not recognised — you are not registered in this system.");
    isRunning = false;
    return;
  }

  setStep(2, "pass", "Matched ✓");

  // ── Stage 5: Decision ────────────────────────────────────────────────────
  setStep(3, "active", "Deciding...");
  setProcessing("Applying access control decision...");

  await postDecision(1, 1, match.userId);
  setStep(3, "pass", "Granted ✓");

  // Greet by first name only — more natural
  const firstName = match.fullName.trim().split(/\s+/)[0];
  speak(`Identity confirmed. Welcome, ${firstName}. Access granted.`);

  showGranted(match.fullName, match.role);
  isRunning = false;
});

// ══════════════════════════════════════════════════════════════════════════════
//  CALIBRATION
// ══════════════════════════════════════════════════════════════════════════════
async function runCalibration() {
  const deadline   = Date.now() + CALIBRATION_MS;
  const yawSamples = [];
  const earSamples = [];

  while (Date.now() < deadline) {
    await nextMPFrame();
    if (!latestLandmarks) continue;

    const lm  = latestLandmarks;
    const yaw = getYawRatio(lm);
    const ear = getBinocularEAR(lm);

    if (isFinite(yaw) && isFinite(ear) && ear > 0.05) {
      yawSamples.push(yaw);
      earSamples.push(ear);
    }

    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    const pct = Math.round(
      (Date.now() - (deadline - CALIBRATION_MS)) / CALIBRATION_MS * 100
    );
    drawBox(ctx, landmarksBoundingBox(lm), "#a78bfa", `Calibrating ${Math.min(pct,100)}%`);
  }

  if (yawSamples.length < 5) return null;
  return { baselineYaw: median(yawSamples), baselineEAR: median(earSamples) };
}

// ══════════════════════════════════════════════════════════════════════════════
//  HEAD-TURN DETECTION
// ══════════════════════════════════════════════════════════════════════════════
async function runHeadTurn(direction, baselineYaw) {
  const deadline = Date.now() + HEAD_WINDOW_MS;
  const yawHist  = [];
  let confirmed  = false;
  let remindedAt = 0;   // timestamp of last "keep turning" nudge

  while (Date.now() < deadline && !confirmed) {
    await nextMPFrame();
    if (!latestLandmarks) continue;

    const lm       = latestLandmarks;
    const yaw      = getYawRatio(lm);
    yawHist.push(yaw);
    if (yawHist.length > YAW_HISTORY) yawHist.shift();
    const smoothYaw = median(yawHist);
    const delta     = smoothYaw - baselineYaw;

    // MediaPipe landmark coords are in the RAW (unmirrored) video frame.
    // The CSS mirror (scaleX(-1)) flips what the user sees but NOT the landmarks.
    // In the raw frame: person turns their head LEFT → nose moves RIGHT in raw coords
    // → dist(nose, lEye) INCREASES → yawRatio RISES (delta > 0).
    // The bar correctly uses Math.abs(delta), which is why it shows 100%.
    // But the sign checks below were backwards — this is the fix:
    if (direction === "left"  && delta >  YAW_THRESHOLD) confirmed = true;
    if (direction === "right" && delta < -YAW_THRESHOLD) confirmed = true;

    // If the user is slow, remind them verbally every 4 s
    if (!confirmed) {
      const pct = Math.min(100, Math.round(Math.abs(delta) / YAW_THRESHOLD * 100));
      if (pct < 60 && Date.now() - remindedAt > 4000) {
        speak(`Keep turning your head to the ${direction}. You are ${pct} percent of the way.`, { rate: 1.1 });
        remindedAt = Date.now();
      }
    }

    // Visual feedback
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    const box      = landmarksBoundingBox(lm);
    const progress = Math.max(0, deadline - Date.now()) / HEAD_WINDOW_MS;
    const have     = Math.abs(delta);
    const pct      = Math.min(100, Math.round(have / YAW_THRESHOLD * 100));
    const color    = confirmed ? "#22c55e" : "#f97316";
    const arrow    = direction === "left" ? "⟵" : "⟶";

    drawBox(ctx, box, color,
      confirmed
        ? `${arrow} Turn detected ✓`
        : `${arrow} Turn ${direction.toUpperCase()} — ${pct}%`
    );
    drawCountdownArc(ctx, box, progress);
    drawYawBar(smoothYaw, baselineYaw, direction);
  }

  return confirmed;
}

// ══════════════════════════════════════════════════════════════════════════════
//  WAIT FOR CENTRE
// ══════════════════════════════════════════════════════════════════════════════
async function waitForCentre(baselineYaw) {
  const deadline = Date.now() + 4000;
  let centredSince = null;

  while (Date.now() < deadline) {
    await nextMPFrame();
    if (!latestLandmarks) continue;

    const yaw       = getYawRatio(latestLandmarks);
    const delta     = Math.abs(yaw - baselineYaw);
    const isCentred = delta < YAW_THRESHOLD * 0.7;

    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    drawBox(
      ctx,
      landmarksBoundingBox(latestLandmarks),
      isCentred ? "#22c55e" : "#a78bfa",
      isCentred ? "Centred ✓" : "Return to centre..."
    );

    if (isCentred) {
      if (!centredSince) centredSince = Date.now();
      if (Date.now() - centredSince > CENTRE_HOLD_MS) return;
    } else {
      centredSince = null;
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  BLINK DETECTION
// ══════════════════════════════════════════════════════════════════════════════
async function runBlink(earClosed, earOpen) {
  const deadline    = Date.now() + BLINK_WINDOW_MS;
  const earHist     = [];
  let eyeWasClosed  = false;
  let confirmed     = false;
  let remindedAt    = 0;

  while (Date.now() < deadline && !confirmed) {
    await nextMPFrame();
    if (!latestLandmarks) continue;

    const rawEAR = getBinocularEAR(latestLandmarks);
    earHist.push(rawEAR);
    if (earHist.length > 5) earHist.shift();
    const ear = median(earHist);

    if (ear < earClosed && !eyeWasClosed) {
      eyeWasClosed = true;
      speak("Eyes closing. Good.", { rate: 1.2 });
      console.log(`[Blink] Closed EAR=${ear.toFixed(3)} threshold=${earClosed.toFixed(3)}`);
    }
    if (eyeWasClosed && ear > earOpen) {
      confirmed = true;
      console.log(`[Blink] Open EAR=${ear.toFixed(3)}`);
    }

    // Remind if no blink in first 4 s
    if (!confirmed && !eyeWasClosed && Date.now() - remindedAt > 4000) {
      speak("Please blink once — just a normal, natural blink.", { rate: 1.0 });
      remindedAt = Date.now();
    }

    // Visual
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    const box      = landmarksBoundingBox(latestLandmarks);
    const progress = Math.max(0, deadline - Date.now()) / BLINK_WINDOW_MS;
    const color    = confirmed ? "#22c55e" : eyeWasClosed ? "#a78bfa" : "#f97316";
    const label    = confirmed
      ? "Blink detected ✓"
      : eyeWasClosed
        ? "Opening..."
        : `Blink when ready  EAR: ${ear.toFixed(2)}`;

    drawBox(ctx, box, color, label);
    drawCountdownArc(ctx, box, progress);
    drawEARBar(ear, earClosed, earOpen);
  }

  return confirmed;
}

// ══════════════════════════════════════════════════════════════════════════════
//  FACE RECOGNITION
// ══════════════════════════════════════════════════════════════════════════════
async function runRecognition() {
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!storedEmbeddings.length) return null;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const det = await faceapi
      .detectSingleFace(video, DETECTOR_OPTIONS)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!det) { await new Promise((r) => requestAnimationFrame(r)); continue; }

    const labeled = storedEmbeddings.map(
      (e) => new faceapi.LabeledFaceDescriptors(
        JSON.stringify({ userId: e.userId, fullName: e.fullName, role: e.role }),
        [new Float32Array(e.descriptor)]
      )
    );
    const matcher = new faceapi.FaceMatcher(labeled, MATCH_THRESHOLD);
    const best    = matcher.findBestMatch(det.descriptor);

    console.log(`[Auth] attempt ${attempt} best="${best.label}" dist=${best.distance.toFixed(4)}`);

    if (best.label === "unknown") {
      drawBox(ctx, det.detection.box, "#ef4444", `No match (${best.distance.toFixed(3)})`);
      await new Promise((r) => requestAnimationFrame(r));
      continue;
    }

    const user = JSON.parse(best.label);
    drawBox(ctx, det.detection.box, "#22c55e", `${user.fullName} ✓`);
    return user;
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
//  DECISION
// ══════════════════════════════════════════════════════════════════════════════
async function postDecision(livenessResult, recognitionResult, userId) {
  try {
    const res  = await fetch(API_DECISION, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ livenessResult, recognitionResult, userId: userId ?? null }),
    });
    return await res.json();
  } catch (err) {
    console.error("[Auth] Decision POST failed:", err);
    return null;
  }
}

async function loadStoredEmbeddings() {
  try {
    const res  = await fetch(API_DESCRIPTORS);
    const data = await res.json();
    storedEmbeddings = data.success ? data.embeddings : [];
    console.log(`[Auth] Loaded ${storedEmbeddings.length} embeddings`);
  } catch (err) {
    storedEmbeddings = [];
    console.error("[Auth] Failed to load embeddings:", err);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  DRAWING
// ══════════════════════════════════════════════════════════════════════════════
function drawBox(ctx, box, color, label) {
  const sx = overlayCanvas.width  / video.videoWidth;
  const sy = overlayCanvas.height / video.videoHeight;
  const x = box.x*sx, y = box.y*sy, w = box.width*sx, h = box.height*sy;
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  const s = 14;
  [[[x,y+s],[x,y],[x+s,y]],[[x+w-s,y],[x+w,y],[x+w,y+s]],
   [[x,y+h-s],[x,y+h],[x+s,y+h]],[[x+w-s,y+h],[x+w,y+h],[x+w,y+h-s]]]
  .forEach(([a,b,c]) => { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.stroke(); });
  if (label) {
    ctx.font = "bold 11px Segoe UI, sans-serif";
    const pad = 6, tw = ctx.measureText(label).width + pad*2;
    ctx.fillStyle = color; ctx.fillRect(x, y-22, tw, 20);
    ctx.fillStyle = "#fff"; ctx.fillText(label, x+pad, y-7);
  }
}

function drawCountdownArc(ctx, box, progress) {
  const sx = overlayCanvas.width / video.videoWidth;
  const sy = overlayCanvas.height / video.videoHeight;
  const cx = (box.x + box.width/2)*sx, cy = (box.y + box.height/2)*sy;
  const r  = (Math.max(box.width, box.height)/2 + 14) * Math.min(sx,sy);
  ctx.strokeStyle = progress > 0.3 ? "#14b8a6" : "#f97316";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + 2*Math.PI*progress);
  ctx.stroke();
}

function drawYawBar(currentYaw, baselineYaw, direction) {
  const W = overlayCanvas.width, H = overlayCanvas.height;
  const barH = 8, y = H - barH - 4;
  const delta = currentYaw - baselineYaw;
  const pct   = Math.min(1, Math.abs(delta) / YAW_THRESHOLD);
  const filled = Math.round(W * pct);
  const color  = pct >= 1 ? "#22c55e" : "#f97316";
  ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(0, y, W, barH+4);
  ctx.fillStyle = color;
  // Left turn → delta > 0 in raw frame coords → fill from left edge.
  // Right turn → delta < 0 → fill from right edge (mirrored perspective matches what user sees).
  ctx.fillRect(direction === "right" ? W - filled : 0, y, filled, barH);
  ctx.fillStyle = "#fff"; ctx.font = "10px Segoe UI";
  ctx.fillText(`Yaw ${Math.round(pct*100)}%`, 6, y+barH-1);
}

function drawEARBar(ear, earClosed, earOpen) {
  const W = overlayCanvas.width, H = overlayCanvas.height;
  const barH = 8, y = H - barH - 4;
  const range  = earOpen - earClosed;
  const pct    = range > 0 ? Math.min(1, Math.max(0, (ear-earClosed)/range)) : 0;
  const filled = Math.round(W * pct);
  const color  = ear < earClosed ? "#a78bfa" : "#14b8a6";
  ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(0, y, W, barH+4);
  ctx.fillStyle = color; ctx.fillRect(0, y, filled, barH);
  ctx.fillStyle = "#fff"; ctx.font = "10px Segoe UI";
  ctx.fillText(`EAR ${ear.toFixed(2)} (blink < ${earClosed.toFixed(2)})`, 6, y+barH-1);
}

// ══════════════════════════════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function livenessFailure(reason) {
  setStep(1, "fail", "Failed ✗");
  setStep(3, "fail", "Denied ✗");
  livenessBanner.style.display = "none";
  postDecision(0, 0, null);
  showDenied(reason);
  isRunning = false;
}

function setChallengeUI(icon, html) {
  challengeIcon.textContent = icon;
  challengeText.innerHTML   = html;
}

function setStatus(msg, type = "info") {
  cameraStatus.textContent      = msg;
  cameraStatus.style.background = type === "error" ? "rgba(239,68,68,.8)" : "rgba(0,0,0,.75)";
}

function setStep(n, state, label) {
  document.getElementById(`step${n}`).className         = `auth-step step-${state}`;
  document.getElementById(`step${n}Status`).textContent = label;
}

function resetSteps()         { [1,2,3].forEach((n) => setStep(n,"","Waiting")); }
function setProcessing(msg)   { processingMessage.textContent = msg; }

function showPanel(name) {
  ["idle","processing","granted","denied"].forEach((p) => {
    document.getElementById("result" + p[0].toUpperCase() + p.slice(1)).style.display =
      p === name ? "block" : "none";
  });
}

function showGranted(name, role) {
  grantedName.textContent = name;
  grantedRole.textContent = `${role} — Computer Science Department`;
  showPanel("granted");
  setStatus("Access granted ✓");
}

function showDenied(reason) {
  deniedReason.textContent = reason;
  showPanel("denied");
  setStatus("Access denied ✗", "error");
}

function resetAuth() {
  // Stop any in-progress speech when resetting
  if (window.speechSynthesis) speechSynthesis.cancel();
  isRunning       = false;
  latestLandmarks = null;
  resetSteps();
  showPanel("idle");
  setStatus("Ready — click Start Authentication");
}

tryAgainBtn.addEventListener("click",  resetAuth);
authAgainBtn.addEventListener("click", resetAuth);

startAuthBtn.disabled = true;
boot();
