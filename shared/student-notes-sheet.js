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
  --snp-primary:var(--primary, #0b4a63);
  --snp-primary-deep:var(--primary-2, var(--primary-light, #083648));
  --snp-primary-soft:#e3eef2;
  --snp-ground:#f2f5f7; --snp-text:#13232e; --snp-muted:#66798a;
  --snp-border:#e1e7eb; --snp-card:#ffffff;
  --snp-radius-lg:16px; --snp-radius:12px;
  --snp-shadow:0 1px 2px rgba(15,30,40,.05), 0 8px 22px rgba(15,30,40,.07);
  --snp-shadow-lg:0 24px 56px rgba(9,20,28,.24);
  --snp-good:#1e8e5a; --snp-good-soft:#e4f5ec;
  --snp-bad:#bf3a2a; --snp-bad-soft:#fbeae7;
  --snp-warn:#a06a12; --snp-warn-soft:#f7edd9;
  --snp-font:var(--app-font, "Tajawal", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif);
  position:fixed; inset:0; z-index:5000; display:flex; flex-direction:column;
  background:var(--snp-ground);
  color:var(--snp-text); font-family:var(--snp-font);
  line-height:1.6; font-weight:600; transform:translateX(100%);
  transition:transform .28s cubic-bezier(.22,.7,.25,1); -webkit-tap-highlight-color:transparent;
}
.snp-overlay.snp-open{ transform:translateX(0); }
.snp-overlay *{ box-sizing:border-box; }
.snp-overlay button,.snp-overlay input,.snp-overlay textarea,.snp-overlay select,.snp-overlay summary{
  font-family:var(--snp-font);
}
.snp-wrap{ position:relative; width:100%; max-width:760px; margin:0 auto; padding-inline:16px; }
.snp-topbar{
  position:sticky; top:0; z-index:20; background:rgba(255,255,255,.94); backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);
  border-bottom:1px solid var(--snp-border); flex-shrink:0;
  padding-top:env(safe-area-inset-top, 0px);
}
.snp-headrow{ min-height:58px; display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:10px; }
.snp-pagetitle{
  grid-column:2; justify-self:center; color:var(--snp-text); font-weight:800; font-size:1rem;
  min-width:0; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.snp-backbtn{
  grid-column:1; justify-self:start; min-height:40px; padding:0 14px; border-radius:var(--snp-radius);
  border:1px solid var(--snp-border); background:#fff; color:var(--snp-primary); font-weight:800; cursor:pointer;
  display:inline-flex; align-items:center; gap:6px; font-size:.92rem; flex-shrink:0;
  transition:background-color .15s ease, border-color .15s ease;
}
.snp-backbtn:hover{ background:var(--snp-primary-soft); border-color:rgba(11,74,99,.3); }
.snp-scroll{ flex:1 1 auto; overflow-y:auto; -webkit-overflow-scrolling:touch; }
.snp-main{ padding-block:16px 36px; display:grid; gap:14px; }
.snp-hero{
  background:linear-gradient(155deg, var(--snp-card), var(--snp-primary-soft) 180%);
  border:1px solid var(--snp-border);
  border-radius:var(--snp-radius-lg); padding:16px; box-shadow:var(--snp-shadow);
  display:flex; align-items:center; gap:14px;
}
.snp-stu-avatar{
  flex-shrink:0; width:52px; height:52px; border-radius:50%;
  background:linear-gradient(145deg, var(--snp-primary-deep), var(--snp-primary));
  color:#fff; font-weight:800; font-size:1.15rem; display:grid; place-items:center;
  box-shadow:0 8px 18px rgba(11,74,99,.28);
}
.snp-stu{ display:flex; flex-direction:column; gap:6px; min-width:0; }
.snp-stu-name{
  font-weight:800; color:var(--snp-text); font-size:clamp(1.05rem,4.6vw,1.3rem); line-height:1.3;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.snp-stu-class{
  display:inline-flex; align-self:flex-start; align-items:center; padding:3px 12px; border-radius:999px;
  background:var(--snp-primary-soft); color:var(--snp-primary); font-weight:800; font-size:.82rem;
}
.snp-special-banner{
  display:none; gap:8px; background:var(--snp-warn-soft);
  border:1px solid rgba(160,106,18,.22); border-inline-start:4px solid var(--snp-warn);
  border-radius:var(--snp-radius); padding:12px 14px;
}
.snp-special-banner.snp-show{ display:grid; }
.snp-special-top{ display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
.snp-special-badge{
  display:inline-flex; align-items:center; padding:3px 10px; border-radius:999px;
  border:1px solid rgba(160,106,18,.3); color:var(--snp-warn); background:#fff; font-size:.78rem; font-weight:800;
}
.snp-special-title{ color:var(--snp-muted); font-size:.82rem; font-weight:700; }
.snp-special-reason{ color:var(--snp-text); font-size:.92rem; line-height:1.65; word-break:break-word; font-weight:600; }
.snp-special-reason .snp-k{ color:var(--snp-muted); font-weight:800; margin-inline-end:6px; }
.snp-special-reason .snp-v{ font-weight:700; }
.snp-actions-card,.snp-filters-wrap,.snp-notes-wrap{
  background:var(--snp-card); border:1px solid var(--snp-border); border-radius:var(--snp-radius-lg);
  box-shadow:var(--snp-shadow); padding:14px;
}
.snp-actions-head{ display:grid; gap:2px; margin-bottom:10px; }
.snp-section-title{ color:var(--snp-text); font-size:.98rem; font-weight:800; line-height:1.3; }
.snp-section-subtitle{ color:var(--snp-muted); font-size:.84rem; font-weight:600; }
.snp-actions{ display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:8px; }
.snp-btn{
  border:1px solid var(--snp-border); border-radius:var(--snp-radius); min-height:48px; padding:10px 12px; cursor:pointer;
  font-size:.9rem; font-weight:800; background:#fff; color:var(--snp-text);
  transition:transform .12s ease, background-color .15s ease, border-color .15s ease; user-select:none;
}
.snp-btn:hover{ transform:translateY(-1px); }
.snp-btn:active{ transform:translateY(0); }
.snp-btn:focus-visible{ outline:none; box-shadow:0 0 0 3px rgba(11,74,99,.22); }
.snp-btn.snp-pos{ background:var(--snp-good-soft); color:var(--snp-good); border-color:rgba(30,142,90,.25); }
.snp-btn.snp-neg{ background:var(--snp-bad-soft); color:var(--snp-bad); border-color:rgba(191,58,42,.25); }
.snp-btn.snp-gen{ background:var(--snp-warn-soft); color:var(--snp-warn); border-color:rgba(160,106,18,.28); }
/* Action tiles: icon over a short label, so all three fit in one row even
   on a narrow phone instead of stacking into three tall full-width bars. */
.snp-actions .snp-btn{
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px;
  min-height:76px; padding:12px 6px;
}
.snp-btn-icon{ width:22px; height:22px; display:grid; place-items:center; }
.snp-btn-icon svg{ width:100%; height:100%; }
.snp-btn-label{ font-size:.84rem; line-height:1.2; }
.snp-filters-wrap{ padding:10px; }
.snp-filters{
  display:flex; gap:8px; overflow-x:auto; overflow-y:hidden; scrollbar-width:none;
  scroll-snap-type:x proximity; padding-block:1px;
}
.snp-filters::-webkit-scrollbar{ display:none; }
.snp-chip{
  flex:0 0 auto; border:1px solid var(--snp-border); border-radius:999px; background:#fff; min-height:38px;
  padding:7px 12px; cursor:pointer; display:inline-flex; align-items:center; gap:7px; font-size:.86rem;
  font-weight:800; color:var(--snp-text); transition:background-color .15s ease, border-color .15s ease; white-space:nowrap;
  scroll-snap-align:start;
}
.snp-chip span{
  display:inline-flex; align-items:center; justify-content:center; min-width:22px; height:22px; padding-inline:5px;
  border-radius:999px; background:var(--snp-ground); color:var(--snp-muted); font-size:.76rem; font-weight:800;
}
.snp-chip:hover{ border-color:rgba(11,74,99,.3); }
.snp-chip.snp-active{ background:var(--snp-primary); border-color:var(--snp-primary); color:#fff; }
.snp-chip.snp-active span{ background:rgba(255,255,255,.22); color:#fff; }
.snp-notes-wrap{ padding:12px; display:grid; gap:10px; }
.snp-list{ display:grid; gap:10px; }
.snp-note{
  background:var(--snp-card); border:1px solid var(--snp-border); border-radius:var(--snp-radius-lg); overflow:hidden;
  transition:border-color .15s ease;
}
.snp-note[open]{ border-color:rgba(11,74,99,.3); }
.snp-note.snp-positive{ border-inline-start:4px solid var(--snp-good); }
.snp-note.snp-negative{ border-inline-start:4px solid var(--snp-bad); }
.snp-note.snp-general{ border-inline-start:4px solid var(--snp-warn); }
.snp-note summary{ list-style:none; cursor:pointer; display:grid; grid-template-columns:1fr auto; gap:10px; align-items:center; padding:13px 14px; }
.snp-note summary::-webkit-details-marker{ display:none; }
.snp-note summary::after{
  content:"+"; width:26px; height:26px; border-radius:999px; border:1px solid var(--snp-border); display:grid;
  place-items:center; color:var(--snp-primary); font-weight:800; font-size:1rem;
  transition:transform .2s ease, background-color .15s ease; grid-column:2; grid-row:1 / span 2;
}
.snp-note[open] summary::after{ transform:rotate(45deg); background:var(--snp-primary-soft); }
.snp-note summary .snp-title{ display:inline-flex; align-items:center; gap:8px; min-width:0; font-size:.94rem; font-weight:800; color:var(--snp-text); }
.snp-note summary .snp-meta{ color:var(--snp-muted); font-size:.8rem; font-weight:600; display:inline-flex; align-items:center; gap:6px; grid-column:1; }
.snp-note-body{
  border-top:1px solid var(--snp-border); padding:12px 14px 14px; display:grid; gap:8px; background:var(--snp-ground);
}
.snp-kv{ background:#fff; border:1px solid var(--snp-border); border-radius:var(--snp-radius); padding:9px 11px; line-height:1.7; }
.snp-kv .snp-k{ color:var(--snp-muted); font-weight:800; }
.snp-kv .snp-v{ color:var(--snp-text); font-weight:600; }
.snp-note-actions{ margin-top:2px; display:flex; gap:10px; flex-wrap:wrap; }
.snp-btn.snp-del{ min-height:40px; padding:8px 12px; background:#fff; color:var(--snp-bad); border-color:rgba(191,58,42,.3); }
.snp-btn.snp-del:hover{ background:var(--snp-bad-soft); }
.snp-empty{
  text-align:center; color:var(--snp-muted); background:var(--snp-ground); border:1px dashed var(--snp-border);
  border-radius:var(--snp-radius); padding:16px 14px; font-size:.92rem; font-weight:600;
}
.snp-modal{
  position:fixed; inset:0; display:none; place-items:center; background:rgba(10,20,28,.55);
  backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); z-index:5100; padding:16px;
}
.snp-modal.snp-open{ display:grid; }
.snp-modal-sheet{
  width:min(480px,94vw); max-height:min(88vh, 640px); background:var(--snp-card); border:1px solid var(--snp-border);
  border-radius:20px; overflow:hidden; box-shadow:var(--snp-shadow-lg); display:grid; grid-template-rows:auto 1fr auto;
  animation:snp-modal-in .2s cubic-bezier(.22,.7,.25,1);
}
@keyframes snp-modal-in{
  from{ opacity:0; transform:translateY(10px) scale(.97); }
  to{ opacity:1; transform:translateY(0) scale(1); }
}
@media (prefers-reduced-motion: reduce){
  .snp-modal-sheet{ animation:none; }
}
.snp-modal-head{
  padding:16px 18px; display:flex; align-items:center; justify-content:space-between; gap:10px;
  border-bottom:1px solid var(--snp-border); color:var(--snp-text); font-weight:800; font-size:1.05rem;
  background:var(--snp-ground);
}
.snp-close-x{
  border:1px solid var(--snp-border); background:#fff; color:var(--snp-muted); width:32px; height:32px;
  border-radius:var(--snp-radius); font-size:.95rem; font-weight:800; cursor:pointer; transition:background-color .15s ease;
}
.snp-close-x:hover{ color:var(--snp-text); background:var(--snp-ground); }
.snp-modal-body{ padding:18px; background:#fff; display:grid; gap:14px; overflow:auto; -webkit-overflow-scrolling:touch; }
.snp-row{ display:grid; gap:6px; }
.snp-row label{ color:var(--snp-muted); font-size:.86rem; font-weight:800; }
.snp-row input[type="text"], .snp-row textarea, .snp-row input[type="date"]{
  width:100%; border:1px solid var(--snp-border); border-radius:var(--snp-radius); min-height:46px; padding:11px 12px;
  background:var(--snp-ground); color:var(--snp-text); font-size:16px; font-weight:600;
  transition:border-color .15s ease, box-shadow .15s ease, background-color .15s ease;
}
.snp-row textarea{ min-height:100px; resize:vertical; }
.snp-row input:focus-visible, .snp-row textarea:focus-visible{
  outline:none; border-color:var(--snp-primary); background:#fff; box-shadow:0 0 0 3px rgba(11,74,99,.14);
}
.snp-modal-actions{
  padding:14px 18px calc(16px + env(safe-area-inset-bottom, 0px)); display:flex; gap:10px; flex-wrap:wrap-reverse;
  border-top:1px solid var(--snp-border); background:var(--snp-ground);
}
.snp-modal-actions .snp-btn{ flex:1 1 140px; min-height:48px; }
.snp-btn.snp-primary{ border:1px solid var(--snp-primary); color:#fff; background:var(--snp-primary); }
.snp-btn.snp-primary:hover{ background:var(--snp-primary-deep); border-color:var(--snp-primary-deep); }
.snp-btn.snp-ghost{ background:#fff; color:var(--snp-text); }
@media (max-width:640px){
  .snp-wrap{ padding-inline:12px; }
  .snp-headrow{ min-height:54px; }
  .snp-main{ padding-block:12px 28px; gap:10px; }
  .snp-hero{ padding:12px 13px; gap:12px; }
  .snp-stu-avatar{ width:46px; height:46px; font-size:1.05rem; }
  .snp-actions-card,.snp-filters-wrap,.snp-notes-wrap{ padding:11px; }
  .snp-actions{ gap:7px; }
  .snp-actions .snp-btn{ min-height:70px; padding:10px 4px; }
  .snp-btn-label{ font-size:.78rem; }
  .snp-note summary{ padding:12px; }
  .snp-note summary .snp-title{ font-size:.9rem; }
  .snp-note summary .snp-meta{ font-size:.78rem; }
  .snp-note-body{ padding:10px 12px 12px; }
  .snp-modal{ padding:12px; }
  .snp-modal-sheet{ width:100%; max-width:420px; max-height:85vh; border-radius:18px; }
  .snp-modal-head{ padding:14px 16px; font-size:1rem; }
  .snp-modal-body{ padding:16px; gap:12px; }
  .snp-modal-actions{ padding:12px 16px calc(14px + env(safe-area-inset-bottom, 0px)); }
  .snp-modal-actions .snp-btn{ flex-basis:100%; }
}
@media (max-width:360px){
  .snp-btn-label{ font-size:.72rem; }
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
        <div class="snp-stu-avatar" aria-hidden="true">؟</div>
        <div class="snp-stu">
          <h1 class="snp-stu-name">—</h1>
          <span class="snp-stu-class">—</span>
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
          <button class="snp-btn snp-pos" type="button" data-add="positive">
            <span class="snp-btn-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            </span>
            <span class="snp-btn-label">إيجابية</span>
          </button>
          <button class="snp-btn snp-neg" type="button" data-add="negative">
            <span class="snp-btn-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L14.1 3.9a2 2 0 0 0-3.6 0Z"/></svg>
            </span>
            <span class="snp-btn-label">سلبية</span>
          </button>
          <button class="snp-btn snp-gen" type="button" data-add="general">
            <span class="snp-btn-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5V6a2 2 0 0 1 2-2h9.5L20 8.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M14 4v5h5"/><path d="M8 13h8M8 17h5"/></svg>
            </span>
            <span class="snp-btn-label">ملاحظة</span>
          </button>
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
function initialOf(name) {
  const trimmed = String(name || "").trim();
  return trimmed ? trimmed[0].toUpperCase() : "؟";
}

export function mountStudentNotesSheet({ db, auth }) {
  injectStylesOnce();

  const root = document.createElement("div");
  root.className = "snp-overlay";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = TEMPLATE_HTML;
  document.body.appendChild(root);

  const backBtn = root.querySelector(".snp-backbtn");
  const pageTitleEl = root.querySelector(".snp-pagetitle");
  const stuAvatarEl = root.querySelector(".snp-stu-avatar");
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
      const typeText = n.type === "positive" ? "إيجابية" : n.type === "negative" ? "سلبية" : "ملاحظة";
      const dateStr = n.date ? new Intl.DateTimeFormat("ar-KW", { dateStyle: "medium" }).format(n.date) : "—";
      det.innerHTML = `
        <summary>
          <span class="snp-title">${escapeHtml(n.title || "—")}</span>
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
    stuAvatarEl.textContent = initialOf(studentName);
    // The page title stays on the student's name (instead of the generic
    // "ملف الطالب") so it's still clear who this is once the hero card
    // scrolls out of view.
    pageTitleEl.textContent = studentName;
    filter = "all";
    filtersEl.querySelectorAll(".snp-chip").forEach((c) => c.classList.toggle("snp-active", c.dataset.filter === "all"));
    openSheet();
    await Promise.all([loadSpecialCaseReason(), loadAll()]);
  }

  return { open, close: closeSheet };
}
