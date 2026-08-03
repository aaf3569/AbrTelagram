import {
  doc, getDoc, getDocs, collection, query, where,
  serverTimestamp, writeBatch, setDoc, Timestamp,
} from "/shared/firebase.js";
import {
  DAY_AR_BY_INDEX,
  parseTimeToMinutes,
  kuwaitTodayISO,
  getCurrentKuwaitMinutes,
  kuwaitDateTimeToDate,
  addMinutesToDate,
  getKuwaitDayIndexSunThu,
  getKuwaitDayIndexSunSat,
} from "/shared/kuwait-time.js";

const STYLE_ID = "attendance-sheet-style";
const ATTENDANCE_SESSIONS_COLLECTION = "attendanceSessions";
const ATTENDANCE_RECORDS_SUBCOLLECTION = "attendanceRecords";

const STYLES = `
  /* Attendance sheet — bundled by /shared/attendance.js */
  /* Relies on host page providing .sheet, .modal, .btn, .btn.primary, .btn.cancel chrome. */
  #attendanceSheet .att-list{display:flex;flex-direction:column;gap:16px}
  #attendanceSheet .att-card{padding:16px;border:1px solid var(--border);border-radius:16px;background:#fff;box-shadow:var(--shadow-1);display:flex;flex-direction:column;gap:12px;transition:var(--transition)}
  #attendanceSheet .att-card:hover{box-shadow:0 10px 25px rgba(3,60,84,.12)}
  #attendanceSheet .att-card.special-case{background-color:var(--special-case-bg,#fff8e1);border:2px solid var(--special-case-border,#ffd54f);box-shadow:0 8px 22px rgba(255,213,79,.25)}
  #attendanceSheet .att-card.special-case.tint-late,#attendanceSheet .att-card.special-case.tint-absent{background-color:rgba(255,248,225,.9);border:2px solid var(--special-case-border,#ffd54f)}
  #attendanceSheet .att-card.tint-late{background:rgba(160,109,0,.10);border-color:rgba(160,109,0,.25)}
  #attendanceSheet .att-card.tint-absent{background:rgba(180,35,24,.10);border-color:rgba(180,35,24,.25)}
  #attendanceSheet .att-name{font-weight:900;color:var(--text);line-height:1.4;word-break:break-word;display:flex;align-items:center;justify-content:space-between;gap:10px}
  #attendanceSheet .att-student-info{display:flex;align-items:center;gap:8px;flex:1}
  #attendanceSheet .att-number-badge{background:var(--primary-extra-light,#eef5fb);color:var(--primary);font-size:.8rem;font-weight:700;padding:2px 8px;border-radius:10px;border:1px solid rgba(3,60,84,.15);flex-shrink:0}
  #attendanceSheet .att-lesson-dots{display:flex;justify-content:flex-start;gap:6px;flex-wrap:wrap;margin-top:-4px;margin-bottom:2px}
  #attendanceSheet .att-lesson-dot{width:24px;height:24px;padding:0;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:.76rem;font-weight:900;border:1px solid transparent;line-height:1;font-family:inherit;transition:var(--transition);cursor:pointer}
  #attendanceSheet .att-lesson-dot:hover{transform:scale(1.14)}
  #attendanceSheet .att-lesson-dot.present{background:var(--greenBg,rgba(26,127,55,.08));color:var(--green,#1a7f37);border-color:rgba(26,127,55,.25)}
  #attendanceSheet .att-lesson-dot.late{background:var(--yellowBg,rgba(160,109,0,.10));color:var(--yellow,#a06d00);border-color:rgba(160,109,0,.25)}
  #attendanceSheet .att-lesson-dot.absent{background:var(--redBg,rgba(180,35,24,.10));color:var(--red,#b42318);border-color:rgba(180,35,24,.25)}
  #attendanceSheet .att-lesson-dot.missing{background:rgba(234,88,12,.12);color:#c2410c;border-color:rgba(234,88,12,.3)}
  #attendanceSheet .att-lesson-dot.future{background:rgba(148,163,184,.10);color:#94a3b8;border-color:rgba(148,163,184,.25);opacity:.65;cursor:default}
  #attendanceSheet .att-lesson-dot.future:hover{transform:none}
  #attendanceSheet .special-case-icon{width:18px;height:18px;margin-inline-start:8px;flex-shrink:0}
  #attendanceSheet .sheet-header .sheet-title{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);flex:none;text-align:center;max-width:calc(100% - 220px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #attendanceSheet .lesson-picker{width:100%}
  #attendanceSheet .att-row{display:flex;gap:12px;flex-wrap:wrap}
  #attendanceSheet .seg{display:flex;align-items:center;border:1px solid var(--border);border-radius:14px;overflow:hidden;background:#fff;box-shadow:var(--shadow-1)}
  #attendanceSheet .seg button{flex:1 1 0;min-height:48px;padding:12px 10px;background:transparent;border:0;cursor:pointer;font-weight:900;font-size:1rem;font-family:"Noto Kufi Arabic", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;transition:var(--transition)}
  #attendanceSheet .seg .sep{width:1px;height:32px;background:var(--border)}
  #attendanceSheet .seg .present{color:var(--green,#1a7f37)}
  #attendanceSheet .seg .late{color:var(--yellow,#a06d00)}
  #attendanceSheet .seg .absent{color:var(--red,#b42318)}
  #attendanceSheet .seg button.active.present{background:var(--greenBg,rgba(26,127,55,.08))}
  #attendanceSheet .seg button.active.late{background:var(--yellowBg,rgba(160,109,0,.10))}
  #attendanceSheet .seg button.active.absent{background:var(--redBg,rgba(180,35,24,.10))}
  #attendanceSheet .seg button:disabled{opacity:.5;cursor:not-allowed;box-shadow:none;transform:none}
  #attendanceSheet .stats{padding:20px;border:1px solid var(--border);border-radius:16px;background:#fff;box-shadow:var(--shadow-1);display:flex;flex-direction:column;gap:16px}
  #attendanceSheet .chips{display:flex;gap:10px;flex-wrap:wrap}
  #attendanceSheet .pill{background:var(--chip,#eef5fb);color:var(--text);border:1px solid var(--border);padding:8px 14px;border-radius:999px;font-size:.92rem;font-weight:800;display:inline-flex;align-items:center;gap:6px}
  #attendanceSheet .pill.g{color:var(--green,#1a7f37);border-color:var(--greenBg,rgba(26,127,55,.08));background:var(--greenBg,rgba(26,127,55,.08))}
  #attendanceSheet .pill.y{color:var(--yellow,#a06d00);border-color:var(--yellowBg,rgba(160,109,0,.10));background:var(--yellowBg,rgba(160,109,0,.10))}
  #attendanceSheet .pill.r{color:var(--red,#b42318);border-color:var(--redBg,rgba(180,35,24,.10));background:var(--redBg,rgba(180,35,24,.10))}
  #attendanceSheet .submit-row{display:flex;justify-content:flex-start}
  #attendanceSheet .btn.submit{min-height:60px;padding-inline:26px;border-radius:16px;box-shadow:0 16px 40px rgba(3,60,84,.32);background:linear-gradient(145deg,var(--primary-light),var(--primary));color:#fff;border:none}
  #attendanceSheet .btn.submit:hover{transform:translateY(-2px)}
  #attendanceSheet .btn.submit:disabled{opacity:.5;cursor:not-allowed;box-shadow:none;transform:none}
  #attendanceSheet .lesson-controls{width:100%;display:flex;gap:12px;flex-wrap:wrap;align-items:center}
  #attendanceSheet .lesson-controls .select-wrap{flex:1 1 320px}
  #attendanceSheet .select-wrap{position:relative;max-width:380px;width:100%}
  #attendanceSheet .select{appearance:none;-webkit-appearance:none;-moz-appearance:none;width:100%;min-height:52px;padding:12px 16px;padding-inline-end:44px;border-radius:16px;font-weight:800;font-size:1rem;cursor:pointer;border:1px solid rgba(3,60,84,.15);background:linear-gradient(145deg,var(--primary),var(--primary-light));color:#fff;box-shadow:0 14px 32px rgba(3,60,84,.25);transition:var(--transition);font-family:"Noto Kufi Arabic", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif}
  #attendanceSheet .select:hover{transform:translateY(-2px);box-shadow:0 18px 40px rgba(3,60,84,.32)}
  #attendanceSheet .select:focus{outline:none;box-shadow:0 0 0 3px rgba(3,60,84,.18), 0 18px 40px rgba(3,60,84,.32)}
  #attendanceSheet .select-wrap::after{content:"";position:absolute;top:50%;transform:translateY(-50%);inset-inline-start:14px;width:22px;height:22px;pointer-events:none;opacity:.95;background:url('data:image/svg+xml;utf8,<svg fill="%23ffffff" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>') no-repeat center / 20px 20px;filter:drop-shadow(0 1px 0 rgba(0,0,0,.15))}
  #attendanceSheet .hint{font-weight:800;color:var(--muted)}
  #attConfirmModal .filter-buttons{display:flex;gap:10px;margin-bottom:16px;justify-content:center}
  #attConfirmModal .filter-btn{flex:1;min-height:50px;border-radius:12px;font-weight:800;border:2px solid var(--border);background:#fff;color:var(--primary);cursor:pointer;transition:var(--transition)}
  #attConfirmModal .filter-btn.active{background:var(--primary);color:#fff;border-color:var(--primary)}
  #attConfirmModal #attFilterAbsent{color:var(--red,#b42318);border-color:rgba(180,35,24,.35)}
  #attConfirmModal #attFilterAbsent.active{background:var(--red,#b42318);border-color:var(--red,#b42318);color:#fff}
  #attConfirmModal #attFilterLate{color:var(--yellow,#a06d00);border-color:rgba(160,109,0,.35)}
  #attConfirmModal #attFilterLate.active{background:var(--yellow,#a06d00);border-color:var(--yellow,#a06d00);color:#fff}
  #attConfirmModal .names-list{border:1px dashed var(--border);border-radius:14px;background:#fafcff;padding:12px;max-height:320px;overflow:auto}
  #attConfirmModal .names-list ul{margin:0;padding-inline-start:18px}
  #attConfirmModal .names-list li{margin:6px 0;font-weight:800}
  /* Module-owned blocked modal (red X animation) */
  #attBlockedModal.modal.blocked-modal .overlay{background:rgba(15,23,42,.45);backdrop-filter:blur(6px)}
  #attBlockedModal .blocked-card{position:relative;z-index:1;width:min(360px,92vw);background:linear-gradient(180deg,#ffffff 0%,#fff7f7 100%);border:1px solid rgba(185,28,28,.20);border-radius:18px;box-shadow:0 24px 60px rgba(185,28,28,.24);padding:18px;display:grid;justify-items:center;gap:12px;text-align:center}
  #attBlockedModal .blocked-close{position:absolute;top:8px;left:8px;width:32px;height:32px;border-radius:999px;border:1px solid rgba(185,28,28,.18);background:#fff;color:#7f1d1d;font-weight:900;cursor:pointer}
  #attBlockedModal .blocked-icon{width:96px;height:96px;display:grid;place-items:center}
  #attBlockedModal .blocked-icon svg{width:96px;height:96px;overflow:visible}
  #attBlockedModal .blocked-icon circle{fill:none;stroke:#dc2626;stroke-width:6;stroke-dasharray:220;stroke-dashoffset:220;animation:attBlockedRingDraw 1.2s ease-in-out infinite}
  #attBlockedModal .blocked-icon path{fill:none;stroke:#dc2626;stroke-width:7;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:56;stroke-dashoffset:56;animation:attBlockedXDraw 1.2s ease-in-out infinite}
  #attBlockedModal .blocked-title{margin:0;color:#991b1b;font-weight:900;font-size:1.06rem}
  #attBlockedModal .blocked-msg{margin:0;color:#7f1d1d;font-weight:800;font-size:.95rem;line-height:1.7}
  #attBlockedModal .blocked-actions{width:100%;display:flex;justify-content:center}
  #attBlockedModal .blocked-actions .btn{max-width:180px;min-height:52px}
  #attBlockedModal.open .blocked-card{animation:attBlockedCardIn .2s ease}
  /* Module-owned success celebration — looping green checkmark draw on a
     white/blurred backdrop, dismissed only via the labeled button below the
     text (no small icon-only close button — easy to miss and, since this
     modal makes the rest of the page inert while open like every other
     modal here, missing it makes the whole page look frozen). */
  #attSuccessModal .overlay{background:rgba(255,255,255,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
  #attSuccessModal .success-card{position:relative;z-index:1;width:min(340px,92vw);background:#fff;border:1px solid var(--border);border-radius:18px;box-shadow:0 24px 60px rgba(3,60,84,.24);padding:24px 22px;display:grid;justify-items:center;gap:14px}
  #attSuccessModal.open .success-card{animation:attBlockedCardIn .2s ease}
  #attSuccessModal .success-check{width:96px;height:96px;display:grid;place-items:center}
  #attSuccessModal .success-check svg{width:96px;height:96px;overflow:visible}
  #attSuccessModal .success-check circle{fill:none;stroke:#16a34a;stroke-width:6;stroke-dasharray:220;stroke-dashoffset:220;transform-origin:50% 50%;animation:attSuccessRingDraw 1.2s ease-in-out infinite}
  #attSuccessModal .success-check path{fill:none;stroke:#16a34a;stroke-width:7;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:70;stroke-dashoffset:70;animation:attSuccessCheckDraw 1.2s ease-in-out infinite}
  #attSuccessModal .success-title{font-weight:900;color:#166534;font-size:15px;text-align:center;line-height:1.5}
  #attSuccessModal .success-ok{width:100%;min-height:52px;margin-top:4px}
  @keyframes attSuccessRingDraw{0%{stroke-dashoffset:220;opacity:.5}30%{stroke-dashoffset:0;opacity:1}70%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:220;opacity:.5}}
  @keyframes attSuccessCheckDraw{0%{stroke-dashoffset:70;opacity:0}25%{stroke-dashoffset:70;opacity:0}45%{stroke-dashoffset:0;opacity:1}70%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:70;opacity:0}}
  @keyframes attBlockedCardIn{from{transform:translateY(8px) scale(.98);opacity:.7}to{transform:translateY(0) scale(1);opacity:1}}
  @keyframes attBlockedRingDraw{0%{stroke-dashoffset:220;opacity:.5}30%{stroke-dashoffset:0;opacity:1}70%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:220;opacity:.5}}
  @keyframes attBlockedXDraw{0%{stroke-dashoffset:56;opacity:0}25%{stroke-dashoffset:56;opacity:0}45%{stroke-dashoffset:0;opacity:1}70%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:56;opacity:0}}
  @media(max-width:640px){
    #attendanceSheet .att-row{width:100%}
    #attendanceSheet .lesson-controls{gap:10px}
  }
  /* Lesson detail popup */
  #attLessonDetailModal .detail-rows{display:grid;gap:10px;margin:14px 0}
  #attLessonDetailModal .detail-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--border);border-radius:12px;background:#fafcff}
  #attLessonDetailModal .detail-row .k{color:var(--muted);font-weight:800;font-size:.9rem}
  #attLessonDetailModal .detail-row .v{font-weight:900;color:var(--text)}
  #attLessonDetailModal .detail-status{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;font-weight:900;font-size:.88rem}
  #attLessonDetailModal .detail-status.present{color:var(--green,#1a7f37);background:var(--greenBg,rgba(26,127,55,.08))}
  #attLessonDetailModal .detail-status.late{color:var(--yellow,#a06d00);background:var(--yellowBg,rgba(160,109,0,.10))}
  #attLessonDetailModal .detail-status.absent{color:var(--red,#b42318);background:var(--redBg,rgba(180,35,24,.10))}
  #attLessonDetailModal .detail-status.missing{color:#c2410c;background:rgba(234,88,12,.12)}
  #attLessonDetailModal .detail-empty{color:var(--muted);font-weight:700;text-align:center;padding:8px 0}
`;

