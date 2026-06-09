/**
 * routes/auth.js
 * Handles facial authentication.
 *
 * GET  /api/auth/descriptors
 *   Returns all stored face descriptors so face-api.js can match client-side.
 *   Response: { success, embeddings: [{ userId, fullName, role, department, descriptor[] }] }
 *
 * POST /api/auth/log
 *   Records the outcome of an authentication attempt.
 *   Body: { userId (nullable), outcome: "Granted"|"Denied", reason }
 *   Response: { success, logId }
 *
 * POST /api/auth/decision
 *   Applies the access control equation A = R × L server-side for audit.
 *   Body: { recognitionResult: 0|1, livenessResult: 0|1, userId, ipAddress }
 *   Response: { success, access: 0|1, message }
 */

const express = require("express");
const router  = express.Router();
const db      = require("../db");

// ── GET /api/auth/descriptors ──────────────────────────────────────────────
router.get("/descriptors", async (req, res) => {
  try {
    const result = await db.getAllEmbeddings();
    if (result.status === "error") {
      return res.status(500).json({ success: false, message: result.message });
    }
    return res.json({ success: true, embeddings: result.embeddings });
  } catch (err) {
    console.error("[Auth] Error fetching descriptors:", err.message);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
});

// ── POST /api/auth/decision ─────────────────────────────────────────────────
router.post("/decision", async (req, res) => {
  const { recognitionResult, livenessResult, userId, ipAddress } = req.body;

  // Validate inputs
  const R = Number(recognitionResult);
  const L = Number(livenessResult);

  if (![0, 1].includes(R) || ![0, 1].includes(L)) {
    return res.status(400).json({
      success: false,
      message: "recognitionResult and livenessResult must each be 0 or 1.",
    });
  }

  // Access Control Equation: A = R × L
  const A = R * L;

  let outcome, reason;

  if (A === 1) {
    outcome = "Granted";
    reason  = "Facial recognition and liveness detection both passed.";
  } else if (L === 0) {
    outcome = "Denied";
    reason  = "Liveness check failed — possible spoof attempt detected.";
  } else {
    outcome = "Denied";
    reason  = "Face not recognised — user not registered in the system.";
  }

  // Log the event
  try {
    const logResult = await db.createLog(
      userId || null,
      outcome,
      reason,
      ipAddress || req.ip
    );

    return res.json({
      success: true,
      access:  A,
      outcome,
      reason,
      logId: logResult.logId,
    });
  } catch (err) {
    console.error("[Auth] Error logging decision:", err.message);
    return res.status(500).json({ success: false, message: "Decision made but log failed." });
  }
});

// ── POST /api/auth/log (standalone log — fallback if decision endpoint not used) ──
router.post("/log", async (req, res) => {
  const { userId, outcome, reason, ipAddress } = req.body;

  if (!outcome || !["Granted", "Denied"].includes(outcome)) {
    return res.status(400).json({
      success: false,
      message: "outcome must be 'Granted' or 'Denied'.",
    });
  }

  try {
    const result = await db.createLog(
      userId || null,
      outcome,
      reason || "",
      ipAddress || req.ip
    );
    return res.json({ success: true, logId: result.logId });
  } catch (err) {
    console.error("[Auth] Log error:", err.message);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
});

module.exports = router;
