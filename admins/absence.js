// تدقيق في الغائب — the sheet adminpage.html opens from "تدقيق في الغائب" (in
// the الغياب popup) and from the sidebar's "تدقيق في الغائب". This used to be
// the standalone page admins/absence.html; its markup, styles
// (/admins/absence.css) and logic are unchanged apart from what living
// inside another page requires, each noted where it happens. Built the same
// way as the غياب اليوم sheet (/admins/newabsence.js).
//
// It renders into a shadow root on the host element it's given, so its ids
// and classes can't collide with adminpage.html's own. That's also why its
// DOM lookups go through `sheetDoc` (the shadow root) instead of `document`.
import { firebaseConfig } from "/shared/firebase.js";
import { initializeApp, getApp, getApps } from "/shared/firebase.js";
import {
  getFirestore, collection, collectionGroup, getDocs, query, where,
  doc, getDoc
} from "/shared/firebase.js";
import { kuwaitTodayISO } from "/shared/kuwait-time.js";
import { fetchClassList, groupByGrade, sortClassList } from "/shared/class-registry.js";

const CSS_URL = new URL("./absence.css", import.meta.url).href;

const MARKUP = `
  <header class="site-header">
    <div class="header-actions">
      <button class="icon-btn ghost" id="menuBtn" title="القائمة" aria-label="فتح القائمة">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
          <path d="M4 6h16M4 12h16M4 18h16"/>
        </svg>
      </button>
    </div>
    <h1 class="site-title">تدقيق الغياب</h1>
    <div class="header-actions">
      <button class="icon-btn" id="refreshView" title="تحديث">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
      </button>
      <button class="icon-btn" id="exportData" title="تصدير تقرير">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
        </svg>
      </button>
    </div>
  </header>

  <!-- Export Modal -->
  <div class="export-modal" id="exportModal">
    <div class="export-modal-content">
      <div class="export-modal-header">
        <h3 class="export-modal-title">تصدير تقرير غياب مفصّل</h3>
        <button class="close-export-modal" id="closeExportModal">&times;</button>
      </div>
      <div class="export-option-group">
        <label class="export-label">اختر الصف:</label>
        <select class="export-select" id="exportGradeSelect">
          <option value="all">كل الصفوف</option>
          <option value="10">الصف العاشر</option>
          <option value="11">الصف الحادي عشر</option>
          <option value="12">الصف الثاني عشر</option>
        </select>
      </div>
      <div class="export-option-group">
        <label class="export-label">اختر الفترة:</label>
        <select class="export-select" id="exportPeriodSelect">
          <option value="today">اليوم</option>
          <option value="thisWeek">هذا الأسبوع</option>
          <option value="thisMonth">هذا الشهر</option>
        </select>
      </div>
      <div class="export-actions">
        <button class="export-btn ghost" id="cancelExport">إلغاء</button>
        <button class="export-btn primary" id="generatePDF">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
          </svg>
          <span>تحميل PDF</span>
        </button>
      </div>
      <div class="export-loading" id="exportLoading">
        <div class="spinner"></div>
        <span>جاري إنشاء التقرير...</span>
      </div>
    </div>
  </div>

  <main>
    <div class="container">
      <div id="stateLoading" class="state active panel">
        <div class="loading">
          <div class="spinner"></div>
          <div class="muted">جاري التحقق من تسجيل الدخول والصلاحيات…</div>
        </div>
      </div>

      <div id="stateNotLogged" class="state panel">
        <div class="msg error">يرجى تسجيل الدخول قبل الاستخدام.</div>
        <p class="muted" style="text-align:center; margin:8px 0 0;">لا توجد جلسة نشطة. <a href="/index.html">اذهب لصفحة الدخول</a>.</p>
      </div>

      <div id="stateDenied" class="state panel">
        <div class="msg error">تم رفض الوصول — هذه الصفحة مخصّصة للمشرفين فقط.</div>
      </div>

      <section id="stateHome" class="state panel" aria-label="الغياب">
        <div class="stats-card" id="homeStatsCard" style="margin-bottom:18px;">
          <div class="stats-header">
            <div class="stats-title">نظرة عامة على كل المدرسة</div>
          </div>
          <div class="muted" id="homeStatsRange" style="font-size:.82rem; font-weight:700; margin-top:-6px;">—</div>
          <div class="filters-bar stats-filter-row" id="homeStatsFilterBar">
            <button class="filter-chip active" data-stats-filter="today" type="button">اليوم</button>
            <button class="filter-chip" data-stats-filter="thisWeek" type="button">هذا الأسبوع</button>
            <button class="filter-chip" data-stats-filter="thisMonth" type="button">هذا الشهر</button>
            <button class="filter-chip" data-stats-filter="thisYear" type="button">السنة الدراسية</button>
          </div>
          <div class="stats-grid" id="homeStatsGrid"></div>
        </div>
        <div class="center" style="text-align:center; display:flex; flex-direction:column; gap:8px;">
          <div style="font-size:1.18rem; font-weight:900; color:var(--primary);">تدقيق الغياب</div>
          <div class="muted" style="font-size:.92rem;">اختر الصف لاستعراض سجلات الغياب والتأخير والحضور بالتفصيل</div>
        </div>
        <div class="stack" style="margin-top:12px;">
          <button class="btn primary" data-scope-all="1" type="button">كل الصفوف</button>
          <button class="btn ghost" data-grade="10" type="button">الصف العاشر</button>
          <button class="btn ghost" data-grade="11" type="button">الصف الحادي عشر</button>
          <button class="btn ghost" data-grade="12" type="button">الصف الثاني عشر</button>
        </div>
      </section>
    </div>
  </main>

  <!-- CLASSES SHEET -->
  <section id="classesSheet" class="sheet" aria-hidden="true" inert>
    <div class="sheet-header">
      <button id="closeClasses" class="back-btn" aria-label="رجوع">رجوع</button>
      <h3 id="classesTitle" class="sheet-title">—</h3>
    </div>
    <div class="sheet-body">
      <div class="stats-card" id="gradeStatsCard">
        <div class="stats-header">
          <div class="stats-title" id="gradeStatsTitle">إحصائيات الصف</div>
        </div>
        <div class="muted" id="gradeStatsRange" style="font-size:.82rem; font-weight:700; margin-top:-6px;">—</div>
        <div class="filters-bar stats-filter-row" id="gradeStatsFilterBar">
          <button class="filter-chip active" data-stats-filter="today" type="button">اليوم</button>
          <button class="filter-chip" data-stats-filter="thisWeek" type="button">هذا الأسبوع</button>
          <button class="filter-chip" data-stats-filter="thisMonth" type="button">هذا الشهر</button>
          <button class="filter-chip" data-stats-filter="thisYear" type="button">السنة الدراسية</button>
        </div>
        <div class="stats-grid" id="gradeStatsGrid"></div>
      </div>
      <div id="classesList" class="list"></div>
    </div>
  </section>

  <!-- CLASS / GRADE / ALL ATTENDANCE SHEET -->
  <section id="absencesSheet" class="sheet" aria-hidden="true" inert>
    <div class="sheet-header">
      <button id="closeAbsences" class="back-btn" aria-label="رجوع">رجوع</button>
      <h3 id="absencesTitle" class="sheet-title">—</h3>
    </div>
    <div class="sheet-body">
      <div class="mini-stats" id="miniStats">
        <div class="mini-stat present"><div class="mini-num" id="miniPresent">٠</div><div class="mini-label">حضور</div></div>
        <div class="mini-stat absent"><div class="mini-num" id="miniAbsent">٠</div><div class="mini-label">غياب</div></div>
        <div class="mini-stat late"><div class="mini-num" id="miniLate">٠</div><div class="mini-label">تأخير</div></div>
      </div>
      <div class="status-toggle" id="statusToggle">
        <button class="status-btn active absent" data-status="absent" type="button">الغياب</button>
        <button class="status-btn late" data-status="late" type="button">التأخير</button>
        <button class="status-btn present" data-status="present" type="button">الحضور</button>
      </div>
      <div class="lesson-filter" id="lessonFilterBar">
        <button class="lesson-chip active" data-lesson="__all" type="button">كل الحصص</button>
        <button class="lesson-chip" data-lesson="1" type="button">١</button>
        <button class="lesson-chip" data-lesson="2" type="button">٢</button>
        <button class="lesson-chip" data-lesson="3" type="button">٣</button>
        <button class="lesson-chip" data-lesson="4" type="button">٤</button>
        <button class="lesson-chip" data-lesson="5" type="button">٥</button>
        <button class="lesson-chip" data-lesson="6" type="button">٦</button>
        <button class="lesson-chip" data-lesson="7" type="button">٧</button>
      </div>
      <div class="filters-bar" id="filtersBar">
        <button class="filter-chip active" data-filter="today"      type="button">اليوم</button>
        <button class="filter-chip"        data-filter="thisWeek"   type="button">هذا الأسبوع</button>
        <button class="filter-chip"        data-filter="lastWeek"   type="button">الأسبوع الماضي</button>
        <button class="filter-chip"        data-filter="thisMonth"  type="button">هذا الشهر</button>
        <button class="filter-chip"        data-filter="lastMonth"  type="button">الشهر الماضي</button>
        <button class="filter-chip"        data-filter="thisYear"   type="button">السنة الدراسية</button>
        <button class="filter-chip"        data-filter="custom"     type="button">تاريخ مخصّص</button>
      </div>
      <div class="date-range" id="dateRange">
        <label class="date-label" for="startDate">من:</label>
        <input type="date" id="startDate" class="date-input" />
        <label class="date-label" for="endDate">إلى:</label>
        <input type="date" id="endDate" class="date-input" />
        <div class="date-actions">
          <button class="apply-btn primary" id="applyRange" type="button">تطبيق</button>
          <button class="clear-btn" id="clearRange" type="button">مسح</button>
        </div>
      </div>
      <div class="classes-filter" id="classesFilterBar"></div>
      <div class="row" style="justify-content:space-between; align-items:center;">
        <div class="muted" id="absMeta" style="font-weight:800;">—</div>
        <span id="absCount" class="badge b-absent">0 حالة</span>
      </div>
      <div id="absencesList" class="list"></div>
      <button id="loadMore" class="back-btn" type="button" hidden>عرض المزيد من السجلات</button>
    </div>
  </section>

`;

