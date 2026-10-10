// ميزانيات الأقسام — who teaches which class, which subject, and how many
// periods a week, one budget per department. Opened from the sidebar of
// Teachers/user.html («ميزانيتي» / «ميزانية القسم») and admins/adminpage.html
// («ميزانيات الأقسام»); what it shows depends on who is signed in:
//   - a teacher: «ميزانيتي» — their own classes, subjects, periods and نصاب,
//     read-only, from every department budget that lists them;
//   - a head (teachers/{uid}.role == 'head'): their department's budget
//     editor (cards on phones, a table on wide screens; the official form as
//     Excel / PDF / image, and a filled Excel form read back in), plus
//     «ميزانيتي»;
//   - an admin: every department (summary, preview, edit any of them),
//     «كل الأقسام» (class × subject, one teacher per cell), and a CSV of
//     every teacher × class × subject.
//
// Everything comes from this site's own Firestore: people from teachers/*,
// classes from settings/classes (/shared/class-registry.js), departments and
// their subjects from /shared/departments.js. Budgets live in
// departmentBudgets/{department}:
//   { periods: { [subject]: { [grade group]: n } },  // default weekly periods
//     required, note,
//     teachers: [{ uid, name, cells: { [class]: n }, note,
//                  subjects: [], subj: { [class]: subject },
//                  split: { [class]: { [subject]: n } } }],
//     updatedAt, updatedBy, updatedByUid }
// Who may write is decided by firestore.rules (admins, or the head of that
// department).
//
// Built like /admins/js/schedules.js: renders into a shadow root on the host
// it's given, with its own header. hooks: close(), openSidebar(),
// getSession() → { user, data, classList }, role (optional override).
import {
  firebaseConfig, initializeApp, getApp, getApps, getFirestore,
  collection, getDocs, doc, setDoc, serverTimestamp,
} from "/shared/firebase.js";
import { DEPARTMENT_LIST, DEPARTMENTS, SUBJECT_LIST, SUBJECT_TO_DEPARTMENT, resolveDepartmentName } from "/shared/departments.js";
import { fetchClassList, parseClassKey, sortClassList } from "/shared/class-registry.js";

const CSS_URL = new URL("./department-budgets.css", import.meta.url).href;
const COLLECTION = "departmentBudgets";
const SCHOOL_NAME = "ثانوية أحمد البشر الرومي";
const SCHOOL_LOGO = "/images/schoollogo.png";
const VIEW_KEY = "deptBudgets:view";
// Loaded only when someone downloads or uploads the official form.
const LIBS = {
  excel: "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js",
  canvas: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  pdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
};
const FORM_MARK = "نموذج ميزانية القسم";
const FORM_VERSION = 1;
const FORM_PLEA = "ارفع الميزانية بملف Excel من «تنزيل Excel» هنا: تقرؤه الصفحة وتملأ البطاقات منه، فلا تُعاد كتابة شيء.";
const TICKS = ["✓", "✔", "√", "@", "x", "X", "×"];
const HEAD_NOTE = "رئيس القسم";

// The original page's mark (a calendar with one gold slot), on the hero.
const MARK_SVG = '<svg class="mark" viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="9" width="36" height="33" rx="6" fill="none" stroke="#fff" stroke-width="2.5"/><path d="M6 18h36M16 5v8M32 5v8" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><rect x="12" y="23" width="7" height="6" rx="1.5" fill="#f3d48f"/><rect x="21" y="23" width="7" height="6" rx="1.5" fill="#fff" opacity=".55"/><rect x="30" y="23" width="7" height="6" rx="1.5" fill="#fff" opacity=".55"/><rect x="12" y="32" width="7" height="6" rx="1.5" fill="#fff" opacity=".55"/><rect x="21" y="32" width="7" height="6" rx="1.5" fill="#fff" opacity=".55"/></svg>';
// The original page's typeface. A font face must be declared on the
// document (not inside the shadow root) for the sheet to use it.
function loadFont() {
  if (document.getElementById("dept-budgets-font")) return;
  document.head.append(Object.assign(document.createElement("link"), {
    id: "dept-budgets-font", rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;700&display=swap",
  }));
}
const ICON = {
  menu: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
};

// The footer under every view: /shared/credits-footer.js's card (logo,
// school, socials, copyright) with this sheet's own credit in place of the
// site's two rows. Styles in department-budgets.css (.credits-*).
const CREDITS_HTML = `
  <footer class="credits-footer" aria-label="اعتمادات الصفحة">
    <div class="credits-card">
      <img class="credits-logo" src="/images/schoollogo.png" alt="شعار المدرسة" loading="lazy">
      <h3 class="credits-school-name">ثانوية أحمد البشر الرومي</h3>
      <p class="credits-tagline">منصة المعلم الرقمية</p>
      <div class="credits-info">
        <div class="credits-row">
          <span class="credits-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 12h6M9 16h6"/></svg>
          </span>
          <div class="credits-text">
            <span class="credits-label">إعداد</span>
            <span class="credits-value">أ/ حيدر الهزيم</span>
          </div>
        </div>
      </div>
      <div class="credits-socials">
        <a class="credits-social instagram" href="https://www.instagram.com/abr.school/" target="_blank" rel="noopener noreferrer" aria-label="انستجرام المدرسة">
          <svg viewBox="0 0 24 24"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.86 5.86 0 0 0-2.13 1.38A5.86 5.86 0 0 0 .63 4.14c-.3.76-.5 1.64-.56 2.91C.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.32.8.74 1.48 1.38 2.13.65.65 1.33 1.06 2.13 1.38.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.86 5.86 0 0 0 2.13-1.38c.65-.65 1.06-1.33 1.38-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.86 5.86 0 0 0-1.38-2.13A5.86 5.86 0 0 0 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0zm0 5.84A6.16 6.16 0 1 0 12 18.16 6.16 6.16 0 0 0 12 5.84zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z"/></svg>
        </a>
        <a class="credits-social telegram" href="https://t.me/ahmedalbesherr" target="_blank" rel="noopener noreferrer" aria-label="تلجرام المدرسة">
          <svg viewBox="0 0 24 24"><path d="M11.94 0C5.36 0 0 5.36 0 12s5.36 12 11.94 12C18.58 24 24 18.64 24 12S18.64 0 11.94 0zm5.6 8.16-1.86 8.78c-.14.62-.5.78-1.02.5l-2.84-2.1-1.36 1.32c-.14.14-.28.28-.58.28l.2-2.96 5.36-4.84c.24-.2-.04-.32-.36-.12L7.86 12.18 5.06 11.3c-.6-.18-.62-.6.12-.88l10.96-4.22c.5-.2.94.12.78.96z"/></svg>
        </a>
        <a class="credits-social youtube" href="https://www.youtube.com/@ahmedalbesherr" target="_blank" rel="noopener noreferrer" aria-label="يوتيوب المدرسة">
          <svg viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
        </a>
      </div>
      <p class="credits-copyright">© 2026 ثانوية أحمد البشر الرومي · جميع الحقوق محفوظة</p>
    </div>
  </footer>`;
function creditsFooter() {
  const t = document.createElement("template");
  t.innerHTML = CREDITS_HTML.trim();
  return t.content.firstElementChild;
}

/* ---------------- small helpers ---------------- */
function el(tag, props, ...kids) {
  const n = Object.assign(document.createElement(tag), props || {});
  kids.flat().forEach((k) => { if (k !== null && k !== undefined && k !== false) n.append(k); });
  return n;
}
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const clone = (v) => JSON.parse(JSON.stringify(v));
const teacherName = (d) => String(d?.name || d?.fullName || d?.teacherName || d?.displayName || d?.username || d?.email || "معلم").trim();
const teacherDept = (d) => resolveDepartmentName(d?.department || d?.dept || d?.subject || "");
// 1 حصة واحدة · 2 حصتان · 3–10 حصص · 11+ حصة
const periodsText = (n) => n === 1 ? "حصة واحدة" : n === 2 ? "حصتان" : n >= 3 && n <= 10 ? n + " حصص" : n + " حصة";
const toDate = (t) => (t && typeof t.toDate === "function") ? t.toDate() : (t instanceof Date ? t : null);
const fmtDate = (d) => d ? new Intl.DateTimeFormat("ar-KW", { year: "numeric", month: "numeric", day: "numeric" }).format(d) : "";
const fmtTime = (d) => d ? new Intl.DateTimeFormat("ar-KW", { hour: "numeric", minute: "2-digit" }).format(d) : "";
function academicYear() {
  const d = new Date(), y = d.getFullYear();
  return d.getMonth() >= 7 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}
