/* =========================================================
   Northstar Hospital Portal — app.js
   ========================================================= */

let role = "patient";
let view = "home";
let user = "Ananya Patel";
let selectedPatientId = null;
let rehabChart = null;
let analyticsChart = null;
let loggedPatientId = null;
let loggedClinicId = null;
let currentGpuLayers = 0;       // GPU simulator state
const DOCTOR_ID = "DOC-RM-001";
const A = (s) => document.querySelector(s);

/* =========================================================
   Toast notification system
   ========================================================= */
function toast(message, type = "info") {
  let wrap = A(".toast-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "toast-wrap";
    document.body.appendChild(wrap);
  }
  const icons = { success: "✓", error: "✕", info: "ℹ" };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || "ℹ"}</span><span>${escapeHtml(message)}</span>`;
  wrap.appendChild(el);
  // Trigger animation
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("show")));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 350);
  }, 4000);
}

/* =========================================================
   API helpers
   ========================================================= */
async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let detail = res.statusText;
    try { const body = await res.json(); detail = body.error || detail; } catch (_) {}
    throw new Error(detail);
  }
  return res.json();
}

async function apiOr(path, fallback) {
  try { return await api(path); } catch (_) { return fallback; }
}

/* =========================================================
   Login & auth
   ========================================================= */
function login() {
  const isDoc = role === "doctor";
  const hint = isDoc
    ? `<b>Doctor:</b> username <code>doctor</code> &nbsp;·&nbsp; password <code>doctor123</code>`
    : `<b>Patients:</b> username = first name (e.g. <code>ananya</code>) &nbsp;·&nbsp; password = <code>1234</code>`;
  const quickBtns = isDoc
    ? `<button type="button" class="ql-btn" onclick="fillLogin('doctor','doctor123')">⚡ Fill doctor login</button>`
    : `<button type="button" class="ql-btn" onclick="fillLogin('ananya','1234')">Ananya</button>
       <button type="button" class="ql-btn" onclick="fillLogin('vikram','1234')">Vikram</button>
       <button type="button" class="ql-btn" onclick="fillLogin('meera','1234')">Meera</button>
       <button type="button" class="ql-btn" onclick="fillLogin('arjun','1234')">Arjun</button>
       <button type="button" class="ql-btn" onclick="fillLogin('kavita','1234')">Kavita</button>
       <button type="button" class="ql-btn" onclick="fillLogin('sneha','1234')">Sneha</button>
       <button type="button" class="ql-btn" onclick="fillLogin('ramesh','1234')">Ramesh</button>
       <button type="button" class="ql-btn" onclick="fillLogin('imran','1234')">Imran</button>
       <button type="button" class="ql-btn" onclick="fillLogin('priya','1234')">Priya</button>
       <button type="button" class="ql-btn" onclick="fillLogin('thomas','1234')">Thomas</button>`;
  return `<div class="login">
  <section class="art">
    <div class="brand"><span class="mark">N</span> Northstar Hospital</div>
    <h1>Care that stays connected.</h1>
    <p>Secure access to your care journey, clinical records and hospital services.</p>
    <div class="trust"><div><b>24/7</b><span>EMERGENCY CARE</span></div><div><b>38</b><span>CLINICAL SPECIALTIES</span></div><div><b>98%</b><span>PATIENT SATISFACTION</span></div></div>
  </section>
  <section class="loginform">
    <div class="brand"><span class="mark">N</span> Northstar Hospital</div>
    <h2>Welcome back</h2>
    <p class="sub">Sign in to your secure hospital portal.</p>
    <div class="roles">
      <button class="${isDoc?'':'on'}" onclick="setRole('patient',this)">Patient portal</button>
      <button class="${isDoc?'on':''}" onclick="setRole('doctor',this)">Doctor portal</button>
    </div>
    <label class="field">USERNAME<input id="un" placeholder="e.g. ${isDoc?'doctor':'ananya'}" autocomplete="username" onkeydown="if(event.key==='Enter')enter()"></label>
    <label class="field">PASSWORD<input id="pw" type="password" placeholder="${isDoc?'doctor123':'1234'}" autocomplete="current-password" onkeydown="if(event.key==='Enter')enter()"></label>
    <div id="login-err" class="login-err" style="display:none"></div>
    <button class="primary loginbtn" onclick="enter()">Sign in securely →</button>
    <p class="hint" style="margin-top:14px">${hint}</p>
    <div class="ql-wrap">${quickBtns}</div>
  </section>
