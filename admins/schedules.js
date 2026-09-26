// جداول الأقسام / جداول المعلمين — two sheets adminpage.html opens from its
// sidebar's الجداول group. Built like the absence sheets (newabsence.js …):
// each renders into a shadow root on the host element it's given, so its
// ids/classes can't collide with the page's own, and it reuses the page's
// Firestore instance and its single shared attendance sheet.
//
//   mountDeptSchedulesSheet(host, hooks)    — a department's schedule for a
//     day or a whole week, coloured by whether attendance was taken, each
//     lesson opening its details (and تسجيل/تعديل الغياب); PDF download of
//     the day or the week.
//   mountTeacherSchedulesSheet(host, hooks) — any teacher's week (department
//     → teacher), with covers and special-day schedules applied.
//
// hooks: close(), openSidebar(), attendance, onAttendanceSaved(fn),
//        getSession() → { user, data, classList }
import { firebaseConfig } from "/shared/firebase.js";
import { initializeApp, getApp, getApps } from "/shared/firebase.js";
import { getFirestore, collection, getDocs, getDoc, doc, query, where } from "/shared/firebase.js";
import { kuwaitTodayISO } from "/shared/kuwait-time.js";
import { DEPARTMENT_LIST, resolveDepartmentName } from "/shared/departments.js";
import { teacherScheduleUids } from "/shared/schedule-teacher-identity.js";
import { classKeyFromRow, normalizeClassKey, getOverriddenClassKeys } from "/shared/schedule-priority.js";

const CSS_URL = new URL("./schedules.css", import.meta.url).href;
const DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"];
const ORDINALS = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة"];
const LESSONS = 7;
const STORE_KEY = "adminSchedules:last";

/* ---------------- small helpers ---------------- */
const toArabicDigits = (v) => String(v ?? "").replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const isoToDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const dateToISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDaysISO = (iso, n) => { const d = isoToDate(iso); d.setDate(d.getDate() + n); return dateToISO(d); };
const weekdayOf = (iso) => isoToDate(iso).getDay(); // 0 = Sunday
// The school week (Sun-Thu) for a date; on Friday/Saturday the coming one —
// same rule as the teachers' own جدولي الأسبوعي.
function weekStartFor(iso) {
  const dow = weekdayOf(iso);
  const sunday = addDaysISO(iso, -dow);
  return dow >= 5 ? addDaysISO(sunday, 7) : sunday;
}
const weekDatesFor = (startISO) => [0, 1, 2, 3, 4].map((n) => addDaysISO(startISO, n));
function fmtShort(iso) {
  const [y, m, d] = iso.split("-");
  return toArabicDigits(`${Number(d)} / ${Number(m)} / ${y.slice(-2)}`);
}
const fmtLong = (iso) => toArabicDigits(new Intl.DateTimeFormat("ar-KW", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(isoToDate(iso)));
const rangeText = (startISO) => `${fmtShort(startISO)} – ${fmtShort(addDaysISO(startISO, 4))}`;
const rowMs = (row) => { const t = row?.updatedAt || row?.createdAt; return (t && typeof t.toMillis === "function") ? t.toMillis() : 0; };
const tsTime = (t) => {
  const d = t?.toDate ? t.toDate() : (t?.seconds ? new Date(t.seconds * 1000) : null);
  return d ? toArabicDigits(new Intl.DateTimeFormat("ar-KW", { hour: "numeric", minute: "2-digit", hour12: false, timeZone: "Asia/Kuwait" }).format(d)) : "";
};
function remember(patch) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...recall(), ...patch })); } catch {}
}
function recall() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; } catch { return {}; }
}

const ICON = {
  menu: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  day: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M9 15h6"/></svg>',
  week: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M7 14h2M11 14h2M15 14h2M7 18h2M11 18h2"/></svg>',
  pick: '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
};

/* ---------------- shared data (one copy per page) ---------------- */
function dbFor() {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getFirestore(app);
}
let teachersPromise = null;
function loadTeachers(db) {
  if (!teachersPromise) {
    teachersPromise = getDocs(collection(db, "teachers")).then((snap) => {
      const profiles = [];
      const teachers = [];
      snap.forEach((d) => {
        const data = d.data() || {};
        profiles.push({ ...data, id: d.id });
        const role = (data.role || "").toString().toLowerCase();
        if (role === "admin") return;
        const dept = resolveDepartmentName(data.department || data.dept || data.subject || "");
        if (!dept || !data.name) return;
        teachers.push({ uid: d.id, name: data.name.toString(), role, dept });
      });
      teachers.sort((a, b) => a.name.localeCompare(b.name, "ar"));
      return { profiles, teachers };
    }).catch((e) => { teachersPromise = null; throw e; });
  }
  return teachersPromise;
}
// The whole school's standing schedule (Sun-Thu), refreshed at most once a
// minute — both sheets read from this one copy.
let schedCache = null;
function loadSchedules(db, { force = false } = {}) {
  if (force || !schedCache || Date.now() - schedCache.at > 60000) {
    const promise = getDocs(query(collection(db, "schedules"), where("dayIndex", "in", [0, 1, 2, 3, 4, "0", "1", "2", "3", "4"])))
      .then((snap) => snap.docs.map((d) => ({ ...(d.data() || {}), _id: d.id })).filter((r) => !r.deletedAt))
      .catch((e) => { schedCache = null; throw e; });
    schedCache = { at: Date.now(), promise };
  }
  return schedCache.promise;
}
let lessonTimesPromise = null;
function loadLessonTimes(db) {
  if (!lessonTimesPromise) {
    lessonTimesPromise = getDoc(doc(db, "settings", "lessonTimes"))
      .then((s) => (s.exists() && Array.isArray(s.data()?.times)) ? s.data().times : [])
      .catch(() => []);
  }
  return lessonTimesPromise;
}
function departmentsWithCounts(teachers) {
  const counts = new Map();
  teachers.forEach((t) => counts.set(t.dept, (counts.get(t.dept) || 0) + 1));
  return [...DEPARTMENT_LIST.filter((d) => counts.has(d)), ...[...counts.keys()].filter((d) => !DEPARTMENT_LIST.includes(d))]
    .map((d) => ({ dept: d, count: counts.get(d) }));
}

