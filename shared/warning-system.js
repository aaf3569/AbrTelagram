function toArabicDigits(value) {
  const ar = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  return String(value ?? "").replace(/\d/g, (d) => ar[parseInt(d, 10)]);
}

// Two independent ladders: plain (unexcused) absences escalate faster
// since they're the more serious case, غياب بعذر (hasReason === true) gets
// its own more lenient ladder. Kept as plain arrays (rather than duplicating
// the whole compute function) so admins/students.html and
// supervisors/supervisorstudents.html can't drift apart on the thresholds
// the way their warning UIs had already started to before this file existed.
const NORMAL_THRESHOLDS = [5, 8, 11, 15];
const EXCUSED_THRESHOLDS = [15, 20, 25];

// Pure computation of a نظام التحذيرات state from a count and its
// threshold ladder — level N is reached once the count hits thresholds[N-1].
// classPrefix keeps the two ladders visually distinct (plain-absence
// warnings escalate yellow→orange→red→dark-red; غياب بعذر warnings use
// their own purple scale, matching the --excused color already used for
// the "غياب بعذر" tile badge elsewhere) instead of reusing the same
// "level-N" classes for two conceptually different severities.
function buildWarningState(rawCount, thresholds, emptyHint, classPrefix) {
  const count = Math.max(0, Number(rawCount) || 0);
  const maxScale = thresholds[thresholds.length - 1];

  let level = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (count >= thresholds[i]) level = i + 1;
  }

  const text = level > 0 ? `تحذير ${level}` : "لا يوجد";
  const nextThreshold = level < thresholds.length ? thresholds[level] : null;

  const progressPct = Math.min(100, (count / maxScale) * 100);
  const progressClass = `warning-progress-fill${level > 0 ? " " + classPrefix + "level-" + level : ""}`;
  const badgeClass = `warning-level-badge warning-${classPrefix}level-${level}`;

  let nextHint;
  if (nextThreshold === null) {
    nextHint = "تم الوصول لأعلى مستوى تحذير.";
  } else if (count === 0) {
    nextHint = emptyHint;
  } else {
    nextHint = `متبقّي ${toArabicDigits(nextThreshold - count)} غياب حتى تحذير ${toArabicDigits(level + 1)}`;
  }

  return {
    count,
    countText: toArabicDigits(count),
    level,
    text,
    badgeClass,
    progressPct,
    progressClass,
    nextHint,
    thresholds,
  };
}

// Absences without an excuse (hasReason !== true) — the caller is
// responsible for deriving that count correctly (see
// shared/attendance-tiles.js's fetchStudentAttendanceData, whose `absent`
// field already does this).
export function computeWarningState(absentCount) {
  return buildWarningState(absentCount, NORMAL_THRESHOLDS, "لا توجد غيابات بدون عذر بعد.", "");
}

// Absences marked غياب بعذر (hasReason === true) — see
// fetchStudentAttendanceData's `excused` field.
export function computeExcusedWarningState(excusedCount) {
  return buildWarningState(excusedCount, EXCUSED_THRESHOLDS, "لا توجد غيابات بعذر بعد.", "excused-");
}

function applyWarningState(state, { countEl, badgeEl, progressFillEl, hintEl } = {}) {
  if (countEl) countEl.textContent = state.countText;
  if (badgeEl) {
    badgeEl.textContent = state.text;
    badgeEl.className = state.badgeClass;
  }
  if (progressFillEl) {
    progressFillEl.style.width = `${state.progressPct}%`;
    progressFillEl.className = state.progressClass;
  }
  if (hintEl) hintEl.textContent = state.nextHint;
  return state;
}

// Applies the computed state to the standard warning-card elements — every
// page embedding this card uses the same 4 pieces (count/badge/progress
// fill/next-hint), so this just takes those elements directly.
export function renderWarningState(absentCount, els) {
  return applyWarningState(computeWarningState(absentCount), els);
}

export function renderExcusedWarningState(excusedCount, els) {
  return applyWarningState(computeExcusedWarningState(excusedCount), els);
}