</div>`;
}

function fillLogin(u, p) {
  const un = A("#un"); const pw = A("#pw");
  if (un) { un.value = u; un.focus(); }
  if (pw) pw.value = p;
  const errBox = A("#login-err");
  if (errBox) errBox.style.display = "none";
}

function setRole(r, e) {
  role = r;
  // Re-render the login page so quick-login buttons and hints update
  A("#app").innerHTML = login();
}

async function enter() {
  if (location.protocol === "file:") {
    toast("Open the portal at http://localhost:8000 — run start_app.bat first.", "error");
    return;
  }
  const unEl = A("#un");
  const pwEl = A("#pw");
  const username = ((unEl && unEl.value) || "").trim().toLowerCase();
  const password = ((pwEl && pwEl.value) || "").trim();
  const errBox = A("#login-err");
  if (!username || !password) {
    if (errBox) { errBox.textContent = "Please enter your username and password."; errBox.style.display = "block"; }
    return;
  }
  const btn = A(".loginbtn");
  if (btn) { btn.disabled = true; btn.textContent = "Signing in…"; }
  if (errBox) errBox.style.display = "none";
  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, role }),
    });
    user = result.display_name;
    role = result.role;
    loggedPatientId = result.patient_id || null;
    loggedClinicId = null;
    selectedPatientId = null;
    if (role === "patient") {
      const clinicList = await apiOr("/api/clinic/patients", []);
      const key = user.toLowerCase();
      const m = clinicList.find((p) => (p.name || "").toLowerCase() === key);
      loggedClinicId = m ? m.patient_id : null;
    }
    view = "home";
    history.pushState({ view: "home" }, "", "#home");
    render();
  } catch (err) {
    const msg = err.message || "Login failed. Please check your credentials.";
    if (errBox) { errBox.textContent = msg; errBox.style.display = "block"; }
    if (btn) { btn.disabled = false; btn.textContent = "Sign in securely →"; }
  }
}

/* =========================================================
   Navigation
   ========================================================= */
function navItems() {
  const base = [
    ["home",       "⌂",  role === "doctor" ? "Clinical home" : "Home"],
    ["outpatient", "◫",  "Outpatient care"],
    ["admission",  "▣",  "Admissions"],
    ["rehab",      "⌁",  "Rehabilitation"],
    ["services",   "✚",  "Hospital services"],
    ["hospital",   "i",  "Hospital information"],
    ["milestones", "☆",  "Our milestones"],
  ];
  if (role === "doctor") {
    base.push(["analytics", "◉", "Analytics"]);
  }
  return base;
}

function nav() {
  const items = navItems();
  const initials = role === "doctor" ? "RM" : user.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return `<aside class="side"><div class="brand"><span class="mark">N</span> Northstar</div><div class="hospital">NORTHSTAR MEDICAL CENTER<br><small>COMPASSION · CLARITY · CARE</small></div><div class="group">${role === "doctor" ? "CLINICAL WORKSPACE" : "MY HOSPITAL PORTAL"}</div>${items
    .map((x) => `<button class="nav ${view === x[0] ? "on" : ""}" onclick="go('${x[0]}')"><span>${x[1]}</span>${x[2]}</button>`)
    .join("")}<div class="profile"><div class="avatar">${initials}</div><div><b>${role === "doctor" ? "Dr. Rohan Mehta" : user}</b><small>${role === "doctor" ? "Physiotherapist · Orthopedics" : "Patient portal"}</small></div><button class="logout-btn" onclick="logout()" title="Sign out">⏻</button></div></aside>`;
}

function page(c, label) {
  const initials = role === "doctor" ? "RM" : user.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return `<div class="shell">${nav()}<main class="main"><header class="top"><div class="crumb">Northstar Hospital　/　<b>${label}</b></div><div style="display:flex;align-items:center;gap:12px"><span style="color:#7a8f95;font-size:18px">⌕</span><button class="logout-top-btn" onclick="logout()" title="Sign out">Sign out ⏻</button><span class="avatar" style="display:inline-grid;width:27px;height:27px">${initials}</span></div></header><div class="body">${c}</div></main></div>`;
}

/* =========================================================
   Skeleton loader
   ========================================================= */
function skeletonPage(label) {
  return `<div class="shell">${nav()}<main class="main"><header class="top"><div class="crumb">Northstar Hospital　/　<b>${label}</b></div></header><div class="body skeleton-page"><div class="skeleton sk-hero"></div><div class="sk-cards">${[1,2,3,4].map(()=>'<div class="skeleton sk-card"></div>').join("")}</div><div class="skeleton sk-table"></div></div></main></div>`;
}

/* =========================================================
   Utility helpers
   ========================================================= */
function clinicQuery() {
  return role === "patient" && loggedClinicId ? `?patient_id=${encodeURIComponent(loggedClinicId)}` : "";
}

function money(n) {
  const val = Number(n || 0);
  return "₹" + val.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function statusBadge(s) {
  const text = s || "";
  const amber = /cancel|no-show|pending|fail|urgent|emergency/i.test(text);
  return `<span class="badge ${amber ? "amber" : ""}">${escapeHtml(text)}</span>`;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(value) {
  if (!value) return "";
  const d = new Date(value.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function emptyNote(label) {
  return `<p class="intro">No ${label} in the imported datasets for this login. Try patient <b>David Williams</b>, or open the doctor portal to see the full files.</p>`;
}

/* =========================================================
   Exercise prescription (paper composite score formula)
   ========================================================= */
function exercisePrescription(score, pain) {
  pain = Number(pain) || 0;
  score = Number(score) || 0;

  let level, cls, title, exercises, rationale;

  if (score < 40 || pain >= 7) {
    level = "LEVEL 1";
    cls = "lvl1";
    title = "Gentle Mobilization & Rest";
    rationale = pain >= 7
      ? `Pain score (${pain}/10) triggers conservative protocol regardless of composite score.`
      : `Composite score ${score}/100 is below the 40-point threshold.`;
    exercises = [
      "Passive ROM assisted by therapist — 3 × 10 reps",
      "Ice application 15 min post-session",
      "Isometric quadriceps sets (pain-free range only)",
      "Non-weight-bearing heel slides",
      "Deep breathing & relaxation exercises",
    ];
  } else if (score < 75) {
    level = "LEVEL 2";
    cls = "lvl2";
    title = "Active Recovery & Resistance Band Flexion";
    rationale = `Composite score ${score}/100 in the 40–74 range.`;
    exercises = [
      "Resistance band knee flexion — 3 × 12 reps",
      "Partial weight-bearing single-leg stance (30 s × 3)",
      "Mini-squat progression (0–45°) — 3 × 15 reps",
      "Step-up training on 10 cm block — 2 × 10 reps",
      "Stationary bike — 15 min low resistance",
    ];
  } else {
    level = "LEVEL 3";
    cls = "lvl3";
    title = "Full Functional Conditioning & Dynamic Plyometrics";
    rationale = `Composite score ${score}/100 meets the ≥ 75 threshold for advanced protocol.`;
    exercises = [
      "Dynamic plyometric jump landings — 3 × 8 reps",
      "Full squat to 90° with load — 3 × 12 reps",
      "Agility ladder drills — 4 × 30 s",
      "Sport-specific movement patterns",
      "Jogging / running progression on treadmill",
    ];
  }

  const pct = Math.min(100, score);
  return `<div class="rx-card ${cls}">
    <span class="rx-badge">${level}</span>
    <h3>${title}</h3>
    <p style="font-size:11px;margin:0 0 6px;opacity:.75">${escapeHtml(rationale)}</p>
    <ul class="rx-list">${exercises.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>
    <div class="score-row">
      <span>Composite score</span>
      <div class="score-bar"><i style="width:${pct}%"></i></div>
      <b>${score}/100</b>
    </div>
  </div>`;
}

/* =========================================================
   GPU / Telemetry simulator panel
   ========================================================= */
function telemetryPanel() {
  return `
  <p class="ey">RESEARCH TELEMETRY — IEEE ACCESS 2026</p>
  <h2>GPU Offloading &amp; Semantic Stability Simulator</h2>
  <p class="tele-intro">Replicate the paper's edge-AI experiment: toggle GPU offload layers and observe latency decomposition and Critical-Field Null Rate (CFNR) in real time. The Deterministic Rule Engine always remains isolated from LLM instability.</p>
  <div class="gpu-presets">
    <button class="gpu-btn ${currentGpuLayers === 0  ? 'active':''}" onclick="setGpuLayers(0)">⬛ CPU-Only (0 layers)</button>
    <button class="gpu-btn ${currentGpuLayers === 20 ? 'active':''}" onclick="setGpuLayers(20)">◧ Intermediate (20 layers)</button>
    <button class="gpu-btn ${currentGpuLayers === 30 ? 'active':''}" onclick="setGpuLayers(30)">■ Aggressive (30 layers)</button>
  </div>
  <div id="tele-results"><p class="intro">Loading telemetry…</p></div>`;
}

async function setGpuLayers(layers) {
  currentGpuLayers = layers;
  // Highlight active button immediately
  document.querySelectorAll(".gpu-btn").forEach((b) => {
    b.classList.toggle("active", b.textContent.includes(`(${layers}`));
  });
  // Update badge in assessment form if visible
  const badge = A("#gpu-mode-badge");
  if (badge) {
    const labels = {0:"CPU-Only (0 layers)", 20:"Intermediate (20 layers)", 30:"Aggressive (30 layers)"};
    badge.textContent = labels[layers] || `${layers} layers`;
    badge.className = "gpu-mode-badge" + (layers === 30 ? " gpu-badge-warn" : layers === 20 ? " gpu-badge-mid" : "");
  }
  const box = A("#tele-results");
  if (!box) return;
  box.innerHTML = `<p class="intro">Simulating GPU layers = ${layers}…</p>`;
  try {
    const m = await api(`/api/telemetry?gpu_layers=${layers}`);
    const alertBanner = m.safety_alert
      ? `<div class="cfnr-alert">
          <div class="icon">⚠️</div>
          <div>
            <h4>Clinical Safety Alert — 100% Critical-Field Null Rate</h4>
            <p>At ${layers} GPU layers, memory contention causes complete loss of the clinical schema fields <b>lesion</b>, <b>edad</b>, and <b>actividad</b>. The Deterministic Rule Engine is <b>isolated and unaffected</b> — patient exercise protocols remain valid.</p>
          </div>
        </div>` : "";

    box.innerHTML = `
      ${alertBanner}
      <div class="tele-grid">
        <div class="tele-metric ${m.cfnr >= 1 ? 'alert-red' : ''}">
          <small>CFNR</small>
          <b>${(m.cfnr * 100).toFixed(0)}%</b>
          <em>Critical-Field Null Rate</em>
        </div>
        <div class="tele-metric">
          <small>SVR</small>
          <b>${(m.svr * 100).toFixed(0)}%</b>
          <em>Schema Validity Rate</em>
        </div>
        <div class="tele-metric">
          <small>GPU LAYERS</small>
          <b>${m.gpu_layers}</b>
          <em>${escapeHtml(m.mode)}</em>
        </div>
        <div class="tele-metric">
          <small>TOTAL LATENCY</small>
          <b>${(m.latency_total_ms / 1000).toFixed(1)} s</b>
          <em>End-to-end per session</em>
        </div>
      </div>
      <p class="ey" style="margin-bottom:8px">LATENCY DECOMPOSITION · L_ASR + L_LLM + L_DB = L_TOTAL</p>
      <div class="tele-latency">
        <div class="lat-box"><small>L_ASR</small><b>${m.latency_asr_ms} ms</b></div>
        <div class="lat-box"><small>L_LLM</small><b>${m.latency_llm_ms} ms</b></div>
        <div class="lat-box"><small>L_DB</small><b>${m.latency_db_ms} ms</b></div>
        <div class="lat-box total"><small>L_TOTAL</small><b>${m.latency_total_ms} ms</b></div>
      </div>
      <div class="tele-result" style="margin-top:14px">
        <div class="tele-field"><label>OBSERVATION NOTE</label><p>${escapeHtml(m.note)}</p></div>
        <div class="tele-field"><label>DETERMINISTIC RULE ENGINE STATUS</label><p>✅ Isolated from LLM layer. Composite score formula and exercise protocol are computed independently of semantic extraction — patient safety is maintained at all GPU offload levels.</p></div>
      </div>`;
  } catch (err) {
    box.innerHTML = `<p class="intro">Telemetry unavailable: ${escapeHtml(err.message)}</p>`;
  }
}

/* =========================================================
   Home page
   ========================================================= */
async function loadClinicPage() {
  const q = clinicQuery();
  const emptySummary = { patients:0, doctors:0, appointments:0, scheduled:0, treatments:0, bills:0, pending_bills:0, admissions:0, rehab_patients:10 };
  const [summary, appointments, treatments, bills, admissions, doctors, directory] = await Promise.all([
    apiOr("/api/clinic/summary",           emptySummary),
    apiOr("/api/clinic/appointments" + q,  []),
    apiOr("/api/clinic/treatments"  + q,   []),
    apiOr("/api/clinic/bills"       + q,   []),
    apiOr("/api/clinic/admissions"  + q,   []),
    apiOr("/api/clinic/doctors",           []),
    apiOr("/api/clinic/directory",         []),
  ]);
  return { summary, appointments, treatments, bills, admissions, doctors, directory };
}

async function home() {
  let clinical = role === "doctor";
  let data;
  try { data = await loadClinicPage(); } catch (err) {
    return page(`<p class="intro">Unable to load hospital records: ${escapeHtml(err.message)}</p>`, clinical ? "Clinical home" : "Home");
  }
  const appts = data.appointments.slice(0, 6);
  const rows = appts.map((a) => `<tr>
    <td>${escapeHtml(a.appointment_date)}<small>${escapeHtml(a.appointment_time || "")}</small></td>
    <td>${clinical ? escapeHtml(a.patient_name) : escapeHtml(a.doctor_name)}<small>${escapeHtml(a.specialization || "")}</small></td>
    <td>${escapeHtml(a.reason_for_visit)}</td>
    <td>${statusBadge(a.status)}</td></tr>`).join("");
  const next = data.appointments[0];
  const pendingAmt = data.bills.filter((b) => b.payment_status === "Pending").reduce((s, b) => s + Number(b.amount || 0), 0);
  return page(
    `<div class="hero"><div><p class="ey">${clinical ? "CLINICAL WORKSPACE · IMPORTED RECORDS" : "YOUR CARE JOURNEY"}</p>
     <h2>${clinical ? "Good morning, Dr. Mehta." : "Good morning, " + user.split(" ")[0] + "."}</h2>
     <p class="intro">${clinical ? "Read-only outpatient, admissions and billing lists are loaded from the hospital CSV files. Rehabilitation remains the only writable module." : "Your appointments, bills and admissions below come from the hospital datasets. Rehabilitation updates live when your clinician saves a session."}</p></div>
     <button class="primary" onclick="go('outpatient')">${clinical ? "Open outpatient list" : "View appointments"}</button></div>
     <div class="cards">
       <div class="card metric"><small>${clinical ? "APPOINTMENTS" : "NEXT APPOINTMENT"}</small>
         <b>${clinical ? data.summary.appointments : next ? escapeHtml(next.appointment_date).slice(5) : "—"}</b>
         <em>${clinical ? data.summary.scheduled + " scheduled" : next ? escapeHtml(next.reason_for_visit) : "No clinic record for this login"}</em></div>
       <div class="card metric"><small>${clinical ? "REHAB CASELOAD" : "ACTIVE REHAB"}</small>
         <b>${data.summary.rehab_patients}</b><em>${clinical ? "Writable assessments" : "See Rehabilitation"}</em></div>
       <div class="card metric"><small>${clinical ? "INPATIENT SAMPLE" : "OPEN BILLS"}</small>
         <b>${clinical ? data.summary.admissions : data.bills.filter((b) => b.payment_status === "Pending").length}</b>
         <em>${clinical ? "From healthcare_dataset.csv" : pendingAmt ? money(pendingAmt) + " pending" : "Imported billing.csv"}</em></div>
       <div class="card metric"><small>${clinical ? "CLINIC PATIENTS" : "MY CARE TEAM"}</small>
         <b>${data.summary.patients}</b><em>${clinical ? "From patients.csv" : data.doctors.length + " doctors on roster"}</em></div>
     </div>
     <div class="two"><section class="card"><div class="head"><div><p class="ey">${clinical ? "RECENT APPOINTMENTS" : "UPCOMING CARE"}</p>
       <h2>${clinical ? "Patient encounters" : "Your appointments"}</h2></div>
       <button class="link" onclick="go('outpatient')">View all →</button></div>
       <table><thead><tr><th>DATE</th><th>${clinical ? "PATIENT" : "DOCTOR"}</th><th>VISIT</th><th>STATUS</th></tr></thead>
       <tbody>${rows || `<tr><td colspan="4">${emptyNote("appointments")}</td></tr>`}</tbody></table></section>
       <section class="card"><p class="ey">CARE TIMELINE</p><h2>${clinical ? "Imported activity" : "Recent activity"}</h2>
         <div class="timeline">
           <div class="event"><b>${data.summary.treatments} treatments</b><p>Loaded from treatments.csv</p><small>Read-only</small></div>
           <div class="event"><b>${data.summary.pending_bills} pending bills</b><p>Loaded from billing.csv</p><small>Read-only</small></div>
           <div class="event"><b>Rehabilitation assessments</b><p>Saved sessions sync on the Rehabilitation page.</p><small>Live</small></div>
         </div></section></div>`,
    clinical ? "Clinical home" : "Home"
  );
}

/* =========================================================
   Outpatient care
   ========================================================= */
async function outpatient() {
  const d = role === "doctor";
  let data;
  try { data = await loadClinicPage(); } catch (err) {
    return page(`<p class="intro">Unable to load outpatient records: ${escapeHtml(err.message)}</p>`, "Outpatient care");
  }
  const apptRows = data.appointments.map((a) => `<tr>
    <td>${escapeHtml(a.appointment_date)}<small>${escapeHtml(a.appointment_time || "")}</small></td>
    <td>${d ? escapeHtml(a.patient_name) : escapeHtml(a.doctor_name)}<small>${escapeHtml(a.specialization || "")} · ${escapeHtml(a.hospital_branch || "")}</small></td>
    <td>${escapeHtml(a.reason_for_visit)}</td>
    <td>${statusBadge(a.status)}</td></tr>`).join("");
  const latestTx  = data.treatments[0];
  const latestDoc = data.appointments[0];
  const medRows = data.treatments.slice(0, 12).map((t) => `<tr>
    <td>${escapeHtml(t.treatment_type)}</td><td>${escapeHtml(t.description)}</td>
    <td>${escapeHtml(t.treatment_date)}</td><td>${money(t.cost)}</td></tr>`).join("");
  const pending  = data.bills.filter((b) => b.payment_status !== "Paid");
  const paid     = data.bills.filter((b) => b.payment_status === "Paid");
  const billLines = (pending.length ? pending : data.bills).slice(0, 8).map((b) =>
    `<div class="bill"><span>${escapeHtml(b.treatment_type || b.bill_id)}<small>${escapeHtml(b.bill_date)} · ${escapeHtml(b.payment_method)}</small></span><b>${money(b.amount)}</b></div>`).join("");
  const receipts = paid.slice(0, 8).map((b) =>
    `<div class="bill"><span>${escapeHtml(b.bill_id)}<small>${escapeHtml(b.treatment_type || "Receipt")} · ${escapeHtml(b.bill_date)}</small></span><span class="badge">${escapeHtml(b.payment_status)}</span></div>`).join("");
  return page(
    `<p class="ey">OUTPATIENT DEPARTMENT</p>
     <h1 class="title">${d ? "Outpatient clinical list" : "Outpatient care"}</h1>
     <p class="intro">${d ? "Appointments, treatments and bills imported from appointments.csv, treatments.csv and billing.csv. This section is read-only." : "Your appointments, procedures and bills from the hospital datasets."}</p>
     ${!d ? `<div class="quick"><button onclick="toast('Outpatient booking is read-only. Records are loaded from the CSV datasets.','info')">＋ Book an appointment<span>Disabled in this demonstration</span></button>
       <button onclick="tab(document.querySelectorAll('.tab')[3],'op4')">▧ View receipts<span>Paid bills from billing.csv</span></button></div>` : ""}
     <div class="tabs">
       <button class="tab on" onclick="tab(this,'op1')">Appointments</button>
       <button class="tab" onclick="tab(this,'op2')">Clinical details</button>
       <button class="tab" onclick="tab(this,'op3')">Treatments</button>
       <button class="tab" onclick="tab(this,'op4')">Bills &amp; receipts</button>
     </div>
     <div class="panel on" id="op1"><div class="card tablecard"><table>
       <thead><tr><th>DATE &amp; TIME</th><th>${d ? "PATIENT" : "DOCTOR"}</th><th>VISIT</th><th>STATUS</th></tr></thead>
       <tbody>${apptRows || `<tr><td colspan="4">${emptyNote("appointments")}</td></tr>`}</tbody>
     </table></div></div>
     <div class="panel" id="op2"><div class="split">
       <article class="card"><p class="ey">LATEST CLINICAL SUMMARY</p>
         <h2>${escapeHtml((latestTx && latestTx.treatment_type) || "No procedure on file")}</h2>
         <p class="intro">${escapeHtml((latestTx && latestTx.description) || "Sign in as David Williams to see a clinic patient, or use the doctor portal for the full list.")}</p>
         <div class="note">Source: treatments.csv and appointments.csv · Read-only</div>
         <b>Visit reason</b><p class="intro">${escapeHtml((latestDoc && latestDoc.reason_for_visit) || "—")}</p>
       </article>
       <article class="card"><p class="ey">CARE CONTACT</p>
         <h2>${escapeHtml((latestDoc && ("Dr. " + latestDoc.doctor_name)) || "Clinic roster")}</h2>
         <p class="intro">${escapeHtml((latestDoc && latestDoc.specialization) || "")}</p>
         <p class="intro">${escapeHtml((latestDoc && latestDoc.hospital_branch) || "")}</p>
       </article>
     </div></div>
     <div class="panel" id="op3"><article class="card"><p class="ey">TREATMENTS</p><h2>Procedures on record</h2>
       <table><thead><tr><th>TYPE</th><th>DESCRIPTION</th><th>DATE</th><th>COST</th></tr></thead>
       <tbody>${medRows || `<tr><td colspan="4">${emptyNote("treatments")}</td></tr>`}</tbody></table>
     </article></div>
     <div class="panel" id="op4"><div class="split">
       <article class="card"><p class="ey">BILLS</p><h2>Imported billing</h2>
         ${billLines || emptyNote("bills")}
         ${pending.length ? `<div class="bill"><b>Pending / unpaid</b><b>${money(pending.reduce((s, b) => s + Number(b.amount || 0), 0))}</b></div>` : ""}
       </article>
       <article class="card"><p class="ey">RECEIPTS</p><h2>Paid documents</h2>
         ${receipts || emptyNote("paid receipts")}
       </article>
     </div></div>`,
    "Outpatient care"
  );
}

/* =========================================================
   Admissions
   ========================================================= */
async function admission() {
  const d = role === "doctor";
  let data;
  try { data = await loadClinicPage(); } catch (err) {
    return page(`<p class="intro">Unable to load admissions: ${escapeHtml(err.message)}</p>`, "Admissions");
  }
  const rows = data.admissions.map((a) => `<tr>
    <td>${d ? escapeHtml(a.patient_name) : "AD-" + a.admission_id}<small>Room ${escapeHtml(String(a.room_number || "—"))}</small></td>
    <td>${escapeHtml(a.admission_date)}<small>${escapeHtml(a.admission_type)}</small></td>
    <td>${escapeHtml(a.condition)}</td>
    <td>${escapeHtml(a.doctor_name)}</td>
    <td>${statusBadge(a.admission_type)}</td></tr>`).join("");
  const first     = data.admissions[0];
  const billLines = data.admissions.slice(0, 6).map((a) =>
    `<div class="bill"><span>${escapeHtml(a.condition)}<small>${escapeHtml(a.admission_date)}</small></span><b>${money(a.billing_amount)}</b></div>`).join("");
  const team = data.doctors.slice(0, 6).map((doc) =>
    `<tr><td>${escapeHtml(doc.specialization)}</td><td>Dr. ${escapeHtml(doc.name)}</td><td>${escapeHtml(doc.hospital_branch)}</td></tr>`).join("");
  return page(
    `<p class="ey">INPATIENT SERVICES</p>
     <h1 class="title">${d ? "Admissions &amp; rounds" : "Admissions"}</h1>
     <p class="intro">${d ? "Emergency and urgent stays sampled from healthcare_dataset.csv. Room, medication and billing are read-only." : "Admission sample linked to your clinic record, plus the imported inpatient dataset."}</p>
     <div class="tabs">
       <button class="tab on" onclick="tab(this,'ad1')">${d ? "Current inpatients" : "Admission summary"}</button>
       <button class="tab" onclick="tab(this,'ad2')">Room &amp; facility</button>
       <button class="tab" onclick="tab(this,'ad3')">Care team</button>
       <button class="tab" onclick="tab(this,'ad4')">Bills &amp; receipts</button>
     </div>
     <div id="ad1" class="panel on"><div class="card tablecard"><table>
       <thead><tr><th>${d ? "PATIENT" : "ADMISSION ID"}</th><th>ADMITTED</th><th>DIAGNOSIS</th><th>ATTENDING DOCTOR</th><th>TYPE</th></tr></thead>
       <tbody>${rows || `<tr><td colspan="5">${emptyNote("admissions")}</td></tr>`}</tbody>
     </table></div></div>
     <div id="ad2" class="panel"><div class="split">
       <article class="card"><p class="ey">ROOM ASSIGNMENT</p>
         <h2>Room ${escapeHtml(first ? String(first.room_number) : "—")}</h2>
         <p class="intro">${escapeHtml(first ? first.hospital_name : "No admission sample")}</p>
         <div class="note">Blood type ${escapeHtml(first ? first.blood_type : "—")} · Medication ${escapeHtml(first ? first.medication : "—")} · Tests ${escapeHtml(first ? first.test_results : "—")}</div>
         <p class="intro">Admitted ${escapeHtml(first ? first.admission_date : "—")} · Discharge ${escapeHtml(first ? first.discharge_date : "—")}</p>
       </article>
       <article class="card"><p class="ey">FACILITY SERVICES</p>
         <h2>During the stay</h2>
         <p class="intro">Insurance ${escapeHtml(first ? first.insurance_provider : "—")}. Records come from healthcare_dataset.csv and are not edited.</p>
       </article>
     </div></div>
     <div id="ad3" class="panel"><article class="card"><p class="ey">PROCEDURE &amp; CARE TEAM</p>
       <h2>${escapeHtml(first ? first.condition : "Inpatient care")}</h2>
       <p class="intro">Attending: ${escapeHtml(first ? first.doctor_name : "—")}. Roster below is from doctors.csv.</p>
       <table><thead><tr><th>ROLE</th><th>CLINICIAN</th><th>BRANCH</th></tr></thead>
       <tbody>${team}</tbody></table>
     </article></div>
     <div id="ad4" class="panel"><div class="split">
       <article class="card"><p class="ey">ADMISSION BILL</p><h2>Dataset amounts</h2>
         ${billLines || emptyNote("admission bills")}
       </article>
       <article class="card"><p class="ey">RECEIPTS</p><h2>Discharge window</h2>
         <div class="note">These figures are imported for display only. Original CSV files were not changed.</div>
       </article>
     </div></div>`,
    "Admissions"
  );
}

/* =========================================================
   Rehabilitation — helpers
   ========================================================= */
function latestSession(sessions) {
  return [...sessions].reverse().find((s) => s.pain_level != null) || null;
}

function sessionRows(sessions) {
  return [...sessions].reverse().map((s) => {
    const exerciseBtn = s.exercises ? `<button class="link" type="button" onclick="viewExercises('${s.session_id}', ${s.session_number})" style="margin-right:8px">📋 View exercises</button>` : "";
    const downloadBtn = s.exercises ? `<button class="link" type="button" onclick="downloadExercises('${s.session_id}', ${s.session_number})">⬇ Download exercises</button>` : "";
    return `<div class="event">
      <b>Session ${s.session_number} · Progress assessment</b>
      <p>Pain ${s.pain_level}/10 · Flexion ${s.rom_flexion}° · Extension ${s.rom_extension}° · Balance ${s.balance_score}</p>
      ${s.patient_feedback  ? `<p>Patient: ${escapeHtml(s.patient_feedback)}</p>`  : ""}
      ${s.therapist_notes   ? `<p>Clinician: ${escapeHtml(s.therapist_notes)}</p>` : ""}
      ${s.recommendation    ? `<p class="note" style="margin:5px 0;padding:8px"><b>Doctor remarked:</b> ${escapeHtml(s.recommendation)}</p>` : ""}
      ${exerciseBtn || downloadBtn ? `<div style="margin-top:8px">${exerciseBtn}${downloadBtn}</div>` : ""}
      <small>${fmtDate(s.session_date)}</small>
    </div>`;
  }).join("");
}

function viewExercises(sessionId, sessionNumber) {
  const sessions = window.__rehabSessions || [];
  const session = sessions.find(s => s.session_id === sessionId);
  if (!session || !session.exercises) {
    toast("No exercises found for this session", "error");
    return;
  }

  let exerciseData;
  try {
    exerciseData = JSON.parse(session.exercises);
  } catch (e) {
    toast("Unable to parse exercise data", "error");
    return;
  }

  const exerciseList = exerciseData.exercises.map(ex => `<li>${escapeHtml(ex)}</li>`).join("");

  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>Session ${sessionNumber} Exercises</h2>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
      </div>
      <div class="modal-body">
        <p class="ey">${escapeHtml(exerciseData.title)}</p>
        <ul class="rx-list">${exerciseList}</ul>
      </div>
      <div class="modal-footer">
        <button class="primary" onclick="downloadExercises('${sessionId}', ${sessionNumber})">⬇ Download exercises</button>
        <button onclick="this.closest('.modal-overlay').remove()">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add("show"));
}

function downloadExercises(sessionId, sessionNumber) {
  const sessions = window.__rehabSessions || [];
  const session = sessions.find(s => s.session_id === sessionId);
  if (!session || !session.exercises) {
    toast("No exercises found for this session", "error");
    return;
  }

  let exerciseData;
  try {
    exerciseData = JSON.parse(session.exercises);
  } catch (e) {
    toast("Unable to parse exercise data", "error");
    return;
  }

  const patientName = (window.__rehabPatientName || "Patient").replace(/\s+/g, "_");
  const date = new Date().toISOString().split('T')[0];

  let textContent = `REHABILITATION EXERCISES - SESSION ${sessionNumber}\n`;
  textContent += `Patient: ${window.__rehabPatientName || "N/A"}\n`;
  textContent += `Date: ${session.session_date || date}\n`;
  textContent += `\n${exerciseData.title}\n`;
  textContent += `${"=".repeat(exerciseData.title.length)}\n\n`;

  exerciseData.exercises.forEach((ex, idx) => {
    textContent += `${idx + 1}. ${ex}\n`;
  });

  textContent += `\n\nSession Metrics:\n`;
  textContent += `- Pain Level: ${session.pain_level}/10\n`;
  textContent += `- ROM Flexion: ${session.rom_flexion}°\n`;
  textContent += `- ROM Extension: ${session.rom_extension}°\n`;
  textContent += `- Balance Score: ${session.balance_score}\n`;

  const blob = new Blob([textContent], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${patientName}_Session${sessionNumber}_Exercises_${date}.txt`;
  a.click();
  URL.revokeObjectURL(url);

  toast("Exercise file downloaded successfully", "success");
}

function chartCard(title) {
  return `<article class="card chart-card">
    <p class="ey">PROGRESS GRAPH</p>
    <h2>${title}</h2>
    <p class="intro">Pain, knee flexion, knee extension and balance across every saved session.</p>
    <div class="chart-wrap"><canvas id="rehabChart"></canvas></div>
  </article>`;
}

function assessmentForm() {
  return `<article class="card" id="assess-card">
    <p class="ey">NEW ASSESSMENT — STEP 1</p>
    <h2>Enter session metrics</h2>
    <p class="intro">Fill in the clinical measurements, then run the GPU Assessment to see the AI evaluation before saving.</p>
    <form id="assessForm" class="assess-form" onsubmit="return false">
      <div class="form-grid">
        <label class="field">Pain (0–10)<input name="pain_level"    type="number" min="0" max="10"  placeholder="e.g. 3" required></label>
        <label class="field">Knee flexion (°)<input name="rom_flexion"   type="number" min="0" max="140" placeholder="e.g. 110" required></label>
        <label class="field">Knee extension lag (°)<input name="rom_extension" type="number" min="0" max="20"  placeholder="e.g. 5" required></label>
        <label class="field">Balance (0–100)<input name="balance_score" type="number" min="0" max="100" placeholder="e.g. 80" required></label>
      </div>
      <label class="field">Patient's response / feedback<textarea name="patient_feedback" rows="2" placeholder="How the patient felt during this session"></textarea></label>
      <label class="field">Initial clinical notes (used by GPU for lesion extraction)<textarea name="therapist_notes" rows="2" placeholder="e.g. ACL reconstruction — controlled loading, progressing well"></textarea></label>
      <div class="gpu-mode-info">
        <span class="ey" style="margin:0">ACTIVE GPU MODE:</span>
        <span id="gpu-mode-badge" class="gpu-mode-badge">CPU-Only (0 layers)</span>
        <span class="intro" style="margin:0;font-size:11px">Change in Research &amp; Telemetry tab</span>
      </div>
      <button class="primary gpu-assess-btn" type="button" onclick="runGpuAssessment()">
        ⚡ Run GPU Assessment
      </button>
    </form>
    <div id="rx-panel"></div>
  </article>`;
}

/* =========================================================
   Rehabilitation — doctor list
   ========================================================= */
async function rehab() {
  if (role === "doctor" && selectedPatientId) return rehabDetail(selectedPatientId, true);
  if (role === "patient") {
    if (!loggedPatientId) return page(
      `<p class="ey">REHABILITATION</p>
       <h1 class="title">My rehabilitation progress</h1>
       <p class="intro">This login is a clinic patient and is not on the live physiotherapy caseload. Sign in as <b>Ananya Patel</b> to open a writable rehab graph.</p>`,
      "Rehabilitation"
    );
    return rehabDetail(loggedPatientId, false);
  }
  return rehabDoctorList();
}

async function rehabDoctorList() {
  let list;
  try { list = await api("/api/patients"); } catch (err) {
    return page(`<p class="intro">Unable to load patients: ${escapeHtml(err.message)}</p>`, "Rehabilitation");
  }
  const rows = list.map((p) => {
    const pct = Math.max(0, Math.min(100, Number(p.progress_score) || 0));
    return `<tr class="click-row" onclick="openRehab('${p.patient_id}')">
      <td><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.patient_id)}</small></td>
      <td>${escapeHtml(p.diagnosis || p.program_name || "")}</td>
      <td>${escapeHtml(p.assigned_doctor || "Dr. Rohan Mehta")}</td>
      <td><div class="bar"><i style="width:${pct}%"></i></div>${pct}%</td>
      <td><button class="link" type="button">Open progress →</button></td>
    </tr>`;
  }).join("");
  return page(
    `<p class="ey">REHABILITATION</p>
     <h1 class="title">Rehabilitation management</h1>
     <p class="intro">Ten active patients with different recovery trajectories. Click a row to record a new assessment and review the live graph.</p>
     <div class="cards" style="margin-top:22px">
       <div class="card metric"><small>ACTIVE CASELOAD</small><b>${list.length}</b><em>Assigned to Dr. Rohan Mehta</em></div>
       <div class="card metric"><small>LIVE MODULE</small><b style="font-size:18px">Assessments</b><em>Writes to SQLite on save</em></div>
       <div class="card metric"><small>SYNCED VIEWS</small><b style="font-size:18px">Patient + doctor</b><em>Same graph, same records</em></div>
       <div class="card metric"><small>OTHER SECTIONS</small><b style="font-size:18px">Read-only</b><em>Demonstration content</em></div>
     </div>
     <div class="head"><div><p class="ey">PATIENT PROGRAMS</p><h2>Active rehabilitation list</h2></div></div>
     <div class="card tablecard"><table>
       <thead><tr><th>PATIENT</th><th>PROGRAM</th><th>THERAPIST</th><th>PROGRESS</th><th></th></tr></thead>
       <tbody>${rows}</tbody>
     </table></div>`,
    "Rehabilitation"
  );
}

/* =========================================================
   Rehabilitation — patient detail
   ========================================================= */
async function rehabDetail(patientId, isDoctor) {
  let data;
  try { data = await api(`/api/rehab/timeline?patient_id=${encodeURIComponent(patientId)}`); } catch (err) {
    return page(`<p class="intro">Unable to load timeline: ${escapeHtml(err.message)}</p>`, "Rehabilitation");
  }
  const patient  = data.patient  || {};
  const program  = data.program  || {};
  const sessions = data.sessions || [];
  const latest   = latestSession(sessions);
  const pct      = Math.max(0, Math.min(100, Number(program.progress_score) || 0));
  window.__rehabSessions  = sessions;
  window.__rehabPatientId = patientId;
  window.__rehabPatientName = patient.name || "Patient";

  const metrics = latest
    ? `<div class="cards" style="margin-top:8px">
        <div class="card metric"><small>PROGRESS</small><b class="prog-pct-live">${pct}%</b><em>${escapeHtml(program.program_name || "")}</em></div>
        <div class="card metric"><small>PAIN</small><b>${latest.pain_level}/10</b><em>Latest session</em></div>
        <div class="card metric"><small>KNEE FLEXION</small><b>${latest.rom_flexion}°</b><em>Latest session</em></div>
        <div class="card metric"><small>BALANCE</small><b>${latest.balance_score}</b><em>Extension lag ${latest.rom_extension}°</em></div>
      </div>`
    : `<p class="intro">No assessments recorded yet.</p>`;

  const back = isDoctor ? `<button class="link" type="button" onclick="closeRehab()">← Back to caseload</button>` : "";

  // Export button
  const exportBtn = `<a class="btn-export" href="/api/rehab/export?patient_id=${encodeURIComponent(patientId)}" download>⬇ Download session history (CSV)</a>`;

  const workspace = isDoctor
    ? `<div class="assess-layout">${assessmentForm()}${chartCard("Session trends")}</div>`
    : `<div class="assess-layout">${chartCard("Your session trends")}<article class="card">
         <p class="ey">CURRENT PROGRAM</p>
         <h2>${escapeHtml(program.program_name || "Rehabilitation")}</h2>
         <p class="intro">${escapeHtml(patient.diagnosis || "")}</p>
         <div class="bar"><i class="prog-bar-live" style="width:${pct}%"></i></div>
         <p class="intro"><span class="prog-pct-live">${pct}%</span> complete · updated whenever your clinician saves a session.</p>
         <div class="note">This graph matches the clinician record.</div>
       </article></div>`;

  // Rehab detail tabs: Clinical view | Research view
  const tabsHtml = isDoctor
    ? `<div class="tabs" style="margin-top:20px">
         <button class="tab on" onclick="tab(this,'rd1')">Clinical view</button>
         <button class="tab"    onclick="tab(this,'rd2');loadTelemetry()">Research &amp; telemetry</button>
       </div>
       <div class="panel on" id="rd1">
         ${workspace}
         <article class="card" style="margin-top:17px">
           <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
             <div><p class="ey">ASSESSMENT HISTORY</p><h2>Session timeline</h2></div>
             ${exportBtn}
           </div>
           <div class="timeline">${sessionRows(sessions) || "<p class='intro'>No sessions yet.</p>"}</div>
         </article>
       </div>
       <div class="panel" id="rd2">
         <div class="card" style="margin-top:17px">${telemetryPanel()}</div>
       </div>`
    : `${workspace}
       <article class="card" style="margin-top:17px">
         <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
           <div><p class="ey">ASSESSMENT HISTORY</p><h2>Session timeline</h2></div>
           ${exportBtn}
         </div>
         <div class="timeline">${sessionRows(sessions) || "<p class='intro'>No sessions yet.</p>"}</div>
       </article>`;

  return page(
    `${back}
     <p class="ey">REHABILITATION</p>
     <h1 class="title">${isDoctor ? escapeHtml(patient.name || "Patient") : "My rehabilitation progress"}</h1>
     <p class="intro">${isDoctor ? escapeHtml(patient.patient_id || "") + " · " + escapeHtml(patient.diagnosis || "") : "Assessment history, clinical progress and the same graph your clinician sees."}</p>
     ${metrics}
     ${tabsHtml}`,
    "Rehabilitation"
  );
}

function openRehab(id)  { selectedPatientId = id;   render(); }
function closeRehab()   { selectedPatientId = null; window.__rehabSessions = []; render(); }

function loadTelemetry() {
  // Trigger telemetry load when the Research tab is first opened
  const box = A("#tele-results");
  if (box && box.innerHTML.trim() === "") setGpuLayers(currentGpuLayers);
  else if (box) setGpuLayers(currentGpuLayers);
}

/* =========================================================
   Assessment — Step 1: Run GPU Assessment (no DB save yet)
   ========================================================= */
async function runGpuAssessment() {
  const form = A("#assessForm");
  if (!form) return;

  // Validate required fields
  const pain     = Number(form.pain_level.value);
  const flexion  = Number(form.rom_flexion.value);
  const ext      = Number(form.rom_extension.value);
  const balance  = Number(form.balance_score.value);

  if (!form.pain_level.value || !form.rom_flexion.value ||
      !form.rom_extension.value || !form.balance_score.value) {
    toast("Please fill in all four clinical measurements first.", "error");
    return;
  }

  const btn = form.querySelector(".gpu-assess-btn");
  btn.disabled = true;
  btn.textContent = "⏳ Running GPU Assessment…";

  try {
    const result = await api("/api/rehab/gpu-assess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pain_level:      pain,
        rom_flexion:     flexion,
        rom_extension:   ext,
        balance_score:   balance,
        therapist_notes: form.therapist_notes.value,
        gpu_layers:      currentGpuLayers,
      }),
    });

    // Store for Step 2
    window.__gpuResult  = result;
    window.__gpuInputs  = {
      pain, flexion, ext, balance,
      patient_feedback: form.patient_feedback.value,
      therapist_notes:  form.therapist_notes.value,
    };

    // Show GPU output + Step 2 form
    const rxPanel = A("#rx-panel");
    if (rxPanel) {
      rxPanel.innerHTML =
        gpuOutputPanel(result) +
        step2SaveForm(result.progress_score);
    }

    // Update assess card heading
    const eyLabel = A("#assess-card .ey");
    if (eyLabel) eyLabel.textContent = "NEW ASSESSMENT — STEP 2";
    const h2 = A("#assess-card h2");
    if (h2) h2.textContent = "GPU Assessment complete — review & save";

    rxPanel.scrollIntoView({ behavior: "smooth", block: "start" });

    btn.disabled = false;
    btn.textContent = "⚡ Re-run GPU Assessment";
  } catch (err) {
    toast("GPU assessment failed: " + err.message, "error");
    btn.disabled = false;
    btn.textContent = "⚡ Run GPU Assessment";
  }
}

