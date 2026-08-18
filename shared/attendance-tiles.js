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

  const present = rows.filter((r) => r.status === "present").length;
  const late = rows.filter((r) => r.status === "late").length + morningLateRows.length;
  const allAbsences = rows.filter((r) => r.status === "absent");
  const absencesWithoutReason = rows.filter((r) => r.status === "absent" && r.hasReason !== true);
  const absent = absencesWithoutReason.length;

  const combinedLates = [
    ...rows.filter((r) => r.status === "late"),
    ...morningLateRows,
  ].sort((a, b) => {
    if (a.date === b.date) return (b.time || "").localeCompare(a.time || "");
    return a.date < b.date ? 1 : -1;
  });

  return { rows, morningLateRows, present, late, absent, allAbsences, combinedLates };
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
