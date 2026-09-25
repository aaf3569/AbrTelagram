// الغياب المختصر — the sheet adminpage.html opens from "الغياب المختصر" (in
// the الغياب popup and in the sidebar). This used to be the standalone page
// admins/overallabsence.html; its markup, styles (/admins/overallabsence.css)
// and logic are unchanged apart from what living inside another page
// requires, each noted where it happens. Built the same way as the
// غياب اليوم sheet (/admins/newabsence.js), which started life as a copy of
// this page and still shares most of its code.
//
// It renders into a shadow root on the host element it's given, so its ids
// and classes can't collide with adminpage.html's own. That's also why its
// DOM lookups go through `sheetDoc` (the shadow root) instead of `document`.
import { firebaseConfig } from "/shared/firebase.js";
import { initializeApp, getApp, getApps } from "/shared/firebase.js";
import {
  getFirestore, collection, collectionGroup, getDocs, query, where,
  doc, getDoc, Timestamp
} from "/shared/firebase.js";
import { kuwaitTodayISO, getCurrentKuwaitMinutes } from "/shared/kuwait-time.js";
import { fetchClassList, sortClassList } from "/shared/class-registry.js";
import { canManageAttendance } from "/shared/auth-guard.js";

const CSS_URL = new URL("./overallabsence.css", import.meta.url).href;
const FONT_AWESOME_URL = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css";

const MARKUP = `
  <header class="site-header" id="siteHeader">
    <div class="header-inner">
      <button class="icon-btn" id="menuBtn" title="القائمة" aria-label="فتح القائمة">
        <i class="fas fa-bars"></i>
      </button>

      <div class="header-center">
        <h1 class="site-title" id="navbarTitle">ثانوية أحمد البشر الرومي</h1>
      </div>

      <button class="icon-btn" id="downloadBtn" title="تنزيل تقرير الغياب" aria-label="تنزيل تقرير الغياب">
        <i class="fas fa-download"></i>
      </button>
    </div>

    <div class="date-chip">
      <button class="date-btn" id="dateBtn" type="button" aria-label="اختيار تاريخ">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <span id="dateLabel">—</span>

        <!-- Mobile-friendly date input overlay -->
        <div class="date-input-wrapper" aria-hidden="true">
          <input class="mobile-date-input" id="mobileDateInput" type="date" inputmode="none" />
        </div>
      </button>
    </div>
  </header>

  <main>
    <div id="stateLoading" class="state active panel">
      <div class="loading">
        <div class="spinner"></div>
        <div class="muted">جاري التحقق من تسجيل الدخول وجلب البيانات…</div>
      </div>
    </div>

    <div id="stateNotLogged" class="state panel">
      <div class="msg error">يرجى تسجيل الدخول قبل الاستخدام.</div>
      <p class="muted" style="text-align:center; margin:8px 0 0;">لا توجد جلسة نشطة. <a href="/index.html">اذهب لصفحة الدخول</a>.</p>
    </div>

    <div id="stateDenied" class="state panel">
      <div class="msg error">تم رفض الوصول. هذه الصفحة مخصّصة للمشرفين فقط.</div>
    </div>

    <section id="stateOk" class="state full-width" aria-label="ملخص الغياب">
      <div class="table-shell">
        <div class="table-scroll" id="tableScroll">
          <table aria-label="ملخص الغياب">
            <thead>
              <tr>
                <th class="class-col">الصف</th>
                <th class="morning-col">الصبح</th>
                <th aria-label="الحصة الأولى"><span class="th-full">الحصة الأولى</span><span class="th-stack"><span class="th-word">الحصة</span><span class="th-ordinal">الأولى</span></span></th>
                <th aria-label="الحصة الثانية"><span class="th-full">الحصة الثانية</span><span class="th-stack"><span class="th-word">الحصة</span><span class="th-ordinal">الثانية</span></span></th>
                <th aria-label="الحصة الثالثة"><span class="th-full">الحصة الثالثة</span><span class="th-stack"><span class="th-word">الحصة</span><span class="th-ordinal">الثالثة</span></span></th>
                <th aria-label="الحصة الرابعة"><span class="th-full">الحصة الرابعة</span><span class="th-stack"><span class="th-word">الحصة</span><span class="th-ordinal">الرابعة</span></span></th>
                <th aria-label="الحصة الخامسة"><span class="th-full">الحصة الخامسة</span><span class="th-stack"><span class="th-word">الحصة</span><span class="th-ordinal">الخامسة</span></span></th>
                <th aria-label="الحصة السادسة"><span class="th-full">الحصة السادسة</span><span class="th-stack"><span class="th-word">الحصة</span><span class="th-ordinal">السادسة</span></span></th>
                <th aria-label="الحصة السابعة"><span class="th-full">الحصة السابعة</span><span class="th-stack"><span class="th-word">الحصة</span><span class="th-ordinal">السابعة</span></span></th>
              </tr>
            </thead>
            <tbody id="gridBody"></tbody>
          </table>
        </div>
      </div>
    </section>
  </main>

  <!-- Popover -->
  <div class="popover-backdrop" id="popBackdrop" aria-hidden="true"></div>
  <div class="popover" id="popover" role="dialog" aria-modal="true" aria-hidden="true">
    <div class="pop-head">
      <div class="pop-title">
        <b id="popTitle">—</b>
        <span id="popSub">—</span>
      </div>
      <button class="pop-close" id="popClose" aria-label="إغلاق" type="button">×</button>
    </div>
    <div class="pop-body" id="popBody"></div>
  </div>

  <!-- Modal for lesson actions -->
  <div class="modal-backdrop" id="modalBackdrop"></div>
  <div class="modal" id="lessonModal">
    <div class="modal-card">
      <div class="modal-head">
        <div class="modal-title">
          <b id="modalTitle">—</b>
          <span id="modalSubtitle">—</span>
        </div>
        <button class="modal-close" id="modalClose" aria-label="إغلاق">×</button>
      </div>
      <div class="modal-body" id="modalBody"></div>
      <div class="modal-footer" id="modalFooter"></div>
    </div>
  </div>

  <!-- Confirm Save Modal -->
  <div class="modal-backdrop" id="confirmBackdrop"></div>
  <div class="modal" id="confirmModal">
    <div class="modal-card">
      <div class="modal-head">
        <div class="modal-title">
          <b>تأكيد حفظ الغياب</b>
          <span id="confirmSubtitle">—</span>
        </div>
        <button class="modal-close" id="confirmClose" aria-label="إغلاق">×</button>
      </div>
      <div class="modal-body" id="confirmBody">
        <div class="tabs">
          <button class="tab-btn active" id="tabAbsent">الغياب</button>
          <button class="tab-btn" id="tabLate">المتأخرون</button>
        </div>
        <div class="tab-content active" id="tabContentAbsent">
          <div class="section">
            <div class="sec-title">
              <span>قائمة الغياب</span>
              <span class="muted" id="absentCount">0 طالب</span>
            </div>
            <ul class="list" id="confirmAbsentList"></ul>
          </div>
        </div>
        <div class="tab-content" id="tabContentLate">
          <div class="section">
            <div class="sec-title">
              <span>قائمة المتأخرين</span>
              <span class="muted" id="lateCount">0 طالب</span>
            </div>
            <ul class="list" id="confirmLateList"></ul>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="modal-btn warning" id="confirmSaveBtn">
          <i class="fas fa-save"></i> حفظ
        </button>
        <button class="modal-btn" id="confirmCancelBtn">
          <i class="fas fa-times"></i> إلغاء
        </button>
      </div>
    </div>
  </div>

  <!-- Download absence report modal -->
  <div class="modal-backdrop" id="downloadBackdrop"></div>
  <div class="modal" id="downloadModal">
    <div class="modal-card dl-card">
      <div class="modal-head">
        <div class="modal-title">
          <b>تنزيل تقرير الغياب</b>
          <span>اختر النطاق ثم نزّل ملف PDF</span>
        </div>
        <button class="modal-close" id="downloadClose" aria-label="إغلاق">×</button>
      </div>
      <div class="modal-body">
        <div class="dl-section">
          <div class="dl-section-title"><i class="fas fa-calendar-days"></i> الفترة الزمنية</div>
          <div class="dl-seg" id="dlPeriodSeg">
            <button type="button" class="dl-seg-btn active" data-period="single">اليوم المحدد</button>
            <button type="button" class="dl-seg-btn" data-period="range">نطاق تواريخ</button>
          </div>
          <div class="dl-single-info" id="dlSingleInfo">
            <i class="fas fa-circle-info"></i>
            <span id="dlSingleDateText">—</span>
          </div>
          <div class="dl-range-row" id="dlRangeRow" hidden>
            <div class="dl-field">
              <label for="dlFromDate">من</label>
              <input type="date" id="dlFromDate" class="dl-date-input">
            </div>
            <div class="dl-field">
              <label for="dlToDate">إلى</label>
              <input type="date" id="dlToDate" class="dl-date-input">
            </div>
          </div>
        </div>

        <div class="dl-section">
          <div class="dl-section-title"><i class="fas fa-users-rectangle"></i> الصفوف</div>
          <div class="dl-seg" id="dlClassSeg">
            <button type="button" class="dl-seg-btn active" data-scope="all">كل الصفوف</button>
            <button type="button" class="dl-seg-btn" data-scope="one">صف محدد</button>
          </div>
          <div class="dl-range-row" id="dlClassRow" hidden style="grid-template-columns:1fr;">
            <div class="dl-field">
              <label for="dlClassSelect">الصف والفصل</label>
              <select id="dlClassSelect" class="dl-select"></select>
            </div>
          </div>
        </div>

        <div class="dl-status" id="dlStatus" hidden></div>
      </div>
      <div class="modal-footer">
        <button class="modal-btn primary" id="dlDownloadBtn" type="button">
          <i class="fas fa-file-pdf"></i> <span>تنزيل PDF</span>
        </button>
        <button class="modal-btn" id="dlCancelBtn" type="button">
          <i class="fas fa-times"></i> إلغاء
        </button>
      </div>
    </div>
  </div>
`;

/**
 * Renders the sheet into `host` and starts loading today's class-by-lesson grid.
 *
 * hooks:
 *   close()                 — title: close the sheet
 *   openSidebar()           — menu button: open adminpage.html's sidebar
 *   attendance              — the page's single mountAttendanceSheet() instance
 *   onAttendanceSaved(fn)   — subscribe to that instance's saves
 *   getSession()            — { user, data, classList } the page already resolved
 */
