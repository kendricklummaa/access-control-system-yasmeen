"""
db_manager.py — v2
SQLite manager for the Access Control System.
Called by Node.js via child_process (JSON on stdin → JSON on stdout).

NEW IN v2
─────────
Schema
  Users.Status        TEXT DEFAULT 'Active'   (Active | Inactive | Suspended)
  Users.PhotoData     TEXT                    (base64 JPEG, nullable)
  Attendance          separate table          (auto-populated on Granted auth)
  AccessPolicies      separate table          (dept / role access rules)

New actions
  update_user_status      set Status field
  get_user_profile        full profile + history stats
  get_attendance          attendance records with optional filters
  get_analytics           chart-ready auth trend + role distribution data
  check_duplicate_face    compare incoming descriptor against all stored ones
  get_policies            list access policies
  upsert_policy           create or update a policy
  delete_policy           remove a policy
  export_attendance_csv   return CSV string of attendance records
  export_logs_csv         return CSV string of access logs
"""

import sqlite3
import json
import sys
import os
import csv
import io
from datetime import datetime, timedelta

# Use abspath so the path resolves correctly regardless of how Python is
# invoked (relative path, py launcher, Node child_process cwd, etc.)
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.normpath(os.path.join(_SCRIPT_DIR, '../../database/access_control.db'))

# Ensure the database directory exists (safe on repeat calls)
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
DUPLICATE_THRESHOLD = 0.45   # Euclidean distance below which faces are considered the same

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

