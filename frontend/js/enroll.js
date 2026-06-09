/**
 * enroll.js — v2
 * Added: duplicate face check before submit, photoData capture (base64 JPEG)
 */
"use strict";

const MODELS_URL   = "/assets/models";
const API_ENROLL   = "/api/enroll";
const API_DUP      = "/api/enroll/check-duplicate";

const DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });

let capturedDescriptor = null;
let capturedPhotoData  = null;
let detectionLoop      = null;
let stream             = null;

const video          = document.getElementById("video");
const overlayCanvas  = document.getElementById("overlay");
const cameraStatus   = document.getElementById("cameraStatus");
const cameraHint     = document.getElementById("cameraHint");
const captureBtn     = document.getElementById("captureBtn");
const enrollBtn      = document.getElementById("enrollBtn");
const retakeBtn      = document.getElementById("retakeBtn");
const capturePreview = document.getElementById("capturePreview");
const previewCanvas  = document.getElementById("previewCanvas");
const resultBox      = document.getElementById("resultBox");
const dupWarning     = document.getElementById("dupWarning");

const fullNameInput = document.getElementById("fullName");
const emailInput    = document.getElementById("email");
const roleSelect    = document.getElementById("role");
const deptInput     = document.getElementById("department");

async function loadModels() {
  setStatus("Loading face detection models...");
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
    ]);
    setStatus("Models loaded. Starting camera...");
    await startCamera();
  } catch (err) { setStatus("Failed to load models: " + err.message, "error"); }
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width:420, height:315, facingMode:"user" }, audio:false });
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      overlayCanvas.width  = video.videoWidth;
      overlayCanvas.height = video.videoHeight;
      setStatus("Camera ready. Look straight at the camera.");
      startDetectionLoop();
    };
  } catch (err) {
    setStatus(err.name === "NotAllowedError"
      ? "Camera access denied." : "Camera error: " + err.message, "error");
  }
}

function startDetectionLoop() {
  const ctx = overlayCanvas.getContext("2d");
  async function detect() {
    if (video.paused || video.ended) return;
    const det = await faceapi.detectSingleFace(video, DETECTOR_OPTIONS).withFaceLandmarks().withFaceDescriptor();
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (det) {
      const { box } = det.detection;
      const sx = overlayCanvas.width / video.videoWidth;
      const sy = overlayCanvas.height / video.videoHeight;
      const x = box.x*sx, y = box.y*sy, w = box.width*sx, h = box.height*sy;
      ctx.strokeStyle="#14b8a6"; ctx.lineWidth=3; ctx.strokeRect(x,y,w,h);
      drawCorners(ctx,x,y,w,h,16,"#14b8a6");
      const score = (det.detection.score*100).toFixed(0);
      ctx.fillStyle="rgba(20,184,166,.85)"; ctx.fillRect(x,y-22,90,20);
      ctx.fillStyle="#fff"; ctx.font="bold 12px Segoe UI,sans-serif";
      ctx.fillText(`Face  ${score}%`,x+6,y-7);
      setStatus("Face detected ✓ — click Capture when ready.");
      captureBtn.disabled = false;
      captureBtn.dataset.lastDescriptor = JSON.stringify(Array.from(det.descriptor));
    } else {
      setStatus("No face detected — adjust position or lighting.");
      captureBtn.disabled = true;
    }
    detectionLoop = requestAnimationFrame(detect);
  }
  detect();
}

function drawCorners(ctx,x,y,w,h,s,c) {
  ctx.strokeStyle=c; ctx.lineWidth=4; ctx.lineCap="round";
  [[[x,y+s],[x,y],[x+s,y]],[[x+w-s,y],[x+w,y],[x+w,y+s]],
   [[x,y+h-s],[x,y+h],[x+s,y+h]],[[x+w-s,y+h],[x+w,y+h],[x+w,y+h-s]]]
  .forEach(([a,b,c])=>{ ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.stroke(); });
}