export async function mountOverallAbsenceSheet(host, hooks) {
  // Fetched rather than <link>ed so the markup never paints unstyled — and
  // before attachShadow(), since a host can only ever get one shadow root:
  // if this fails, the caller can simply try again.
  const res = await fetch(CSS_URL);
  if (!res.ok) throw new Error(`overallabsence.css: HTTP ${res.status}`);
  const cssText = await res.text();
  const sheetDoc = host.attachShadow({ mode: "open" });

  // Font Awesome's class rules don't reach into a shadow root, so it's
  // loaded here too (already cached from adminpage.html's own copy).
  const fa = document.createElement("link");
  fa.rel = "stylesheet";
  fa.href = FONT_AWESOME_URL;
  const style = document.createElement("style");
  style.textContent = cssText;
  const tpl = document.createElement("template");
  tpl.innerHTML = MARKUP;
  sheetDoc.append(fa, style, tpl.content);

      // adminpage.html has already initialized Firestore for this app, and
      // Firestore allows initializeFirestore() only once per app — a second
      // call throws — so this just takes the existing instance.
      const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
      const db = getFirestore(app);

      // The shared attendance sheet (openForEdit / openForAdminCreate) is
      // mounted once by adminpage.html, with isPrivilegedEdit so the "تعديل"
      // button in the cell popover can edit any past session and
      // "تسجيل الغياب" can create one for a missed lesson. Mounting it a second
      // time here would wire every button in its shared DOM twice. This just
      // subscribes to its saves so a just-taken/edited lesson's cell updates
      // right away instead of waiting for the next date change.
      const attendance = hooks.attendance;
      hooks.onAttendanceSaved(() => refreshGrid({ force: true }));

      const sLoading = sheetDoc.getElementById('stateLoading');
      const sNotLog  = sheetDoc.getElementById('stateNotLogged');
      const sDenied  = sheetDoc.getElementById('stateDenied');
      const sOk      = sheetDoc.getElementById('stateOk');

      const menuBtn = sheetDoc.getElementById('menuBtn');
      const downloadBtn = sheetDoc.getElementById('downloadBtn');
      const gridBody = sheetDoc.getElementById('gridBody');

      const dateBtn = sheetDoc.getElementById('dateBtn');
      const dateLabel = sheetDoc.getElementById('dateLabel');
      const mobileDateInput = sheetDoc.getElementById('mobileDateInput');

      const popBackdrop = sheetDoc.getElementById('popBackdrop');
      const popover = sheetDoc.getElementById('popover');
      const popClose = sheetDoc.getElementById('popClose');
      const popTitle = sheetDoc.getElementById('popTitle');
      const popSub = sheetDoc.getElementById('popSub');
      const popBody = sheetDoc.getElementById('popBody');

      const siteHeader = sheetDoc.getElementById('siteHeader');
      const navbarTitle = sheetDoc.getElementById('navbarTitle');

      // Modal elements
      const modalBackdrop = sheetDoc.getElementById('modalBackdrop');
      const lessonModal = sheetDoc.getElementById('lessonModal');
      const modalClose = sheetDoc.getElementById('modalClose');
      const modalTitle = sheetDoc.getElementById('modalTitle');
      const modalSubtitle = sheetDoc.getElementById('modalSubtitle');
      const modalBody = sheetDoc.getElementById('modalBody');
      const modalFooter = sheetDoc.getElementById('modalFooter');

      // Confirm modal elements
      const confirmBackdrop = sheetDoc.getElementById('confirmBackdrop');
      const confirmModal = sheetDoc.getElementById('confirmModal');
      const confirmClose = sheetDoc.getElementById('confirmClose');
      const confirmSubtitle = sheetDoc.getElementById('confirmSubtitle');
      const confirmBody = sheetDoc.getElementById('confirmBody');
      const tabAbsent = sheetDoc.getElementById('tabAbsent');
      const tabLate = sheetDoc.getElementById('tabLate');
      const tabContentAbsent = sheetDoc.getElementById('tabContentAbsent');
      const tabContentLate = sheetDoc.getElementById('tabContentLate');
      const confirmAbsentList = sheetDoc.getElementById('confirmAbsentList');
      const confirmLateList = sheetDoc.getElementById('confirmLateList');
      const absentCount = sheetDoc.getElementById('absentCount');
      const lateCount = sheetDoc.getElementById('lateCount');
      const confirmSaveBtn = sheetDoc.getElementById('confirmSaveBtn');
      const confirmCancelBtn = sheetDoc.getElementById('confirmCancelBtn');

      // Download report modal elements
      const downloadBackdrop = sheetDoc.getElementById('downloadBackdrop');
      const downloadModal = sheetDoc.getElementById('downloadModal');
      const downloadClose = sheetDoc.getElementById('downloadClose');
      const dlPeriodSeg = sheetDoc.getElementById('dlPeriodSeg');
      const dlSingleInfo = sheetDoc.getElementById('dlSingleInfo');
      const dlSingleDateText = sheetDoc.getElementById('dlSingleDateText');
      const dlRangeRow = sheetDoc.getElementById('dlRangeRow');
      const dlFromDate = sheetDoc.getElementById('dlFromDate');
      const dlToDate = sheetDoc.getElementById('dlToDate');
      const dlClassSeg = sheetDoc.getElementById('dlClassSeg');
      const dlClassRow = sheetDoc.getElementById('dlClassRow');
      const dlClassSelect = sheetDoc.getElementById('dlClassSelect');
      const dlStatus = sheetDoc.getElementById('dlStatus');
      const dlDownloadBtn = sheetDoc.getElementById('dlDownloadBtn');
      const dlCancelBtn = sheetDoc.getElementById('dlCancelBtn');

      // Make navbar title clickable
      navbarTitle.addEventListener('click', () => {
        hooks.close();
      });

      const show = (el) => {
        [sLoading, sNotLog, sDenied, sOk].forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        syncHeaderH();
      };

      function syncHeaderH(){
        const headerHeight = siteHeader.getBoundingClientRect().height || 122;
        sheetDoc.host.style.setProperty('--headerH', headerHeight + 'px');
      }

      const toArabicDigits = (str) => (str || "").toString().replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
      const arabicSort = (a, b) => (a || "").toString().localeCompare((b || "").toString(), 'ar', { sensitivity: 'base' });

      function escapeHtml(str){
        return String(str ?? '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#039;');
      }

      function filenameSafe(value){
        return (value ?? '').toString().trim()
          .replace(/[\\/:*?"<>|]+/g, '-')
          .replace(/\s+/g, '-');
      }

      function fmtDateLong(d){
        return new Intl.DateTimeFormat('ar-KW', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          timeZone: 'Asia/Kuwait'
        }).format(d);
      }

      function toInputDate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const da = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${da}`;
      }

      function fromInputDate(iso) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || '').toString());
        if (!m) return new Date();
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        return new Date(y, (mo || 1) - 1, d || 1);
      }

      function timeToMinutes(timeStr) {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + (m || 0);
      }

      // Lesson times for Kuwait (Asia/Kuwait)
      const LESSON_TIMES = [
        { start: "07:55", end: "08:40" },   // Lesson 1
        { start: "08:40", end: "09:25" },   // Lesson 2
        { start: "09:25", end: "10:10" },   // Lesson 3
        { start: "10:30", end: "11:15" },   // Lesson 4
        { start: "11:15", end: "12:00" },   // Lesson 5
        { start: "12:20", end: "13:05" },   // Lesson 6
        { start: "13:05", end: "13:50" }    // Lesson 7
      ];

      // Attendance cache
      const attendanceCache = new Map(); // key: `${dateISO}-${className}-${lessonIndex}` -> boolean
      const attendanceTakenKeys = new Set(); // loaded per selected date
      const makeAttendanceKey = (dateISO, className, lessonIndex) => `${dateISO}__${className}__L${lessonIndex}`;

      function isAttendanceTaken(className, lessonIndex, dateObj) {
        const dateISO = toInputDate(dateObj);
        const cacheKey = `${dateISO}-${className}-${lessonIndex}`;
        if (attendanceCache.has(cacheKey)) return attendanceCache.get(cacheKey);

        const taken =
          attendanceTakenKeys.has(makeAttendanceKey(dateISO, className, lessonIndex)) ||
          !!GRID?.[className]?.[lessonIndex]?.hasAnyRecord;
        attendanceCache.set(cacheKey, taken);
        return taken;
      }

      // Missed lesson detection — "missed" now covers any date up to and
      // including today (not just today), so an admin can spot and backfill
      // an untaken lesson from any past day, not only one that just ended.
      // A future date's lessons haven't happened yet, so they're never
      // eligible.
      function isLessonMissed(className, lessonIndex, dateObj, scheduleExists) {
        if (!scheduleExists) return false;

        const todayISO = kuwaitTodayISO();
        const dateISO = toInputDate(dateObj);
        if (dateISO > todayISO) return false;
        if (dateISO < todayISO) return true; // any past day's lesson is fully over already

        const currentMinutes = getCurrentKuwaitMinutes();
        const lessonEndMinutes = timeToMinutes(LESSON_TIMES[lessonIndex - 1].end);
        return currentMinutes > lessonEndMinutes;
      }

      // Update missed status for all cells
      function updateMissedStatus() {
        for (const className of ALL_CLASSES) {
          for (let lessonIndex = 1; lessonIndex <= 7; lessonIndex++) {
            const cell = GRID?.[className]?.[lessonIndex];
            if (!cell) continue;

            const scheduleExists = scheduleMap?.[className]?.[lessonIndex] &&
                                  (scheduleMap[className][lessonIndex].teacherUid ||
                                   scheduleMap[className][lessonIndex].teacherName);

            if (scheduleExists && !cell.hasAnyRecord) {
              const attendanceTaken = isAttendanceTaken(className, lessonIndex, selectedDate);
              const isMissed = !attendanceTaken && isLessonMissed(className, lessonIndex, selectedDate, true);
              cell.missed = isMissed;
            } else {
              cell.missed = false;
            }
          }
        }

        renderGrid();
      }

      // Auto-update missed status every 60 seconds
      let missedUpdateInterval = null;
      function startMissedUpdateInterval() {
        if (missedUpdateInterval) clearInterval(missedUpdateInterval);
        missedUpdateInterval = setInterval(updateMissedStatus, 60000); // 60 seconds
      }

      function startOfDay(d){
        const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        x.setHours(0,0,0,0);
        return x;
      }
      function endOfDay(d){
        const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        x.setHours(23,59,59,999);
        return x;
      }

      function getRecTime(r){
        const t = r.updatedAt || r.createdAt;
        if (!t) return 0;
        if (t.toMillis) return t.toMillis();
        if (t.seconds) return t.seconds * 1000;
        return 0;
      }

      // Populated from settings/classes (see /shared/class-registry.js) right
      // before the first requestGridLoad() call inside onAuthStateChanged
      // below — every function that reads ALL_CLASSES only ever runs after
      // that point, so this stays empty for the brief window before auth
      // resolves without anything racing it.
      let ALL_CLASSES = [];

      const teacherNameCache = new Map();
      async function getTeacherName(uid) {
        if (!uid) return "—";
        if (teacherNameCache.has(uid)) return teacherNameCache.get(uid);
        try {
          const s = await getDoc(doc(db, 'teachers', uid));
          const name = s.exists() ? (s.data().name || uid) : uid;
          teacherNameCache.set(uid, name);
          return name;
        } catch {
          return uid;
        }
      }

      // Student warning level cache
      const studentWarningCache = new Map();

      async function getStudentWarningLevel(studentId) {
        if (!studentId) return 0;
      
        // Check cache first
        if (studentWarningCache.has(studentId)) {
          return studentWarningCache.get(studentId);
        }
      
        try {
          // Query all attendance records for this student where status is 'absent' and hasReason is not true
          const attendanceRef = collection(db, 'students', studentId, 'attendance');
          const q = query(
            attendanceRef,
            where('status', '==', 'absent')
          );
        
          const snap = await getDocs(q);
          let absencesWithoutReasonCount = 0;
        
          snap.forEach(doc => {
            const data = doc.data();
            // Check if hasReason is not true (either false, undefined, or any other value)
            if (!data.hasReason || data.hasReason !== true) {
              absencesWithoutReasonCount++;
            }
          });
        
          // Calculate warning level
          let warningLevel = 0;
          if (absencesWithoutReasonCount >= 15) {
            warningLevel = 3;
          } else if (absencesWithoutReasonCount >= 10) {
            warningLevel = 2;
          } else if (absencesWithoutReasonCount >= 5) {
            warningLevel = 1;
          }
        
          // Cache the result
          studentWarningCache.set(studentId, warningLevel);
          return warningLevel;
        
        } catch (error) {
          console.error('Error calculating warning level:', error);
          return 0;
        }
      }

      let scheduleMap = Object.create(null);
      const weekdayFromISO = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();

      // Schedule for one weekday, from the two snapshots loadGridForDate
      // already fetched (in parallel with all its other reads). Returns a
      // fresh map instead of filling the live scheduleMap, so the grid on
      // screen keeps its data until loadGridForDate swaps everything in.
      function buildScheduleMap(snap, customSnap){
        const map = Object.create(null);
        // A failed 'schedules' read skipped the custom schedules too.
        if (!snap) return map;

        snap.forEach(ds => {
          const x = ds.data() || {};
          const li = Number((x.lesson || '').toString());
          if (!Number.isFinite(li) || li < 1 || li > 7) return;
          // normalizeClassName, not a raw ALL_CLASSES.includes() — a schedule
          // row whose classKey spacing differs even slightly from the class
          // list ("12/2 ع" vs "12 / 2 ع") was silently dropped here, leaving
          // map empty for that class. Every consumer then reads
          // "no lesson scheduled", so the missed-attendance "!" could never
          // render for it no matter what. Same tolerant matching the rest of
          // this file already uses for attendance rows.
          const classKey = normalizeClassName(x.classKey || x.class || '');
          if (!classKey) {
            // Loud on purpose. A schedule row we can't tie to a class is
            // invisible everywhere downstream — it silently costs that class
            // its "!" — so it must never be dropped quietly again.
            console.warn(
              '[overallabsence] schedule row dropped — classKey does not resolve ' +
              'to any class in the current class list:',
              JSON.stringify(x.classKey ?? x.class ?? null), 'doc:', ds.id
            );
            return;
          }

          if (!map[classKey]) map[classKey] = {};
          map[classKey][li] = {
            teacherUid: (x.teacherUid || '').toString(),
            teacherName: (x.teacherName || '').toString(),
            subject: (x.subject || '').toString()
          };
        });

        // Merge enabled weekly custom schedules for this weekday as fallback.
        // The standing weekly schedule ('schedules') always takes precedence.
        customSnap?.forEach(ds => {
          const x = ds.data() || {};
          if (x.deletedAt || x.enabled !== true) return;

          const classKey = normalizeClassName(x.classKey || x.class || '');
          if (!classKey) return;

          const lessons = Array.isArray(x.lessons) ? x.lessons : [];
          if (!map[classKey]) map[classKey] = {};

          const maxLessons = Math.min(7, Number(x.lessonCount) || lessons.length || 7);
          for (let li = 1; li <= maxLessons; li++) {
            if (map[classKey][li]) continue;
            const lesson = lessons[li - 1] || {};
            map[classKey][li] = {
              teacherUid: (lesson.teacherUid || '').toString(),
              teacherName: (lesson.teacherName || '').toString(),
              subject: (lesson.subject || '').toString()
            };
          }
        });

        return map;
      }

      let GRID = Object.create(null);
      let selectedDate = fromInputDate(kuwaitTodayISO());
      let morningLatesMap = Object.create(null); // className -> {count, details}
      let gridLoadRequestId = 0;
      let gridLoadedAt = 0; // when the grid on screen was last fully loaded

      dateLabel.textContent = toArabicDigits(fmtDateLong(selectedDate));
      mobileDateInput.value = toInputDate(selectedDate);

      // Resolves any stored class spelling to the canonical entry in
      // ALL_CLASSES, or '' when it can't be resolved *unambiguously*.
      //
      // Stored classKeys drift from the current class list in two ways:
      //   1. spacing — "12/2 ع" vs "12 / 2 ع"
      //   2. a missing track letter — a doc written as "12 / 2" back when the
      //      class had no track, now listed as "12 / 2 ع"
      // Both used to resolve to '' here, which silently dropped the document.
      // For schedule rows that meant scheduleMap had no entry for the class,
      // so scheduleExists was false and the missed-attendance "!" could never
      // render for it regardless of whether anyone actually took attendance.
      //
      // The track fallback deliberately refuses to guess: it only fills in a
      // track when exactly ONE class in the list shares that grade/section.
      // Where both tracks exist (e.g. "12 / 2 ع" and "12 / 2 د") a trackless
      // key is genuinely ambiguous, and merging the two classes would be far
      // worse than dropping the row — that is the exact class-collision bug
      // this whole fix exists to undo.
      function normalizeClassName(value) {
        const raw = (value || '').toString().replace(/\s+/g, ' ').trim();
        if (!raw) return '';
        if (ALL_CLASSES.includes(raw)) return raw;

        const m = raw.match(/^(\d+)\s*\/\s*(\d+)(?:\s*(.*))?$/);
        if (!m) return '';

        const grade = Number(m[1]);
        const section = Number(m[2]);
        const track = (m[3] || '').trim();
        const normalized = `${grade} / ${section}${track ? ` ${track}` : ''}`;
        if (ALL_CLASSES.includes(normalized)) return normalized;

        if (!track) {
          const prefix = `${grade} / ${section}`;
          const candidates = ALL_CLASSES.filter(
            c => c === prefix || c.startsWith(`${prefix} `)
          );
          if (candidates.length === 1) return candidates[0];
        }
        return '';
      }

      function parseLessonIndex(...values) {
        for (const value of values) {
          const n = Number(value);
          if (Number.isFinite(n) && n >= 1 && n <= 7) return Math.trunc(n);
        }
        return 0;
      }

      function splitPathSegments(pathLike) {
        return (pathLike || '').toString().split('/').filter(Boolean);
      }

      function ensureCell(className, lessonIndex){
        if (!GRID[className]) GRID[className] = {};
        if (!GRID[className][lessonIndex]) {
          GRID[className][lessonIndex] = {
            count: 0,
            students: [],
            lateCount: 0,
            lateStudents: [],
            teacherUids: new Set(),
            hasAnyRecord: false,
            missed: false,
            expectedTeacherUids: new Set(),
            expectedTeacherNames: new Set(),
            expectedSubject: ""
          };
        }
        return GRID[className][lessonIndex];
      }

      // Morning lates for one day, from the snapshot loadGridForDate already
      // fetched. Returns a fresh map; loadGridForDate swaps it in.
      function buildMorningLatesMap(snapshot) {
        const map = Object.create(null);
        if (!snapshot) return map;

        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          const classKey = normalizeClassName(data.classKey || data.class || '');

          if (!classKey) return;

          if (!map[classKey]) {
            map[classKey] = {
              count: 0,
              details: []
            };
          }
        
          map[classKey].count++;
          map[classKey].details.push({
            studentName: data.studentName || 'غير معروف',
            time: data.time || '--:--',
            minutesLate: data.minutesLate || 0,
            reason: data.reason || ''
          });
        });
      
        // Sort details for each class by minutesLate desc, then time, then name
        for (const className in map) {
          map[className].details.sort((a, b) => {
            if (b.minutesLate !== a.minutesLate) return b.minutesLate - a.minutesLate;
            if (a.time !== b.time) return a.time.localeCompare(b.time);
            return arabicSort(a.studentName, b.studentName);
          });
        }

        return map;
      }

      function initGrid(){
        GRID = Object.create(null);
        for (const cn of ALL_CLASSES){
          GRID[cn] = {};
          for (let i=1;i<=7;i++){
            GRID[cn][i] = {
              count: 0,
              students: [],
              lateCount: 0,
              lateStudents: [],
              teacherUids: new Set(),
              hasAnyRecord: false,
              missed: false,
              expectedTeacherUids: new Set(),
              expectedTeacherNames: new Set(),
              expectedSubject: "",
              // Only set for the current attendanceSessions/attendanceRecords
              // schema (see the "New attendanceSessions" load below) — stays
              // null for legacy-only records, which have no real session doc
              // to edit through shared/attendance.js.
              sessionId: null
            };
          }
        }
      }

      function renderGrid(){
        gridBody.innerHTML = '';

        for (const cn of ALL_CLASSES){
          const tr = document.createElement('tr');

          // Class name cell (الصف) - FIRST in HTML = RIGHTMOST visually
          const tdClass = document.createElement('td');
          tdClass.className = 'class-col';
          tdClass.innerHTML = `<div class="class-name">${toArabicDigits(cn)}</div>`;
          tr.appendChild(tdClass);

          // Morning lates cell (الصبح) - SECOND in HTML = LEFT of الصف
          const tdMorning = document.createElement('td');
          tdMorning.className = 'morning-col';
          const morningData = morningLatesMap[cn];
          if (morningData && morningData.count > 0) {
            const btn = document.createElement('button');
            btn.className = 'cell-btn';
            btn.type = 'button';
            btn.textContent = toArabicDigits(morningData.count);
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              openMorningLatesModal(cn);
            });
            tdMorning.appendChild(btn);
          } else {
            const empty = document.createElement('div');
            empty.className = 'cell-empty';
            empty.textContent = '';
            tdMorning.appendChild(empty);
          }
          tr.appendChild(tdMorning);

          // Lesson cells (الحصص) - باقي الحصص
          for (let lesson=1; lesson<=7; lesson++){
            const td = document.createElement('td');
            const cell = GRID?.[cn]?.[lesson];

            if (!cell){
              const empty = document.createElement('div');
              empty.className = 'cell-empty';
              empty.textContent = '';
              td.appendChild(empty);
              tr.appendChild(td);
              continue;
            }

            if (cell.count > 0){
              const btn = document.createElement('button');
              btn.className = 'cell-btn';
              btn.type = 'button';
              btn.textContent = toArabicDigits(cell.count);
              btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openModalForCell(btn, cn, lesson, 'absent');
              });
              td.appendChild(btn);
            } else if (cell.lateCount > 0) {
              // Attendance WAS taken (so this isn't "missed") and nobody was
              // absent — but students were marked late. That used to fall
              // straight through to the empty cell below, hiding every late
              // arrival whenever a lesson had no absences at all.
              const btn = document.createElement('button');
              btn.className = 'cell-late';
              btn.type = 'button';
              btn.textContent = toArabicDigits(cell.lateCount);
              btn.title = 'يوجد طلاب متأخرون (لا يوجد غياب)';
              btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openModalForCell(btn, cn, lesson, 'absent');
              });
              td.appendChild(btn);
            } else if (cell.missed) {
              const btn = document.createElement('button');
              btn.className = 'cell-missed';
              btn.type = 'button';
              btn.textContent = '!';
              btn.title = 'لم يتم تسجيل الغياب لهذه الحصة';
              btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openModalForCell(btn, cn, lesson, 'missed');
              });
            
              // Add missed indicator badge
              const indicator = document.createElement('div');
              indicator.className = 'missed-indicator';
              indicator.textContent = '!';
              btn.appendChild(indicator);
            
              td.appendChild(btn);
            } else {
              const empty = document.createElement('div');
              empty.className = 'cell-empty';
              empty.textContent = '';
              td.appendChild(empty);
            }

            tr.appendChild(td);
          }

          gridBody.appendChild(tr);
        }
      }

      // Modal functions
      function openModal() {
        document.body.classList.add('modal-open');
        modalBackdrop.classList.add('open');
        lessonModal.classList.add('open');
      }

      function closeModal() {
        document.body.classList.remove('modal-open');
        modalBackdrop.classList.remove('open');
        lessonModal.classList.remove('open');
        modalBody.innerHTML = '';
        modalFooter.innerHTML = '';
      
        // Reset to default view
        const lateView = sheetDoc.getElementById('lateDetailsView');
        if (lateView) {
          lateView.classList.remove('active');
        }
        const originalContent = sheetDoc.getElementById('originalModalContent');
        if (originalContent) {
          originalContent.style.display = 'block';
        }
      }

      // Confirm modal functions
      function openConfirmModal() {
        document.body.classList.add('modal-open');
        confirmBackdrop.classList.add('open');
        confirmModal.classList.add('open');
      }

      function closeConfirmModal() {
        document.body.classList.remove('modal-open');
        confirmBackdrop.classList.remove('open');
        confirmModal.classList.remove('open');
        confirmAbsentList.innerHTML = '';
        confirmLateList.innerHTML = '';
      }

      modalClose.addEventListener('click', closeModal);
      modalBackdrop.addEventListener('click', closeModal);
      confirmClose.addEventListener('click', closeConfirmModal);
      confirmCancelBtn.addEventListener('click', closeConfirmModal);
      confirmBackdrop.addEventListener('click', closeConfirmModal);
    
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (lessonModal.classList.contains('open')) closeModal();
          if (confirmModal.classList.contains('open')) closeConfirmModal();
        }
      });

      // Prevent modal close when clicking inside modal card
      lessonModal.addEventListener('click', (e) => {
        if (e.target === lessonModal) {
          closeModal();
        }
      });
      confirmModal.addEventListener('click', (e) => {
        if (e.target === confirmModal) {
          closeConfirmModal();
        }
      });

      // Tab switching for confirm modal
      tabAbsent.addEventListener('click', () => {
        tabAbsent.classList.add('active');
        tabLate.classList.remove('active');
        tabContentAbsent.classList.add('active');
        tabContentLate.classList.remove('active');
      });

      tabLate.addEventListener('click', () => {
        tabLate.classList.add('active');
        tabAbsent.classList.remove('active');
        tabContentLate.classList.add('active');
        tabContentAbsent.classList.remove('active');
      });

      async function openMorningLatesModal(className) {
        const morningData = morningLatesMap[className];
        if (!morningData || morningData.count === 0) return;

        modalTitle.textContent = `تأخير الصباح - ${toArabicDigits(className)}`;
        modalSubtitle.textContent = `التاريخ: ${toArabicDigits(fmtDateLong(selectedDate))}`;

        modalBody.innerHTML = `
          <div class="section">
            <div class="sec-title">
              <span>قائمة المتأخرين صباحاً</span>
              <span style="font-weight:900; color:var(--red)">${toArabicDigits(morningData.count)} طالب</span>
            </div>
            <div class="list" id="morningLatesList"></div>
          </div>
        `;

        const list = modalBody.querySelector('#morningLatesList');
        morningData.details.forEach(detail => {
          const li = document.createElement('li');
          li.className = 'li';
          li.innerHTML = `
            <div class="name">${detail.studentName}</div>
            <div class="meta">
              ${detail.time} | تأخر ${toArabicDigits(detail.minutesLate)} دقيقة
              ${detail.reason ? `<br><small>سبب: ${detail.reason}</small>` : ''}
            </div>
          `;
          list.appendChild(li);
        });

        modalFooter.innerHTML = '';
        openModal();
      }

      async function openModalForCell(anchorEl, className, lessonIndex, mode) {
        const cell = GRID?.[className]?.[lessonIndex];
        if (!cell) return;

        const niceClass = toArabicDigits(className);
        const niceLesson = toArabicDigits(lessonIndex);
        const niceDate = toArabicDigits(fmtDateLong(selectedDate));

        // Clear previous content
        modalBody.innerHTML = '';
        modalFooter.innerHTML = '';

        // Store current cell info for late details
        const currentCellInfo = { className, lessonIndex, cell };

        if (mode === 'missed') {
          modalTitle.textContent = `${niceClass} | الحصة ${niceLesson}`;
          modalSubtitle.textContent = `التاريخ: ${niceDate}`;

          const expectedNames = [...cell.expectedTeacherNames].filter(Boolean);
          const expectedSubjects = (cell.expectedSubject || '').trim();

          modalBody.innerHTML = `
            <div id="originalModalContent">
              <div class="alert">
                <span class="dot"></span>
                <span>تنبيه: لم يتم تسجيل الغياب لهذه الحصة</span>
              </div>

              <div class="section">
                <div class="sec-title">
                  <span>المعلّم المكلّف</span>
                  <span class="muted" style="font-weight:900">${expectedNames.length ? toArabicDigits(expectedNames.length) : '—'}</span>
                </div>
                <div class="chips" id="teacherChips"></div>
              </div>

              <div class="section">
                <div class="sec-title">
                  <span>المادة</span>
                  <span class="muted" style="font-weight:900">${expectedSubjects ? 'موجود' : 'غير محددة'}</span>
                </div>
                <div class="chips" id="subjectChips"></div>
              </div>
            </div>

            <div class="late-details-view" id="lateDetailsView">
              <button class="back-button" id="backFromLateDetails">
                <i class="fas fa-arrow-right"></i>
                العودة
              </button>
              <div class="late-header">
                <h4>تفاصيل المتأخرين</h4>
                <span class="muted">الحصة ${niceLesson}</span>
              </div>
            
              <div class="late-info-grid">
                <div class="info-item">
                  <div class="label">الحصة</div>
                  <div class="value">${niceLesson}</div>
                </div>
                <div class="info-item">
                  <div class="label">الوقت</div>
                  <div class="value">${LESSON_TIMES[lessonIndex-1].start} - ${LESSON_TIMES[lessonIndex-1].end}</div>
                </div>
                <div class="info-item">
                  <div class="label">التاريخ</div>
                  <div class="value">${niceDate}</div>
                </div>
                <div class="info-item">
                  <div class="label">الوقت الحالي</div>
                  <div class="value" id="currentKuwaitTime">--:--</div>
                </div>
              </div>
            
              <div class="late-status" id="lateStatusContainer">
                <div class="status-text" id="lateStatusText">جاري التحميل...</div>
                <div class="status-desc" id="lateStatusDesc"></div>
              </div>
            
              <div class="section">
                <div class="sec-title">
                  <span>التفاصيل</span>
                </div>
                <div id="lateDetailsContent"></div>
              </div>
            </div>
          `;

          const teacherWrap = modalBody.querySelector('#teacherChips');
          teacherWrap.innerHTML = '';
          if (!expectedNames.length) {
            teacherWrap.innerHTML = `<span class="chip">غير محدد</span>`;
          } else {
            expectedNames.forEach(n => {
              const chip = document.createElement('span');
              chip.className = 'chip';
              chip.textContent = n;
              teacherWrap.appendChild(chip);
            });
          }

          const subjWrap = modalBody.querySelector('#subjectChips');
          subjWrap.innerHTML = '';
          if (!expectedSubjects) {
            subjWrap.innerHTML = `<span class="chip">غير محددة</span>`;
          } else {
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.textContent = expectedSubjects;
            subjWrap.appendChild(chip);
          }

          // Add Late Details button
          const todayISO = kuwaitTodayISO();
          const dateISO = toInputDate(selectedDate);
          const isToday = dateISO === todayISO;
          const scheduleExists = scheduleMap?.[className]?.[lessonIndex] && 
                                (scheduleMap[className][lessonIndex].teacherUid || 
                                 scheduleMap[className][lessonIndex].teacherName);

          if (isToday && scheduleExists) {
            const lateBtn = document.createElement('button');
            lateBtn.className = `modal-btn ${cell.missed ? 'warning' : ''}`;
            lateBtn.id = 'lateDetailsBtn';
            lateBtn.innerHTML = '<i class="fas fa-user-clock"></i> عرض المتأخرين';
          
            // Check if lesson is currently running or in future
            const currentMinutes = getCurrentKuwaitMinutes();
            const lessonStartMinutes = timeToMinutes(LESSON_TIMES[lessonIndex - 1].start);
            const lessonEndMinutes = timeToMinutes(LESSON_TIMES[lessonIndex - 1].end);
          
            if (currentMinutes < lessonEndMinutes) {
              lateBtn.disabled = true;
              lateBtn.title = 'متاح بعد انتهاء الحصة';
            }
          
            lateBtn.addEventListener('click', () => {
              showLateDetailsView(currentCellInfo);
            });

            modalFooter.appendChild(lateBtn);
          }

          // "تسجيل الغياب" — lets an admin take attendance for this lesson
          // right now, however long ago it happened, through the same
          // shared attendance sheet used everywhere else (mounted with
          // isPrivilegedEdit above). Needs exactly one resolvable teacher,
          // since a session can only be recorded under one.
          if (scheduleExists) {
            const expectedUids = [...cell.expectedTeacherUids].filter(Boolean);
            if (expectedUids.length === 1) {
              const takeBtn = document.createElement('button');
              takeBtn.className = 'modal-btn primary';
              takeBtn.type = 'button';
              takeBtn.innerHTML = '<i class="fas fa-clipboard-check"></i> تسجيل الغياب';
              takeBtn.addEventListener('click', () => {
                const teacherUid = expectedUids[0];
                const teacherName = [...cell.expectedTeacherNames].filter(Boolean)[0] || '';
                closeModal();
                attendance.openForAdminCreate({
                  date: dateISO,
                  classKey: className,
                  lesson: lessonIndex,
                  teacherUid,
                  teacherName,
                });
              });
              modalFooter.appendChild(takeBtn);
            }
          }

        } else {
          // A cell with no absences but some late students still has real
          // content to show (the Lates tab below) — only truly-empty cells
          // (neither absent nor late) have nothing worth opening.
          if (cell.count <= 0 && cell.lateCount <= 0) return;

          modalTitle.textContent = `${niceClass} | الحصة ${niceLesson}`;
          modalSubtitle.textContent = `التاريخ: ${niceDate}`;

          modalBody.innerHTML = `
            <div class="teacher-line" id="teacherLine">
              <i class="fas fa-chalkboard-teacher"></i>
              <span class="teacher-label">المعلّم:</span>
              <span class="teacher-name" id="teacherChips">جاري التحميل…</span>
            </div>

            <div class="tabs">
              <button class="tab-btn active" id="tabAbsent">الغياب (${toArabicDigits(cell.count)})</button>
              <button class="tab-btn" id="tabLates">المتأخرون (${toArabicDigits(cell.lateCount)})</button>
            </div>

            <div class="tab-content active" id="panelAbsent">
              <div class="section">
                <div class="sec-title">
                  <span>أسماء الغياب</span>
                  <span class="muted" style="font-weight:900">${toArabicDigits(cell.students.length)} اسم</span>
                </div>
                <div class="list" id="studentsList"></div>
              </div>
            </div>

            <div class="tab-content" id="panelLates"></div>
          `;

          // Wire up tabs
          const tabAbsent = modalBody.querySelector('#tabAbsent');
          const tabLates  = modalBody.querySelector('#tabLates');
          const panelAbsent = modalBody.querySelector('#panelAbsent');
          const panelLates  = modalBody.querySelector('#panelLates');
          tabAbsent.addEventListener('click', () => {
            tabAbsent.classList.add('active'); tabLates.classList.remove('active');
            panelAbsent.classList.add('active'); panelLates.classList.remove('active');
          });
          tabLates.addEventListener('click', () => {
            tabLates.classList.add('active'); tabAbsent.classList.remove('active');
            panelLates.classList.add('active'); panelAbsent.classList.remove('active');
          });

          // Opened via the lates-only cell (nothing to show on the absent
          // tab) — land straight on the tab that actually has content.
          if (cell.count <= 0 && cell.lateCount > 0) {
            tabLates.click();
          }

          // Populate lates panel (students marked late during attendance)
          if (cell.lateCount > 0) {
            const latesList = document.createElement('div');
            latesList.className = 'list';
            const lateStudents = [...cell.lateStudents].sort((a, b) => arabicSort(a.name, b.name));
            lateStudents.forEach(student => {
              const row = document.createElement('div');
              row.className = 'li';
              row.dataset.studentId = student.id;
              row.dataset.studentClass = student.className || className;
              row.innerHTML = `
                <div class="name">${student.name}</div>
                <div class="meta">متأخر</div>
              `;
              row.addEventListener('click', () => {
                openStudent(student.id, student.className || className, student.name);
              });
              getStudentWarningLevel(student.id).then(w => row.classList.add(`warning-${w}`)).catch(() => row.classList.add('warning-0'));
              latesList.appendChild(row);
            });
            panelLates.appendChild(latesList);
          } else {
            panelLates.innerHTML = `<p class="muted" style="text-align:center;padding:24px 0">لا يوجد متأخرون في هذه الحصة</p>`;
          }

          const stWrap = modalBody.querySelector('#studentsList');

          // Sort students by name
          const students = [...cell.students].sort((a,b) => arabicSort(a.name, b.name));

          // Create student rows and fetch warning levels
          for (const student of students){
            const row = document.createElement('div');
            row.className = 'li';
            row.dataset.studentId = student.id;
            row.dataset.studentClass = student.className || className;
            row.innerHTML = `
              <div class="name">${student.name}</div>
              <div class="meta">غائب</div>
            `;

            // Add click event for redirect
            row.addEventListener('click', () => {
              const studentId = row.dataset.studentId;
              const studentClass = row.dataset.studentClass || "";
              openStudent(studentId, studentClass, student.name);
            });

            stWrap.appendChild(row);

            // Fetch and apply warning level asynchronously
            getStudentWarningLevel(student.id).then(warningLevel => {
              row.classList.add(`warning-${warningLevel}`);
            }).catch(() => {
              row.classList.add('warning-0');
            });
          }

          const teacherWrap = modalBody.querySelector('#teacherChips');
          const uids = [...cell.teacherUids].filter(Boolean);
          if (uids.length === 0){
            teacherWrap.textContent = 'غير محدد';
          } else {
            const tnames = await Promise.all(uids.map(uid => getTeacherName(uid)));
            const uniq = [...new Set(tnames.filter(Boolean))];
            teacherWrap.textContent = uniq.length ? uniq.join('، ') : 'غير محدد';
          }

          // Editing goes through the same shared attendance-edit sheet as
          // سجلات الغياب (attendance.openForEdit) — mounted with
          // isPrivilegedEdit above, so it ignores the normal lesson-time
          // edit window and stays open whenever an admin needs it. Only
          // shown when there's a real attendanceSessions doc to edit —
          // legacy-only records (cell.sessionId still null) have none.
          if (cell.sessionId) {
            const editBtn = document.createElement('button');
            editBtn.className = 'modal-btn primary';
            editBtn.type = 'button';
            editBtn.innerHTML = '<i class="fas fa-pen"></i> تعديل';
            editBtn.addEventListener('click', () => {
              const sessionId = cell.sessionId;
              closeModal();
              attendance.openForEdit(sessionId);
            });
            modalFooter.appendChild(editBtn);
          }
        }

        openModal();
      }

      function showLateDetailsView(cellInfo) {
        const { className, lessonIndex, cell } = cellInfo;
      
        // Hide original content
        const originalContent = sheetDoc.getElementById('originalModalContent');
        if (originalContent) {
          originalContent.style.display = 'none';
        }
      
        // Show late details view
        const lateView = sheetDoc.getElementById('lateDetailsView');
        if (lateView) {
          lateView.classList.add('active');
        }
      
        // Update current Kuwait time
        const updateTime = () => {
          const totalMin = getCurrentKuwaitMinutes();
          const hours = String(Math.floor(totalMin / 60)).padStart(2, '0');
          const minutes = String(totalMin % 60).padStart(2, '0');
          const timeElement = sheetDoc.getElementById('currentKuwaitTime');
          if (timeElement) {
            timeElement.textContent = `${hours}:${minutes}`;
          }
        };
      
        updateTime();
        const timeInterval = setInterval(updateTime, 30000); // Update every 30 seconds
      
        // Update status
        const todayISO = kuwaitTodayISO();
        const dateISO = toInputDate(selectedDate);
        const isToday = dateISO === todayISO;
      
        const currentMinutes = getCurrentKuwaitMinutes();
        const lessonStartMinutes = timeToMinutes(LESSON_TIMES[lessonIndex - 1].start);
        const lessonEndMinutes = timeToMinutes(LESSON_TIMES[lessonIndex - 1].end);
      
        const statusContainer = sheetDoc.getElementById('lateStatusContainer');
        const statusText = sheetDoc.getElementById('lateStatusText');
        const statusDesc = sheetDoc.getElementById('lateStatusDesc');
        const detailsContent = sheetDoc.getElementById('lateDetailsContent');
      
        if (!isToday) {
          statusText.textContent = 'غير متاح';
          statusDesc.textContent = 'تفاصيل المتأخرين متاحة فقط ليوم اليوم';
          statusContainer.classList.remove('green');
          detailsContent.innerHTML = '<p class="muted">هذه الميزة تعمل فقط لليوم الحالي.</p>';
        } else if (currentMinutes < lessonStartMinutes) {
          statusText.textContent = 'الحصة لم تبدأ بعد';
          statusDesc.textContent = `ستبدأ الحصة الساعة ${LESSON_TIMES[lessonIndex-1].start}`;
          statusContainer.classList.add('green');
          detailsContent.innerHTML = '<p class="muted">يمكنك عرض تفاصيل المتأخرين بعد انتهاء الحصة.</p>';
        } else if (currentMinutes >= lessonStartMinutes && currentMinutes <= lessonEndMinutes) {
          statusText.textContent = 'الحصة قيد التنفيذ';
          statusDesc.textContent = `ستنتهي الحصة الساعة ${LESSON_TIMES[lessonIndex-1].end}`;
          statusContainer.classList.add('green');
          detailsContent.innerHTML = '<p class="muted">يمكنك عرض تفاصيل المتأخرين بعد انتهاء الحصة.</p>';
        } else if (cell.missed) {
          const minutesLate = currentMinutes - lessonEndMinutes;
          statusText.textContent = 'متأخر عن تسجيل الغياب';
          statusDesc.textContent = `انتهت الحصة منذ ${minutesLate} دقيقة`;
          statusContainer.classList.remove('green');
          detailsContent.innerHTML = `
            <p><strong>ملاحظة:</strong> انتهى وقت الحصة ولم يتم تسجيل الغياب بعد.</p>
            <p class="muted" style="margin-top: 8px;">يرجى تسجيل الغياب في أسرع وقت ممكن.</p>
          `;
        } else {
          statusText.textContent = 'لم يتأخر';
          statusDesc.textContent = 'تم تسجيل الغياب في الوقت المحدد';
          statusContainer.classList.add('green');
          detailsContent.innerHTML = '<p class="muted">تم تسجيل الغياب لهذه الحصة بنجاح.</p>';
        }
      
        // Setup back button
        const backBtn = sheetDoc.getElementById('backFromLateDetails');
        if (backBtn) {
          backBtn.addEventListener('click', () => {
            if (lateView) lateView.classList.remove('active');
            if (originalContent) originalContent.style.display = 'block';
            clearInterval(timeInterval);
          });
        }
      
        // Clear interval when modal closes
        const modalCloseHandler = () => {
          clearInterval(timeInterval);
          lessonModal.removeEventListener('close', modalCloseHandler);
        };
        lessonModal.addEventListener('close', modalCloseHandler);
      }

      // Performance safety: limit concurrency so it does not open hundreds of parallel queries
      async function promisePool(items, worker, concurrency = 18){
        const results = [];
        let i = 0;
        const runners = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
          while (i < items.length){
            const idx = i++;
            try { results[idx] = await worker(items[idx], idx); }
            catch { results[idx] = undefined; }
          }
        });
        await Promise.all(runners);
        return results;
      }

      // Every read for the day goes out at once. They all used to wait on
      // each other in a long chain — schedules, then morning lates, then all
      // students, then each attendance source in turn, then each session's
      // records ten at a time, then teacher names — roughly twenty network
      // round trips back to back, which is why opening this was so slow. None
      // of them depend on each other; the two that do (a session's records
      // need the session list, teacher names need the schedule) are chained
      // inside the same batch rather than waited on separately.
      //
      // Nothing on screen changes until every read is in: the grid is then
      // rebuilt in one synchronous pass, so a refresh never shows a blank or
      // half-built grid (and neither can the 60-second missed-status timer,
      // which used to be able to render the grid mid-load, after it had
      // already been cleared).
      async function loadGridForDate(dateObj, requestId = gridLoadRequestId){
        const isStale = () => requestId !== gridLoadRequestId;
        const dateISO = toInputDate(dateObj);
        // Schedule entries recur weekly (identified by weekday, not calendar
        // date), so they match by dayIndex rather than the exact date.
        const dayIndex = weekdayFromISO(dateISO);
        const startTs = Timestamp.fromDate(startOfDay(dateObj));
        const endTs = Timestamp.fromDate(endOfDay(dateObj));

        dateLabel.textContent = toArabicDigits(fmtDateLong(dateObj));
        mobileDateInput.value = dateISO;

        // Same failure handling as before, source by source: these log and
        // carry on without that source; only the students read is required.
        const optional = (label, promise) => promise.catch((error) => {
          console.error(label, error);
          return null;
        });

        const scheduleWithNames = Promise.all([
          // A failed 'schedules' read has always meant no schedule at all
          // (custom schedules included), without a log.
          getDocs(query(collection(db, 'schedules'), where('dayIndex', '==', dayIndex))).catch(() => null),
          optional('Error loading custom schedules:',
            getDocs(query(collection(db, 'customDaySchedules'), where('dayIndex', '==', dayIndex)))),
        ]).then(async ([snap, customSnap]) => {
          const map = buildScheduleMap(snap, customSnap);
          const uids = new Set();
          for (const byLesson of Object.values(map)) {
            for (const sch of Object.values(byLesson)) {
              if (sch && !sch.teacherName && sch.teacherUid) uids.add(sch.teacherUid);
            }
          }
          const names = new Map(await Promise.all(
            [...uids].map(async (uid) => [uid, await getTeacherName(uid)])
          ));
          return { map, names };
        });

        const sessionsWithRecords = optional('Error loading attendance sessions:', (async () => {
          const sessionsSnap = await getDocs(
            query(collection(db, 'attendanceSessions'), where('date', '==', dateISO))
          );
          const sessions = [];
          sessionsSnap.forEach((docSnap) => sessions.push({ id: docSnap.id, data: docSnap.data() || {}, records: null }));
          // Records live one subcollection per session and carry no date, so
          // there's no single query for them — but they no longer wait for
          // anything else, and 50 go out at a time instead of 10 (a day has
          // at most one session per class per lesson). Only sessions that map
          // to a class/lesson on the grid are read, as before.
          await promisePool(sessions, async (session) => {
            if (isStale()) return;
            const className = normalizeClassName(session.data.classKey || session.data.class || '');
            const lessonIndex = parseLessonIndex(session.data.lesson, session.data.lessonIndex);
            if (!className || !lessonIndex) return;
            try {
              session.records = await getDocs(collection(db, 'attendanceSessions', session.id, 'attendanceRecords'));
            } catch {
              session.records = null;
            }
          }, 50);
          return sessions;
        })());

        const [
          { map: nextScheduleMap, names: teacherNames },
          latesSnap,
          studentsSnap,
          legacySessions,
          sessions,
          legacyByDateSnap,
          legacyByCreatedAtSnap,
        ] = await Promise.all([
          scheduleWithNames,
          optional('Error loading morning lates:',
            getDocs(query(collection(db, 'morningLates'), where('date', '==', dateISO)))),
          getDocs(collection(db, 'students')),
          // Legacy top-level attendance sessions
          optional('Error loading legacy attendance sessions:',
            getDocs(query(collection(db, 'attendance'), where('date', '==', dateISO)))),
          sessionsWithRecords,
          // Legacy student attendance records (date field)
          optional('Error loading legacy attendance by date:',
            getDocs(query(collectionGroup(db, 'attendance'), where('date', '==', dateISO)))),
          // Legacy fallback for records that only have createdAt
          optional('Error loading legacy attendance by createdAt:',
            getDocs(query(
              collectionGroup(db, 'attendance'),
              where('createdAt', '>=', startTs),
              where('createdAt', '<=', endTs)
            ))),
        ]);
        if (isStale()) return false;

        // ---- Everything is in: rebuild the grid in one synchronous pass. ----
        scheduleMap = nextScheduleMap;
        morningLatesMap = buildMorningLatesMap(latesSnap);
        initGrid();
        attendanceCache.clear();
        attendanceTakenKeys.clear();

        const studentsById = new Map();
        studentsSnap.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const className = normalizeClassName(data.class || data.className || '');
          studentsById.set(docSnap.id, {
            id: docSnap.id,
            name: (data.name || '—').toString(),
            className
          });
        });

        const absentSeenByCell = new Map();
        const lateSeenByCell   = new Map();
        const getAbsentSet = (className, lessonIndex) => {
          const k = `${className}__L${lessonIndex}`;
          if (!absentSeenByCell.has(k)) absentSeenByCell.set(k, new Set());
          return absentSeenByCell.get(k);
        };
        const getLateSet = (className, lessonIndex) => {
          const k = `${className}__L${lessonIndex}`;
          if (!lateSeenByCell.has(k)) lateSeenByCell.set(k, new Set());
          return lateSeenByCell.get(k);
        };

        const markAttendanceTaken = (className, lessonIndex) => {
          if (!className || !GRID[className]) return null;
          if (lessonIndex < 1 || lessonIndex > 7) return null;
          attendanceTakenKeys.add(makeAttendanceKey(dateISO, className, lessonIndex));
          const cell = ensureCell(className, lessonIndex);
          cell.hasAnyRecord = true;
          return cell;
        };

        const addAbsentStudentToCell = (className, lessonIndex, student, teacherUid = null) => {
          const cell = markAttendanceTaken(className, lessonIndex);
          if (!cell) return;
          if (teacherUid) cell.teacherUids.add(teacherUid);

          const sid = (student?.id || '').toString().trim();
          const name = (student?.name || '—').toString();
          const dedupeKey = sid ? `id:${sid}` : `name:${name}`;
          const seen = getAbsentSet(className, lessonIndex);
          if (seen.has(dedupeKey)) return;
          seen.add(dedupeKey);

          cell.count += 1;
          cell.students.push({ id: sid, name, className: student?.className || className });
        };

        const addLateStudentToCell = (className, lessonIndex, student, teacherUid = null) => {
          const cell = markAttendanceTaken(className, lessonIndex);
          if (!cell) return;
          if (teacherUid) cell.teacherUids.add(teacherUid);

          const sid = (student?.id || '').toString().trim();
          const name = (student?.name || '—').toString();
          const dedupeKey = sid ? `id:${sid}` : `name:${name}`;
          const seen = getLateSet(className, lessonIndex);
          if (seen.has(dedupeKey)) return;
          seen.add(dedupeKey);

          cell.lateCount += 1;
          cell.lateStudents.push({ id: sid, name, className: student?.className || className });
        };

        // Legacy top-level attendance sessions
        try {
          legacySessions?.forEach((docSnap) => {
            const r = docSnap.data() || {};
            const className = normalizeClassName(r.class || r.classKey || '');
            const lessonIndex = parseLessonIndex(r.lessonIndex, r.lesson);
            if (!className || !lessonIndex) return;

            const teacherUid = (r.createdBy || r.teacherUid || r.updatedBy || '').toString().trim() || null;
            const cell = markAttendanceTaken(className, lessonIndex);
            if (!cell) return;
            if (teacherUid) cell.teacherUids.add(teacherUid);

            const absentList = Array.isArray(r.absent) ? r.absent : [];
            absentList.forEach((raw) => {
              const rawId = (raw || '').toString().trim();
              if (!rawId) return;
              const linked = studentsById.get(rawId);
              addAbsentStudentToCell(className, lessonIndex, {
                id: rawId,
                name: linked?.name || rawId,
                className: linked?.className || className
              }, teacherUid);
            });
          });
        } catch (error) {
          console.error('Error loading legacy attendance sessions:', error);
        }

        // New attendanceSessions + attendanceRecords structure
        try {
          for (const session of (sessions || [])) {
            const data = session.data || {};
            const className = normalizeClassName(data.classKey || data.class || '');
            const lessonIndex = parseLessonIndex(data.lesson, data.lessonIndex);
            if (!className || !lessonIndex) continue;

            const teacherUid = (data.teacherUid || data.createdBy || data.updatedBy || '').toString().trim() || null;
            const cell = markAttendanceTaken(className, lessonIndex);
            if (!cell) continue;
            if (teacherUid) cell.teacherUids.add(teacherUid);
            cell.sessionId = session.id;

            session.records?.forEach((recordSnap) => {
              const rec = recordSnap.data() || {};
              const status = (rec.status || '').toString();
              if (status !== 'absent' && status !== 'late') return;

              const uid = (recordSnap.id || rec.uid || '').toString().trim();
              const linked = uid ? studentsById.get(uid) : null;
              const name = (linked?.name || rec.studentName || uid || '—').toString();
              const recTeacherUid = (rec.updatedBy || rec.createdBy || teacherUid || '').toString().trim() || null;
              const studentObj = { id: uid, name, className: linked?.className || className };
              if (status === 'absent') {
                addAbsentStudentToCell(className, lessonIndex, studentObj, recTeacherUid);
              } else {
                addLateStudentToCell(className, lessonIndex, studentObj, recTeacherUid);
              }
            });
          }
        } catch (error) {
          console.error('Error loading attendance sessions:', error);
        }

        const applyLegacyStudentRecord = (docSnap) => {
          const parts = splitPathSegments(docSnap.ref?.path);
          if (parts.length < 4) return;
          if (parts[0] !== 'students' || parts[2] !== 'attendance') return;

          const studentId = parts[1];
          const rec = docSnap.data() || {};
          const linked = studentsById.get(studentId);
          const className = normalizeClassName(rec.class || rec.classKey || linked?.className || '');
          const lessonIndex = parseLessonIndex(rec.lessonIndex, rec.lesson);
          if (!className || !lessonIndex) return;

          const teacherUid = (rec.updatedBy || rec.createdBy || '').toString().trim() || null;
          const cell = markAttendanceTaken(className, lessonIndex);
          if (!cell) return;
          if (teacherUid) cell.teacherUids.add(teacherUid);

          const legStatus = (rec.status || '').toString();
          if (legStatus !== 'absent' && legStatus !== 'late') return;
          const legStudent = {
            id: studentId,
            name: (linked?.name || rec.studentName || studentId || '—').toString(),
            className: linked?.className || className
          };
          if (legStatus === 'absent') {
            addAbsentStudentToCell(className, lessonIndex, legStudent, teacherUid);
          } else {
            addLateStudentToCell(className, lessonIndex, legStudent, teacherUid);
          }
        };

        try {
          legacyByDateSnap?.forEach(applyLegacyStudentRecord);
        } catch (error) {
          console.error('Error loading legacy attendance by date:', error);
        }
        try {
          legacyByCreatedAtSnap?.forEach(applyLegacyStudentRecord);
        } catch (error) {
          console.error('Error loading legacy attendance by createdAt:', error);
        }

        // Mark expected scheduled lessons (teacher names already resolved above).
        for (const cn of ALL_CLASSES){
          for (let li = 1; li <= 7; li++){
            const sch = scheduleMap?.[cn]?.[li];
            const cell = ensureCell(cn, li);
            if (!sch || !(sch.teacherUid || sch.teacherName || sch.subject)) continue;

            cell.expectedSubject = sch.subject || "";
            if (sch.teacherUid) cell.expectedTeacherUids.add(sch.teacherUid);

            if (sch.teacherName) {
              cell.expectedTeacherNames.add(sch.teacherName);
            } else if (sch.teacherUid) {
              const nm = teacherNames.get(sch.teacherUid);
              if (nm) cell.expectedTeacherNames.add(nm);
            }
          }
        }

        updateMissedStatus();
        startMissedUpdateInterval();
        requestAnimationFrame(syncHeaderH);
        return true;
      }

      function setGridLoadingState(isLoading) {
        dateBtn.disabled = isLoading;
      }

      // silent: keep the current grid on screen (no loading state, no closing
      // whatever popup is open) and swap the fresh one in once it's ready —
      // used for refreshes of data that's already showing.
      async function requestGridLoad(dateObj, { silent = false } = {}) {
        const d = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
        selectedDate = d;
        if (!silent) {
          closeModal();
          closePopover();
        }

        const requestId = ++gridLoadRequestId;
        if (!silent) {
          setGridLoadingState(true);
          show(sLoading);
        }

        try {
          const loaded = await loadGridForDate(d, requestId);
          if (requestId !== gridLoadRequestId) return;
          if (loaded) {
            gridLoadedAt = Date.now();
            show(sOk);
          }
        } catch (e) {
          if (requestId !== gridLoadRequestId) return;
          console.error(e);
          // A failed background refresh keeps the grid that's already showing.
          if (!silent) {
            gridBody.innerHTML = '';
            show(sDenied);
          }
        } finally {
          if (requestId === gridLoadRequestId) {
            setGridLoadingState(false);
          }
        }
      }

      // Fresh data for the date on screen. Silent when a grid is already
      // showing; if a load is still in flight, that load is already fresh.
      // Skipped when the grid is under a minute old — reopening the sheet
      // just after closing it would otherwise re-read every
      // student and session for data seconds old — unless `force` (after
      // an attendance save, which the grid must reflect right away).
      function refreshGrid({ force = false } = {}){
        if (sOk.classList.contains('active')) {
          if (!force && Date.now() - gridLoadedAt < 60000) return;
          requestGridLoad(selectedDate, { silent: true });
        } else if (sDenied.classList.contains('active')) {
          requestGridLoad(selectedDate);
        }
      }

      async function applySelectedDateValue(isoValue) {
        if (!isoValue) return;
        const d = fromInputDate(isoValue);
        if (Number.isNaN(d.getTime())) return;
        await requestGridLoad(d);
      }

      // Date picker open handling
      dateBtn.addEventListener('click', () => {
        if (dateBtn.disabled) return;

        // Try showPicker when available (modern browsers)
        try {
          if (typeof mobileDateInput.showPicker === 'function') {
            mobileDateInput.showPicker();
            return;
          }
        } catch {}

        // Fallback: focus + click (works in many mobiles)
        mobileDateInput.focus({ preventScroll: true });
        mobileDateInput.click();
      });

      mobileDateInput.addEventListener('change', async () => {
        if (!mobileDateInput.value) return;
        await applySelectedDateValue(mobileDateInput.value);
      });

      // adminpage.html has already signed the user in, checked the admin
      // role and read the class list before it can open this sheet, and
      // hands all three over — so this goes straight to the grid instead of
      // waiting on another auth round and re-reading teachers/{uid} and
      // settings/classes first.
      (async () => {
        const { user, data, classList } = hooks.getSession() || {};
        if (!user) { show(sNotLog); return; }
        if (!canManageAttendance(data)) { show(sDenied); return; }

        try {
          ALL_CLASSES = sortClassList(classList || await fetchClassList(db));
          await requestGridLoad(fromInputDate(kuwaitTodayISO()));
        } catch (e) {
          console.error(e);
          show(sDenied);
        }
      })();

      // Where the back button used to be: opens adminpage.html's sidebar,
      // which sits above the sheet and can switch to any other section.
      menuBtn.addEventListener('click', () => {
        hooks.openSidebar();
      });

      // adminpage.html opens the student's page (/admins/students.html); a
      // host where that page isn't available (Teachers/user.html, for a
      // teacher allowed to manage attendance) passes openStudent to show
      // its own student profile sheet instead.
      function openStudent(id, className, name){
        if (!id) return;
        if (typeof hooks.openStudent === 'function') { hooks.openStudent(id, { name, className }); return; }
        window.location.href = `/admins/students.html?student=${encodeURIComponent(id)}&class=${encodeURIComponent(className || '')}`;
      }

      // FIX: Close popover only if click is outside popover (and not inside)
      document.addEventListener('click', (e) => {
        if (!popover.classList.contains('open')) return;
        if (e.composedPath().includes(popover)) return;
        closePopover();
      });

      window.addEventListener('resize', () => {
        if (sOk.classList.contains('active')) syncHeaderH();
      });

      window.addEventListener('load', () => {
        syncHeaderH();
        // One more sync after fonts render
        setTimeout(syncHeaderH, 250);
      });

      // Existing popover functions (kept for compatibility)
      function closePopover(){
        popBackdrop.classList.remove('open');
        popBackdrop.setAttribute('aria-hidden', 'true');
        popover.classList.remove('open');
        popover.setAttribute('aria-hidden', 'true');
      }

      popBackdrop.addEventListener('click', closePopover);
      popClose.addEventListener('click', closePopover);
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && popover.classList.contains('open')) closePopover();
      });

      popover.addEventListener('click', (e) => e.stopPropagation());

      async function openPopoverForCell(anchorEl, className, lessonIndex, mode){
        // Redirect to modal for consistency
        openModalForCell(anchorEl, className, lessonIndex, mode);
      }

      // ===================== Download absence report (PDF) =====================
      const PDF_RENDER_SCALE = 1.5;
      const LESSON_ORDINALS = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة"];
      const ROWS_PER_PAGE = 20;

      let dlPeriodMode = 'single';
      let dlClassMode = 'all';

      function dlSetPeriodMode(mode){
        dlPeriodMode = mode;
        dlPeriodSeg.querySelectorAll('.dl-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.period === mode));
        dlSingleInfo.hidden = mode !== 'single';
        dlRangeRow.hidden = mode !== 'range';
      }
      function dlSetClassMode(mode){
        dlClassMode = mode;
        dlClassSeg.querySelectorAll('.dl-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.scope === mode));
        dlClassRow.hidden = mode !== 'one';
      }

      function setDlStatus(kind, html){
        if (!html) { dlStatus.hidden = true; dlStatus.innerHTML = ''; return; }
        dlStatus.hidden = false;
        dlStatus.className = `dl-status ${kind}`;
        dlStatus.innerHTML = html;
      }

      function openDownloadModal(){
        if (dlDownloadBtn.classList.contains('loading')) return;
        dlSetPeriodMode('single');
        dlSetClassMode('all');
        const iso = toInputDate(selectedDate);
        dlSingleDateText.textContent = toArabicDigits(fmtDateLong(selectedDate));
        dlFromDate.value = iso;
        dlToDate.value = iso;
        dlFromDate.max = kuwaitTodayISO();
        dlToDate.max = kuwaitTodayISO();
        dlClassSelect.innerHTML = ALL_CLASSES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(toArabicDigits(c))}</option>`).join('');
        setDlStatus(null);
        document.body.classList.add('modal-open');
        downloadBackdrop.classList.add('open');
        downloadModal.classList.add('open');
      }
      function closeDownloadModal(){
        if (dlDownloadBtn.classList.contains('loading')) return;
        document.body.classList.remove('modal-open');
        downloadBackdrop.classList.remove('open');
        downloadModal.classList.remove('open');
      }

      downloadBtn.addEventListener('click', openDownloadModal);
      downloadClose.addEventListener('click', closeDownloadModal);
      dlCancelBtn.addEventListener('click', closeDownloadModal);
      downloadBackdrop.addEventListener('click', closeDownloadModal);
      downloadModal.addEventListener('click', (e) => { if (e.target === downloadModal) closeDownloadModal(); });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && downloadModal.classList.contains('open')) closeDownloadModal();
      });

      dlPeriodSeg.addEventListener('click', (e) => {
        const btn = e.target.closest('.dl-seg-btn'); if (!btn) return;
        dlSetPeriodMode(btn.dataset.period);
      });
      dlClassSeg.addEventListener('click', (e) => {
        const btn = e.target.closest('.dl-seg-btn'); if (!btn) return;
        dlSetClassMode(btn.dataset.scope);
      });

      function formatDateArabicShort(iso){
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
        if (!m) return iso || '—';
        return toArabicDigits(`${Number(m[3])}/${Number(m[2])}`);
      }

      // Schedule map cache (per weekday, reused across every date in a range) —
      // used only to look up the subject for display; the actual attendance
      // records are always date-specific and never cached.
      const dlScheduleCache = new Map();
      async function getScheduleMapForDayIndex(dayIndex){
        if (dlScheduleCache.has(dayIndex)) return dlScheduleCache.get(dayIndex);
        const map = Object.create(null);
        try {
          const snap = await getDocs(query(collection(db, 'schedules'), where('dayIndex', '==', dayIndex)));
          snap.forEach(ds => {
            const x = ds.data() || {};
            const li = Number((x.lesson || '').toString());
            if (!Number.isFinite(li) || li < 1 || li > 7) return;
            const classKey = normalizeClassName(x.classKey || x.class || '');
            if (!classKey) return;
            if (!map[classKey]) map[classKey] = {};
            map[classKey][li] = { subject: (x.subject || '').toString() };
          });
        } catch (e) { console.error('Error loading schedule for dayIndex', dayIndex, e); }
        try {
          const customSnap = await getDocs(query(collection(db, 'customDaySchedules'), where('dayIndex', '==', dayIndex)));
          customSnap.forEach(ds => {
            const x = ds.data() || {};
            if (x.deletedAt || x.enabled !== true) return;
            const classKey = normalizeClassName(x.classKey || x.class || '');
            if (!classKey) return;
            const lessons = Array.isArray(x.lessons) ? x.lessons : [];
            if (!map[classKey]) map[classKey] = {};
            const maxLessons = Math.min(7, Number(x.lessonCount) || lessons.length || 7);
            for (let li = 1; li <= maxLessons; li++) {
              if (map[classKey][li]) continue;
              const lesson = lessons[li - 1] || {};
              map[classKey][li] = { subject: (lesson.subject || '').toString() };
            }
          });
        } catch (e) { console.error('Error loading custom schedules for dayIndex', dayIndex, e); }
        dlScheduleCache.set(dayIndex, map);
        return map;
      }

      // Flat absence/late row fetch for one date — mirrors loadGridForDate's
      // multi-source logic (legacy top-level sessions, modern
      // attendanceSessions/attendanceRecords, legacy per-student subcollection
      // by date, and its createdAt-range fallback) but returns a flat row list
      // instead of aggregating into the on-screen grid.
      async function fetchAbsenceRowsForDate(dateISO, studentsById){
        const rows = [];
        const seen = new Set();
        const pushRow = (row) => {
          const key = `${row.className}|${row.lessonIndex}|${row.status}|${row.studentId || row.studentName}`;
          if (seen.has(key)) return;
          seen.add(key);
          rows.push(row);
        };

        const dayIndex = weekdayFromISO(dateISO);
        const scheduleMapForDay = await getScheduleMapForDayIndex(dayIndex);
        const subjectFor = (className, lessonIndex) => scheduleMapForDay?.[className]?.[lessonIndex]?.subject || '';

        try {
          const legacySessions = await getDocs(query(collection(db, 'attendance'), where('date', '==', dateISO)));
          legacySessions.forEach((docSnap) => {
            const r = docSnap.data() || {};
            const className = normalizeClassName(r.class || r.classKey || '');
            const lessonIndex = parseLessonIndex(r.lessonIndex, r.lesson);
            if (!className || !lessonIndex) return;
            const teacherUid = (r.createdBy || r.teacherUid || r.updatedBy || '').toString().trim() || null;
            const absentList = Array.isArray(r.absent) ? r.absent : [];
            absentList.forEach((raw) => {
              const rawId = (raw || '').toString().trim();
              if (!rawId) return;
              const linked = studentsById.get(rawId);
              pushRow({
                dateISO, className, lessonIndex, status: 'absent',
                studentId: rawId, studentName: linked?.name || rawId,
                subject: subjectFor(className, lessonIndex), teacherUid
              });
            });
          });
        } catch (error) {
          console.error('Error loading legacy attendance sessions:', error);
        }

        try {
          const sessionsSnap = await getDocs(query(collection(db, 'attendanceSessions'), where('date', '==', dateISO)));
          const sessions = [];
          sessionsSnap.forEach((docSnap) => sessions.push({ id: docSnap.id, data: docSnap.data() || {} }));
          await promisePool(sessions, async (session) => {
            const data = session.data || {};
            const className = normalizeClassName(data.classKey || data.class || '');
            const lessonIndex = parseLessonIndex(data.lesson, data.lessonIndex);
            if (!className || !lessonIndex) return;
            const teacherUid = (data.teacherUid || data.createdBy || data.updatedBy || '').toString().trim() || null;
            let recordsSnap;
            try { recordsSnap = await getDocs(collection(db, 'attendanceSessions', session.id, 'attendanceRecords')); }
            catch { return; }
            recordsSnap.forEach((recordSnap) => {
              const rec = recordSnap.data() || {};
              const status = (rec.status || '').toString();
              if (status !== 'absent' && status !== 'late') return;
              const uid = (recordSnap.id || rec.uid || '').toString().trim();
              const linked = uid ? studentsById.get(uid) : null;
              const name = (linked?.name || rec.studentName || uid || '—').toString();
              const recTeacherUid = (rec.updatedBy || rec.createdBy || teacherUid || '').toString().trim() || null;
              pushRow({
                dateISO, className, lessonIndex, status,
                studentId: uid, studentName: name,
                subject: subjectFor(className, lessonIndex), teacherUid: recTeacherUid
              });
            });
          }, 10);
        } catch (error) {
          console.error('Error loading attendance sessions:', error);
        }

        const applyLegacyRow = (docSnap) => {
          const parts = splitPathSegments(docSnap.ref?.path);
          if (parts.length < 4) return;
          if (parts[0] !== 'students' || parts[2] !== 'attendance') return;
          const studentId = parts[1];
          const rec = docSnap.data() || {};
          const linked = studentsById.get(studentId);
          const className = normalizeClassName(rec.class || rec.classKey || linked?.className || '');
          const lessonIndex = parseLessonIndex(rec.lessonIndex, rec.lesson);
          if (!className || !lessonIndex) return;
          const status = (rec.status || '').toString();
          if (status !== 'absent' && status !== 'late') return;
          const teacherUid = (rec.updatedBy || rec.createdBy || '').toString().trim() || null;
          pushRow({
            dateISO, className, lessonIndex, status,
            studentId, studentName: (linked?.name || rec.studentName || studentId || '—').toString(),
            subject: subjectFor(className, lessonIndex), teacherUid
          });
        };

        try {
          const snap = await getDocs(query(collectionGroup(db, 'attendance'), where('date', '==', dateISO)));
          snap.forEach(applyLegacyRow);
        } catch (error) {
          console.error('Error loading legacy attendance by date:', error);
        }

        try {
          const startTs = Timestamp.fromDate(startOfDay(fromInputDate(dateISO)));
          const endTs = Timestamp.fromDate(endOfDay(fromInputDate(dateISO)));
          const snap = await getDocs(query(
            collectionGroup(db, 'attendance'),
            where('createdAt', '>=', startTs),
            where('createdAt', '<=', endTs)
          ));
          snap.forEach(applyLegacyRow);
        } catch (error) {
          console.error('Error loading legacy attendance by createdAt:', error);
        }

        return rows;
      }

      async function fetchAbsenceRows({ fromISO, toISO, classFilter }){
        const studentsSnap = await getDocs(collection(db, 'students'));
        const studentsById = new Map();
        studentsSnap.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const className = normalizeClassName(data.class || data.className || '');
          studentsById.set(docSnap.id, { id: docSnap.id, name: (data.name || '—').toString(), className });
        });

        const dates = [];
        let cursor = fromInputDate(fromISO);
        const lastISO = toISO;
        while (toInputDate(cursor) <= lastISO) {
          dates.push(toInputDate(cursor));
          cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
        }

        const perDateRows = await promisePool(dates, (d) => fetchAbsenceRowsForDate(d, studentsById), 4);
        let rows = perDateRows.flat();

        if (classFilter) {
          rows = rows.filter(r => r.className === classFilter);
        }

        const teacherUids = new Set(rows.map(r => r.teacherUid).filter(Boolean));
        await promisePool(Array.from(teacherUids), (uid) => getTeacherName(uid), 10);
        rows.forEach(r => { r.teacherName = r.teacherUid ? (teacherNameCache.get(r.teacherUid) || r.teacherUid) : '—'; });

        const classOrder = new Map(ALL_CLASSES.map((c, i) => [c, i]));
        rows.sort((a, b) => {
          if (a.dateISO !== b.dateISO) return a.dateISO < b.dateISO ? -1 : 1;
          const ca = classOrder.get(a.className) ?? 999, cb = classOrder.get(b.className) ?? 999;
          if (ca !== cb) return ca - cb;
          if (a.lessonIndex !== b.lessonIndex) return a.lessonIndex - b.lessonIndex;
          return arabicSort(a.studentName, b.studentName);
        });

        return rows;
      }

      function waitForImageReady(imgEl){
        return new Promise((resolve) => {
          if (!imgEl) { resolve(); return; }
          if (imgEl.complete && imgEl.naturalWidth > 0) { resolve(); return; }
          const done = () => { imgEl.removeEventListener('load', done); imgEl.removeEventListener('error', done); resolve(); };
          imgEl.addEventListener('load', done);
          imgEl.addEventListener('error', done);
        });
      }

      function addCanvasToA4Page(docPdf, canvas, margin = 16){
        const pageW = docPdf.internal.pageSize.getWidth();
        const pageH = docPdf.internal.pageSize.getHeight();
        const ratio = Math.min((pageW - margin * 2) / canvas.width, (pageH - margin * 2) / canvas.height);
        const drawW = canvas.width * ratio;
        const drawH = canvas.height * ratio;
        const x = (pageW - drawW) / 2;
        const y = margin;
        docPdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', x, y, drawW, drawH, undefined, 'FAST');
      }

      function statusBadgeHtml(status){
        return status === 'absent'
          ? '<span class="dl-pdf-badge absent">غياب</span>'
          : '<span class="dl-pdf-badge late">تأخير</span>';
      }

      function buildReportPageHost({ rows, meta, pageNum, totalPages }){
        const showDateCol = meta.multiDay;
        const showClassCol = !meta.singleClass;
        const colCount = 6 + (showDateCol ? 1 : 0) + (showClassCol ? 1 : 0);

        const headCells = [
          '<th class="col-idx">#</th>',
          showDateCol ? '<th class="col-date">التاريخ</th>' : '',
          '<th class="col-name">اسم الطالب</th>',
          showClassCol ? '<th class="col-class">الصف</th>' : '',
          '<th class="col-lesson">الحصة</th>',
          '<th class="col-subject">المادة</th>',
          '<th class="col-status">الحالة</th>',
          '<th class="col-teacher">سجّله</th>'
        ].join('');

        const bodyRows = rows.map((r, i) => {
          const cells = [
            `<td class="col-idx">${toArabicDigits(String(meta.startIndex + i + 1))}</td>`,
            showDateCol ? `<td class="col-date">${escapeHtml(formatDateArabicShort(r.dateISO))}</td>` : '',
            `<td class="col-name">${escapeHtml(r.studentName)}</td>`,
            showClassCol ? `<td class="col-class">${escapeHtml(toArabicDigits(r.className))}</td>` : '',
            `<td class="col-lesson">${escapeHtml(LESSON_ORDINALS[r.lessonIndex - 1] || '—')}</td>`,
            `<td class="col-subject">${escapeHtml(r.subject || '—')}</td>`,
            `<td class="col-status">${statusBadgeHtml(r.status)}</td>`,
            `<td class="col-teacher">${escapeHtml(r.teacherName || '—')}</td>`
          ].join('');
          return `<tr>${cells}</tr>`;
        }).join('');

        const host = document.createElement('div');
        host.style.position = 'fixed';
        host.style.top = '0';
        host.style.left = '-10000px';
        host.style.width = '794px';
        host.style.height = '1123px';
        host.style.zIndex = '-1';
        host.style.background = '#ffffff';

        host.innerHTML = `
          <style>
            #dlPdfPage {
              width: 794px; height: 1123px; box-sizing: border-box; overflow: hidden;
              background: #ffffff; color: #153554;
              font-family: "Noto Kufi Arabic", Tahoma, Arial, sans-serif;
              direction: rtl;
              padding: 30px 30px 22px;
              display: flex; flex-direction: column;
            }
            #dlPdfPage .pdf-header { text-align: center; margin-bottom: 14px; }
            #dlPdfPage .pdf-logo { width: auto; height: 58px; max-width: 220px; display: block; margin: 0 auto 8px; object-fit: contain; }
            #dlPdfPage .school-name { font-size: 19px; font-weight: 900; color: #0f3f63; margin-bottom: 4px; }
            #dlPdfPage .report-title { font-size: 15px; font-weight: 900; color: #184c74; margin-bottom: 6px; }
            #dlPdfPage .meta-line { font-size: 11px; font-weight: 800; color: #42698a; }
            #dlPdfPage .header-sep { border-top: 2px solid #d7e4f1; margin-top: 12px; }
            #dlPdfPage .table-wrap { width: 100%; border: 1px solid #c9dced; border-radius: 12px; overflow: hidden; margin-top: 4px; }
            #dlPdfPage table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            #dlPdfPage thead th {
              background: linear-gradient(135deg, #13466f, #2b6793); color: #fff;
              border-left: 1px solid rgba(255,255,255,.22);
              font-size: 11px; font-weight: 900; text-align: center; padding: 9px 4px;
            }
            #dlPdfPage thead th:last-child { border-left: none; }
            #dlPdfPage tbody td {
              font-size: 11px; font-weight: 700; color: #17324a; text-align: center;
              padding: 7px 4px; border-top: 1px solid #e7eef5; border-left: 1px solid #eef3f8;
              overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            #dlPdfPage tbody td:last-child { border-left: none; }
            #dlPdfPage tbody tr:nth-child(even) td { background: #f7fafc; }
            #dlPdfPage .col-idx { width: 34px; }
            #dlPdfPage .col-date { width: 78px; }
            #dlPdfPage .col-name { width: auto; text-align: right !important; padding-right: 10px !important; }
            #dlPdfPage .col-class { width: 86px; }
            #dlPdfPage .col-lesson { width: 64px; }
            #dlPdfPage .col-subject { width: 90px; }
            #dlPdfPage .col-status { width: 66px; }
            #dlPdfPage .col-teacher { width: auto; }
            #dlPdfPage .dl-pdf-badge {
              display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 10px; font-weight: 900;
            }
            #dlPdfPage .dl-pdf-badge.absent { background: rgba(239,68,68,.14); color: #b91c1c; }
            #dlPdfPage .dl-pdf-badge.late { background: rgba(245,158,11,.16); color: #92400e; }
            #dlPdfPage .pdf-footer {
              margin-top: auto; padding-top: 10px; display: flex; justify-content: space-between;
              font-size: 10px; font-weight: 800; color: #6f89a3; border-top: 1px solid #e7eef5;
            }
          </style>
          <div id="dlPdfPage">
            <div class="pdf-header">
              <img id="dlPdfLogo" class="pdf-logo" src="/images/schoollogo.png" alt="School Logo">
              <div class="school-name">ثانوية أحمد البشر الرومي</div>
              <div class="report-title">تقرير الغياب${meta.hasLate ? ' والتأخر' : ''}</div>
              <div class="meta-line">${escapeHtml(meta.summaryLine)}</div>
              <div class="header-sep"></div>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr>${headCells}</tr></thead>
                <tbody>${bodyRows || `<tr><td colspan="${colCount}" style="padding:20px;color:#8aa0b6;font-weight:800;">لا توجد بيانات في هذه الصفحة</td></tr>`}</tbody>
              </table>
            </div>
            <div class="pdf-footer">
              <span>صفحة ${toArabicDigits(String(pageNum))} من ${toArabicDigits(String(totalPages))}</span>
              <span>تاريخ الإصدار: ${escapeHtml(toArabicDigits(fmtDateLong(new Date())))}</span>
            </div>
          </div>
        `;
        return host;
      }

      async function renderReportPageCanvas(pageRows, meta, pageNum, totalPages){
        const host = buildReportPageHost({ rows: pageRows, meta, pageNum, totalPages });
        document.body.appendChild(host);
        try {
          if (document.fonts?.ready) await document.fonts.ready;
          const logoEl = host.querySelector('#dlPdfLogo');
          try { await waitForImageReady(logoEl); } catch (_) {}
          const pageEl = host.querySelector('#dlPdfPage');
          return await window.html2canvas(pageEl, { backgroundColor: '#ffffff', scale: PDF_RENDER_SCALE, useCORS: true, logging: false });
        } finally {
          host.remove();
        }
      }

      function chunkRows(arr, size){
        const out = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
      }

      // The PDF libraries used to be <script defer> tags in this page's own
      // <head>. As a sheet they load the first time "تنزيل" is used.
      let pdfLibrariesPromise = null;
      function loadPdfLibraries(){
        if (!pdfLibrariesPromise) {
          const load = src => new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src; script.onload = resolve;
            script.onerror = () => { script.remove(); reject(new Error('PDF library failed to load')); };
            document.head.appendChild(script);
          });
          pdfLibrariesPromise = Promise.all([
            load('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'),
            load('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'),
          ]).catch(error => { pdfLibrariesPromise = null; throw error; });
        }
        return pdfLibrariesPromise;
      }

      async function generateAbsenceReportPdf(){
        if (!window.html2canvas || !window.jspdf?.jsPDF) {
          setDlStatus('info', '<i class="fas fa-spinner fa-spin"></i> جاري تحميل أدوات التصدير…');
          try {
            await loadPdfLibraries();
          } catch {
            setDlStatus('error', '<i class="fas fa-triangle-exclamation"></i> تعذّر تحميل مكتبة إنشاء PDF. تحقّق من الاتصال وحاول مرة أخرى.');
            return;
          }
        }

        let fromISO, toISO;
        if (dlPeriodMode === 'single') {
          fromISO = toISO = toInputDate(selectedDate);
        } else {
          fromISO = dlFromDate.value;
          toISO = dlToDate.value;
          if (!fromISO || !toISO) {
            setDlStatus('error', '<i class="fas fa-triangle-exclamation"></i> اختر تاريخي البداية والنهاية.');
            return;
          }
          if (fromISO > toISO) {
            setDlStatus('error', '<i class="fas fa-triangle-exclamation"></i> تاريخ البداية يجب أن يسبق تاريخ النهاية.');
            return;
          }
        }

        const classFilter = dlClassMode === 'one' ? dlClassSelect.value : null;
        if (dlClassMode === 'one' && !classFilter) {
          setDlStatus('error', '<i class="fas fa-triangle-exclamation"></i> اختر الصف والفصل.');
          return;
        }

        dlDownloadBtn.classList.add('loading');
        dlCancelBtn.disabled = true;
        setDlStatus('info', '<i class="fas fa-spinner fa-spin"></i> جاري جلب بيانات الغياب...');

        try {
          const rows = await fetchAbsenceRows({ fromISO, toISO, classFilter });

          if (!rows.length) {
            setDlStatus('info', '<i class="fas fa-circle-info"></i> لا توجد أي حالات غياب أو تأخير ضمن هذا النطاق.');
            return;
          }

          const multiDay = fromISO !== toISO;
          const singleClass = !!classFilter;
          const hasLate = rows.some(r => r.status === 'late');

          const periodText = multiDay
            ? `من ${toArabicDigits(formatDateArabicShort(fromISO))} إلى ${toArabicDigits(formatDateArabicShort(toISO))}`
            : `ليوم ${toArabicDigits(fmtDateLong(fromInputDate(fromISO)))}`;
          const classText = singleClass ? ` — الصف ${toArabicDigits(classFilter)}` : ' — كل الصفوف';
          const summaryLine = `${periodText}${classText} — إجمالي الحالات: ${toArabicDigits(String(rows.length))}`;

          const meta = { multiDay, singleClass, hasLate, summaryLine };
          const pages = chunkRows(rows, ROWS_PER_PAGE);
          const totalPages = pages.length;

          const { jsPDF } = window.jspdf;
          const docPdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });

          for (let i = 0; i < pages.length; i++) {
            setDlStatus('info', `<i class="fas fa-spinner fa-spin"></i> جاري إنشاء الصفحة ${toArabicDigits(String(i + 1))} من ${toArabicDigits(String(totalPages))}...`);
            const canvas = await renderReportPageCanvas(pages[i], { ...meta, startIndex: i * ROWS_PER_PAGE }, i + 1, totalPages);
            if (i > 0) docPdf.addPage('a4', 'portrait');
            addCanvasToA4Page(docPdf, canvas, 16);
          }

          const scopeName = singleClass ? filenameSafe(classFilter) : 'كل-الصفوف';
          const periodName = multiDay ? `${filenameSafe(fromISO)}_${filenameSafe(toISO)}` : filenameSafe(fromISO);
          docPdf.save(`تقرير-الغياب-${scopeName}-${periodName}.pdf`);

          setDlStatus('ok', '<i class="fas fa-circle-check"></i> تم تنزيل التقرير بنجاح.');
        } catch (e) {
          console.error('[generateAbsenceReportPdf]', e);
          setDlStatus('error', '<i class="fas fa-triangle-exclamation"></i> تعذّر إنشاء التقرير. حاول مرة أخرى.');
        } finally {
          dlDownloadBtn.classList.remove('loading');
          dlCancelBtn.disabled = false;
        }
      }

      dlDownloadBtn.addEventListener('click', generateAbsenceReportPdf);

      // Lets adminpage.html refresh the grid each time the sheet is opened
      // (it stays mounted between opens).
      return { refresh: refreshGrid };
}
