"use strict";
const API = "/api";
let records = [];

function esc(s) { return s ? String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") : ""; }
function fmtDate(iso) { if(!iso) return "—"; return new Date(iso).toLocaleString("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}); }

async function load(filters={}) {
  const params = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([,v])=>v)));
  const res  = await fetch(`${API}/admin/attendance?${params}`);
  const data = await res.json();
  records = data.success ? data.attendance : [];
  render();
  updateStats();
}

function render() {
  const tbody = document.getElementById("attBody");
  if (!records.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty"><div class="empty-state"><div class="empty-icon">📋</div><p>No attendance records found.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = records.map((r,i) => `
    <tr>
      <td class="id-cell">${i+1}</td>
      <td><strong>${esc(r.FullName)}</strong></td>
      <td><span class="badge badge-${(r.Role||"").toLowerCase()}">${esc(r.Role)}</span></td>
      <td class="muted-cell">${esc(r.Department)}</td>
      <td class="muted-cell">${esc(r.Date)}</td>
      <td class="muted-cell">${fmtDate(r.CheckInTime)}</td>
    </tr>`).join("");
}

function updateStats() {
  document.getElementById("statTotal").textContent = records.length;
  const today = new Date().toISOString().slice(0,10);
  document.getElementById("statToday").textContent = records.filter(r=>r.Date===today).length;
  const depts = new Set(records.map(r=>r.Department));
  document.getElementById("statDepts").textContent = depts.size;
}

function getFilters() {
  return {
    date:       document.getElementById("filterDate").value,
    role:       document.getElementById("filterRole").value,
    department: document.getElementById("filterDept").value,
  };
}

document.getElementById("applyFilter").addEventListener("click", () => load(getFilters()));
document.getElementById("clearFilter").addEventListener("click", () => {
  document.getElementById("filterDate").value = "";
  document.getElementById("filterRole").value = "";
  document.getElementById("filterDept").value = "";
  load();
});

document.getElementById("exportCsvBtn").addEventListener("click", async () => {
  const filters = getFilters();
  const params = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([,v])=>v)));
  const a = document.createElement("a");
  a.href = `${API}/admin/export/attendance?${params}`;
  a.download = `attendance-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
});

load();
