/* «تبديل حصة»: a teacher offers one of their lessons to a colleague in
   exchange for one of the colleague's, on specific dates.

   1. The teacher picks their own lesson (day + lesson, or straight from
      their week grid), then the colleague (department → teacher), then the
      colleague's lesson they'll take instead (day + lesson, or from the
      colleague's week grid). Only lessons in the next two school weeks that
      haven't started yet, and only slots where each of them is free to take
      the other's lesson, can be picked.
   2. «إرسال الطلب» confirms, then writes lessonSwaps/{id} (status pending).
   3. The colleague gets a popup (and the request in «الطلبات»). Accepting
      re-checks both timetables, then in one transaction marks the request
      accepted and writes two scheduleOverrides docs (lswap_{id}_1 / _2) —
      the same per-date override every schedule view, attendance and the
      bot already apply — so each teacher gets the other's lesson.
   4. Heads of both departments see accepted swaps in «إشعارات القسم»
      (lessonSwaps.departments, read by Teachers/user.html).

   lessonSwaps/{id}:
     { status: pending | accepted | declined | cancelled,
       fromUid, fromName, fromDepartment, toUid, toName, toDepartment,
       departments: [fromDepartment, toDepartment] (unique),
       fromDate, fromLesson, fromClassKey,   // the requester's lesson → to
       toDate, toLesson, toClassKey,         // the colleague's lesson → from
       createdAt, respondedAt }
   firestore.rules checks the shape, who may change the status, and that an
   accept writes exactly the two matching overrides.

   mountLessonSwap({ db, hooks }) → { start(me), stop(), open() }
   The host page passes its own schedule logic in `hooks` (see user.html). */
import {
  collection, doc, addDoc, updateDoc, onSnapshot, query, where,
  runTransaction, serverTimestamp,
} from "/shared/firebase.js";