/* =========================================================
   GPU Output panel — shown after Step 1
   ========================================================= */
function gpuOutputPanel(result) {
  const s = result.semantic;
  if (!s) return "";
  const cfnr = s.cfnr >= 1.0;

  const alertBanner = cfnr ? `
    <div class="sem-alert">
      <span class="sem-alert-icon">⚠️</span>
      <div>
        <b>Clinical Safety Alert — 100% Critical-Field Null Rate (CFNR)</b>
        <p>At GPU Layers = ${s.gpu_layers}, memory contention caused complete loss of
        <code>lesion</code>, <code>edad</code>, <code>actividad</code>.
        The Deterministic Rule Engine below is unaffected — exercise protocol is valid.</p>
      </div>
    </div>` : "";

  const metrics = `
    <div class="sem-metrics">
      <div class="sem-metric ${cfnr?'sem-fail':'sem-ok'}"><small>CFNR</small><b>${(s.cfnr*100).toFixed(0)}%</b><em>Critical-Field Null Rate</em></div>
      <div class="sem-metric sem-ok"><small>SVR</small><b>${(s.svr*100).toFixed(0)}%</b><em>Schema Validity Rate</em></div>
      <div class="sem-metric ${cfnr?'sem-fail':'sem-ok'}"><small>CFA</small><b>${(s.critical_field_accuracy*100).toFixed(0)}%</b><em>Critical-Field Accuracy</em></div>
      <div class="sem-metric"><small>GPU</small><b>${s.gpu_layers}L</b><em>${escapeHtml(s.mode)}</em></div>
    </div>`;

  const jsonObj = s.json_output || {};
  const jsonLines = Object.entries(jsonObj).map(([k,v]) => {
    const isNull = v === null;
    const isCrit = ["lesion","edad","actividad"].includes(k);
    const cls = isNull && isCrit ? "json-null-critical" : isNull ? "json-null" : "json-ok";
    const val = v === null ? "null" : typeof v === "string" ? `"${escapeHtml(String(v))}"` : escapeHtml(String(v));
    return `  <span class="${cls}">"${k}"</span>: <span class="${cls}">${val}</span>`;
  });
  const jsonBlock = `<pre class="sem-json">{
${jsonLines.join(",\n")}
}</pre>`;

  const latency = `
    <div class="sem-latency">
      <div class="sem-lat-box"><small>L_ASR</small><b>${s.latency_asr_ms} ms</b></div>
      <div class="sem-lat-box"><small>L_LLM</small><b>${s.latency_llm_ms} ms</b></div>
      <div class="sem-lat-box"><small>L_DB</small><b>${s.latency_db_ms} ms</b></div>
      <div class="sem-lat-box sem-lat-total"><small>L_TOTAL</small><b>${s.latency_total_ms} ms</b></div>
    </div>`;

  // Deterministic rule engine output
  const score = result.progress_score;
  const pain  = (window.__gpuInputs || {}).pain || 0;
  let lvl, lvlCls, lvlTitle, lvlNote;
  if (score < 40 || pain >= 7) {
    lvl="LEVEL 1"; lvlCls="sem-rule-l1"; lvlTitle="Gentle Mobilization & Rest";
    lvlNote = pain >= 7 ? `Pain ${pain}/10 triggers conservative protocol.` : `Score ${score}/100 below 40-point threshold.`;
  } else if (score < 75) {
    lvl="LEVEL 2"; lvlCls="sem-rule-l2"; lvlTitle="Active Recovery & Resistance Band Flexion";
    lvlNote = `Score ${score}/100 in the 40–74 range.`;
  } else {
    lvl="LEVEL 3"; lvlCls="sem-rule-l3"; lvlTitle="Full Functional Conditioning & Dynamic Plyometrics";
    lvlNote = `Score ${score}/100 meets ≥ 75 threshold.`;
  }

  return `
  <div class="sem-panel">
    <p class="ey" style="margin-bottom:6px">GPU SEMANTIC EXTRACTION — IEEE ACCESS 2026 · phi-3-mini Q4_K_S</p>
    <h3 style="margin:0 0 12px;font:700 16px 'Playfair Display'">ASR → Quantized LLM → Deterministic Rule Engine</h3>
    ${alertBanner}
    ${metrics}
    <div class="sem-body">
      <div>
        <p class="ey" style="margin-bottom:6px">EXTRACTED CLINICAL JSON SCHEMA</p>
        ${jsonBlock}
        <p class="ey" style="margin:12px 0 6px">LATENCY DECOMPOSITION · L_ASR + L_LLM + L_DB = L_TOTAL</p>
        ${latency}
      </div>
      <div>
        <p class="ey" style="margin-bottom:6px">DETERMINISTIC RULE ENGINE OUTPUT</p>
        <div class="sem-rule ${lvlCls}">
          <div class="sem-rule-head">
            <span class="sem-rule-badge">${lvl}</span>
            <span class="sem-rule-status">✅ Always executes — isolated from LLM</span>
          </div>
          <b>${lvlTitle}</b>
          <p>${escapeHtml(lvlNote)}</p>
          <p style="margin-top:6px">Composite score: <b>${score}/100</b></p>
        </div>
        <div class="sem-note">
          <b>Paper finding (GPU Layers = ${s.gpu_layers}):</b>
          SVR ${(s.svr*100).toFixed(0)}% · CFNR ${(s.cfnr*100).toFixed(0)}% · CFA ${(s.critical_field_accuracy*100).toFixed(0)}%.
          ${cfnr
            ? "Aggressive offloading: latency ↓21% but complete semantic failure. Rule Engine protects clinical outcomes."
            : "Stable extraction — all critical fields populated correctly."}
        </div>
      </div>
    </div>
  </div>`;
}