const SHEET_HTML = `
  <section id="attendanceSheet" class="sheet" aria-hidden="true">
    <div class="sheet-header">
      <button id="attCloseBtn" class="back-btn" type="button" aria-label="رجوع">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        رجوع
      </button>
      <h3 id="attSheetTitle" class="sheet-title">تسجيل الغياب</h3>
    </div>
    <div class="sheet-body">
      <div id="attLessonPicker" class="lesson-picker" style="display:none">
        <div class="lesson-controls">
          <div class="select-wrap">
            <select id="attLessonSelect" class="select" aria-label="اختر الحصة"></select>
          </div>
          <div id="attLessonHint" class="hint"></div>
        </div>
      </div>
      <div id="attendanceList" class="att-list"></div>
      <div class="stats">
        <div class="chips">
          <span id="attCountPresent" class="pill g">حضور: 0</span>
          <span id="attCountLate" class="pill y">تأخير: 0</span>
          <span id="attCountAbsent" class="pill r">غياب: 0</span>
        </div>
        <div class="submit-row">
          <button id="attSubmitBtn" class="btn submit" type="button">حفظ التقرير</button>
        </div>
      </div>
    </div>
  </section>
  <div id="attConfirmModal" class="modal" aria-hidden="true">
    <div class="overlay"></div>
    <div class="card" role="dialog" aria-modal="true" aria-labelledby="attConfirmTitle">
      <h3 id="attConfirmTitle">تأكيد حفظ التقرير | الحصة</h3>
      <p>سيتم حفظ الغياب للحصّة المحددة.</p>
      <div class="filter-buttons">
        <button id="attFilterAbsent" class="filter-btn active" type="button">الغياب</button>
        <button id="attFilterLate" class="filter-btn" type="button">التاخير</button>
      </div>
      <div class="names-list">
        <ul id="attConfirmAbsentList"></ul>
        <ul id="attConfirmLateList" style="display:none;"></ul>
      </div>
      <div class="row">
        <button id="attConfirmCancel" class="btn cancel" type="button">رجوع</button>
        <button id="attConfirmSave" class="btn primary" type="button">حفظ</button>
      </div>
    </div>
  </div>
  <div id="attErrorModal" class="modal" aria-hidden="true">
    <div class="overlay"></div>
    <div class="card error" role="alertdialog" aria-modal="true" aria-labelledby="attErrorTitle">
      <h3 id="attErrorTitle">تعذّر الحفظ</h3>
      <p id="attErrorBody">حدث خطأ غير متوقع.</p>
      <div class="row">
        <button id="attErrorOk" class="btn primary" type="button">حسناً</button>
      </div>
    </div>
  </div>
  <div id="attBlockedModal" class="modal blocked-modal" aria-hidden="true">
    <div class="overlay"></div>
    <div class="blocked-card" role="alertdialog" aria-modal="true" aria-labelledby="attBlockedTitle">
      <button id="attBlockedClose" type="button" class="blocked-close" aria-label="إغلاق">&times;</button>
      <div class="blocked-icon" aria-hidden="true">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="35"></circle>
          <path d="M35 35 L65 65"></path>
          <path d="M65 35 L35 65"></path>
        </svg>
      </div>
      <h3 id="attBlockedTitle" class="blocked-title">غير مسموح</h3>
      <p id="attBlockedBody" class="blocked-msg">ليس وقت الحصص الآن.</p>
      <div class="blocked-actions">
        <button id="attBlockedOk" class="btn primary" type="button">إغلاق</button>
      </div>
    </div>
  </div>
  <div id="attSuccessModal" class="modal" aria-hidden="true">
    <div class="overlay"></div>
    <div class="success-card" role="status" aria-live="polite">
      <div class="success-check" aria-hidden="true">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="35"></circle>
          <path d="M32 52 L45 65 L70 40"></path>
        </svg>
      </div>
      <div id="attSuccessTitle" class="success-title">تم</div>
      <button id="attSuccessOk" class="btn primary success-ok" type="button">إغلاق</button>
    </div>
  </div>
  <div id="attLessonDetailModal" class="modal" aria-hidden="true">
    <div class="overlay"></div>
    <div class="card" role="dialog" aria-modal="true" aria-labelledby="attLessonDetailTitle">
      <h3 id="attLessonDetailTitle">تفاصيل الحضور</h3>
      <div id="attLessonDetailBody" class="detail-rows"></div>
      <div class="row">
        <button id="attLessonDetailClose" class="btn primary" type="button">إغلاق</button>
      </div>
    </div>
  </div>
`;