function errText(e) {
  if (typeof e === "string") return e;
  if (e?.code === "permission-denied") return "لا تملك صلاحية التعديل على هذا القسم";
  return "تعذّر الاتصال، حاول مجدداً";
}
const loadScript = (src) => new Promise((res, rej) => {
  if (document.querySelector(`script[src="${src}"]`)) return res();
  const s = el("script", { src });
  s.onload = res; s.onerror = () => rej("تعذّر تحميل مكتبة التنزيل، تحقّق من الاتصال");
  document.head.append(s);
});
const needExcel = () => window.ExcelJS ? Promise.resolve() : loadScript(LIBS.excel);
const needCanvas = () => Promise.all([window.html2canvas ? 0 : loadScript(LIBS.canvas), window.jspdf ? 0 : loadScript(LIBS.pdf)]);
function saveBlob(blob, name) {
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function armTwice(btn, label, armedLabel, fn) {
  // Second tap confirms (no confirm(): in-app browsers block it); reverts after a few seconds.
  btn.onclick = () => {
    if (btn.dataset.arm) { fn(); return; }
    btn.dataset.arm = "1"; btn.textContent = armedLabel; btn.classList.add("armed");
    setTimeout(() => { delete btn.dataset.arm; btn.textContent = label; btn.classList.remove("armed"); }, 4000);
  };
}

/* ---------------- classes (settings/classes) ---------------- */
// "10 / 1", "11 / 2 ع", "12 / 1 د" → grade groups 10, 11 ع, 11 د, 12 ع, 12 د.
const TRACK_ORDER = { "": 0, "ع": 1, "د": 2 };
const GRADE_NAMES = { 10: "العاشر", 11: "الحادي عشر", 12: "الثاني عشر" };
const TRACK_NAMES = { "ع": "علمي", "د": "أدبي" };
function buildClassModel(list) {
  const groups = [], groupOf = {}, numOf = {};
  for (const key of sortClassList(list || [])) {
    const p = parseClassKey(key);
    if (p.grade === 999) continue;
    const gk = p.track ? `${p.grade} ${p.track}` : String(p.grade);
    let g = groups.find((x) => x.key === gk);
    if (!g) {
      const tn = TRACK_NAMES[p.track] || p.track;
      g = {
        key: gk, grade: p.grade, track: p.track, classes: [],
        label: (GRADE_NAMES[p.grade] || p.grade) + (p.track ? " " + tn : ""),
        short: p.track ? `${p.grade} ${tn}` : (GRADE_NAMES[p.grade] || String(p.grade)),
      };
      groups.push(g);
    }
    g.classes.push(key);
    groupOf[key] = gk;
    numOf[key] = p.section;
  }
  groups.sort((a, b) => a.grade - b.grade || (TRACK_ORDER[a.track] ?? 9) - (TRACK_ORDER[b.track] ?? 9));
  groups.forEach((g) => g.classes.sort((a, b) => numOf[a] - numOf[b]));
  return { groups, classes: groups.flatMap((g) => g.classes), groupOf, numOf };
}
// "11 / 2 ع" → "11/2ع": the column label on the official form.
const compact = (c) => String(c).replace(/\s+/g, "");

/* ---------------- state ---------------- */
let S = null; // one sheet per page

// A department's own subjects (shared/departments.js SUBJECT_TO_DEPARTMENT):
// more than one → each teacher picks theirs (الرياضيات / الإحصاء,
// اللغة الفرنسية / اللغة الفرنسية (اختيار حرّ), ...).
const budgetSubjects = (dp) => SUBJECT_LIST.filter((s) => SUBJECT_TO_DEPARTMENT[s] === dp);
const isMulti = (dp) => budgetSubjects(dp).length > 1;
const deptSubjects = (dp, teachers) => [...new Set([...budgetSubjects(dp), ...(teachers || []).flatMap((t) => t.subjects || [])])].filter(Boolean);
const deptStaff = (dp) => S.teachers.filter((t) => t.department === dp);
const headOf = (dp) => (S.teachers.find((t) => t.department === dp && t.isHead) || {}).name || "";
const sameTeacher = (a, b) => (a.uid && b.uid) ? a.uid === b.uid : a.name === b.name;
const teacherKey = (t) => t.uid ? t.uid : "n:" + t.name;

// The subject of one class: the class's own, else the teacher's only subject.
const subjOf = (t, c) => (t.subj || {})[c] || ((t.subjects || []).length === 1 ? t.subjects[0] : "");
// The department's default weekly periods for a subject in a class's grade group.
function defFor(d, dp, subj, c) {
  const key = isMulti(dp) ? subj : dp;
  if (!key) return null;
  const v = ((d.periods || {})[key] || {})[S.classes.groupOf[c]];
  return v === undefined ? null : v;
}
const nisab = (t) => S.classes.classes.reduce((a, c) => a + (t.cells[c] || 0), 0);
// A split is trusted only while it adds up to the cell.
function splitOf(t, c) {
  const p = (t.split || {})[c];
  if (!p || Object.keys(p).length < 2 || Object.values(p).reduce((a, v) => a + v, 0) !== t.cells[c]) return null;
  return p;
}
// The subjects one teacher gives one class: [{ subj, h }] (subj null in a single-subject department).
function partsOf(dp, t, c) {
  const p = splitOf(t, c);
  if (p) return Object.entries(p).map(([subj, h]) => ({ subj, h }));
  const subj = isMulti(dp) ? (subjOf(t, c) || (t.subjects || [])[0] || "") : null;
  return [{ subj, h: t.cells[c] }];
}
function setParts(t, c, parts) {
  t.subj = t.subj || {}; t.split = t.split || {};
  delete t.split[c];
  if (!parts.length) { delete t.cells[c]; delete t.subj[c]; return; }
  t.cells[c] = parts.reduce((a, p) => a + p.h, 0);
  if (parts[0].subj) t.subj[c] = parts[0].subj; else delete t.subj[c];
  if (parts.length > 1) t.split[c] = Object.fromEntries(parts.map((p) => [p.subj, p.h]));
}
// Classes held by more than one teacher in the same department.
function dupes(teachers) {
  const seen = {}, d = new Set();
  teachers.forEach((t) => S.classes.classes.forEach((c) => { if (c in t.cells) { if (seen[c]) d.add(c); seen[c] = true; } }));
  return d;
}
// A class × subject held by more than one teacher.
function subjectDupes(dp, teachers) {
  const seen = {}, d = new Set();
  teachers.forEach((t) => S.classes.classes.forEach((c) => {
    if (c in t.cells) partsOf(dp, t, c).forEach((p) => { const k = c + "|" + (isMulti(dp) ? p.subj : ""); if (seen[k]) d.add(k); seen[k] = 1; });
  }));
  return d;
}

// Only the saved shape: periods 0..40, known classes, a split only when it adds up.
function cleanBudget(d) {
  const int = (v, max) => { if (v === null || v === undefined || v === "") return null; const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : null; };
  const str = (v, max) => String(v ?? "").trim().slice(0, max);
  const classes = S.classes.classes;
  const periods = {};
  for (const [k, row] of Object.entries(d?.periods || {})) {
    const key = str(k, 60);
    if (!key || !row || typeof row !== "object") continue;
    const r = {};
    for (const g of S.classes.groups) { const n = int(row[g.key], 40); if (n !== null) r[g.key] = n; }
    if (Object.keys(r).length) periods[key] = r;
  }
  const teachers = (Array.isArray(d?.teachers) ? d.teachers : []).slice(0, 60).map((t) => {
    const cells = {}, subj = {}, split = {};
    for (const c of classes) { const n = int(t?.cells?.[c], 40); if (n !== null) cells[c] = n; }
    const subjects = [...new Set((Array.isArray(t?.subjects) ? t.subjects : []).map((x) => str(x, 40)).filter(Boolean))].slice(0, 8);
    for (const c of classes) { const x = str(t?.subj?.[c], 40); if (x && c in cells) subj[c] = x; }
    for (const c of classes) {
      const parts = {};
      for (const [k, v] of Object.entries(t?.split?.[c] ?? {})) { const n = int(v, 40); if (str(k, 40) && n) parts[str(k, 40)] = n; }
      const keys = Object.keys(parts);
      if (keys.length > 1 && c in cells && keys.reduce((a, k) => a + parts[k], 0) === cells[c]) split[c] = parts;
    }
    return { uid: str(t?.uid, 128), name: str(t?.name, 120), cells, note: str(t?.note, 300), subjects, subj, split };
  }).filter((t) => t.name);
  return { periods, required: int(d?.required, 99), note: str(d?.note, 1000), teachers };
}
// A new budget row for one of the site's teachers: in a merged department it
// starts with the subjects on their own record (teachers/{uid}.subject/subject2).
const newRow = (dp, t) => ({
  uid: t.uid, name: t.name, cells: {}, note: "", subj: {}, split: {},
  subjects: isMulti(dp) ? (t.subjects || []).filter((s) => budgetSubjects(dp).includes(s)) : [],
});
// A department with nothing saved yet: its teachers, no classes.
const emptyData = (dp) => ({ periods: {}, required: null, note: "", teachers: deptStaff(dp).map((t) => newRow(dp, t)) });
function editable(d) {
  const x = clone(d);
  x.periods = x.periods || {};
  x.teachers.forEach((t) => { t.cells = t.cells || {}; t.subj = t.subj || {}; t.split = t.split || {}; t.subjects = t.subjects || []; });
  return x;
}

// Strictly true, like firestore.rules' hasScheduleEditPermission().
export const canEditAllBudgets = (data) => data?.permissions?.allowEditSchedule === true;

/* ---------------- mount ---------------- */
function dbFor() {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getFirestore(app);
}

export async function mountDepartmentBudgetsSheet(host, hooks = {}) {
  const res = await fetch(CSS_URL);
  if (!res.ok) throw new Error(`department-budgets.css: HTTP ${res.status}`);
  const css = await res.text();
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  root.replaceChildren();
  loadFont();
  const style = el("style", { textContent: css + "\n" + FORM_CSS });
  const wrap = el("div", { style: "display:contents" });
  // The original page's hero, under a slim bar that stays put with the
  // sheet's back / menu buttons (the hero scrolls away with the content).
  wrap.innerHTML = `
    <header class="topbar">
      <button class="icon-btn menu" type="button" aria-label="فتح القائمة" title="القائمة">${ICON.menu}</button>
      <h2 class="topbar-title">ميزانيات الأقسام</h2>
      <button class="icon-btn back" type="button" aria-label="رجوع" title="رجوع">${ICON.back}</button>
    </header>
    <div class="scroller">
      <div class="hero">
        ${MARK_SVG}
        <h1>ميزانيات الأقسام</h1>
        <div class="school"></div>
      </div>
      <main class="main">
        <nav class="tabs" hidden></nav>
        <div class="content"><div class="state">جارٍ التحميل...</div></div>
      </main>
    </div>`;
  root.append(style, wrap);
  S = {
    root, hooks, db: dbFor(),
    topbar: root.querySelector(".topbar"), topTitle: root.querySelector(".topbar-title"),
    title: root.querySelector(".hero h1"), subtitle: root.querySelector(".hero .school"),
    scroller: root.querySelector(".scroller"), main: root.querySelector(".main"),
    tabs: root.querySelector(".tabs"), body: root.querySelector(".content"),
    role: "teacher", me: {}, teachers: [], classes: buildClassModel([]), budgets: new Map(),
    view: null, edit: null, gridBusy: Promise.resolve(), loading: null, showDetail: false,
  };
  S.scroller.append(creditsFooter());
  S.scroller.addEventListener("scroll", () => S.topbar.classList.toggle("scrolled", S.scroller.scrollTop > 90), { passive: true });
  root.querySelector(".menu").addEventListener("click", () => hooks.openSidebar?.());
  root.querySelector(".back").addEventListener("click", async () => {
    if (S.edit?.dirty) await saveBudget();
    hooks.close?.();
  });
  window.addEventListener("beforeunload", (e) => {
    if (S?.edit?.dirty) { saveBudget(); e.preventDefault(); e.returnValue = ""; }
  });
  await load();
  return {
    // Re-reads everything when the sheet opens again — unless a budget is
    // being edited with unsaved changes, which would be thrown away.
    // Switching between the host's two buttons (mode) starts that view afresh.
    refresh: async () => {
      if ((S.hooks.getMode?.() || "own") !== S.mode) {
        if (S.edit?.dirty && !S.edit.review) await saveBudget();
        S.edit = null; S.view = null; S.preview = null;
        return load();
      }
      if (!S.edit?.dirty && !S.edit?.review) return load();
    },
  };
}

async function load() {
  if (S.loading) return S.loading;
  S.loading = (async () => {
    const ses = S.hooks.getSession?.() || {};
    const data = ses.data || {};
    const role = String(S.hooks.role || data.role || "").toLowerCase();
    const own = role === "admin" ? "admin" : role === "head" ? "head" : "teacher";
    // «السماح بتعديل الجدول» (admins/teachers.html → teachers/{uid}.permissions.allowEditSchedule)
    // also gets the admin's view of every department (firestore.rules lets
    // them save it). The host picks which one is showing (hooks.getMode):
    // "all" → every department, "own" → their own ميزانية القسم / ميزانيتي.
    S.mode = S.hooks.getMode?.() || "own";
    S.role = own === "admin" || (S.mode === "all" && canEditAllBudgets(data)) ? "admin" : own;
    S.realAdmin = own === "admin";
    S.me = { uid: ses.user?.uid || "", name: teacherName(data), department: teacherDept(data) };
    if (!S.view) S.body.replaceChildren(el("div", { className: "state", textContent: "جارٍ التحميل..." }));
    try {
      const [tSnap, bSnap, classList] = await Promise.all([
        getDocs(collection(S.db, "teachers")),
        getDocs(collection(S.db, COLLECTION)),
        Array.isArray(ses.classList) && ses.classList.length ? ses.classList : fetchClassList(S.db),
      ]);
      S.classes = buildClassModel(classList);
      S.teachers = tSnap.docs.map((d) => {
        const x = d.data() || {};
        return {
          uid: d.id, name: teacherName(x), department: teacherDept(x), isHead: String(x.role || "").toLowerCase() === "head",
          subjects: [x.subject, x.subject2].map((s) => String(s || "").trim()).filter(Boolean),
        };
      }).filter((t) => DEPARTMENT_LIST.includes(t.department)).sort((a, b) => a.name.localeCompare(b.name, "ar"));
      S.budgets = new Map(bSnap.docs.map((d) => {
        const x = d.data() || {};
        return [d.id, { dept: d.id, data: cleanBudget(x), updatedAt: toDate(x.updatedAt), updatedBy: x.updatedBy || "" }];
      }));
    } catch (e) {
      console.error("[department-budgets] load failed", e);
      S.body.replaceChildren(el("div", { className: "state err", textContent: "تعذّر تحميل الميزانيات. تحقّق من الاتصال ثم أعد المحاولة." }));
      return;
    }
    if (S.view === "import" && !S.realAdmin) S.view = null;
    if (!S.view || (S.role !== "admin" && ["school", "grid", "preview", "import"].includes(S.view))) {
      S.view = S.role === "admin" ? "school" : S.role === "head" && S.me.department ? "dept" : "mine";
    }
    // A reload while editing re-opens the same department on fresh data.
    if (S.view === "dept") openEditor(S.edit?.dp || S.me.department);
    else render();
  })().finally(() => { S.loading = null; });
  return S.loading;
}

function setView(v) {
  if (S.view === "dept" && v !== "dept" && S.edit) closeEditor();
  S.view = v;
  if (v === "dept") openEditor(S.role === "admin" ? S.edit?.dp : S.me.department);
  else render();
}

// Tabs only for a head (their department / ميزانيتي); the admin moves
// between views with buttons, as on the original page.
function renderTabs() {
  const tabs = S.role === "head" && S.me.department ? [["dept", "ميزانية القسم"], ["mine", "ميزانيتي"]] : [];
  const title = S.role === "admin" ? "ميزانيات الأقسام" : S.role === "head" ? "ميزانية القسم" : "ميزانيتي";
  S.title.textContent = title; S.topTitle.textContent = title;
  S.subtitle.textContent = S.role === "admin" ? "ميزانية كل قسم: من يدرّس أي شعبة، وكم حصة"
    : S.role === "head" ? "قسم " + S.me.department + ": من يدرّس أي شعبة، وكم حصة" : "فصولك وحصصك في ميزانية القسم";
  S.tabs.hidden = !tabs.length;
  S.tabs.replaceChildren(...tabs.map(([k, label]) => {
    const b = el("button", { type: "button", textContent: label, className: k === S.view ? "on" : "" });
    b.onclick = () => { if (k !== S.view) setView(k); };
    return b;
  }));
}
function setWide(on) { S.main.classList.toggle("wide", !!on); }

function render() {
  renderTabs();
  setWide(false);
  const box = el("div", { className: "content-in" });
  S.body.replaceChildren(box);
  if (S.view === "school") renderSchool(box);
  else if (S.view === "grid") renderGrid(box);
  else if (S.view === "preview") renderPreview(box);
  else if (S.view === "import") renderImport(box);
  else renderMine(box);
  S.body.replaceChildren(...box.childNodes);
  S.scroller.scrollTop = 0;
}

/* =====================================================================
   «ميزانيتي» — read-only
   ===================================================================== */
function renderMine(box) {
  const me = S.me;
  const rows = [];
  for (const b of S.budgets.values()) for (const t of b.data.teachers) {
    if ((t.uid && t.uid === me.uid) || (!t.uid && t.name === me.name)) rows.push({ b, t });
  }
  if (!rows.length) {
    const own = me.department && S.budgets.get(me.department);
    const text = !me.department ? "لا يوجد قسم مسجّل لحسابك، فلا ميزانية تظهر هنا."
      : own ? `لست مدرجاً بعد في ميزانية قسم ${me.department}. راجع رئيس القسم.`
        : `لم يُدخل رئيس قسم ${me.department} ميزانية القسم بعد.`;
    box.append(el("div", { className: "card gold" }, el("h2", { textContent: "ميزانيتي" }), el("p", { className: "lead", textContent: text })));
    return;
  }
  const total = sum(rows, (r) => nisab(r.t));
  const classCount = new Set(rows.flatMap((r) => Object.keys(r.t.cells))).size;
  const subjCount = new Set(rows.flatMap((r) => S.classes.classes.filter((c) => c in r.t.cells).flatMap((c) => partsOf(r.b.dept, r.t, c).map((p) => p.subj || r.b.dept)))).size;
  box.append(el("div", { className: "card gold" },
    el("h2", { textContent: me.name }),
    el("p", { className: "lead", textContent: "نصابك: " + (total ? periodsText(total) : "لا حصص بعد") + " في الأسبوع" + (rows.length > 1 ? " من " + rows.length + " أقسام" : "") }),
    el("div", { className: "sums" },
      el("div", {}, el("b", { textContent: "النصاب" }), el("span", { textContent: total })),
      el("div", {}, el("b", { textContent: "الفصول" }), el("span", { textContent: classCount })),
      el("div", {}, el("b", { textContent: "المواد" }), el("span", { textContent: subjCount })))));
  for (const { b, t } of rows) {
    const dp = b.dept;
    const bySubj = {};
    for (const c of S.classes.classes) if (c in t.cells) for (const p of partsOf(dp, t, c)) {
      const k = p.subj || dp; bySubj[k] = (bySubj[k] || 0) + p.h;
    }
    const card = el("div", { className: "card" },
      el("div", { className: "row top between" }, el("h2", { textContent: "قسم " + dp, style: "margin:0" }), el("span", { className: "nisab", textContent: "النصاب: " + nisab(t) })),
      el("div", { className: "chips" }, ...Object.entries(bySubj).map(([s, h]) => el("span", { className: "chip" }, s, el("small", { textContent: h })))),
      classGrid(t, dp, b.data, null));
    if (t.note) card.append(el("p", { className: "lead", style: "margin-top:10px", textContent: "ملاحظة: " + t.note }));
    card.append(el("div", { className: "meta", style: "margin-top:8px", textContent: b.updatedAt ? "آخر تحديث للميزانية: " + fmtDate(b.updatedAt) + (b.updatedBy ? " — " + b.updatedBy : "") : "" }));
    box.append(card);
  }
}

// One row per grade group, the same spot for a class on every card.
// edit: null for read-only, else { onToggle(c, def), onHold(c, def, editor) }.
function classGrid(t, dp, d, edit, dup) {
  const cols = Math.max(1, ...S.classes.groups.map((g) => g.classes.length));
  const grid = el("div", { className: "cgrid", style: `grid-template-columns:58px repeat(${cols}, minmax(32px, 1fr))` });
  for (const g of S.classes.groups) {
    if (!edit && !g.classes.some((c) => c in t.cells)) continue;
    grid.append(el("div", { className: "glabel", textContent: g.short }));
    for (const c of g.classes) {
      const on = c in t.cells;
      // The subject this class has (or would get when tapped): its own, else the teacher's first.
      const sj = subjOf(t, c) || (isMulti(dp) ? (t.subjects || [])[0] || "" : "");
      const def = defFor(d, dp, isMulti(dp) ? sj || null : null, c);
      const odd = on && def !== null && t.cells[c] !== def;
      const multiSj = on && isMulti(dp) && ((t.subjects || []).length > 1 || !edit) && sj;
      const props = {
        className: "cell" + (on ? " on" : "") + (dup && dup.has(c) && on ? " dup" : "") + (odd ? " odd" : "") + (edit ? "" : " ro"),
        title: c + (on && sj ? " — " + sj : "") + (def !== null ? " — المعتاد " + def : ""),
      };
      const kids = [el("span", { textContent: S.classes.numOf[c] }),
        on ? el("small", { textContent: t.cells[c] + (multiSj ? " " + sj.replace(/^ال/, "").slice(0, 4) : "") }) : null];
      if (!edit) { grid.append(el("div", props, ...kids)); continue; }
      const b = el("button", { ...props, type: "button" }, ...kids);
      let timer = null, held = false;
      b.onpointerdown = () => { held = false; timer = setTimeout(() => { held = true; edit.onHold(c, def); }, 500); };
      b.onpointerup = b.onpointerleave = b.onpointercancel = () => clearTimeout(timer);
      b.oncontextmenu = (e) => e.preventDefault();
      b.onclick = () => { if (!held) edit.onToggle(c, def, on); };
      grid.append(b);
    }
    for (let k = g.classes.length; k < cols; k++) grid.append(el("div"));
  }
  return grid;
}

/* =====================================================================
   The department editor
   ===================================================================== */
function openEditor(dp) {
  if (!dp) { S.view = S.role === "admin" ? "school" : "mine"; render(); return; }
  const b = S.budgets.get(dp);
  S.edit = { dp, data: editable(b ? b.data : emptyData(dp)), review: null, dirty: false, timer: null, ui: {} };
  S.view = "dept";
  renderTabs();
  const E = S.edit, ui = E.ui;
  const box = el("div");
  ui.saveMsg = el("div", { className: "msg", textContent: b ? "آخر حفظ: " + [b.updatedAt ? fmtDate(b.updatedAt) + " " + fmtTime(b.updatedAt) : "", b.updatedBy ? "(" + b.updatedBy + ")" : ""].filter(Boolean).join(" ") : "لم تُحفظ بعد" });
  const back = S.role === "admin" ? el("button", { className: "btn ghost", type: "button", textContent: "رجوع", style: "flex:none;padding:6px 14px" }) : null;
  if (back) back.onclick = () => setView("school");
  // As the original page: the department and its weekly periods in one card.
  ui.periods = el("div");
  box.append(el("div", { className: "card" },
    el("div", { className: "row top between" }, el("h2", { textContent: "ميزانية قسم " + dp, style: "margin:0;flex:1;min-width:0;font-size:16px" }), back),
    el("p", { className: "lead", textContent: "اضغط على الشعبة لتختارها، واضغطها مرة أخرى لتزيلها. الضغط المطوّل يغيّر عدد حصصها إن خالفت المعتاد. الحفظ تلقائي." }),
    el("label", { className: "lbl", textContent: "حصص الأسبوع للفصل الواحد" }), ui.periods,
    ui.saveMsg));

  ui.formMsg = el("span", { className: "msg" });
  ui.review = el("div", { className: "review", hidden: true });
  const fileIn = el("input", { type: "file", accept: ".xlsx", hidden: true });
  const up = el("button", { className: "btn", type: "button", textContent: "رفع Excel معبّأ" });
  up.onclick = () => fileIn.click();
  fileIn.onchange = async () => {
    const f = fileIn.files[0]; fileIn.value = "";
    if (!f || !S.edit) return;
    if (!/\.xlsx$/i.test(f.name)) { setMsg(ui.formMsg, "يُقرأ ملف Excel من نموذج القسم فقط. " + FORM_PLEA, "err"); return; }
    setMsg(ui.formMsg, "جارٍ قراءة الملف...");
    try { applyForm(await readForm(f, E.dp, E.data)); setMsg(ui.formMsg, ""); }
    catch (e) { setMsg(ui.formMsg, String(e), "err"); }
  };
  box.append(el("div", { className: "card" }, el("h2", { textContent: "النموذج الرسمي" }),
    el("p", { className: "lead", style: "font-size:14px", textContent: "نزّل ميزانية القسم بالنموذج الرسمي، أو ارفع النموذج معبّأً فتُملأ البطاقات منه." }),
    el("div", { className: "row", style: "margin-top:4px" }, ...downloadButtons(() => E.dp, () => E.data, ui.formMsg)),
    el("div", { className: "row" }, up, fileIn, ui.formMsg),
    el("p", { className: "plea", textContent: FORM_PLEA }), ui.review));

  ui.viewBtn = el("button", { className: "btn ghost", type: "button" });
  ui.viewBtn.onclick = () => {
    const table = !tableOn();
    try { localStorage.setItem(VIEW_KEY, table ? "table" : "cards"); } catch {}
    renderTeachers();
  };
  box.append(el("div", { className: "row", style: "justify-content:flex-end;margin:0 0 8px" }, ui.viewBtn));
  ui.teachers = el("div");
  box.append(ui.teachers);

  ui.req = el("input", { type: "number", inputMode: "numeric", min: 0, max: 99, placeholder: "—" });
  ui.have = el("span", { textContent: "0" });
  ui.gap = el("span", { textContent: "—" });
  ui.note = el("textarea", { maxLength: 1000, placeholder: "أي ملاحظة على ميزانية القسم" });
  const saveBtn = el("button", { className: "btn", type: "button", textContent: "حفظ" });
  saveBtn.onclick = () => saveBudget();
  box.append(el("div", { className: "card", style: "margin-top:14px" }, el("h2", { textContent: "ميزانية المعلمين" }),
    el("div", { className: "sums" },
      el("div", {}, el("b", { textContent: "العدد المطلوب" }), ui.req),
      el("div", {}, el("b", { textContent: "الموجود" }), ui.have),
      el("div", {}, el("b", { textContent: "العجز" }), ui.gap)),
    el("label", { className: "lbl", textContent: "ملاحظات" }), ui.note,
    el("div", { className: "row" }, saveBtn)));

  ui.req.value = E.data.required ?? "";
  ui.req.oninput = () => { E.data.required = ui.req.value === "" ? null : Number(ui.req.value); changed(); };
  ui.note.value = E.data.note || "";
  ui.note.oninput = () => { E.data.note = ui.note.value; changed(); };

  S.body.replaceChildren(...box.childNodes);
  S.scroller.scrollTop = 0;
  renderPeriods();
  renderTeachers();
}

function closeEditor() {
  const E = S.edit;
  if (!E) return;
  // A filled form not yet approved is dropped, not saved.
  if (E.review) { E.data = E.review; E.review = null; E.dirty = false; clearTimeout(E.timer); }
  if (E.dirty) saveBudget();
  S.edit = null;
}

function setMsg(node, text, kind) { node.textContent = text || ""; node.className = "msg" + (kind ? " " + kind : ""); }

function changed() {
  const E = S.edit;
  E.dirty = true; renderSums();
  if (E.review) { setMsg(E.ui.saveMsg, "لم يُحفظ: راجع ثم اضغط «اعتماد وحفظ»", "err"); return; }
  clearTimeout(E.timer); E.timer = setTimeout(saveBudget, 800);
  setMsg(E.ui.saveMsg, "جارٍ الحفظ...");
}

async function saveBudget() {
  const E = S.edit;
  if (!E || E.review) return;
  clearTimeout(E.timer);
  const snapshot = JSON.stringify(E.data);
  const clean = cleanBudget(E.data);
  try {
    await setDoc(doc(S.db, COLLECTION, E.dp), {
      ...clean, updatedAt: serverTimestamp(), updatedBy: S.me.name || "", updatedByUid: S.me.uid,
    });
    const now = new Date();
    S.budgets.set(E.dp, { dept: E.dp, data: clean, updatedAt: now, updatedBy: S.me.name || "" });
    if (S.edit === E && JSON.stringify(E.data) === snapshot) E.dirty = false;
    if (S.edit === E) setMsg(E.ui.saveMsg, "حُفظ ✓ " + fmtTime(now), "ok");
  } catch (e) {
    console.error("[department-budgets] save failed", e);
    if (S.edit === E) setMsg(E.ui.saveMsg, "لم يُحفظ: " + errText(e), "err");
  }
}

function renderSums() {
  const E = S.edit, d = E.data, have = d.teachers.filter((t) => t.name).length;
  E.ui.have.textContent = have;
  const gap = d.required === null || d.required === undefined ? null : d.required - have;
  E.ui.gap.textContent = gap === null ? "—" : gap;
  E.ui.gap.className = gap > 0 ? "neg" : "";
}

// One input per grade group, as the original page; a merged department gets
// one such row per subject, under its name.
function renderPeriods() {
  const E = S.edit, d = E.data, dp = E.dp, multi = isMulti(dp);
  const keys = multi ? deptSubjects(dp, d.teachers) : [dp];
  const cols = `grid-template-columns:repeat(${Math.max(1, S.classes.groups.length)}, 1fr)`;
  const rows = keys.map((k) => [multi ? el("div", { className: "psub", textContent: k }) : null, el("div", { className: "periods", style: cols }, ...S.classes.groups.map((g) => {
    const v = ((d.periods || {})[k] || {})[g.key];
    const inp = el("input", { type: "number", inputMode: "numeric", min: 0, max: 40, value: v ?? "", placeholder: "—", title: (multi ? k + " — " : "") + g.label });
    inp.oninput = () => {
      const old = ((d.periods || {})[k] || {})[g.key] ?? null;
      const now = inp.value === "" ? null : Math.max(0, Math.min(40, Math.floor(Number(inp.value)) || 0));
      d.periods = d.periods || {};
      d.periods[k] = d.periods[k] || {};
      if (now === null) delete d.periods[k][g.key]; else d.periods[k][g.key] = now;
      // Classes that had the old default (or none) follow the new one.
      if (now !== null) d.teachers.forEach((t) => g.classes.forEach((c) => {
        if (!(c in t.cells)) return;
        const parts = partsOf(dp, t, c);
        let hit = false;
        parts.forEach((p) => { if ((!multi || p.subj === k) && (p.h === old || p.h === 0)) { p.h = now; hit = true; } });
        if (hit) setParts(t, c, parts);
      }));
      changed(); renderTeachers();
    };
    return el("div", {}, el("label", { textContent: g.short }), inp);
  }))]);
  E.ui.periods.replaceChildren(...rows.flat().filter(Boolean));
}

const WIDE = window.matchMedia("(min-width: 900px)");
function tableOn() {
  let pref = "table";
  try { pref = localStorage.getItem(VIEW_KEY) || "table"; } catch {}
  return WIDE.matches && pref !== "cards";
}
WIDE.addEventListener("change", () => { if (S?.edit && S.view === "dept") renderTeachers(); });

function renderTeachers() {
  const E = S.edit;
  if (!E) return;
  const table = tableOn();
  E.ui.viewBtn.hidden = !WIDE.matches;
  E.ui.viewBtn.textContent = table ? "عرض البطاقات" : "عرض الجدول";
  setWide(table);
  if (table) renderTable();
  else {
    const dup = dupes(E.data.teachers);
    E.ui.teachers.replaceChildren(...E.data.teachers.map((t, i) => teacherCard(t, i, dup)), addTeacherSelect(false));
  }
  renderSums();
}

// The department's teachers not yet in its budget, or any other name.
function addTeacherSelect(inTable) {
  const E = S.edit, d = E.data;
  const others = deptStaff(E.dp).filter((t) => !d.teachers.some((x) => sameTeacher(x, t)));
  const sel = el("select", { className: "addSel", title: "إضافة معلم" }, el("option", { value: "", textContent: "+ إضافة معلم" }),
    ...others.map((t) => el("option", { value: t.uid, textContent: t.name })), el("option", { value: "*", textContent: "اسم آخر…" }));
  sel.onchange = () => {
    if (!sel.value) return;
    const t = others.find((x) => x.uid === sel.value);
    d.teachers.push(t ? newRow(E.dp, t) : { uid: "", name: "", cells: {}, note: "", subjects: [], subj: {}, split: {}, added: true });
    if (t) changed();
    if (t && isMulti(E.dp)) renderPeriods();
    renderTeachers();
    if (!t) { const ins = E.ui.teachers.querySelectorAll('input[placeholder="اسم المعلم"]'); ins[ins.length - 1]?.focus(); }
  };
  if (inTable) return sel;
  return el("div", { style: "margin-top:4px" }, sel);
}

function removeButton(i, short) {
  const t = S.edit.data.teachers[i];
  const del = el("button", { className: "del", type: "button", textContent: "🗑️", title: "حذف المعلم من الميزانية", ariaLabel: "حذف المعلم من الميزانية" });
  armTwice(del, "🗑️", short ? "تأكيد؟" : "تأكيد حذف " + ((t.name || "").split(" ")[0] || "المعلم") + "؟", () => { S.edit.data.teachers.splice(i, 1); changed(); renderTeachers(); });
  return del;
}

function teacherCard(t, i, dup) {
  const E = S.edit, dp = E.dp, d = E.data;
  const box = el("div", { className: "card" });
  const nameEl = t.added ? el("input", { className: "tname-input", value: t.name, placeholder: "اسم المعلم", maxLength: 120 }) : el("span", { className: "tname", textContent: (i + 1) + ". " + t.name });
  if (t.added) nameEl.oninput = () => { t.name = nameEl.value.trim(); changed(); };
  box.append(el("div", { className: "row top between" }, nameEl, el("div", { className: "row top" }, el("span", { className: "nisab", textContent: "النصاب: " + nisab(t) }), removeButton(i))));
  // Merged departments: the teacher's subjects, one tap each.
  if (isMulti(dp)) {
    const row = el("div", { className: "subjects" });
    for (const sj of deptSubjects(dp, d.teachers)) {
      const on = t.subjects.includes(sj);
      const b = el("button", { className: "sub" + (on ? " on" : ""), type: "button", textContent: sj });
      b.onclick = () => { t.subjects = on ? t.subjects.filter((x) => x !== sj) : [...t.subjects, sj]; changed(); renderTeachers(); };
      row.append(b);
    }
    const add = el("button", { className: "sub", type: "button", textContent: "+ مادة" });
    add.onclick = () => {
      const inp = el("input", { className: "sub-input", placeholder: "اسم المادة", maxLength: 40 });
      const ok = el("button", { className: "sub", type: "button", textContent: "إضافة" });
      ok.onclick = () => { const v = inp.value.trim(); if (v && !t.subjects.includes(v)) { t.subjects.push(v); changed(); renderPeriods(); } renderTeachers(); };
      inp.onkeydown = (e) => { if (e.key === "Enter") ok.click(); };
      add.replaceWith(inp, ok); inp.focus();
    };
    row.append(add);
    box.append(row);
  }
  const editor = el("div");
  box.append(classGrid(t, dp, d, {
    onToggle(c, def, on) {
      if (on) { delete t.cells[c]; delete t.subj[c]; delete t.split[c]; changed(); renderTeachers(); return; }
      t.cells[c] = def ?? 0; changed(); renderTeachers();
      if (def === null) setMsg(E.ui.saveMsg, "حدد «حصص الأسبوع» لهذا الصف، أو اضغط الفصل مطوّلاً واكتب العدد", "err");
    },
    onHold(c, def) {
      const inp = el("input", { type: "number", inputMode: "numeric", min: 0, max: 40, value: t.cells[c] ?? def ?? "" });
      const ok = el("button", { className: "btn ghost small", type: "button", textContent: "تم" });
      // A teacher with several subjects says which one this class gets.
      const pick = (t.subjects || []).length > 1 ? el("select", {}, el("option", { value: "", textContent: "المادة؟" }),
        ...t.subjects.map((x) => el("option", { value: x, textContent: x, selected: (t.subj || {})[c] === x }))) : null;
      ok.onclick = () => {
        t.cells[c] = Math.max(0, Math.min(40, Math.floor(Number(inp.value)) || 0));
        delete t.split[c];
        if (pick) { if (pick.value) t.subj[c] = pick.value; else delete t.subj[c]; }
        changed(); renderTeachers();
      };
      inp.onkeydown = (e) => { if (e.key === "Enter") ok.click(); };
      editor.replaceChildren(el("div", { className: "cellEdit" }, el("span", { textContent: "حصص " + c + ":" }), inp, pick, ok));
      inp.focus(); inp.select();
    },
  }, dup));
  const note = el("input", { value: t.note || "", className: "tnote", placeholder: "ملاحظة (اختياري)", maxLength: 300 });
  note.oninput = () => { t.note = note.value; changed(); };
  box.append(editor, note);
  return box;
}

/* ---- Wide screens: one row per teacher × subject, like the official form ---- */
function tableLines(dp, t) {
  if (!isMulti(dp)) return [null];
  const subs = deptSubjects(dp, S.edit.data.teachers), have = new Set(t.subjects || []);
  for (const c of S.classes.classes) if (c in t.cells) for (const p of partsOf(dp, t, c)) if (p.subj) have.add(p.subj);
  const keys = [...have].sort((a, b) => subs.indexOf(a) - subs.indexOf(b));
  return keys.length ? keys : [""];
}
function lineHours(dp, t, s, c) {
  if (!(c in t.cells)) return undefined;
  const p = partsOf(dp, t, c).find((x) => isMulti(dp) ? x.subj === s : true);
  return p ? p.h : undefined;
}
function setLine(dp, t, s, c, h) {
  if (!isMulti(dp)) { if (h === null) { delete t.cells[c]; delete t.subj[c]; delete t.split[c]; } else t.cells[c] = h; return; }
  const subs = deptSubjects(dp, S.edit.data.teachers);
  const parts = (c in t.cells ? partsOf(dp, t, c) : []).filter((p) => p.subj !== s);
  if (h !== null) parts.push({ subj: s, h });
  parts.sort((a, b) => subs.indexOf(a.subj) - subs.indexOf(b.subj));
  setParts(t, c, parts);
  if (s && h !== null && !t.subjects.includes(s)) t.subjects.push(s);
}
let TYPED = { key: "", at: 0 };
function renderTable(focus) {
  const E = S.edit, dp = E.dp, d = E.data, multi = isMulti(dp), dup = subjectDupes(dp, d.teachers);
  const classes = S.classes.classes;
  const th = (text, props) => el("th", { textContent: text, ...props });
  const head = el("thead", {},
    el("tr", {}, th("م", { rowSpan: 2, className: "s1" }), th("المعلم", { rowSpan: 2, className: "s2" }), th("النصاب", { rowSpan: 2 }), multi ? th("المادة", { rowSpan: 2 }) : null,
      ...S.classes.groups.map((g) => th(g.short, { colSpan: g.classes.length })), th("ملاحظة", { rowSpan: 2 }), th("", { rowSpan: 2 })),
    el("tr", {}, ...S.classes.groups.flatMap((g) => g.classes.map((c) => th(String(S.classes.numOf[c]), { title: c })))));
  const body = el("tbody");
  let r = 0;
  d.teachers.forEach((t, i) => {
    const lines = tableLines(dp, t), span = lines.length;
    lines.forEach((s, li) => {
      const tr = el("tr", { className: li === span - 1 ? "last" : "" });
      let tail = null;
      if (li === 0) {
        const name = t.added ? el("input", { value: t.name, placeholder: "اسم المعلم", maxLength: 120 }) : el("span", { textContent: t.name });
        if (t.added) name.oninput = () => { t.name = name.value.trim(); changed(); };
        const cell = el("td", { rowSpan: span, className: "s2 nm" }, name);
        if (multi) {
          const rest = deptSubjects(dp, d.teachers).filter((x) => !lines.includes(x));
          if (rest.length) {
            const add = el("select", { title: "إضافة مادة لهذا المعلم" }, el("option", { value: "", textContent: "+ مادة" }), ...rest.map((x) => el("option", { value: x, textContent: x })));
            add.onchange = () => { if (!add.value) return; t.subjects = t.subjects.filter((x) => x); t.subjects.push(add.value); changed(); renderTable(); };
            cell.append(add);
          }
        }
        const note = el("input", { value: t.note || "", maxLength: 300, placeholder: "—" });
        note.oninput = () => { t.note = note.value; changed(); };
        tr.append(el("td", { rowSpan: span, className: "s1", textContent: i + 1 }), cell, el("td", { rowSpan: span, className: "ns", textContent: nisab(t) }));
        tail = [el("td", { rowSpan: span, className: "nt" }, note), el("td", { rowSpan: span }, removeButton(i, true))];
      }
      if (multi) {
        if (s === "") {
          const pick = el("select", {}, el("option", { value: "", textContent: "المادة؟" }), ...deptSubjects(dp, d.teachers).map((x) => el("option", { value: x, textContent: x })));
          pick.onchange = () => { if (!pick.value) return; t.subjects = [pick.value]; for (const c of Object.keys(t.cells)) t.subj[c] = pick.value; changed(); renderTable(); };
          tr.append(el("td", { className: "sj" }, pick));
        } else tr.append(el("td", { className: "sj", textContent: s }));
      }
      const row = r++;
      classes.forEach((c, ci) => {
        const h = lineHours(dp, t, s, c), def = defFor(d, dp, multi ? s || null : null, c);
        const k = el("td", {
          tabIndex: 0,
          className: "hc" + (h !== undefined ? " on" : "") + (h !== undefined && def !== null && h !== def ? " odd" : "")
            + (h !== undefined && dup.has(c + "|" + (multi ? s : "")) ? " dup" : "") + (h === undefined && def === 0 ? " off" : ""),
          textContent: h === undefined ? "" : h === def ? "✓" : h,
          title: c + (s ? " — " + s : "") + (def !== null ? " — المعتاد " + def : ""),
        });
        k.dataset.r = row; k.dataset.c = ci;
        const put = (v) => { setLine(dp, t, s, c, v); changed(); renderTable({ r: row, c: ci }); };
        k.onclick = () => {
          if (h !== undefined) return put(null);
          if (def === null) { setMsg(E.ui.saveMsg, "حدد «حصص الأسبوع» لهذا الصف أولاً، أو اكتب العدد في الخانة", "err"); k.focus(); return; }
          put(def);
        };
        k.onkeydown = (e) => {
          if (/^\d$/.test(e.key)) {
            // Two quick digits make one number (1 then 2 → 12).
            const now = Date.now(), cont = TYPED.key === row + ":" + ci && now - TYPED.at < 1200 && h !== undefined && h < 10;
            const v = Math.min(40, cont ? h * 10 + Number(e.key) : Number(e.key));
            TYPED = { key: row + ":" + ci, at: now }; e.preventDefault(); return put(v);
          }
          if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); if (h !== undefined) put(null); return; }
          if (e.key === " ") { e.preventDefault(); k.click(); return; }
          // RTL: ArrowLeft moves to the next column.
          const move = { ArrowRight: [0, -1], ArrowLeft: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [1, 0], Tab: [0, e.shiftKey ? -1 : 1] }[e.key];
          if (!move) return;
          const to = E.ui.teachers.querySelector(`td.hc[data-r="${row + move[0]}"][data-c="${ci + move[1]}"]`);
          if (to) { e.preventDefault(); to.focus(); }
        };
        tr.append(k);
      });
      if (tail) tr.append(...tail);
      body.append(tr);
    });
  });
  const lead = 3 + (multi ? 1 : 0);
  body.append(el("tr", { className: "tot" }, el("td", { colSpan: lead, className: "st0", textContent: "المجموع: " + sum(d.teachers, nisab) }),
    ...classes.map((c) => el("td", { textContent: sum(d.teachers, (t) => t.cells[c] || 0) || "" })), el("td", { colSpan: 2 })));
  body.append(el("tr", {}, el("td", { colSpan: lead + classes.length + 2, style: "text-align:right" }, el("div", { className: "st0" }, addTeacherSelect(true)))));
  const wrap = el("div", { className: "btWrap" }, el("table", { className: "bedT" }, head, body));
  E.ui.teachers.replaceChildren(el("p", { className: "meta", style: "margin:0 0 6px;text-align:center", textContent: "الضغطة تضع المعتاد (✓) أو تزيله؛ اكتب رقماً لعدد آخر؛ Delete يفرّغ؛ الأسهم وEnter وTab للتنقل." }), wrap);
  if (focus) wrap.querySelector(`td.hc[data-r="${focus.r}"][data-c="${focus.c}"]`)?.focus();
  renderSums();
}