async function mountShell(host, title, hooks) {
  const res = await fetch(CSS_URL);
  if (!res.ok) throw new Error(`schedules.css: HTTP ${res.status}`);
  const css = await res.text();
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:contents";
  wrap.innerHTML = `
    <header class="sch-header">
      <button class="sch-icon-btn sch-menu" type="button" aria-label="فتح القائمة" title="القائمة">${ICON.menu}</button>
      <h2 class="sch-title">${escapeHtml(title)}</h2>
      <button class="sch-icon-btn sch-back" type="button" aria-label="رجوع" title="رجوع">${ICON.back}</button>
    </header>
    <div class="sch-body"></div>
    <div class="sch-backdrop"></div>
    <div class="sch-modal" role="dialog" aria-modal="true"></div>`;
  root.append(style, wrap);
  root.querySelector(".sch-menu").addEventListener("click", () => hooks.openSidebar?.());
  root.querySelector(".sch-back").addEventListener("click", () => hooks.close?.());
  const body = root.querySelector(".sch-body");
  const backdrop = root.querySelector(".sch-backdrop");
  const modal = root.querySelector(".sch-modal");
  const modalApi = {
    open(html) { modal.innerHTML = html; backdrop.classList.add("open"); modal.classList.add("open"); modal.querySelector(".sch-x")?.addEventListener("click", modalApi.close); },
    close() { backdrop.classList.remove("open"); modal.classList.remove("open"); modal.innerHTML = ""; },
    isOpen: () => modal.classList.contains("open"),
    el: modal,
  };
  backdrop.addEventListener("click", () => modalApi.close());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalApi.isOpen() && host.getClientRects().length) modalApi.close();
  });
  return { root, body, modal: modalApi };
}

/* =====================================================================
   جداول الأقسام
   ===================================================================== */
