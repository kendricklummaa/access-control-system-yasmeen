/**
 * admin.js — v3 (definitive)
 *
 * Fixes applied vs old v2:
 *  1. renderUsers now renders all 8 columns matching admin.html:
 *     ID | Name+Photo | Email | Role | Department | Status | Registered | Actions
 *     Actions column contains: status select + View Profile link + Delete button
 *  2. loadStats reads todayAttendance and updates statTodayAtt card
 *  3. Uses esc() + fmtDate() (not escHtml/formatDate from old v2)
 *  4. Status badges, inline status PATCH, photo thumbnails all wired
 */
"use strict";

const API        = "/api";
const REFRESH_MS = 30_000;

let allUsers = [], allLogs = [], currentLogFilter = null;
let refreshTimer = null, pendingDeleteId = null, pendingDeleteName = null;

// ── Helpers ───────────────────────────────────────────────────────────────
function esc(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
function setTabCount(id, n) {
  const el = document.getElementById(id);
  if (el) el.textContent = n > 0 ? n : "";
}
let toastTimer = null;
function showToast(msg, type = "info") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `toast toast--${type} toast--visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("toast--visible"), 3000);
}

// ── Tabs ──────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("tab-btn--active"));
    document.querySelectorAll(".tab-panel").forEach((p) => (p.style.display = "none"));
    btn.classList.add("tab-btn--active");
    document.getElementById(`tab-${btn.dataset.tab}`).style.display = "block";
  });
});

// ── Log filter pills ──────────────────────────────────────────────────────
document.querySelectorAll(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("filter-btn--active"));
    btn.classList.add("filter-btn--active");
    currentLogFilter = btn.dataset.filter === "all" ? null : btn.dataset.filter;
    renderLogs();
  });
});

// ── Live search ───────────────────────────────────────────────────────────
document.getElementById("userSearch").addEventListener("input", renderUsers);
document.getElementById("logSearch").addEventListener("input",  renderLogs);

// ── Delete modal ──────────────────────────────────────────────────────────
const modalBackdrop = document.getElementById("modalBackdrop");
const modalBody     = document.getElementById("modalBody");
const modalConfirm  = document.getElementById("modalConfirm");
const modalCancel   = document.getElementById("modalCancel");

function openDeleteModal(userId, name) {
  pendingDeleteId = userId; pendingDeleteName = name;
  modalBody.textContent = `Delete "${name}"? This permanently removes their account, face data, and attendance records. This cannot be undone.`;
  modalBackdrop.style.display = "flex";
  modalBackdrop.removeAttribute("aria-hidden");
  modalConfirm.focus();
}
function closeModal() {
  modalBackdrop.style.display = "none";
  modalBackdrop.setAttribute("aria-hidden", "true");
  pendingDeleteId = null; pendingDeleteName = null;
}
modalCancel.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", (e) => { if (e.target === modalBackdrop) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
modalConfirm.addEventListener("click", async () => {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId, name = pendingDeleteName;
  closeModal();
  await deleteUser(id, name);
});

// ── Stats ─────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res  = await fetch(`${API}/admin/stats`);
    const data = await res.json();
    if (!data.success) return;

    const { totalUsers, totalAttempts, granted, denied, todayAttendance } = data.stats;
    const rate = totalAttempts > 0
      ? Math.round((granted / totalAttempts) * 100) + "%" : "—";

    animateCount("statUsers",    totalUsers);
    animateCount("statAttempts", totalAttempts);
    animateCount("statGranted",  granted);
    animateCount("statDenied",   denied);
    document.getElementById("statRate").textContent = rate;

    // Today's attendance stat
    const attEl = document.getElementById("statTodayAtt");
    if (attEl) animateCount("statTodayAtt", todayAttendance || 0);

    // Rate card colour
    const rateCard = document.getElementById("statRate").closest(".stat-card");
    if (rateCard) {
      rateCard.classList.remove("stat-card--rate-good", "stat-card--rate-warn", "stat-card--rate-bad");
      if (totalAttempts > 0) {
        const pct = Math.round((granted / totalAttempts) * 100);
        rateCard.classList.add(pct >= 70 ? "stat-card--rate-good" : pct >= 40 ? "stat-card--rate-warn" : "stat-card--rate-bad");
      }
    }

    blinkLiveDot();
  } catch { /* silent */ }
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const cur = parseInt(el.textContent) || 0;
  if (cur === target) { el.textContent = target; return; }
  const step = Math.max(1, Math.ceil(Math.abs(target - cur) / 12));
  const dir  = target > cur ? 1 : -1;
  let val    = cur;
  const t = setInterval(() => {
    val += dir * step;
    if ((dir === 1 && val >= target) || (dir === -1 && val <= target)) {
      val = target; clearInterval(t);
    }
    el.textContent = val;
  }, 40);
}

function blinkLiveDot() {
  const d = document.getElementById("liveDot");
  if (!d) return;
  d.classList.add("live-dot--active");
  setTimeout(() => d.classList.remove("live-dot--active"), 800);
}

// ── Users ─────────────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const res  = await fetch(`${API}/admin/users`);
    const data = await res.json();
    allUsers = data.success ? data.users : [];
    setTabCount("tabCountUsers", allUsers.length);
    renderUsers();
  } catch {
    document.getElementById("usersBody").innerHTML =
      `<tr><td colspan="8" class="table-loading table-error">Could not load users — is the server running?</td></tr>`;
  }
}

function renderUsers() {
  const q = document.getElementById("userSearch").value.trim().toLowerCase();
  let filtered = allUsers;
  if (q) {
    filtered = filtered.filter((u) =>
      [u.FullName, u.Email, u.Role, u.Department, u.Status]
        .some((f) => f && f.toLowerCase().includes(q))
    );
  }

  const tbody = document.getElementById("usersBody");

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">
      <div class="empty-state">
        <div class="empty-icon">👤</div>
        <p>${q ? "No users match your search." : "No users registered yet."}</p>
        ${!q ? `<a href="enroll.html" class="btn btn-primary btn-sm">Enrol First User</a>` : ""}
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((u) => {
    const statusLower = (u.Status || "active").toLowerCase();
    return `
    <tr>
      <td class="id-cell">${esc(String(u.UserID))}</td>

      <td style="display:flex;align-items:center;gap:8px;padding:8px 12px;">
        ${u.PhotoData
          ? `<img src="${esc(u.PhotoData)}" class="thumb-photo" alt=""/>`
          : `<div class="thumb-placeholder">👤</div>`
        }
        <strong>${esc(u.FullName)}</strong>
      </td>

      <td class="muted-cell">${esc(u.Email)}</td>

      <td><span class="badge badge-${(u.Role || "").toLowerCase()}">${esc(u.Role)}</span></td>

      <td class="muted-cell">${esc(u.Department)}</td>

      <td>
        <span class="badge badge-status-${statusLower}">${esc(u.Status || "Active")}</span>
      </td>

      <td class="muted-cell nowrap">${fmtDate(u.DateRegistered)}</td>

      <td>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <select
            class="status-select-inline"
            data-uid="${u.UserID}"
            aria-label="Change status for ${esc(u.FullName)}"
          >
            <option value="Active"    ${u.Status === "Active"    ? "selected" : ""}>Active</option>
            <option value="Inactive"  ${u.Status === "Inactive"  ? "selected" : ""}>Inactive</option>
            <option value="Suspended" ${u.Status === "Suspended" ? "selected" : ""}>Suspended</option>
          </select>
          <a href="profile.html?id=${u.UserID}" class="btn btn-sm btn-ghost">Profile</a>
          <button
            class="btn btn-sm btn-danger"
            onclick="openDeleteModal(${u.UserID}, ${JSON.stringify(u.FullName)})"
            aria-label="Delete ${esc(u.FullName)}"
          >Delete</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  // Wire inline status selects after render
  document.querySelectorAll(".status-select-inline").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const uid    = parseInt(sel.dataset.uid, 10);
      const status = sel.value;
      try {
        const res  = await fetch(`${API}/admin/users/${uid}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        const d = await res.json();
        if (d.success) showToast(`Status updated to ${status}.`, "success");
        else           showToast(d.message || "Update failed.", "error");
        await Promise.all([loadUsers(), loadStats()]);
      } catch {
        showToast("Server error — could not update status.", "error");
      }
    });
  });
}

async function deleteUser(userId, name) {
  try {
    const res  = await fetch(`${API}/admin/users/${userId}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      showToast(`${name} deleted successfully.`, "success");
      await Promise.all([loadUsers(), loadStats()]);
    } else {
      showToast("Delete failed: " + data.message, "error");
    }
  } catch {
    showToast("Server error — could not delete user.", "error");
  }
}