/* =====================================================================
   Admin: the whole school
   ===================================================================== */
function schoolDepartments() {
  return DEPARTMENT_LIST.filter((dp) => deptStaff(dp).length || S.budgets.has(dp));
}
// As the original page: the gold «ميزانية كل الأقسام» button, a row of
// tools, «ميزانية المدرسة» (one row per department), and «عرض التفاصيل»
// (every department's table under it).
function renderSchool(box) {
  const msg = el("span", { className: "meta" });
  const gridBtn = el("button", { className: "btn gridBtn", type: "button", textContent: "ميزانية كل الأقسام" });
  gridBtn.onclick = () => setView("grid");
  const refresh = el("button", { className: "btn ghost", type: "button", textContent: "تحديث" });
  refresh.onclick = () => load();
  const detail = el("button", { className: "btn ghost", type: "button", textContent: S.showDetail ? "إخفاء التفاصيل" : "عرض التفاصيل" });
  detail.onclick = () => { S.showDetail = !S.showDetail; render(); };
  const csv = el("button", { className: "btn ghost", type: "button", textContent: "تصدير CSV للجدول" });
  csv.onclick = () => exportCsv(msg);
  // The one-time upload of the old site's data: admins only.
  const imp = S.realAdmin ? el("button", { className: "btn ghost", type: "button", textContent: "رفع بيانات الموقع القديم" }) : null;
  if (imp) imp.onclick = () => setView("import");
  box.append(gridBtn, el("div", { className: "row", style: "margin:0 0 12px" }, refresh, detail, csv, imp, msg));
  const depts = schoolDepartments();
  const rows = depts.map((dp) => {
    const b = S.budgets.get(dp);
    const have = b ? b.data.teachers.length : deptStaff(dp).length;
    const req = b ? b.data.required : null;
    return { dp, b, head: headOf(dp) || "—", have, req, gap: req === null || req === undefined ? null : req - have, periods: b ? sum(b.data.teachers, nisab) : 0 };
  });
  const td = (v, cls) => el("td", { className: cls || "", textContent: v === null || v === undefined || v === "" ? "—" : v });
  const table = el("table", { className: "bsum" },
    el("thead", {}, el("tr", {}, ...["القسم", "رئيس القسم", "آخر تحديث", ""].map((h) => el("th", { textContent: h })))),
    el("tbody", {}, ...rows.map((r) => {
      const edit = el("button", { className: "btn ghost small", type: "button", textContent: "تعديل" });
      edit.onclick = () => openEditor(r.dp);
      const view = r.b ? el("button", { className: "btn ghost small", type: "button", textContent: "معاينة" }) : null;
      if (view) view.onclick = () => { S.preview = r.dp; setView("preview"); };
      return el("tr", {}, td(r.dp), td(r.head),
        td(!r.b ? "لم تُدخل بعد" : [r.b.updatedAt ? fmtDate(r.b.updatedAt) : "", r.b.updatedBy].filter(Boolean).join(" · ") || "محفوظة"),
        el("td", {}, el("div", { className: "acts" }, view, edit)));
    })));
  box.append(el("div", { className: "card" },
    el("h2", { textContent: "ميزانية المدرسة" }),
    el("div", { className: "meta", textContent: rows.filter((r) => r.b).length + " من " + rows.length + " أقسام أدخلت ميزانيتها" }),
    el("div", { className: "wrap-x" }, table)));
  if (S.showDetail) rows.filter((r) => r.b).forEach((r) => box.append(deptTable(r)));
}

