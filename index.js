/*
  Telegram webhook + notifications server (Express + Firebase Admin)

  How to run:
  npm install express firebase-admin
  node index.js

  How to set env variable:
  export TELEGRAM_BOT_TOKEN=YOUR_TOKEN

  Optional env variables:
  export TELEGRAM_BOT_USERNAME=YOUR_BOT_USERNAME
  export TELEGRAM_LINK_SECRET=LONG_RANDOM_SECRET
  export ATTENDANCE_REMINDER_DELAY_MINUTES=10
  export ALLOW_PLAIN_TEACHER_ID_START=true
  export FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
  # or GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/service-account.json

  How to set webhook:
  https://api.telegram.org/botYOUR_TOKEN/setWebhook?url=YOUR_DOMAIN/api/telegram-webhook
*/

const crypto = require("crypto");
const express = require("express");
const admin = require("firebase-admin");

const PORT = Number(process.env.PORT || 3000);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "AbrSchool_bot";
const KUWAIT_TIMEZONE = "Asia/Kuwait";
const LESSON_REMINDER_LEAD_MINUTES = 5;
const ATTENDANCE_REMINDER_DELAY_MINUTES = Math.max(
  1,
  Number(process.env.ATTENDANCE_REMINDER_DELAY_MINUTES || 10)
);
const DEFAULT_LESSON_TIMES = [
  { index: 1, label: "الحصة الأولى", start: "07:55", end: "08:40" },
  { index: 2, label: "الحصة الثانية", start: "08:45", end: "09:30" },
  { index: 3, label: "الحصة الثالثة", start: "09:35", end: "10:20" },
  { index: 4, label: "الحصة الرابعة", start: "10:35", end: "11:20" },
  { index: 5, label: "الحصة الخامسة", start: "11:25", end: "12:10" },
  { index: 6, label: "الحصة السادسة", start: "12:25", end: "13:10" },
  { index: 7, label: "الحصة السابعة", start: "13:15", end: "13:55" },
];

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  return next();
});

const db = initFirebaseAdmin();
let reminderSweepRunning = false;
let botUsernameCache = null;
const users = Object.create(null); // in-memory mapping: USER_ID -> chat_id

function initFirebaseAdmin() {
  if (admin.apps.length) return admin.firestore();

  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawServiceAccount) {
    const serviceAccount = JSON.parse(rawServiceAccount);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    admin.initializeApp();
  }

  return admin.firestore();
}

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  let source = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  while (source.length % 4 !== 0) source += "=";
  return Buffer.from(source, "base64").toString("utf8");
}

function linkSecret() {
  return process.env.TELEGRAM_LINK_SECRET || TELEGRAM_BOT_TOKEN || "telegram-link-secret";
}

function signStartPayload(teacherUid) {
  const body = {
    teacherUid: String(teacherUid || "").trim(),
    exp: Date.now() + 30 * 60 * 1000,
    nonce: crypto.randomBytes(8).toString("hex"),
  };
  const encodedBody = base64UrlEncode(JSON.stringify(body));
  const signature = crypto
    .createHmac("sha256", linkSecret())
    .update(encodedBody)
    .digest("hex");
  return `${encodedBody}.${signature}`;
}

function verifyStartPayload(token) {
  try {
    const [encodedBody, signature] = String(token || "").split(".");
    if (!encodedBody || !signature) return { ok: false, reason: "invalid_format" };

    const expected = crypto
      .createHmac("sha256", linkSecret())
      .update(encodedBody)
      .digest("hex");
    if (signature !== expected) return { ok: false, reason: "invalid_signature" };

    const payload = JSON.parse(base64UrlDecode(encodedBody));
    if (!payload?.teacherUid) return { ok: false, reason: "missing_teacher_uid" };
    if (!payload?.exp || Date.now() > Number(payload.exp)) return { ok: false, reason: "expired" };

    return { ok: true, teacherUid: String(payload.teacherUid) };
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }
}

