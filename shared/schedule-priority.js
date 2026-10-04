// A class with an enabled custom schedule (customDaySchedules, created via
// "+ إضافة جدول" in admins/adminschedule.html) for today's weekday does not
// run its main weekly schedule (schedules) that day at all — the custom
// schedule fully replaces it, lesson-for-lesson, using its own times.
// Callers fetch the day's custom-schedule docs themselves (each surface
// already caches/queries these its own way) and pass them in here.

// ---- Lesson names for a custom/extra-day schedule ----
//
// Each slot in a custom schedule's `times` array may carry its own `label`
// (set from the add-lesson popup in admins/adminschedule.html, e.g.
// "حصة مستقطعة"). A slot without one is a normal numbered lesson, and the
// numbering only counts those — so inserting a custom-named slot after the
// third lesson leaves the next one as الحصة الرابعة, not الخامسة.
//
// The position (index + 1) is still what lesson numbers mean everywhere
// else (attendance sessions, schedules, reminders); this is display only.
// Kept in this file (no imports) so it loads standalone in the tests.
// index.js (the Telegram bot, CommonJS) keeps its own copy of
// customLessonLabel — keep the two in sync.

export const LESSON_ORDINALS_AR = [
  "الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة",
  "السابعة", "الثامنة", "التاسعة", "العاشرة", "الحادية عشرة", "الثانية عشرة",
];

export const MAX_CUSTOM_LESSONS = 12;

export function ordinalLessonLabel(n) {
  const word = LESSON_ORDINALS_AR[n - 1];
  return word ? `الحصة ${word}` : `الحصة ${n}`;
}

export function customSlotName(slot) {
  return typeof slot?.label === "string" ? slot.label.trim() : "";
}

// Full name for slot `index` (0-based) of a custom schedule's times array.
export function customLessonLabel(times, index) {
  const own = customSlotName(times?.[index]);
  if (own) return own;
  let n = 0;
  for (let i = 0; i <= index; i++) {
    if (!customSlotName(times?.[i])) n++;
  }
  return ordinalLessonLabel(n);
}

// Short form for tight spots (grid headers, the live countdown):
// "الرابعة" for a numbered lesson, the custom name as-is otherwise.
export function customLessonShortLabel(times, index) {
  const own = customSlotName(times?.[index]);
  if (own) return own;
  return customLessonLabel(times, index).replace(/^الحصة\s+/, "");
}

export function classKeyFromRow(row) {
  const direct = (row?.classKey || "").toString().trim();
  if (direct) return direct;
  if (row?.grade && row?.section) {
    return `${row.grade} / ${row.section}${row.track ? ` ${row.track}` : ""}`.trim();
  }
  return "";
}

export function normalizeClassKey(s) {
  return String(s || "").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim().toLowerCase();
}

// customRowsForDay: customDaySchedules docs already filtered to a single
// weekday, enabled === true, and not deleted.
export function getOverriddenClassKeys(customRowsForDay) {
  const set = new Set();
  for (const row of customRowsForDay || []) {
    const ck = normalizeClassKey(classKeyFromRow(row));
    if (ck) set.add(ck);
  }
  return set;
}

export function isClassOverriddenToday(classKey, overriddenClassKeys) {
  return overriddenClassKeys.has(normalizeClassKey(classKey));
}

// Overwrites byLesson (keyed by lesson number as a string, e.g. "1".."7")
// with teacherUid's lessons from the day's enabled custom schedules —
// unconditionally, so custom always wins over whatever main-schedule/
// override entry was already in that slot. Each entry carries lessonLabel,
// the slot's own name (custom or renumbered — see lesson-labels.js).
// fixedLessonCount caps how many slots are read; pass a larger value to see
// a custom schedule's extra lessons past the normal day's count.
export function mergeCustomIntoLessonMap(byLesson, teacherUid, customRowsForDay, { fixedLessonCount = 7 } = {}) {
  for (const row of customRowsForDay || []) {
    const lessonsArr = Array.isArray(row.lessons) ? row.lessons : [];
    const timesArr = Array.isArray(row.times) ? row.times : [];
    const max = Math.min(fixedLessonCount, Number(row.lessonCount) || lessonsArr.length || fixedLessonCount);
    for (let i = 0; i < max; i++) {
      const lessonRow = lessonsArr[i] || {};
      if ((lessonRow.teacherUid || "").toString() !== teacherUid) continue;
      const classKey = classKeyFromRow(row) || classKeyFromRow(lessonRow);
      if (!classKey) continue;
      const t = timesArr[i] || {};
      byLesson.set(String(i + 1), {
        ...lessonRow,
        classKey,
        lesson: String(i + 1),
        _source: "custom",
        _coveredAway: false,
        activeStart: t.start || "",
        activeEnd: t.end || "",
        lessonLabel: customLessonLabel(timesArr, i),
      });
    }
  }
}
