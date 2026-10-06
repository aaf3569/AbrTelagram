/* Department head → teacher profile → الفصول → a class: the same view
   فصولي gives a teacher on Teachers/user.html, but for one of the head's
   teachers. Two stacked sheets:
     - the class: its students, how many notes (إيجابية/سلبية/ملاحظة) that
       teacher has written for each, and a search field;
     - ملاحظات: just the students that teacher has notes for.
   A student opens the shared student profile (studentNotes) on that
   teacher's notes, read-only (see open(..., { teacherUid }) in
   /shared/student-notes-sheet.js).

   Uses the host page's .sheet/.sheet-header/.back-btn/.sheet-title/
   .sheet-body chrome; everything else is "tcs-" scoped. Appended to the end
   of <body> so both sheets stack above the teacher profile sheet. */
import { collection, doc, getDoc, getDocs, query, where } from "/shared/firebase.js";

const STYLE_ID = "tcs-styles";

const NOTE_TYPES = [
  { key: "positive", path: "positiveNotes", label: "إيجابية" },
  { key: "negative", path: "negativeNotes", label: "سلبية" },
  { key: "general",  path: "generalNotes",  label: "ملاحظة" },
];

const CSS_TEXT = `
.tcs-hero{
  display:flex; align-items:center; gap:14px; padding:16px; border-radius:var(--radius,16px);
  background:linear-gradient(145deg,var(--primary-2,#044563),var(--primary,#022b42)); color:#fff;
  box-shadow:0 14px 30px rgba(2,43,66,.22);
}
.tcs-hero-icon{ width:52px; height:52px; flex-shrink:0; border-radius:14px; display:grid; place-items:center; background:rgba(255,255,255,.14); font-size:1.3rem; }
.tcs-hero-text{ display:grid; gap:4px; min-width:0; }
.tcs-hero-class{ margin:0; font-size:clamp(1.3rem,5vw,1.7rem); font-weight:900; line-height:1.2; }
.tcs-hero-sub{ font-size:.88rem; font-weight:700; opacity:.85; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tcs-notes-card{
  display:flex; align-items:center; gap:14px; width:100%; padding:14px 16px; border-radius:var(--radius,16px);
  background:var(--card-bg,#fff); border:1.5px solid rgba(2,43,66,.18); box-shadow:var(--shadow-1);
  font-family:inherit; text-align:start; cursor:pointer; transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease;
}
.tcs-notes-card:hover:not(:disabled){ transform:translateY(-2px); border-color:var(--primary,#022b42); box-shadow:var(--shadow-2); }
.tcs-notes-card:disabled{ cursor:progress; }
.tcs-notes-count{
  flex-shrink:0; min-width:58px; height:58px; padding:0 10px; border-radius:16px; display:grid; place-items:center;
  background:linear-gradient(145deg,var(--primary-2,#044563),var(--primary,#022b42)); color:#fff;
  font-size:1.6rem; font-weight:900; line-height:1; box-shadow:0 10px 22px rgba(2,43,66,.24);
}
.tcs-notes-card.is-empty .tcs-notes-count{ background:var(--primary-light,#eef3f6); color:var(--muted,#64748b); box-shadow:none; }
.tcs-notes-text{ display:grid; gap:3px; flex:1; min-width:0; }
.tcs-notes-text b{ color:var(--primary,#022b42); font-size:1.05rem; font-weight:900; }
.tcs-notes-text small{ color:var(--muted,#64748b); font-size:.86rem; font-weight:700; line-height:1.5; }
.tcs-chev{ color:var(--primary,#022b42); flex-shrink:0; }
.tcs-notes-card.is-empty .tcs-chev{ color:var(--muted,#64748b); }
.tcs-search{ display:flex; align-items:center; gap:10px; min-height:50px; padding:0 14px; background:var(--card-bg,#fff); border:1px solid var(--border,#e2e8f0); border-radius:var(--radius-sm,12px); box-shadow:var(--shadow-1); }
.tcs-search i{ color:var(--muted,#64748b); }
.tcs-search input{ flex:1; height:46px; border:none; outline:none; background:transparent; font-size:16px; font-family:inherit; color:var(--text,#0f172a); }
.tcs-grid{ display:grid; gap:10px; grid-template-columns:1fr; }
@media (min-width:560px){ .tcs-grid{ grid-template-columns:repeat(2,1fr); } }
.tcs-student{
  display:grid; gap:8px; width:100%; padding:13px 15px; text-align:start; cursor:pointer;
  border:1px solid var(--border,#e2e8f0); border-radius:var(--radius-sm,12px); background:var(--card-bg,#fff); box-shadow:var(--shadow-1);
  font-family:inherit; color:var(--text,#0f172a); transition:transform .15s ease, box-shadow .15s ease;
}
.tcs-student:hover{ transform:translateY(-2px); box-shadow:var(--shadow-2); }
.tcs-student.is-special{ background:#fff8e1; border:2px solid #ffd54f; }
.tcs-student-top{ display:flex; align-items:center; gap:10px; }
.tcs-student-name{ flex:1; min-width:0; font-weight:900; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tcs-num{ flex-shrink:0; min-width:34px; padding:3px 10px; border-radius:12px; text-align:center; font-size:.8rem; font-weight:800; background:var(--primary-light,#eef3f6); color:var(--primary,#022b42); border:1px solid var(--border,#e2e8f0); }
.tcs-pills{ display:flex; flex-wrap:wrap; gap:6px; }
.tcs-pills:empty{ display:none; }
.tcs-pill{ display:inline-flex; align-items:center; gap:5px; padding:3px 10px; border-radius:999px; border:1px solid; font-size:.78rem; font-weight:800; }
.tcs-pill b{ font-weight:900; }
.tcs-positive{ color:#1e8e5a; background:#e4f5ec; border-color:rgba(30,142,90,.22); }
.tcs-negative{ color:#bf3a2a; background:#fbeae7; border-color:rgba(191,58,42,.22); }
.tcs-general{ color:#a06a12; background:#f7edd9; border-color:rgba(160,106,18,.24); }
.tcs-totals{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.tcs-total{ display:grid; justify-items:center; gap:2px; padding:12px 6px; border-radius:var(--radius-sm,12px); border:1px solid transparent; line-height:1.2; }
.tcs-total b{ font-size:1.5rem; font-weight:900; }
.tcs-total span{ font-size:.85rem; font-weight:800; }
.tcs-msg{ grid-column:1 / -1; text-align:center; padding:22px 14px; color:var(--muted,#64748b); font-weight:800; border:1px dashed var(--border,#e2e8f0); border-radius:var(--radius-sm,12px); background:var(--card-bg,#fff); }
.tcs-sheet .sheet-title{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
`;