const COLLECTION = "lessonSwaps";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const ar = (v) => String(v ?? "").replace(/\d/g, (d) => AR_DIGITS[d]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const ms = (t) => (t && typeof t.toMillis === "function") ? t.toMillis() : 0;
const norm = (ck) => String(ck || "").replace(/\s+/g, "");
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const HISTORY_DAYS = 30;

const fmtClass = (ck) => ar(String(ck || "—").replace(/\s*\/\s*/g, " / "));
const tileClass = (ck) => ar(String(ck || "").replace(/\s+/g, ""));
const isoDate = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const weekdayName = (iso) => new Intl.DateTimeFormat("ar-KW", { weekday: "long", timeZone: "UTC" }).format(isoDate(iso));
const dayMonth = (iso) => { const d = isoDate(iso); return ar(`${d.getUTCDate()}/${d.getUTCMonth() + 1}`); };
const dayLong = (iso) => new Intl.DateTimeFormat("ar-KW", { day: "numeric", month: "long", timeZone: "UTC" }).format(isoDate(iso));
const addDays = (iso, n) => { const d = isoDate(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const STATUS = {
  pending: { label: "بانتظار الموافقة", cls: "pending", icon: "fa-hourglass-half" },
  accepted: { label: "تم التبديل", cls: "accepted", icon: "fa-circle-check" },
  declined: { label: "مرفوض", cls: "declined", icon: "fa-circle-xmark" },
  cancelled: { label: "ملغى", cls: "cancelled", icon: "fa-ban" },
  expired: { label: "انتهت مدته", cls: "cancelled", icon: "fa-clock" },
};

export function mountLessonSwap({ db, hooks }) {
  const h = hooks;
  const st = {
    me: null,
    weeks: [], // [{ label, dates: [iso…] }]
    dates: [],
    mine: { lessons: null, date: "", lesson: 0 },
    other: { dept: "", uid: "", lessons: null, date: "", lesson: 0 },
    teachers: [],
    incoming: new Map(),
    outgoing: new Map(),
    unsubs: [],
    shownPopup: new Set(),
    lastStatus: new Map(),
    waitingId: "",
    tab: "new",
    sending: false,
    otherReq: 0,
  };

  /* ---------- DOM ---------- */
  const sheet = document.createElement("section");
  sheet.id = "lsSheet";
  sheet.className = "sheet ls-sheet";
  sheet.setAttribute("aria-hidden", "true");
  sheet.innerHTML = `
    <div class="sheet-header">
      <button id="lsClose" class="back-btn" type="button"><i class="fas fa-arrow-right"></i><span>رجوع</span></button>
      <h3 class="sheet-title">تبديل حصة</h3>
    </div>
    <div class="ls-tabs" role="tablist">
      <button class="ls-tab is-on" type="button" role="tab" data-tab="new" aria-selected="true"><i class="fas fa-plus" aria-hidden="true"></i><span>طلب جديد</span></button>
      <button class="ls-tab" type="button" role="tab" data-tab="list" aria-selected="false"><i class="fas fa-inbox" aria-hidden="true"></i><span>الطلبات</span><span class="ls-tab-count" id="lsTabCount" hidden></span></button>
    </div>
    <div class="sheet-body ls-body">
      <div class="ls-pane" data-pane="new">
        <section class="ls-step" id="lsStepMine">
          <div class="ls-step-head">
            <span class="ls-step-num">١</span>
            <div class="ls-step-titles"><b>حصتك</b><small>الحصة التي ستعطيها للمعلم الآخر</small></div>
          </div>
          <button class="ls-week-btn" id="lsMineWeekBtn" type="button">
            <i class="fas fa-calendar-week" aria-hidden="true"></i><span>اختر من جدولك الأسبوعي</span><i class="fas fa-chevron-left ls-week-btn-go" aria-hidden="true"></i>
          </button>
          <div class="ls-or"><span>أو اختر يدوياً</span></div>
          <div class="ls-fields">
            <label class="ls-field"><span class="ls-label">اليوم</span><span class="ls-select-wrap"><select id="lsMineDay" class="ls-select"><option value="">جاري التحميل…</option></select></span></label>
            <label class="ls-field"><span class="ls-label">الحصة</span><span class="ls-select-wrap"><select id="lsMineLesson" class="ls-select" disabled><option value="">اختر اليوم أولاً</option></select></span></label>
          </div>
          <div class="ls-picked" id="lsMinePicked" hidden></div>
        </section>

        <section class="ls-step is-locked" id="lsStepTeacher">
          <div class="ls-step-head">
            <span class="ls-step-num">٢</span>
            <div class="ls-step-titles"><b>المعلم الآخر</b><small>من ستبدّل معه</small></div>
          </div>
          <div class="ls-fields">
            <label class="ls-field"><span class="ls-label">القسم</span><span class="ls-select-wrap"><select id="lsDept" class="ls-select"><option value="">اختر القسم…</option></select></span></label>
            <label class="ls-field"><span class="ls-label">المعلم</span><span class="ls-select-wrap"><select id="lsTeacher" class="ls-select" disabled><option value="">اختر القسم أولاً</option></select></span></label>
          </div>
          <p class="ls-lock-hint">اختر حصتك أولاً</p>
        </section>

        <section class="ls-step is-locked" id="lsStepOther">
          <div class="ls-step-head">
            <span class="ls-step-num">٣</span>
            <div class="ls-step-titles"><b>حصته التي ستأخذها</b><small id="lsOtherSub">الحصة التي سيعطيك إياها</small></div>
          </div>
          <button class="ls-week-btn" id="lsOtherWeekBtn" type="button">
            <i class="fas fa-calendar-week" aria-hidden="true"></i><span id="lsOtherWeekLabel">اختر من جدوله الأسبوعي</span><i class="fas fa-chevron-left ls-week-btn-go" aria-hidden="true"></i>
          </button>
          <div class="ls-or"><span>أو اختر يدوياً</span></div>
          <div class="ls-fields">
            <label class="ls-field"><span class="ls-label">اليوم</span><span class="ls-select-wrap"><select id="lsOtherDay" class="ls-select" disabled><option value="">اختر المعلم أولاً</option></select></span></label>
            <label class="ls-field"><span class="ls-label">الحصة</span><span class="ls-select-wrap"><select id="lsOtherLesson" class="ls-select" disabled><option value="">اختر اليوم أولاً</option></select></span></label>
          </div>
          <div class="ls-picked" id="lsOtherPicked" hidden></div>
          <div class="ls-alert" id="lsOtherAlert" hidden></div>
          <p class="ls-lock-hint">اختر المعلم أولاً</p>
        </section>
        <div class="ls-footer-spacer"></div>
      </div>

      <div class="ls-pane" data-pane="list" hidden>
        <div id="lsList" class="ls-list"></div>
      </div>
    </div>
    <div class="ls-footer" id="lsFooter">
      <button class="ls-send" id="lsSend" type="button"><i class="fas fa-paper-plane" aria-hidden="true"></i><span>إرسال الطلب</span></button>
    </div>`;
  document.body.append(sheet);

  const modal = document.createElement("div");
  modal.className = "ls-modal";
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML = `<div class="ls-modal-backdrop"></div><div class="ls-modal-card" role="dialog" aria-modal="true"></div>`;
  document.body.append(modal);
  const modalCard = modal.querySelector(".ls-modal-card");

  const $ = (id) => sheet.querySelector("#" + id);
  const el = {
    close: $("lsClose"), tabCount: $("lsTabCount"), list: $("lsList"),
    mineWeek: $("lsMineWeekBtn"), mineDay: $("lsMineDay"), mineLesson: $("lsMineLesson"), minePicked: $("lsMinePicked"),
    stepTeacher: $("lsStepTeacher"), dept: $("lsDept"), teacher: $("lsTeacher"),
    stepOther: $("lsStepOther"), otherSub: $("lsOtherSub"), otherWeek: $("lsOtherWeekBtn"), otherWeekLabel: $("lsOtherWeekLabel"),
    otherDay: $("lsOtherDay"), otherLesson: $("lsOtherLesson"), otherPicked: $("lsOtherPicked"), otherAlert: $("lsOtherAlert"),
    footer: $("lsFooter"), send: $("lsSend"),
  };

  /* ---------- dates & slots ---------- */
  // The current school week (Sun–Thu; on Fri/Sat the coming one) and the
  // week after it, without the days that are already over.
  function buildDates() {
    const today = h.todayISO();
    const dow = isoDate(today).getUTCDay();
    const sunday = addDays(today, dow >= 5 ? 7 - dow : -dow);
    st.weeks = [0, 1].map((w) => ({
      label: w === 0 ? (dow >= 5 ? "الأسبوع القادم" : "هذا الأسبوع") : (dow >= 5 ? "الأسبوع الذي يليه" : "الأسبوع القادم"),
      dates: [0, 1, 2, 3, 4].map((d) => addDays(sunday, w * 7 + d)),
    }));
    st.dates = st.weeks.flatMap((w) => w.dates).filter((iso) => iso >= today);
  }

  function lessonStarted(iso, lesson) {
    const today = h.todayISO();
    if (iso < today) return true;
    if (iso > today) return false;
    const start = h.lessonTimes()[lesson - 1]?.start;
    const m = /^(\d{1,2}):(\d{2})$/.exec(start || "");
    return m ? Number(m[1]) * 60 + Number(m[2]) <= h.nowMinutes() : false;
  }

  const lessonName = (i) => h.lessonName(i) || `الحصة ${ar(i)}`;
  const shortLesson = (i) => lessonName(i).replace(/^الحصة\s*/, "");
  const entryAt = (lessons, iso, i) => lessons?.get(iso)?.get(i) || null;

  // Why a lesson can't be picked, or "" when it can.
  function mineBlock(iso, i) {
    const e = entryAt(st.mine.lessons, iso, i);
    if (!e) return "none";
    if (lessonStarted(iso, i)) return "past";
    if (!e.swappable) return "special";
    if (pendingFor(iso, i)) return "pending";
    if (st.other.lessons && entryAt(st.other.lessons, iso, i)) return "theyBusy";
    return "";
  }
  function otherBlock(iso, i) {
    const e = entryAt(st.other.lessons, iso, i);
    if (!e) return "none";
    if (lessonStarted(iso, i)) return "past";
    if (!e.swappable) return "special";
    if (entryAt(st.mine.lessons, iso, i)) return "meBusy";
    return "";
  }
  const BLOCK_TEXT = {
    past: "بدأت أو انتهت",
    special: "حصة احتياط أو جدول خاص",
    pending: "عليها طلب معلّق",
    theyBusy: "المعلم لديه حصة في هذا الوقت",
    meBusy: "لديك حصة في هذا الوقت",
  };
  function pendingFor(iso, i) {
    for (const s of st.outgoing.values()) {
      if (s.status === "pending" && !isExpired(s) && s.fromDate === iso && s.fromLesson === i) return s;
    }
    return null;
  }

  function slotLine(iso, i, ck) {
    return `${esc(weekdayName(iso))} ${esc(dayLong(iso))} · ${esc(lessonName(i))} · <bdi>${esc(fmtClass(ck))}</bdi>`;
  }

  /* ---------- selects ---------- */
  function fillDaySelect(select, lessons, blockFn, current) {
    select.innerHTML = "";
    select.append(new Option("اختر اليوم…", ""));
    for (const w of st.weeks) {
      const dates = w.dates.filter((iso) => st.dates.includes(iso));
      if (!dates.length) continue;
      const group = document.createElement("optgroup");
      group.label = w.label;
      for (const iso of dates) {
        let n = 0;
        for (let i = 1; i <= h.lessonCount(); i++) if (!blockFn(iso, i)) n++;
        const opt = new Option(`${weekdayName(iso)} ${dayMonth(iso)} — ${n ? `${ar(n)} ${n === 1 ? "حصة متاحة" : n === 2 ? "حصتان متاحتان" : "حصص متاحة"}` : "لا حصص متاحة"}`, iso);
        opt.disabled = !n;
        group.append(opt);
      }
      select.append(group);
    }
    select.disabled = !lessons;
    select.value = current || "";
  }

  function fillLessonSelect(select, lessons, iso, blockFn, current) {
    select.innerHTML = "";
    if (!iso) {
      select.append(new Option("اختر اليوم أولاً", ""));
      select.disabled = true;
      return;
    }
    select.append(new Option("اختر الحصة…", ""));
    for (let i = 1; i <= h.lessonCount(); i++) {
      const e = entryAt(lessons, iso, i);
      if (!e) continue;
      const why = blockFn(iso, i);
      const opt = new Option(`${lessonName(i)} — ${fmtClass(e.classKey)}${why ? ` (${BLOCK_TEXT[why]})` : ""}`, String(i));
      opt.disabled = !!why;
      select.append(opt);
    }
    select.disabled = false;
    select.value = current ? String(current) : "";
  }

  function render() {
    const mineReady = !!st.mine.lessons;
    if (mineReady) {
      fillDaySelect(el.mineDay, st.mine.lessons, mineBlock, st.mine.date);
      fillLessonSelect(el.mineLesson, st.mine.lessons, st.mine.date, mineBlock, st.mine.lesson);
    }
    const mineDone = !!(st.mine.date && st.mine.lesson);
    const mineEntry = mineDone ? entryAt(st.mine.lessons, st.mine.date, st.mine.lesson) : null;
    el.minePicked.hidden = !mineEntry;
    if (mineEntry) el.minePicked.innerHTML = `<i class="fas fa-circle-check" aria-hidden="true"></i><span>${slotLine(st.mine.date, st.mine.lesson, mineEntry.classKey)}</span>`;

    el.stepTeacher.classList.toggle("is-locked", !mineDone);
    const teacher = st.teachers.find((t) => t.uid === st.other.uid);
    const teacherDone = mineDone && !!teacher;
    el.stepOther.classList.toggle("is-locked", !teacherDone);
    el.otherSub.textContent = teacher ? `الحصة التي سيعطيك إياها ${teacher.name}` : "الحصة التي سيعطيك إياها";
    el.otherWeekLabel.textContent = teacher ? `اختر من جدول ${firstName(teacher.name)}` : "اختر من جدوله الأسبوعي";
    el.otherWeek.disabled = !(teacherDone && st.other.lessons);

    if (teacherDone && st.other.lessons) {
      fillDaySelect(el.otherDay, st.other.lessons, otherBlock, st.other.date);
      fillLessonSelect(el.otherLesson, st.other.lessons, st.other.date, otherBlock, st.other.lesson);
    } else {
      el.otherDay.innerHTML = `<option value="">${teacher ? "جاري تحميل جدوله…" : "اختر المعلم أولاً"}</option>`;
      el.otherDay.disabled = true;
      el.otherLesson.innerHTML = `<option value="">اختر اليوم أولاً</option>`;
      el.otherLesson.disabled = true;
    }
    const otherEntry = (st.other.lessons && st.other.date && st.other.lesson) ? entryAt(st.other.lessons, st.other.date, st.other.lesson) : null;
    el.otherPicked.hidden = !otherEntry;
    if (otherEntry) el.otherPicked.innerHTML = `<i class="fas fa-circle-check" aria-hidden="true"></i><span>${slotLine(st.other.date, st.other.lesson, otherEntry.classKey)}</span>`;

    // The colleague teaches when the requester's lesson is — they can't take it.
    let alert = "";
    if (teacherDone && st.other.lessons && mineEntry && entryAt(st.other.lessons, st.mine.date, st.mine.lesson)) {
      alert = `لدى ${esc(teacher.name)} حصة وقت حصتك (${esc(weekdayName(st.mine.date))} · ${esc(lessonName(st.mine.lesson))})، فلا يمكنه أخذها. اختر حصة أخرى أو معلماً آخر.`;
    } else if (teacherDone && st.other.lessons && st.other.lessons.size && !st.dates.some((iso) => { for (let i = 1; i <= h.lessonCount(); i++) if (!otherBlock(iso, i)) return true; return false; })) {
      alert = `لا توجد حصة لـ${esc(teacher.name)} في وقت تكون فيه متفرغاً خلال الأسبوعين.`;
    }
    el.otherAlert.hidden = !alert;
    el.otherAlert.innerHTML = alert ? `<i class="fas fa-triangle-exclamation" aria-hidden="true"></i><span>${alert}</span>` : "";

    const ready = !!(mineEntry && otherEntry && !alert && !mineBlock(st.mine.date, st.mine.lesson) && !otherBlock(st.other.date, st.other.lesson));
    el.footer.classList.toggle("is-ready", ready && st.tab === "new");
    sheet.classList.toggle("ls-has-footer", ready && st.tab === "new");
  }

  const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || name;

  /* ---------- loading ---------- */
  async function loadMine() {
    st.mine.lessons = null;
    render();
    el.mineDay.innerHTML = `<option value="">جاري تحميل جدولك…</option>`;
    el.mineDay.disabled = true;
    el.mineWeek.disabled = true;
    try {
      st.mine.lessons = await h.lessonsForDates(st.me.uid, st.dates);
    } catch (e) {
      console.error("[lessonSwap] my schedule:", e);
      el.mineDay.innerHTML = `<option value="">تعذّر تحميل جدولك</option>`;
      return;
    }
    el.mineWeek.disabled = false;
    if (st.mine.date && mineBlock(st.mine.date, st.mine.lesson)) st.mine.lesson = 0;
    render();
  }

  async function loadOther() {
    const uid = st.other.uid;
    const req = ++st.otherReq;
    st.other.lessons = null;
    st.other.date = "";
    st.other.lesson = 0;
    render();
    if (!uid) return;
    try {
      const lessons = await h.lessonsForDates(uid, st.dates);
      if (req !== st.otherReq) return;
      st.other.lessons = lessons;
    } catch (e) {
      if (req !== st.otherReq) return;
      console.error("[lessonSwap] colleague schedule:", e);
      el.otherDay.innerHTML = `<option value="">تعذّر تحميل جدوله</option>`;
      return;
    }
    render();
  }

  async function loadTeachers() {
    const all = await h.loadTeachers();
    st.teachers = all.filter((t) => t.uid !== st.me.uid && (t.role || "").toLowerCase() !== "admin" && t.normalizedDepartment);
    const counts = new Map();
    st.teachers.forEach((t) => counts.set(t.normalizedDepartment, (counts.get(t.normalizedDepartment) || 0) + 1));
    const depts = [...h.departmentList.filter((d) => counts.has(d)), ...[...counts.keys()].filter((d) => !h.departmentList.includes(d))];
    el.dept.innerHTML = "";
    el.dept.append(new Option("اختر القسم…", ""));
    depts.forEach((d) => el.dept.append(new Option(`${d}${d === st.me.department ? " (قسمك)" : ""}`, d)));
    el.dept.value = st.other.dept;
  }

  function fillTeachers() {
    const list = st.teachers.filter((t) => t.normalizedDepartment === st.other.dept);
    el.teacher.innerHTML = "";
    el.teacher.append(new Option(st.other.dept ? (list.length ? "اختر المعلم…" : "لا يوجد معلمون") : "اختر القسم أولاً", ""));
    list.forEach((t) => el.teacher.append(new Option(t.role === "head" ? `${t.name} — رئيس القسم` : t.name, t.uid)));
    el.teacher.disabled = !list.length;
    el.teacher.value = st.other.uid;
  }

  /* ---------- events: form ---------- */
  el.mineDay.addEventListener("change", () => { st.mine.date = el.mineDay.value; st.mine.lesson = 0; render(); });
  el.mineLesson.addEventListener("change", () => { st.mine.lesson = Number(el.mineLesson.value) || 0; render(); });
  el.dept.addEventListener("change", () => { st.other.dept = el.dept.value; st.other.uid = ""; fillTeachers(); loadOther(); });
  el.teacher.addEventListener("change", () => { st.other.uid = el.teacher.value; loadOther(); });
  el.otherDay.addEventListener("change", () => { st.other.date = el.otherDay.value; st.other.lesson = 0; render(); });
  el.otherLesson.addEventListener("change", () => { st.other.lesson = Number(el.otherLesson.value) || 0; render(); });
  el.mineWeek.addEventListener("click", () => openWeekPicker("mine"));
  el.otherWeek.addEventListener("click", () => openWeekPicker("other"));
  el.send.addEventListener("click", openConfirm);

  sheet.querySelectorAll(".ls-tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  function setTab(tab) {
    st.tab = tab;
    sheet.querySelectorAll(".ls-tab").forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    sheet.querySelectorAll(".ls-pane").forEach((p) => { p.hidden = p.dataset.pane !== tab; });
    sheet.querySelector(".ls-body").scrollTop = 0;
    if (tab === "list") renderList();
    render();
  }

  /* ---------- modal ---------- */
  let modalOnClose = null;
  function openModal(html, { cls = "", onClose = null, dismissable = true } = {}) {
    modalCard.className = `ls-modal-card ${cls}`.trim();
    modalCard.innerHTML = (dismissable ? `<span class="ls-grab" aria-hidden="true"></span>` : "") + html;
    modal.dataset.dismissable = dismissable ? "1" : "";
    modalOnClose = onClose;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    modalCard.scrollTop = 0;
    setTimeout(() => modalCard.querySelector("[data-autofocus]")?.focus({ preventScroll: true }), 50);
  }
  function closeModal() {
    if (!modal.classList.contains("open")) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    const fn = modalOnClose;
    modalOnClose = null;
    st.waitingId = "";
    fn?.();
    setTimeout(maybeShowIncoming, 400);
  }
  modal.querySelector(".ls-modal-backdrop").addEventListener("click", () => { if (modal.dataset.dismissable) closeModal(); });
  modalCard.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (modal.classList.contains("open")) { if (modal.dataset.dismissable) closeModal(); }
    else if (sheet.classList.contains("open")) close();
  });

  /* ---------- week picker ---------- */
  function openWeekPicker(who) {
    const lessons = who === "mine" ? st.mine.lessons : st.other.lessons;
    if (!lessons) return;
    const blockFn = who === "mine" ? mineBlock : otherBlock;
    const sel = who === "mine" ? st.mine : st.other;
    const teacher = st.teachers.find((t) => t.uid === st.other.uid);
    const title = who === "mine" ? "جدولك الأسبوعي" : `جدول ${teacher?.name || ""}`;
    const today = h.todayISO();
    // Start on the week of the current pick, else the first with a free lesson.
    let week = st.weeks.findIndex((w) => w.dates.includes(sel.date));
    if (week < 0) week = Math.max(0, st.weeks.findIndex((w) => w.dates.some((iso) => iso >= today && [...Array(h.lessonCount())].some((_, k) => !blockFn(iso, k + 1)))));

    const n = h.lessonCount();
    const weekHtml = (w) => st.weeks[w].dates.map((iso) => {
      const past = iso < today;
      let tiles = "";
      for (let i = 1; i <= n; i++) {
        const e = entryAt(lessons, iso, i);
        const why = past ? "past" : blockFn(iso, i);
        const isSel = sel.date === iso && sel.lesson === i;
        if (!e || why === "none") { tiles += `<span class="ls-tile is-empty" aria-hidden="true"><small>${ar(i)}</small></span>`; continue; }
        const label = `${weekdayName(iso)} ${lessonName(i)} ${fmtClass(e.classKey)}${why ? ` — ${BLOCK_TEXT[why]}` : ""}`;
        tiles += `<button type="button" class="ls-tile${why ? ` is-off is-${why}` : " is-ok"}${isSel ? " is-sel" : ""}" data-iso="${iso}" data-lesson="${i}" ${why ? "disabled" : ""} aria-label="${esc(label)}">
          <small>${ar(i)}</small><b>${esc(tileClass(e.classKey))}</b>${why === "meBusy" || why === "theyBusy" ? '<i class="fas fa-lock" aria-hidden="true"></i>' : ""}</button>`;
      }
      return `<div class="ls-day${past ? " is-past" : ""}${iso === today ? " is-today" : ""}">
        <div class="ls-day-name"><b>${esc(weekdayName(iso))}</b><small>${iso === today ? "اليوم" : dayMonth(iso)}</small></div>
        <div class="ls-tiles" style="--n:${n}">${tiles}</div></div>`;
    }).join("");

    const legend = who === "mine"
      ? `<span><i class="ls-dot ok"></i>متاحة</span><span><i class="ls-dot off"></i>غير متاحة</span>${st.other.lessons ? '<span><i class="fas fa-lock"></i>المعلم مشغول</span>' : ""}`
      : `<span><i class="ls-dot ok"></i>متاحة لك</span><span><i class="fas fa-lock"></i>لديك حصة وقتها</span><span><i class="ls-dot off"></i>غير متاحة</span>`;

    openModal(`
      <div class="ls-m-head">
        <div class="ls-m-titles"><b>${esc(title)}</b><small>اضغط على الحصة لاختيارها</small></div>
        <button class="ls-x" type="button" data-close aria-label="إغلاق"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="ls-seg" role="tablist">${st.weeks.map((w, k) => `<button type="button" class="ls-seg-btn${k === week ? " is-on" : ""}" data-week="${k}">${esc(w.label)}</button>`).join("")}</div>
      <div class="ls-week-range" id="lsWeekRange"></div>
      <div class="ls-week" id="lsWeekGrid"></div>
      <div class="ls-legend">${legend}</div>`, { cls: "is-week" });

    const grid = modalCard.querySelector("#lsWeekGrid");
    const range = modalCard.querySelector("#lsWeekRange");
    const show = (w) => {
      week = w;
      modalCard.querySelectorAll(".ls-seg-btn").forEach((b) => b.classList.toggle("is-on", Number(b.dataset.week) === w));
      const ds = st.weeks[w].dates;
      range.textContent = `${dayLong(ds[0])} – ${dayLong(ds[4])}`;
      grid.innerHTML = weekHtml(w);
    };
    show(week);
    modalCard.querySelectorAll(".ls-seg-btn").forEach((b) => b.addEventListener("click", () => show(Number(b.dataset.week))));
    grid.addEventListener("click", (e) => {
      const t = e.target.closest(".ls-tile.is-ok");
      if (!t) return;
      sel.date = t.dataset.iso;
      sel.lesson = Number(t.dataset.lesson);
      t.classList.add("is-sel");
      setTimeout(() => {
        closeModal();
        render();
        const next = who === "mine" ? (st.other.uid ? el.stepOther : el.stepTeacher) : el.footer;
        if (next !== el.footer) next.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
      }, reduceMotion() ? 0 : 160);
    });
  }

  /* ---------- validation ---------- */
  // Re-reads both timetables for both dates: the requester still has their
  // lesson and the colleague theirs, and each is free when the other's is.
  async function validate(s) {
    const dates = [...new Set([s.fromDate, s.toDate])];
    const [a, b] = await Promise.all([h.lessonsForDates(s.fromUid, dates), h.lessonsForDates(s.toUid, dates)]);
    const aHas = entryAt(a, s.fromDate, s.fromLesson);
    const bHas = entryAt(b, s.toDate, s.toLesson);
    if (lessonStarted(s.fromDate, s.fromLesson) || lessonStarted(s.toDate, s.toLesson)) return "إحدى الحصتين بدأت أو انتهت بالفعل.";
    if (!aHas || norm(aHas.classKey) !== norm(s.fromClassKey) || !aHas.swappable) return `لم تعد حصة ${s.fromName} (${lessonName(s.fromLesson)}، ${weekdayName(s.fromDate)}) في جدوله.`;
    if (!bHas || norm(bHas.classKey) !== norm(s.toClassKey) || !bHas.swappable) return `لم تعد حصة ${s.toName} (${lessonName(s.toLesson)}، ${weekdayName(s.toDate)}) في جدوله.`;
    if (entryAt(a, s.toDate, s.toLesson)) return `لدى ${s.fromName} حصة في ${weekdayName(s.toDate)} ${lessonName(s.toLesson)}.`;
    if (entryAt(b, s.fromDate, s.fromLesson)) return `لدى ${s.toName} حصة في ${weekdayName(s.fromDate)} ${lessonName(s.fromLesson)}.`;
    return "";
  }

  /* ---------- swap visual ---------- */
  function ticket(kind, who, iso, lesson, classKey) {
    return `<div class="ls-ticket is-${kind}">
      <div class="ls-ticket-tag"><i class="fas ${kind === "give" ? "fa-arrow-up" : "fa-arrow-down"}" aria-hidden="true"></i>${kind === "give" ? "تعطي" : "تأخذ"}</div>
      <div class="ls-ticket-main">
        <b class="ls-ticket-class"><bdi>${esc(fmtClass(classKey))}</bdi></b>
        <span class="ls-ticket-lesson">${esc(lessonName(lesson))}</span>
        <span class="ls-ticket-date">${esc(weekdayName(iso))} · ${esc(dayLong(iso))}</span>
      </div>
      <div class="ls-ticket-who">${esc(who)}</div>
    </div>`;
  }
  // From the viewer's side: what they give and what they take.
  function swapVisual(s, viewerUid) {
    const iAmFrom = viewerUid === s.fromUid;
    const give = iAmFrom ? [s.fromDate, s.fromLesson, s.fromClassKey, `حصتك ← إلى ${s.toName}`] : [s.toDate, s.toLesson, s.toClassKey, `حصتك ← إلى ${s.fromName}`];
    const take = iAmFrom ? [s.toDate, s.toLesson, s.toClassKey, `من ${s.toName}`] : [s.fromDate, s.fromLesson, s.fromClassKey, `من ${s.fromName}`];
    return `<div class="ls-swap">
      ${ticket("give", give[3], give[0], give[1], give[2])}
      <span class="ls-swap-icon" aria-hidden="true"><i class="fas fa-right-left"></i></span>
      ${ticket("take", take[3], take[0], take[1], take[2])}
    </div>`;
  }

  /* ---------- send ---------- */
  function draft() {
    const teacher = st.teachers.find((t) => t.uid === st.other.uid);
    const mine = entryAt(st.mine.lessons, st.mine.date, st.mine.lesson);
    const theirs = entryAt(st.other.lessons, st.other.date, st.other.lesson);
    if (!teacher || !mine || !theirs) return null;
    const fromDepartment = st.me.department || "";
    const toDepartment = teacher.normalizedDepartment || "";
    return {
      status: "pending",
      fromUid: st.me.uid, fromName: st.me.name || "", fromDepartment,
      toUid: teacher.uid, toName: teacher.name || "", toDepartment,
      departments: [...new Set([fromDepartment, toDepartment].filter(Boolean))],
      fromDate: st.mine.date, fromLesson: st.mine.lesson, fromClassKey: mine.classKey,
      toDate: st.other.date, toLesson: st.other.lesson, toClassKey: theirs.classKey,
    };
  }

  function openConfirm() {
    const d = draft();
    if (!d) return;
    openModal(`
      <div class="ls-m-head">
        <div class="ls-m-titles"><b>تأكيد طلب التبديل</b><small>راجع التفاصيل قبل الإرسال</small></div>
        <button class="ls-x" type="button" data-close aria-label="إغلاق"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="ls-with">
        <span class="ls-avatar">${esc(d.toName.trim().charAt(0) || "؟")}</span>
        <div><small>التبديل مع</small><b>${esc(d.toName)}</b><span>${esc(d.toDepartment)}</span></div>
      </div>
      ${swapVisual(d, st.me.uid)}
      <p class="ls-note"><i class="fas fa-circle-info" aria-hidden="true"></i>لن يتغير الجدول إلا بعد موافقة ${esc(firstName(d.toName))}، وعندها يصل إشعار لرئيس القسم.</p>
      <div class="ls-error" id="lsConfirmErr" hidden></div>
      <div class="ls-actions">
        <button class="ls-btn primary" type="button" id="lsConfirmSend" data-autofocus><i class="fas fa-paper-plane" aria-hidden="true"></i><span>إرسال الطلب</span></button>
        <button class="ls-btn ghost" type="button" data-close>رجوع</button>
      </div>`);
    modalCard.querySelector("#lsConfirmSend").addEventListener("click", (e) => send(d, e.currentTarget));
  }

  async function send(d, btn) {
    if (st.sending) return;
    st.sending = true;
    const err = modalCard.querySelector("#lsConfirmErr");
    btn.classList.add("is-busy");
    btn.disabled = true;
    try {
      const problem = await validate(d);
      if (problem) throw Object.assign(new Error(problem), { userFacing: true });
      const ref = await addDoc(collection(db, COLLECTION), { ...d, createdAt: serverTimestamp() });
      showWaiting({ ...d, id: ref.id });
      resetForm();
    } catch (e) {
      console.error("[lessonSwap] send:", e);
      err.hidden = false;
      err.textContent = e.userFacing ? e.message : "تعذّر إرسال الطلب. تحقق من الاتصال وحاول مرة أخرى.";
      btn.classList.remove("is-busy");
      btn.disabled = false;
    } finally {
      st.sending = false;
    }
  }

  function resetForm() {
    st.mine.date = ""; st.mine.lesson = 0;
    st.other.date = ""; st.other.lesson = 0;
    render();
  }

  function showWaiting(s) {
    openModal(`
      <div class="ls-state">
        <div class="ls-wait" aria-hidden="true">
          <span class="ls-wait-ring"></span><span class="ls-wait-ring r2"></span><span class="ls-wait-ring r3"></span>
          <span class="ls-wait-core"><i class="fas fa-right-left"></i></span>
        </div>
        <b class="ls-state-title">تم إرسال الطلب</b>
        <p class="ls-state-text">بانتظار موافقة <b>${esc(s.toName)}</b><span class="ls-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></p>
        <p class="ls-state-sub">ستجد الطلب وحالته في «الطلبات»، وسيصلك إشعار هنا عند الرد.</p>
        <div class="ls-actions"><button class="ls-btn primary" type="button" data-close data-autofocus>حسناً</button></div>
      </div>`, { cls: "is-state" });
    st.waitingId = s.id;
  }

  function showResult(s, viewerUid) {
    const accepted = s.status === "accepted";
    const other = viewerUid === s.fromUid ? s.toName : s.fromName;
    openModal(`
      <div class="ls-state">
        <div class="ls-result ${accepted ? "ok" : "no"}" aria-hidden="true"><i class="fas ${accepted ? "fa-check" : "fa-xmark"}"></i></div>
        <b class="ls-state-title">${accepted ? "تم تبديل الحصتين" : "رُفض طلب التبديل"}</b>
        <p class="ls-state-text">${accepted ? `تم التبديل مع <b>${esc(other)}</b> وأُضيفت الحصة إلى جدولك.` : `رفض <b>${esc(other)}</b> طلب التبديل.`}</p>
        ${accepted ? swapVisual(s, viewerUid) : ""}
        <div class="ls-actions"><button class="ls-btn primary" type="button" data-close data-autofocus>حسناً</button></div>
      </div>`, { cls: "is-state" });
  }

  /* ---------- respond ---------- */
  function showIncoming(s) {
    st.shownPopup.add(s.id);
    openModal(`
      <div class="ls-m-head">
        <div class="ls-m-titles"><b>طلب تبديل حصة</b><small>${esc(timeAgo(s.createdAt))}</small></div>
        <button class="ls-x" type="button" data-close aria-label="إغلاق"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="ls-with">
        <span class="ls-avatar">${esc(String(s.fromName || "").trim().charAt(0) || "؟")}</span>
        <div><small>يطلب التبديل معك</small><b>${esc(s.fromName)}</b><span>${esc(s.fromDepartment || "")}</span></div>
      </div>
      ${swapVisual(s, st.me.uid)}
      <div class="ls-error" id="lsRespondErr" hidden></div>
      <div class="ls-actions">
        <button class="ls-btn success" type="button" id="lsAccept" data-autofocus><i class="fas fa-check" aria-hidden="true"></i><span>قبول التبديل</span></button>
        <button class="ls-btn danger-ghost" type="button" id="lsDecline">رفض</button>
      </div>`);
    modalCard.querySelector("#lsAccept").addEventListener("click", (e) => accept(s, e.currentTarget));
    modalCard.querySelector("#lsDecline").addEventListener("click", (e) => decline(s, e.currentTarget));
  }

  async function accept(s, btn) {
    const err = modalCard.querySelector("#lsRespondErr");
    btn.classList.add("is-busy");
    modalCard.querySelectorAll(".ls-actions .ls-btn").forEach((b) => { b.disabled = true; });
    try {
      const problem = await validate(s);
      if (problem) throw Object.assign(new Error(`${problem} لا يمكن إتمام التبديل — يمكنك رفض الطلب.`), { userFacing: true });
      const ref = doc(db, COLLECTION, s.id);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists() || snap.data().status !== "pending") throw Object.assign(new Error("لم يعد هذا الطلب معلّقاً."), { userFacing: true });
        const x = snap.data();
        const base = { active: true, type: "swap", lessonSwapId: s.id, createdAt: serverTimestamp() };
        tx.update(ref, { status: "accepted", respondedAt: serverTimestamp() });
        tx.set(doc(db, "scheduleOverrides", `lswap_${s.id}_1`), {
          ...base, date: x.fromDate, lesson: x.fromLesson, classKey: x.fromClassKey,
          originalTeacherUid: x.fromUid, originalTeacherName: x.fromName,
          newTeacherUid: x.toUid, newTeacherName: x.toName,
        });
        tx.set(doc(db, "scheduleOverrides", `lswap_${s.id}_2`), {
          ...base, date: x.toDate, lesson: x.toLesson, classKey: x.toClassKey,
          originalTeacherUid: x.toUid, originalTeacherName: x.toName,
          newTeacherUid: x.fromUid, newTeacherName: x.fromName,
        });
      });
      h.onSwapApplied([s.fromUid, s.toUid]);
      showResult({ ...s, status: "accepted" }, st.me.uid);
    } catch (e) {
      console.error("[lessonSwap] accept:", e);
      err.hidden = false;
      err.textContent = e.userFacing ? e.message : "تعذّر قبول الطلب. تحقق من الاتصال وحاول مرة أخرى.";
      btn.classList.remove("is-busy");
      modalCard.querySelectorAll(".ls-actions .ls-btn").forEach((b) => { b.disabled = false; });
    }
  }

  async function decline(s, btn) {
    btn.classList.add("is-busy");
    modalCard.querySelectorAll(".ls-actions .ls-btn").forEach((b) => { b.disabled = true; });
    try {
      await updateDoc(doc(db, COLLECTION, s.id), { status: "declined", respondedAt: serverTimestamp() });
      closeModal();
      h.toast({ title: "تم رفض الطلب", text: `أُبلغ ${s.fromName} بالرفض.`, icon: "fa-circle-xmark" });
    } catch (e) {
      console.error("[lessonSwap] decline:", e);
      const err = modalCard.querySelector("#lsRespondErr");
      err.hidden = false;
      err.textContent = "تعذّر رفض الطلب. حاول مرة أخرى.";
      btn.classList.remove("is-busy");
      modalCard.querySelectorAll(".ls-actions .ls-btn").forEach((b) => { b.disabled = false; });
    }
  }

  async function cancelRequest(s, btn) {
    btn.disabled = true;
    try {
      await updateDoc(doc(db, COLLECTION, s.id), { status: "cancelled", respondedAt: serverTimestamp() });
      h.toast({ title: "أُلغي الطلب", text: `أُلغي طلب التبديل مع ${s.toName}.`, icon: "fa-ban" });
    } catch (e) {
      console.error("[lessonSwap] cancel:", e);
      btn.disabled = false;
      h.toast({ title: "خطأ", text: "تعذّر إلغاء الطلب. حاول مرة أخرى.", icon: "fa-circle-exclamation" });
    }
  }

  /* ---------- requests list ---------- */
  function isExpired(s) {
    return s.status === "pending" && (lessonStarted(s.fromDate, s.fromLesson) || lessonStarted(s.toDate, s.toLesson));
  }
  const effStatus = (s) => (isExpired(s) ? "expired" : s.status);
  function timeAgo(t) {
    const m = ms(t);
    if (!m) return "الآن";
    return new Intl.DateTimeFormat("ar-KW", { weekday: "long", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuwait" }).format(new Date(m));
  }

  function allRequests() {
    const cutoff = Date.now() - HISTORY_DAYS * 86400000;
    return [...st.incoming.values(), ...st.outgoing.values()]
      .filter((s) => effStatus(s) === "pending" || (ms(s.respondedAt) || ms(s.createdAt) || Date.now()) >= cutoff)
      .sort((a, b) => {
        const pa = effStatus(a) === "pending" ? 1 : 0, pb = effStatus(b) === "pending" ? 1 : 0;
        if (pa !== pb) return pb - pa;
        return (ms(b.createdAt) || Date.now()) - (ms(a.createdAt) || Date.now());
      });
  }

  function renderList() {
    const items = allRequests();
    if (!items.length) {
      el.list.innerHTML = `<div class="ls-empty">
        <span class="ls-empty-icon"><i class="fas fa-right-left" aria-hidden="true"></i></span>
        <b>لا توجد طلبات</b><span>الطلبات التي ترسلها أو تصلك تظهر هنا.</span>
        <button class="ls-btn primary" type="button" data-go-new><i class="fas fa-plus" aria-hidden="true"></i><span>طلب جديد</span></button></div>`;
      el.list.querySelector("[data-go-new]").addEventListener("click", () => setTab("new"));
      return;
    }
    el.list.innerHTML = items.map((s) => {
      const incoming = s.toUid === st.me.uid;
      const status = effStatus(s);
      const meta = STATUS[status] || STATUS.pending;
      const other = incoming ? s.fromName : s.toName;
      let actions = "";
      if (status === "pending" && incoming) actions = `<button class="ls-btn success sm" data-act="review" data-id="${s.id}"><i class="fas fa-eye" aria-hidden="true"></i><span>عرض والرد</span></button>`;
      else if (status === "pending") actions = `<button class="ls-btn danger-ghost sm" data-act="cancel" data-id="${s.id}">إلغاء الطلب</button>`;
      return `<article class="ls-card${status === "pending" && incoming ? " is-action" : ""}">
        <div class="ls-card-top">
          <span class="ls-dir ${incoming ? "in" : "out"}"><i class="fas ${incoming ? "fa-arrow-down" : "fa-arrow-up"}" aria-hidden="true"></i>${incoming ? "وارد" : "مرسل"}</span>
          <b class="ls-card-name">${incoming ? "من" : "إلى"} ${esc(other)}</b>
          <span class="ls-pill ${meta.cls}"><i class="fas ${meta.icon}" aria-hidden="true"></i>${meta.label}</span>
        </div>
        ${swapVisual(s, st.me.uid)}
        ${actions ? `<div class="ls-card-actions">${actions}</div>` : ""}
      </article>`;
    }).join("");
  }
  el.list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const s = st.incoming.get(b.dataset.id) || st.outgoing.get(b.dataset.id);
    if (!s) return;
    if (b.dataset.act === "review") showIncoming(s);
    if (b.dataset.act === "cancel") cancelRequest(s, b);
  });

  function pendingIncoming() {
    return [...st.incoming.values()].filter((s) => effStatus(s) === "pending");
  }
  function updateCounts() {
    const n = pendingIncoming().length;
    el.tabCount.hidden = !n;
    el.tabCount.textContent = ar(n);
    h.onPendingCount(n);
    if (st.tab === "list" && sheet.classList.contains("open")) renderList();
    if (st.mine.lessons) render();
  }

  // Waits until no other popup (this page's or a one-time notice) is showing.
  function pageBusy() {
    return modal.classList.contains("open")
      || !!document.querySelector("#modal.open, #abr-notif-popup-host, .tg-prompt-overlay, .swt-overlay, .sidebar.open, .notice-overlay");
  }
  let incomingTimer = 0;
  function maybeShowIncoming() {
    clearTimeout(incomingTimer);
    const next = pendingIncoming().find((s) => !st.shownPopup.has(s.id));
    if (!next) return;
    if (pageBusy()) { incomingTimer = setTimeout(maybeShowIncoming, 1500); return; }
    showIncoming(next);
  }

  /* ---------- listeners ---------- */
  function listen(field, map, onChange) {
    return onSnapshot(
      query(collection(db, COLLECTION), where(field, "==", st.me.uid)),
      (snap) => {
        map.clear();
        snap.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
        onChange?.();
        updateCounts();
      },
      (e) => console.error(`[lessonSwap] ${field} listener:`, e),
    );
  }

  let firstOutgoing = true;
  function onOutgoing() {
    // A colleague answered one of this teacher's requests while the page is open.
    for (const s of st.outgoing.values()) {
      const before = st.lastStatus.get(s.id);
      st.lastStatus.set(s.id, s.status);
      if (firstOutgoing || before !== "pending" || s.status === "pending") continue;
      if (s.status === "accepted") h.onSwapApplied([s.fromUid, s.toUid]);
      if (s.status === "accepted" || s.status === "declined") {
        if (st.waitingId === s.id || !modal.classList.contains("open")) showResult(s, st.me.uid);
        else h.toast({ title: s.status === "accepted" ? "تم التبديل" : "رُفض الطلب", text: `${s.toName} ${s.status === "accepted" ? "وافق على" : "رفض"} طلب التبديل.`, icon: s.status === "accepted" ? "fa-circle-check" : "fa-circle-xmark" });
      }
    }
    firstOutgoing = false;
  }

  /* ---------- sheet ---------- */
  function onPop() {
    if (sheet.classList.contains("open") && !history.state?.lsSheetOpen) hide();
  }
  window.addEventListener("popstate", onPop);
  el.close.addEventListener("click", close);

  let teachersLoaded = false;
  async function open(tab) {
    if (!st.me) return;
    if (!sheet.classList.contains("open")) {
      sheet.classList.add("open");
      sheet.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      try { history.pushState({ lsSheetOpen: true }, "", "#lessonswap"); } catch {}
    }
    setTab(tab || (pendingIncoming().length ? "list" : "new"));
    buildDates();
    loadMine();
    if (st.other.uid) loadOther();
    if (!teachersLoaded) {
      try { await loadTeachers(); teachersLoaded = true; fillTeachers(); } catch (e) { console.error("[lessonSwap] teachers:", e); }
    }
  }
  function hide() {
    sheet.classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    sheet.classList.remove("ls-has-footer");
  }
  function close() {
    if (!sheet.classList.contains("open")) return;
    hide();
    if (history.state?.lsSheetOpen) { try { history.back(); } catch {} }
  }

  function start(me) {
    stop();
    st.me = me;
    firstOutgoing = true;
    buildDates();
    st.unsubs = [
      listen("toUid", st.incoming, () => setTimeout(maybeShowIncoming, 2500)),
      listen("fromUid", st.outgoing, onOutgoing),
    ];
  }
  function stop() {
    st.unsubs.forEach((fn) => fn());
    st.unsubs = [];
    st.incoming.clear();
    st.outgoing.clear();
    st.lastStatus.clear();
    st.mine = { lessons: null, date: "", lesson: 0 };
    st.other = { dept: "", uid: "", lessons: null, date: "", lesson: 0 };
    teachersLoaded = false;
    closeModal();
    hide();
    h.onPendingCount(0);
  }

  return { start, stop, open, close, sheet, isOpen: () => sheet.classList.contains("open") };
}