export async function mountDeptSchedulesSheet(host, hooks = {}) {
  const db = dbFor();
  const { root, body, modal } = await mountShell(host, "جداول الأقسام", hooks);
  body.innerHTML = `
    <div class="sch-toolbar">
      <div class="sch-select-wrap"><select class="sch-select" id="deptSel" aria-label="القسم"><option value="">اختر القسم...</option></select></div>
      <div class="sch-seg" role="tablist" aria-label="العرض">
        <button type="button" data-view="day" class="active">اليوم</button>
        <button type="button" data-view="week">الأسبوع</button>
      </div>
      <label class="sch-btn sch-date-btn" id="dateBtn" title="اختيار التاريخ">
        ${ICON.calendar}<span id="dateLabel">—</span>
        <input type="date" id="dateInput" aria-label="اختيار التاريخ">
      </label>
      <div class="sch-range" id="weekRange" hidden><b id="weekRangeText">—</b><small id="weekRangeSub"></small></div>
      <button class="sch-btn icon" type="button" id="dlBtn" aria-label="تنزيل جدول القسم" title="تنزيل جدول القسم">${ICON.download}</button>
    </div>
    <div class="sch-legend" id="legend" hidden>
      <span><i class="taken"></i>تم تسليم الغياب</span><span><i class="missing"></i>لم يُسلَّم</span><span><i class="future"></i>لم تبدأ</span>
    </div>
    <div class="sch-state active" id="stPick"><div class="sch-center"><div class="sch-empty-hint">${ICON.pick}<span>اختر القسم لعرض جدوله</span></div></div></div>
    <div class="sch-state" id="stLoading"><div class="sch-center"><div class="sch-spinner"></div></div></div>
    <div class="sch-state" id="stError"><div class="sch-center"><div class="sch-error">تعذّر تحميل جدول القسم. تحقّق من الاتصال وحاول مرة أخرى.</div></div></div>
    <div class="sch-state" id="stOk"><div class="sch-table-shell"><div class="sch-table-scroll" id="scroll"><table class="sch-table" id="table"><thead id="thead"></thead><tbody id="tbody"></tbody></table></div></div></div>`;

  const $ = (id) => root.getElementById(id);
  const deptSel = $("deptSel"), dateInput = $("dateInput"), dateLabel = $("dateLabel");
  const states = ["stPick", "stLoading", "stError", "stOk"].map($);
  const show = (id) => states.forEach((s) => s.classList.toggle("active", s.id === id));

  const today = kuwaitTodayISO();
  const saved = recall();
  let dept = "";
  let view = saved.deptView === "week" ? "week" : "day";
  let dateISO = today;
  let teachers = [];
  let data = null;          // { dates, cells: [dateIdx][uid][lesson] }
  let requestId = 0;

  async function fetchCells(dates) {
    const [{ teachers: all }, rows, sessSnap] = await Promise.all([
      loadTeachers(db), loadSchedules(db),
      getDocs(query(collection(db, "attendanceSessions"), where("date", "in", dates))),
    ]);
    teachers = all.filter((t) => t.dept === dept);
    const uids = new Set(teachers.map((t) => t.uid));
    // newest row per (weekday, teacher, lesson)
    const byKey = new Map();
    rows.forEach((r) => {
      const day = Number(r.dayIndex), lesson = Number(r.lesson);
      if (!uids.has(r.teacherUid) || !(lesson >= 1 && lesson <= LESSONS)) return;
      const classKey = classKeyFromRow(r);
      if (!classKey) return;
      const key = `${day}|${r.teacherUid}|${lesson}`;
      const prev = byKey.get(key);
      if (!prev || rowMs(r) >= rowMs(prev)) byKey.set(key, { ...r, classKey });
    });
    const sessions = new Map();
    sessSnap.forEach((s) => {
      const x = s.data() || {};
      sessions.set(`${x.date}|${x.teacherUid}|${Number(x.lesson)}`, { id: s.id, ...x });
    });
    const cells = dates.map((iso) => {
      const day = weekdayOf(iso);
      const out = {};
      teachers.forEach((t) => {
        out[t.uid] = {};
        for (let l = 1; l <= LESSONS; l++) {
          const r = byKey.get(`${day}|${t.uid}|${l}`);
          if (!r) { out[t.uid][l] = null; continue; }
          const s = sessions.get(`${iso}|${t.uid}|${l}`);
          const taken = !!s && normalizeClassKey(s.classKey) === normalizeClassKey(r.classKey);
          out[t.uid][l] = { classKey: r.classKey, subject: r.subject || "", taken, sessionId: taken ? s.id : null, time: taken ? (s.createdAt || s.sessionStartTs) : null };
        }
      });
      return out;
    });
    return { dates, cells };
  }

  function stateOf(iso, cell) {
    if (!cell) return "none";
    if (cell.taken) return "taken";
    return iso > today ? "future" : "missing";
  }
  function cellButton(iso, teacher, lesson, cell) {
    if (!cell) return Object.assign(document.createElement("div"), { className: "sch-cell none" });
    const b = document.createElement("button");
    b.type = "button";
    b.className = `sch-cell ${stateOf(iso, cell)}`;
    b.textContent = toArabicDigits(cell.classKey);
    b.addEventListener("click", () => openLesson(iso, teacher, lesson, cell));
    return b;
  }

  function renderDay() {
    const table = $("table"), thead = $("thead"), tbody = $("tbody");
    table.className = "sch-table day";
    thead.innerHTML = `<tr><th class="sticky">المعلمين</th>${ORDINALS.map((o) => `<th>الحصة ${o}</th>`).join("")}</tr>`;
    tbody.innerHTML = "";
    const cells = data.cells[0];
    if (!teachers.length) { tbody.innerHTML = '<tr><td colspan="8" style="padding:24px;color:var(--muted);font-weight:800">لا يوجد معلمون في هذا القسم</td></tr>'; return; }
    teachers.forEach((t) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="sticky"><div class="sch-teacher-name">${escapeHtml(t.name)}${t.role === "head" ? "<small>رئيس القسم</small>" : ""}</div></td>`;
      for (let l = 1; l <= LESSONS; l++) {
        const td = document.createElement("td");
        td.appendChild(cellButton(data.dates[0], t, l, cells[t.uid][l]));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
  }

  function renderWeek() {
    const table = $("table"), thead = $("thead"), tbody = $("tbody");
    table.className = "sch-table week";
    const dayRow = `<tr><th class="sticky" rowspan="2">المعلمين</th>${data.dates.map((iso, i) =>
      `<th colspan="7" class="day-th${iso === today ? " today" : ""}"><span class="sch-day-label"><b>${DAYS_AR[i]}</b><small>${fmtShort(iso)}</small></span></th>`).join("")}</tr>`;
    const lessonRow = `<tr>${data.dates.map((iso) => ORDINALS.map((o, i) =>
      `<th class="lesson-th${i === 0 ? " day-start" : ""}">${o}</th>`).join("")).join("")}</tr>`;
    thead.innerHTML = dayRow + lessonRow;
    tbody.innerHTML = "";
    if (!teachers.length) { tbody.innerHTML = '<tr><td colspan="36" style="padding:24px;color:var(--muted);font-weight:800">لا يوجد معلمون في هذا القسم</td></tr>'; return; }
    teachers.forEach((t) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="sticky"><div class="sch-teacher-name">${escapeHtml(t.name)}${t.role === "head" ? "<small>رئيس القسم</small>" : ""}</div></td>`;
      data.dates.forEach((iso, d) => {
        for (let l = 1; l <= LESSONS; l++) {
          const td = document.createElement("td");
          if (l === 1) td.classList.add("day-start");
          if (iso === today) td.classList.add("today");
          td.appendChild(cellButton(iso, t, l, data.cells[d][t.uid][l]));
          tr.appendChild(td);
        }
      });
      tbody.appendChild(tr);
    });
    requestAnimationFrame(centerDayLabels);
  }

  // Keep each day's name centred over the visible part of its seven periods.
  const scroll = $("scroll");
  function centerDayLabels() {
    if (view !== "week" || !host.getClientRects().length) return;
    const v = scroll.getBoundingClientRect();
    const sticky = $("thead").querySelector("th.sticky");
    const right = sticky ? Math.min(v.right, sticky.getBoundingClientRect().left) : v.right;
    $("thead").querySelectorAll("th.day-th").forEach((th) => {
      const label = th.firstElementChild;
      const r = th.getBoundingClientRect();
      const a = Math.max(r.left, v.left), b = Math.min(r.right, right), w = label.offsetWidth;
      let c = (a + b) / 2;
      if (b - a < w) c = b <= a ? (r.left + r.right) / 2 : Math.min(Math.max(c, r.left + w / 2), r.right - w / 2);
      label.style.left = `${c - r.left}px`;
    });
  }
  let raf = 0;
  const scheduleCenter = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; centerDayLabels(); }); };
  scroll.addEventListener("scroll", scheduleCenter, { passive: true });
  window.addEventListener("resize", scheduleCenter);

  function syncToolbar() {
    root.querySelectorAll(".sch-seg button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    $("dateBtn").hidden = view !== "day";
    $("weekRange").hidden = view !== "week";
    dateLabel.textContent = fmtLong(dateISO);
    dateInput.value = dateISO;
    const start = weekStartFor(dateISO);
    $("weekRangeText").textContent = rangeText(start);
    const thisWeek = weekStartFor(today);
    $("weekRangeSub").textContent = start === thisWeek ? (weekdayOf(today) >= 5 ? "الأسبوع القادم" : "هذا الأسبوع") : "";
  }

  async function load({ force = false } = {}) {
    syncToolbar();
    if (!dept) { show("stPick"); $("legend").hidden = true; return; }
    const id = ++requestId;
    show("stLoading");
    try {
      if (force) loadSchedules(db, { force: true });
      const dates = view === "week" ? weekDatesFor(weekStartFor(dateISO)) : [dateISO];
      const next = await fetchCells(dates);
      if (id !== requestId) return;
      data = next;
      view === "week" ? renderWeek() : renderDay();
      $("legend").hidden = false;
      show("stOk");
    } catch (e) {
      if (id !== requestId) return;
      console.error("[dept-schedules] load failed", e);
      show("stError");
    }
  }

  function openLesson(iso, teacher, lesson, cell) {
    const state = stateOf(iso, cell);
    const statusText = { taken: `تم تسليم الغياب${cell.time ? ` — ${tsTime(cell.time)}` : ""}`, missing: "لم يتم تسليم الغياب", future: "لم تبدأ بعد" }[state];
    const canAct = !!hooks.attendance && iso <= today;
    modal.open(`
      <div class="sch-modal-head"><div><b>${escapeHtml(teacher.name)}</b><small>الحصة ${ORDINALS[lesson - 1]} • ${fmtLong(iso)}</small></div><button class="sch-x" type="button" aria-label="إغلاق">×</button></div>
      <div class="sch-modal-body">
        <div class="sch-chips"><span class="sch-chip">الصف: ${escapeHtml(toArabicDigits(cell.classKey))}</span>${cell.subject ? `<span class="sch-chip">${escapeHtml(cell.subject)}</span>` : ""}</div>
        <div class="sch-status ${state}">${escapeHtml(statusText)}</div>
        ${canAct ? `<button class="sch-primary" type="button" id="lessonAction">${cell.sessionId ? "تعديل الغياب" : "تسجيل الغياب"}</button>` : ""}
      </div>`);
    modal.el.querySelector("#lessonAction")?.addEventListener("click", () => {
      modal.close();
      if (cell.sessionId) hooks.attendance.openForEdit(cell.sessionId);
      else hooks.attendance.openForAdminCreate({ date: iso, classKey: cell.classKey, lesson, teacherUid: teacher.uid, teacherName: teacher.name });
    });
  }

  /* ---- download ---- */
  function openDownload() {
    if (!dept) return;
    modal.open(`
      <div class="sch-modal-head"><b>تنزيل جدول القسم</b><button class="sch-x" type="button" aria-label="إغلاق">×</button></div>
      <div class="sch-modal-body">
        <button class="sch-option" type="button" data-kind="day"><span class="ic">${ICON.day}</span><span><b>جدول اليوم</b><small>${fmtLong(dateISO)}</small></span></button>
        <button class="sch-option" type="button" data-kind="week"><span class="ic">${ICON.week}</span><span><b>جدول الأسبوع</b><small>${rangeText(weekStartFor(dateISO))}</small></span></button>
        <div class="sch-dl-status" id="dlStatus" hidden></div>
      </div>`);
    modal.el.querySelectorAll(".sch-option").forEach((b) => b.addEventListener("click", () => downloadPdf(b.dataset.kind)));
  }
  let dlBusy = false;
  async function downloadPdf(kind) {
    if (dlBusy) return;
    const status = modal.el.querySelector("#dlStatus");
    const setStatus = (text, err) => { status.hidden = !text; status.textContent = text || ""; status.classList.toggle("error", !!err); };
    dlBusy = true;
    modal.el.querySelectorAll(".sch-option").forEach((b) => (b.disabled = true));
    setStatus("جاري إنشاء ملف PDF…");
    try {
      await ensurePdfLibs();
      const dates = kind === "week" ? weekDatesFor(weekStartFor(dateISO)) : [dateISO];
      const d = await fetchCells(dates);
      const hostEl = kind === "week" ? buildWeekPdf(d, dept, teachers) : buildDayPdf(d, dept, teachers);
      document.body.appendChild(hostEl);
      try {
        if (document.fonts?.ready) await document.fonts.ready;
        await waitImg(hostEl.querySelector("img"));
        const canvas = await window.html2canvas(hostEl.firstElementChild.nextElementSibling, { backgroundColor: "#ffffff", scale: kind === "week" ? 1.6 : 1.35, useCORS: true, logging: false });
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: kind === "week" ? "landscape" : "portrait", unit: "pt", format: "a4", compress: true });
        addCanvasToPage(pdf, canvas, 14);
        const name = kind === "week"
          ? `جدول-القسم-الأسبوعي-${dept}-${dates[0]}`
          : `جدول-القسم-${dept}-${dates[0]}`;
        pdf.save(name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-") + ".pdf");
      } finally { hostEl.remove(); }
      dlBusy = false;
      modal.close();
    } catch (e) {
      console.error("[dept-schedules] PDF failed", e);
      setStatus("تعذّر إنشاء ملف PDF. حاول مرة أخرى.", true);
    } finally {
      dlBusy = false;
      modal.el.querySelectorAll(".sch-option").forEach((b) => (b.disabled = false));
    }
  }

  /* ---- wiring ---- */
  deptSel.addEventListener("change", () => { dept = deptSel.value; remember({ dept }); load(); });
  root.querySelectorAll(".sch-seg button").forEach((b) => b.addEventListener("click", () => {
    if (view === b.dataset.view) return;
    view = b.dataset.view;
    remember({ deptView: view });
    load();
  }));
  dateInput.addEventListener("change", () => { if (dateInput.value) { dateISO = dateInput.value; load(); } });
  $("dlBtn").addEventListener("click", openDownload);
  hooks.onAttendanceSaved?.(() => { if (dept && host.getClientRects().length) load(); });

  syncToolbar();
  try {
    const { teachers: all } = await loadTeachers(db);
    departmentsWithCounts(all).forEach(({ dept: d, count }) => deptSel.appendChild(new Option(`${d} (${toArabicDigits(count)})`, d)));
    const last = recall();
    if (last.dept && [...deptSel.options].some((o) => o.value === last.dept)) {
      deptSel.value = last.dept;
      dept = last.dept;
    }
  } catch (e) {
    console.error("[dept-schedules] teachers failed", e);
    show("stError");
    return { refresh() { load({ force: true }); } };
  }
  load();
  return { refresh() { if (dept) load(); } };
}

