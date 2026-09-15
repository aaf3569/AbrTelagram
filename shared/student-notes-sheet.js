// Shared "student profile" sheet — teacher-private notes (positive/negative/
// general) plus a read-only special-case banner. Used to be its own page
// (Teachers/studentprofile.html), navigated to via `location.href = ...` with
// the student's id/name/class in the query string. Every host page now opens
// it as an in-page overlay instead: call mountStudentNotesSheet({db, auth})
// once, then studentNotes.open(studentId, { name, className }) wherever a
// student row is clicked.
//
// All CSS classes and DOM are scoped under a single injected wrapper with an
// "snp-" prefix (Student Notes Panel) so nothing here can collide with a host
// page's own .btn/.modal/.row/etc — those are extremely common class names
// across this codebase's pages.
import {
  doc, getDoc, collection, addDoc, serverTimestamp, getDocs, deleteDoc, query, orderBy,
} from "/shared/firebase.js";

const STYLE_ID = "snp-styles";

const CSS_TEXT = `
.snp-overlay{
  --snp-primary:#0a4b64; --snp-primary-light:#0f6b86; --snp-primary-soft:#e6f2f7;
  --snp-page:#edf4f8; --snp-page-deep:#dce9f0; --snp-text:#102235; --snp-muted:#61758a;
  --snp-border:#d2e0e9; --snp-card:#ffffff; --snp-radius:20px;
  --snp-shadow-1:0 8px 20px rgba(7,42,60,.10); --snp-shadow-2:0 16px 40px rgba(7,42,60,.14);
  --snp-shadow-3:0 24px 60px rgba(7,42,60,.20);
  --snp-g:#0f8a4b; --snp-g-bg:rgba(15,138,75,.12); --snp-g-bg-hover:rgba(15,138,75,.18);
  --snp-r:#b42318; --snp-r-bg:rgba(180,35,24,.12); --snp-r-bg-hover:rgba(180,35,24,.18);
  --snp-y:#a06d00; --snp-y-bg:rgba(160,109,0,.14); --snp-y-bg-hover:rgba(160,109,0,.22);
  position:fixed; inset:0; z-index:5000; display:flex; flex-direction:column;
  background:linear-gradient(180deg, var(--snp-page) 0%, var(--snp-page-deep) 100%);
  color:var(--snp-text); font-family:"Noto Kufi Arabic", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  line-height:1.6; font-weight:650; transform:translateX(100%);
  transition:transform .28s cubic-bezier(.22,.7,.25,1); -webkit-tap-highlight-color:transparent;
}
.snp-overlay.snp-open{ transform:translateX(0); }
.snp-overlay *{ box-sizing:border-box; }
.snp-overlay button,.snp-overlay input,.snp-overlay textarea,.snp-overlay select,.snp-overlay summary{
  font-family:"Noto Kufi Arabic", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
}
.snp-wrap{ position:relative; z-index:1; width:100%; max-width:1040px; margin:0 auto; padding-inline:14px; }
.snp-topbar{
  position:sticky; top:0; z-index:20; background:rgba(255,255,255,.78); backdrop-filter:blur(12px);
  border-bottom:1px solid rgba(10,75,100,.15); box-shadow:0 8px 24px rgba(7,42,60,.08); flex-shrink:0;
}
.snp-headrow{ min-height:72px; display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:12px; padding-block:10px; }
.snp-pagetitle{ grid-column:2; justify-self:center; color:var(--snp-primary); font-weight:900; letter-spacing:.2px; font-size:clamp(1rem,2.9vw,1.2rem); text-align:center; }
.snp-backbtn{
  grid-column:1; justify-self:start; min-height:46px; padding:0 16px; border-radius:14px;
  border:1px solid rgba(10,75,100,.22); background:#fff; color:var(--snp-primary); font-weight:900; cursor:pointer;
  display:inline-flex; align-items:center; gap:8px; box-shadow:0 6px 14px rgba(7,42,60,.10);
  transition:transform .2s ease, box-shadow .2s ease, border-color .2s ease;
}
.snp-backbtn:hover{ border-color:rgba(10,75,100,.40); box-shadow:0 10px 20px rgba(7,42,60,.14); transform:translateY(-1px); }
.snp-scroll{ flex:1 1 auto; overflow-y:auto; }
.snp-main{ padding-block:20px 42px; display:grid; gap:16px; }
.snp-hero{
  background:radial-gradient(430px 180px at 18% 0%, rgba(255,255,255,.30), transparent 72%),
    linear-gradient(135deg, #0d5a75 0%, #0e6f88 48%, #0f526f 100%);
  border:1px solid rgba(255,255,255,.35); border-radius:24px; padding:18px; box-shadow:var(--snp-shadow-2);
  color:#f5fbff; display:grid; justify-items:center; text-align:center; gap:6px;
}
.snp-stu{ display:grid; gap:4px; align-items:center; justify-items:center; text-align:center; }
.snp-stu-name{ font-weight:900; color:#ffffff; font-size:clamp(1.2rem,4.1vw,1.8rem); line-height:1.3; text-wrap:balance; }
.snp-stu-class{ color:rgba(238,248,255,.92); font-weight:850; font-size:1rem; }
.snp-special-banner{
  display:none; gap:10px; background:linear-gradient(160deg, rgba(160,109,0,.14), rgba(255,255,255,.85));
  border:1px solid rgba(160,109,0,.26); border-radius:18px; box-shadow:var(--snp-shadow-1); padding:14px 15px;
  position:relative; overflow:hidden;
}
.snp-special-banner.snp-show{ display:grid; }
.snp-special-banner::before{
  content:""; position:absolute; inset:0; pointer-events:none;
  background:radial-gradient(520px 190px at 15% 0%, rgba(160,109,0,.14), transparent 66%);
}
.snp-special-top,.snp-special-reason{ position:relative; z-index:1; }
.snp-special-top{ display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
.snp-special-badge{
  display:inline-flex; align-items:center; gap:8px; width:fit-content; padding:6px 11px; border-radius:999px;
  border:1px solid rgba(160,109,0,.30); color:var(--snp-y); background:rgba(255,255,255,.66); font-size:.84rem; font-weight:900;
}
.snp-special-title{ color:var(--snp-primary); font-size:.92rem; font-weight:900; }
.snp-special-reason{ color:#0f2743; font-size:.96rem; line-height:1.7; word-break:break-word; font-weight:850; }
.snp-special-reason .snp-k{ color:var(--snp-muted); font-weight:900; margin-inline-end:8px; }
.snp-special-reason .snp-v{ font-weight:900; }
.snp-actions-card,.snp-filters-wrap,.snp-notes-wrap{
  background:rgba(255,255,255,.90); border:1px solid var(--snp-border); border-radius:var(--snp-radius);
  box-shadow:var(--snp-shadow-1); padding:14px;
}
.snp-actions-head{ display:grid; gap:2px; margin-bottom:12px; }
.snp-section-title{ color:var(--snp-primary); font-size:1.02rem; font-weight:900; line-height:1.3; }
.snp-section-subtitle{ color:var(--snp-muted); font-size:.88rem; font-weight:800; }
.snp-actions{ display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:10px; }
.snp-btn{
  border:1px solid var(--snp-border); border-radius:15px; min-height:52px; padding:11px 14px; cursor:pointer;
  font-size:.94rem; font-weight:900; letter-spacing:.1px; background:#fff; color:var(--snp-text);
  box-shadow:0 6px 14px rgba(7,42,60,.10);
  transition:transform .2s ease, box-shadow .2s ease, background-color .2s ease, border-color .2s ease; user-select:none;
}
.snp-btn:hover{ transform:translateY(-1px); box-shadow:0 10px 20px rgba(7,42,60,.14); }
.snp-btn:focus-visible{ outline:none; box-shadow:0 0 0 3px rgba(10,75,100,.16); }
.snp-btn.snp-pos{ background:var(--snp-g-bg); color:var(--snp-g); border-color:rgba(15,138,75,.28); }
.snp-btn.snp-pos:hover{ background:var(--snp-g-bg-hover); }
.snp-btn.snp-neg{ background:var(--snp-r-bg); color:var(--snp-r); border-color:rgba(180,35,24,.30); }
.snp-btn.snp-neg:hover{ background:var(--snp-r-bg-hover); }
.snp-btn.snp-gen{ background:var(--snp-y-bg); color:var(--snp-y); border-color:rgba(160,109,0,.32); }
.snp-btn.snp-gen:hover{ background:var(--snp-y-bg-hover); }
.snp-filters-wrap{ padding:10px; }
.snp-filters{ display:flex; gap:8px; overflow:auto; scrollbar-width:none; }
.snp-filters::-webkit-scrollbar{ display:none; }
.snp-chip{
  flex:0 0 auto; border:1px solid var(--snp-border); border-radius:999px; background:#fff; min-height:40px;
  padding:8px 12px; cursor:pointer; display:inline-flex; align-items:center; gap:8px; font-size:.88rem;
  font-weight:900; color:var(--snp-text); transition:all .2s ease; white-space:nowrap;
}
.snp-chip span{
  display:inline-flex; align-items:center; justify-content:center; min-width:24px; height:24px; padding-inline:6px;
  border-radius:999px; border:1px solid rgba(10,75,100,.16); background:var(--snp-primary-soft); color:var(--snp-primary);
  font-size:.8rem; font-weight:900;
}
.snp-chip:hover{ border-color:rgba(10,75,100,.32); box-shadow:0 6px 14px rgba(7,42,60,.12); }
.snp-chip.snp-active{
  background:linear-gradient(145deg, var(--snp-primary), var(--snp-primary-light)); border-color:transparent; color:#fff;
  box-shadow:0 12px 26px rgba(10,75,100,.24);
}
.snp-chip.snp-active span{ background:rgba(255,255,255,.16); border-color:rgba(255,255,255,.35); color:#fff; }
.snp-notes-wrap{ padding:12px; display:grid; gap:12px; }
.snp-list{ display:grid; gap:12px; }
.snp-note{
  background:var(--snp-card); border:1px solid var(--snp-border); border-radius:18px; overflow:hidden;
  box-shadow:0 6px 14px rgba(7,42,60,.09); transition:box-shadow .2s ease, transform .2s ease, border-color .2s ease;
}
.snp-note:hover{ transform:translateY(-1px); box-shadow:0 14px 28px rgba(7,42,60,.12); }
.snp-note[open]{ box-shadow:0 18px 34px rgba(7,42,60,.14); }
.snp-note.snp-positive{ border-inline-start:4px solid var(--snp-g); }
.snp-note.snp-negative{ border-inline-start:4px solid var(--snp-r); }
.snp-note.snp-general{ border-inline-start:4px solid var(--snp-y); }
.snp-note summary{ list-style:none; cursor:pointer; display:grid; grid-template-columns:1fr auto; gap:10px; align-items:center; padding:14px 16px; }
.snp-note summary::-webkit-details-marker{ display:none; }
.snp-note summary::after{
  content:"+"; width:28px; height:28px; border-radius:999px; border:1px solid rgba(10,75,100,.22); display:grid;
  place-items:center; color:var(--snp-primary); font-weight:900; font-size:1rem;
  transition:transform .2s ease, background-color .2s ease; grid-column:2; grid-row:1 / span 2;
}
.snp-note[open] summary::after{ transform:rotate(45deg); background:var(--snp-primary-soft); }
.snp-note summary .snp-title{ display:inline-flex; align-items:center; gap:8px; min-width:0; font-size:.98rem; font-weight:900; color:var(--snp-text); }
.snp-note summary .snp-meta{ color:var(--snp-muted); font-size:.84rem; font-weight:850; display:inline-flex; align-items:center; gap:6px; grid-column:1; }
.snp-type-dot{ width:10px; height:10px; border-radius:50%; display:inline-block; flex-shrink:0; }
.snp-dot-pos{ background:var(--snp-g); }
.snp-dot-neg{ background:var(--snp-r); }
.snp-dot-gen{ background:var(--snp-y); }
.snp-note-body{
  border-top:1px dashed var(--snp-border); padding:12px 16px 14px; display:grid; gap:10px;
  background:linear-gradient(180deg, rgba(244,249,252,.70), rgba(255,255,255,.96));
}
.snp-kv{ background:#fff; border:1px solid rgba(10,75,100,.10); border-radius:12px; padding:10px 11px; line-height:1.75; }
.snp-kv .snp-k{ color:var(--snp-muted); font-weight:850; }
.snp-kv .snp-v{ color:var(--snp-text); font-weight:850; }
.snp-note-actions{ margin-top:2px; display:flex; gap:10px; flex-wrap:wrap; }
.snp-btn.snp-del{ min-height:42px; padding:9px 13px; border-radius:12px; background:#fff; color:var(--snp-r); border-color:rgba(180,35,24,.34); box-shadow:none; }
.snp-btn.snp-del:hover{ background:var(--snp-r-bg); }
.snp-empty{
  text-align:center; color:var(--snp-muted); background:rgba(255,255,255,.90); border:1px dashed var(--snp-border);
  border-radius:16px; padding:18px 14px; font-size:.95rem; font-weight:850;
}
.snp-modal{ position:fixed; inset:0; display:none; place-items:center; background:rgba(10,26,41,.45); backdrop-filter:blur(5px); z-index:5100; padding:14px; }
.snp-modal.snp-open{ display:grid; }
.snp-modal-sheet{
  width:min(620px,96vw); max-height:92vh; background:var(--snp-card); border:1px solid var(--snp-border);
  border-radius:20px; overflow:hidden; box-shadow:var(--snp-shadow-3); display:grid; grid-template-rows:auto 1fr auto;
}
.snp-modal-head{
  padding:14px 16px; display:flex; align-items:center; justify-content:space-between; gap:10px;
  border-bottom:1px solid var(--snp-border); background:linear-gradient(180deg, #ffffff 0%, #f7fbfe 100%);
  color:var(--snp-primary); font-weight:900; font-size:1.02rem;
}
.snp-close-x{
  border:1px solid rgba(10,75,100,.22); background:#fff; color:var(--snp-muted); width:34px; height:34px;
  border-radius:11px; font-size:1rem; font-weight:900; cursor:pointer; transition:all .2s ease;
}
.snp-close-x:hover{ color:var(--snp-primary); border-color:rgba(10,75,100,.40); background:var(--snp-primary-soft); }
.snp-modal-body{ padding:14px 16px; background:#fff; display:grid; gap:11px; overflow:auto; }
.snp-row{ display:grid; gap:6px; }
.snp-row label{ color:var(--snp-muted); font-size:.90rem; font-weight:900; }
.snp-row input[type="text"], .snp-row textarea, .snp-row input[type="date"]{
  width:100%; border:1px solid var(--snp-border); border-radius:12px; min-height:46px; padding:10px 11px;
  background:#fff; color:var(--snp-text); font-size:.96rem; font-weight:700;
  transition:border-color .2s ease, box-shadow .2s ease;
}
.snp-row textarea{ min-height:104px; resize:vertical; }
.snp-row input:focus-visible, .snp-row textarea:focus-visible{
  outline:none; border-color:rgba(10,75,100,.42); box-shadow:0 0 0 3px rgba(10,75,100,.12);
}
.snp-modal-actions{
  padding:12px 16px 16px; display:flex; gap:10px; flex-wrap:wrap; border-top:1px solid var(--snp-border);
  background:linear-gradient(180deg, #ffffff 0%, #f7fbfe 100%);
}
.snp-btn.snp-primary{ border:none; color:#fff; background:linear-gradient(145deg, var(--snp-primary), var(--snp-primary-light)); }
.snp-btn.snp-ghost{ background:#fff; color:var(--snp-primary); border-color:rgba(10,75,100,.28); }
@media (max-width:920px){
  .snp-actions{ grid-template-columns:1fr 1fr; }
  .snp-actions .snp-btn:last-child{ grid-column:1 / -1; }
}
@media (max-width:640px){
  .snp-wrap{ padding-inline:12px; }
  .snp-headrow{ min-height:66px; }
  .snp-pagetitle{ font-size:.95rem; }
  .snp-backbtn{ min-height:42px; padding-inline:13px; }
  .snp-main{ padding-block:15px 28px; gap:12px; }
  .snp-hero{ padding:14px 13px; border-radius:20px; }
  .snp-stu-name{ font-size:1.15rem; }
  .snp-stu-class{ font-size:.92rem; }
  .snp-actions-card,.snp-filters-wrap,.snp-notes-wrap{ padding:11px; }
  .snp-actions-head{ text-align:center; }
  .snp-actions{ grid-template-columns:1fr; }
  .snp-btn{ min-height:48px; font-size:.91rem; }
  .snp-filters{ overflow:visible; flex-wrap:wrap; justify-content:center; }
  .snp-chip{ min-height:37px; padding:7px 11px; font-size:.84rem; }
  .snp-chip span{ min-width:22px; height:22px; font-size:.76rem; }
  .snp-note{ border-radius:14px; }
  .snp-note summary{ padding:12px 12px; }
  .snp-note summary .snp-title{ font-size:.92rem; }
  .snp-note summary .snp-meta{ font-size:.8rem; }
  .snp-note summary::after{ width:24px; height:24px; font-size:.94rem; }
  .snp-note-body{ padding:10px 12px 12px; }
  .snp-kv{ padding:9px 10px; }
  .snp-modal{ align-items:center; padding:12px; }
  .snp-modal-sheet{ width:min(96vw, 560px); max-height:92vh; border-radius:18px; border:1px solid var(--snp-border); }
  .snp-modal-head{ padding:13px 12px; }
  .snp-modal-body{ padding:12px; }
  .snp-modal-actions{ padding:10px 12px 14px; }
  .snp-modal-actions .snp-btn{ flex:1 1 0; }
}
`;

