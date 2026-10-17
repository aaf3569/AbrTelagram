// سجل الحسابات (admins/teachers.html → «سجل الحسابات»): one entry per account
// action — a teacher/admin account created, edited, its password changed,
// deleted, or its stored password revealed — written by the page that did it (admins/teachers.html,
// depHead/department.html). firestore.rules' accountLogs pins each entry to
// the writer's own uid and the server's time, and nobody can edit or delete
// one, so it's an audit trail. Passwords are never written here — only that
// one was changed.
import { addDoc, collection, serverTimestamp } from "/shared/firebase.js";

let actor = { uid: '', name: '', role: '' };

// Who is doing the actions on this page — call once the signed-in user's
// own teachers/{uid} doc is loaded.
export function setAccountLogActor({ uid, name, role }) {
  actor = { uid: String(uid || ''), name: String(name || '').trim(), role: String(role || '') };
}

const cut = (v, n) => String(v ?? '').slice(0, n);

// A list or single value as stored in a change: short strings only.
function cleanValue(v) {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) return v.slice(0, 40).map(x => cut(x, 80));
  if (typeof v === 'boolean') return v;
  return cut(v, 200);
}

/**
 * Record one account action. Never throws — a failed log must not fail the
 * action it describes (that already succeeded).
 *
 * @param db Firestore
 * @param entry {
 *   type: 'create' | 'update' | 'delete' | 'password' | 'reveal',
 *   target: { uid, name, civilId, role, department },
 *   summary?: string,
 *   changes?: [{ key, label, from?, to?, added?, removed? }],
 * }
 */
export async function logAccountEvent(db, { type, target = {}, summary = '', changes = [] }) {
  if (!actor.uid || !target.uid) return;
  const payload = {
    type,
    targetUid: cut(target.uid, 128),
    targetName: cut(target.name, 120),
    targetCivilId: cut(target.civilId, 20),
    targetRole: cut(target.role, 20),
    department: cut(target.department, 80),
    summary: cut(summary, 400),
    changes: (Array.isArray(changes) ? changes : []).slice(0, 60).map(c => {
      const out = { key: cut(c.key, 40), label: cut(c.label, 80) };
      ['from', 'to', 'added', 'removed'].forEach(k => {
        if (k in c) out[k] = cleanValue(c[k]);
      });
      return out;
    }),
    actorUid: actor.uid,
    actorName: cut(actor.name || actor.uid, 120),
    actorRole: cut(actor.role, 20),
    at: serverTimestamp(),
  };
  try {
    await addDoc(collection(db, 'accountLogs'), payload);
  } catch (e) {
    console.warn('[accountLogs] could not record', type, e?.message || e);
  }
}

// ---- diff helpers: build `changes` from a before/after pair ----

function same(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// A plain field: { key, label, from, to } when it changed.
export function fieldChange(key, label, from, to) {
  const f = (from ?? '') === '' ? null : from;
  const t = (to ?? '') === '' ? null : to;
  return same(f, t) ? null : { key, label, from: f, to: t };
}

// A list (e.g. classes): which items were added and which removed.
export function listChange(key, label, from, to) {
  const a = new Set((Array.isArray(from) ? from : []).filter(Boolean));
  const b = new Set((Array.isArray(to) ? to : []).filter(Boolean));
  const added = [...b].filter(x => !a.has(x));
  const removed = [...a].filter(x => !b.has(x));
  return (added.length || removed.length) ? { key, label, added, removed } : null;
}

// A permission switched on or off.
export function flagChange(key, label, from, to) {
  return !!from === !!to ? null : { key, label, from: !!from, to: !!to };
}

export function compactChanges(list) {
  return list.filter(Boolean);
}
