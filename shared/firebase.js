import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  EmailAuthProvider,
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword as _createUserWithEmailAndPassword,
  deleteUser as _deleteUser,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  setPersistence,
  signInWithEmailAndPassword as _signInWithEmailAndPassword,
  signOut as _signOut,
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  Timestamp,
  addDoc as _addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  collectionGroup,
  deleteDoc as _deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore as _getFirestore,
  initializeFirestore as _initializeFirestore,
  limit,
  onSnapshot,
  or,
  orderBy,
  persistentSingleTabManager,
  query,
  runTransaction as _runTransaction,
  serverTimestamp as _serverTimestamp,
  setDoc as _setDoc,
  updateDoc as _updateDoc,
  where,
  writeBatch as _writeBatch,
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyDxT9rEUi2KpCEgU52DrTE8bv-RogxhxBE",
  authDomain: "abrabs-3a898.firebaseapp.com",
  projectId: "abrabs-3a898",
  storageBucket: "abrabs-3a898.appspot.com",
  messagingSenderId: "641655788074",
  appId: "1:641655788074:web:0ffb952201fd8b2bcb6953",
  measurementId: "G-T7HTSJGYP8",
};

export function getOrInitApp() {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export function getOrInitNamedApp(name) {
  return getApps().some((app) => app.name === name)
    ? getApp(name)
    : initializeApp(firebaseConfig, name);
}

export function initFirestoreLongPolling(app = getOrInitApp()) {
  const db = _initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    useFetchStreams: false,
  });
  rememberDb(db);
  return db;
}

export function initFirestorePersistentSingleTab(app = getOrInitApp()) {
  try {
    const db = _initializeFirestore(app, {
      localCache: persistentSingleTabManager(),
    });
    rememberDb(db);
    return db;
  } catch {
    const db = _initializeFirestore(app, {});
    rememberDb(db);
    return db;
  }
}

const SITE_LOGS_COLLECTION = "siteLogs";
const MAX_PREVIEW_DEPTH = 2;
const MAX_PREVIEW_OBJECT_KEYS = 20;
const MAX_PREVIEW_ARRAY_ITEMS = 12;
const MAX_TEXT_LENGTH = 260;
const MAX_BATCH_CHANGES = 120;
const REDACT_KEY_RX = /(password|passwd|pass|secret|token|api[_-]?key)/i;

let pendingLogWrite = Promise.resolve();
let lastKnownDb = null;

function getFirestore(app) {
  const db = _getFirestore(app);
  rememberDb(db);
  return db;
}

function initializeFirestore(app, settings) {
  const db = _initializeFirestore(app, settings);
  rememberDb(db);
  return db;
}

function trimSlashes(path) {
  return (path || "").toString().replace(/^\/+|\/+$/g, "");
}

function pathFromRef(refOrPath) {
  if (!refOrPath) return "";
  if (typeof refOrPath === "string") return trimSlashes(refOrPath);
  if (typeof refOrPath.path === "string") return trimSlashes(refOrPath.path);
  return "";
}

function isLogsPath(refOrPath) {
  const path = pathFromRef(refOrPath);
  return path === SITE_LOGS_COLLECTION || path.startsWith(`${SITE_LOGS_COLLECTION}/`);
}

function targetMetaFromPath(pathLike) {
  const path = pathFromRef(pathLike);
  if (!path) {
    return { path: null, collection: null, docId: null, isDocument: null };
  }
  const parts = path.split("/").filter(Boolean);
  const isDocument = parts.length % 2 === 0;
  return {
    path,
    collection: isDocument ? parts.slice(0, -1).join("/") : path,
    docId: isDocument ? parts[parts.length - 1] : null,
    isDocument,
  };
}

function rememberDb(db) {
  if (db) lastKnownDb = db;
}

function dbFromRef(ref) {
  const db = ref?.firestore || null;
  if (db) rememberDb(db);
  return db;
}

function resolveLogDb(preferredDb = null) {
  if (preferredDb) {
    rememberDb(preferredDb);
    return preferredDb;
  }
  if (lastKnownDb) return lastKnownDb;
  try {
    const db = getFirestore(getOrInitApp());
    rememberDb(db);
    return db;
  } catch {
    return null;
  }
}

