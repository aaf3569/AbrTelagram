import { doc, getDoc } from "/shared/firebase.js";

export function normalizeRole(value) {
  return (value || "").toString().trim().toLowerCase();
}

export function isTruthyFlag(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function readDeepValue(obj, path) {
  if (!obj || !path) return undefined;
  return path
    .split(".")
    .reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

export function hasGuardAccess(profile, options = {}) {
  const role = normalizeRole(profile?.role);
  const isSupervisor = isTruthyFlag(profile?.isSupervisor);
  const allowedRoles = Array.isArray(options.allowedRoles) ? options.allowedRoles : [];
  const allowSupervisor = options.allowSupervisor === true;
  const permissionPath = options.permissionPath || "";
  const permissionGranted = isTruthyFlag(readDeepValue(profile, permissionPath));
  const hasRole = allowedRoles.some((allowed) => normalizeRole(allowed) === role);
  const allowed = hasRole || (allowSupervisor && isSupervisor) || permissionGranted;

  return {
    allowed,
    role,
    isSupervisor,
    permissionGranted,
    hasRole,
  };
}

export async function getTeacherProfile(db, uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "teachers", uid));
  return snap.exists() ? (snap.data() || {}) : null;
}
