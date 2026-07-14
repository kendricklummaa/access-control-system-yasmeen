/**
 * db.js — v2
 * Node.js bridge to db_manager.py via child_process JSON IPC.
 */
const { spawn } = require("child_process");
const path = require("path");
const DB_SCRIPT = path.join(__dirname, "python", "db_manager.py");

function pickPythonCommand() {
  if (process.env.PYTHON_CMD) {
    return [process.env.PYTHON_CMD];
  }

  if (process.platform === "win32") {
    return ["py", "python", "python3"];
  }

  if (process.env.PYTHON) {
    return [process.env.PYTHON];
  }

  return ["/usr/bin/python3", "python3", "python"];
}

function runDB(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const command = JSON.stringify({ action, ...payload });

    const candidates = pickPythonCommand();
    let index = 0;

    const tryNext = (lastError) => {
      if (index >= candidates.length) {
        reject(lastError || new Error("Python runtime not found."));
        return;
      }

      const pythonCmd = candidates[index++];
      const proc = spawn(pythonCmd, [DB_SCRIPT]);
      let stdout = "";
      let stderr = "";
      let spawned = false;

      proc.stdout.on("data", (c) => (stdout += c));
      proc.stderr.on("data", (c) => (stderr += c));
      proc.on("spawn", () => {
        spawned = true;
        proc.stdin.write(command);
        proc.stdin.end();
      });
      proc.on("close", () => {
        if (stderr) console.error(`[DB] Python stderr: ${stderr.trim()}`);
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`DB parse error. stdout:"${stdout}" stderr:"${stderr}"`));
        }
      });
      proc.on("error", (err) => {
        if (!spawned && err.code === "ENOENT") {
          tryNext(err);
          return;
        }
        reject(err);
      });
    };

    tryNext();
  });
}

const db = {
  init: () => runDB("init_db"),

  // Users
  createUser:       (data)         => runDB("create_user", data),
  getUsers:         ()             => runDB("get_users"),
  updateUserStatus: (userId, status) => runDB("update_user_status", { userId, status }),
  deleteUser:       (userId)       => runDB("delete_user", { userId }),
  getUserProfile:   (userId)       => runDB("get_user_profile", { userId }),

  // Duplicate face check
  checkDuplicateFace: (descriptor) => runDB("check_duplicate_face", { descriptor }),

  // Embeddings
  saveEmbedding:          (userId, descriptor) => runDB("save_embedding", { userId, descriptor }),
  getAllEmbeddings:        ()                   => runDB("get_all_embeddings"),
  deleteEmbeddingsForUser:(userId)             => runDB("delete_embeddings_for_user", { userId }),

  // Logs
  createLog: (userId, outcome, reason, ipAddress) =>
    runDB("create_log", { userId, outcome, reason, ipAddress }),
  getLogs:   (outcome = null) => runDB("get_logs", outcome ? { outcome } : {}),
  getStats:  ()               => runDB("get_stats"),

  // Attendance
  getAttendance: (filters = {}) => runDB("get_attendance", filters),

  // Analytics
  getAnalytics: (days = 14) => runDB("get_analytics", { days }),

  // Policies
  getPolicies:   ()     => runDB("get_policies"),
  upsertPolicy:  (data) => runDB("upsert_policy", data),
  deletePolicy:  (policyId) => runDB("delete_policy", { policyId }),

  // Exports
  exportAttendanceCsv: (filters = {}) => runDB("export_attendance_csv", filters),
  exportLogsCsv:       (filters = {}) => runDB("export_logs_csv", filters),
};

module.exports = db;
