import { collection, getDocs, query, where } from "/shared/firebase.js";

function toArabicDigits(value) {
  const ar = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩"];
  return String(value ?? "").replace(/\d/g, (d) => ar[parseInt(d, 10)]);
}

// Lesson-based attendance (students/{uid}/attendance) and morning-ceremony
// lateness (a separate, unrelated morningLates collection keyed by
// studentUid — see Teachers/morning.html) are independent queries. Kept as
// one shared function specifically so every page that shows a student's
// التأخيرات can't quietly drift out of sync on which sources feed it —
// that's exactly how supervisors/supervisorstudents.html ended up missing
// every morning-late record admins/students.html was already showing.
export async function fetchStudentAttendanceData(db, studentId) {
  const [subSnap, morningSnap] = await Promise.all([
    getDocs(collection(db, "students", studentId, "attendance")),
    getDocs(query(collection(db, "morningLates"), where("studentUid", "==", studentId))).catch((e) => {
      console.error("[attendance-tiles] morningLates:", e);
      return { forEach() {} };
    }),
  ]);

  const rows = [];
  subSnap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
  rows.sort((a, b) => {
    if (a.date === b.date) return (b.lessonIndex || 0) - (a.lessonIndex || 0);
    return a.date < b.date ? 1 : -1;
  });

  const morningLateRows = [];
  morningSnap.forEach((d) => morningLateRows.push({ id: d.id, source: "morningLate", ...d.data() }));
  morningLateRows.sort((a, b) => {
    if (a.date === b.date) return (b.time || "").localeCompare(a.time || "");
    return a.date < b.date ? 1 : -1;
  });

  // Lesson count — kept for callers that still show it that way.
  const present = rows.filter((r) => r.status === "present").length;
  const late = rows.filter((r) => r.status === "late").length + morningLateRows.length;
  const allAbsences = rows.filter((r) => r.status === "absent");
  const absenceDays = groupAbsencesByDay(allAbsences);
  // A day with any unexcused lesson is unexcused. One date can enter only
  // one warning ladder, even when its lessons have mixed excuse states.
  const absent = absenceDays.filter((day) => !day.excused).length;
  const excused = absenceDays.filter((day) => day.excused).length;
  const presentDays = countPresentDays(rows, absenceDays);

  const combinedLates = [
    ...rows.filter((r) => r.status === "late"),
    ...morningLateRows,
  ].sort((a, b) => {
    if (a.date === b.date) return (b.time || "").localeCompare(a.time || "");
    return a.date < b.date ? 1 : -1;
  });
  const lateAbsenceDays = groupLatesIntoAbsenceDays(combinedLates);

  return {
    rows, morningLateRows, present, presentDays, late, absent, excused,
    allAbsences, absenceDays, combinedLates, lateAbsenceDays,
  };
}

// Days the student attended: dates with at least one present or late lesson.
// A date that is already an absence day (any lesson absent) isn't counted
// here as well, so حضور and غياب never count the same day twice.
export function countPresentDays(rows, absenceDays = []) {
  const absenceDates = new Set(absenceDays.map((day) => day.date));
  const dates = new Set();
  for (const row of rows) {
    if (row.status !== "present" && row.status !== "late") continue;
    const date = String(row.date || "").slice(0, 10);
    if (date && !absenceDates.has(date)) dates.add(date);
  }
  return dates.size;
}

// School rule: every LATES_PER_ABSENCE_DAY lates (lesson lates and morning
// lates together) count as one unexcused absence day. Lates are used up
// oldest first, so each derived day can list exactly which lates made it.
export const LATES_PER_ABSENCE_DAY = 5;
export function groupLatesIntoAbsenceDays(lates) {
  const oldestFirst = [...lates].sort((a, b) => {
    if (a.date === b.date) return (a.time || "").localeCompare(b.time || "");
    return a.date < b.date ? -1 : 1;
  });
  const groups = [];
  for (let i = 0; i + LATES_PER_ABSENCE_DAY <= oldestFirst.length; i += LATES_PER_ABSENCE_DAY) {
    groups.push({ number: groups.length + 1, lates: oldestFirst.slice(i, i + LATES_PER_ABSENCE_DAY) });
  }
  // Newest first, like the other lists.
  return groups.reverse();
}