/* =========================================================
   Step 2: Doctor remarks + progress confirmation form
   ========================================================= */
function step2SaveForm(aiScore) {
  return `
  <div class="remarks-card" id="step2-card">
    <p class="ey" style="margin-bottom:6px">STEP 2 — DOCTOR REVIEW &amp; SAVE</p>
    <h3 style="margin:0 0 10px;font:700 16px 'Playfair Display'">Clinical conclusion &amp; final progress</h3>
    <p class="intro" style="margin-bottom:14px">
      Review the GPU assessment above. Add your clinical conclusion, then confirm or
      override the AI-computed progress score before saving to the patient's EHR.
    </p>
    <div class="form-grid" style="margin-bottom:12px">
      <div class="step2-score-box">
        <small>AI-COMPUTED SCORE</small>
        <b>${aiScore}/100</b>
        <em>From biomechanical formula</em>
      </div>
      <label class="field" style="margin:0">Set final progress %
        <input id="final-progress" type="number" min="0" max="100" value="${aiScore}"
          style="display:block;width:100%;margin-top:7px;border:1px solid #cbdadd;border-radius:6px;padding:12px">
        <small style="color:#778c92;font-size:10px;font-weight:400;margin-top:4px;display:block">Override if needed (0–100)</small>
      </label>
    </div>
    <label class="field">Doctor's clinical conclusion / remarks
      <textarea id="final-remarks" rows="3"
        placeholder="e.g. Good flexion improvement. Advancing to Level 2 protocol next session. Review pain on stairs."
        style="display:block;width:100%;margin-top:7px;border:1px solid #cbdadd;border-radius:6px;padding:12px;resize:vertical;font:inherit"></textarea>
    </label>
    <button class="primary" style="margin-top:12px;width:100%" onclick="saveFullAssessment()">
      💾 Save &amp; Sync to Patient EHR
    </button>
    <div id="save-result" style="margin-top:10px"></div>
  </div>`;
}