// The department's budget in the layout of the paper form: teacher × classes, then نصاب and notes.
function deptTable(r) {
  const d = r.b.data, dup = dupes(d.teachers), multi = isMulti(r.dp);
  const th = (t, props) => el("th", { textContent: t, ...(props || {}) });
  const head1 = el("tr", {}, th("م", { rowSpan: 2 }), th("المعلم", { rowSpan: 2 }), multi ? th("المادة", { rowSpan: 2 }) : null,
    ...S.classes.groups.map((g) => th(g.label, { colSpan: g.classes.length })), th("النصاب", { rowSpan: 2 }), th("ملاحظات", { rowSpan: 2 }));
  const head2 = el("tr", {}, ...S.classes.classes.map((c) => th(String(S.classes.numOf[c]), { title: c })));
  const body = d.teachers.map((t, i) => el("tr", {}, el("td", { textContent: i + 1 }), el("td", { className: "n", textContent: t.name }),
    multi ? el("td", { className: "n", textContent: (t.subjects || []).join(" / ") }) : null,
    ...S.classes.classes.map((c) => {
      const sj = c in t.cells && (t.subjects || []).length > 1 ? subjOf(t, c) : "";
      return el("td", { className: c in t.cells ? (dup.has(c) ? "dup" : "on") : "", title: sj }, c in t.cells ? String(t.cells[c]) : "", sj ? el("div", { className: "sj", textContent: sj.replace(/^ال/, "") }) : null);
    }),
    el("td", { textContent: nisab(t) }), el("td", { className: "n", textContent: t.note || "" })));
  const have = d.teachers.length, gap = d.required == null ? null : d.required - have;
  return el("div", { className: "card" },
    el("h2", { textContent: "قسم " + r.dp }),
    el("div", { className: "meta", textContent: "رئيس القسم: " + r.head + " · المطلوب " + (d.required ?? "—") + " · الموجود " + have + " · العجز " + (gap ?? "—") }),
    dup.size ? el("div", { className: "meta", style: "color:var(--gold-ink);font-weight:700", textContent: "فصول عند أكثر من معلم (طبيعي إذا اختلفت المادة): " + [...dup].join("، ") }) : null,
    el("div", { className: "wrap-x" }, el("table", { className: "bt" }, el("thead", {}, head1, head2), el("tbody", {}, ...body))),
    d.note ? el("div", { className: "meta", style: "margin-top:8px" }, el("b", { textContent: "ملاحظات: " }), d.note) : null);
}