export function makeLateAbsenceTile(group) {
  const div = document.createElement("div");
  div.className = "att-tile will-change att-tile-from-lates";
  const left = document.createElement("div");
  left.className = "att-left";
  const title = document.createElement("div");
  title.className = "att-title";
  title.textContent = `غياب محتسب من التأخير (${toArabicDigits(group.number)})`;
  const sub = document.createElement("div");
  sub.className = "att-sub";
  sub.textContent = `نتيجة ${toArabicDigits(group.lates.length)} تأخيرات: ${group.lates.map((r) => toArabicDigits(r.date || "—")).join("، ")}`;
  const badge = document.createElement("span");
  badge.className = "badge b-late-absence";
  badge.textContent = "بسبب التأخير";
  left.append(title, sub);
  div.append(left, badge);
  return div;
}

export function groupAbsencesByDay(rows) {
  const days = new Map();
  for (const row of rows) {
    const date = String(row.date || "").slice(0, 10);
    if (!days.has(date)) days.set(date, { date, records: [], excused: false, reasonText: "" });
    days.get(date).records.push(row);
  }
  return [...days.values()].map((day) => {
    day.excused = day.records.every((row) => row.hasReason === true);
    day.reasonText = day.excused ? (day.records.find((row) => row.reasonText)?.reasonText || "") : "";
    return day;
  }).sort((a, b) => b.date.localeCompare(a.date));
}

export function makeAbsenceDayTile(day, onClick) {
  const div = document.createElement("div");
  div.className = "att-tile will-change";
  div.tabIndex = 0;
  div.setAttribute("role", "button");
  const left = document.createElement("div");
  left.className = "att-left";
  const title = document.createElement("div");
  title.className = "att-title";
  title.textContent = `غياب يوم ${toArabicDigits(day.date || "—")}`;
  const sub = document.createElement("div");
  sub.className = "att-sub";
  sub.textContent = `${toArabicDigits(day.records.length)} ${day.records.length === 1 ? "حصة غياب" : "حصص غياب"} • ${day.records.map((r) => r.lessonLabel || `حصة ${toArabicDigits(r.lessonIndex || "—")}`).join("، ")}`;
  const badge = document.createElement("span");
  badge.className = `badge ${day.excused ? "b-excused" : "b-absent"}`;
  badge.textContent = day.excused ? "غياب بعذر" : "غياب بدون عذر";
  left.append(title, sub);
  div.append(left, badge);
  if (typeof onClick === "function") {
    div.addEventListener("click", () => onClick(day));
    div.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(day); }
    });
  }
  return div;
}

export function makeAttTile(r, onClick) {
  const div = document.createElement("div");
  div.className = "att-tile will-change";

  let badgeClass = "b-absent";
  let badgeText = "غياب";
  if (r.hasReason === true) {
    badgeClass = "b-excused";
    badgeText = "غياب بعذر";
  } else if (r.status === "late") {
    badgeClass = "b-late";
    badgeText = "تأخير";
  }

  const title = badgeText + " — " + (r.lessonLabel || ("حصة " + (r.lessonIndex || "")));
  const sub = `${r.class || "—"} • ${toArabicDigits(r.date || "")}`;
  div.innerHTML = `
    <div class="att-left">
      <div class="att-title">${title}</div>
      <div class="att-sub">${sub}</div>
    </div>
    <span class="badge ${badgeClass}">${badgeText}</span>
  `;
  if (typeof onClick === "function") div.addEventListener("click", () => onClick(r));
  return div;
}

export function makeMorningLateTile(r, onClick) {
  const div = document.createElement("div");
  div.className = "att-tile will-change";
  const sub = `${r.classKey ? toArabicDigits(r.classKey) : "—"} • ${toArabicDigits(r.date || "")}${r.time ? " • " + toArabicDigits(r.time) : ""}`;
  div.innerHTML = `
    <div class="att-left">
      <div class="att-title">تأخير عن طابور الصباح</div>
      <div class="att-sub">${sub}</div>
    </div>
    <span class="badge b-late">تأخير صباح</span>
  `;
  if (typeof onClick === "function") div.addEventListener("click", () => onClick(r));
  return div;
}
