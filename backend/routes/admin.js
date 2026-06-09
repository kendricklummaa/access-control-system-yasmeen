/**
 * routes/admin.js — v2
 *
 * GET    /api/admin/users              list all users (with Status, Photo)
 * PATCH  /api/admin/users/:id/status   { status: Active|Inactive|Suspended }
 * DELETE /api/admin/users/:id          delete user + cascade
 * GET    /api/admin/users/:id/profile  full profile + auth stats + recent logs
 * GET    /api/admin/logs               access logs (optional ?outcome=)
 * GET    /api/admin/stats              dashboard summary stats
 * GET    /api/admin/attendance         attendance records (?date= &department= &role=)
 * GET    /api/admin/analytics          chart data (?days=)
 * GET    /api/admin/policies           list policies
 * POST   /api/admin/policies           create policy
 * PUT    /api/admin/policies/:id       update policy
 * DELETE /api/admin/policies/:id       delete policy
 * GET    /api/admin/export/attendance  CSV download
 * GET    /api/admin/export/logs        CSV download
 */

const express = require("express");
const router  = express.Router();
const db      = require("../db");

// ── Users ──────────────────────────────────────────────────────────────────
router.get("/users", async (req, res) => {
  try {
    const r = await db.getUsers();
    if (r.status === "error") return res.status(500).json({ success:false, message:r.message });
    return res.json({ success:true, users: r.users });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
});

router.get("/users/:id/profile", async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId)) return res.status(400).json({ success:false, message:"Invalid user ID" });
  try {
    const r = await db.getUserProfile(userId);
    if (r.status === "error") return res.status(404).json({ success:false, message:r.message });
    return res.json({ success:true, ...r });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
});

router.patch("/users/:id/status", async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { status } = req.body;
  if (isNaN(userId)) return res.status(400).json({ success:false, message:"Invalid user ID" });
  if (!["Active","Inactive","Suspended"].includes(status))
    return res.status(400).json({ success:false, message:"status must be Active|Inactive|Suspended" });
  try {
    const r = await db.updateUserStatus(userId, status);
    if (r.status === "error") return res.status(404).json({ success:false, message:r.message });
    return res.json({ success:true, message: r.message });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
});

router.delete("/users/:id", async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId)) return res.status(400).json({ success:false, message:"Invalid user ID" });
  try {
    const r = await db.deleteUser(userId);
    if (r.status === "error") return res.status(404).json({ success:false, message:r.message });
    return res.json({ success:true, message:"User and associated data deleted." });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
});

// ── Logs ───────────────────────────────────────────────────────────────────
router.get("/logs", async (req, res) => {
  const { outcome } = req.query;
  if (outcome && !["Granted","Denied"].includes(outcome))
    return res.status(400).json({ success:false, message:"outcome must be Granted|Denied" });
  try {
    const r = await db.getLogs(outcome || null);
    if (r.status === "error") return res.status(500).json({ success:false, message:r.message });
    return res.json({ success:true, logs: r.logs });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
});

// ── Stats ──────────────────────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const r = await db.getStats();
    if (r.status === "error") return res.status(500).json({ success:false, message:r.message });
    return res.json({ success:true, stats: r.stats });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
});

// ── Attendance ─────────────────────────────────────────────────────────────
router.get("/attendance", async (req, res) => {
  const { date, department, role } = req.query;
  try {
    const r = await db.getAttendance({ date, department, role });
    if (r.status === "error") return res.status(500).json({ success:false, message:r.message });
    return res.json({ success:true, attendance: r.attendance });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
});

// ── Analytics ──────────────────────────────────────────────────────────────
router.get("/analytics", async (req, res) => {
  const days = parseInt(req.query.days, 10) || 14;
  try {
    const r = await db.getAnalytics(days);
    if (r.status === "error") return res.status(500).json({ success:false, message:r.message });
    return res.json({ success:true, analytics: r.analytics });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
});

// ── Policies ───────────────────────────────────────────────────────────────
router.get("/policies", async (req, res) => {
  try {
    const r = await db.getPolicies();
    return res.json({ success:true, policies: r.policies });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
});

router.post("/policies", async (req, res) => {
  const { policyName, targetType, targetValue, resource, isAllowed, startTime, endTime } = req.body;
  if (!policyName || !targetType || !targetValue)
    return res.status(400).json({ success:false, message:"policyName, targetType, targetValue required" });
  try {
    const r = await db.upsertPolicy({ policyName, targetType, targetValue, resource, isAllowed, startTime, endTime });
    return res.status(201).json({ success:true, policyId: r.policyId });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
});

router.put("/policies/:id", async (req, res) => {
  const policyId = parseInt(req.params.id, 10);
  if (isNaN(policyId)) return res.status(400).json({ success:false, message:"Invalid policy ID" });
  try {
    const r = await db.upsertPolicy({ ...req.body, policyId });
    return res.json({ success:true, policyId: r.policyId });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
});

router.delete("/policies/:id", async (req, res) => {
  const policyId = parseInt(req.params.id, 10);
  if (isNaN(policyId)) return res.status(400).json({ success:false, message:"Invalid policy ID" });
  try {
    const r = await db.deletePolicy(policyId);
    if (r.status === "error") return res.status(404).json({ success:false, message:r.message });
    return res.json({ success:true });
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
});

// ── CSV Exports ────────────────────────────────────────────────────────────
router.get("/export/attendance", async (req, res) => {
  const { date, department, role } = req.query;
  try {
    const r = await db.exportAttendanceCsv({ date, department, role });
    if (r.status === "error") return res.status(500).json({ success:false, message:r.message });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="attendance-${Date.now()}.csv"`);
    return res.send(r.csv);
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
});

router.get("/export/logs", async (req, res) => {
  const { outcome } = req.query;
  try {
    const r = await db.exportLogsCsv(outcome ? { outcome } : {});
    if (r.status === "error") return res.status(500).json({ success:false, message:r.message });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="access-logs-${Date.now()}.csv"`);
    return res.send(r.csv);
  } catch (err) { res.status(500).json({ success:false, message: err.message }); }
});

module.exports = router;