/* =========================================================
   Step 2 submit: save to DB + update progress everywhere
   ========================================================= */
async function saveFullAssessment() {
  const inputs = window.__gpuInputs || {};
  const gpuResult = window.__gpuResult || {};
  const finalProgress = Number(A("#final-progress").value);
  const finalRemarks  = (A("#final-remarks").value || "").trim();
  const saveBtn = document.querySelector("#step2-card .primary");

  if (!selectedPatientId) { toast("No patient selected.", "error"); return; }
  if (isNaN(finalProgress) || finalProgress < 0 || finalProgress > 100) {
    toast("Progress must be 0–100.", "error"); return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  try {
    // Save the assessment record to DB
    const result = await api("/api/rehab/assessment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patient_id:       selectedPatientId,
        doctor_id:        DOCTOR_ID,
        pain_level:       inputs.pain,
        rom_flexion:      inputs.flexion,
        rom_extension:    inputs.ext,
        balance_score:    inputs.balance,
        patient_feedback: inputs.patient_feedback,
        therapist_notes:  inputs.therapist_notes,
        gpu_layers:       currentGpuLayers,
      }),
    });

    // Save doctor remarks + progress override
    await api("/api/rehab/remarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patient_id:        selectedPatientId,
        session_id:        result.session_id,
        remarks:           finalRemarks,
        progress_override: finalProgress,
      }),
    });

    // Update live UI
    document.querySelectorAll(".prog-pct-live").forEach(el => el.textContent = finalProgress + "%");
    document.querySelectorAll(".prog-bar-live").forEach(el => el.style.width = finalProgress + "%");

    // Show success in save area
    const saveResult = A("#save-result");
    if (saveResult) saveResult.innerHTML = `
      <div class="remarks-saved">
        ✅ Assessment saved · Progress updated to <b>${finalProgress}%</b> ·
        Visible on patient portal immediately.
        ${finalRemarks ? `Doctor note: "${escapeHtml(finalRemarks.slice(0,80))}${finalRemarks.length>80?'…':''}"` : ""}
      </div>`;

    saveBtn.textContent = "✓ Saved — run another assessment to continue";
    saveBtn.disabled = false;

    // Refresh chart inline
    try {
      const updated = await api(`/api/rehab/timeline?patient_id=${encodeURIComponent(selectedPatientId)}`);
      window.__rehabSessions = updated.sessions || [];
      drawRehabChart();
      // Refresh timeline section if visible
      const tl = document.querySelector(".timeline");
      if (tl) tl.innerHTML = sessionRows(window.__rehabSessions) || "<p class='intro'>No sessions yet.</p>";
    } catch(_) {}

    toast(`Session saved. Progress: ${finalProgress}%. Patient portal updated.`, "success");
  } catch (err) {
    toast("Save failed: " + err.message, "error");
    saveBtn.disabled = false;
    saveBtn.textContent = "💾 Save & Sync to Patient EHR";
  }
}

