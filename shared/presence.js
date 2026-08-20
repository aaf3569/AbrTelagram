import { doc, onSnapshot, setDoc, serverTimestamp } from "/shared/firebase.js";

// How stale a heartbeat can be before we call someone "offline" — set well
// above HEARTBEAT_INTERVAL_MS so one missed beat (a slow network, a tab
// briefly backgrounded) doesn't flicker the badge.
const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
// How often watchers re-check an already-loaded timestamp against "now" —
// onSnapshot only fires on writes, so without this a badge would keep
// reading "online" long after the other tab actually went stale.
const RECHECK_INTERVAL_MS = 15 * 1000;

function toArabicDigits(value) {
  const ar = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  return String(value ?? "").replace(/\d/g, (d) => ar[parseInt(d, 10)]);
}

function pluralAr(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return few;
  return many;
}

function relativeArabicLabel(date) {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "الآن";
  if (diffMin < 60) return `منذ ${toArabicDigits(diffMin)} ${pluralAr(diffMin, "دقيقة", "دقيقتين", "دقائق", "دقيقة")}`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `منذ ${toArabicDigits(diffHr)} ${pluralAr(diffHr, "ساعة", "ساعتين", "ساعات", "ساعة")}`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `منذ ${toArabicDigits(diffDay)} ${pluralAr(diffDay, "يوم", "يومين", "أيام", "يومًا")}`;
  return new Intl.DateTimeFormat("ar-KW", { dateStyle: "medium", timeZone: "Asia/Kuwait" }).format(date);
}

// Pure computation — given the last-known heartbeat timestamp (a Firestore
// Timestamp, Date, or null/undefined for "never seen"), returns the current
// online/offline state and an Arabic label for it.
export function computePresenceState(lastSeenAt) {
  if (!lastSeenAt) return { online: false, lastSeenAt: null, label: "لم يسجّل الدخول بعد" };
  const date = lastSeenAt.toDate ? lastSeenAt.toDate() : new Date(lastSeenAt);
  const online = Date.now() - date.getTime() <= ONLINE_THRESHOLD_MS;
  return {
    online,
    lastSeenAt: date,
    label: online ? "متصل الآن" : `آخر ظهور ${relativeArabicLabel(date)}`,
  };
}

// Live-subscribes to one user's presence doc and calls onChange(state)
// whenever it changes AND on a periodic recheck (see RECHECK_INTERVAL_MS)
// so the badge ages from "online" to "آخر ظهور ..." on its own. Returns an
// unsubscribe function — callers must invoke it when the UI showing this
// status goes away (list re-render, sheet close) to avoid leaking listeners.
export function watchPresence(db, uid, onChange) {
  if (!uid || typeof onChange !== "function") return () => {};
  let lastSeenAt = null;
  const emit = () => onChange(computePresenceState(lastSeenAt));
  const unsubscribeSnapshot = onSnapshot(
    doc(db, "presence", uid),
    (snap) => {
      lastSeenAt = snap.exists() ? snap.data()?.lastSeenAt : null;
      emit();
    },
    () => {
      lastSeenAt = null;
      emit();
    }
  );
  const recheckTimer = setInterval(emit, RECHECK_INTERVAL_MS);
  return () => {
    unsubscribeSnapshot();
    clearInterval(recheckTimer);
  };
}

let heartbeatTimer = null;
let heartbeatVisibilityHandler = null;

function writeHeartbeat(db, uid) {
  setDoc(doc(db, "presence", uid), { lastSeenAt: serverTimestamp() }, { merge: true }).catch(() => {
    // Non-critical — a missed heartbeat just makes this user look offline
    // a little sooner than they actually went idle.
  });
}

// Starts writing this signed-in user's own presence heartbeat every
// HEARTBEAT_INTERVAL_MS while the tab is visible (paused while backgrounded,
// so a forgotten hidden tab doesn't keep someone looking online forever).
// Call once per page, right after auth/role is confirmed. Returns a stop
// function; pages don't normally need to call it (the interval dies with
// the page), but it's there for symmetry with watchPresence.
export function startPresenceHeartbeat(db, uid) {
  stopPresenceHeartbeat();
  if (!uid) return () => {};
  writeHeartbeat(db, uid);
  heartbeatTimer = setInterval(() => {
    if (document.visibilityState === "hidden") return;
    writeHeartbeat(db, uid);
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatVisibilityHandler = () => {
    if (document.visibilityState === "visible") writeHeartbeat(db, uid);
  };
  document.addEventListener("visibilitychange", heartbeatVisibilityHandler);
  return stopPresenceHeartbeat;
}

export function stopPresenceHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (heartbeatVisibilityHandler) {
    document.removeEventListener("visibilitychange", heartbeatVisibilityHandler);
    heartbeatVisibilityHandler = null;
  }
}