captureBtn.addEventListener("click", async () => {
  const raw = captureBtn.dataset.lastDescriptor;
  if (!raw) { setStatus("No face detected yet.", "warn"); return; }

  const descriptor = JSON.parse(raw);
  cancelAnimationFrame(detectionLoop); detectionLoop=null;

  // Capture photo (mirrored JPEG, ≤200KB)
  const photoCanvas = document.createElement("canvas");
  photoCanvas.width = video.videoWidth; photoCanvas.height = video.videoHeight;
  const pCtx = photoCanvas.getContext("2d");
  pCtx.save(); pCtx.scale(-1,1); pCtx.drawImage(video,-photoCanvas.width,0); pCtx.restore();

  // Draw same snapshot to preview
  const pvCtx = previewCanvas.getContext("2d");
  previewCanvas.width = video.videoWidth; previewCanvas.height = video.videoHeight;
  pvCtx.drawImage(photoCanvas, 0, 0);

  capturedPhotoData  = photoCanvas.toDataURL("image/jpeg", 0.7);
  capturedDescriptor = descriptor;

  // Live duplicate check
  setStatus("Checking for duplicate face...");
  try {
    const r = await fetch(API_DUP, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ descriptor })
    });
    const d = await r.json();
    if (d.isDuplicate) {
      capturedDescriptor = null; capturedPhotoData = null;
      if (dupWarning) {
        dupWarning.textContent = `⚠ This face matches an existing account: ${d.matchedUser.fullName} (${d.matchedUser.email}). Duplicate enrolment is not allowed.`;
        dupWarning.style.display = "block";
      }
      setStatus("Duplicate face detected — enrolment blocked.", "error");
      startDetectionLoop();
      return;
    }
    if (dupWarning) dupWarning.style.display = "none";
  } catch { /* non-blocking — server validates too */ }

  capturePreview.style.display = "block";
  enrollBtn.disabled = false; captureBtn.disabled = true;
  setStatus("Face captured ✓ — fill in the form and click Enrol User.");
  cameraHint.textContent = "Click Retake to capture again.";
});

retakeBtn.addEventListener("click", () => {
  capturedDescriptor = null; capturedPhotoData = null;
  capturePreview.style.display = "none";
  enrollBtn.disabled = true;
  if (dupWarning) dupWarning.style.display = "none";
  hideResult();
  setStatus("Look at the camera and click Capture when ready.");
  cameraHint.textContent = "Position your face inside the frame, then click Capture.";
  startDetectionLoop();
});

enrollBtn.addEventListener("click", async () => {
  const fullName   = fullNameInput.value.trim();
  const email      = emailInput.value.trim();
  const role       = roleSelect.value;
  const department = deptInput.value.trim();

  if (!fullName)   return showResult("Please enter the full name.", "error");
  if (!email)      return showResult("Please enter an email address.", "error");
  if (!role)       return showResult("Please select a role.", "error");
  if (!department) return showResult("Please enter a department.", "error");
  if (!capturedDescriptor) return showResult("No face captured. Please capture a face first.", "error");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showResult("Please enter a valid email address.", "error");

  enrollBtn.disabled = true; enrollBtn.textContent = "Enrolling...";

  try {
    const res  = await fetch(API_ENROLL, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ fullName, email, role, department, descriptor:capturedDescriptor, photoData:capturedPhotoData }),
    });
    const data = await res.json();
    if (data.success) {
      showResult(`✓ ${data.message}`, "success");
      setTimeout(resetForm, 3000);
    } else {
      showResult(data.message || "Enrolment failed.", "error");
      enrollBtn.disabled = false; enrollBtn.textContent = "Enrol User";
    }
  } catch (err) {
    showResult("Server error. Make sure the server is running.", "error");
    enrollBtn.disabled = false; enrollBtn.textContent = "Enrol User";
  }
});

function setStatus(msg, type="info") {
  cameraStatus.textContent = msg;
  cameraStatus.style.background =
    type==="error" ? "rgba(239,68,68,.8)" : type==="warn" ? "rgba(249,115,22,.8)" : "rgba(0,0,0,.6)";
}
function showResult(msg, type) {
  resultBox.textContent = msg; resultBox.className=`result-box ${type}`; resultBox.style.display="block";
}
function hideResult() { resultBox.style.display = "none"; }
function resetForm() {
  fullNameInput.value=""; emailInput.value=""; roleSelect.value=""; deptInput.value="Computer Science";
  capturedDescriptor=null; capturedPhotoData=null;
  capturePreview.style.display="none"; enrollBtn.disabled=true; enrollBtn.textContent="Enrol User";
  if (dupWarning) dupWarning.style.display="none";
  hideResult();
  setStatus("Ready. Look at the camera and click Capture.");
  cameraHint.textContent="Position your face inside the frame, then click Capture.";
  startDetectionLoop();
}

loadModels();