/* =========================================================
   Assessment submit — kept for compatibility but now unused
   (workflow goes through runGpuAssessment → saveFullAssessment)
   ========================================================= */
async function submitAssessment(event) {
  if (event) event.preventDefault();
  return false;
}

/* =========================================================
   Semantic extraction panel (paper pipeline simulation)
   Shown after each assessment save — mirrors the
   ASR → LLM → Deterministic Rule Engine pipeline from
   "Reliability of Edge AI in XR-Based Health Data Capture"
   IEEE Access 2026
   ========================================================= */
function semanticExtractionPanel(s, score, pain) {
  if (!s) return "";

  const cfnrTriggered = s.cfnr >= 1.0;

  // ── Safety alert banner ────────────────────────────────
  const alertBanner = cfnrTriggered ? `
    <div class="sem-alert">
      <span class="sem-alert-icon">⚠️</span>
      <div>
        <b>Clinical Safety Alert — 100% Critical-Field Null Rate (CFNR)</b>
        <p>At GPU Layers = ${s.gpu_layers}, memory contention caused complete loss of critical schema fields
        (<code>lesion</code>, <code>edad</code>, <code>actividad</code>). The Deterministic Rule Engine
        is isolated and continues to operate correctly — the exercise protocol below is valid.</p>
      </div>
    </div>` : "";

  // ── Semantic metrics row ───────────────────────────────
  const metrics = `
    <div class="sem-metrics">
      <div class="sem-metric ${cfnrTriggered ? 'sem-fail' : 'sem-ok'}">
        <small>CFNR</small>
        <b>${(s.cfnr * 100).toFixed(0)}%</b>
        <em>Critical-Field Null Rate</em>
      </div>
      <div class="sem-metric sem-ok">
        <small>SVR</small>
        <b>${(s.svr * 100).toFixed(0)}%</b>
        <em>Schema Validity Rate</em>
      </div>
      <div class="sem-metric ${cfnrTriggered ? 'sem-fail' : 'sem-ok'}">
        <small>CFA</small>
        <b>${(s.critical_field_accuracy * 100).toFixed(0)}%</b>
        <em>Critical-Field Accuracy</em>
      </div>
      <div class="sem-metric">
        <small>GPU LAYERS</small>
        <b>${s.gpu_layers}</b>
        <em>${escapeHtml(s.mode)}</em>
      </div>
    </div>`;

  // ── JSON output block ──────────────────────────────────
  const jsonObj = s.json_output || {};
  const jsonLines = Object.entries(jsonObj).map(([k, v]) => {
    const isNull = v === null || v === undefined;
    const isCritical = ["lesion", "edad", "actividad"].includes(k);
    const cls = isNull && isCritical ? "json-null-critical" : isNull ? "json-null" : "json-ok";
    const valStr = v === null ? "null" : typeof v === "string" ? `"${escapeHtml(String(v))}"` : escapeHtml(String(v));
    return `  <span class="${cls}">"${k}"</span>: <span class="${cls}">${valStr}</span>`;
  });
  const jsonBlock = `<pre class="sem-json">{
${jsonLines.join(",\n")}
}</pre>`;

  // ── Latency decomposition ──────────────────────────────
  const latency = `
    <div class="sem-latency">
      <div class="sem-lat-box"><small>L_ASR</small><b>${s.latency_asr_ms} ms</b></div>
      <div class="sem-lat-box"><small>L_LLM</small><b>${s.latency_llm_ms} ms</b></div>
      <div class="sem-lat-box"><small>L_DB</small><b>${s.latency_db_ms} ms</b></div>
      <div class="sem-lat-box sem-lat-total"><small>L_TOTAL</small><b>${s.latency_total_ms} ms</b></div>
    </div>`;

  // ── Rule Engine conclusion ─────────────────────────────
  let ruleLevel, ruleCls, ruleTitle;
  if (score < 40 || pain >= 7) {
    ruleLevel = "LEVEL 1"; ruleCls = "sem-rule-l1";
    ruleTitle = "Gentle Mobilization & Rest";
  } else if (score < 75) {
    ruleLevel = "LEVEL 2"; ruleCls = "sem-rule-l2";
    ruleTitle = "Active Recovery & Resistance Band Flexion";
  } else {
    ruleLevel = "LEVEL 3"; ruleCls = "sem-rule-l3";
    ruleTitle = "Full Functional Conditioning & Dynamic Plyometrics";
  }
  const ruleEngine = `
    <div class="sem-rule ${ruleCls}">
      <div class="sem-rule-head">
        <span class="sem-rule-badge">DETERMINISTIC RULE ENGINE · ${ruleLevel}</span>
        <span class="sem-rule-status">✅ Isolated from LLM — always executes</span>
      </div>
      <b>${ruleTitle}</b>
      <p>Composite score <b>${score}/100</b> computed independently from pain (${pain}/10),
      flexion, extension and balance inputs. Protocol is valid regardless of GPU offload level.</p>
    </div>`;

  return `
  <div class="sem-panel">
    <p class="ey" style="margin-bottom:6px">LLM SEMANTIC EXTRACTION — IEEE ACCESS 2026 PIPELINE SIMULATION</p>
    <h3 style="margin:0 0 12px;font:700 16px 'Playfair Display'">
      ASR → Quantized LLM → Deterministic Rule Engine
    </h3>
    ${alertBanner}
    ${metrics}
    <div class="sem-body">
      <div>
        <p class="ey" style="margin-bottom:6px">EXTRACTED JSON SCHEMA (phi-3-mini Q4_K_S)</p>
        ${jsonBlock}
        <p class="ey" style="margin:12px 0 6px">LATENCY DECOMPOSITION · L_ASR + L_LLM + L_DB = L_TOTAL</p>
        ${latency}
      </div>
      <div>
        <p class="ey" style="margin-bottom:6px">RULE ENGINE OUTPUT</p>
        ${ruleEngine}
        <div class="sem-note">
          <b>Paper finding (Table 4 — GPU Layers = ${s.gpu_layers}):</b>
          SVR ${(s.svr*100).toFixed(0)}% · CR ${(s.cr*100).toFixed(0)}% ·
          CFNR ${(s.cfnr*100).toFixed(0)}% · CFA ${(s.critical_field_accuracy*100).toFixed(0)}%.
          ${cfnrTriggered
            ? "Aggressive offloading reduces latency by ~21% but causes complete semantic failure. The Deterministic Rule Engine prevents this from affecting clinical outcomes."
            : "Stable extraction. All critical fields populated. Schema validity and completeness confirmed."
          }
        </div>
      </div>
    </div>
  </div>`;
}