function resolveTeacherUidFromStartArg(startArg) {
  const verified = verifyStartPayload(startArg);
  if (verified.ok) return verified;

  const allowPlain = String(process.env.ALLOW_PLAIN_TEACHER_ID_START || "true").toLowerCase() !== "false";
  if (!allowPlain) return verified;

  const plain = String(startArg || "").trim();
  if (!/^[A-Za-z0-9_-]{8,}$/.test(plain)) return verified;
  return { ok: true, teacherUid: plain, plain: true };
}

function parseTimeToMinutes(timeStr) {
  const [hours, minutes] = String(timeStr || "00:00")
    .split(":")
    .map((x) => Number(x));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

function normalizeClassKey(input) {
  return String(input || "").trim();
}

function buildClassKeyFromRow(row) {
  const direct = normalizeClassKey(row?.classKey || row?.class || row?.className);
  if (direct) return direct;

  const grade = String(row?.grade || "").trim();
  const section = String(row?.section || "").trim();
  const track = String(row?.track || "").trim();
  if (!grade || !section) return "";
  return `${grade} / ${section}${track ? ` ${track}` : ""}`.trim();
}

function normalizeForSessionId(classKey) {
  return String(classKey || "")
    .replace(/\s+/g, "_")
    .replace(/\//g, "-")
    .replace(/[^\w-]/g, "");
}

function dayIndexFromEnglishWeekday(weekday) {
  if (weekday === "Sunday") return 0;
  if (weekday === "Monday") return 1;
  if (weekday === "Tuesday") return 2;
  if (weekday === "Wednesday") return 3;
  if (weekday === "Thursday") return 4;
  if (weekday === "Friday") return 5;
  if (weekday === "Saturday") return 6;
  return -1;
}

function weekdayMatchesToday(rawWeekday, todayWeekdayEnglish) {
  const raw = String(rawWeekday || "").trim();
  if (!raw) return false;
  if (raw.toLowerCase() === todayWeekdayEnglish.toLowerCase()) return true;

  const weekdayArToEn = {
    الأحد: "Sunday",
    الاحد: "Sunday",
    الاثنين: "Monday",
    الثلاثاء: "Tuesday",
    الأربعاء: "Wednesday",
    الاربعاء: "Wednesday",
    الخميس: "Thursday",
    الجمعة: "Friday",
    السبت: "Saturday",
  };
  if (weekdayArToEn[raw] === todayWeekdayEnglish) return true;

  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum >= 0 && asNum <= 6) {
    return asNum === dayIndexFromEnglishWeekday(todayWeekdayEnglish);
  }
  return false;
}

function kuwaitNowContext() {
  const now = new Date();
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KUWAIT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = dateParts.find((p) => p.type === "year")?.value || "0000";
  const month = dateParts.find((p) => p.type === "month")?.value || "00";
  const day = dateParts.find((p) => p.type === "day")?.value || "00";
  const dateISO = `${year}-${month}-${day}`;

  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone: KUWAIT_TIMEZONE,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const hours = Number(timeParts.find((p) => p.type === "hour")?.value || 0);
  const minutes = Number(timeParts.find((p) => p.type === "minute")?.value || 0);
  const nowMinutes = hours * 60 + minutes;

  const weekdayEnglish = new Intl.DateTimeFormat("en-US", {
    timeZone: KUWAIT_TIMEZONE,
    weekday: "long",
  }).format(now);
  const dayIndex = dayIndexFromEnglishWeekday(weekdayEnglish);

  return { dateISO, nowMinutes, weekdayEnglish, dayIndex };
}

function toTimeLabel(minutesFromMidnight) {
  const h = Math.floor(minutesFromMidnight / 60);
  const m = minutesFromMidnight % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function shortHash(input) {
  return crypto.createHash("sha1").update(String(input || "")).digest("hex").slice(0, 10);
}

async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN");
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Telegram API error: ${response.status} ${errorBody}`);
  }

  const body = await response.json();
  if (!body?.ok) {
    throw new Error(`Telegram API failed: ${JSON.stringify(body)}`);
  }
  return body;
}

async function getBotUsername() {
  if (process.env.TELEGRAM_BOT_USERNAME) {
    return process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, "");
  }
  if (botUsernameCache) return botUsernameCache;
  if (!TELEGRAM_BOT_TOKEN) return null;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const body = await response.json();
  if (!body?.ok || !body?.result?.username) return null;
  botUsernameCache = String(body.result.username);
  return botUsernameCache;
}

async function verifyFirebaseUser(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const idToken = authHeader.slice("Bearer ".length).trim();
  if (!idToken) return null;
  return admin.auth().verifyIdToken(idToken);
}

async function loadLessonTimes() {
  try {
    const lessonTimesDoc = await db.collection("settings").doc("lessonTimes").get();
    if (!lessonTimesDoc.exists) return DEFAULT_LESSON_TIMES.map((x) => ({ ...x }));
    const data = lessonTimesDoc.data() || {};
    if (!Array.isArray(data.times) || data.times.length !== 7) {
      return DEFAULT_LESSON_TIMES.map((x) => ({ ...x }));
    }

    return DEFAULT_LESSON_TIMES.map((fallback, i) => ({
      index: i + 1,
      label: fallback.label,
      start: String(data.times[i]?.start || fallback.start),
      end: String(data.times[i]?.end || fallback.end),
    }));
  } catch (error) {
    console.error("Failed to load lesson times:", error.message);
    return DEFAULT_LESSON_TIMES.map((x) => ({ ...x }));
  }
}

async function loadOverridesForDate(dateISO) {
  const addedByTeacher = new Map();
  const removedByTeacher = new Map();

  const snap = await db.collection("scheduleOverrides").where("date", "==", dateISO).get();
  snap.forEach((docSnap) => {
    const x = docSnap.data() || {};
    const lesson = Number(x.lesson);
    if (!Number.isFinite(lesson) || lesson < 1 || lesson > 7) return;
    const classKey = buildClassKeyFromRow(x);

    if (x.kind === "new" && x.newTeacherUid) {
      const uid = String(x.newTeacherUid);
      if (!addedByTeacher.has(uid)) addedByTeacher.set(uid, []);
      addedByTeacher.get(uid).push({ lesson, classKey });
    }
    if (x.kind === "original" && x.originalTeacherUid) {
      const uid = String(x.originalTeacherUid);
      if (!removedByTeacher.has(uid)) removedByTeacher.set(uid, new Set());
      removedByTeacher.get(uid).add(lesson);
    }
  });

  return { addedByTeacher, removedByTeacher };
}

async function loadCustomLessonsByTeacher(dayIndex, lessonTimes) {
  const out = new Map();
  if (dayIndex < 0) return out;

  const defaultByIndex = new Map(
    lessonTimes.map((x) => [
      x.index,
      {
        startMin: parseTimeToMinutes(x.start),
        endMin: parseTimeToMinutes(x.end),
      },
    ])
  );

  const snap = await db
    .collection("customDaySchedules")
    .where("dayIndex", "==", dayIndex)
    .get();

  snap.forEach((docSnap) => {
    const row = docSnap.data() || {};
    if (row.enabled !== true) return;
    if (row.deletedAt) return;

    const lessons = Array.isArray(row.lessons) ? row.lessons : [];
    const times = Array.isArray(row.times) ? row.times : [];
    const lessonCount = Math.min(7, Number(row.lessonCount) || lessons.length || 7);

    for (let i = 0; i < lessonCount; i += 1) {
      const lessonRow = lessons[i] || {};
      const teacherUid = String(lessonRow.teacherUid || "").trim();
      if (!teacherUid) continue;

      const classKey =
        normalizeClassKey(row.classKey) ||
        normalizeClassKey(lessonRow.classKey) ||
        buildClassKeyFromRow(row);
      if (!classKey) continue;

      const fallback = defaultByIndex.get(i + 1) || { startMin: 0, endMin: 0 };
      const customTime = times[i] || {};
      const startMin = parseTimeToMinutes(customTime.start || toTimeLabel(fallback.startMin));
      const endMin = parseTimeToMinutes(customTime.end || toTimeLabel(fallback.endMin));

      if (!out.has(teacherUid)) out.set(teacherUid, []);
      out.get(teacherUid).push({
        lesson: i + 1,
        classKey,
        startMin,
        endMin,
        source: "custom",
      });
    }
  });

  return out;
}

async function buildTeacherLessonsForToday({
  teacherUid,
  dateISO,
  weekdayEnglish,
  lessonTimes,
  overrides,
  customLessonsByTeacher,
}) {
  const byKey = new Map();
  const lessonTimeByIndex = new Map(
    lessonTimes.map((x) => [
      x.index,
      {
        startMin: parseTimeToMinutes(x.start),
        endMin: parseTimeToMinutes(x.end),
      },
    ])
  );

  const schedulesSnap = await db.collection("schedules").where("teacherUid", "==", teacherUid).get();
  schedulesSnap.forEach((docSnap) => {
    const row = docSnap.data() || {};
    const lesson = Number(row.lesson ?? row.lessonIndex ?? row.lessonNumber);
    if (!Number.isFinite(lesson) || lesson < 1 || lesson > 7) return;

    const rowDate = String(row.date || "").trim();
    const rowWeekday = row.weekday ?? row.day ?? row.dow ?? row.dayIndex ?? "";
    const appliesToday = rowDate === dateISO || weekdayMatchesToday(rowWeekday, weekdayEnglish);
    if (!appliesToday) return;

    const classKey = buildClassKeyFromRow(row);
    if (!classKey) return;

    const fallback = lessonTimeByIndex.get(lesson) || { startMin: 0, endMin: 0 };
    const key = `${lesson}|${normalizeClassKey(classKey)}`;
    byKey.set(key, {
      lesson,
      classKey,
      startMin: fallback.startMin,
      endMin: fallback.endMin,
      source: "schedule",
    });
  });

  const removed = overrides.removedByTeacher.get(teacherUid) || new Set();
  if (removed.size > 0) {
    for (const [key, item] of byKey.entries()) {
      if (removed.has(item.lesson)) byKey.delete(key);
    }
  }

  const added = overrides.addedByTeacher.get(teacherUid) || [];
  for (const item of added) {
    if (!item.classKey) continue;
    const fallback = lessonTimeByIndex.get(item.lesson) || { startMin: 0, endMin: 0 };
    const key = `${item.lesson}|${normalizeClassKey(item.classKey)}`;
    byKey.set(key, {
      lesson: item.lesson,
      classKey: item.classKey,
      startMin: fallback.startMin,
      endMin: fallback.endMin,
      source: "override",
    });
  }

  const customItems = customLessonsByTeacher.get(teacherUid) || [];
  for (const item of customItems) {
    const key = `${item.lesson}|${normalizeClassKey(item.classKey)}`;
    byKey.set(key, { ...item });
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.startMin === b.startMin) return a.lesson - b.lesson;
    return a.startMin - b.startMin;
  });
}

async function hasAttendanceSession({ dateISO, lesson, classKey }) {
  const sessionId = `${dateISO}_${lesson}_${normalizeForSessionId(classKey)}`;
  const snap = await db.collection("attendanceSessions").doc(sessionId).get();
  return snap.exists;
}

function reminderDocRef({ dateISO, teacherUid, lesson, classKey, type }) {
  const id = `${dateISO}_${type}_${teacherUid}_${lesson}_${shortHash(classKey)}`;
  return db.collection("telegramNotificationLog").doc(id);
}

async function claimReminderSend(meta) {
  const ref = reminderDocRef(meta);
  try {
    await ref.create({
      ...meta,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { claimed: true, ref };
  } catch (error) {
    if (error?.code === 6 || /already exists/i.test(String(error?.message || ""))) {
      return { claimed: false, ref };
    }
    throw error;
  }
}

function lessonReminderText({ teacherName, lesson, classKey, startMin }) {
  const header = teacherName ? `${teacherName},` : "";
  const withHeader = header ? `${header}\n` : "";
  return `${withHeader}You have lesson ${lesson} in ${LESSON_REMINDER_LEAD_MINUTES} mins.\nClass: ${classKey}\nTime: ${toTimeLabel(startMin)}`;
}

function attendanceReminderText({ teacherName, lesson, classKey }) {
  const header = teacherName ? `${teacherName},\n` : "";
  return `${header}Reminder to take attendance for ${lesson}.\nClass: ${classKey}`;
}

function missedAttendanceText({ teacherName, lesson, classKey }) {
  const header = teacherName ? `${teacherName},\n` : "";
  return `${header}You did not take attendance for ${lesson}.\nClass: ${classKey}`;
}

async function loadConnectedTeachersForSweep() {
  const out = new Map();

  try {
    const teachersSnap = await db.collection("teachers").where("telegramConnected", "==", true).get();
    teachersSnap.forEach((docSnap) => {
      const teacherUid = docSnap.id;
      const data = docSnap.data() || {};
      const chatId = String(data.telegramChatId || "").trim();
      if (!chatId) return;
      out.set(teacherUid, {
        teacherUid,
        teacherName: String(data.name || "").trim(),
        chatId,
      });
    });
  } catch (error) {
    console.error("Failed to load connected teachers from Firestore:", error.message);
  }

  for (const [teacherUid, chatIdRaw] of Object.entries(users)) {
    const chatId = String(chatIdRaw || "").trim();
    if (!chatId) continue;
    if (out.has(teacherUid)) continue;
    out.set(teacherUid, {
      teacherUid,
      teacherName: "",
      chatId,
    });
  }

  return Array.from(out.values());
}

async function runReminderSweep() {
  if (reminderSweepRunning) return;
  reminderSweepRunning = true;

  try {
    if (!TELEGRAM_BOT_TOKEN) return;

    const now = kuwaitNowContext();
    const lessonTimes = await loadLessonTimes();
    const overrides = await loadOverridesForDate(now.dateISO);
    const customLessonsByTeacher = await loadCustomLessonsByTeacher(now.dayIndex, lessonTimes);

    const connectedTeachers = await loadConnectedTeachersForSweep();
    if (!connectedTeachers.length) return;

    for (const teacherRow of connectedTeachers) {
      const teacherUid = teacherRow.teacherUid;
      const chatId = String(teacherRow.chatId || "").trim();
      if (!chatId) continue;

      const lessons = await buildTeacherLessonsForToday({
        teacherUid,
        dateISO: now.dateISO,
        weekdayEnglish: now.weekdayEnglish,
        lessonTimes,
        overrides,
        customLessonsByTeacher,
      });
      if (!lessons.length) continue;

      const teacherName = String(teacherRow.teacherName || "").trim();

      for (const item of lessons) {
        const lessonLabel = DEFAULT_LESSON_TIMES[item.lesson - 1]?.label || `الحصة ${item.lesson}`;

        const inLessonReminderWindow =
          now.nowMinutes >= item.startMin - LESSON_REMINDER_LEAD_MINUTES &&
          now.nowMinutes < item.startMin;
        if (inLessonReminderWindow) {
          const meta = {
            dateISO: now.dateISO,
            teacherUid,
            lesson: item.lesson,
            classKey: item.classKey,
            type: "lesson_start",
          };
          const claim = await claimReminderSend(meta);
          if (claim.claimed) {
            try {
              await sendTelegramMessage(
                chatId,
                lessonReminderText({
                  teacherName,
                  lesson: lessonLabel,
                  classKey: item.classKey,
                  startMin: item.startMin,
                })
              );
            } catch (error) {
              console.error("Lesson reminder failed:", error.message);
              await claim.ref.delete().catch(() => {});
            }
          }
        }

        const attendanceReminderStart = item.startMin + ATTENDANCE_REMINDER_DELAY_MINUTES;
        const attendanceReminderEnd = item.endMin + 15;
        const inAttendanceReminderWindow =
          now.nowMinutes >= attendanceReminderStart && now.nowMinutes <= attendanceReminderEnd;

        const missedReminderStart = item.endMin + 16;
        const missedReminderEnd = item.endMin + 180;
        const inMissedAttendanceWindow =
          now.nowMinutes >= missedReminderStart && now.nowMinutes <= missedReminderEnd;

        if (!inAttendanceReminderWindow && !inMissedAttendanceWindow) continue;

        const sessionExists = await hasAttendanceSession({
          dateISO: now.dateISO,
          lesson: item.lesson,
          classKey: item.classKey,
        });
        if (sessionExists) continue;

        if (inAttendanceReminderWindow) {
          const lateMeta = {
            dateISO: now.dateISO,
            teacherUid,
            lesson: item.lesson,
            classKey: item.classKey,
            type: "attendance_late",
          };
          const lateClaim = await claimReminderSend(lateMeta);
          if (lateClaim.claimed) {
            try {
              await sendTelegramMessage(
                chatId,
                attendanceReminderText({
                  teacherName,
                  lesson: lessonLabel,
                  classKey: item.classKey,
                })
              );
            } catch (error) {
              console.error("Attendance reminder failed:", error.message);
              await lateClaim.ref.delete().catch(() => {});
            }
          }
        }

        if (inMissedAttendanceWindow) {
          const missedMeta = {
            dateISO: now.dateISO,
            teacherUid,
            lesson: item.lesson,
            classKey: item.classKey,
            type: "attendance_missed",
          };
          const missedClaim = await claimReminderSend(missedMeta);
          if (missedClaim.claimed) {
            try {
              await sendTelegramMessage(
                chatId,
                missedAttendanceText({
                  teacherName,
                  lesson: lessonLabel,
                  classKey: item.classKey,
                })
              );
            } catch (error) {
              console.error("Missed attendance reminder failed:", error.message);
              await missedClaim.ref.delete().catch(() => {});
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("Reminder sweep error:", error.message);
  } finally {
    reminderSweepRunning = false;
  }
}

app.get("/api/telegram/connect-link", async (req, res) => {
  const userIdRaw = req.query.userId;
  const userId = String(userIdRaw || "teacher123").trim() || "teacher123";
  const url = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${encodeURIComponent(`connect_${userId}`)}`;

  console.log(`[telegram] connect-link generated for userId=${userId}`);
  return res.json({ url });
});