/* =====================================================================
   جداول المعلمين
   ===================================================================== */
export async function mountTeacherSchedulesSheet(host, hooks = {}) {
  const db = dbFor();
  const { root, body } = await mountShell(host, "جداول المعلمين", hooks);
  body.innerHTML = `
    <div class="sch-toolbar">
      <div class="sch-select-wrap"><select class="sch-select" id="deptSel" aria-label="القسم"><option value="">اختر القسم...</option></select></div>
      <div class="sch-select-wrap"><select class="sch-select" id="teacherSel" aria-label="المعلم" disabled><option value="">اختر القسم أولاً...</option></select></div>
    </div>
    <div class="sch-state active" id="stPick"><div class="sch-center"><div class="sch-empty-hint">${ICON.pick}<span>اختر القسم ثم المعلم لعرض جدوله الأسبوعي</span></div></div></div>
    <div class="sch-state" id="stLoading"><div class="sch-center"><div class="sch-spinner"></div></div></div>
    <div class="sch-state" id="stError"><div class="sch-center"><div class="sch-error">تعذّر تحميل جدول المعلم. تحقّق من الاتصال وحاول مرة أخرى.</div></div></div>
    <div class="sch-state" id="stOk" style="overflow:auto">
      <div class="sch-teacher-card">
        <div class="sch-teacher-head"><div><b id="tName">—</b></div><span id="tMeta"></span></div>
        <div class="sch-week-grid" id="grid"></div>
      </div>
    </div>`;
  const $ = (id) => root.getElementById(id);
  const deptSel = $("deptSel"), teacherSel = $("teacherSel");
  const states = ["stPick", "stLoading", "stError", "stOk"].map($);
  const show = (id) => states.forEach((s) => s.classList.toggle("active", s.id === id));
  let all = [], profiles = [], requestId = 0;

  function fillTeachers(dept) {
    const list = all.filter((t) => t.dept === dept);
    teacherSel.innerHTML = "";
    teacherSel.appendChild(new Option(dept ? (list.length ? "اختر المعلم..." : "لا يوجد معلمون في هذا القسم") : "اختر القسم أولاً...", ""));
    list.forEach((t) => teacherSel.appendChild(new Option(t.role === "head" ? `${t.name} — رئيس القسم` : t.name, t.uid)));
    teacherSel.disabled = !list.length;
  }

  // The teacher's week: standing schedule (all their UIDs, newest row per
  // slot), minus classes running a special-day schedule, plus their lessons
  // in those special schedules; covers tagged for their own date only.
  async function weekFor(uid) {
    const today = kuwaitTodayISO();
    const start = weekStartFor(today);
    const dates = weekDatesFor(start);
    const uids = teacherScheduleUids(uid, profiles);
    const [rows, customSnap, ovNewSnap, ovOldSnap, times] = await Promise.all([
      loadSchedules(db),
      getDocs(query(collection(db, "customDaySchedules"), where("dayIndex", "in", [0, 1, 2, 3, 4, "0", "1", "2", "3", "4"]))).catch(() => null),
      getDocs(query(collection(db, "scheduleOverrides"), where("newTeacherUid", "in", uids), where("active", "==", true), where("date", "in", dates))).catch(() => null),
      getDocs(query(collection(db, "scheduleOverrides"), where("originalTeacherUid", "in", uids), where("active", "==", true), where("date", "in", dates))).catch(() => null),
      loadLessonTimes(db),
    ]);
    const customByDay = [[], [], [], [], []];
    customSnap?.forEach((d) => {
      const x = d.data() || {};
      const day = Number(x.dayIndex);
      if (x.enabled === true && !x.deletedAt && day >= 0 && day <= 4) customByDay[day].push(x);
    });
    const overridden = customByDay.map((r) => getOverriddenClassKeys(r));
    const grid = dates.map(() => new Map()); // lesson -> { classKey, ms, cover }
    rows.forEach((r) => {
      const day = Number(r.dayIndex), lesson = Number(r.lesson);
      if (!uids.includes((r.teacherUid || "").toString()) || !(day >= 0 && day <= 4) || !(lesson >= 1 && lesson <= LESSONS)) return;
      const classKey = classKeyFromRow(r);
      if (!classKey || overridden[day].has(normalizeClassKey(classKey))) return;
      const prev = grid[day].get(lesson);
      if (!prev || rowMs(r) >= prev.ms) grid[day].set(lesson, { classKey, ms: rowMs(r) });
    });
    const covers = [];
    ovOldSnap?.forEach((d) => covers.push({ ...d.data(), _kind: "covered" }));
    ovNewSnap?.forEach((d) => covers.push({ ...d.data(), _kind: "covering" }));
    covers.sort((a, b) => rowMs(a) - rowMs(b)).forEach((o) => {
      const day = dates.indexOf(o.date), lesson = Number(o.lesson);
      if (day < 0 || !(lesson >= 1 && lesson <= LESSONS)) return;
      if (o._kind === "covering") {
        grid[day].set(lesson, { classKey: o.classKey || "بديل", cover: "covering" });
      } else {
        const cur = grid[day].get(lesson);
        if (cur && normalizeClassKey(cur.classKey) === normalizeClassKey(o.classKey)) cur.cover = "covered";
      }
    });
    customByDay.forEach((dayRows, day) => dayRows.forEach((row) => {
      const lessons = Array.isArray(row.lessons) ? row.lessons : [];
      const max = Math.min(LESSONS, Number(row.lessonCount) || lessons.length || LESSONS);
      for (let i = 0; i < max; i++) {
        if (!uids.includes(((lessons[i] || {}).teacherUid || "").toString())) continue;
        const classKey = classKeyFromRow(row) || classKeyFromRow(lessons[i]);
        if (classKey) grid[day].set(i + 1, { classKey });
      }
    }));
    return { start, dates, grid, times };
  }

  function render(teacher, w) {
    const today = kuwaitTodayISO();
    let lessons = 0;
    const head = [`<div class="sch-wg-th">اليوم</div>`, ...ORDINALS.map((o, i) => {
      const t = w.times[i];
      return `<div class="sch-wg-th">الحصة ${o}${t?.start && t?.end ? `<small>${escapeHtml(t.start)} - ${escapeHtml(t.end)}</small>` : ""}</div>`;
    })].join("");
    const rows = w.dates.map((iso, d) => {
      const cells = [];
      for (let l = 1; l <= LESSONS; l++) {
        const c = w.grid[d].get(l);
        if (!c) { cells.push('<div class="sch-wg-cell">—</div>'); continue; }
        lessons++;
        const tag = c.cover === "covered" ? '<span class="sch-tag">تمت تغطيتها</span>' : (c.cover === "covering" ? '<span class="sch-tag covering">تغطية</span>' : "");
        cells.push(`<div class="sch-wg-cell on${c.cover === "covered" ? " covered" : ""}">${escapeHtml(toArabicDigits(c.classKey))}${tag}</div>`);
      }
      return `<div class="sch-wg-day"${iso === today ? ' style="color:#15803d"' : ""}>${DAYS_AR[d]}<small>${fmtShort(iso)}</small></div>${cells.join("")}`;
    }).join("");
    $("grid").innerHTML = head + rows;
    $("tName").textContent = teacher.name;
    const thisWeek = weekDayIsWeekend() ? "الأسبوع القادم" : "هذا الأسبوع";
    $("tMeta").textContent = `${toArabicDigits(lessons)} حصة • ${thisWeek}: ${rangeText(w.start)}`;
  }
  const weekDayIsWeekend = () => weekdayOf(kuwaitTodayISO()) >= 5;

  async function showTeacher(uid) {
    const teacher = all.find((t) => t.uid === uid);
    if (!teacher) { show("stPick"); return; }
    const id = ++requestId;
    show("stLoading");
    try {
      const w = await weekFor(uid);
      if (id !== requestId) return;
      render(teacher, w);
      show("stOk");
    } catch (e) {
      if (id !== requestId) return;
      console.error("[teacher-schedules] load failed", e);
      show("stError");
    }
  }

  deptSel.addEventListener("change", () => {
    fillTeachers(deptSel.value);
    remember({ tDept: deptSel.value, tUid: "" });
    show("stPick");
  });
  teacherSel.addEventListener("change", () => {
    remember({ tDept: deptSel.value, tUid: teacherSel.value });
    if (teacherSel.value) showTeacher(teacherSel.value); else show("stPick");
  });

  try {
    ({ teachers: all, profiles } = await loadTeachers(db));
    departmentsWithCounts(all).forEach(({ dept, count }) => deptSel.appendChild(new Option(`${dept} (${toArabicDigits(count)})`, dept)));
    const last = recall();
    if (last.tDept && [...deptSel.options].some((o) => o.value === last.tDept)) {
      deptSel.value = last.tDept;
      fillTeachers(last.tDept);
      if (last.tUid && all.some((t) => t.uid === last.tUid && t.dept === last.tDept)) {
        teacherSel.value = last.tUid;
        showTeacher(last.tUid);
      }
    }
  } catch (e) {
    console.error("[teacher-schedules] teachers failed", e);
    show("stError");
  }
  return { refresh() { if (teacherSel.value) showTeacher(teacherSel.value); } };
}