/* =========================================================
   Rehab chart
   ========================================================= */
function drawRehabChart() {
  const canvas = A("#rehabChart");
  if (!canvas || typeof Chart === "undefined") return;
  const sessions = window.__rehabSessions || [];
  if (rehabChart) { rehabChart.destroy(); rehabChart = null; }
  const labels = sessions.map((s) => `S${s.session_number}`);
  rehabChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Pain (0–10)",      data: sessions.map((s) => s.pain_level),    borderColor: "#c95d54", backgroundColor: "#c95d5433", yAxisID: "yPain", tension: 0.25, fill: false },
        { label: "Knee flexion (°)", data: sessions.map((s) => s.rom_flexion),   borderColor: "#078981", backgroundColor: "#07898133", yAxisID: "y",     tension: 0.25, fill: false },
        { label: "Knee extension (°)",data:sessions.map((s) => s.rom_extension), borderColor: "#ce916b", backgroundColor: "#ce916b33", yAxisID: "yPain", tension: 0.25, fill: false },
        { label: "Balance (0–100)",  data: sessions.map((s) => s.balance_score), borderColor: "#0c2635", backgroundColor: "#0c263533", yAxisID: "y",     tension: 0.25, fill: false },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        y:     { position: "left",  title: { display: true, text: "Flexion / Balance"   }, suggestedMin: 0, suggestedMax: 140 },
        yPain: { position: "right", title: { display: true, text: "Pain / Extension (°)" }, min: 0, max: 20, grid: { drawOnChartArea: false } },
      },
    },
  });
}

/* =========================================================
   Analytics dashboard (doctor-only)
   ========================================================= */
async function analytics() {
  if (role !== "doctor") return page(`<p class="intro">Analytics is available in the doctor portal only.</p>`, "Analytics");
  let patients;
  try { patients = await api("/api/analytics/caseload"); } catch (err) {
    return page(`<p class="intro">Unable to load analytics: ${escapeHtml(err.message)}</p>`, "Analytics");
  }

  const avgProgress = patients.length
    ? Math.round(patients.reduce((s, p) => s + Number(p.progress_score || 0), 0) / patients.length)
    : 0;
  const above70  = patients.filter((p) => Number(p.progress_score) >= 70).length;
  const highPain = patients.filter((p) => Number(p.latest_pain)     >= 7).length;

  const painRows = [...patients].sort((a, b) => Number(b.latest_pain) - Number(a.latest_pain))
    .map((p) => {
      const pain = Number(p.latest_pain) || 0;
      const pct  = (pain / 10) * 100;
      return `<div class="pain-row">
        <span class="pain-name">${escapeHtml(p.name.split(" ")[0])}</span>
        <div class="pain-bar"><i style="width:${pct}%"></i></div>
        <span class="pain-val">${pain}/10</span>
      </div>`;
    }).join("");

  window.__analyticsPatients = patients;

  return page(
    `<p class="ey">CLINICAL ANALYTICS</p>
     <h1 class="title">Caseload analytics</h1>
     <p class="intro">Live metrics from the rehabilitation database. Charts update when new assessments are saved.</p>
     <div class="analytics-grid">
       <div class="card metric"><small>AVERAGE PROGRESS</small><b>${avgProgress}%</b><em>Across all ${patients.length} patients</em></div>
       <div class="card metric"><small>PATIENTS ≥ 70%</small><b>${above70}</b><em>${patients.length - above70} still below threshold</em></div>
       <div class="card metric"><small>HIGH PAIN (≥ 7)</small><b style="color:#c95d54">${highPain}</b><em>Consider Level 1 protocol review</em></div>
     </div>
     <div class="two">
       <div class="analytics-chart">
         <p class="ey">PROGRESS SCORES</p>
         <h2>All patients — current score</h2>
         <p class="intro">Composite score (0–100) computed from pain, flexion, extension and balance.</p>
         <div class="chart-tall"><canvas id="analyticsChart"></canvas></div>
       </div>
       <div class="analytics-chart">
         <p class="ey">PAIN LEVELS</p>
         <h2>Latest session pain (0–10)</h2>
         <p class="intro">Sorted by highest pain. Scores ≥ 7 trigger Level 1 protocol.</p>
         ${painRows}
       </div>
     </div>`,
    "Analytics"
  );
}

