function minutesOf(time) {
  if (!time || typeof time.start !== 'string' || typeof time.end !== 'string') return null;
  const parse = (value) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return hour < 24 && minute < 60 ? hour * 60 + minute : null;
  };
  const start = parse(time.start);
  const end = parse(time.end);
  return start !== null && end !== null && end > start ? { start, end } : null;
}

// One highlight for the day: a live lesson, an announced break, or the
// upcoming lesson during an ordinary gap between two bell times.
export function getDayScheduleHighlight(times, breaks, nowMinutes) {
  if (!Array.isArray(times) || !Number.isFinite(nowMinutes)) return null;
  const windows = times.map(minutesOf);
  for (let index = 0; index < windows.length; index++) {
    const current = windows[index];
    if (!current) continue;
    if (nowMinutes >= current.start && nowMinutes < current.end) {
      return { type: 'lesson', lessonIndex: index + 1 };
    }
    const next = windows[index + 1];
    if (next && nowMinutes >= current.end && nowMinutes < next.start) {
      const afterLesson = index + 1;
      if (breaks?.firstAfter === afterLesson || breaks?.secondAfter === afterLesson) {
        return { type: 'break', afterLesson };
      }
      return { type: 'lesson', lessonIndex: index + 2 };
    }
  }
  return null;
}