/* ---------------- PDF ---------------- */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}
async function ensurePdfLibs() {
  if (!window.html2canvas) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
  if (!window.jspdf?.jsPDF) await loadScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");
}
function waitImg(img) {
  if (!img || img.complete) return Promise.resolve();
  return new Promise((r) => { img.onload = img.onerror = r; setTimeout(r, 3000); });
}
function addCanvasToPage(pdf, canvas, margin) {
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const ratio = Math.min((W - margin * 2) / canvas.width, (H - margin * 2) / canvas.height);
  const w = canvas.width * ratio, h = canvas.height * ratio;
  pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", (W - w) / 2, margin, w, h, undefined, "FAST");
}
const compactClass = (c) => String(c || "").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();

// Day: one portrait page, teachers × the seven periods.
function buildDayPdf(d, dept, teachers) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;top:0;left:-10000px;width:794px;background:#fff;z-index:-1";
  const cells = d.cells[0];
  const rows = teachers.map((t) => `<tr><th class="name">${escapeHtml(t.name)}</th>${[1, 2, 3, 4, 5, 6, 7].map((l) =>
    cells[t.uid][l] ? `<td class="on">${escapeHtml(toArabicDigits(cells[t.uid][l].classKey))}</td>` : "<td>—</td>").join("")}</tr>`).join("")
    || '<tr><td colspan="8">لا يوجد معلمون في هذا القسم</td></tr>';
  host.innerHTML = `
    <style>
      .p { width:794px; min-height:1123px; box-sizing:border-box; padding:30px 24px; direction:rtl; background:#fff; color:#102542; font-family:"Tajawal",system-ui,sans-serif; }
      .p .h { text-align:center; margin-bottom:14px; }
      .p img { height:78px; display:block; margin:0 auto 12px; object-fit:contain; }
      .p .s { font-size:22px; font-weight:900; color:#0e3554; margin-bottom:6px; }
      .p .t { font-size:17px; font-weight:800; color:#1d4d72; margin-bottom:6px; }
      .p .d { font-size:13px; font-weight:800; color:#355f81; }
      .p table { width:100%; border-collapse:collapse; table-layout:fixed; border:1px solid #cddff0; margin-top:14px; }
      .p thead th { background:linear-gradient(135deg,#0e3a5c,#1c5b88); color:#fff; font-size:10.5px; font-weight:900; padding:10px 4px; }
      .p thead th.c { width:150px; }
      .p th.name { background:#f4f8fc; font-size:11px; font-weight:900; color:#163e63; padding:9px 8px; text-align:right; border-top:1px solid #d9e6f3; }
      .p td { text-align:center; font-size:11px; font-weight:800; color:#94a3b8; padding:9px 4px; border-top:1px solid #e1ebf5; border-left:1px solid #e1ebf5; }
      .p td.on { background:#fff2a0; color:#1a3650; }
    </style>
    <div class="p">
      <div class="h"><img src="/images/schoollogo.png" alt=""><div class="s">ثانوية أحمد البشر الرومي</div><div class="t">جدول القسم — ${escapeHtml(dept)}</div><div class="d">${fmtLong(d.dates[0])}</div></div>
      <table><thead><tr><th class="c">المعلمين</th>${ORDINALS.map((o) => `<th>الحصة ${o}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  return host;
}