function drawAnalyticsChart() {
  const canvas = A("#analyticsChart");
  if (!canvas || typeof Chart === "undefined") return;
  const patients = window.__analyticsPatients || [];
  if (analyticsChart) { analyticsChart.destroy(); analyticsChart = null; }
  const labels   = patients.map((p) => p.name.split(" ")[0]);
  const scores   = patients.map((p) => Number(p.progress_score) || 0);
  const colors   = scores.map((s) => s >= 75 ? "#19a294" : s >= 40 ? "#ce916b" : "#c95d54");
  analyticsChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Progress score",
        data: scores,
        backgroundColor: colors,
        borderRadius: 5,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `Score: ${ctx.parsed.y}/100` } },
      },
      scales: {
        y: { min: 0, max: 100, title: { display: true, text: "Score (0–100)" } },
      },
    },
  });
}

/* =========================================================
   Static pages
   ========================================================= */
function services() {
  return page(
    `<p class="ey">HOSPITAL SERVICES</p><h1 class="title">Support when you need it</h1><p class="intro">Contact information, access details and patient support services.</p><div class="services" style="margin-top:24px"><article class="card danger"><p class="ey">EMERGENCY</p><h3>24-hour emergency care</h3><p>For urgent medical help, call the Emergency Department directly.</p><h2>+91 80 4000 1122</h2></article><article class="card"><p class="ey">PATIENT SUPPORT</p><h3>Patient relations desk</h3><p>Appointments, admission support, feedback and visitor information.</p><b>+91 80 4000 1188</b><p>Daily · 8:00 AM–8:00 PM</p></article><article class="card"><p class="ey">AMBULANCE</p><h3>Ambulance service</h3><p>Coordinated medical transport for emergency and planned transfers.</p><b>+91 80 4000 1111</b><p>Available 24 hours</p></article><article class="card"><p class="ey">PHARMACY</p><h3>In-house pharmacy</h3><p>Prescription medicines and discharge medication support.</p><b>Open 24 hours</b></article><article class="card"><p class="ey">DIAGNOSTICS</p><h3>Laboratory &amp; imaging</h3><p>Blood work, X-ray, MRI, CT and ultrasound services.</p><b>Mon–Sat · 6:00 AM–9:00 PM</b></article><article class="card"><p class="ey">VISITOR SERVICES</p><h3>Visitor information</h3><p>Visitor lounge, cafeteria, parking and accessibility assistance.</p><b>Daily · 9:00 AM–7:00 PM</b></article></div>`,
    "Hospital services"
  );
}

async function hospital() {
  let doctors = [], directory = [];
  try {
    doctors   = await api("/api/clinic/doctors");
    directory = await api("/api/clinic/directory");
  } catch (err) {
    return page(`<p class="intro">Unable to load the doctor directory: ${escapeHtml(err.message)}</p>`, "Hospital information");
  }
  const roster = doctors.map((d) => `<article class="card"><p class="ey">${escapeHtml(d.specialization).toUpperCase()}</p>
    <h3>Dr. ${escapeHtml(d.name)}</h3>
    <p>${escapeHtml(d.hospital_branch)} · ${escapeHtml(String(d.years_experience))} years</p>
    <small>${escapeHtml(d.email)}</small></article>`).join("");
  const specialists = directory.slice(0, 12).map((d) => `<article class="card"><p class="ey">${escapeHtml(d.specialty).toUpperCase()}</p>
    <h3>${escapeHtml(d.doctor_name)}</h3>
    <p>Imported from doctors_dataset.csv</p></article>`).join("");
  return page(
    `<p class="ey">NORTHSTAR MEDICAL CENTER</p>
     <h1 class="title">Hospital information</h1>
     <p class="intro">Location stays as the campus profile. Care teams below are imported from doctors.csv and doctors_dataset.csv (read-only).</p>
     <div class="split" style="margin-top:24px">
       <article class="card"><p class="ey">OUR LOCATION</p><h2>Northstar Medical Center</h2>
         <p class="intro">14, Health Avenue, Indiranagar<br>Bengaluru, Karnataka 560038</p>
         <div class="note">Main reception: +91 80 4000 1100<br>Open 24 hours, every day</div>
         <b>Access &amp; parking</b>
         <p class="intro">Accessible entrance, patient drop-off zone, paid visitor parking and wheelchair support available.</p>
       </article>
       <article class="card"><p class="ey">FACILITIES</p><h2>Designed for complete care</h2>
         <p class="intro">24-hour emergency, critical care, modular operating theatres, inpatient rooms, pharmacy, diagnostics, rehabilitation gym, cafeteria, prayer room and patient transport.</p>
       </article>
     </div>
     <div class="head"><div><p class="ey">CLINIC ROSTER</p><h2>From doctors.csv</h2></div></div>
     <div class="doctors">${roster}</div>
     <div class="head"><div><p class="ey">SPECIALIST DIRECTORY</p><h2>From doctors_dataset.csv</h2></div></div>
     <div class="doctors">${specialists}</div>`,
    "Hospital information"
  );
}

function milestones() {
  return page(
    `<p class="ey">OUR STORY</p><h1 class="title">Milestones &amp; achievements</h1><p class="intro">A legacy of clinical care, innovation and service to our community.</p><div class="milestones" style="margin-top:24px"><article class="card"><b>25</b><h3>Years of care</h3><p>Serving patients and families across Bengaluru since 2001.</p></article><article class="card"><b>4.8/5</b><h3>Patient experience</h3><p>Independent patient feedback rating for communication, care and facilities.</p></article><article class="card"><b>38</b><h3>Clinical specialties</h3><p>Integrated teams across medical, surgical and rehabilitation care.</p></article><article class="card"><b>12k+</b><h3>Successful procedures</h3><p>Orthopedic and surgical procedures completed with coordinated recovery planning.</p></article><article class="card"><b>2025</b><h3>Quality recognition</h3><p>Regional recognition for patient safety and clinical quality improvement.</p></article><article class="card"><b>6</b><h3>Community programs</h3><p>Health screening, school wellness and rehabilitation outreach programs each year.</p></article></div><div class="card" style="margin-top:17px"><p class="ey">OUR COMMITMENT</p><h2>Every interaction is part of a patient's recovery.</h2><p class="intro">Northstar combines specialist expertise with transparent information, respectful communication and coordinated care from first consultation through recovery.</p></div>`,
    "Our milestones"
  );
}

/* =========================================================
   Tab helper
   ========================================================= */
function tab(el, id) {
  el.parentElement.querySelectorAll(".tab").forEach((x) => x.classList.remove("on"));
  el.classList.add("on");
  const parent = el.parentElement.parentElement;
  parent.querySelectorAll(".panel").forEach((x) => x.classList.remove("on"));
  A("#" + id).classList.add("on");
}

/* =========================================================
   Logout
   ========================================================= */
function logout() {
  role = "patient";
  view = "home";
  user = "";
  loggedPatientId = null;
  loggedClinicId = null;
  selectedPatientId = null;
  currentGpuLayers = 0;
  window.__rehabSessions = [];
  window.__gpuResult = null;
  window.__gpuInputs = null;
  history.pushState({ view: "login" }, "", "#login");
  A("#app").innerHTML = login();
}

/* =========================================================
   Navigation
   ========================================================= */
function go(x) {
  if (x !== "rehab") selectedPatientId = null;
  view = x;
  history.pushState({ view: x, patientId: selectedPatientId }, "", "#" + x);
  render();
}

/* =========================================================
   Render loop
   ========================================================= */
async function render() {
  const current = view;
  const asyncViews = { rehab, home, outpatient, admission, hospital, analytics };
  if (asyncViews[current]) {
    A("#app").innerHTML = skeletonPage(current.charAt(0).toUpperCase() + current.slice(1));
    const html = await asyncViews[current]();
    if (view !== current) return;
    A("#app").innerHTML = html;
    if (view === "rehab")      drawRehabChart();
    if (view === "analytics")  drawAnalyticsChart();
    return;
  }
  if (current === "services")   A("#app").innerHTML = services();
  else if (current === "milestones") A("#app").innerHTML = milestones();
  else A("#app").innerHTML = login();
}

/* =========================================================
   Boot
   ========================================================= */
// Handle browser back/forward
window.addEventListener("popstate", (e) => {
  const state = e.state;
  if (!state || state.view === "login" || !user) {
    // Back to login — reset state
    role = "patient"; view = "home"; user = "";
    loggedPatientId = null; loggedClinicId = null; selectedPatientId = null;
    A("#app").innerHTML = login();
    return;
  }
  view = state.view || "home";
  selectedPatientId = state.patientId || null;
  render();
});

// Push initial login state so back arrow works from the first page
history.replaceState({ view: "login" }, "", "#login");
A("#app").innerHTML = login();
