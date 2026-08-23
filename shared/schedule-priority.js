// A class with an enabled custom schedule (customDaySchedules, created via
// "+ إضافة جدول" in admins/adminschedule.html) for today's weekday does not
// run its main weekly schedule (schedules) that day at all — the custom
// schedule fully replaces it, lesson-for-lesson, using its own times.
// Callers fetch the day's custom-schedule docs themselves (each surface
// already caches/queries these its own way) and pass them in here.

export function classKeyFromRow(row) {
  const direct = (row?.classKey || "").toString().trim();
  if (direct) return direct;
  if (row?.grade && row?.section) {
    return `${row.grade} / ${row.section}${row.track ? ` ${row.track}` : ""}`.trim();
  }
  return "";
}

export function normalizeClassKey(s) {
  return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
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
// override entry was already in that slot.
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
      });
    }
  }
}