function clipText(value, max = MAX_TEXT_LENGTH) {
  const text = (value ?? "").toString();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function sanitizeError(error) {
  if (!error) return null;
  return {
    code: error.code || null,
    name: error.name || null,
    message: clipText(error.message || String(error), 360),
  };
}

function summarizeValue(value, depth = 0, parentKey = "") {
  if (value == null) return value;
  const type = typeof value;
  if (type === "string") return clipText(value);
  if (type === "number" || type === "boolean") return value;
  if (type === "bigint") return value.toString();
  if (type === "function") return "[Function]";
  if (type !== "object") return clipText(String(value));
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch {
      return "[Timestamp]";
    }
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_PREVIEW_DEPTH) return `[Array(${value.length})]`;
    return value.slice(0, MAX_PREVIEW_ARRAY_ITEMS).map((item) => summarizeValue(item, depth + 1, parentKey));
  }
  if (depth >= MAX_PREVIEW_DEPTH) return "[Object]";
  const out = {};
  const keys = Object.keys(value).slice(0, MAX_PREVIEW_OBJECT_KEYS);
  keys.forEach((key) => {
    if (REDACT_KEY_RX.test(key)) {
      out[key] = "[REDACTED]";
      return;
    }
    out[key] = summarizeValue(value[key], depth + 1, key);
  });
  return out;
}

function summarizePayload(data, extra = null) {
  const isObject = data && typeof data === "object" && !Array.isArray(data);
  const keys = isObject ? Object.keys(data).slice(0, MAX_PREVIEW_OBJECT_KEYS) : [];
  return {
    keys,
    preview: summarizeValue(data),
    ...extra,
  };
}

function normalizeFieldLabel(field) {
  if (typeof field === "string") return field;
  if (field && typeof field === "object" && typeof field.toString === "function") {
    return field.toString();
  }
  return String(field);
}

function summarizeUpdateArgs(updateArgs) {
  if (updateArgs.length === 1 && updateArgs[0] && typeof updateArgs[0] === "object" && !Array.isArray(updateArgs[0])) {
    return summarizePayload(updateArgs[0]);
  }
  const keys = [];
  for (let i = 0; i < updateArgs.length; i += 2) {
    keys.push(normalizeFieldLabel(updateArgs[i]));
  }
  return {
    keys: keys.slice(0, MAX_PREVIEW_OBJECT_KEYS),
    preview: { fields: keys.slice(0, MAX_PREVIEW_ARRAY_ITEMS) },
  };
}

function actorSnapshot(authOverride = null) {
  let auth = authOverride;
  if (!auth) {
    try {
      auth = getAuth(getOrInitApp());
    } catch {
      auth = null;
    }
  }
  const user = auth?.currentUser || null;
  return {
    uid: user?.uid || null,
    email: user?.email || null,
    authApp: auth?.app?.name || null,
  };
}

function contextSnapshot() {
  const hasLocation = typeof window !== "undefined" && !!window.location;
  return {
    page: hasLocation ? window.location.pathname || null : null,
    href: hasLocation ? clipText(window.location.href || "", 320) : null,
  };
}

function queueSiteLog(entry, preferredDb = null) {
  pendingLogWrite = pendingLogWrite
    .then(async () => {
      const db = resolveLogDb(preferredDb);
      if (!db) return;
      await _addDoc(collection(db, SITE_LOGS_COLLECTION), {
        ...entry,
        ts: _serverTimestamp(),
        clientTs: Date.now(),
      });
    })
    .catch(() => {});
}

function logFirestore(action, status, refOrPath, details = {}, db = null, error = null) {
  if (isLogsPath(refOrPath)) return;
  const safeDetails = details && typeof details === "object" ? details : {};
  queueSiteLog(
    {
      domain: "firestore",
      action,
      status,
      actor: actorSnapshot(),
      target: targetMetaFromPath(refOrPath),
      ...safeDetails,
      error: sanitizeError(error),
      context: contextSnapshot(),
    },
    db
  );
}

function logAuth(action, status, details = {}, auth = null, error = null) {
  const safeDetails = details && typeof details === "object" ? details : {};
  queueSiteLog(
    {
      domain: "auth",
      action,
      status,
      actor: actorSnapshot(auth),
      target: null,
      ...safeDetails,
      error: sanitizeError(error),
      context: contextSnapshot(),
    },
    null
  );
}

