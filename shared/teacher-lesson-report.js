import { teacherScheduleUids } from './schedule-teacher-identity.js';
import { classKeyFromRow, normalizeClassKey } from './schedule-priority.js';

export function normalizeTeacherSearch(value) {
  return String(value || '').normalize('NFKC').replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Resolve each class slot before filtering by teacher: a newer reassignment or
// cleared cell must not leave the former teacher with an extra lesson.
export function teacherLessonReport(uid, profiles, schedules) {
  const uids = new Set(teacherScheduleUids(uid, profiles));
  const slots = new Map();
  const millis = row => {
    const value = row.updatedAt || row.createdAt;
    return typeof value?.toMillis === 'function' ? value.toMillis() : 0;
  };
  for (const row of schedules) {
    const dayIndex = Number(row.dayIndex);
    const lesson = Number(row.lesson);
    const classKey = classKeyFromRow(row);
    if (row.dayIndex == null || row.dayIndex === '' || !Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 4
      || !Number.isInteger(lesson) || lesson < 1 || !classKey) continue;
    const key = `${normalizeClassKey(classKey)}|${dayIndex}|${lesson}`;
    const old = slots.get(key);
    if (!old || millis(row) >= millis(old)) slots.set(key, { ...row, dayIndex, lesson, classKey });
  }
  return [...slots.values()].filter(row => !row.deletedAt && uids.has(String(row.teacherUid || '').trim()))
    .sort((a, b) => a.dayIndex - b.dayIndex || a.lesson - b.lesson || a.classKey.localeCompare(b.classKey, 'ar'));
}
