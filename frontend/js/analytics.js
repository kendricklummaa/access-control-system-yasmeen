"use strict";
const API = "/api";
let charts = {};

const TEAL   = "rgba(13,148,136,";
const GREEN  = "rgba(34,197,94,";
const RED    = "rgba(239,68,68,";
const PURPLE = "rgba(139,92,246,";
const BLUE   = "rgba(59,130,246,";
const ORANGE = "rgba(249,115,22,";

function destroyChart(id) { if(charts[id]) { charts[id].destroy(); delete charts[id]; } }

async function loadAnalytics() {
  const days = document.getElementById("dayRange").value;

  // Stats summary
  const sRes  = await fetch(`${API}/admin/stats`);
  const sData = await sRes.json();
  if (sData.success) {
    const s = sData.stats;
    document.getElementById("sTotal").textContent   = s.totalAttempts;
    document.getElementById("sGranted").textContent = s.granted;
    document.getElementById("sDenied").textContent  = s.denied;
    document.getElementById("sRate").textContent    = s.totalAttempts
      ? Math.round(s.granted / s.totalAttempts * 100) + "%" : "—";
  }

  const res  = await fetch(`${API}/admin/analytics?days=${days}`);
  const data = await res.json();
  if (!data.success) return;
  const { trend, roleDistribution, deptDistribution, hourlyPattern, attendanceTrend } = data.analytics;

  // Trend chart
  destroyChart("trend");
  charts.trend = new Chart(document.getElementById("trendChart"), {
    type: "line",
    data: {
      labels: trend.map(r=>r.day),
      datasets: [
        { label:"Granted", data: trend.map(r=>r.granted||0), borderColor: GREEN+"1)", backgroundColor: GREEN+"0.12)", tension:0.35, fill:true },
        { label:"Denied",  data: trend.map(r=>r.denied||0),  borderColor: RED+"1)",   backgroundColor: RED+"0.08)",   tension:0.35, fill:true },
      ]
    },
    options: { responsive:true, plugins:{ legend:{ position:"top" } }, scales:{ y:{ beginAtZero:true, ticks:{ stepSize:1 } } } }
  });

  // Role doughnut
  destroyChart("role");
  charts.role = new Chart(document.getElementById("roleChart"), {
    type: "doughnut",
    data: {
      labels: roleDistribution.map(r=>r.Role),
      datasets:[{ data: roleDistribution.map(r=>r.count), backgroundColor:[TEAL+"0.8)",PURPLE+"0.8)",BLUE+"0.8)"] }]
    },
    options: { responsive:true, plugins:{ legend:{ position:"bottom" } } }
  });

  // Attendance bar (last 7 days)
  destroyChart("att");
  charts.att = new Chart(document.getElementById("attChart"), {
    type: "bar",
    data: {
      labels: attendanceTrend.map(r=>r.day),
      datasets:[{ label:"Check-ins", data: attendanceTrend.map(r=>r.count), backgroundColor: TEAL+"0.75)" }]
    },
    options: { responsive:true, plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true, ticks:{ stepSize:1 } } } }
  });

  // Hourly pattern
  destroyChart("hourly");
  const allHours = Array.from({length:24},(_,i)=>i);
  const hourMap = Object.fromEntries(hourlyPattern.map(r=>[r.hour, r.count]));
  charts.hourly = new Chart(document.getElementById("hourlyChart"), {
    type:"bar",
    data:{
      labels: allHours.map(h=>`${String(h).padStart(2,"0")}:00`),
      datasets:[{ label:"Attempts", data: allHours.map(h=>hourMap[h]||0), backgroundColor: BLUE+"0.7)" }]
    },
    options:{ responsive:true, plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true, ticks:{ stepSize:1 } } } }
  });

  // Dept bar
  destroyChart("dept");
  charts.dept = new Chart(document.getElementById("deptChart"), {
    type:"bar",
    data:{
      labels: deptDistribution.map(r=>r.Department),
      datasets:[{ label:"Users", data: deptDistribution.map(r=>r.count),
        backgroundColor: deptDistribution.map((_,i)=>[TEAL,GREEN,PURPLE,BLUE,ORANGE,RED][i%6]+"0.75)") }]
    },
    options:{ indexAxis:"y", responsive:true, plugins:{ legend:{ display:false } }, scales:{ x:{ beginAtZero:true, ticks:{ stepSize:1 } } } }
  });
}

document.getElementById("dayRange").addEventListener("change", loadAnalytics);

document.getElementById("exportLogsBtn").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = `${API}/admin/export/logs`;
  a.download = `logs-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
});
document.getElementById("exportAttBtn").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = `${API}/admin/export/attendance`;
  a.download = `attendance-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
});

loadAnalytics();