async function addDoc(collectionRef, data) {
  const db = dbFromRef(collectionRef);
  const change = summarizePayload(data);
  try {
    const createdRef = await _addDoc(collectionRef, data);
    if (!isLogsPath(createdRef)) {
      logFirestore("addDoc", "success", createdRef, { change }, db || dbFromRef(createdRef));
    }
    return createdRef;
  } catch (error) {
    if (!isLogsPath(collectionRef)) {
      logFirestore("addDoc", "error", collectionRef, { change }, db, error);
    }
    throw error;
  }
}

async function setDoc(ref, data, options) {
  const db = dbFromRef(ref);
  const change = summarizePayload(data, { merge: !!options?.merge });
  try {
    const result = await _setDoc(ref, data, options);
    logFirestore("setDoc", "success", ref, { change }, db);
    return result;
  } catch (error) {
    logFirestore("setDoc", "error", ref, { change }, db, error);
    throw error;
  }
}

async function updateDoc(ref, ...updateArgs) {
  const db = dbFromRef(ref);
  const change = summarizeUpdateArgs(updateArgs);
  try {
    const result = await _updateDoc(ref, ...updateArgs);
    logFirestore("updateDoc", "success", ref, { change }, db);
    return result;
  } catch (error) {
    logFirestore("updateDoc", "error", ref, { change }, db, error);
    throw error;
  }
}

async function deleteDoc(ref) {
  const db = dbFromRef(ref);
  try {
    const result = await _deleteDoc(ref);
    logFirestore("deleteDoc", "success", ref, null, db);
    return result;
  } catch (error) {
    logFirestore("deleteDoc", "error", ref, null, db, error);
    throw error;
  }
}

function summarizeBatchChanges(changes) {
  return changes.slice(0, MAX_BATCH_CHANGES).map((item) => ({
    action: item.action,
    target: targetMetaFromPath(item.path),
    change: item.change || null,
  }));
}

function writeBatch(db) {
  rememberDb(db);
  const batch = _writeBatch(db);
  const changes = [];
  const api = {
    set(ref, data, options) {
      const path = pathFromRef(ref);
      if (!isLogsPath(path)) {
        changes.push({ action: "set", path, change: summarizePayload(data, { merge: !!options?.merge }) });
      }
      batch.set(ref, data, options);
      return api;
    },
    update(ref, ...updateArgs) {
      const path = pathFromRef(ref);
      if (!isLogsPath(path)) {
        changes.push({ action: "update", path, change: summarizeUpdateArgs(updateArgs) });
      }
      batch.update(ref, ...updateArgs);
      return api;
    },
    delete(ref) {
      const path = pathFromRef(ref);
      if (!isLogsPath(path)) {
        changes.push({ action: "delete", path, change: null });
      }
      batch.delete(ref);
      return api;
    },
    async commit() {
      try {
        const result = await batch.commit();
        logFirestore(
          "writeBatch.commit",
          "success",
          "batch",
          { meta: { count: changes.length }, changes: summarizeBatchChanges(changes) },
          db
        );
        return result;
      } catch (error) {
        logFirestore(
          "writeBatch.commit",
          "error",
          "batch",
          { meta: { count: changes.length }, changes: summarizeBatchChanges(changes) },
          db,
          error
        );
        throw error;
      }
    },
  };
  return api;
}

async function runTransaction(db, updateFunction, options) {
  rememberDb(db);
  const changes = [];
  const wrappedUpdate = (transaction) => {
    const tx = {
      get: (...args) => transaction.get(...args),
      set: (ref, data, opts) => {
        const path = pathFromRef(ref);
        if (!isLogsPath(path)) {
          changes.push({ action: "set", path, change: summarizePayload(data, { merge: !!opts?.merge }) });
        }
        transaction.set(ref, data, opts);
        return tx;
      },
      update: (ref, ...updateArgs) => {
        const path = pathFromRef(ref);
        if (!isLogsPath(path)) {
          changes.push({ action: "update", path, change: summarizeUpdateArgs(updateArgs) });
        }
        transaction.update(ref, ...updateArgs);
        return tx;
      },
      delete: (ref) => {
        const path = pathFromRef(ref);
        if (!isLogsPath(path)) {
          changes.push({ action: "delete", path, change: null });
        }
        transaction.delete(ref);
        return tx;
      },
    };
    return updateFunction(tx);
  };
  try {
    const result =
      options === undefined
        ? await _runTransaction(db, wrappedUpdate)
        : await _runTransaction(db, wrappedUpdate, options);
    logFirestore(
      "runTransaction",
      "success",
      "transaction",
      { meta: { count: changes.length }, changes: summarizeBatchChanges(changes) },
      db
    );
    return result;
  } catch (error) {
    logFirestore(
      "runTransaction",
      "error",
      "transaction",
      { meta: { count: changes.length }, changes: summarizeBatchChanges(changes) },
      db,
      error
    );
    throw error;
  }
}

