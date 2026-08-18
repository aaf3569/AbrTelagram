function toArabicDigits(value) {
  const ar = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  return String(value ?? "").replace(/\d/g, (d) => ar[parseInt(d, 10)]);
}

// Absence count where the progress bar reads "100%" — matches the level-3
// threshold, not a cap on the count itself (which keeps climbing past it).
const WARNING_MAX_SCALE = 15;

// Pure computation of نظام التحذيرات state from a count of absences
// without an excuse (hasReason !== true) — the caller is responsible for
// deriving that count correctly (see shared/attendance-tiles.js's
// fetchStudentAttendanceData, whose `absent` field already does this).
// Kept as one shared function so admins/students.html and
// supervisors/supervisorstudents.html can't disagree on the 5/10/15
// thresholds the way their warning UIs had already started to drift.
export function computeWarningState(absentCount) {
  const count = Math.max(0, Number(absentCount) || 0);

  let level = 0;
  let text = "لا يوجد";
  let nextThreshold = 5;

  if (count >= 15) {
    level = 3;
    text = "تحذير 3";
    nextThreshold = null;
  } else if (count >= 10) {
    level = 2;
    text = "تحذير 2";
    nextThreshold = 15;
  } else if (count >= 5) {
    level = 1;
    text = "تحذير 1";
    nextThreshold = 10;
  }

  const progressPct = Math.min(100, (count / WARNING_MAX_SCALE) * 100);
  const progressClass = `warning-progress-fill${level > 0 ? " level-" + level : ""}`;
  const badgeClass = `warning-level-badge warning-level-${level}`;

  let nextHint;
  if (nextThreshold === null) {
    nextHint = "تم الوصول لأعلى مستوى تحذير.";
  } else if (count === 0) {
    nextHint = "لا توجد غيابات بدون عذر بعد.";
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
  };
}

// Applies the computed state to the standard warning-card elements — every
// page embedding this card uses the same 4 pieces (count/badge/progress
// fill/next-hint), so this just takes those elements directly.
export function renderWarningState(absentCount, { countEl, badgeEl, progressFillEl, hintEl } = {}) {
  const state = computeWarningState(absentCount);
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
