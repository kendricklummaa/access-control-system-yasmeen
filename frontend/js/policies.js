"use strict";
const API = "/api";
let policies = [];
let editingId = null;
let deletingId = null;

function esc(s) { return s ? String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;") : ""; }
function toast(msg, type="info") {
  const t = document.getElementById("toast");
  t.textContent=msg; t.className=`toast toast--${type} toast--visible`;
  setTimeout(()=>t.classList.remove("toast--visible"),3000);
}

async function load() {
  const res  = await fetch(`${API}/admin/policies`);
  const data = await res.json();
  policies = data.success ? data.policies : [];
  render();
}

function render() {
  const tbody = document.getElementById("policiesBody");
  if (!policies.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty"><div class="empty-state"><div class="empty-icon">🔒</div><p>No policies defined yet. Click "New Policy" to create one.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = policies.map(p => `
    <tr>
      <td class="id-cell">${p.PolicyID}</td>
      <td><strong>${esc(p.PolicyName)}</strong></td>
      <td><span class="badge">${esc(p.TargetType)}</span></td>
      <td class="muted-cell">${esc(p.TargetValue)}</td>
      <td class="muted-cell">${esc(p.Resource)}</td>
      <td><span class="badge ${p.IsAllowed ? 'badge-granted' : 'badge-denied'}">${p.IsAllowed ? "Allow":"Deny"}</span></td>
      <td class="muted-cell">${p.StartTime && p.EndTime ? `${p.StartTime} – ${p.EndTime}` : "—"}</td>
      <td style="display:flex;gap:6px">
        <button class="btn btn-sm btn-ghost" onclick="openEdit(${p.PolicyID})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="openDelete(${p.PolicyID},'${esc(p.PolicyName)}')">Delete</button>
      </td>
    </tr>`).join("");
}

function openModal(policy=null) {
  editingId = policy ? policy.PolicyID : null;
  document.getElementById("policyModalTitle").textContent = policy ? "Edit Policy" : "New Policy";
  document.getElementById("policyName").value         = policy?.PolicyName || "";
  document.getElementById("policyTargetType").value   = policy?.TargetType || "Role";
  document.getElementById("policyTargetValue").value  = policy?.TargetValue || "";
  document.getElementById("policyResource").value     = policy?.Resource || "Main Entrance";
  document.getElementById("policyIsAllowed").value    = policy != null ? String(policy.IsAllowed) : "1";
  document.getElementById("policyStartTime").value    = policy?.StartTime || "";
  document.getElementById("policyEndTime").value      = policy?.EndTime || "";
  document.getElementById("policyModal").style.display = "flex";
}
function openEdit(id) { openModal(policies.find(p=>p.PolicyID===id)); }
function closeModal() {
  document.getElementById("policyModal").style.display = "none";
  editingId = null;
}

function openDelete(id, name) {
  deletingId = id;
  document.getElementById("delModalBody").textContent = `Delete policy "${name}"? This cannot be undone.`;
  document.getElementById("delModal").style.display = "flex";
}
function closeDelete() { document.getElementById("delModal").style.display="none"; deletingId=null; }

document.getElementById("newPolicyBtn").addEventListener("click", () => openModal());
document.getElementById("policyCancel").addEventListener("click", closeModal);
document.getElementById("delCancel").addEventListener("click", closeDelete);
document.addEventListener("keydown", e => { if(e.key==="Escape"){ closeModal(); closeDelete(); } });

document.getElementById("policySave").addEventListener("click", async () => {
  const body = {
    policyId:    editingId,
    policyName:  document.getElementById("policyName").value.trim(),
    targetType:  document.getElementById("policyTargetType").value,
    targetValue: document.getElementById("policyTargetValue").value.trim(),
    resource:    document.getElementById("policyResource").value.trim() || "Main Entrance",
    isAllowed:   document.getElementById("policyIsAllowed").value,
    startTime:   document.getElementById("policyStartTime").value || null,
    endTime:     document.getElementById("policyEndTime").value || null,
  };
  if (!body.policyName || !body.targetValue) { toast("Policy name and target value are required.","error"); return; }

  const url    = editingId ? `${API}/admin/policies/${editingId}` : `${API}/admin/policies`;
  const method = editingId ? "PUT" : "POST";
  const res    = await fetch(url, { method, headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
  const data   = await res.json();
  if (data.success) { toast(editingId?"Policy updated.":"Policy created.","success"); closeModal(); load(); }
  else toast(data.message||"Save failed.","error");
});

document.getElementById("delConfirm").addEventListener("click", async () => {
  if (!deletingId) return;
  const res  = await fetch(`${API}/admin/policies/${deletingId}`, { method:"DELETE" });
  const data = await res.json();
  if (data.success) { toast("Policy deleted.","success"); closeDelete(); load(); }
  else toast(data.message||"Delete failed.","error");
});

load();
