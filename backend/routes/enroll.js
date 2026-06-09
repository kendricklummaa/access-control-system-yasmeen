/**
 * routes/enroll.js — v2
 *
 * POST /api/enroll
 *   Body: { fullName, email, role, department, descriptor[], photoData? }
 *   1. Validates all fields
 *   2. Checks for duplicate face (descriptor similarity against stored embeddings)
 *   3. Creates user record (with optional base64 photo)
 *   4. Saves face descriptor
 *   Returns: { success, userId, message }
 *
 * GET /api/enroll/check-duplicate
 *   Body: { descriptor[] }
 *   Returns: { success, isDuplicate, matchedUser? }
 */

const express = require("express");
const router  = express.Router();
const db      = require("../db");

// ── Duplicate face pre-check (called live from enroll.js before submission) ─
router.post("/check-duplicate", async (req, res) => {
  const { descriptor } = req.body;
  if (!Array.isArray(descriptor) || descriptor.length === 0)
    return res.status(400).json({ success:false, message:"descriptor required" });
  try {
    const r = await db.checkDuplicateFace(descriptor);
    return res.json({ success:true, isDuplicate: r.isDuplicate, matchedUser: r.matchedUser || null, distance: r.distance });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
});

// ── Full enrolment ──────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const { fullName, email, role, department, descriptor, photoData } = req.body;

  if (!fullName || !email || !role || !department || !descriptor)
    return res.status(400).json({ success:false, message:"All fields required: fullName, email, role, department, descriptor." });
  if (!Array.isArray(descriptor) || descriptor.length === 0)
    return res.status(400).json({ success:false, message:"Invalid face descriptor." });
  if (!["Student","Staff"].includes(role))
    return res.status(400).json({ success:false, message:"Role must be Student or Staff." });

  try {
    // 1. Duplicate face check
    const dupCheck = await db.checkDuplicateFace(descriptor);
    if (dupCheck.isDuplicate) {
      return res.status(409).json({
        success: false,
        message: `This face is already registered to ${dupCheck.matchedUser.fullName} (${dupCheck.matchedUser.email}). Duplicate enrolment is not allowed.`,
        isDuplicate: true,
        matchedUser: dupCheck.matchedUser,
      });
    }

    // 2. Create user
    const userResult = await db.createUser({ fullName, email, role, department, photoData: photoData || null });
    if (userResult.status === "error") {
      return res.status(409).json({
        success: false,
        message: userResult.message.includes("UNIQUE")
          ? "A user with this email address is already registered."
          : userResult.message,
      });
    }

    const userId = userResult.userId;

    // 3. Save descriptor
    const embResult = await db.saveEmbedding(userId, descriptor);
    if (embResult.status === "error")
      return res.status(500).json({ success:false, message:"User created but face data could not be saved: " + embResult.message });

    return res.status(201).json({ success:true, userId, message:`${fullName} enrolled successfully.` });

  } catch (err) {
    console.error("[Enroll] Unexpected error:", err.message);
    res.status(500).json({ success:false, message:"Internal server error." });
  }
});

module.exports = router;