// «معاينة»: one department as the official form (read only).
function renderPreview(box) {
  const dp = S.preview, b = S.budgets.get(dp);
  const back = el("button", { className: "btn ghost", type: "button", textContent: "رجوع" });
  back.onclick = () => setView("school");
  if (!b) { box.append(el("div", { className: "card" }, el("p", { className: "lead", textContent: "لا ميزانية محفوظة لهذا القسم." }), back)); return; }
  const edit = el("button", { className: "btn", type: "button", textContent: "تعديل" });
  edit.onclick = () => openEditor(dp);
  const msg = el("span", { className: "msg" });
  setWide(true);
  box.append(el("div", { className: "row", style: "margin:0 0 12px" }, back, edit),
    el("div", { className: "card keep-wide" },
      el("h2", { textContent: "ميزانية قسم " + dp }),
      el("div", { className: "meta", textContent: (b.updatedAt ? "آخر تحديث: " + fmtDate(b.updatedAt) : "") + (b.updatedBy ? " — " + b.updatedBy : "") }),
      el("div", { className: "row" }, ...downloadButtons(() => dp, () => b.data, msg), msg),
      el("div", { className: "wrap-x", style: "margin-top:10px" }, formPage(dp, b.data, true))));
}

function exportCsv(msg) {
  const HEAD = ["المعرف", "الاسم", "القسم", "الصف", "المادة", "الحصص"];
  const rows = [];
  for (const dp of DEPARTMENT_LIST) {
    const b = S.budgets.get(dp);
    if (!b) continue;
    for (const t of b.data.teachers) for (const c of S.classes.classes) {
      if (!(c in t.cells)) continue;
      for (const p of partsOf(dp, t, c)) rows.push([t.uid || "", t.name, dp, c, p.subj || dp, p.h]);
    }
  }
  if (!rows.length) { setMsg(msg, "لا توجد ميزانيات للتصدير", "err"); return; }
  const q = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const csv = "﻿" + [HEAD, ...rows].map((r) => r.map(q).join(",")).join("\r\n");
  saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "ميزانيات_الأقسام_" + new Date().toISOString().slice(0, 10) + ".csv");
  setMsg(msg, rows.length + " سطراً لـ" + new Set(rows.map((r) => r[0] || r[1])).size + " معلماً", "ok");
}

/* =====================================================================
   Admin: رفع بيانات الموقع القديم — the old budgets site's data file
   (school-budgets-data.json, format "school-budgets") written into
   departmentBudgets. Read in this browser, shown for review, then saved
   with the admin's own rights; the file itself is never uploaded anywhere.
   ===================================================================== */