// ── Logs ──────────────────────────────────────────────────────────────────
async function loadLogs() {
  try {
    const res  = await fetch(`${API}/admin/logs`);
    const data = await res.json();
    allLogs = data.success ? data.logs : [];
    setTabCount("tabCountLogs", allLogs.length);
    renderLogs();
  } catch {
    document.getElementById("logsBody").innerHTML =
      `<tr><td colspan="6" class="table-loading table-error">Could not load logs — is the server running?</td></tr>`;
  }
}

function renderLogs() {
  const q = document.getElementById("logSearch").value.trim().toLowerCase();
  let filtered = allLogs;
  if (currentLogFilter) filtered = filtered.filter((l) => l.Outcome === currentLogFilter);
  if (q) {
    filtered = filtered.filter((l) =>
      [l.FullName, l.Reason, l.IPAddress, l.Role]
        .some((f) => f && f.toLowerCase().includes(q))
    );
  }

  const tbody = document.getElementById("logsBody");

  if (!filtered.length) {
    const label = currentLogFilter ? currentLogFilter.toLowerCase() : "";
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <p>${q
          ? "No log entries match your search."
          : label
            ? `No ${label} entries in the log yet.`
            : "No access attempts recorded yet."
        }</p>
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((l) => `
    <tr class="log-row log-row--${(l.Outcome || "").toLowerCase()}">
      <td class="id-cell">${esc(String(l.LogID))}</td>
      <td>${l.FullName
        ? `<strong>${esc(l.FullName)}</strong>${l.Role
            ? ` <span class="badge badge-${(l.Role || "").toLowerCase()}">${esc(l.Role)}</span>`
            : ""}`
        : `<em class="muted-cell">Unknown</em>`
      }</td>
      <td class="muted-cell nowrap">${fmtDate(l.Timestamp)}</td>
      <td><span class="badge badge-${(l.Outcome || "").toLowerCase()}">${esc(l.Outcome)}</span></td>
      <td class="muted-cell reason-cell">${esc(l.Reason) || "—"}</td>
      <td class="muted-cell ip-cell">${esc(l.IPAddress) || "—"}</td>
    </tr>
  `).join("");
}

// ── Auto-refresh ──────────────────────────────────────────────────────────
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    if (document.visibilityState === "visible") await refreshAll();
    scheduleRefresh();
  }, REFRESH_MS);
}
async function refreshAll() {
  await Promise.all([loadStats(), loadUsers(), loadLogs()]);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { refreshAll(); scheduleRefresh(); }
  else clearTimeout(refreshTimer);
});

(async () => { await refreshAll(); scheduleRefresh(); })();