async function signInWithEmailAndPassword(auth, email, password) {
  try {
    const credential = await _signInWithEmailAndPassword(auth, email, password);
    logAuth(
      "signInWithEmailAndPassword",
      "success",
      {
        meta: {
          attemptedEmail: email || null,
          signedInUid: credential?.user?.uid || null,
          signedInEmail: credential?.user?.email || email || null,
          authApp: auth?.app?.name || null,
        },
      },
      auth
    );
    return credential;
  } catch (error) {
    logAuth(
      "signInWithEmailAndPassword",
      "error",
      { meta: { attemptedEmail: email || null, authApp: auth?.app?.name || null } },
      auth,
      error
    );
    throw error;
  }
}

async function signOut(auth) {
  const before = actorSnapshot(auth);
  try {
    const result = await _signOut(auth);
    logAuth(
      "signOut",
      "success",
      { meta: { signedOutUid: before.uid, signedOutEmail: before.email, authApp: auth?.app?.name || null } },
      auth
    );
    return result;
  } catch (error) {
    logAuth(
      "signOut",
      "error",
      { meta: { signedOutUid: before.uid, signedOutEmail: before.email, authApp: auth?.app?.name || null } },
      auth,
      error
    );
    throw error;
  }
}

async function createUserWithEmailAndPassword(auth, email, password) {
  const actorBefore = actorSnapshot();
  try {
    const credential = await _createUserWithEmailAndPassword(auth, email, password);
    logAuth(
      "createUserWithEmailAndPassword",
      "success",
      {
        meta: {
          actorUid: actorBefore.uid,
          actorEmail: actorBefore.email,
          createdUid: credential?.user?.uid || null,
          createdEmail: credential?.user?.email || email || null,
          authApp: auth?.app?.name || null,
        },
      },
      auth
    );
    return credential;
  } catch (error) {
    logAuth(
      "createUserWithEmailAndPassword",
      "error",
      {
        meta: {
          actorUid: actorBefore.uid,
          actorEmail: actorBefore.email,
          attemptedEmail: email || null,
          authApp: auth?.app?.name || null,
        },
      },
      auth,
      error
    );
    throw error;
  }
}

async function deleteUser(user) {
  const actorBefore = actorSnapshot();
  const targetUid = user?.uid || null;
  const targetEmail = user?.email || null;
  try {
    const result = await _deleteUser(user);
    logAuth(
      "deleteUser",
      "success",
      {
        meta: {
          actorUid: actorBefore.uid,
          actorEmail: actorBefore.email,
          targetUid,
          targetEmail,
        },
      },
      null
    );
    return result;
  } catch (error) {
    logAuth(
      "deleteUser",
      "error",
      {
        meta: {
          actorUid: actorBefore.uid,
          actorEmail: actorBefore.email,
          targetUid,
          targetEmail,
        },
      },
      null,
      error
    );
    throw error;
  }
}

const serverTimestamp = _serverTimestamp;

export {
  EmailAuthProvider,
  Timestamp,
  addDoc,
  arrayRemove,
  arrayUnion,
  browserLocalPersistence,
  browserSessionPersistence,
  collection,
  collectionGroup,
  createUserWithEmailAndPassword,
  deleteDoc,
  deleteField,
  deleteUser,
  doc,
  getApp,
  getApps,
  getAuth,
  getDoc,
  getDocs,
  getFirestore,
  initializeApp,
  initializeFirestore,
  limit,
  onAuthStateChanged,
  onSnapshot,
  or,
  orderBy,
  persistentSingleTabManager,
  query,
  reauthenticateWithCredential,
  runTransaction,
  serverTimestamp,
  setDoc,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateDoc,
  where,
  writeBatch,
};