const DEFAULT_LESSON_TIMES = [
  { index: 1, label: "الحصة الأولى", start: "07:55", end: "08:40" },
  { index: 2, label: "الحصة الثانية", start: "08:45", end: "09:30" },
  { index: 3, label: "الحصة الثالثة", start: "09:35", end: "10:20" },
  { index: 4, label: "الحصة الرابعة", start: "10:35", end: "11:20" },
  { index: 5, label: "الحصة الخامسة", start: "11:25", end: "12:10" },
  { index: 6, label: "الحصة السادسة", start: "12:25", end: "13:10" },
  { index: 7, label: "الحصة السابعة", start: "13:15", end: "13:55" },
];

const CUSTOM_SCHEDULE_CACHE_MS = 30000;

function toArabicDigits(num) {
  const ar = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩"];
  return String(num).replace(/\d/g, d => ar[parseInt(d)]);
}

function formatClassLabel(label) {
  return toArabicDigits(label || "");
}

function getStudentNumber(student) {
  const fields = ["studentNumber","number","no","roll","idNumber","studentNo"];
  for (const f of fields) {
    if (student[f] != null) {
      const n = parseInt(student[f]);
      if (!isNaN(n) && Number.isFinite(n)) return n;
    }
  }
  return Infinity;
}

function sortStudentsByStudentNumberOnly(students) {
  return [...students].sort((a, b) => {
    const A = getStudentNumber(a), B = getStudentNumber(b);
    if (A !== Infinity && B !== Infinity) return A - B;
    if (A !== Infinity) return -1;
    if (B !== Infinity) return 1;
    return 0;
  });
}

