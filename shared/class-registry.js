// Which classes exist school-wide (e.g. "10 / 1", "11 / 2 ع", "12 / 1 د")
// used to be a hardcoded array duplicated across every page. It now lives
// in the single doc settings/classes ({ classes: string[] }), editable from
// admins/students.html's "إعدادات الفصول" sheet. DEFAULT_CLASS_LIST is both
// the fallback if that doc doesn't exist yet (no manual seed step needed —
// every page behaves identically until the first admin edit creates it) and
// the pre-existing canonical list this replaces.
import { doc, getDoc } from "/shared/firebase.js";

export const DEFAULT_CLASS_LIST = [
  "10 / 1", "10 / 2", "10 / 3", "10 / 4", "10 / 5", "10 / 6", "10 / 7",
  "11 / 1 ع", "11 / 2 ع", "11 / 3 ع", "11 / 4 ع", "11 / 5 ع", "11 / 1 د",
  "12 / 1 ع", "12 / 2 ع", "12 / 3 ع", "12 / 4 ع", "12 / 5 ع", "12 / 1 د",
];

async function readClassList(db) {
  try {
    const snap = await getDoc(doc(db, "settings", "classes"));
    const list = snap.exists() ? snap.data()?.classes : null;
    if (Array.isArray(list) && list.length && list.every((c) => typeof c === "string")) {
      return list;
    }
  } catch (e) {
    console.error("[class-registry] fetchClassList:", e);
  }
  return DEFAULT_CLASS_LIST;
}

// A single in-flight read, handed to whoever awaits fetchClassList() next.
let primed = null;

// Starts the settings/classes read straight away, without waiting for the
// caller to be ready for the answer.
//
// Every page boots by doing two reads that have nothing to do with each
// other: the signed-in user's role document, and this class list. They were
// awaited one after the other, so the page paid two full Firestore round
// trips back to back before it could show anything. Calling this as soon as
// `db` exists overlaps them — by the time the role check returns, the class
// list is usually already sitting here — which takes a whole round trip off
// the load of nearly every page.
//
// Safe to call more than once, and safe to never await: readClassList()
// handles its own errors and falls back to DEFAULT_CLASS_LIST, so this can
// never produce an unhandled rejection.
export function primeClassList(db) {
  if (!primed) primed = { db, promise: readClassList(db) };
  return primed.promise;
}

export async function fetchClassList(db) {
  // Deliberately one-shot. The primed read is consumed by the first caller
  // and then forgotten, so any later fetch — after an admin adds or removes
  // a class, say — still goes to Firestore and sees the change.
  if (primed && primed.db === db) {
    const { promise } = primed;
    primed = null;
    return promise;
  }
  return readClassList(db);
}

export function parseClassKey(s) {
  const m = String(s || "").match(/^(\d+)\s*\/\s*(\d+)(?:\s*(.*))?$/);
  return m
    ? { grade: +m[1], section: +m[2], track: (m[3] || "").trim() }
    : { grade: 999, section: 999, track: "" };
}

export function sortClassList(list) {
  return [...list].sort((a, b) => {
    const pa = parseClassKey(a), pb = parseClassKey(b);
    if (pa.grade !== pb.grade) return pa.grade - pb.grade;
    if (pa.section !== pb.section) return pa.section - pb.section;
    return pa.track.localeCompare(pb.track, "ar");
  });
}

export function groupByGrade(list) {
  const sorted = sortClassList(list);
  return {
    "10": sorted.filter((c) => parseClassKey(c).grade === 10),
    "11": sorted.filter((c) => parseClassKey(c).grade === 11),
    "12": sorted.filter((c) => parseClassKey(c).grade === 12),
  };
}

export function getGradeForClass(classKey) {
  const m = String(classKey || "").match(/\b(10|11|12)\b/);
  return m ? m[1] : null;
}

// Numbers 1-10 not already present in `list` for the given grade+track.
// Grade 10 never has a track (pass "" or omit it).
export function availableNumbersToAdd(list, grade, track = "") {
  const g = String(grade);
  const t = (track || "").trim();
  const taken = new Set(
    list
      .map(parseClassKey)
      .filter((p) => String(p.grade) === g && p.track === t)
      .map((p) => p.section)
  );
  const numbers = [];
  for (let n = 1; n <= 10; n++) if (!taken.has(n)) numbers.push(n);
  return numbers;
}

export function buildClassKey(grade, section, track = "") {
  const t = (track || "").trim();
  return `${grade} / ${section}${t ? ` ${t}` : ""}`;
}