app.post("/api/telegram/disconnect", async (req, res) => {
  const userId = String(req.body?.userId || req.query?.userId || "teacher123").trim() || "teacher123";
  delete users[userId];
  try {
    await db.collection("teachers").doc(userId).set(
      {
        telegramConnected: false,
        telegramChatId: null,
        telegram: {
          connected: false,
          chatId: null,
          disconnectedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
  } catch (error) {
    console.error(`[telegram] disconnect Firestore update failed for userId=${userId}:`, error.message);
  }
  console.log(`[telegram] disconnected mapping for userId=${userId}`);
  return res.json({ ok: true });
});

app.get("/api/telegram/test-message", async (req, res) => {
  const userId = String(req.query?.userId || "teacher123").trim() || "teacher123";
  const memoryChatId = String(users[userId] || "").trim();
  let chatId = memoryChatId;

  if (!chatId) {
    try {
      const teacherSnap = await db.collection("teachers").doc(userId).get();
      if (teacherSnap.exists) {
        const teacherData = teacherSnap.data() || {};
        chatId = String(teacherData.telegramChatId || "").trim();
      }
    } catch (error) {
      console.error(`[telegram] test-message Firestore lookup failed for userId=${userId}:`, error.message);
    }
  }

  if (!chatId) {
    return res.status(404).json({
      ok: false,
      error: "chat_not_found",
      hint: "Reconnect Telegram first from the app settings.",
    });
  }

  try {
    await sendTelegramMessage(chatId, "Test message: Telegram is connected and ready.");
    return res.json({ ok: true, userId, chatId });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message, userId, chatId });
  }
});

app.post("/api/telegram-webhook", async (req, res) => {
  const update = req.body || {};
  const chatId = update?.message?.chat?.id;
  const text = String(update?.message?.text || "").trim();

  if (chatId && text.startsWith("/start")) {
    console.log("chat_id:", chatId);
    console.log("full text:", text);

    const maybePayload = text.split(/\s+/)[1] || "";

    const connectMatch = maybePayload.match(/^connect_(.+)$/);
    if (connectMatch) {
      const userId = String(connectMatch[1] || "").trim();
      if (userId) {
        users[userId] = String(chatId);
        try {
          await db.collection("teachers").doc(userId).set(
            {
              telegramConnected: true,
              telegramChatId: String(chatId),
              telegram: {
                connected: true,
                chatId: String(chatId),
                linkedAt: admin.firestore.FieldValue.serverTimestamp(),
                linkedVia: "connect_payload",
              },
            },
            { merge: true }
          );
        } catch (error) {
          console.error(`[telegram] Firestore save failed for userId=${userId}:`, error.message);
        }
        console.log(`[telegram] Connected user ${userId} -> chat_id ${chatId}`);
        try {
          await sendTelegramMessage(chatId, `Connected successfully for user: ${userId}.`);
        } catch (error) {
          console.error("Webhook connect_ response failed:", error.message);
        }
        return res.sendStatus(200);
      }
    }

    if (!maybePayload) {
      try {
        await sendTelegramMessage(chatId, "Welcome! Open the app and tap Connect Telegram first.");
      } catch (error) {
        console.error("Webhook /start basic response failed:", error.message);
      }
      return res.sendStatus(200);
    }

    const verified = resolveTeacherUidFromStartArg(maybePayload);
    if (!verified.ok) {
      try {
        await sendTelegramMessage(chatId, "Invalid or expired link. Please reconnect from the app.");
      } catch (error) {
        console.error("Webhook invalid payload response failed:", error.message);
      }
      return res.sendStatus(200);
    }

    try {
      await db.collection("teachers").doc(verified.teacherUid).set(
        {
          telegramConnected: true,
          telegramChatId: String(chatId),
          telegram: {
            connected: true,
            chatId: String(chatId),
            linkedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastStartText: text,
          },
        },
        { merge: true }
      );

      if (verified.plain) {
        await sendTelegramMessage(
          chatId,
          "Connected with teacher ID. For better security, reconnect from the app button next time."
        );
      } else {
        await sendTelegramMessage(chatId, "Welcome! Telegram notifications are now connected.");
      }
    } catch (error) {
      console.error("Failed to link Telegram chat:", error.message);
      try {
        await sendTelegramMessage(chatId, "Link failed on server. Please try again from the app.");
      } catch (nestedError) {
        console.error("Failed to send link error to Telegram:", nestedError.message);
      }
    }
  }

  return res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("Telegram notification server is running.");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn("Missing TELEGRAM_BOT_TOKEN. Webhook replies and reminders are disabled.");
  }

  setTimeout(() => {
    runReminderSweep().catch(() => {});
  }, 5000);

  setInterval(() => {
    runReminderSweep().catch(() => {});
  }, 60 * 1000);
});