// Week: one landscape page laid out like the school's printed department
// timetable — the same design as the teachers' جدول القسم download.
function buildWeekPdf(d, dept, teachers) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;top:0;left:-10000px;width:1123px;background:#fff;z-index:-1";
  const n = Math.max(teachers.length, 1);
  const rowH = Math.max(26, Math.min(80, Math.floor(540 / n)));
  const dayHeads = d.dates.map((iso, i) => `<th colspan="7" class="dy ${i ? "sep" : ""}">${DAYS_AR[i]}<small>${fmtShort(iso)}</small></th>`).join("");
  const nums = d.dates.map((iso, i) => [1, 2, 3, 4, 5, 6, 7].map((l) => `<th class="nm ${l === 1 && i ? "sep" : ""}">${l}</th>`).join("")).join("");
  const rows = teachers.map((t) => `<tr style="height:${rowH}px"><th class="name">${escapeHtml(t.name)}</th>${d.dates.map((iso, i) =>
    [1, 2, 3, 4, 5, 6, 7].map((l) => {
      const c = d.cells[i][t.uid][l];
      const cls = `${l === 1 && i ? "sep" : ""} ${l % 2 === 0 ? "alt" : ""}`;
      return c ? `<td class="${cls} on">${escapeHtml(compactClass(c.classKey))}</td>` : `<td class="${cls}"></td>`;
    }).join("")).join("")}</tr>`).join("") || '<tr><td colspan="36">لا يوجد معلمون في هذا القسم</td></tr>';
  host.innerHTML = `
    <style>
      .w { width:1123px; min-height:794px; box-sizing:border-box; padding:26px 30px 24px; direction:rtl; background:#fff; color:#1e293b; font-family:"Tajawal",system-ui,sans-serif; }
      .w .top { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
      .w .lines { text-align:right; line-height:1.55; }
      .w .lines div { font-size:12px; font-weight:700; color:#475569; }
      .w .lines .school { font-size:17px; font-weight:900; color:#1e293b; }
      .w .lines .range { font-size:11px; font-weight:800; color:#64748b; margin-top:2px; }
      .w img { height:58px; object-fit:contain; }
      .w table { width:100%; border-collapse:collapse; table-layout:fixed; border:1.5px solid #334155; }
      .w .title th { background:#334155; color:#fff; font-size:17px; font-weight:900; padding:7px; }
      .w th.dy { background:#475569; color:#fff; font-size:13px; font-weight:900; padding:6px 2px; }
      .w th.dy small { display:block; font-size:8.5px; font-weight:700; opacity:.85; margin-top:1px; }
      .w th.nm { background:#64748b; color:#fff; font-size:10px; font-weight:800; padding:4px 0; border-left:1px solid rgba(255,255,255,.25); }
      .w th.corner { background:#334155; color:#fff; font-size:13px; font-weight:900; }
      .w th.name { background:#f1f5f9; font-size:11px; font-weight:900; color:#1e293b; padding:2px 6px; text-align:center; border-top:1px solid #94a3b8; border-left:2px solid #334155; line-height:1.35; }
      .w td { border-top:1px solid #cbd5e1; border-left:1px solid #e2e8f0; text-align:center; vertical-align:middle; font-size:9.5px; font-weight:900; color:#0f172a; padding:0 1px; white-space:nowrap; overflow:hidden; }
      .w td.alt { background:#f8fafc; }
      .w td.on { background:#e8f0f8; }
      .w .sep { border-right:2px solid #334155 !important; }
    </style>
    <div class="w">
      <div class="top">
        <div class="lines"><div>وزارة التربية والتعليم</div><div>منطقة العاصمة التعليمية</div><div class="school">ثانوية أحمد البشر الرومي</div><div class="range">الأسبوع: ${rangeText(d.dates[0])}</div></div>
        <img src="/images/schoollogo.png" alt="">
      </div>
      <table>
        <colgroup><col style="width:118px">${"<col>".repeat(35)}</colgroup>
        <thead><tr class="title"><th colspan="36">${escapeHtml(dept)}</th></tr><tr><th class="corner" rowspan="2">المعلم</th>${dayHeads}</tr><tr>${nums}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  return host;
}