// Old class ids → this site's class keys: "12s-4" → "12 / 4 ع",
// "11a-1" → "11 / 1 د", "10-3" → "10 / 3" (digits and spaces compared loosely).
const latinDigits = (s) => String(s ?? "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
const classSig = (c) => latinDigits(c).replace(/\s+/g, "");
function oldClassKey(c) {
  const m = /^(10|11|12)([as]?)-(\d+)$/.exec(String(c || "").trim());
  if (!m) return null;
  const sig = `${m[1]}/${m[3]}${m[2] === "s" ? "ع" : m[2] === "a" ? "د" : ""}`;
  return S.classes.classes.find((k) => classSig(k) === sig) || null;
}
// The old site's per-track periods → this site's grade groups.
const OLD_GROUP = { g10: "10", g11s: "11 ع", g11a: "11 د", g12s: "12 ع", g12a: "12 د" };
// Old subject names → shared/departments.js's.
const OLD_SUBJECT = { "تاريخ الكويت": "الاجتماعيات", "اختيار حر": "اللغة الفرنسية (اختيار حرّ)" };
const newSubject = (s) => OLD_SUBJECT[s] || s;
const normName = (s) => String(s || "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();

// The file → one plan entry per department of this site.
function convertOld(json) {
  if (!json || json.format !== "school-budgets" || !Array.isArray(json.budgets)) throw "هذا ليس ملف بيانات الميزانيات (school-budgets-data.json).";
  const official = json.school?.official || {};
  const oldSubjects = json.school?.subjects || {};
  const oldTeachers = Array.isArray(json.teachers) ? json.teachers : [];
  const byUid = new Map(S.teachers.map((t) => [t.uid, t]));
  // The same uid as teachers/{uid}; a name only for the few rows without one.
  const ours = (name) => {
    const o = oldTeachers.find((t) => t.name === name);
    return (o?.uid && byUid.get(o.uid))
      || S.teachers.find((t) => normName(t.name) === normName(name))
      || (o?.nick && S.teachers.find((t) => normName(t.name) === normName(o.nick))) || null;
  };
  const plan = new Map();
  const entryFor = (dp, b, oldDp) => {
    if (!plan.has(dp)) plan.set(dp, { dp, from: new Set(), teachers: [], required: null, note: "", oldPeriods: {}, updatedBy: "", unmatched: [], dropped: [], moved: [] });
    const e = plan.get(dp);
    if (!e.from.has(oldDp)) {
      e.from.add(oldDp);
      // A department kept whole keeps its own numbers; a split one keeps only the note.
      if (dp === oldDp) { e.required = b.data?.required ?? null; e.oldPeriods = b.data?.periods || {}; }
      if (b.data?.note) e.note = [e.note, b.data.note].filter(Boolean).join(" · ");
      e.updatedBy = b.updated_by || e.updatedBy;
    }
    return e;
  };
  for (const b of json.budgets) {
    const oldDp = String(b.department || "").trim();
    // The departments an old one became (الاجتماعيات → الجغرافيا والتاريخ + العلوم الفلسفية).
    const targets = DEPARTMENT_LIST.includes(oldDp) ? [oldDp]
      : [...new Set([resolveDepartmentName(oldDp), ...(oldSubjects[oldDp] || []).map((s) => resolveDepartmentName(newSubject(s)))])].filter((d) => DEPARTMENT_LIST.includes(d));
    for (const t of b.data?.teachers || []) {
      const hit = ours(t.name);
      const subjects = [...new Set((t.subjects || []).map(newSubject))];
      // A teacher found by uid goes to their own department on this site;
      // only a row with no match falls back to the old department (split by
      // subject when it became two).
      let dp = hit && DEPARTMENT_LIST.includes(hit.department) ? hit.department : targets[0];
      if (!hit && targets.length > 1) {
        const votes = targets.map((d) => subjects.filter((s) => resolveDepartmentName(s) === d).length);
        dp = targets[votes.indexOf(Math.max(...votes))];
      }
      if (!dp) continue;
      const e = entryFor(dp, b, oldDp);
      if (!hit) e.unmatched.push(t.name);
      else if (hit.department !== oldDp && !targets.includes(hit.department)) e.moved.push(hit.name + " (من " + oldDp + ")");
      const multi = isMulti(dp);
      // «رئيس القسم» comes from this site's roles (headOf), not the old file's notes.
      const note = String(t.note || "").replace(/^\s*رئيس القسم\s*(—|-|·)?\s*/, "").trim();
      const row = { uid: hit?.uid || "", name: hit?.name || t.name, note, cells: {}, subjects: multi ? subjects : [], subj: {}, split: {} };
      for (const [c, n] of Object.entries(t.cells || {})) {
        const k = oldClassKey(c);
        if (k) row.cells[k] = n; else e.dropped.push(t.name + ": " + c);
      }
      if (multi) {
        for (const [c, s] of Object.entries(t.subj || {})) { const k = oldClassKey(c); if (k && k in row.cells) row.subj[k] = newSubject(s); }
        for (const [c, p] of Object.entries(t.split || {})) {
          const k = oldClassKey(c);
          if (k && k in row.cells && p) row.split[k] = Object.fromEntries(Object.entries(p).map(([s, h]) => [newSubject(s), h]));
        }
      }
      e.teachers.push(row);
    }
  }
  // Weekly periods: the old site's official table (sheet «المواد»), one
  // number per subject per grade group; else the department's own per-track numbers.
  for (const e of plan.values()) {
    const keys = isMulti(e.dp) ? deptSubjects(e.dp, e.teachers) : [e.dp];
    const periods = {};
    for (const k of keys) {
      const row = {};
      for (const [c, n] of Object.entries(official[k] || {})) {
        const g = S.classes.groupOf[oldClassKey(c)];
        if (g && !(g in row) && Number.isFinite(n)) row[g] = n;
      }
      if (!isMulti(e.dp) && !Object.keys(row).length) {
        for (const [tr, n] of Object.entries(e.oldPeriods)) { const g = OLD_GROUP[tr]; if (g && n !== null && n !== undefined && S.classes.groups.some((x) => x.key === g)) row[g] = n; }
      }
      if (Object.keys(row).length) periods[k] = row;
    }
    e.data = cleanBudget({ periods, required: e.required, note: e.note, teachers: e.teachers });
  }
  return DEPARTMENT_LIST.filter((dp) => plan.has(dp)).map((dp) => plan.get(dp));
}

function renderImport(box) {
  const msg = el("div", { className: "msg" });
  const back = el("button", { className: "btn ghost", type: "button", textContent: "رجوع" });
  back.onclick = () => { S.importPlan = null; setView("school"); };
  const fileIn = el("input", { type: "file", accept: ".json,application/json", hidden: true });
  const pick = el("button", { className: "btn", type: "button", textContent: S.importPlan ? "اختيار ملف آخر" : "اختيار الملف" });
  pick.onclick = () => fileIn.click();
  fileIn.onchange = async () => {
    const f = fileIn.files[0]; fileIn.value = "";
    if (!f) return;
    setMsg(msg, "جارٍ قراءة الملف...");
    try {
      let json;
      try { json = JSON.parse(await f.text()); } catch { throw "تعذّرت قراءة الملف: ليس ملف JSON سليماً."; }
      S.importPlan = convertOld(json);
      S.importFile = f.name;
      render();
    } catch (e) { setMsg(msg, typeof e === "string" ? e : "تعذّرت قراءة الملف.", "err"); }
  };
  box.append(el("div", { className: "row", style: "margin:0 0 12px" }, back),
    el("div", { className: "card gold" },
      el("h2", { textContent: "رفع بيانات الموقع القديم" }),
      el("p", { className: "lead", textContent: "اختر ملف «school-budgets-data.json». يُقرأ في هذا المتصفح، ويُطابَق كل معلم بمعرّفه (uid) مع معلمي الموقع، ثم تراجع ما سيُكتب قبل الحفظ." }),
      el("div", { className: "row" }, pick, fileIn, S.importFile ? el("span", { className: "meta", textContent: S.importFile }) : null), msg));
  const plan = S.importPlan;
  if (!plan) return;
  const td = (v, cls) => el("td", { className: cls || "", textContent: v });
  const table = el("table", { className: "bsum" },
    el("thead", {}, el("tr", {}, ...["القسم", "رئيس القسم", "من القديم", "المعلمون", "الحصص", "غير مطابَقين", ""].map((h) => el("th", { textContent: h })))),
    el("tbody", {}, ...plan.map((e) => el("tr", {}, td(e.dp), td(headOf(e.dp) || "—"), td([...e.from].join("، ")), td(e.data.teachers.length), td(sum(e.data.teachers, nisab)),
      td(e.unmatched.length || "—", e.unmatched.length ? "neg" : ""), td(S.budgets.has(e.dp) ? "تستبدل الموجودة" : "جديدة", S.budgets.has(e.dp) ? "neg" : "")))));
  const unmatched = plan.flatMap((e) => e.unmatched.map((n) => n + " (" + e.dp + ")"));
  const dropped = plan.flatMap((e) => e.dropped);
  const moved = plan.flatMap((e) => e.moved.map((n) => n + " ← " + e.dp));
  const replacing = plan.filter((e) => S.budgets.has(e.dp)).length;
  const write = el("button", { className: "btn", type: "button", textContent: "حفظ " + plan.length + " أقسام في الموقع" });
  const out = el("div", { className: "msg" });
  const doWrite = async () => {
    write.disabled = true;
    let done = 0;
    try {
      for (const e of plan) {
        setMsg(out, "جارٍ الحفظ: " + e.dp + " (" + (done + 1) + " من " + plan.length + ")...");
        await setDoc(doc(S.db, COLLECTION, e.dp), {
          ...e.data, updatedAt: serverTimestamp(), updatedBy: "من الموقع القديم" + (e.updatedBy ? " — " + e.updatedBy : ""), updatedByUid: S.me.uid,
        });
        done++;
      }
      S.importPlan = null; S.importFile = null;
      S.view = "school";
      await load();
      return;
    } catch (err) {
      console.error("[department-budgets] import failed", err);
      setMsg(out, "حُفظ " + done + " من " + plan.length + "، وتعذّر الباقي: " + errText(err), "err");
    }
    write.disabled = false;
  };
  // Replacing saved budgets takes a second tap.
  if (replacing) armTwice(write, write.textContent, "اضغط مرة أخرى: ستُستبدل " + replacing + " ميزانيات محفوظة", doWrite);
  else write.onclick = doWrite;
  box.append(el("div", { className: "card" },
    el("h2", { textContent: "ما سيُكتب" }),
    el("div", { className: "meta", textContent: plan.length + " أقسام · " + sum(plan, (e) => e.data.teachers.length) + " معلماً · الحصص المعتادة من جدول المواد في الملف" }),
    el("div", { className: "wrap-x", style: "margin-top:8px" }, table),
    unmatched.length ? el("div", { className: "review" }, el("b", { textContent: "لم يُطابَقوا بمعلم في الموقع (يُحفظون بالاسم كما في الملف):" }), el("ul", { className: "import-list" }, ...unmatched.map((n) => el("li", { textContent: n })))) : null,
    moved.length ? el("div", { className: "review" }, el("b", { textContent: "معلمون قسمهم في الموقع غير قسمهم في الملف (يُحفظون في قسمهم في الموقع):" }), el("ul", { className: "import-list" }, ...moved.map((n) => el("li", { textContent: n })))) : null,
    dropped.length ? el("div", { className: "review" }, el("b", { textContent: "فصول ليست في فصول الموقع (لن تُحفظ):" }), el("ul", { className: "import-list" }, ...dropped.map((n) => el("li", { textContent: n })))) : null,
    el("div", { className: "row" }, write), out));
}

/* ---- «كل الأقسام»: class × subject, one teacher per cell ---- */
function gridColumns() {
  return schoolDepartments().map((dp) => {
    const b = S.budgets.get(dp);
    const subs = isMulti(dp) ? deptSubjects(dp, b ? b.data.teachers : []) : [null];
    return { dp, cols: subs.map((subj) => ({ dp, subj, label: subj || dp })) };
  });
}
function renderGrid(box) {
  setWide(true);
  const msg = el("span", { className: "msg" });
  S.gridMsg = msg;
  const back = el("button", { className: "btn ghost", type: "button", textContent: "رجوع" });
  back.onclick = () => setView("school");
  const refresh = el("button", { className: "btn ghost", type: "button", textContent: "تحديث" });
  refresh.onclick = () => load();
  const groups = gridColumns(), cols = groups.flatMap((g) => g.cols);
  // who[dp|subj][class] = [{ t, h }]
  const who = {};
  for (const { dp } of groups) {
    const b = S.budgets.get(dp);
    if (!b) continue;
    for (const t of b.data.teachers) for (const c of S.classes.classes) {
      if (!(c in t.cells)) continue;
      for (const p of partsOf(dp, t, c)) {
        const k = dp + "|" + (p.subj || "");
        ((who[k] = who[k] || {})[c] = who[k][c] || []).push({ t, h: p.h });
      }
    }
  }
  const head = el("thead", {},
    el("tr", {}, el("th", { className: "stick", rowSpan: 2, textContent: "الصف" }),
      ...groups.map((g) => isMulti(g.dp) ? el("th", { colSpan: g.cols.length, textContent: g.dp }) : el("th", { rowSpan: 2, textContent: g.dp }))),
    el("tr", {}, ...groups.filter((g) => isMulti(g.dp)).flatMap((g) => g.cols.map((k) => el("th", { textContent: k.subj })))));
  const body = el("tbody");
  for (const g of S.classes.groups) g.classes.forEach((c, ci) => {
    body.append(el("tr", { className: ci === 0 ? "gsep" : "" }, el("th", { className: "stick", textContent: c }), ...cols.map((k) => {
      const d = S.budgets.get(k.dp)?.data || { periods: {} };
      const def = defFor(d, k.dp, k.subj, c);
      const cur = (who[k.dp + "|" + (k.subj || "")] || {})[c] || [];
      if (def === 0 && !cur.length) return el("td", { className: "off" });
      const staff = deptStaff(k.dp).map((t) => ({ key: teacherKey(t), name: t.name }));
      cur.forEach((x) => { if (!staff.some((s) => s.key === teacherKey(x.t))) staff.push({ key: teacherKey(x.t), name: x.t.name }); });
      const sel = el("select", {}, el("option", { value: "", textContent: "—" }), ...staff.map((s) => el("option", { value: s.key, textContent: s.name })));
      sel.value = cur.length ? teacherKey(cur[0].t) : "";
      sel.onchange = () => setGridCell(k, c, staff.find((s) => s.key === sel.value) || null);
      const bad = cur.some((x) => def !== null && x.h !== def);
      return el("td", { className: (cur.length > 1 ? "dup" : "") + (bad ? " odd" : ""), title: cur.map((x) => x.t.name + " (" + x.h + ")").join("\n") },
        sel, cur.length > 1 ? el("small", { textContent: "+" + (cur.length - 1) }) : null);
    })));
  });
  box.append(el("div", { className: "row", style: "margin:0 0 10px" }, back, refresh, msg),
    el("div", { className: "card keep-wide", style: "padding:10px" },
      el("h2", { textContent: "ميزانية كل الأقسام" }),
      el("p", { className: "lead", style: "font-size:14px", textContent: "اختر المعلم من القائمة فيُحفظ في ميزانية قسمه فوراً، والحصص من المعتاد. الخانة الحمراء حصصها تخالف المعتاد." }),
      el("div", { className: "gridWrap" }, el("table", { className: "grid" }, head, body))));
}
// One cell changed: the subject leaves whoever had it in that class and goes
// to the chosen teacher, in the department's own budget.
function setGridCell(k, c, pick) {
  S.gridBusy = S.gridBusy.then(async () => {
    const msg = S.gridMsg;
    setMsg(msg, "جارٍ الحفظ...");
    const b = S.budgets.get(k.dp);
    const d = editable(b ? b.data : emptyData(k.dp));
    for (const t of d.teachers) if (c in t.cells) {
      const parts = partsOf(k.dp, t, c), keep = parts.filter((p) => (p.subj || null) !== (k.subj || null));
      if (keep.length !== parts.length) setParts(t, c, keep);
    }
    if (pick) {
      const staff = S.teachers.find((t) => t.uid === pick.key);
      let t = d.teachers.find((x) => teacherKey(x) === pick.key);
      if (!t) { t = staff ? newRow(k.dp, staff) : { uid: "", name: pick.name, cells: {}, note: "", subjects: [], subj: {}, split: {} }; d.teachers.push(t); }
      if (k.subj && !t.subjects.includes(k.subj)) t.subjects.push(k.subj);
      const h = defFor(d, k.dp, k.subj, c) ?? 0;
      setParts(t, c, [...(c in t.cells ? partsOf(k.dp, t, c) : []), { subj: k.subj, h }]);
    }
    const clean = cleanBudget(d);
    try {
      await setDoc(doc(S.db, COLLECTION, k.dp), { ...clean, updatedAt: serverTimestamp(), updatedBy: S.me.name || "", updatedByUid: S.me.uid });
      S.budgets.set(k.dp, { dept: k.dp, data: clean, updatedAt: new Date(), updatedBy: S.me.name || "" });
      redrawGrid();
      setMsg(S.gridMsg, "حُفظ ✓ في ميزانية " + k.dp, "ok");
    } catch (e) {
      console.error("[department-budgets] grid save failed", e);
      redrawGrid();
      setMsg(S.gridMsg, "لم يُحفظ: " + errText(e), "err");
    }
  });
}
// Re-draws «كل الأقسام» where the admin left it, not back at the first column.
function redrawGrid() {
  if (S.view !== "grid") return;
  const old = S.body.querySelector(".gridWrap");
  const pos = { top: S.scroller.scrollTop, gTop: old?.scrollTop || 0, gLeft: old?.scrollLeft || 0 };
  render();
  const now = S.body.querySelector(".gridWrap");
  S.scroller.scrollTop = pos.top;
  if (now) { now.scrollTop = pos.gTop; now.scrollLeft = pos.gLeft; }
}

/* =====================================================================
   The official form: Excel / PDF / image, and a filled Excel read back
   ===================================================================== */
const formSubjects = (dp, d) => isMulti(dp) ? deptSubjects(dp, d.teachers) : [dp];
const withHeadNote = (dp, name, note) => name && name === headOf(dp) && !/رئيس/.test(note || "") ? (note ? HEAD_NOTE + " — " + note : HEAD_NOTE) : note || "";
const cellMark = (d, dp, subj, c, h) => h === undefined ? "" : h === defFor(d, dp, subj === dp ? null : subj, c) ? "✓" : h;
// One row per teacher × subject.
function formRows(dp, d) {
  const subs = formSubjects(dp, d), multi = isMulti(dp);
  return d.teachers.filter((t) => t.name).map((t) => {
    const by = {};
    for (const c of S.classes.classes) if (c in (t.cells || {})) for (const p of partsOf(dp, t, c)) ((by[p.subj || ""] = by[p.subj || ""] || {})[c] = p.h);
    let keys = Object.keys(by).sort((a, b) => subs.indexOf(a) - subs.indexOf(b));
    if (!keys.length) keys = [multi ? (t.subjects || [])[0] || "" : ""];
    return { name: t.name, note: t.note || "", lines: keys.map((k) => ({ subj: multi ? k : dp, cells: by[k] || {} })) };
  });
}
const fileBase = (dp) => "ميزانية_" + dp.replace(/\s+/g, "_");

function downloadButtons(getDp, getData, msgEl) {
  return [["xlsx", "تنزيل Excel"], ["pdf", "تنزيل PDF"], ["png", "تنزيل صورة"]].map(([kind, label]) => {
    const b = el("button", { className: "btn ghost small", type: "button", textContent: label });
    b.onclick = async () => {
      b.disabled = true;
      await downloadForm(kind, getDp(), cleanBudget(getData()), msgEl);
      b.disabled = false;
    };
    return b;
  });
}
async function downloadForm(kind, dp, d, msgEl) {
  setMsg(msgEl, "جارٍ إنشاء الملف...");
  try {
    if (kind === "xlsx") saveBlob(await buildXlsx(dp, d), fileBase(dp) + ".xlsx");
    else {
      const canvas = await formCanvas(dp, d);
      if (kind === "png") saveBlob(await new Promise((r) => canvas.toBlob(r, "image/png")), fileBase(dp) + ".png");
      else {
        const pdf = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
        const W = 297, H = 210, m = 8, k = Math.min((W - 2 * m) / canvas.width, (H - 2 * m) / canvas.height);
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (W - canvas.width * k) / 2, m, canvas.width * k, canvas.height * k);
        saveBlob(pdf.output("blob"), fileBase(dp) + ".pdf");
      }
    }
    setMsg(msgEl, "نُزّل الملف ✓", "ok");
  } catch (e) {
    console.error("[department-budgets] download failed", e);
    setMsg(msgEl, "تعذّر إنشاء الملف: " + (typeof e === "string" ? e : e?.message || ""), "err");
  }
}

async function imageB64(path) {
  const buf = await (await fetch(path)).arrayBuffer();
  let s = ""; new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}
const colName = (n) => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };

async function buildXlsx(dp, d) {
  await needExcel();
  const ExcelJS = window.ExcelJS;
  const multi = isMulti(dp), classes = S.classes.classes, subs = formSubjects(dp, d), rows = formRows(dp, d);
  const C0 = 5, CN = C0 + classes.length - 1, NOTE = CN + 1, HELP = CN + 2, HR = 9;
  const L = colName, lastL = L(NOTE), year = academicYear(), head = headOf(dp);
  const wb = new ExcelJS.Workbook(); wb.creator = SCHOOL_NAME;
  const ws = wb.addWorksheet("الميزانية", { views: [{ rightToLeft: true, showGridLines: false }] });
  const ref = wb.addWorksheet("الحصص", { views: [{ rightToLeft: true }] });
  const guide = wb.addWorksheet("طريقة التعبئة", { views: [{ rightToLeft: true }] });
  const meta = wb.addWorksheet("_منصة", { state: "veryHidden" });
  const thin = { style: "thin", color: { argb: "FF9E9E9E" } }, box = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const center = { horizontal: "center", vertical: "middle", wrapText: true, readingOrder: "rtl" };

  // _منصة: the form's mark, the department, and the dropdown lists.
  meta.getCell("A1").value = FORM_MARK; meta.getCell("B1").value = FORM_VERSION;
  meta.getCell("A2").value = "القسم"; meta.getCell("B2").value = dp;
  meta.getCell("A3").value = "العام"; meta.getCell("B3").value = year;
  meta.getCell("A4").value = "تاريخ التنزيل"; meta.getCell("B4").value = new Date().toISOString().slice(0, 10);
  meta.getCell("A5").value = "رئيس القسم"; meta.getCell("B5").value = head;
  const staff = [...new Set([...deptStaff(dp).map((t) => t.name), ...rows.map((r) => r.name)])];
  staff.forEach((n, i) => { meta.getCell("D" + (i + 1)).value = n; });
  subs.forEach((s, i) => { meta.getCell("E" + (i + 1)).value = s; });

  // الحصص: the department's usual periods, the same class columns as the budget sheet.
  ref.getCell("A1").value = "الحصص المعتادة لكل مادة في كل صف (من «حصص الأسبوع» في الصفحة) — للاطلاع، لا تُعدَّل";
  ref.getCell("D2").value = "المادة";
  classes.forEach((c, i) => { ref.getCell(2, C0 + i).value = compact(c); });
  subs.forEach((s, j) => {
    ref.getCell(3 + j, 4).value = s;
    classes.forEach((c, i) => { const o = defFor(d, dp, multi ? s : null, c); if (o !== null) ref.getCell(3 + j, C0 + i).value = o; });
  });
  ref.getRow(2).font = { bold: true };
  ref.getColumn(4).width = 18;
  await ref.protect("", {});
  const REF_SUBJ = `الحصص!$D$3:$D$${2 + subs.length}`, REF_GRID = `الحصص!$${L(C0)}$3:$${L(CN)}$${2 + subs.length}`;

  // Header.
  ws.getColumn(1).width = 4; ws.getColumn(2).width = 24; ws.getColumn(3).width = 7; ws.getColumn(4).width = multi ? 15 : 13;
  for (let c = C0; c <= CN; c++) ws.getColumn(c).width = 5.8;
  ws.getColumn(NOTE).width = 18; ws.getColumn(HELP).hidden = true;
  try {
    const logo = wb.addImage({ base64: await imageB64(SCHOOL_LOGO), extension: "png" });
    ws.addImage(logo, { tl: { col: NOTE - 2.6, row: 0.4 }, ext: { width: 120, height: 63 } });
  } catch (e) { console.warn("[department-budgets] logo not added", e); }
  const put = (range, value, font) => { ws.mergeCells(range); const c = ws.getCell(range.split(":")[0]); c.value = value; c.alignment = center; if (font) c.font = font; };
  put("A5:D5", "وزارة التربية", { bold: true, size: 12 });
  put("A6:D6", SCHOOL_NAME, { size: 11 });
  put(`${L(C0 + 1)}2:${L(CN - 2)}3`, "ميزانية الأقسام العلمية للعام الدراسي " + year, { bold: true, size: 16 });
  put(`${L(C0 + 1)}4:${L(CN - 2)}5`, "القسم العلمي / " + dp, { bold: true, size: 13 });
  put(`${L(NOTE - 3)}6:${lastL}6`, "العام الدراسي " + year, { size: 11 });
  for (let c = 1; c <= NOTE; c++) ws.getCell(8, c).border = { bottom: { style: "double", color: { argb: "FF217346" } } };

  const heads = ["م", "المعلم", "النصاب", "المادة", ...classes.map(compact), "ملاحظات"];
  heads.forEach((h, i) => { const c = ws.getCell(HR, i + 1); c.value = h; c.font = { bold: true }; c.alignment = center; c.border = box; c.fill = fill("FFDBE9E1"); });
  ws.getRow(HR).height = 22;

  // Teachers, then 10 empty rows to add.
  let r = HR + 1, n = 0;
  const lines = [];
  rows.forEach((t) => { n++; lines.push({ n, t, first: true, span: t.lines.length, line: t.lines[0] }); t.lines.slice(1).forEach((line) => lines.push({ t, line })); });
  for (let k = 0; k < 10; k++) lines.push({ n: ++n, t: null, first: true, span: 1, line: { subj: multi ? "" : dp, cells: {} } });
  const first = r;
  lines.forEach((x) => {
    const row = ws.getRow(r);
    if (x.first) {
      if (x.span > 1) for (const col of [1, 2, 3]) ws.mergeCells(r, col, r + x.span - 1, col);
      row.getCell(1).value = x.n;
      if (x.t) row.getCell(2).value = x.t.name;
      row.getCell(3).value = { formula: `SUM(${L(HELP)}${r}:${L(HELP)}${r + x.span - 1})` };
      const note = x.t ? withHeadNote(dp, x.t.name, x.t.note) : "";
      row.getCell(NOTE).value = note || (head ? { formula: `IF($B${r}=_منصة!$B$5,"${HEAD_NOTE}","")` } : null);
    }
    row.getCell(4).value = x.line.subj || null;
    classes.forEach((c, i) => { const v = cellMark(d, dp, x.line.subj, c, x.line.cells[c]); if (v !== "") row.getCell(C0 + i).value = v; });
    row.getCell(HELP).value = { formula: `IFERROR(SUMPRODUCT((${L(C0)}${r}:${L(CN)}${r}="✓")*INDEX(${REF_GRID},MATCH($D${r},${REF_SUBJ},0),0)),0)+SUM(${L(C0)}${r}:${L(CN)}${r})` };
    for (let c = 1; c <= NOTE; c++) { const cell = row.getCell(c); cell.border = box; cell.alignment = c === 2 || c === NOTE ? { vertical: "middle", horizontal: "right", wrapText: true } : center; }
    row.getCell(2).font = { bold: true }; row.getCell(3).font = { bold: true }; row.getCell(3).fill = fill("FFEEF6F1");
    for (const c of [2, ...(multi ? [4] : []), NOTE]) row.getCell(c).protection = { locked: false };
    for (let c = C0; c <= CN; c++) row.getCell(c).protection = { locked: false };
    row.height = 20;
    r++;
  });
  const last = r - 1;
  for (let rr = first; rr <= last; rr++) {
    if (staff.length) ws.getCell(rr, 2).dataValidation = { type: "list", allowBlank: true, formulae: [`_منصة!$D$1:$D$${staff.length}`], showErrorMessage: true, errorStyle: "warning", errorTitle: "اسم غير موجود", error: "هذا الاسم ليس في قائمة معلمي القسم. يُقبل، وتنبّهك الصفحة عند الرفع." };
    if (multi && subs.length) ws.getCell(rr, 4).dataValidation = { type: "list", allowBlank: true, formulae: [`_منصة!$E$1:$E$${subs.length}`], showErrorMessage: true, errorStyle: "stop", errorTitle: "مادة غير معروفة", error: "اختر مادة من القائمة." };
    for (let c = C0; c <= CN; c++) ws.getCell(rr, c).dataValidation = { type: "custom", allowBlank: true, formulae: [`OR(${L(c)}${rr}="✓",AND(ISNUMBER(${L(c)}${rr}),${L(c)}${rr}>=0,${L(c)}${rr}<=40))`], showErrorMessage: true, errorStyle: "stop", errorTitle: "قيمة غير مقبولة", error: "اكتب ✓ (المعتاد) أو عدد الحصص من 1 إلى 40." };
  }
  ws.addConditionalFormatting({ ref: `${L(C0)}${first}:${L(CN)}${last}`, rules: [
    { type: "expression", priority: 1, formulae: [`${L(C0)}${first}<>""`], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFF2CC" } } } },
  ] });

  // Footer: «ميزانية المعلمين» and the signatures.
  let f = last + 2;
  put(`A${f}:${lastL}${f}`, "ميزانية المعلمين", { bold: true, size: 12 });
  const q = Math.max(1, Math.floor((NOTE - 1) / 4)), spans = [[2, 1 + q], [2 + q, 1 + 2 * q], [2 + 2 * q, 1 + 3 * q], [2 + 3 * q, NOTE]];
  ["العدد المطلوب", "الموجود", "العجز", "ملاحظات"].forEach((h, i) => {
    const [a, b] = spans[i];
    ws.mergeCells(f + 1, a, f + 1, b); ws.mergeCells(f + 2, a, f + 2, b);
    const hc = ws.getCell(f + 1, a); hc.value = h; hc.font = { bold: true }; hc.alignment = center; hc.fill = fill("FFDBE9E1");
    for (const rr of [f + 1, f + 2]) for (let c = a; c <= b; c++) ws.getCell(rr, c).border = box;
    ws.getCell(f + 2, a).alignment = center;
  });
  const req = ws.getCell(f + 2, spans[0][0]); req.value = d.required ?? null; req.protection = { locked: false };
  ws.getCell(f + 2, spans[1][0]).value = { formula: `COUNTA(B${first}:B${last})` };
  ws.getCell(f + 2, spans[2][0]).value = { formula: `IF(${L(spans[0][0])}${f + 2}="","",${L(spans[0][0])}${f + 2}-${L(spans[1][0])}${f + 2})` };
  const fnote = ws.getCell(f + 2, spans[3][0]); fnote.value = d.note || null; fnote.protection = { locked: false };
  f += 4;
  put(`A${f}:D${f}`, "رئيس القسم", { bold: true, size: 12 });
  put(`${L(NOTE - 3)}${f}:${lastL}${f}`, "مدير المدرسة", { bold: true, size: 12 });
  put(`A${f + 1}:D${f + 1}`, head, { size: 12 });
  put(`A${f + 2}:D${f + 2}`, "التوقيع: ....................");
  put(`${L(NOTE - 3)}${f + 2}:${lastL}${f + 2}`, "التوقيع: ....................");

  ws.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true,
    margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 }, printArea: `A1:${lastL}${f + 2}` };
  await ws.protect("", { selectLockedCells: true, selectUnlockedCells: true });

  guide.getColumn(1).width = 110;
  [["طريقة تعبئة نموذج ميزانية القسم", true],
    ["1. لكل معلم سطر، ولكل مادة يدرّسها سطر. اسم المعلم ونصابه يُكتبان مرة واحدة.", false],
    ["2. المعلم الذي يدرّس مادة ثانية: اكتبها في السطر الذي تحته، واترك خانة الاسم فارغة.", false],
    ["3. في خانة الصف: ✓ تعني الحصص المعتادة لتلك المادة في ذلك الصف (ورقة «الحصص»)، أو اكتب عدد الحصص إن خالفها.", false],
    ["4. النصاب يُحسب وحده. اسم المعلم والمادة من القوائم المنسدلة. لا تغيّر أسماء الأوراق ولا العناوين.", false],
    ["5. ارفع الملف كما هو في الصفحة: «ميزانية القسم ← رفع Excel معبّأ» فتُملأ الميزانية آلياً.", false],
  ].forEach(([t, b], i) => { const c = guide.getCell(i + 1, 1); c.value = t; c.font = { bold: b, size: b ? 13 : 12 }; c.alignment = { horizontal: "right", readingOrder: "rtl", wrapText: true }; });
  await guide.protect("", {});

  return new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// Reading a filled form back into the editor's shape.