const ar = (v) => String(v ?? "").replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const total = (c) => (c ? c.positive + c.negative + c.general : 0);

// Same display clean-up as the attendance/فصولي lists: presentation-form
// letters, zero-width marks and Farsi letter variants render broken in Tajawal.
function cleanName(name) {
  return String(name || "")
    .normalize("NFKC")
    .replace(/[​-‏﻿]/g, "")
    .replace(/ی/g, "ي")
    .replace(/ک/g, "ك");
}
function searchKey(text) {
  return String(text || "").normalize("NFD")
    .replace(/[ً-ٰٟ]/g, "").replace(/ـ/g, "")
    .replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي")
    .replace(/\s+/g, " ").trim().normalize("NFC");
}
function studentNumber(s) {
  for (const f of ["studentNumber", "number", "no", "roll", "idNumber", "studentNo"]) {
    const n = parseInt(s[f]);
    if (Number.isFinite(n)) return n;
  }
  return Infinity;
}

function injectStylesOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS_TEXT;
  document.head.appendChild(style);
}

function makeSheet(titleText) {
  const el = document.createElement("section");
  el.className = "sheet tcs-sheet";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <div class="sheet-header">
      <button class="back-btn" type="button" aria-label="رجوع"><i class="fas fa-arrow-right"></i><span>رجوع</span></button>
      <h3 class="sheet-title">${esc(titleText)}</h3>
    </div>
    <div class="sheet-body"></div>`;
  document.body.appendChild(el);
  return {
    el,
    title: el.querySelector(".sheet-title"),
    body: el.querySelector(".sheet-body"),
    back: el.querySelector(".back-btn"),
  };
}

export function mountTeacherClassSheet({ db, studentNotes }) {
  injectStylesOnce();

  const cls = makeSheet("الطلاب");
  cls.body.innerHTML = `
    <section class="tcs-hero">
      <span class="tcs-hero-icon"><i class="fas fa-users" aria-hidden="true"></i></span>
      <div class="tcs-hero-text">
        <h2 class="tcs-hero-class">—</h2>
        <span class="tcs-hero-sub">—</span>
      </div>
    </section>
    <button class="tcs-notes-card" type="button">
      <span class="tcs-notes-count">…</span>
      <span class="tcs-notes-text"><b>ملاحظات مسجّلة</b><small>جاري التحميل…</small></span>
      <i class="fas fa-chevron-left tcs-chev" aria-hidden="true"></i>
    </button>
    <label class="tcs-search">
      <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
      <input type="text" placeholder="ابحث بالاسم…" aria-label="ابحث بالاسم">
    </label>
    <div class="tcs-grid"></div>`;
  const heroClass = cls.body.querySelector(".tcs-hero-class");
  const heroSub = cls.body.querySelector(".tcs-hero-sub");
  const notesBtn = cls.body.querySelector(".tcs-notes-card");
  const notesCount = cls.body.querySelector(".tcs-notes-count");
  const notesSub = cls.body.querySelector(".tcs-notes-text small");
  const search = cls.body.querySelector(".tcs-search input");
  const grid = cls.body.querySelector(".tcs-grid");

  const notes = makeSheet("الملاحظات");
  notes.body.innerHTML = `<div class="tcs-totals"></div><div class="tcs-grid"></div>`;
  const totalsEl = notes.body.querySelector(".tcs-totals");
  const notesGrid = notes.body.querySelector(".tcs-grid");

  let current = null;        // { classKey, teacherUid, teacherName }
  let students = [];
  let counts = new Map();    // student uid -> { positive, negative, general }
  let state = "idle";        // 'loading' | 'ready' | 'error'
  let token = 0;

  function show(sheet) { sheet.el.classList.add("open"); sheet.el.setAttribute("aria-hidden", "false"); }
  function hide(sheet) { sheet.el.classList.remove("open"); sheet.el.setAttribute("aria-hidden", "true"); }
  function close() { token++; hide(notes); hide(cls); }
  cls.back.addEventListener("click", close);
  notes.back.addEventListener("click", () => hide(notes));

  async function queryStudents(classKey) {
    try {
      const snap = await getDocs(query(collection(db, "students"), where("class", "==", classKey)));
      if (!snap.empty) {
        return snap.docs.map((d) => {
          const s = d.data() || {};
          return { ...s, uid: d.id, name: cleanName(s.name || s.fullName || d.id) };
        });
      }
    } catch (e) {
      console.warn("[tcs] students query:", e?.message || e);
    }
    // Legacy layout: one students/uids doc holding every student.
    try {
      const m = await getDoc(doc(db, "students", "uids"));
      if (m.exists()) {
        return Object.values(m.data() || {})
          .filter((s) => s && (s.class || s.className) === classKey)
          .map((s) => ({ ...s, uid: s.uid || "", name: cleanName(s.name || s.fullName || "") }));
      }
    } catch (e) {
      console.warn("[tcs] students/uids:", e?.message || e);
    }
    return [];
  }

  async function countNotes(teacherUid, studentUid) {
    const snaps = await Promise.all(NOTE_TYPES.map((t) =>
      getDocs(collection(db, "students", studentUid, "notes_by_teacher", teacherUid, t.path))));
    const c = {};
    NOTE_TYPES.forEach((t, i) => { c[t.key] = snaps[i].size; });
    return c;
  }

  function pillsHtml(c) {
    if (!c) return "";
    return NOTE_TYPES.filter((t) => c[t.key] > 0)
      .map((t) => `<span class="tcs-pill tcs-${t.key}">${t.label} <b>${ar(c[t.key])}</b></span>`).join("");
  }

  function studentButton(s) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tcs-student" + (s.specialCase === true ? " is-special" : "");
    const n = studentNumber(s);
    btn.innerHTML = `
      <span class="tcs-student-top">
        <span class="tcs-student-name">${esc(s.name || "—")}</span>
        <span class="tcs-num">${n === Infinity ? "—" : ar(n)}</span>
      </span>
      <span class="tcs-pills">${pillsHtml(counts.get(s.uid))}</span>`;
    if (s.uid) {
      btn.addEventListener("click", () => studentNotes.open(s.uid, {
        name: s.name || "",
        className: ar(current?.classKey || ""),
        teacherUid: current?.teacherUid,
        teacherName: current?.teacherName,
      }));
    } else {
      btn.disabled = true;
    }
    return btn;
  }

  function renderGrid() {
    grid.innerHTML = "";
    if (state === "loading-students") {
      grid.innerHTML = `<div class="tcs-msg">جاري تحميل الطلاب…</div>`;
      return;
    }
    const q = searchKey(search.value);
    const list = q ? students.filter((s) => searchKey(s.name).includes(q)) : students;
    if (!list.length) {
      grid.innerHTML = `<div class="tcs-msg">${students.length ? "لا توجد نتائج." : "لا يوجد طلاب في هذا الفصل."}</div>`;
      return;
    }
    list.forEach((s) => grid.appendChild(studentButton(s)));
  }

  function renderNotesCard() {
    notesBtn.classList.remove("is-empty");
    if (state === "error") {
      notesCount.textContent = "!";
      notesSub.textContent = "تعذّر تحميل الملاحظات — اضغط للمحاولة مرة أخرى";
      notesBtn.disabled = false;
      return;
    }
    if (state !== "ready") {
      notesCount.textContent = "…";
      notesSub.textContent = "جاري التحميل…";
      notesBtn.disabled = true;
      return;
    }
    let sum = 0;
    counts.forEach((c) => { sum += total(c); });
    const withNotes = students.filter((s) => total(counts.get(s.uid)) > 0).length;
    notesCount.textContent = ar(sum);
    notesBtn.disabled = false;
    if (!sum) {
      notesBtn.classList.add("is-empty");
      notesSub.textContent = "لم يسجّل المعلّم أي ملاحظات لطلاب هذا الفصل";
    } else {
      notesSub.textContent = `لدى ${ar(withNotes)} ${withNotes === 1 ? "طالب" : "طلاب"} — اضغط لعرض الطلاب الذين لديهم ملاحظات`;
    }
  }

  function renderNotesSheet() {
    const list = students.filter((s) => total(counts.get(s.uid)) > 0);
    const sums = { positive: 0, negative: 0, general: 0 };
    list.forEach((s) => NOTE_TYPES.forEach((t) => { sums[t.key] += counts.get(s.uid)[t.key]; }));
    totalsEl.innerHTML = NOTE_TYPES.map((t) =>
      `<div class="tcs-total tcs-${t.key}"><b>${ar(sums[t.key])}</b><span>${t.label}</span></div>`).join("");
    notesGrid.innerHTML = "";
    if (!list.length) {
      notesGrid.innerHTML = `<div class="tcs-msg">لا يوجد طلاب لديهم ملاحظات في هذا الفصل.</div>`;
      return;
    }
    list.forEach((s) => notesGrid.appendChild(studentButton(s)));
  }

  async function loadCounts(myToken) {
    state = "loading";
    renderNotesCard();
    try {
      const withUid = students.filter((s) => s.uid);
      const results = await Promise.all(withUid.map((s) => countNotes(current.teacherUid, s.uid)));
      if (myToken !== token) return;
      counts = new Map(withUid.map((s, i) => [s.uid, results[i]]));
      state = "ready";
    } catch (e) {
      console.error("[tcs] note counts:", e);
      if (myToken !== token) return;
      state = "error";
    }
    renderNotesCard();
    renderGrid();
  }

  notesBtn.addEventListener("click", () => {
    if (state === "error") { loadCounts(token); return; }
    if (state !== "ready") return;
    notes.title.textContent = `ملاحظات ${ar(current.classKey)}`;
    renderNotesSheet();
    show(notes);
  });
  search.addEventListener("input", renderGrid);

  async function open(classKey, { teacherUid, teacherName = "" } = {}) {
    if (!classKey || !teacherUid) return;
    const myToken = ++token;
    current = { classKey, teacherUid, teacherName };
    students = [];
    counts = new Map();
    state = "loading-students";
    search.value = "";
    cls.title.textContent = `طلاب ${ar(classKey)}`;
    heroClass.textContent = ar(classKey);
    heroSub.textContent = teacherName ? `المعلّم: ${teacherName}` : "—";
    hide(notes);
    renderNotesCard();
    renderGrid();
    show(cls);

    const list = await queryStudents(classKey);
    if (myToken !== token) return;
    students = [...list].sort((a, b) => {
      const na = studentNumber(a), nb = studentNumber(b);
      if (na !== nb) return na === Infinity ? 1 : nb === Infinity ? -1 : na - nb;
      return (a.name || "").localeCompare(b.name || "", "ar");
    });
    heroSub.textContent = `${teacherName ? `المعلّم: ${teacherName} · ` : ""}${ar(students.length)} طالب`;
    state = "loading";
    renderGrid();
    loadCounts(myToken);
  }

  return { open, close };
}