# ── euclidean distance between two descriptor lists ────────────────────────
def euclidean(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5

# ─────────────────────────────────────────────────────────────────────────────
#  INIT
# ─────────────────────────────────────────────────────────────────────────────
def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS Users (
            UserID         INTEGER PRIMARY KEY AUTOINCREMENT,
            FullName       TEXT    NOT NULL,
            Email          TEXT    UNIQUE NOT NULL,
            Role           TEXT    NOT NULL CHECK(Role IN ('Student','Staff')),
            Department     TEXT    NOT NULL,
            DateRegistered TEXT    NOT NULL,
            IsAdmin        INTEGER DEFAULT 0,
            Status         TEXT    NOT NULL DEFAULT 'Active'
                          CHECK(Status IN ('Active','Inactive','Suspended')),
            PhotoData      TEXT
        );

        CREATE TABLE IF NOT EXISTS FacialEmbeddings (
            EmbeddingID  INTEGER PRIMARY KEY AUTOINCREMENT,
            UserID       INTEGER NOT NULL,
            EmbeddingData TEXT   NOT NULL,
            DateCaptured  TEXT   NOT NULL,
            FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS AccessLogs (
            LogID        INTEGER PRIMARY KEY AUTOINCREMENT,
            UserID       INTEGER,
            Timestamp    TEXT    NOT NULL,
            Outcome      TEXT    NOT NULL CHECK(Outcome IN ('Granted','Denied')),
            Reason       TEXT,
            IPAddress    TEXT,
            FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS Attendance (
            AttendanceID INTEGER PRIMARY KEY AUTOINCREMENT,
            UserID       INTEGER NOT NULL,
            FullName     TEXT    NOT NULL,
            Role         TEXT    NOT NULL,
            Department   TEXT    NOT NULL,
            CheckInTime  TEXT    NOT NULL,
            Date         TEXT    NOT NULL,
            FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS AccessPolicies (
            PolicyID     INTEGER PRIMARY KEY AUTOINCREMENT,
            PolicyName   TEXT    NOT NULL,
            TargetType   TEXT    NOT NULL CHECK(TargetType IN ('Role','Department','User')),
            TargetValue  TEXT    NOT NULL,
            Resource     TEXT    NOT NULL DEFAULT 'Main Entrance',
            IsAllowed    INTEGER NOT NULL DEFAULT 1,
            StartTime    TEXT,
            EndTime      TEXT,
            CreatedAt    TEXT    NOT NULL,
            UpdatedAt    TEXT    NOT NULL
        );

        -- Migrate existing Users table to add new columns if needed
        -- (safe to run even if columns already exist — errors are suppressed by executescript)
    """)

    # Safe column migrations for existing databases
    for migration in [
        "ALTER TABLE Users ADD COLUMN Status TEXT NOT NULL DEFAULT 'Active'",
        "ALTER TABLE Users ADD COLUMN PhotoData TEXT",
    ]:
        try:
            conn.execute(migration)
        except Exception:
            pass   # Column already exists — ignore

    conn.commit()
    conn.close()
    return {"status": "ok", "message": "Database initialised (v2)"}

# ─────────────────────────────────────────────────────────────────────────────
#  USERS
# ─────────────────────────────────────────────────────────────────────────────
def create_user(data):
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO Users (FullName, Email, Role, Department, DateRegistered, IsAdmin, Status, PhotoData)
            VALUES (?, ?, ?, ?, ?, ?, 'Active', ?)
        """, (
            data["fullName"], data["email"], data["role"], data["department"],
            datetime.now().isoformat(), data.get("isAdmin", 0),
            data.get("photoData")
        ))
        conn.commit()
        return {"status": "ok", "userId": cursor.lastrowid}
    except sqlite3.IntegrityError as e:
        return {"status": "error", "message": str(e)}
    finally:
        conn.close()

def get_users():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT u.UserID, u.FullName, u.Email, u.Role, u.Department,
               u.DateRegistered, u.IsAdmin, u.Status, u.PhotoData,
               COUNT(f.EmbeddingID) as EmbeddingCount
        FROM Users u
        LEFT JOIN FacialEmbeddings f ON u.UserID = f.UserID
        GROUP BY u.UserID
        ORDER BY u.DateRegistered DESC
    """)
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"status": "ok", "users": rows}

def update_user_status(data):
    valid = ('Active', 'Inactive', 'Suspended')
    if data.get("status") not in valid:
        return {"status": "error", "message": f"status must be one of {valid}"}
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE Users SET Status=? WHERE UserID=?",
                   (data["status"], data["userId"]))
    conn.commit()
    affected = cursor.rowcount
    conn.close()
    if affected:
        return {"status": "ok", "message": f"Status updated to {data['status']}"}
    return {"status": "error", "message": "User not found"}

def delete_user(data):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM Users WHERE UserID = ?", (data["userId"],))
    conn.commit()
    affected = cursor.rowcount
    conn.close()
    if affected:
        return {"status": "ok", "message": "User deleted"}
    return {"status": "error", "message": "User not found"}

def get_user_profile(data):
    conn = get_connection()
    cursor = conn.cursor()
    uid = data["userId"]

    cursor.execute("""
        SELECT u.UserID, u.FullName, u.Email, u.Role, u.Department,
               u.DateRegistered, u.IsAdmin, u.Status, u.PhotoData
        FROM Users u WHERE u.UserID = ?
    """, (uid,))
    user = cursor.fetchone()
    if not user:
        conn.close()
        return {"status": "error", "message": "User not found"}
    user = dict(user)

    # Auth stats
    cursor.execute("""
        SELECT COUNT(*) as total,
               SUM(CASE WHEN Outcome='Granted' THEN 1 ELSE 0 END) as granted,
               SUM(CASE WHEN Outcome='Denied'  THEN 1 ELSE 0 END) as denied,
               MAX(CASE WHEN Outcome='Granted' THEN Timestamp END) as lastGranted
        FROM AccessLogs WHERE UserID = ?
    """, (uid,))
    stats = dict(cursor.fetchone())

    # Recent 10 logs
    cursor.execute("""
        SELECT LogID, Timestamp, Outcome, Reason, IPAddress
        FROM AccessLogs WHERE UserID = ?
        ORDER BY Timestamp DESC LIMIT 10
    """, (uid,))
    logs = [dict(r) for r in cursor.fetchall()]

    # Attendance count
    cursor.execute("SELECT COUNT(*) as cnt FROM Attendance WHERE UserID=?", (uid,))
    att_count = cursor.fetchone()["cnt"]

    conn.close()
    return {"status": "ok", "user": user, "stats": stats, "logs": logs, "attendanceCount": att_count}

# ─────────────────────────────────────────────────────────────────────────────
#  DUPLICATE FACE CHECK
# ─────────────────────────────────────────────────────────────────────────────
def check_duplicate_face(data):
    incoming = data["descriptor"]
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT f.EmbeddingData, u.FullName, u.Email, u.UserID
        FROM FacialEmbeddings f JOIN Users u ON f.UserID = u.UserID
    """)
    rows = cursor.fetchall()
    conn.close()

    for row in rows:
        stored = json.loads(row["EmbeddingData"])
        d = euclidean(incoming, stored)
        if d < DUPLICATE_THRESHOLD:
            return {
                "status": "ok",
                "isDuplicate": True,
                "distance": round(d, 4),
                "matchedUser": {
                    "userId":   row["UserID"],
                    "fullName": row["FullName"],
                    "email":    row["Email"]
                }
            }
    return {"status": "ok", "isDuplicate": False}

# ─────────────────────────────────────────────────────────────────────────────
#  EMBEDDINGS
# ─────────────────────────────────────────────────────────────────────────────
def save_embedding(data):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO FacialEmbeddings (UserID, EmbeddingData, DateCaptured)
        VALUES (?, ?, ?)
    """, (data["userId"], json.dumps(data["descriptor"]), datetime.now().isoformat()))
    conn.commit()
    emb_id = cursor.lastrowid
    conn.close()
    return {"status": "ok", "embeddingId": emb_id}

def get_all_embeddings():
    conn = get_connection()
    cursor = conn.cursor()
    # Only return embeddings for Active users — Status check enforced here
    cursor.execute("""
        SELECT f.EmbeddingID, f.UserID, f.EmbeddingData,
               u.FullName, u.Role, u.Department, u.Status
        FROM FacialEmbeddings f
        JOIN Users u ON f.UserID = u.UserID
        WHERE u.Status = 'Active'
    """)
    rows = []
    for row in cursor.fetchall():
        rows.append({
            "embeddingId": row["EmbeddingID"],
            "userId":      row["UserID"],
            "descriptor":  json.loads(row["EmbeddingData"]),
            "fullName":    row["FullName"],
            "role":        row["Role"],
            "department":  row["Department"]
        })
    conn.close()
    return {"status": "ok", "embeddings": rows}

def delete_embeddings_for_user(data):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM FacialEmbeddings WHERE UserID = ?", (data["userId"],))
    conn.commit()
    conn.close()
    return {"status": "ok"}

# ─────────────────────────────────────────────────────────────────────────────
#  ACCESS LOGS
# ─────────────────────────────────────────────────────────────────────────────
def create_log(data):
    conn = get_connection()
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute("""
        INSERT INTO AccessLogs (UserID, Timestamp, Outcome, Reason, IPAddress)
        VALUES (?, ?, ?, ?, ?)
    """, (data.get("userId"), now, data["outcome"],
          data.get("reason",""), data.get("ipAddress","")))
    conn.commit()
    log_id = cursor.lastrowid

    # Auto-record attendance on Granted
    if data["outcome"] == "Granted" and data.get("userId"):
        uid = data["userId"]
        cursor.execute("""
            SELECT FullName, Role, Department FROM Users WHERE UserID = ?
        """, (uid,))
        user = cursor.fetchone()
        if user:
            # Use local date (not UTC) so the attendance date matches
            # the server's clock — important for regions ahead of UTC
            today = datetime.now().strftime("%Y-%m-%d")
            # One attendance record per user per day
            cursor.execute("""
                SELECT COUNT(*) as cnt FROM Attendance
                WHERE UserID=? AND Date=?
            """, (uid, today))
            if cursor.fetchone()["cnt"] == 0:
                cursor.execute("""
                    INSERT INTO Attendance (UserID, FullName, Role, Department, CheckInTime, Date)
                    VALUES (?,?,?,?,?,?)
                """, (uid, user["FullName"], user["Role"], user["Department"], now, today))
                conn.commit()

    conn.close()
    return {"status": "ok", "logId": log_id}

def get_logs(data=None):
    conn = get_connection()
    cursor = conn.cursor()
    outcome_filter = data.get("outcome") if data else None
    if outcome_filter:
        cursor.execute("""
            SELECT l.LogID, l.Timestamp, l.Outcome, l.Reason, l.IPAddress,
                   u.FullName, u.Role
            FROM AccessLogs l LEFT JOIN Users u ON l.UserID = u.UserID
            WHERE l.Outcome = ?
            ORDER BY l.Timestamp DESC LIMIT 500
        """, (outcome_filter,))
    else:
        cursor.execute("""
            SELECT l.LogID, l.Timestamp, l.Outcome, l.Reason, l.IPAddress,
                   u.FullName, u.Role
            FROM AccessLogs l LEFT JOIN Users u ON l.UserID = u.UserID
            ORDER BY l.Timestamp DESC LIMIT 500
        """)
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"status": "ok", "logs": rows}

def get_stats():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as total FROM Users")
    total_users = cursor.fetchone()["total"]
    cursor.execute("SELECT COUNT(*) as total FROM AccessLogs")
    total_attempts = cursor.fetchone()["total"]
    cursor.execute("SELECT COUNT(*) as total FROM AccessLogs WHERE Outcome='Granted'")
    granted = cursor.fetchone()["total"]
    cursor.execute("SELECT COUNT(*) as total FROM AccessLogs WHERE Outcome='Denied'")
    denied = cursor.fetchone()["total"]
    # Use strftime with 'now','localtime' so today matches the server's local date,
    # not UTC — avoids the attendance count showing 0 when local time is ahead of UTC.
    cursor.execute("SELECT COUNT(*) as total FROM Attendance WHERE Date=strftime('%Y-%m-%d','now','localtime')")
    today_attendance = cursor.fetchone()["total"]
    conn.close()
    return {"status": "ok", "stats": {
        "totalUsers": total_users, "totalAttempts": total_attempts,
        "granted": granted, "denied": denied,
        "todayAttendance": today_attendance
    }}

# ─────────────────────────────────────────────────────────────────────────────
#  ATTENDANCE
# ─────────────────────────────────────────────────────────────────────────────
def get_attendance(data=None):
    conn = get_connection()
    cursor = conn.cursor()
    params = []
    where  = []
    if data:
        if data.get("date"):
            where.append("a.Date = ?"); params.append(data["date"])
        if data.get("department"):
            where.append("a.Department = ?"); params.append(data["department"])
        if data.get("role"):
            where.append("a.Role = ?"); params.append(data["role"])
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    cursor.execute(f"""
        SELECT a.AttendanceID, a.UserID, a.FullName, a.Role, a.Department,
               a.CheckInTime, a.Date
        FROM Attendance a
        {where_sql}
        ORDER BY a.CheckInTime DESC
        LIMIT 500
    """, params)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return {"status": "ok", "attendance": rows}

# ─────────────────────────────────────────────────────────────────────────────
#  ANALYTICS
# ─────────────────────────────────────────────────────────────────────────────
def get_analytics(data=None):
    conn = get_connection()
    cursor = conn.cursor()

    days = int((data or {}).get("days", 14))

    # Daily granted/denied trend for last N days
    cursor.execute("""
        SELECT DATE(Timestamp) as day,
               SUM(CASE WHEN Outcome='Granted' THEN 1 ELSE 0 END) as granted,
               SUM(CASE WHEN Outcome='Denied'  THEN 1 ELSE 0 END) as denied
        FROM AccessLogs
        WHERE DATE(Timestamp) >= DATE('now', ?)
        GROUP BY day ORDER BY day ASC
    """, (f"-{days} days",))
    trend = [dict(r) for r in cursor.fetchall()]

    # Role distribution of users
    cursor.execute("""
        SELECT Role, COUNT(*) as count FROM Users GROUP BY Role
    """)
    role_dist = [dict(r) for r in cursor.fetchall()]

    # Department distribution
    cursor.execute("""
        SELECT Department, COUNT(*) as count FROM Users GROUP BY Department ORDER BY count DESC LIMIT 8
    """)
    dept_dist = [dict(r) for r in cursor.fetchall()]

    # Hourly auth pattern (what hours get most attempts)
    cursor.execute("""
        SELECT CAST(strftime('%H', Timestamp) AS INTEGER) as hour,
               COUNT(*) as count
        FROM AccessLogs
        GROUP BY hour ORDER BY hour ASC
    """)
    hourly = [dict(r) for r in cursor.fetchall()]

    # Attendance trend last 7 days
    cursor.execute("""
        SELECT Date as day, COUNT(*) as count
        FROM Attendance
        WHERE Date >= DATE('now', '-7 days')
        GROUP BY day ORDER BY day ASC
    """)
    att_trend = [dict(r) for r in cursor.fetchall()]

    conn.close()
    return {"status": "ok", "analytics": {
        "trend": trend, "roleDistribution": role_dist,
        "deptDistribution": dept_dist, "hourlyPattern": hourly,
        "attendanceTrend": att_trend
    }}

# ─────────────────────────────────────────────────────────────────────────────
#  ACCESS POLICIES
# ─────────────────────────────────────────────────────────────────────────────
def get_policies(data=None):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM AccessPolicies ORDER BY CreatedAt DESC")
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return {"status": "ok", "policies": rows}

def upsert_policy(data):
    conn = get_connection()
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    pid = data.get("policyId")
    if pid:
        cursor.execute("""
            UPDATE AccessPolicies
            SET PolicyName=?, TargetType=?, TargetValue=?, Resource=?,
                IsAllowed=?, StartTime=?, EndTime=?, UpdatedAt=?
            WHERE PolicyID=?
        """, (data["policyName"], data["targetType"], data["targetValue"],
              data.get("resource","Main Entrance"), int(data.get("isAllowed",1)),
              data.get("startTime"), data.get("endTime"), now, pid))
    else:
        cursor.execute("""
            INSERT INTO AccessPolicies
            (PolicyName, TargetType, TargetValue, Resource, IsAllowed, StartTime, EndTime, CreatedAt, UpdatedAt)
            VALUES (?,?,?,?,?,?,?,?,?)
        """, (data["policyName"], data["targetType"], data["targetValue"],
              data.get("resource","Main Entrance"), int(data.get("isAllowed",1)),
              data.get("startTime"), data.get("endTime"), now, now))
        pid = cursor.lastrowid
    conn.commit()
    conn.close()
    return {"status": "ok", "policyId": pid}

def delete_policy(data):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM AccessPolicies WHERE PolicyID=?", (data["policyId"],))
    conn.commit()
    affected = cursor.rowcount
    conn.close()
    return {"status": "ok"} if affected else {"status": "error", "message": "Policy not found"}

# ─────────────────────────────────────────────────────────────────────────────
#  CSV EXPORTS
# ─────────────────────────────────────────────────────────────────────────────
def export_attendance_csv(data=None):
    result = get_attendance(data)
    if result["status"] != "ok":
        return result
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["AttendanceID","UserID","FullName","Role","Department","Date","CheckInTime"])
    for r in result["attendance"]:
        writer.writerow([r["AttendanceID"],r["UserID"],r["FullName"],r["Role"],
                         r["Department"],r["Date"],r["CheckInTime"]])
    return {"status": "ok", "csv": buf.getvalue()}

def export_logs_csv(data=None):
    result = get_logs(data)
    if result["status"] != "ok":
        return result
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["LogID","Timestamp","Outcome","Reason","FullName","Role","IPAddress"])
    for r in result["logs"]:
        writer.writerow([r["LogID"],r["Timestamp"],r["Outcome"],r["Reason"],
                         r.get("FullName",""),r.get("Role",""),r.get("IPAddress","")])
    return {"status": "ok", "csv": buf.getvalue()}

# ─────────────────────────────────────────────────────────────────────────────
#  DISPATCHER
# ─────────────────────────────────────────────────────────────────────────────
ACTIONS = {
    "init_db":                    lambda d: init_db(),
    "create_user":                create_user,
    "get_users":                  lambda d: get_users(),
    "update_user_status":         update_user_status,
    "delete_user":                delete_user,
    "get_user_profile":           get_user_profile,
    "check_duplicate_face":       check_duplicate_face,
    "save_embedding":             save_embedding,
    "get_all_embeddings":         lambda d: get_all_embeddings(),
    "delete_embeddings_for_user": delete_embeddings_for_user,
    "create_log":                 create_log,
    "get_logs":                   get_logs,
    "get_stats":                  lambda d: get_stats(),
    "get_attendance":             get_attendance,
    "get_analytics":              get_analytics,
    "get_policies":               lambda d: get_policies(d),
    "upsert_policy":              upsert_policy,
    "delete_policy":              delete_policy,
    "export_attendance_csv":      export_attendance_csv,
    "export_logs_csv":            export_logs_csv,
}

if __name__ == "__main__":
    try:
        payload = json.loads(sys.stdin.read())
        action  = payload.get("action")
        handler = ACTIONS.get(action)
        result  = handler(payload) if handler else {"status":"error","message":f"Unknown action: {action}"}
    except Exception as e:
        result = {"status": "error", "message": str(e)}
    print(json.dumps(result))