/**
 * Renders the sheet into `host` and starts loading the school overview.
 *
 * hooks:
 *   close()       — close the sheet
 *   openSidebar() — menu button: open adminpage.html's sidebar
 *   getSession()  — { user, data, classList } the page already resolved
 */
export async function mountDetailedAbsenceSheet(host, hooks) {
  // Fetched rather than <link>ed so the markup never paints unstyled — and
  // before attachShadow(), since a host can only ever get one shadow root:
  // if this fails, the caller can simply try again.
  const res = await fetch(CSS_URL);
  if (!res.ok) throw new Error(`absence.css: HTTP ${res.status}`);
  const cssText = await res.text();
  const sheetDoc = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = cssText;
  const tpl = document.createElement("template");
  tpl.innerHTML = MARKUP;
  sheetDoc.append(style, tpl.content);

  // adminpage.html has already initialized Firestore for this app, and
  // Firestore allows initializeFirestore() only once per app — a second
  // call throws — so this just takes the existing instance.
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const db = getFirestore(app);

  // UI refs
  const sLoading = sheetDoc.getElementById('stateLoading');
  const sNotLog  = sheetDoc.getElementById('stateNotLogged');
  const sDenied  = sheetDoc.getElementById('stateDenied');
  const sHome    = sheetDoc.getElementById('stateHome');
  const menuBtn = sheetDoc.getElementById('menuBtn');
  const refreshView = sheetDoc.getElementById('refreshView');
  const exportData = sheetDoc.getElementById('exportData');
  const exportModal = sheetDoc.getElementById('exportModal');
  const closeExportModal = sheetDoc.getElementById('closeExportModal');
  const cancelExport = sheetDoc.getElementById('cancelExport');
  const generatePDF = sheetDoc.getElementById('generatePDF');
  const exportGradeSelect = sheetDoc.getElementById('exportGradeSelect');
  const exportPeriodSelect = sheetDoc.getElementById('exportPeriodSelect');
  const exportLoading = sheetDoc.getElementById('exportLoading');
  const classesSheet = sheetDoc.getElementById('classesSheet');
  const closeClasses = sheetDoc.getElementById('closeClasses');
  const classesTitle = sheetDoc.getElementById('classesTitle');
  const classesList = sheetDoc.getElementById('classesList');
  const absencesSheet = sheetDoc.getElementById('absencesSheet');
  const closeAbsences = sheetDoc.getElementById('closeAbsences');
  const absencesTitle = sheetDoc.getElementById('absencesTitle');
  const absMeta = sheetDoc.getElementById('absMeta');
  const absCount = sheetDoc.getElementById('absCount');
  const absencesList = sheetDoc.getElementById('absencesList');
  const statusToggle = sheetDoc.getElementById('statusToggle');
  const lessonFilterBar = sheetDoc.getElementById('lessonFilterBar');
  const filtersBar = sheetDoc.getElementById('filtersBar');
  const dateRangeBox = sheetDoc.getElementById('dateRange');
  const startDateEl = sheetDoc.getElementById('startDate');
  const endDateEl = sheetDoc.getElementById('endDate');
  const applyRangeBtn = sheetDoc.getElementById('applyRange');
  const clearRangeBtn = sheetDoc.getElementById('clearRange');
  const classesFilterBar = sheetDoc.getElementById('classesFilterBar');
  const homeStatsFilterBar = sheetDoc.getElementById('homeStatsFilterBar');
  const homeStatsGrid = sheetDoc.getElementById('homeStatsGrid');
  const homeStatsRange = sheetDoc.getElementById('homeStatsRange');
  const gradeStatsFilterBar = sheetDoc.getElementById('gradeStatsFilterBar');
  const gradeStatsGrid = sheetDoc.getElementById('gradeStatsGrid');
  const gradeStatsRange = sheetDoc.getElementById('gradeStatsRange');
  const gradeStatsTitle = sheetDoc.getElementById('gradeStatsTitle');
  const miniPresent = sheetDoc.getElementById('miniPresent');
  const miniAbsent = sheetDoc.getElementById('miniAbsent');
  const miniLate = sheetDoc.getElementById('miniLate');

  // Where the back button used to be: opens adminpage.html's sidebar,
  // which sits above the sheet and can switch to any other section.
  menuBtn.addEventListener('click', () => hooks.openSidebar());

  // State variables
  let selectedGrade = null;
  let currentScope = null;      // {type:'class', className} | {type:'grade', grade} | {type:'all'}
  let statusFilter = 'absent';
  let lessonFilter = '__all';
  let classFilter = '__all';
  let timeFilter = 'today';
  let customStart = null, customEnd = null; // ISO date strings ('YYYY-MM-DD')
  let cachedStudents = [];
  let cachedRows = [];
  let statsTimeFilter = 'today'; // shared by the home + grade stats cards
  let homeStatsRequestId = 0, gradeStatsRequestId = 0;
  let recordsRequestId = 0, recordsLoading = false, visibleLimit = 40; // guards against a slow fetch overwriting a newer one

  // Helper functions
  const show = (el) => {
    [sLoading, sNotLog, sDenied, sHome].forEach(x => x.classList.remove('active'));
    el.classList.add('active');
  };
  const openSheet = (el) => {
    el.classList.add('open');
    el.inert = false;
    el.setAttribute('aria-hidden', 'false');
  };
  const closeSheet = (el) => {
    el.classList.remove('open');
    // Closing a sheet is nearly always a click on a button inside it, so that
    // button still holds focus here. aria-hidden on an ancestor of the focused
    // element is invalid and Chrome refuses it, so release focus first.
    // Inside a shadow root, document.activeElement is the host itself;
    // the shadow root's own activeElement is the real focused element.
    if (el && el.contains(sheetDoc.activeElement)) sheetDoc.activeElement.blur();
    el.setAttribute('aria-hidden', 'true');
    el.inert = true;
  };
  const toArabicDigits = (str) => (str ?? "").toString().replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
  const arabicSort = (a, b) => (a || "").toString().localeCompare((b || "").toString(), 'ar', { sensitivity: 'base' });
  const fmtDate = (d) => new Intl.DateTimeFormat('ar-KW', { dateStyle: 'medium', timeZone: 'Asia/Kuwait' }).format(d);
  const fmtDT = (d) => new Intl.DateTimeFormat('ar-KW', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuwait' }).format(d);
  function tsToDate(v) {
    if (!v) return null;
    if (v.toDate) return v.toDate();
    if (v.seconds) return new Date(v.seconds * 1000);
    return null;
  }
  function parseAttendanceDate(r) {
    if (r?.date && /^\d{4}-\d{2}-\d{2}/.test(r.date)) {
      const [y, m, d] = r.date.split('-').map(n => +n);
      return new Date(y, m - 1, d);
    }
    if (r?.updatedAt) return tsToDate(r.updatedAt);
    return null;
  }

  // Concurrency-limited promise pool — avoids firing hundreds of parallel
  // Firestore reads at once when a scope covers many students.
  async function promisePool(items, worker, concurrency = 15) {
    const results = [];
    let i = 0;
    const runners = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await worker(items[idx], idx);
      }
    });
    await Promise.all(runners);
    return results;
  }

  // Calendar-date range helpers — every filter resolves to a plain
  // 'YYYY-MM-DD' start/end pair, matching the string 'date' field every
  // attendance record is actually written with (never a Timestamp), so
  // the range can be applied server-side instead of pulling everything
  // ever recorded and filtering client-side.
  function toISODateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
  }
  function startOfWeek(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - x.getDay()); return x; }
  function endOfWeek(d) { const s = startOfWeek(d); const e = new Date(s); e.setDate(s.getDate() + 6); return e; }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
  function startOfYear(d) { return new Date(d.getFullYear(), 0, 1); }
  function endOfYear(d) { return new Date(d.getFullYear(), 11, 31); }
  function lastWeekRange(d) { const e = new Date(startOfWeek(d)); e.setDate(e.getDate() - 1); return { start: startOfWeek(e), end: e }; }
  function lastMonthRange(d) { const e = new Date(startOfMonth(d)); e.setDate(e.getDate() - 1); return { start: startOfMonth(e), end: e }; }

  function rangeForFilter(key) {
    const now = new Date(kuwaitTodayISO() + 'T12:00:00');
    switch (key) {
      case 'today': { const s = toISODateStr(now); return { startISO: s, endISO: s }; }
      case 'thisWeek': return { startISO: toISODateStr(startOfWeek(now)), endISO: toISODateStr(endOfWeek(now)) };
      case 'lastWeek': { const r = lastWeekRange(now); return { startISO: toISODateStr(r.start), endISO: toISODateStr(r.end) }; }
      case 'thisMonth': return { startISO: toISODateStr(startOfMonth(now)), endISO: toISODateStr(endOfMonth(now)) };
      case 'lastMonth': { const r = lastMonthRange(now); return { startISO: toISODateStr(r.start), endISO: toISODateStr(r.end) }; }
      case 'thisYear': return { startISO: '2026-09-14', endISO: '2027-01-13' };
      case 'custom': return { startISO: customStart || toISODateStr(now), endISO: customEnd || toISODateStr(now) };
      default: { const s = toISODateStr(now); return { startISO: s, endISO: s }; }
    }
  }

  // Classes — populated from the class list adminpage.html hands over
  // below, before show(sHome)/loadHomeStats(); every consumer here
  // (groupForGrade, classesForScope) only ever runs from a later user
  // interaction, so nothing races these empty initial values.
  let GROUP_10 = [], GROUP_11 = [], GROUP_12 = [], ALL_CLASSES_SORTED = [];
  function groupForGrade(g) {
    return g === 10 ? GROUP_10 : g === 11 ? GROUP_11 : GROUP_12;
  }
  function classesForScope(scope) {
    if (scope.type === 'class') return [scope.className];
    if (scope.type === 'grade') return groupForGrade(scope.grade);
    return ALL_CLASSES_SORTED;
  }

  // Cache teacher names
  const teacherNameCache = new Map();
  async function getTeacherName(uid) {
    if (!uid) return "—";
    if (teacherNameCache.has(uid)) return teacherNameCache.get(uid);
    try {
      const s = await getDoc(doc(db, 'teachers', uid));
      const name = s.exists() ? (s.data().name || uid) : uid;
      teacherNameCache.set(uid, name);
      return name;
    } catch { return uid; }
  }

  // Fetch students for a scope (single query for a class; pooled queries
  // per-class for a grade; one unfiltered read for the whole school).
  async function fetchStudentsForScope(scope) {
    if (scope.type === 'class') {
      const snap = await getDocs(query(collection(db, 'students'), where('class', '==', scope.className)));
      const list = []; snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      return list;
    }
    if (scope.type === 'grade') {
      const classes = groupForGrade(scope.grade);
      const lists = await promisePool(classes, async (cn) => {
        const snap = await getDocs(query(collection(db, 'students'), where('class', '==', cn)));
        const list = []; snap.forEach(d => list.push({ id: d.id, ...d.data() }));
        return list;
      }, 10);
      return lists.flat();
    }
    const snap = await getDocs(collection(db, 'students'));
    const list = []; snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    return list;
  }

  // Fetch attendance records for a scope, bounded to a date range.
  //
  // This used to fire one students/{uid}/attendance query PER STUDENT
  // (pooled 15 at a time) — for the whole-school scope that's 400+ round
  // trips, which is what made this page "WAYYY too slow". Every mirror
  // record already carries its own 'class', 'date' and 'studentName'
  // fields (see shared/attendance.js's mirror writes), so a
  // collectionGroup('attendance') query can answer the same question in
  // one query (whole-school) or one query per class (class/grade scope)
  // without ever joining back to the students collection. This relies on
  // a composite index (class, date) on the 'attendance' collection group
  // — see firestore.indexes.json.
  async function fetchAttendanceRowsForScope(scope, startISO, endISO) {
    const base = collectionGroup(db, 'attendance');
    const dateRange = (q) => query(q, where('date', '>=', startISO), where('date', '<=', endISO));
    const rows = [];
    const consume = (snap) => {
      snap.forEach(docSnap => {
        const data = docSnap.data();
        const r = { id: docSnap.id, ...data };
        r._studentId = docSnap.ref.parent.parent ? docSnap.ref.parent.parent.id : null;
        r._student = { id: r._studentId, name: r.studentName || '—' };
        rows.push(r);
      });
    };

    if (scope.type === 'all') {
      consume(await getDocs(dateRange(base)));
      return rows;
    }
    if (scope.type === 'class') {
      consume(await getDocs(dateRange(query(base, where('class', '==', scope.className)))));
      return rows;
    }
    // Grade scope: 'in' supports at most 30 values, so chunk defensively.
    const classes = groupForGrade(scope.grade);
    const chunks = [];
    for (let i = 0; i < classes.length; i += 30) chunks.push(classes.slice(i, i + 30));
    await promisePool(chunks, async (chunk) => {
      consume(await getDocs(dateRange(query(base, where('class', 'in', chunk)))));
    }, 5);
    return rows;
  }

  // Reuse in-flight reads and recent school results across views, in memory only.
  const dataCache = new Map();
  function cachedRead(key, read) {
    const hit = dataCache.get(key);
    if (hit && hit.expires > Date.now()) return hit.promise;
    const entry = { expires: Date.now() + 60000 };
    entry.promise = Promise.resolve().then(read).catch(error => {
      if (dataCache.get(key) === entry) dataCache.delete(key);
      throw error;
    });
    dataCache.set(key, entry);
    if (dataCache.size > 16) dataCache.delete(dataCache.keys().next().value);
    return entry.promise;
  }
  async function fetchAttendanceForScope(scope, startISO, endISO) {
    const schoolKey = 'rows:all:' + startISO + ':' + endISO;
    const schoolRows = dataCache.get(schoolKey);
    const useSchool = scope.type === 'all' || (schoolRows && schoolRows.expires > Date.now());
    const [roster, records] = await Promise.all([
      cachedRead('students', () => fetchStudentsForScope({ type: 'all' })),
      cachedRead(useSchool ? schoolKey : JSON.stringify(scope) + startISO + endISO,
        () => fetchAttendanceRowsForScope(useSchool ? { type: 'all' } : scope, startISO, endISO)),
    ]);
    const classes = new Set(classesForScope(scope));
    const matches = item => scope.type === 'all' || classes.has(item.class);
    return { students: roster.filter(matches).sort((a, b) => arabicSort(a.name, b.name)), rows: records.filter(matches) };
  }

  // A student marked absent in ANY lesson on a given day is absent for
  // that whole day — matching /admins/students.html's own absenceDays
  // grouping (shared/attendance-tiles.js#groupAbsencesByDay), generalized
  // here to every student in scope. Per-lesson records are never counted
  // as separate absences/presences; they're kept on `records` so the UI
  // can still show exactly which lessons made up that day's status.
  //
  // The three flags below are independent, not a single exclusive status:
  // a day can be both "late" (a تأخير lesson) and still count toward
  // حضور — being late still means the student showed up. The only thing
  // that zeroes out the present count for a day is an actual absence.
  function groupRowsByStudentDay(rows) {
    const days = new Map();
    for (const r of rows) {
      const sid = r._studentId || '?';
      const date = String(r.date || '').slice(0, 10);
      const key = `${sid}__${date}`;
      if (!days.has(key)) {
        days.set(key, { studentId: sid, date, class: r.class, _student: r._student, records: [] });
      }
      days.get(key).records.push(r);
    }
    return [...days.values()].map(day => {
      const statuses = new Set(day.records.map(r => r.status));
      day.hasAbsent = statuses.has('absent');
      day.hasLate = statuses.has('late');
      day.countsPresent = !day.hasAbsent && (statuses.has('present') || statuses.has('late'));
      return day;
    });
  }

  // ---------- Stats cards (home overview + per-grade) ----------
  function computeStats(students, rows) {
    const days = groupRowsByStudentDay(rows);
    const present = days.filter(d => d.countsPresent).length;
    const absent = days.filter(d => d.hasAbsent).length;
    const late = days.filter(d => d.hasLate).length;
    const recorded = days.length;
    const rate = recorded ? Math.round((present / recorded) * 100) : 0;
    return { total: students.length, present, absent, late, rate };
  }

  function renderStatCards(grid, stats) {
    grid.innerHTML = `
      <div class="stat-card"><div class="stat-num">${toArabicDigits(stats.total)}</div><div class="stat-label">الطلاب</div></div>
      <div class="stat-card present"><div class="stat-num">${toArabicDigits(stats.present)}</div><div class="stat-label">حضور</div></div>
      <div class="stat-card absent"><div class="stat-num">${toArabicDigits(stats.absent)}</div><div class="stat-label">غياب</div></div>
      <div class="stat-card late"><div class="stat-num">${toArabicDigits(stats.late)}</div><div class="stat-label">تأخير</div></div>
      <div class="stat-card rate"><div class="stat-num">${toArabicDigits(stats.rate)}٪</div><div class="stat-label">نسبة الحضور</div></div>
    `;
  }

  function renderStatsLoading(grid) {
    grid.innerHTML = `
      <div class="stat-card"><div class="stat-num">…</div><div class="stat-label">الطلاب</div></div>
      <div class="stat-card present"><div class="stat-num">…</div><div class="stat-label">حضور</div></div>
      <div class="stat-card absent"><div class="stat-num">…</div><div class="stat-label">غياب</div></div>
      <div class="stat-card late"><div class="stat-num">…</div><div class="stat-label">تأخير</div></div>
      <div class="stat-card rate"><div class="stat-num">…</div><div class="stat-label">نسبة الحضور</div></div>
    `;
  }

  // Makes the exact period a stats card is summing unambiguous — a wide
  // range legitimately adds up one حضور/غياب/تأخير per student per school
  // day, so it can look "too big" next to the total student count unless
  // it's clear how many days are actually being summed.
  function describeRange(startISO, endISO) {
    if (startISO === endISO) return `يوم واحد: ${toArabicDigits(startISO)}`;
    return `من ${toArabicDigits(startISO)} إلى ${toArabicDigits(endISO)}`;
  }

  async function loadHomeStats() {
    const myRequestId = ++homeStatsRequestId;
    renderStatsLoading(homeStatsGrid);
    const { startISO, endISO } = rangeForFilter(statsTimeFilter);
    homeStatsRange.textContent = describeRange(startISO, endISO);
    try {
      const { students, rows } = await fetchAttendanceForScope({ type: 'all' }, startISO, endISO);
      if (myRequestId !== homeStatsRequestId) return; // a newer request/filter change superseded this one
      renderStatCards(homeStatsGrid, computeStats(students, rows));
    } catch (e) {
      console.error('[absence] home stats failed', e);
      if (myRequestId === homeStatsRequestId) homeStatsGrid.innerHTML = `<div class="muted">تعذّر تحميل الإحصائيات.</div>`;
    }
  }

  async function loadGradeStats(grade) {
    const titleMap = { 10: 'الصف العاشر', 11: 'الصف الحادي عشر', 12: 'الصف الثاني عشر' };
    gradeStatsTitle.textContent = `إحصائيات ${titleMap[grade]}`;
    const myRequestId = ++gradeStatsRequestId;
    renderStatsLoading(gradeStatsGrid);
    const { startISO, endISO } = rangeForFilter(statsTimeFilter);
    gradeStatsRange.textContent = describeRange(startISO, endISO);
    try {
      const { students, rows } = await fetchAttendanceForScope({ type: 'grade', grade }, startISO, endISO);
      if (myRequestId !== gradeStatsRequestId) return;
      renderStatCards(gradeStatsGrid, computeStats(students, rows));
    } catch (e) {
      console.error('[absence] grade stats failed', e);
      if (myRequestId === gradeStatsRequestId) gradeStatsGrid.innerHTML = `<div class="muted">تعذّر تحميل الإحصائيات.</div>`;
    }
  }

  // Both stats cards share one time filter — picking a period in either
  // updates both chip rows and refreshes whichever card(s) are visible.
  function setStatsTimeFilter(key) {
    statsTimeFilter = key;
    sheetDoc.querySelectorAll('.stats-filter-row .filter-chip').forEach(c => c.classList.toggle('active', c.dataset.statsFilter === key));
    if (sHome.classList.contains('active')) loadHomeStats();
    if (classesSheet.classList.contains('open')) loadGradeStats(selectedGrade);
  }
  homeStatsFilterBar.addEventListener('click', (e) => {
    const b = e.target.closest('.filter-chip');
    if (!b) return;
    setStatsTimeFilter(b.dataset.statsFilter);
  });
  gradeStatsFilterBar.addEventListener('click', (e) => {
    const b = e.target.closest('.filter-chip');
    if (!b) return;
    setStatsTimeFilter(b.dataset.statsFilter);
  });

  // adminpage.html has already signed the user in, checked the admin role
  // and read the class list before it can open this sheet, and hands all
  // three over — so this goes straight to the overview instead of waiting
  // on another auth round and re-reading teachers/{uid} and settings/classes.
  (async () => {
    const { user, data, classList } = hooks.getSession() || {};
    if (!user) { show(sNotLog); return; }
    if ((data?.role || '').toString().toLowerCase() !== 'admin') { show(sDenied); return; }
    try {
      const list = classList || await fetchClassList(db);
      const grouped = groupByGrade(list);
      GROUP_10 = grouped['10']; GROUP_11 = grouped['11']; GROUP_12 = grouped['12'];
      ALL_CLASSES_SORTED = sortClassList(list);
      show(sHome);
      loadHomeStats();
    } catch (e) {
      console.error(e);
      show(sDenied);
    }
  })();

  // Home: grade picker
  sheetDoc.querySelectorAll('#stateHome .btn[data-grade]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedGrade = +btn.dataset.grade;
      const titleMap = { 10: 'الصف العاشر', 11: 'الصف الحادي عشر', 12: 'الصف الثاني عشر' };
      classesTitle.textContent = titleMap[selectedGrade];
      renderClassesForGrade(selectedGrade);
      openSheet(classesSheet);
      loadGradeStats(selectedGrade);
    });
  });
  sheetDoc.querySelector('#stateHome .btn[data-scope-all]').addEventListener('click', () => {
    absencesTitle.textContent = 'كل الصفوف';
    prepareViewAndFetch({ type: 'all' });
  });
  closeClasses.addEventListener('click', () => closeSheet(classesSheet));

  function renderClassesForGrade(g) {
    classesList.innerHTML = '';
    const list = groupForGrade(g);
    const titleMap = { 10: 'الصف العاشر', 11: 'الصف الحادي عشر', 12: 'الصف الثاني عشر' };
    const allEl = document.createElement('div');
    allEl.className = 'item all-sep';
    allEl.innerHTML = `
      <div><div>الكل</div><div class="sub">عرض جميع فصول ${titleMap[g]}</div></div>
      <svg class="chev" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>
    `;
    allEl.addEventListener('click', () => {
      absencesTitle.textContent = `${titleMap[g]} • الكل`;
      prepareViewAndFetch({ type: 'grade', grade: g });
    });
    classesList.appendChild(allEl);
    list.forEach(val => {
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div><div>${toArabicDigits(val)}</div><div class="sub">اضغط لعرض السجلات</div></div>
        <svg class="chev" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>
      `;
      el.addEventListener('click', () => {
        absencesTitle.textContent = toArabicDigits(val);
        prepareViewAndFetch({ type: 'class', className: val });
      });
      classesList.appendChild(el);
    });
  }

  function prepareViewAndFetch(scope) {
    currentScope = scope;
    classFilter = '__all';
    absencesList.innerHTML = '';
    absMeta.textContent = 'جاري التحميل…';
    setCountBadge(0);
    setActiveStatus('absent');
    setActiveLesson('__all');
    setActiveTime('today');
    hideCustomRange();
    const showClassChips = scope.type !== 'class';
    classesFilterBar.hidden = !showClassChips;
    if (showClassChips) buildClassesFilterChips();
    openSheet(absencesSheet);
    refetchAndRender();
  }

  async function refetchAndRender() {
    if (!currentScope) return;
    const requestId = ++recordsRequestId;
    recordsLoading = true;
    cachedRows = []; cachedStudents = [];
    absMeta.textContent = 'جاري تحميل السجلات…';
    absencesList.innerHTML = '<div class="loading" role="status"><div class="spinner"></div><span>جاري تحميل السجلات…</span></div>';
    sheetDoc.getElementById('loadMore').hidden = true;
    miniPresent.textContent = miniAbsent.textContent = miniLate.textContent = '?';
    setCountBadge(0);
    try {
      const { startISO, endISO } = rangeForFilter(timeFilter);
      const { students, rows } = await fetchAttendanceForScope(currentScope, startISO, endISO);
      if (requestId !== recordsRequestId) return;
      cachedStudents = students; cachedRows = rows;
      recordsLoading = false;
      renderFilteredList();
    } catch (e) {
      if (requestId !== recordsRequestId) return;
      recordsLoading = false;
      console.error('[absence] fetch failed', e);
      absMeta.textContent = 'تعذّر التحميل.';
      absencesList.innerHTML = '<button type="button" class="back-btn">تعذّر تحميل السجلات. اضغط لإعادة المحاولة</button>';
      absencesList.firstElementChild.addEventListener('click', () => refetchAndRender());
    }
  }

  function buildClassesFilterChips() {
    classesFilterBar.innerHTML = '';
    const allChip = document.createElement('button');
    allChip.className = 'class-chip active';
    allChip.dataset.class = '__all';
    allChip.textContent = 'الكل';
    classesFilterBar.appendChild(allChip);
    classesForScope(currentScope).forEach(cn => {
      const chip = document.createElement('button');
      chip.className = 'class-chip';
      chip.dataset.class = cn;
      chip.textContent = toArabicDigits(cn);
      classesFilterBar.appendChild(chip);
    });
  }
  classesFilterBar.addEventListener('click', (e) => {
    const chip = e.target.closest('.class-chip');
    if (!chip) return;
    classFilter = chip.dataset.class;
    classesFilterBar.querySelectorAll('.class-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    renderFilteredList();
  });

  function setCountBadge(n) {
    const label = statusFilter === 'absent' ? 'حالة غياب' : statusFilter === 'late' ? 'حالة تأخير' : 'حالة حضور';
    const cls = statusFilter === 'absent' ? 'b-absent' : statusFilter === 'late' ? 'b-late' : 'b-present';
    absCount.className = `badge ${cls}`;
    absCount.textContent = `${toArabicDigits(n)} ${label}`;
  }

  // Rows matching the current lesson/class filters, before day-grouping.
  // Filtering here (rather than after grouping) means picking a specific
  // lesson naturally drills a grouped day back down to that one record.
  function filteredRawRows() {
    return cachedRows.filter(r => {
      const lessonOK = (lessonFilter === '__all') ? true : ((+r.lessonIndex || 0) === lessonFilter);
      const classOK = (currentScope?.type !== 'class')
        ? (classFilter === '__all' ? true : ((r.class || '') === classFilter))
        : true;
      return lessonOK && classOK;
    });
  }

  // Live counts across all three statuses at once, reflecting every filter
  // except the status tab itself — reuses the already-fetched cachedRows,
  // so it updates instantly as lesson/class/time filters change. Counts
  // are per (student, day), matching the grouped list below and the stats
  // cards — never a raw per-lesson-record count.
  function renderMiniStats(days) {
    miniPresent.textContent = toArabicDigits(days.filter(d => d.countsPresent).length);
    miniAbsent.textContent = toArabicDigits(days.filter(d => d.hasAbsent).length);
    miniLate.textContent = toArabicDigits(days.filter(d => d.hasLate).length);
  }

  function renderFilteredList(keepLimit = false) {
    if (recordsLoading) return;
    if (!keepLimit) visibleLimit = 40;
    const allDays = groupRowsByStudentDay(filteredRawRows());
    renderMiniStats(allDays);
    const days = allDays.filter(d => statusFilter === 'absent' ? d.hasAbsent : statusFilter === 'late' ? d.hasLate : d.countsPresent);

    days.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      if (currentScope?.type !== 'class') {
        const ca = (a.class || ''); const cb = (b.class || '');
        if (ca !== cb) return ca.localeCompare(cb, 'ar', { sensitivity: 'base' });
      }
      return arabicSort(a._student?.name, b._student?.name);
    });

    const studentsCount = new Set(cachedStudents.map(s => s.id)).size;
    const statusLabel = statusFilter === 'absent' ? 'الغياب' : statusFilter === 'late' ? 'التأخير' : 'الحضور';
    absMeta.textContent = `الطلاب: ${toArabicDigits(studentsCount)} • ${statusLabel}: ${toArabicDigits(days.length)}`;
    setCountBadge(days.length);

    sheetDoc.getElementById('loadMore').hidden = days.length <= visibleLimit;
    absencesList.innerHTML = '';
    if (days.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.style.padding = '8px 2px';
      empty.textContent = 'لا توجد سجلات مطابقة للفلتر الحالي.';
      absencesList.appendChild(empty);
      return;
    }

    const statusWord = statusFilter === 'absent' ? 'غياب' : statusFilter === 'late' ? 'تأخير' : 'حضور';
    const badgeClass = statusFilter === 'absent' ? 'b-absent' : statusFilter === 'late' ? 'b-late' : 'b-present';

    days.slice(0, visibleLimit).forEach(day => {
      const d = parseAttendanceDate({ date: day.date });
      const dateStr = d ? fmtDate(d) : (day.date ? toArabicDigits(day.date) : '—');
      const classLabel = toArabicDigits(day.class || '—');
      const recs = day.records.slice().sort((a, b) => (+a.lessonIndex || 0) - (+b.lessonIndex || 0));
      const lessonsLabel = recs.length === 1
        ? `الحصة ${toArabicDigits(recs[0].lessonIndex || '؟')}`
        : `${toArabicDigits(recs.length)} حصص`;

      const tile = document.createElement('button');
      tile.type = 'button';
      tile.setAttribute('aria-expanded', 'false');
      tile.className = 'att-tile';

      const title = `${day._student?.name || '—'} — ${statusWord} ${lessonsLabel}`;
      const sub = `${classLabel} • ${toArabicDigits(dateStr)}`;

      tile.innerHTML = `
        <div class="att-left">
          <div class="att-title">${title}</div>
          <div class="att-sub">${sub}</div>
        </div>
        <span class="badge ${badgeClass}">${statusWord}</span>
      `;

      const expand = document.createElement('div');
      expand.className = 'expand';
      const recordsHtml = recs.map((r, idx) => {
        const recWord = r.status === 'absent' ? 'غياب' : r.status === 'late' ? 'تأخير' : 'حضور';
        const recBadgeClass = r.status === 'absent' ? 'b-absent' : r.status === 'late' ? 'b-late' : 'b-present';
        const lessonLabel = r.lessonLabel || ('الحصة ' + toArabicDigits(r.lessonIndex || ''));
        return `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 0; ${idx > 0 ? 'border-top:1px solid var(--border);' : ''}">
          <div style="min-width:0;">
            <div><b>${recWord} ${lessonLabel}</b></div>
            <div class="sub" id="who-${r.id}">جاري التحميل بيانات المسجّل…</div>
          </div>
          <span class="badge ${recBadgeClass}">${recWord}</span>
        </div>
      `;
      }).join('');
      expand.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:2px;">
          <div style="padding-bottom:6px;"><b>الطالب:</b> ${day._student?.name || '—'}</div>
          <div style="padding-bottom:6px;"><b>التاريخ:</b> ${toArabicDigits(dateStr || '—')}</div>
          <div style="padding-bottom:6px;"><b>الفصل:</b> ${classLabel}</div>
          ${recordsHtml}
        </div>
      `;

      tile.addEventListener('click', async () => {
        tile.classList.toggle('open');
        tile.setAttribute('aria-expanded', String(tile.classList.contains('open')));
        if (!tile.classList.contains('open')) return;
        await Promise.all(recs.map(async (r) => {
          const who = sheetDoc.getElementById(`who-${r.id}`);
          if (!who) return;
          const uid = r.updatedBy || r.createdBy;
          const name = await getTeacherName(uid);
          who.textContent = `بواسطة: ${name}`;
        }));
      });

      absencesList.appendChild(tile);
      absencesList.appendChild(expand);
    });
  }

  function setActiveStatus(st) {
    statusFilter = st;
    sheetDoc.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active', 'absent', 'late', 'present'));
    const btn = statusToggle.querySelector(`.status-btn[data-status="${st}"]`);
    if (btn) btn.classList.add('active', st);
  }
  statusToggle.addEventListener('click', (e) => {
    const b = e.target.closest('.status-btn');
    if (!b) return;
    const st = b.dataset.status;
    if (st !== statusFilter) { setActiveStatus(st); renderFilteredList(); }
  });

  function setActiveLesson(key) {
    lessonFilter = key === '__all' ? '__all' : +key;
    sheetDoc.querySelectorAll('.lesson-chip').forEach(c => c.classList.toggle('active', c.dataset.lesson === String(key)));
  }
  lessonFilterBar.addEventListener('click', (e) => {
    const b = e.target.closest('.lesson-chip');
    if (!b) return;
    const key = b.dataset.lesson;
    if (key !== String(lessonFilter)) { setActiveLesson(key); renderFilteredList(); }
  });

  function setActiveTime(key) {
    timeFilter = key;
    // Only this row's chips — the stats cards' period chips are .filter-chip
    // too, and toggling them here left both stats rows with nothing active.
    filtersBar.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('active', c.dataset.filter === key));
    if (key === 'custom') showCustomRange(); else hideCustomRange();
  }
  filtersBar.addEventListener('click', (e) => {
    const c = e.target.closest('.filter-chip');
    if (!c) return;
    const key = c.dataset.filter;
    if (key !== timeFilter) {
      setActiveTime(key);
      if (key !== 'custom') refetchAndRender();
    }
  });

  function showCustomRange() {
    dateRangeBox.classList.add('open');
    if (!startDateEl.value || !endDateEl.value) {
      const now = new Date();
      startDateEl.value = toISODateStr(startOfMonth(now));
      endDateEl.value = toISODateStr(now);
    }
  }
  function hideCustomRange() { dateRangeBox.classList.remove('open'); }

  applyRangeBtn.addEventListener('click', () => {
    const s = startDateEl.value, e = endDateEl.value;
    if (s && e && e >= s) {
      customStart = s;
      customEnd = e;
      setActiveTime('custom');
      refetchAndRender();
    } else {
      alert('الرجاء اختيار مدى تاريخ صحيح.');
    }
  });
  clearRangeBtn.addEventListener('click', () => {
    startDateEl.value = ''; endDateEl.value = '';
    customStart = null; customEnd = null;
    setActiveTime('today');
    refetchAndRender();
  });

  sheetDoc.getElementById('loadMore').addEventListener('click', () => { visibleLimit += 40; renderFilteredList(true); });
  closeAbsences.addEventListener('click', () => closeSheet(absencesSheet));
  refreshView.addEventListener('click', () => {
    dataCache.clear();
    if (absencesSheet.classList.contains('open')) refetchAndRender();
    else if (classesSheet.classList.contains('open')) loadGradeStats(selectedGrade);
    else loadHomeStats();
  });

  // ---------- PDF export ----------
  let pdfLibraries;
  function loadPdfLibraries() {
    if (!pdfLibraries) {
      const load = src => new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src; script.onload = resolve;
        script.onerror = () => { script.remove(); reject(new Error('PDF download failed')); };
        document.head.appendChild(script);
      });
      pdfLibraries = load('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
        .then(() => load('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js'))
        .catch(error => { pdfLibraries = null; throw error; });
    }
    return pdfLibraries;
  }
  let logoImage = null;
  function loadLogo() {
    return new Promise((resolve) => {
      if (logoImage) { resolve(logoImage); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = 'https://framerusercontent.com/images/Q9RdKm2z3o4K64mIC5QUx1JqGrA.png?width=1080&height=1350';
      img.onload = () => { logoImage = img; resolve(img); };
      img.onerror = () => resolve(null);
    });
  }

  function openExportModal() { exportModal.classList.add('active'); }
  function closeExportModalFunc() { exportModal.classList.remove('active'); }
  exportData.addEventListener('click', openExportModal);
  closeExportModal.addEventListener('click', closeExportModalFunc);
  cancelExport.addEventListener('click', closeExportModalFunc);
  // This sheet stays mounted after it's closed, so its key handlers only
  // act while it's actually showing.
  const isShowing = () => !!host.closest('.sheet.open');
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isShowing() && exportModal.classList.contains('active')) {
      e.preventDefault(); // handled — the listener below leaves the sheets be
      closeExportModalFunc();
    }
  });
  exportModal.addEventListener('click', (e) => { if (e.target === exportModal) closeExportModalFunc(); });

  generatePDF.addEventListener('click', () => {
    const grade = exportGradeSelect.value;
    const period = exportPeriodSelect.value;
    generatePDFReport(grade, period);
  });

  async function generatePDFReport(gradeValue, period) {
    try {
      exportLoading.classList.add('active');
      generatePDF.disabled = true;

      await Promise.all([loadLogo(), loadPdfLibraries()]);
      const { startISO, endISO } = rangeForFilter(period);
      const scope = gradeValue === 'all' ? { type: 'all' } : { type: 'grade', grade: +gradeValue };
      const { students, rows } = await fetchAttendanceForScope(scope, startISO, endISO);

      const lateRecords = rows.filter(r => r.status === 'late');
      const absentRecords = rows.filter(r => r.status === 'absent');
      // Summary card uses grouped per-day counts (one absence/lateness per
      // student per day, matching the on-screen stats); the itemized
      // tables below still list every individual lesson-level record.
      const dayGroups = groupRowsByStudentDay(rows);
      const absentDaysCount = dayGroups.filter(d => d.hasAbsent).length;
      const lateDaysCount = dayGroups.filter(d => d.hasLate).length;

      // Resolve teacher names up front (small, deduped set — cheap even
      // unpooled since teacherNameCache collapses repeats).
      const uids = new Set([...lateRecords, ...absentRecords].map(r => r.updatedBy || r.createdBy).filter(Boolean));
      await Promise.all([...uids].map(getTeacherName));

      const { jsPDF } = window.jspdf;
      const docPdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      docPdf.setR2L(true);

      if (logoImage) {
        try { docPdf.addImage(logoImage, 'PNG', 140, 10, 50, 50); } catch {}
      }
      docPdf.setFontSize(24);
      docPdf.setFont('helvetica', 'bold');
      docPdf.text('ثانوية أحمد البشر الرومي', 105, 20, { align: 'center' });
      docPdf.setFontSize(18);
      docPdf.text('تقرير تدقيق الغياب والتأخير', 105, 35, { align: 'center' });
      docPdf.setFontSize(12);
      const gradeLabel = gradeValue === 'all' ? 'كل الصفوف' : `الصف ${toArabicDigits(gradeValue)}`;
      const periodLabel = period === 'today' ? 'اليوم' : period === 'thisWeek' ? 'هذا الأسبوع' : 'هذا الشهر';
      docPdf.text(`الصف: ${gradeLabel}`, 20, 50);
      docPdf.text(`الفترة: ${periodLabel}`, 20, 60);
      docPdf.text(`من: ${toArabicDigits(startISO)}`, 20, 70);
      docPdf.text(`إلى: ${toArabicDigits(endISO)}`, 20, 80);

      docPdf.setFillColor(240, 248, 255);
      docPdf.rect(15, 90, 180, 60, 'F');
      docPdf.setDrawColor(10, 75, 120);
      docPdf.rect(15, 90, 180, 60);
      docPdf.setFontSize(16);
      docPdf.text('الإحصائيات العامة', 105, 100, { align: 'center' });
      docPdf.setFontSize(12);
      docPdf.text('إجمالي الطلاب:', 30, 115);
      docPdf.text(toArabicDigits(students.length.toString()), 70, 115);
      docPdf.text('حالات الغياب:', 100, 115);
      docPdf.text(toArabicDigits(absentDaysCount.toString()), 150, 115);
      docPdf.text('حالات التأخير:', 30, 130);
      docPdf.text(toArabicDigits(lateDaysCount.toString()), 70, 130);
      docPdf.text('إجمالي السجلات:', 100, 130);
      docPdf.text(toArabicDigits(rows.length.toString()), 150, 130);

      const buildRows = (records) => records
        .slice()
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        .map((record, index) => [
          toArabicDigits((index + 1).toString()),
          record._student?.name || record.studentName || 'غير معروف',
          record.class || 'غير معروف',
          record.lessonIndex ? `الحصة ${toArabicDigits(record.lessonIndex.toString())}` : 'غير معروف',
          record.date ? toArabicDigits(record.date) : 'غير معروف',
          teacherNameCache.get(record.updatedBy || record.createdBy) || '—'
        ]);

      if (lateRecords.length > 0) {
        docPdf.addPage();
        docPdf.setFontSize(20);
        docPdf.text('التأخيرات', 105, 20, { align: 'center' });
        docPdf.autoTable({
          startY: 30,
          head: [['#', 'اسم الطالب', 'الفصل', 'الحصة', 'التاريخ', 'بواسطة']],
          body: buildRows(lateRecords),
          theme: 'striped',
          headStyles: { fillColor: [245, 158, 11], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
          bodyStyles: { halign: 'center' }
        });
      }

      if (absentRecords.length > 0) {
        docPdf.addPage();
        docPdf.setFontSize(20);
        docPdf.text('الغياب', 105, 20, { align: 'center' });
        docPdf.autoTable({
          startY: 30,
          head: [['#', 'اسم الطالب', 'الفصل', 'الحصة', 'التاريخ', 'بواسطة']],
          body: buildRows(absentRecords),
          theme: 'striped',
          headStyles: { fillColor: [239, 68, 68], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
          bodyStyles: { halign: 'center' }
        });
      }

      if (lateRecords.length === 0 && absentRecords.length === 0) {
        docPdf.setFontSize(14);
        docPdf.text('لا توجد حالات غياب أو تأخير خلال هذه الفترة.', 105, 110, { align: 'center' });
      }

      docPdf.save(`تدقيق_الغياب_${gradeLabel}_${periodLabel}_${startISO}.pdf`);

    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('حدث خطأ أثناء إنشاء التقرير');
    } finally {
      exportLoading.classList.remove('active');
      generatePDF.disabled = false;
      closeExportModalFunc();
    }
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isShowing() && !e.defaultPrevented) {
      [classesSheet, absencesSheet].forEach(s => {
        if (s.classList.contains('open')) closeSheet(s);
      });
    }
  });

  // Lets adminpage.html refresh whatever's showing each time the sheet is
  // reopened (it stays mounted between opens). Cached reads under a minute
  // old come straight back, so this is cheap.
  function refresh() {
    if (!sHome.classList.contains('active')) return;
    if (absencesSheet.classList.contains('open')) refetchAndRender();
    else if (classesSheet.classList.contains('open')) loadGradeStats(selectedGrade);
    else loadHomeStats();
  }
  return { refresh };
}
