// Fake Firestore for the e2e check: teachers and an empty budget.
const D = "الأحياء والجيولوجيا";
const TEACHERS = {
  h: { name: "حسين القطيفي", department: D, subject: "الجيولوجيا", subject2: "التربية البيئية" },
  y: { name: "يوسف القلاف", department: D, subject: "الجيولوجيا", subject2: "التربية البيئية" },
};
window.__saved = [];
const snap = (id, data) => ({ id, exists: () => !!data, data: () => data });
export const firebaseConfig = {};
export const initializeApp = () => ({}); export const getApp = () => ({}); export const getApps = () => [];
export const getFirestore = () => ({});
export const collection = (db, name) => ({ name });
export const doc = (db, ...p) => ({ path: p.join("/") });
export const getDocs = async (c) => ({ docs: c.name === "teachers" ? Object.entries(TEACHERS).map(([id, d]) => snap(id, d)) : [] });
export const getDoc = async (r) => snap(r.path, null);
export const setDoc = async (r, data) => { window.__saved.push({ path: r.path, data: JSON.parse(JSON.stringify(data)) }); };
export const updateDoc = async () => {}; export const deleteDoc = async () => {};
export const deleteField = () => null; export const serverTimestamp = () => "ts";
export const onAuthStateChanged = () => () => {};
