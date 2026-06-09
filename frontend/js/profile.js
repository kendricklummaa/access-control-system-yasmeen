"use strict";
const API = "/api";

function esc(s) { return s ? String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;") : ""; }
function fmtDate(iso) { if(!iso) return "—"; return new Date(iso).toLocaleString("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}); }
function toast(msg,type="info"){const t=document.getElementById("toast");t.textContent=msg;t.className=`toast toast--${type} toast--visible`;setTimeout(()=>t.classList.remove("toast--visible"),3000);}

const params = new URLSearchParams(location.search);
const userId = parseInt(params.get("id"), 10);

if (!userId || isNaN(userId)) {
  document.getElementById("profileLoading").innerHTML =
    `<div class="empty-state"><div class="empty-icon">❌</div><p>No user ID provided. <a href="admin.html">Back to Dashboard</a></p></div>`;
} else {
  load();
}

async function load() {
  const res  = await fetch(`${API}/admin/users/${userId}/profile`);
  const data = await res.json();
  if (!data.success) {
    document.getElementById("profileLoading").innerHTML =
      `<div class="empty-state"><div class="empty-icon">❌</div><p>${esc(data.message)}</p></div>`;
    return;
  }
  const { user, stats, logs, attendanceCount } = data;

  document.getElementById("profileLoading").style.display = "none";
  document.getElementById("profileContent").style.display = "block";

  // Photo
  if (user.PhotoData) {
    document.getElementById("profilePhoto").src = user.PhotoData;
    document.getElementById("profilePhoto").style.display = "block";
    document.getElementById("profilePhotoPlaceholder").style.display = "none";
  }

  // Info
  document.getElementById("profileName").textContent        = user.FullName;
  document.getElementById("profileDept").textContent        = user.Department;
  document.getElementById("profileEmail").textContent       = user.Email;
  document.getElementById("profileRegistered").textContent  = "Registered: " + fmtDate(user.DateRegistered);

  const roleEl   = document.getElementById("profileRole");
  roleEl.textContent = user.Role;
  roleEl.className   = `badge badge-${(user.Role||"").toLowerCase()}`;

  const statusEl = document.getElementById("profileStatus");
  statusEl.textContent = user.Status;
  statusEl.className   = `badge badge-status-${(user.Status||"active").toLowerCase()}`;

  document.getElementById("statusSelect").value = user.Status;

  // Stats
  document.getElementById("pTotal").textContent      = stats.total || 0;
  document.getElementById("pGranted").textContent    = stats.granted || 0;
  document.getElementById("pDenied").textContent     = stats.denied || 0;
  document.getElementById("pAttendance").textContent = attendanceCount || 0;

  // Logs
  const tbody = document.getElementById("historyBody");
  if (!logs.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty"><div class="empty-state"><div class="empty-icon">📋</div><p>No access history yet.</p></div></td></tr>`;
  } else {
    tbody.innerHTML = logs.map(l => `
      <tr class="log-row log-row--${(l.Outcome||"").toLowerCase()}">
        <td class="id-cell">${l.LogID}</td>
        <td class="muted-cell nowrap">${fmtDate(l.Timestamp)}</td>
        <td><span class="badge badge-${(l.Outcome||"").toLowerCase()}">${esc(l.Outcome)}</span></td>
        <td class="muted-cell reason-cell">${esc(l.Reason)||"—"}</td>
        <td class="muted-cell ip-cell">${esc(l.IPAddress)||"—"}</td>
      </tr>`).join("");
  }
}

document.getElementById("updateStatusBtn").addEventListener("click", async () => {
  const status = document.getElementById("statusSelect").value;
  const res    = await fetch(`${API}/admin/users/${userId}/status`, {
    method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ status })
  });
  const data = await res.json();
  if (data.success) {
    toast(`Status updated to ${status}.`, "success");
    const el = document.getElementById("profileStatus");
    el.textContent = status;
    el.className   = `badge badge-status-${status.toLowerCase()}`;
  } else toast(data.message||"Update failed.","error");
});