const cellText = (c) => {
  const v = c.isMerged && c.master ? c.master.value : c.value;
  if (v == null) return "";
  if (typeof v === "object") return v.richText ? v.richText.map((x) => x.text).join("") : v.result != null ? String(v.result) : v.text != null ? String(v.text) : "";
  return String(v).trim();
};
const classOf = (label) => { const k = String(label).replace(/[\s‏‎]/g, ""); return S.classes.classes.find((c) => compact(c) === k); };
async function readForm(file, dp, d) {
  await needExcel();
  const wb = new window.ExcelJS.Workbook();
  try { await wb.xlsx.load(await file.arrayBuffer()); } catch { throw "تعذّرت قراءة الملف: ليس ملف Excel سليماً"; }
  const meta = wb.getWorksheet("_منصة");
  if (!meta || cellText(meta.getCell("A1")) !== FORM_MARK) throw "هذا الملف ليس نموذج القسم. نزّل النموذج من زر «تنزيل Excel» ثم عبّئه.";
  const fdp = cellText(meta.getCell("B2"));
  if (fdp !== dp) throw "هذا نموذج قسم «" + fdp + "»، لا قسم «" + dp + "».";
  const ws = wb.getWorksheet("الميزانية");
  if (!ws) throw "ورقة «الميزانية» غير موجودة في الملف";
  let hr = 0;
  ws.eachRow((row, i) => { if (!hr && cellText(row.getCell(2)) === "المعلم") hr = i; });
  if (!hr) throw "لم أجد صف العناوين («المعلم») في ورقة «الميزانية»";
  const cols = [];
  let noteCol = 0;
  ws.getRow(hr).eachCell((c, i) => { const k = classOf(cellText(c)); if (k) cols.push([i, k]); if (cellText(c) === "ملاحظات") noteCol = i; });
  const multi = isMulti(dp), subs = formSubjects(dp, d), report = { unknown: [], bad: [], orphan: [], odd: 0 };
  const byName = (n) => deptStaff(dp).find((t) => t.name === n) || S.teachers.find((t) => t.name === n);
  const out = [], index = {};
  let cur = null, curKey = null;
  for (let i = hr + 1; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    if (cellText(row.getCell(1)) === "ميزانية المعلمين" || cellText(row.getCell(2)) === "ميزانية المعلمين") break;
    const nc = row.getCell(2), name = cellText(nc), key = nc.isMerged && nc.master ? nc.master.address : nc.address;
    const subjRaw = cellText(row.getCell(4)), subj = multi ? subjRaw : null;
    const marks = cols.map(([ci, c]) => [c, cellText(row.getCell(ci))]).filter((x) => x[1] !== "");
    const note = noteCol ? cellText(row.getCell(noteCol)) : "";
    if (!name && !marks.length && !subjRaw) continue;
    if (name && key !== curKey) {
      const hit = byName(name);
      if (!hit) report.unknown.push(name);
      const k = hit ? hit.uid : "n:" + name;
      cur = index[k] || (index[k] = { uid: hit ? hit.uid : "", name: hit ? hit.name : name, note: "", subjects: [], parts: {} });
      if (!out.includes(cur)) out.push(cur);
      curKey = key;
    } else if (!name && !(nc.isMerged && key === curKey) && !cur) {
      if (marks.length) report.orphan.push("السطر " + i);
      continue;
    }
    if (note && cur && !cur.note && note !== HEAD_NOTE) cur.note = note.replace(new RegExp("^" + HEAD_NOTE + " — "), "");
    if (!marks.length) { if (multi && subj && cur && !cur.subjects.includes(subj)) cur.subjects.push(subj); continue; }
    if (multi && !subs.includes(subj)) { report.bad.push("السطر " + i + ": المادة «" + (subjRaw || "فارغة") + "» ليست من مواد القسم"); continue; }
    if (multi && !cur.subjects.includes(subj)) cur.subjects.push(subj);
    for (const [c, v] of marks) {
      const def = defFor(d, dp, subj, c);
      let h = null;
      if (TICKS.includes(v)) h = def || null;
      else if (/^\d+(\.0+)?$/.test(v) && +v >= 0 && +v <= 40) h = Math.round(+v);
      if (!h) { report.bad.push("السطر " + i + "، " + compact(c) + ": «" + v + "»" + (TICKS.includes(v) ? " بلا حصص معتادة لهذا الصف" : " ليست ✓ ولا عدداً")); continue; }
      if (def !== null && h !== def) report.odd++;
      (cur.parts[c] = cur.parts[c] || []).push({ subj, h });
    }
  }
  const teachers = out.map((t) => {
    const x = { uid: t.uid, name: t.name, cells: {}, note: t.note, subjects: multi ? t.subjects : [], subj: {}, split: {} };
    for (const c of S.classes.classes) if (t.parts[c]) setParts(x, c, t.parts[c]);
    return x;
  });
  const dup = [...subjectDupes(dp, teachers)].map((k) => k.split("|")[0]);
  return { teachers, report: { ...report, dup: [...new Set(dup)] } };
}
function applyForm(parsed) {
  const E = S.edit;
  E.review = E.review || clone(E.data);
  E.data.teachers = parsed.teachers;
  renderPeriods(); renderTeachers();
  const rep = parsed.report, items = [];
  if (rep.unknown.length) items.push("أسماء ليست في قائمة معلمي القسم (قُبلت كما كُتبت): " + [...new Set(rep.unknown)].join("، "));
  if (rep.dup.length) items.push("مادة عند أكثر من معلم في: " + rep.dup.join("، "));
  if (rep.odd) items.push(rep.odd + " خانة تخالف الحصص المعتادة (تظهر حمراء)");
  if (rep.bad.length) items.push("أُهملت " + rep.bad.length + " قيمة: " + rep.bad.slice(0, 8).join(" · ") + (rep.bad.length > 8 ? " …" : ""));
  if (rep.orphan.length) items.push("أسطر فيها حصص بلا معلم فوقها (أُهملت): " + rep.orphan.join("، "));
  const ok = el("button", { className: "btn", type: "button", textContent: "اعتماد وحفظ" });
  const no = el("button", { className: "btn ghost", type: "button", textContent: "إلغاء" });
  const close = () => { E.ui.review.replaceChildren(); E.ui.review.hidden = true; };
  ok.onclick = () => { E.review = null; close(); changed(); };
  no.onclick = () => { E.data = E.review; E.review = null; E.dirty = false; close(); renderPeriods(); renderTeachers(); setMsg(E.ui.saveMsg, "أُلغي ما جاء من الملف"); };
  E.ui.review.replaceChildren(el("b", { textContent: "مُعبّأ من الملف — راجع ثم اضغط «اعتماد وحفظ». لم يُحفظ شيء بعد." }),
    items.length ? el("ul", {}, ...items.map((t) => el("li", { textContent: t }))) : el("div", { className: "meta", textContent: "لا ملاحظات على الملف." }),
    el("div", { className: "row" }, ok, no));
  E.ui.review.hidden = false;
  E.ui.review.scrollIntoView({ behavior: "smooth", block: "start" });
  setMsg(E.ui.saveMsg, "لم يُحفظ: راجع ثم اضغط «اعتماد وحفظ»", "err");
}

// PDF and image: the same form drawn as a page. `bare`: the on-screen
// preview — the table without the header and signatures.
// Its styles travel with it (FORM_CSS): the page drawn for PDF / image lives
// outside the sheet's shadow root, where html2canvas can read it.
const FORM_CSS = `
.dbf { width: 1400px; padding: 24px 28px; background: #fff; color: #000; font-family: "IBM Plex Sans Arabic", "Tajawal", Tahoma, sans-serif; direction: rtl; }
.dbf.bare { width: auto; min-width: 820px; padding: 8px; }
.dbf-head { display: flex; justify-content: space-between; align-items: flex-start; }
.dbf-side { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 15px; min-width: 300px; }
.dbf-logo { height: 62px; margin-bottom: 6px; }
.dbf-mid { text-align: center; padding-top: 18px; }
.dbf-title { font-size: 24px; font-weight: 800; }
.dbf-dept { font-size: 19px; margin-top: 6px; }
.dbf-line { border-bottom: 4px double #217346; margin: 10px 0 12px; }
.dbf-t { border-collapse: collapse; width: 100%; font-size: 14px; }
.dbf-t th, .dbf-t td { border: 1px solid #777; padding: 4px 3px; text-align: center; }
.dbf-t th { background: #dbe9e1; }
.dbf-n { text-align: right !important; font-weight: 700; white-space: nowrap; }
.dbf-s { font-weight: 700; background: #eef6f1; }
.dbf-on { background: #fff2cc; }
.dbf-note { font-size: 12px; text-align: right !important; }
.dbf-cap { text-align: center; font-weight: 800; font-size: 16px; margin: 16px 0 6px; }
.dbf-sum { width: 70%; margin: 0 auto; }
.dbf-sign { display: flex; justify-content: space-between; margin: 22px 80px 4px; text-align: center; font-size: 16px; line-height: 2; }
.dbf-host { position: fixed; left: -10000px; top: 0; }
`;
function formPage(dp, d, bare) {
  const multi = isMulti(dp), classes = S.classes.classes, rows = formRows(dp, d), year = academicYear();
  const th = (t) => el("th", { textContent: t });
  const table = el("table", { className: "dbf-t" },
    el("thead", {}, el("tr", {}, ...["م", "المعلم", "النصاب", "المادة", ...classes.map(compact), "ملاحظات"].map(th))),
    el("tbody", {}, ...rows.flatMap((t, i) => t.lines.map((line, j) => {
      const total = t.lines.reduce((a, l) => a + Object.values(l.cells).reduce((x, y) => x + y, 0), 0);
      const tr = el("tr");
      if (j === 0) tr.append(el("td", { rowSpan: t.lines.length, textContent: i + 1 }), el("td", { rowSpan: t.lines.length, className: "dbf-n", textContent: t.name }), el("td", { rowSpan: t.lines.length, className: "dbf-s", textContent: total }));
      tr.append(el("td", { textContent: line.subj || "" }));
      classes.forEach((c) => { const v = cellMark(d, dp, multi ? line.subj : dp, c, line.cells[c]); tr.append(el("td", { className: v !== "" ? "dbf-on" : "", textContent: v })); });
      if (j === 0) tr.append(el("td", { rowSpan: t.lines.length, className: "dbf-note", textContent: withHeadNote(dp, t.name, t.note) }));
      return tr;
    }))));
  const have = rows.length, req = d.required;
  const sums = [el("div", { className: "dbf-cap", textContent: "ميزانية المعلمين" }),
    el("table", { className: "dbf-t dbf-sum" }, el("tr", {}, ...["العدد المطلوب", "الموجود", "العجز", "ملاحظات"].map(th)),
      el("tr", {}, el("td", { textContent: req ?? "" }), el("td", { textContent: have }), el("td", { textContent: req == null ? "" : req - have }), el("td", { className: "dbf-note", textContent: d.note || "" })))];
  if (bare) return el("div", { className: "dbf bare" }, table, ...sums);
  return el("div", { className: "dbf" },
    el("div", { className: "dbf-head" },
      el("div", { className: "dbf-side" }, el("b", { textContent: "وزارة التربية" }), el("span", { textContent: SCHOOL_NAME })),
      el("div", { className: "dbf-mid" }, el("div", { className: "dbf-title", textContent: "ميزانية الأقسام العلمية للعام الدراسي " + year }), el("div", { className: "dbf-dept", textContent: "القسم العلمي / " + dp })),
      el("div", { className: "dbf-side" }, el("img", { src: SCHOOL_LOGO, className: "dbf-logo", alt: "" }), el("span", { textContent: "العام الدراسي " + year }))),
    el("div", { className: "dbf-line" }), table, ...sums,
    el("div", { className: "dbf-sign" },
      el("div", {}, el("b", { textContent: "رئيس القسم" }), el("div", { textContent: headOf(dp) || " " }), el("div", { textContent: "التوقيع: ...................." })),
      el("div", {}, el("b", { textContent: "مدير المدرسة" }), el("div", { textContent: " " }), el("div", { textContent: "التوقيع: ...................." }))));
}
async function formCanvas(dp, d) {
  await needCanvas();
  const page = formPage(dp, d, false);
  const host = el("div", { className: "dbf-host" }, el("style", { textContent: FORM_CSS }), page);
  document.body.append(host);
  try {
    await Promise.all([...page.querySelectorAll("img")].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })));
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    return await window.html2canvas(page, { scale: 2, backgroundColor: "#ffffff" });
  } finally { host.remove(); }
}
