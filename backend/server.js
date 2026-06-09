/**
 * server.js
 * Main Express server for the Access Control System.
 *
 * Responsibilities:
 *  - Serve all static frontend pages from /frontend
 *  - Mount API routes under /api
 *  - Initialise the SQLite database on first boot
 *  - Handle errors globally
 */

const express      = require("express");
const cors         = require("cors");
const path         = require("path");
const db           = require("./db");
const enrollRouter = require("./routes/enroll");
const authRouter   = require("./routes/auth");
const adminRouter  = require("./routes/admin");
const errorHandler = require("./middleware/errorHandler");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "5mb" }));   // face descriptors are small but keep headroom
app.use(express.urlencoded({ extended: true }));

// ── Static files (serve the entire frontend folder) ────────────────────────
app.use(express.static(path.join(__dirname, "../frontend")));

// ── API Routes ─────────────────────────────────────────────────────────────
app.use("/api/enroll", enrollRouter);
app.use("/api/auth",   authRouter);
app.use("/api/admin",  adminRouter);

// ── Health check (useful for testing the server is alive) ──────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status:  "ok",
    project: "Web-Based Facial Recognition Access Control System",
    version: "1.0.0-mvp",
    time:    new Date().toISOString(),
  });
});

// ── Catch-all: serve index.html for any unmatched route (SPA behaviour) ────
app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend", "index.html"));
});

// ── Global error handler (must be last) ───────────────────────────────────
app.use(errorHandler);

// ── Start server ───────────────────────────────────────────────────────────
async function start() {
  try {
    console.log("Initialising database...");
    const initResult = await db.init();
    console.log(`[DB] ${initResult.message}`);

    app.listen(PORT, () => {
      console.log("─────────────────────────────────────────────");
      console.log("  Access Control System — Server Running");
      console.log(`  URL:  http://localhost:${PORT}`);
      console.log(`  Mode: ${process.env.NODE_ENV || "development"}`);
      console.log("─────────────────────────────────────────────");
    });
  } catch (err) {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  }
}

start();