function createAttendanceSessionId(dateISO, lesson, classKey) {
  const k = classKey.replace(/\s+/g, "_").replace(/\//g, "-").replace(/[^\w\-]/g, "");
  return `${dateISO}_${lesson}_${k}`;
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLES;
  document.head.appendChild(el);
}

function injectMarkup() {
  if (document.getElementById("attendanceSheet")) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = SHEET_HTML.trim();
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
}

function lockBodyScroll(state) {
  if (state.locked) return;
  state.scrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.documentElement.classList.add("no-scroll");
  document.body.classList.add("no-scroll");
  document.body.style.top = `-${state.scrollY}px`;
  state.locked = true;
}

function unlockBodyScroll(state) {
  if (!state.locked) return;
  document.documentElement.classList.remove("no-scroll");
  document.body.classList.remove("no-scroll");
  document.body.style.top = "";
  window.scrollTo(0, state.scrollY || 0);
  state.locked = false;
}

export function mountAttendanceSheet({ db, auth, onSaved, onLateSubmit } = {}) {
  if (!db || !auth) {
    throw new Error("mountAttendanceSheet requires { db, auth }");
  }

  ensureStyles();
  injectMarkup();

  const els = {
    sheet: document.getElementById("attendanceSheet"),
    closeBtn: document.getElementById("attCloseBtn"),
    sheetTitle: document.getElementById("attSheetTitle"),
    lessonPicker: document.getElementById("attLessonPicker"),
    lessonSelect: document.getElementById("attLessonSelect"),
    lessonHint: document.getElementById("attLessonHint"),
    attList: document.getElementById("attendanceList"),
    countPresent: document.getElementById("attCountPresent"),
    countLate: document.getElementById("attCountLate"),
    countAbsent: document.getElementById("attCountAbsent"),
    submitBtn: document.getElementById("attSubmitBtn"),
    confirmModal: document.getElementById("attConfirmModal"),
    confirmTitle: document.getElementById("attConfirmTitle"),
    confirmAbsentList: document.getElementById("attConfirmAbsentList"),
    confirmLateList: document.getElementById("attConfirmLateList"),
    filterAbsent: document.getElementById("attFilterAbsent"),
    filterLate: document.getElementById("attFilterLate"),
    confirmCancel: document.getElementById("attConfirmCancel"),
    confirmSave: document.getElementById("attConfirmSave"),
    errorModal: document.getElementById("attErrorModal"),
    errorTitle: document.getElementById("attErrorTitle"),
    errorBody: document.getElementById("attErrorBody"),
    errorOk: document.getElementById("attErrorOk"),
    blockedModal: document.getElementById("attBlockedModal"),
    blockedTitle: document.getElementById("attBlockedTitle"),
    blockedBody: document.getElementById("attBlockedBody"),
    blockedClose: document.getElementById("attBlockedClose"),
    blockedOk: document.getElementById("attBlockedOk"),
    successModal: document.getElementById("attSuccessModal"),
    successTitle: document.getElementById("attSuccessTitle"),
    successOk: document.getElementById("attSuccessOk"),
    lessonDetailModal: document.getElementById("attLessonDetailModal"),
    lessonDetailTitle: document.getElementById("attLessonDetailTitle"),
    lessonDetailBody: document.getElementById("attLessonDetailBody"),
    lessonDetailClose: document.getElementById("attLessonDetailClose"),
  };

  const DEFAULT_SHEET_TITLE = "تسجيل الغياب";

  let LESSON_TIMES = DEFAULT_LESSON_TIMES.map(t => ({ ...t }));
  let customScheduleCache = { key: "", at: 0, rows: [] };
  const scrollState = { locked: false, scrollY: 0 };

  let attStatuses = {};
  let attStudentList = [];
  let takenLessonsByStudent = new Map();
  let takenLessonNumbers = new Set();
  let pendingSave = null;
  let currentMeta = null;

  // Sheet/modal helpers (operate on this module's elements only)
  function openSheet(el) {
    el.classList.add("open");
    el.setAttribute("aria-hidden", "false");
    lockBodyScroll(scrollState);
    document.querySelector("main")?.setAttribute("inert", "");
    document.querySelector(".site-header")?.setAttribute("inert", "");
  }
  function closeSheet(el) {
    el.classList.remove("open");
    el.setAttribute("aria-hidden", "true");
    if (el === els.sheet) els.sheetTitle.textContent = DEFAULT_SHEET_TITLE;
    if (!document.querySelector(".sheet.open, .modal.open")) {
      unlockBodyScroll(scrollState);
      document.querySelector("main")?.removeAttribute("inert");
      document.querySelector(".site-header")?.removeAttribute("inert");
    }
  }
  function openModal(el) {
    el.classList.add("open");
    el.setAttribute("aria-hidden", "false");
    lockBodyScroll(scrollState);
    document.querySelector("main")?.setAttribute("inert", "");
    document.querySelector(".site-header")?.setAttribute("inert", "");
  }
  function closeModal(el) {
    const a = document.activeElement;
    if (a && el.contains(a) && a instanceof HTMLElement) a.blur();
    el.classList.remove("open");
    el.setAttribute("aria-hidden", "true");
    if (!document.querySelector(".sheet.open, .modal.open")) {
      unlockBodyScroll(scrollState);
      document.querySelector("main")?.removeAttribute("inert");
      document.querySelector(".site-header")?.removeAttribute("inert");
    }
  }

  function showError(title, body) {
    els.errorTitle.textContent = title || "خطأ";
    els.errorBody.textContent = body || "حدث خطأ غير متوقع.";
    openModal(els.errorModal);
  }

  function showBlocked(reason) {
    let m;
    switch (reason) {
      case "outside_lessons":
      case "not_my_lesson":
        m = "يمكنك تسجيل الغياب فقط أثناء حصتك الحالية."; break;
      case "not_my_class":
        m = "ليس لديك حصة في هذا الفصل اليوم بحسب الجدول."; break;
      case "no_lessons_left":
        m = "لقد سجّلت الغياب لجميع حصصك في هذا الفصل اليوم بالفعل."; break;
      case "already_taken":
        m = "لقد سجّلت الغياب لهذه الحصة مسبقًا."; break;
      case "time_locked":
        m = "انتهى وقت تسجيل الغياب لهذه الحصة."; break;
      case "not_logged_in":
        m = "يرجى تسجيل الدخول أولاً."; break;
      default:
        m = "يمكنك تسجيل الغياب فقط أثناء حصتك الحالية.";
    }
    els.blockedBody.textContent = m;
    openModal(els.blockedModal);
  }

  // Looping green checkmark celebration. Stays open — no auto-dismiss —
  // until the teacher taps the labeled إغلاق button below the text.
  function showSuccessCelebration(title) {
    els.successTitle.textContent = title || "تم";
    openModal(els.successModal);
  }

  // Lesson time loading
  async function fetchLessonTimes() {
    try {
      const snap = await getDoc(doc(db, "settings", "lessonTimes"));
      if (snap.exists()) {
        const data = snap.data() || {};
        if (Array.isArray(data.times) && data.times.length === 7) {
          LESSON_TIMES = data.times.map((t, i) => ({
            index: i + 1,
            label: DEFAULT_LESSON_TIMES[i]?.label || `الحصة ${i + 1}`,
            start: (t?.start || DEFAULT_LESSON_TIMES[i]?.start || "00:00").toString(),
            end: (t?.end || DEFAULT_LESSON_TIMES[i]?.end || "00:00").toString(),
          }));
        }
      }
    } catch (e) {
      console.error("[attendance] fetchLessonTimes:", e);
    }
  }

  function getActiveLessonIndex() {
    const now = getCurrentKuwaitMinutes();
    for (const l of LESSON_TIMES) {
      const s = parseTimeToMinutes(l.start);
      const e = parseTimeToMinutes(l.end);
      if (now >= s && now <= e) return l.index;
    }
    return null;
  }

  function getLessonWindowStatus(lessonIndex) {
    const l = LESSON_TIMES.find(x => x.index === lessonIndex);
    if (!l) return { ok: false, reason: "invalid_lesson" };
    const now = getCurrentKuwaitMinutes();
    const s = parseTimeToMinutes(l.start);
    const e = parseTimeToMinutes(l.end);
    const cutoff = e + 5;
    return { ok: now >= s && now <= cutoff, reason: now >= s && now <= cutoff ? "within_window" : "outside_window" };
  }

  // Has this lesson's time slot already ended? Used to tell a genuinely
  // missing attendance record (should have been taken, wasn't — "!") apart
  // from a lesson that simply hasn't happened yet today (nothing to flag).
  // A session for any date other than today (editing a past day) is always
  // treated as past.
  function isLessonInPast(lessonIndex) {
    const l = LESSON_TIMES.find(x => x.index === lessonIndex);
    if (!l) return true;
    const sessionDate = currentMeta?.date;
    if (sessionDate && sessionDate !== kuwaitTodayISO()) return true;
    return getCurrentKuwaitMinutes() > parseTimeToMinutes(l.end);
  }

  async function buildTodayMapWithOverrides(teacherUid, dateISO) {
    const map = new Map();
    try {
      const todayDayIndex = getKuwaitDayIndexSunThu();
      const schedSnap = await getDocs(query(collection(db, "schedules"), where("teacherUid", "==", teacherUid)));
      schedSnap.forEach(d => {
        const data = d.data();
        if (!data.lesson) return;
        const key = String(data.lesson);
        // Primary: standing weekly schedule, matched by weekday index (recurs forever).
        // Fallback: legacy date-keyed entries from before the schedule was made recurring.
        let applies = (todayDayIndex >= 0 && Number(data.dayIndex) === todayDayIndex) || data.date === dateISO;
        if (applies && !map.has(key)) {
          map.set(key, { ...data, _source: "normal", _coveredAway: false });
        }
      });
      const ovSnap = await getDocs(query(collection(db, "scheduleOverrides"), where("date", "==", dateISO)));
      ovSnap.forEach(d => {
        const ov = d.data();
        const key = String(ov.lesson);
        if (ov.kind === "new" && ov.newTeacherUid === teacherUid) {
          map.set(key, { ...ov, _source: "override_new", _coveredAway: false });
        } else if (ov.kind === "original" && ov.originalTeacherUid === teacherUid) {
          if (map.has(key)) map.set(key, { ...map.get(key), _coveredAway: true });
        }
      });
    } catch (e) {
      console.error("[attendance] buildTodayMap:", e);
    }
    return map;
  }

  async function getCustomSchedulesForToday(dayIndex) {
    const key = `day:${dayIndex}`;
    const now = Date.now();
    if (customScheduleCache.key === key && now - customScheduleCache.at < CUSTOM_SCHEDULE_CACHE_MS) {
      return customScheduleCache.rows;
    }
    const rowsById = new Map();
    try {
      const s1 = await getDocs(query(collection(db, "customDaySchedules"), where("dayIndex", "==", dayIndex)));
      s1.forEach(ds => {
        const x = ds.data() || {};
        if (x.deletedAt || x.enabled !== true) return;
        rowsById.set(ds.id, x);
      });
      const dayAr = DAY_AR_BY_INDEX[dayIndex];
      if (dayAr) {
        const s2 = await getDocs(query(collection(db, "customDaySchedules"), where("day", "==", dayAr)));
        s2.forEach(ds => {
          const x = ds.data() || {};
          if (x.deletedAt || x.enabled !== true) return;
          rowsById.set(ds.id, x);
        });
      }
    } catch (e) {
      console.error("[attendance] getCustomSchedules:", e);
    }
    const rows = Array.from(rowsById.values());
    customScheduleCache = { key, at: now, rows };
    return rows;
  }

  async function getMyActiveCustomLessonMetaForNow(teacherUid, dateISO) {
    // Custom/extra schedules can be created for any day including Fri/Sat,
    // unlike the main weekly schedule (school days only) below.
    const dayIndex = getKuwaitDayIndexSunSat();
    if (dayIndex < 0) return null;
    const nowMin = getCurrentKuwaitMinutes();
    const rows = await getCustomSchedulesForToday(dayIndex);
    for (const row of rows) {
      const lessons = Array.isArray(row.lessons) ? row.lessons : [];
      const times = Array.isArray(row.times) ? row.times : [];
      const max = Math.min(7, Number(row.lessonCount) || lessons.length || times.length || 7);
      for (let i = 0; i < max; i++) {
        const lesson = lessons[i] || {};
        if ((lesson.teacherUid || "").toString() !== teacherUid) continue;
        const fb = LESSON_TIMES[i] || { start: "00:00", end: "00:00" };
        const slot = times[i] || {};
        const sMin = parseTimeToMinutes((slot.start || fb.start || "00:00").toString());
        const eMin = parseTimeToMinutes((slot.end || fb.end || "00:00").toString());
        if (nowMin < sMin || nowMin > eMin + 5) continue;
        let classKey = (row.classKey || "").toString().trim() || (lesson.classKey || "").toString().trim();
        if (!classKey && row.grade && row.section) {
          classKey = `${row.grade} / ${row.section}${row.track ? ` ${row.track}` : ""}`;
        }
        return {
          ok: true,
          lesson: i + 1,
          date: dateISO,
          classKey,
          subject: (lesson.subject || "").toString(),
          activeStart: (slot.start || fb.start || "00:00").toString(),
          activeEnd: (slot.end || fb.end || "00:00").toString(),
          teacherUid,
          scheduleData: { ...lesson, ...row, _source: "custom_weekly", _coveredAway: false },
        };
      }
    }
    return null;
  }

  // A cheap direct-document lookup (no query) so "already taken" can be
  // caught before the sheet even opens, instead of only at final save time.
  async function hasExistingAttendanceSession(dateISO, lesson, classKey) {
    if (!classKey) return false;
    try {
      const sessionId = createAttendanceSessionId(dateISO, lesson, classKey);
      const snap = await getDoc(doc(db, ATTENDANCE_SESSIONS_COLLECTION, sessionId));
      return snap.exists();
    } catch (e) {
      console.error("[attendance] hasExistingAttendanceSession:", e);
      return false; // fail open — a transient read error shouldn't block a legit submission
    }
  }

  async function getMyActiveLessonMetaForNow() {
    const user = auth.currentUser;
    if (!user) return { ok: false, reason: "not_logged_in" };
    const todayISO = kuwaitTodayISO();
    const L = getActiveLessonIndex();
    // These two schedule sources are independent of each other — check them
    // at the same time instead of one after the other.
    const [customHit, map] = await Promise.all([
      getMyActiveCustomLessonMetaForNow(user.uid, todayISO),
      L === null ? Promise.resolve(new Map()) : buildTodayMapWithOverrides(user.uid, todayISO),
    ]);
    if (customHit?.ok) {
      if (await hasExistingAttendanceSession(customHit.date, customHit.lesson, customHit.classKey)) {
        return { ok: false, reason: "already_taken" };
      }
      return customHit;
    }
    if (L === null) return { ok: false, reason: "outside_lessons" };
    const hit = map.get(String(L));
    if (!hit || hit._coveredAway === true) return { ok: false, reason: "not_my_lesson" };
    const w = getLessonWindowStatus(L);
    if (!w.ok) return { ok: false, reason: "time_locked" };
    const lesson = LESSON_TIMES.find(l => l.index === L);
    let classKey = "";
    if (hit.classKey) classKey = hit.classKey;
    else if (hit.grade && hit.section) classKey = `${hit.grade} / ${hit.section}${hit.track ? ` ${hit.track}` : ""}`;
    else classKey = hit.class || "";
    if (await hasExistingAttendanceSession(todayISO, L, classKey)) {
      return { ok: false, reason: "already_taken" };
    }
    return {
      ok: true, lesson: L, date: todayISO, classKey,
      subject: hit.subject || "", activeStart: lesson?.start || "00:00",
      activeEnd: lesson?.end || "00:00", teacherUid: user.uid, scheduleData: hit,
    };
  }

  async function checkAllowed(showFeedback = true) {
    const meta = await getMyActiveLessonMetaForNow();
    if (!meta.ok) {
      if (showFeedback) showBlocked(meta.reason);
      return { allowed: false, meta };
    }
    return { allowed: true, meta };
  }

  async function tryQueryStudents(path, cls) {
    try {
      const parts = path.split("/");
      if (parts.length === 1) {
        const snap = await getDocs(query(collection(db, parts[0]), where("class", "==", cls)));
        if (snap.empty) return [];
        const out = [];
        snap.forEach(d => {
          const s = d.data() || {};
          out.push({
            name: s.name || s.fullName || d.id,
            uid: d.id,
            class: s.class || s.className || "",
            specialCase: s.specialCase || false,
            studentNumber: s.studentNumber || s.number || s.no || s.roll || s.idNumber || s.studentNo,
            orderIndex: s.orderIndex,
          });
        });
        return out;
      } else if (parts.length === 2) {
        const ms = await getDoc(doc(db, parts[0], parts[1]));
        if (ms.exists() && ms.data()) {
          const arr = Object.values(ms.data() || {}).filter(Boolean);
          return arr
            .filter(s => (s.class || s.className) === cls)
            .map(s => ({
              name: s.name || s.fullName || "",
              uid: s.uid || "",
              class: s.class || s.className || "",
              specialCase: s.specialCase || false,
              studentNumber: s.studentNumber || s.number || s.no || s.roll || s.idNumber || s.studentNo,
              orderIndex: s.orderIndex,
            }));
        }
        return [];
      }
      return [];
    } catch (e) {
      console.warn("[attendance] tryQueryStudents", path, e?.message);
      return [];
    }
  }

  function setControlsEnabled(enabled) {
    els.sheet.querySelectorAll(".seg button").forEach(b => (b.disabled = !enabled));
    if (els.submitBtn) els.submitBtn.disabled = !enabled;
  }

  function updateSheetTitle(lessonLabel) {
    const classText = currentMeta?.classKey ? formatClassLabel(currentMeta.classKey) : "";
    els.sheetTitle.textContent = lessonLabel && classText
      ? `${lessonLabel} | ${classText}`
      : (classText || DEFAULT_SHEET_TITLE);
  }

  function buildLessonOption(currentLessonIndex) {
    els.lessonPicker.style.display = "none";
    els.lessonSelect.innerHTML = "";
    const l = LESSON_TIMES.find(x => x.index === currentLessonIndex);
    if (!l) {
      updateSheetTitle();
      setControlsEnabled(false);
      return;
    }
    const opt = document.createElement("option");
    opt.value = String(currentLessonIndex);
    opt.textContent = `${l.label} — ${l.start} – ${l.end}`;
    opt.selected = true;
    opt.disabled = true;
    els.lessonSelect.appendChild(opt);
    els.lessonSelect.disabled = true;
    updateSheetTitle(l.label);
    setControlsEnabled(true);
  }

  function buildManualLessonOptions(available) {
    els.lessonPicker.style.display = "";
    els.lessonSelect.innerHTML = "";
    if (!available.length) {
      els.lessonHint.textContent = "لا توجد حصص متاحة للتسجيل اليوم.";
      els.lessonSelect.disabled = true;
      updateSheetTitle();
      setControlsEnabled(false);
      return;
    }
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "اختر الحصة";
    ph.disabled = true;
    ph.selected = true;
    ph.hidden = true;
    els.lessonSelect.appendChild(ph);
    available.forEach(l => {
      const opt = document.createElement("option");
      opt.value = String(l.index);
      opt.textContent = `${l.label} — ${l.start} – ${l.end}`;
      els.lessonSelect.appendChild(opt);
    });
    els.lessonSelect.disabled = false;
    els.lessonHint.textContent = "يرجى اختيار الحصة.";
    updateSheetTitle();
    els.lessonSelect.onchange = () => {
      const chosen = available.find(l => String(l.index) === els.lessonSelect.value);
      setControlsEnabled(!!chosen);
      els.lessonHint.textContent = chosen ? `${chosen.label} — ${chosen.start} – ${chosen.end}` : "يرجى اختيار الحصة.";
      updateSheetTitle(chosen?.label);
    };
    setControlsEnabled(false);
  }

  function buildFixedLessonOption(lessonIndex, lessonLabel) {
    els.lessonPicker.style.display = "none";
    els.lessonSelect.innerHTML = "";
    const l = LESSON_TIMES.find(x => x.index === lessonIndex);
    const label = lessonLabel || l?.label || `حصة ${lessonIndex}`;
    const opt = document.createElement("option");
    opt.value = String(lessonIndex);
    opt.textContent = l ? `${label} — ${l.start} – ${l.end}` : label;
    opt.selected = true;
    opt.disabled = true;
    els.lessonSelect.appendChild(opt);
    els.lessonSelect.disabled = true;
    updateSheetTitle(`تعديل: ${label}`);
    setControlsEnabled(true);
  }

  function normalizeClassKeyForCompare(s) {
    return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function classKeyFromScheduleRow(row) {
    const direct = (row.classKey || row.class || "").toString().trim();
    if (direct) return direct;
    if (row.grade && row.section) {
      return `${row.grade} / ${row.section}${row.track ? ` ${row.track}` : ""}`;
    }
    return "";
  }

  // Which lessons (1-7) is this teacher actually assigned to teach `classKey`
  // today, per the schedule (main weekly schedule + any custom/extra schedule)?
  // Attendance may only ever be taken for a real, scheduled lesson — never an
  // arbitrary slot nobody was assigned to teach.
  async function getMyScheduledLessonsForClass(teacherUid, classKey, dateISO) {
    const target = normalizeClassKeyForCompare(classKey);
    const result = new Set();
    if (!teacherUid || !target) return result;

    const todayMap = await buildTodayMapWithOverrides(teacherUid, dateISO);
    todayMap.forEach((hit, lessonKey) => {
      if (hit._coveredAway) return;
      if (normalizeClassKeyForCompare(classKeyFromScheduleRow(hit)) === target) {
        result.add(Number(lessonKey));
      }
    });

    const dayIndex = getKuwaitDayIndexSunSat();
    if (dayIndex >= 0) {
      const rows = await getCustomSchedulesForToday(dayIndex);
      rows.forEach(row => {
        const lessons = Array.isArray(row.lessons) ? row.lessons : [];
        const max = Math.min(7, Number(row.lessonCount) || lessons.length || 7);
        for (let i = 0; i < max; i++) {
          const lesson = lessons[i] || {};
          if ((lesson.teacherUid || "").toString() !== teacherUid) continue;
          const rowClassKey = classKeyFromScheduleRow(row) || classKeyFromScheduleRow(lesson);
          if (normalizeClassKeyForCompare(rowClassKey) === target) {
            result.add(i + 1);
          }
        }
      });
    }

    return result;
  }

  async function getTakenLessonIndicesForClass(dateISO, classKey) {
    const set = new Set();
    if (!dateISO || !classKey) return set;
    try {
      const snap = await getDocs(query(
        collection(db, ATTENDANCE_SESSIONS_COLLECTION),
        where("date", "==", dateISO),
        where("classKey", "==", classKey),
      ));
      snap.forEach(ds => {
        const lesson = Number((ds.data() || {}).lesson);
        if (Number.isFinite(lesson)) set.add(lesson);
      });
    } catch (e) {
      console.error("[attendance] getTakenLessonIndices:", e);
    }
    return set;
  }

  function canEditSessionByTime(createdAtField) {
    if (!createdAtField) return false;
    let created = null;
    if (createdAtField?.toDate) created = createdAtField.toDate();
    else if (createdAtField?.seconds) created = new Date(createdAtField.seconds * 1000);
    if (!created) return false;
    return (Date.now() - created.getTime()) <= 45 * 60 * 1000;
  }

  async function prefillStatusesFromSession(sessionId) {
    try {
      const recSnap = await getDocs(collection(db, ATTENDANCE_SESSIONS_COLLECTION, sessionId, ATTENDANCE_RECORDS_SUBCOLLECTION));
      recSnap.forEach(rd => {
        const uid = rd.id;
        const st = (rd.data()?.status || "").toString();
        if (uid && (st === "present" || st === "late" || st === "absent")) {
          attStatuses[uid] = st;
        }
      });
      renderList(attStudentList);
    } catch (e) {
      console.error("[attendance] prefillStatuses:", e);
    }
  }

  // Returns { byStudent: Map<uid, Map<lessonNum, status>>, takenLessons: Set<lessonNum> }.
  // takenLessons tracks which lesson numbers have a session at all for this
  // class/date (regardless of whether a given student has a record in it),
  // so the per-student lesson dots can distinguish "not taken yet" from
  // "taken, and this student was marked present/late/absent".
  async function loadTakenLessonsForClass(dateISO, classKey) {
    const byStudent = new Map();
    const takenLessons = new Set();
    if (!dateISO || !classKey) return { byStudent, takenLessons };
    try {
      const sessSnap = await getDocs(query(
        collection(db, ATTENDANCE_SESSIONS_COLLECTION),
        where("date", "==", dateISO),
        where("classKey", "==", classKey),
      ));
      const sessions = [];
      sessSnap.forEach(ds => {
        const x = ds.data() || {};
        const lesson = Number(x.lesson);
        if (!Number.isFinite(lesson) || lesson < 1 || lesson > 7) return;
        sessions.push({ id: ds.id, lesson });
        takenLessons.add(lesson);
      });
      await Promise.all(sessions.map(async s => {
        const recs = await getDocs(collection(db, ATTENDANCE_SESSIONS_COLLECTION, s.id, ATTENDANCE_RECORDS_SUBCOLLECTION));
        recs.forEach(rd => {
          const uid = (rd.id || "").toString();
          if (!uid) return;
          const raw = (rd.data()?.status || "present").toString();
          const status = raw === "late" || raw === "absent" ? raw : "present";
          if (!byStudent.has(uid)) byStudent.set(uid, new Map());
          byStudent.get(uid).set(s.lesson, status);
        });
      }));
    } catch (e) {
      console.error("[attendance] loadTakenLessons:", e);
    }
    return { byStudent, takenLessons };
  }

  function recalcStats() {
    const vals = Object.values(attStatuses);
    const present = vals.filter(v => v === "present").length;
    const late = vals.filter(v => v === "late").length;
    const absent = vals.filter(v => v === "absent").length;
    els.countPresent.textContent = `حضور: ${present}`;
    els.countLate.textContent = `تأخير: ${late}`;
    els.countAbsent.textContent = `غياب: ${absent}`;
  }

  function setStatus(student, status, btnP, btnL, btnA, card) {
    const k = student.uid || student.name;
    attStatuses[k] = status;
    btnP.classList.toggle("active", status === "present");
    btnL.classList.toggle("active", status === "late");
    btnA.classList.toggle("active", status === "absent");
    if (card) {
      card.classList.remove("tint-late", "tint-absent");
      if (status === "late") card.classList.add("tint-late");
      if (status === "absent") card.classList.add("tint-absent");
    }
    recalcStats();
  }

  function renderList(list) {
    els.attList.innerHTML = "";
    if (list.length === 0) {
      const empty = document.createElement("div");
      empty.className = "error";
      empty.textContent = "لا يوجد طلاب.";
      els.attList.appendChild(empty);
      return;
    }
    list.forEach(s => {
      const card = document.createElement("div");
      card.className = "att-card";
      if (s.specialCase) card.classList.add("special-case");

      const name = document.createElement("div");
      name.className = "att-name";

      const info = document.createElement("div");
      info.className = "att-student-info";
      if (s.specialCase) {
        const wrap = document.createElement("div");
        wrap.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e6b800" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="special-case-icon"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
        info.appendChild(wrap.firstElementChild);
      }
      info.appendChild(document.createTextNode(s.name || "—"));
      name.appendChild(info);

      const badge = document.createElement("span");
      badge.className = "att-number-badge";
      const sn = getStudentNumber(s);
      badge.textContent = sn === Infinity ? "—" : toArabicDigits(sn);
      name.appendChild(badge);

      const dots = document.createElement("div");
      dots.className = "att-lesson-dots";
      if (s.uid) {
        const studentUid = s.uid;
        const statusByLesson = takenLessonsByStudent.get(studentUid) || new Map();
        LESSON_TIMES.forEach(l => {
          const status = statusByLesson.get(l.index);
          const dot = document.createElement("button");
          dot.type = "button";
          if (status) {
            dot.className = `att-lesson-dot ${status}`;
            dot.textContent = toArabicDigits(l.index);
            dot.title = `${l.label}`;
            dot.addEventListener("click", (e) => {
              e.stopPropagation();
              openLessonDetailPopup(studentUid, s.name, l.index, status);
            });
          } else if (isLessonInPast(l.index)) {
            dot.className = "att-lesson-dot missing";
            dot.textContent = "!";
            dot.title = `${l.label} — لم يُسجَّل بعد`;
            dot.addEventListener("click", (e) => {
              e.stopPropagation();
              openLessonDetailPopup(studentUid, s.name, l.index, null);
            });
          } else {
            dot.className = "att-lesson-dot future";
            dot.textContent = toArabicDigits(l.index);
            dot.title = `${l.label} — لم تبدأ بعد`;
            dot.disabled = true;
          }
          dots.appendChild(dot);
        });
      }

      const seg = document.createElement("div");
      seg.className = "seg";
      const bP = document.createElement("button");
      bP.className = "present"; bP.textContent = "حضور";
      const sep1 = document.createElement("div"); sep1.className = "sep";
      const bL = document.createElement("button");
      bL.className = "late"; bL.textContent = "تأخير";
      const sep2 = document.createElement("div"); sep2.className = "sep";
      const bA = document.createElement("button");
      bA.className = "absent"; bA.textContent = "غياب";

      const cur = attStatuses[s.uid || s.name] || "present";
      if (cur === "present") bP.classList.add("active");
      if (cur === "late") bL.classList.add("active");
      if (cur === "absent") bA.classList.add("active");
      card.classList.remove("tint-late", "tint-absent");
      if (cur === "late") card.classList.add("tint-late");
      if (cur === "absent") card.classList.add("tint-absent");

      bP.onclick = () => setStatus(s, "present", bP, bL, bA, card);
      bL.onclick = () => setStatus(s, "late", bP, bL, bA, card);
      bA.onclick = () => setStatus(s, "absent", bP, bL, bA, card);

      seg.append(bP, sep1, bL, sep2, bA);
      card.appendChild(name);
      if (dots.childElementCount > 0) card.appendChild(dots);
      card.appendChild(seg);
      els.attList.appendChild(card);
    });
    setControlsEnabled(!!els.lessonSelect.value);
    recalcStats();
  }

  async function loadStudentsForClass(cls) {
    attStudentList = [];
    attStatuses = {};
    takenLessonsByStudent = new Map();
    takenLessonNumbers = new Set();
    const dateISO = currentMeta?.date || kuwaitTodayISO();

    // The student list and the "what's already been taken" data don't
    // depend on each other — fetch both at once instead of one after the
    // other.
    const fetchStudents = async () => {
      let list = await tryQueryStudents("students", cls);
      if (list.length === 0) {
        const nested = await tryQueryStudents("students/uids", cls);
        if (nested.length > 0) list = nested;
      }
      return list;
    };
    const [students, taken] = await Promise.all([
      fetchStudents(),
      loadTakenLessonsForClass(dateISO, cls),
    ]);

    attStudentList = sortStudentsByStudentNumberOnly(students);
    takenLessonsByStudent = taken.byStudent;
    takenLessonNumbers = taken.takenLessons;
    attStudentList.forEach(s => { if (s.uid) attStatuses[s.uid] = "present"; });
    renderList(attStudentList);
    recalcStats();
  }

  function openWithMeta(meta) {
    if (!meta || !meta.ok) {
      showBlocked("not_my_lesson");
      return;
    }
    currentMeta = { ...meta, mode: "self" };
    buildLessonOption(meta.lesson);
    loadStudentsForClass(meta.classKey);
    openSheet(els.sheet);
  }

  async function openForClass(classKey) {
    if (!classKey) return;
    if (!auth.currentUser) {
      showBlocked("not_logged_in");
      return;
    }
    const dateISO = kuwaitTodayISO();
    // Attendance may only be taken for a lesson you're actually scheduled to
    // teach today — not an arbitrary slot nobody assigned to this class.
    const myLessons = await getMyScheduledLessonsForClass(auth.currentUser.uid, classKey, dateISO);
    if (myLessons.size === 0) {
      showBlocked("not_my_class");
      return;
    }
    const takenSet = await getTakenLessonIndicesForClass(dateISO, classKey);
    const available = LESSON_TIMES.filter(l => myLessons.has(l.index) && !takenSet.has(l.index));
    if (available.length === 0) {
      showBlocked("no_lessons_left");
      return;
    }
    currentMeta = { ok: true, mode: "any", date: dateISO, classKey, lesson: null };
    buildManualLessonOptions(available);
    loadStudentsForClass(classKey);
    openSheet(els.sheet);
  }

  async function openForEdit(sessionId) {
    if (!sessionId) return;
    const sessionRef = doc(db, ATTENDANCE_SESSIONS_COLLECTION, sessionId);
    const snap = await getDoc(sessionRef);
    if (!snap.exists()) {
      showError("غير موجود", "التقرير غير موجود.");
      return;
    }
    const data = snap.data() || {};
    const createdAt = data.createdAt || null;
    if (!canEditSessionByTime(createdAt)) {
      showError("تعذّر التعديل", "انتهت مهلة التعديل (45 دقيقة).");
      return;
    }
    const classKey = data.classKey || "";
    const lessonIndex = Number(data.lesson) || 0;
    const lessonLabel = data.lessonLabel || null;
    currentMeta = {
      ok: true, mode: "edit", date: data.date || kuwaitTodayISO(),
      classKey, lesson: lessonIndex, sessionId, createdAt,
    };
    buildFixedLessonOption(lessonIndex, lessonLabel);
    await loadStudentsForClass(classKey);
    await prefillStatusesFromSession(sessionId);
    openSheet(els.sheet);
  }

  // Submit handlers
  els.submitBtn.addEventListener("click", async () => {
    if (currentMeta?.mode === "edit") {
      if (!canEditSessionByTime(currentMeta.createdAt)) {
        showError("تعذّر الحفظ", "انتهت مهلة التعديل (45 دقيقة).");
        return;
      }
    } else if (currentMeta?.mode !== "any") {
      // Schedule eligibility was already verified (with a couple of Firestore
      // round trips) when the sheet was opened via checkAllowed(). Re-running
      // that full check here just to confirm the lesson window is still open
      // was adding a very noticeable delay to every single submit — this is a
      // pure client-side time check instead, no network involved.
      const w = getLessonWindowStatus(currentMeta?.lesson);
      if (!w.ok) {
        showBlocked("time_locked");
        return;
      }
    }
    if (!currentMeta?.classKey) {
      showError("تعذّر الحفظ", "اختر فصلًا أولاً.");
      return;
    }
    if (!els.lessonSelect.value) {
      showError("تعذّر الحفظ", "يرجى اختيار الحصة أولاً.");
      return;
    }
    const present = [], late = [], absent = [];
    const absNames = [], lateNames = [];
    attStudentList.forEach(s => {
      const k = s.uid || s.name;
      const st = attStatuses[k];
      const has = !!s.uid;
      if (st === "present" && has) present.push(s.uid);
      else if (st === "late") { if (has) late.push(s.uid); lateNames.push(s.name); }
      else if (st === "absent") { if (has) absent.push(s.uid); absNames.push(s.name); }
    });
    const lessonIndex = parseInt(els.lessonSelect.value, 10);
    const lesson = LESSON_TIMES.find(l => l.index === lessonIndex);
    const lessonLabel = lesson ? lesson.label : `الحصة ${lessonIndex}`;
    els.confirmTitle.textContent = `تأكيد حفظ التقرير | ${lessonLabel}`;
    els.confirmAbsentList.innerHTML = "";
    els.confirmLateList.innerHTML = "";
    if (absNames.length) {
      absNames.forEach(n => { const li = document.createElement("li"); li.textContent = n; els.confirmAbsentList.appendChild(li); });
    } else {
      const li = document.createElement("li"); li.textContent = "لا يوجد طلاب غائبون."; els.confirmAbsentList.appendChild(li);
    }
    if (lateNames.length) {
      lateNames.forEach(n => { const li = document.createElement("li"); li.textContent = n; els.confirmLateList.appendChild(li); });
    } else {
      const li = document.createElement("li"); li.textContent = "لا يوجد طلاب متأخرون."; els.confirmLateList.appendChild(li);
    }
    els.filterAbsent.click();
    pendingSave = {
      present, late, absent,
      dateKW: currentMeta.date || kuwaitTodayISO(),
      lessonIndex, lessonLabel,
      classKey: currentMeta.classKey,
      mode: currentMeta.mode,
      sessionId: currentMeta.sessionId,
    };
    openModal(els.confirmModal);
    setTimeout(() => els.confirmSave.focus(), 0);
  });

  els.confirmCancel.addEventListener("click", () => closeModal(els.confirmModal));

  els.confirmSave.addEventListener("click", async () => {
    try {
      if (!auth.currentUser) {
        showError("تعذّر الحفظ", "يرجى تسجيل الدخول.");
        return;
      }
      if (!pendingSave) {
        closeModal(els.confirmModal);
        return;
      }
      const uid = auth.currentUser.uid;
      const { present, late, absent, dateKW, lessonIndex, lessonLabel, classKey, mode, sessionId } = pendingSave;
      const nameByUid = {};
      attStudentList.forEach(s => { if (s.uid) nameByUid[s.uid] = s.name; });
      const all = [
        ...present.map(u => ({ uid: u, status: "present" })),
        ...late.map(u => ({ uid: u, status: "late" })),
        ...absent.map(u => ({ uid: u, status: "absent" })),
      ];

      if (mode === "edit") {
        if (!canEditSessionByTime(currentMeta?.createdAt)) {
          closeModal(els.confirmModal);
          showError("تعذّر الحفظ", "انتهت مهلة التعديل (45 دقيقة).");
          pendingSave = null;
          return;
        }
        const sessionRef = doc(db, ATTENDANCE_SESSIONS_COLLECTION, sessionId);
        const batch = writeBatch(db);
        batch.set(sessionRef, {
          classKey, date: dateKW, lesson: lessonIndex, lessonLabel,
          counts: { present: present.length, late: late.length, absent: absent.length, total: all.length },
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        }, { merge: true });
        all.forEach(({ uid: u, status }) => {
          if (!u) return;
          const ref = doc(db, ATTENDANCE_SESSIONS_COLLECTION, sessionId, ATTENDANCE_RECORDS_SUBCOLLECTION, u);
          batch.set(ref, {
            status,
            updatedAt: serverTimestamp(),
            updatedBy: uid,
            studentName: nameByUid[u] || null,
          }, { merge: true });
        });
        await batch.commit();
        closeModal(els.confirmModal);
        closeSheet(els.sheet);
        showSuccessCelebration(`تم حفظ التعديلات — للحصة: ${lessonLabel}`);
        if (typeof onSaved === "function") {
          try {
            onSaved({ classKey, lesson: lessonIndex, lessonLabel, date: dateKW, mode, counts: { present: present.length, late: late.length, absent: absent.length } });
          } catch (e) {
            console.error("[attendance] onSaved threw:", e);
          }
        }
        return;
      }

      // Create flow: "self" (time-gated, own current lesson) or "any" (manual class/lesson pick)
      let activeMeta = {};
      if (mode === "self") {
        const c = await checkAllowed();
        if (!c.allowed) {
          closeModal(els.confirmModal);
          return;
        }
        activeMeta = c.meta || {};
      } else if (mode === "any") {
        // Re-check against the schedule in case it changed since the sheet was opened.
        const myLessons = await getMyScheduledLessonsForClass(uid, classKey, dateKW);
        if (!myLessons.has(lessonIndex)) {
          closeModal(els.confirmModal);
          showBlocked("not_my_class");
          return;
        }
      }
      const newSessionId = createAttendanceSessionId(dateKW, lessonIndex, classKey);
      const sessionRef = doc(db, ATTENDANCE_SESSIONS_COLLECTION, newSessionId);
      const existing = await getDoc(sessionRef);
      if (existing.exists()) {
        closeModal(els.confirmModal);
        showError("تعذّر الحفظ", "تم تسجيل غياب هذه الحصّة مسبقًا.");
        pendingSave = null;
        return;
      }
      const lessonTime = LESSON_TIMES.find(l => l.index === lessonIndex);
      const startHHMM = (activeMeta.activeStart || lessonTime?.start || "00:00").toString();
      const endHHMM = (activeMeta.activeEnd || lessonTime?.end || "00:00").toString();
      const sessionStartTs = kuwaitDateTimeToDate(dateKW, startHHMM);
      const sessionCutoffTs = addMinutesToDate(kuwaitDateTimeToDate(dateKW, endHHMM), 5);
      await setDoc(sessionRef, {
        date: dateKW,
        lesson: lessonIndex,
        classKey,
        teacherUid: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        sessionStartTs: Timestamp.fromDate(sessionStartTs),
        sessionCutoffTs: Timestamp.fromDate(sessionCutoffTs),
        locked: false,
      });
      const batch = writeBatch(db);
      all.forEach(({ uid: u, status }) => {
        if (!u) return;
        const ref = doc(db, ATTENDANCE_SESSIONS_COLLECTION, newSessionId, ATTENDANCE_RECORDS_SUBCOLLECTION, u);
        batch.set(ref, {
          status,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
          studentName: nameByUid[u] || null,
        });
      });
      await batch.commit();
      closeModal(els.confirmModal);
      closeSheet(els.sheet);
      showSuccessCelebration(`تم تسجيل الغياب بنجاح — للحصة: ${lessonLabel}`);

      if (mode === "any" && typeof onLateSubmit === "function") {
        const nowMin = getCurrentKuwaitMinutes();
        const cutoffMin = parseTimeToMinutes(lessonTime?.end || "00:00") + 5;
        if (nowMin > cutoffMin) {
          try {
            onLateSubmit({ classKey, lesson: lessonIndex, lessonLabel, date: dateKW });
          } catch (e) {
            console.error("[attendance] onLateSubmit threw:", e);
          }
        }
      }

      if (typeof onSaved === "function") {
        try {
          onSaved({ classKey, lesson: lessonIndex, lessonLabel, date: dateKW, mode, counts: { present: present.length, late: late.length, absent: absent.length } });
        } catch (e) {
          console.error("[attendance] onSaved threw:", e);
        }
      }
    } catch (e) {
      console.error("[attendance] save:", e);
      closeModal(els.confirmModal);
      showError("تعذّر الحفظ", "حدث خطأ أثناء حفظ البيانات.");
    } finally {
      pendingSave = null;
    }
  });

  els.filterAbsent.addEventListener("click", () => {
    els.filterAbsent.classList.add("active");
    els.filterLate.classList.remove("active");
    els.confirmAbsentList.style.display = "block";
    els.confirmLateList.style.display = "none";
  });
  els.filterLate.addEventListener("click", () => {
    els.filterLate.classList.add("active");
    els.filterAbsent.classList.remove("active");
    els.confirmAbsentList.style.display = "none";
    els.confirmLateList.style.display = "block";
  });

  const STATUS_LABELS_AR = { present: "حاضر", late: "متأخر", absent: "غائب" };

  function detailRow(k, vHtml) {
    return `<div class="detail-row"><span class="k">${k}</span><span class="v">${vHtml}</span></div>`;
  }

  async function openLessonDetailPopup(studentUid, studentName, lessonIndex, status) {
    const l = LESSON_TIMES.find(x => x.index === lessonIndex);
    const lessonLabel = l ? `${l.label} — ${l.start} – ${l.end}` : `الحصة ${toArabicDigits(lessonIndex)}`;
    els.lessonDetailBody.innerHTML = `<div class="detail-empty">جاري التحميل...</div>`;
    openModal(els.lessonDetailModal);

    if (!status) {
      els.lessonDetailTitle.textContent = "لم يُسجَّل الحضور بعد";
      els.lessonDetailBody.innerHTML =
        detailRow("الطالب", studentName || "—") +
        detailRow("الحصة", lessonLabel) +
        `<div class="detail-empty">لم يتم تسجيل حضور/غياب هذا الطالب في هذه الحصة.</div>`;
      return;
    }

    els.lessonDetailTitle.textContent = "تفاصيل الحضور";
    try {
      const dateISO = currentMeta?.date || kuwaitTodayISO();
      const classKey = currentMeta?.classKey || "";
      const sessionId = createAttendanceSessionId(dateISO, lessonIndex, classKey);
      const sessSnap = await getDoc(doc(db, ATTENDANCE_SESSIONS_COLLECTION, sessionId));
      const sessData = sessSnap.exists() ? sessSnap.data() : {};
      let recordedBy = "—";
      if (sessData.teacherUid) {
        try {
          const tSnap = await getDoc(doc(db, "teachers", sessData.teacherUid));
          if (tSnap.exists()) recordedBy = (tSnap.data() || {}).name || recordedBy;
        } catch (e) {
          console.warn("[attendance] teacher lookup failed:", e?.message);
        }
      }
      const statusLabel = STATUS_LABELS_AR[status] || status;
      els.lessonDetailBody.innerHTML =
        detailRow("الطالب", studentName || "—") +
        detailRow("الحصة", lessonLabel) +
        detailRow("الحالة", `<span class="detail-status ${status}">${statusLabel}</span>`) +
        detailRow("سجّلها", recordedBy);
    } catch (e) {
      console.error("[attendance] lesson detail failed:", e);
      els.lessonDetailBody.innerHTML = `<div class="detail-empty">تعذّر تحميل التفاصيل.</div>`;
    }
  }

  els.closeBtn.addEventListener("click", () => closeSheet(els.sheet));
  els.errorOk.addEventListener("click", () => closeModal(els.errorModal));
  els.blockedClose.addEventListener("click", () => closeModal(els.blockedModal));
  els.blockedOk.addEventListener("click", () => closeModal(els.blockedModal));
  els.successOk.addEventListener("click", () => closeModal(els.successModal));
  els.lessonDetailClose.addEventListener("click", () => closeModal(els.lessonDetailModal));

  els.confirmModal.querySelector(".overlay").addEventListener("click", () => closeModal(els.confirmModal));
  els.errorModal.querySelector(".overlay").addEventListener("click", () => closeModal(els.errorModal));
  els.blockedModal.querySelector(".overlay").addEventListener("click", () => closeModal(els.blockedModal));
  els.lessonDetailModal.querySelector(".overlay").addEventListener("click", () => closeModal(els.lessonDetailModal));

  // Boot: load lesson times on first mount
  fetchLessonTimes();

  return {
    async start() {
      const c = await checkAllowed(true);
      if (!c.allowed) return;
      openWithMeta(c.meta);
    },
    open: openWithMeta,
    openForClass,
    openForEdit,
    canEditSession(sessionData) { return canEditSessionByTime(sessionData?.createdAt); },
    close() { closeSheet(els.sheet); },
    refreshLessonTimes: fetchLessonTimes,
  };
}