const TEMPLATE_HTML = `
  <div class="snp-topbar">
    <div class="snp-wrap">
      <div class="snp-headrow">
        <button type="button" class="snp-backbtn" aria-label="رجوع">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          رجوع
        </button>
        <div class="snp-pagetitle">ملف الطالب</div>
      </div>
    </div>
  </div>
  <div class="snp-scroll">
    <main class="snp-wrap snp-main">
      <section class="snp-hero" aria-label="معلومات الطالب">
        <div class="snp-stu">
          <h1 class="snp-stu-name">—</h1>
          <p class="snp-stu-class">—</p>
        </div>
      </section>
      <div class="snp-special-banner" aria-live="polite">
        <div class="snp-special-top">
          <span class="snp-special-badge">حالة خاصة</span>
          <span class="snp-special-title">معلومة للمعلم فقط</span>
        </div>
        <div class="snp-special-reason">
          <span class="snp-k">السبب:</span>
          <span class="snp-v">—</span>
        </div>
      </div>
      <section class="snp-actions-card" aria-label="إجراءات الملاحظات">
        <div class="snp-actions-head">
          <h2 class="snp-section-title">إضافة جديدة</h2>
          <p class="snp-section-subtitle">اختر نوع الملاحظة قبل إدخال التفاصيل</p>
        </div>
        <div class="snp-actions">
          <button class="snp-btn snp-pos" type="button" data-add="positive">تسجيل إيجابية</button>
          <button class="snp-btn snp-neg" type="button" data-add="negative">تسجيل سلبية</button>
          <button class="snp-btn snp-gen" type="button" data-add="general">تسجيل ملاحظة</button>
        </div>
      </section>
      <section class="snp-filters-wrap" aria-label="تصفية الملاحظات">
        <div class="snp-filters">
          <button class="snp-chip snp-active" data-filter="all" type="button">الكل <span data-count="all">0</span></button>
          <button class="snp-chip" data-filter="positive" type="button">إيجابية <span data-count="positive">0</span></button>
          <button class="snp-chip" data-filter="negative" type="button">سلبية <span data-count="negative">0</span></button>
          <button class="snp-chip" data-filter="general" type="button">ملاحظة <span data-count="general">0</span></button>
        </div>
      </section>
      <section class="snp-notes-wrap" aria-label="قائمة الملاحظات">
        <div class="snp-list">
          <div class="snp-empty">لا توجد ملاحظات بعد.</div>
        </div>
      </section>
    </main>
  </div>
  <div class="snp-modal" aria-hidden="true">
    <div class="snp-modal-sheet" role="dialog" aria-modal="true">
      <div class="snp-modal-head">
        <div class="snp-dlg-title">إضافة ملاحظة</div>
        <button class="snp-close-x" type="button" aria-label="إغلاق">✕</button>
      </div>
      <div class="snp-modal-body">
        <div class="snp-row">
          <label>العنوان</label>
          <input type="text" data-field="title" required />
        </div>
        <div class="snp-row">
          <label>الوصف</label>
          <textarea data-field="desc" required></textarea>
        </div>
        <div class="snp-row">
          <label>الإجراء المتخذ</label>
          <input type="text" data-field="act" required />
        </div>
        <div class="snp-row">
          <label>التاريخ</label>
          <input type="date" data-field="date" required />
        </div>
      </div>
      <div class="snp-modal-actions">
        <button class="snp-btn snp-primary snp-save-note" type="button">حفظ</button>
        <button class="snp-btn snp-ghost snp-cancel-note" type="button">إلغاء</button>
      </div>
    </div>
  </div>
`;

function injectStylesOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS_TEXT;
  document.head.appendChild(style);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}
function nl2br(s) {
  return s.replace(/\n/g, "<br>");
}

export function mountStudentNotesSheet({ db, auth }) {
  injectStylesOnce();

  const root = document.createElement("div");
  root.className = "snp-overlay";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = TEMPLATE_HTML;
  document.body.appendChild(root);

  const backBtn = root.querySelector(".snp-backbtn");
  const stuNameEl = root.querySelector(".snp-stu-name");
  const stuClassEl = root.querySelector(".snp-stu-class");
  const specialBanner = root.querySelector(".snp-special-banner");
  const specialReasonText = root.querySelector(".snp-special-reason .snp-v");
  const filtersEl = root.querySelector(".snp-filters");
  const notesListEl = root.querySelector(".snp-list");
  const cAll = root.querySelector('[data-count="all"]');
  const cPos = root.querySelector('[data-count="positive"]');
  const cNeg = root.querySelector('[data-count="negative"]');
  const cGen = root.querySelector('[data-count="general"]');
  const modal = root.querySelector(".snp-modal");
  const dlgTitle = root.querySelector(".snp-dlg-title");
  const fldTitle = root.querySelector('[data-field="title"]');
  const fldDesc = root.querySelector('[data-field="desc"]');
  const fldAct = root.querySelector('[data-field="act"]');
  const fldDate = root.querySelector('[data-field="date"]');
  const saveBtn = root.querySelector(".snp-save-note");
  const cancelBtn = root.querySelector(".snp-cancel-note");
  const closeXBtn = root.querySelector(".snp-close-x");

  const paths = { positive: "positiveNotes", negative: "negativeNotes", general: "generalNotes" };
  const counters = { all: 0, positive: 0, negative: 0, general: 0 };
  let studentId = null;
  let studentName = "—";
  let studentClass = "—";
  let filter = "all";
  let pendingType = "general";

  function openSheet() {
    root.classList.add("snp-open");
    root.setAttribute("aria-hidden", "false");
  }
  function closeSheet() {
    root.classList.remove("snp-open");
    root.setAttribute("aria-hidden", "true");
  }
  backBtn.addEventListener("click", closeSheet);

  function openModal(type) {
    pendingType = type;
    dlgTitle.textContent = type === "positive" ? "إضافة إيجابية" : type === "negative" ? "إضافة سلبية" : "إضافة ملاحظة";
    const nowKW = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuwait" }));
    fldTitle.value = ""; fldDesc.value = ""; fldAct.value = "";
    fldDate.value = `${nowKW.getFullYear()}-${String(nowKW.getMonth() + 1).padStart(2, "0")}-${String(nowKW.getDate()).padStart(2, "0")}`;
    modal.classList.add("snp-open");
    modal.setAttribute("aria-hidden", "false");
    setTimeout(() => fldTitle.focus(), 10);
  }
  function closeModal() {
    modal.classList.remove("snp-open");
    modal.setAttribute("aria-hidden", "true");
  }
  root.querySelector('[data-add="positive"]').addEventListener("click", () => openModal("positive"));
  root.querySelector('[data-add="negative"]').addEventListener("click", () => openModal("negative"));
  root.querySelector('[data-add="general"]').addEventListener("click", () => openModal("general"));
  cancelBtn.addEventListener("click", closeModal);
  closeXBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (modal.classList.contains("snp-open")) closeModal();
    else if (root.classList.contains("snp-open")) closeSheet();
  });

  async function loadSpecialCaseReason() {
    try {
      if (!studentId) { specialBanner.classList.remove("snp-show"); return; }
      const snap = await getDoc(doc(db, "students", studentId));
      if (!snap.exists()) { specialBanner.classList.remove("snp-show"); return; }
      const d = snap.data() || {};
      const isSpecial = d.specialCase === true;
      const reason =
        (typeof d.specialCaseReason === "string" && d.specialCaseReason.trim()) ? d.specialCaseReason.trim() :
        (typeof d.specialCase_reason === "string" && d.specialCase_reason.trim()) ? d.specialCase_reason.trim() :
        (typeof d.specialCaseNote === "string" && d.specialCaseNote.trim()) ? d.specialCaseNote.trim() :
        (typeof d.reason === "string" && d.reason.trim()) ? d.reason.trim() : "";
      if (isSpecial && reason) {
        specialReasonText.textContent = reason;
        specialBanner.classList.add("snp-show");
      } else {
        specialBanner.classList.remove("snp-show");
      }
    } catch (e) {
      console.error("[student-notes-sheet] loadSpecialCaseReason failed", e);
      specialBanner.classList.remove("snp-show");
    }
  }

  async function loadType(teacherId, type) {
    const col = collection(db, "students", studentId, "notes_by_teacher", teacherId, paths[type]);
    const qy = query(col, orderBy("date", "desc"));
    const snap = await getDocs(qy);
    const arr = [];
    snap.forEach((d) => {
      const data = d.data() || {};
      const dt = data.date?.toDate ? data.date.toDate() : (data.date instanceof Date ? data.date : null);
      arr.push({
        id: d.id, type, title: data.title || "", description: data.description || "",
        actionTaken: data.actionTaken || "", date: dt, dateMs: dt ? dt.getTime() : 0, refPath: d.ref.path,
      });
    });
    return arr;
  }

  function renderList(all) {
    notesListEl.innerHTML = "";
    const filtered = all.filter((n) => (filter === "all" ? true : n.type === filter));
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "snp-empty";
      empty.textContent = "لا توجد ملاحظات.";
      notesListEl.appendChild(empty);
      return;
    }
    filtered.forEach((n) => {
      const det = document.createElement("details");
      det.className = `snp-note snp-${n.type}`;
      const dotClass = n.type === "positive" ? "snp-dot-pos" : n.type === "negative" ? "snp-dot-neg" : "snp-dot-gen";
      const typeText = n.type === "positive" ? "إيجابية" : n.type === "negative" ? "سلبية" : "ملاحظة";
      const dateStr = n.date ? new Intl.DateTimeFormat("ar-KW", { dateStyle: "medium" }).format(n.date) : "—";
      det.innerHTML = `
        <summary>
          <span class="snp-title"><span class="snp-type-dot ${dotClass}"></span>${escapeHtml(n.title || "—")}</span>
          <span class="snp-meta">${typeText} • ${dateStr}</span>
        </summary>
        <div class="snp-note-body">
          <div class="snp-kv"><span class="snp-k">الوصف:</span> <span class="snp-v">${nl2br(escapeHtml(n.description || "—"))}</span></div>
          <div class="snp-kv"><span class="snp-k">الإجراء المتخذ:</span> <span class="snp-v">${nl2br(escapeHtml(n.actionTaken || "—"))}</span></div>
          <div class="snp-note-actions">
            <button class="snp-btn snp-del" data-del="${n.refPath}" type="button">حذف الملاحظة</button>
          </div>
        </div>
      `;
      notesListEl.appendChild(det);
    });
    notesListEl.querySelectorAll("button[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const path = btn.getAttribute("data-del");
        if (!confirm("تأكيد حذف الملاحظة؟ لا يمكن التراجع.")) return;
        try {
          await deleteDoc(doc(db, path));
          await loadAll();
        } catch (e) {
          console.error(e);
          alert("تعذّر الحذف.");
        }
      });
    });
  }

  async function loadAll() {
    const teacherId = auth.currentUser?.uid;
    if (!teacherId || !studentId) return;
    const [positive, negative, general] = await Promise.all([
      loadType(teacherId, "positive"), loadType(teacherId, "negative"), loadType(teacherId, "general"),
    ]);
    const all = [...positive, ...negative, ...general].sort((a, b) => b.dateMs - a.dateMs);
    counters.positive = positive.length;
    counters.negative = negative.length;
    counters.general = general.length;
    counters.all = all.length;
    cAll.textContent = counters.all;
    cPos.textContent = counters.positive;
    cNeg.textContent = counters.negative;
    cGen.textContent = counters.general;
    renderList(all);
  }

  filtersEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".snp-chip");
    if (!btn) return;
    filtersEl.querySelectorAll(".snp-chip").forEach((c) => c.classList.remove("snp-active"));
    btn.classList.add("snp-active");
    filter = btn.dataset.filter;
    loadAll();
  });

  saveBtn.addEventListener("click", async () => {
    if (!fldTitle.value.trim() || !fldDesc.value.trim() || !fldAct.value.trim() || !fldDate.value) {
      alert("يرجى تعبئة جميع الحقول.");
      return;
    }
    try {
      const user = auth.currentUser;
      if (!user) { alert("يرجى تسجيل الدخول"); return; }
      const colRef = collection(db, "students", studentId, "notes_by_teacher", user.uid, paths[pendingType]);
      const [y, m, d] = fldDate.value.split("-").map(Number);
      const date = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
      await addDoc(colRef, {
        title: fldTitle.value.trim(), description: fldDesc.value.trim(), actionTaken: fldAct.value.trim(),
        date, studentName: studentName || null, studentClass: studentClass || null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: user.uid, updatedBy: user.uid,
      });
      closeModal();
      await loadAll();
    } catch (e) {
      console.error(e);
      alert("تعذّر الحفظ.");
    }
  });

  async function open(id, meta = {}) {
    studentId = id || "";
    studentName = meta.name || meta.studentName || "—";
    studentClass = meta.className || meta.class || "—";
    stuNameEl.textContent = studentName;
    stuClassEl.textContent = studentClass;
    filter = "all";
    filtersEl.querySelectorAll(".snp-chip").forEach((c) => c.classList.toggle("snp-active", c.dataset.filter === "all"));
    openSheet();
    await Promise.all([loadSpecialCaseReason(), loadAll()]);
  }

  return { open, close: closeSheet };
}
