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
  export GOOGLE_CLOUD_PROJECT=your-firebase-project-id
  # or GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/service-account.json

  How to set webhook:
  https://api.telegram.org/botYOUR_TOKEN/setWebhook?url=YOUR_DOMAIN/api/telegram-webhook
*/

const crypto = require("crypto");
const express = require("express");
const admin = require("firebase-admin");

const PORT = Number(process.env.PORT || 3000);
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_BOT_USERNAME = String(process.env.TELEGRAM_BOT_USERNAME || "").trim();
const KUWAIT_TIMEZONE = "Asia/Kuwait";
const LESSON_REMINDER_LEAD_MINUTES = 5;
const REMINDER_CLAIM_STALE_MINUTES = 3;
const TELEGRAM_REQUEST_TIMEOUT_MS = Math.max(
  3000,
  Number(process.env.TELEGRAM_REQUEST_TIMEOUT_MS || 15000)
);
const TELEGRAM_REQUEST_RETRIES = Math.max(
  0,
  Number(process.env.TELEGRAM_REQUEST_RETRIES || 2)
);
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
// Browser calls are only ever made from the deployed site (plus Netlify's
// per-deploy preview URLs). Non-browser requests (Telegram webhook, curl,
// uptime pings) send no Origin header and are unaffected by CORS.
const ALLOWED_ORIGIN_PATTERN = /^https:\/\/([a-z0-9-]+--)?abrabsence\.netlify\.app$/;
app.use((req, res, next) => {
  const requestedHeaders = String(req.headers["access-control-request-headers"] || "").trim();
  const allowHeaders = requestedHeaders || "Content-Type, Authorization";
  const origin = String(req.headers.origin || "").trim();
  if (origin && ALLOWED_ORIGIN_PATTERN.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin, Access-Control-Request-Headers");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", allowHeaders);
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  return next();
});
app.use(express.json({ limit: "256kb" }));
app.use((error, req, res, next) => {
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ ok: false, error: "invalid_json" });
  }
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ ok: false, error: "payload_too_large" });
  }
  return next(error);
});

const firebaseState = initFirebaseAdmin();
const db = firebaseState.db;
let reminderSweepRunning = false;
let botUsernameCache = null;
const users = Object.create(null); // in-memory mapping: USER_ID -> chat_id

function initFirebaseAdmin() {
  const state = {
    ready: false,
    db: null,
    projectId: process.env.GOOGLE_CLOUD_PROJECT || null,
    credentialSource: null,
  };

  try {
    if (admin.apps.length) {
      state.db = admin.firestore();
      state.ready = true;
      console.log(`[firebase] already initialized projectId=${state.projectId || "unknown"}`);
      return state;
    }

    const serviceAccountJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
    if (serviceAccountJson) {
      const serviceAccount = JSON.parse(serviceAccountJson);
      if (typeof serviceAccount.private_key === "string") {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
      }
      const resolvedProjectId = process.env.GOOGLE_CLOUD_PROJECT || serviceAccount.project_id || null;
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.GOOGLE_CLOUD_PROJECT || serviceAccount.project_id,
      });
      state.projectId = resolvedProjectId;
      state.credentialSource = "service_account_json";
    } else {
      // Fallback path for GOOGLE_APPLICATION_CREDENTIALS or in-cloud default credentials.
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: process.env.GOOGLE_CLOUD_PROJECT || undefined,
      });
      state.projectId =
        process.env.GOOGLE_CLOUD_PROJECT ||
        admin.app().options.projectId ||
        process.env.GCLOUD_PROJECT ||
        null;
      state.credentialSource = "application_default";
    }

    state.db = admin.firestore();
    state.ready = true;
    console.log(
      `[firebase] initialized projectId=${state.projectId || "unknown"} credential=${state.credentialSource || "unknown"}`
    );
    return state;
  } catch (error) {
    console.warn("[firebase] missing or invalid credentials");
    console.warn(`[firebase] init error: ${error.message}`);
    return state;
  }
}

function isFirebaseReady() {
  return Boolean(firebaseState.ready && db);
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

function normalizeForSafeSessionId(classKey) {
  return String(classKey || "")
    .replace(/[\/\\#?\[\]\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function buildAttendanceSessionCandidateIds({ dateISO, lesson, classKey }) {
  const prefix = `${dateISO}_${lesson}_`;
  const legacyId = `${prefix}${normalizeForSessionId(classKey)}`;
  const safeId = `${prefix}${normalizeForSafeSessionId(classKey)}`;
  if (safeId && safeId !== legacyId) {
    return [legacyId, safeId];
  }
  return [legacyId];
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

function toArabicDigits(value) {
  return String(value ?? "").replace(/\d/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]);
}

function timestampToMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value._seconds === "number") return value._seconds * 1000;
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function shortHash(input) {
  return crypto.createHash("sha1").update(String(input || "")).digest("hex").slice(0, 10);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(options || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isRetryableTelegramStatus(status) {
  return status === 429 || status >= 500;
}

function parseRetryAfterMs(payload) {
  const retryAfterSeconds = Number(payload?.parameters?.retry_after);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }
  return 0;
}

async function telegramApiRequest(method, payload) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN");
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;
  let attempt = 0;
  let lastError = null;

  while (attempt <= TELEGRAM_REQUEST_RETRIES) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload || {}),
        },
        TELEGRAM_REQUEST_TIMEOUT_MS
      );

      const rawBody = await response.text();
      let parsedBody = null;
      try {
        parsedBody = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        parsedBody = null;
      }

      const ok = Boolean(response.ok && parsedBody?.ok);
      if (ok) return parsedBody;

      const desc = String(parsedBody?.description || rawBody || "").trim();
      const retryable = isRetryableTelegramStatus(response.status);
      if (retryable && attempt < TELEGRAM_REQUEST_RETRIES) {
        const retryAfterMs = parseRetryAfterMs(parsedBody);
        const backoffMs = retryAfterMs || Math.min(1000 * 2 ** attempt, 8000);
        await delay(backoffMs);
        attempt += 1;
        continue;
      }

      const error = new Error(
        `Telegram API error method=${method} status=${response.status} description=${desc || "unknown_error"}`
      );
      error.code = "telegram_api_error";
      error.status = response.status;
      error.telegramBody = parsedBody;
      throw error;
    } catch (error) {
      lastError = error;
      const isAbort = error?.name === "AbortError";
      const networkLike = /fetch failed|network|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket/i.test(
        String(error?.message || "")
      );
      if ((isAbort || networkLike) && attempt < TELEGRAM_REQUEST_RETRIES) {
        const backoffMs = Math.min(1000 * 2 ** attempt, 8000);
        await delay(backoffMs);
        attempt += 1;
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error(`Telegram API request failed method=${method}`);
}

async function sendTelegramMessage(chatId, text) {
  return telegramApiRequest("sendMessage", {
    chat_id: String(chatId),
    text: String(text ?? ""),
  });
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
  if (!isFirebaseReady()) return null;
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const idToken = authHeader.slice("Bearer ".length).trim();
  if (!idToken) return null;
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch (error) {
    console.error(`[firebase] verifyIdToken failed: ${error.message}`);
    return null;
  }
}

// Schools can change how many lessons are in a day (settings/lessonTimes'
// `times` array length is the source of truth) — anything beyond
// DEFAULT_LESSON_TIMES' 7 curated ordinal names just gets a numbered label.
function lessonLabelFor(i) {
  return DEFAULT_LESSON_TIMES[i]?.label || `الحصة ${toArabicDigits(i + 1)}`;
}

async function loadLessonTimes() {
  if (!isFirebaseReady()) {
    console.warn("[firebase] loadLessonTimes skipped: Firebase unavailable");
    return DEFAULT_LESSON_TIMES.map((x) => ({ ...x }));
  }
  try {
    const lessonTimesDoc = await db.collection("settings").doc("lessonTimes").get();
    if (!lessonTimesDoc.exists) return DEFAULT_LESSON_TIMES.map((x) => ({ ...x }));
    const data = lessonTimesDoc.data() || {};
    if (!Array.isArray(data.times) || data.times.length < 1 || data.times.length > 12) {
      return DEFAULT_LESSON_TIMES.map((x) => ({ ...x }));
    }

    return data.times.map((t, i) => ({
      index: i + 1,
      label: lessonLabelFor(i),
      start: String(t?.start || DEFAULT_LESSON_TIMES[i]?.start || "00:00"),
      end: String(t?.end || DEFAULT_LESSON_TIMES[i]?.end || "00:00"),
    }));
  } catch (error) {
    console.error(`[firebase] loadLessonTimes failed: ${error.message}`);
    return DEFAULT_LESSON_TIMES.map((x) => ({ ...x }));
  }
}

async function loadOverridesForDate(dateISO) {
  // For each (teacherUid, lesson), keep whichever override doc is more
  // recently created — this teacher gaining the lesson, or losing it —
  // keyed by `${uid}|${lesson}`. scheduleOverrides docs carry no "kind"
  // field (confirmed against both places that create them:
  // Teachers/teacherschedule.html's reqAccept and depHead/schedual.html's
  // createOverridesInTransaction), so a doc's newTeacherUid/
  // originalTeacherUid are read directly instead. Resolving by recency
  // (rather than "removed always wins" or "added always wins") is what
  // makes a swap that's later reversed by a second swapRequest — whose
  // acceptance creates another pair of override docs rather than
  // canceling the first pair — settle on the correct final lesson instead
  // of reminding a teacher about both the old and new one.
  const resolved = new Map(); // `${uid}|${lesson}` -> { added, classKey, ms }

  if (!isFirebaseReady()) {
    console.warn("[firebase] loadOverridesForDate skipped: Firebase unavailable");
    return resolved;
  }

  try {
    const snap = await db.collection("scheduleOverrides").where("date", "==", dateISO).get();
    const msOf = (x) => (x?.createdAt && typeof x.createdAt.toDate === "function") ? x.createdAt.toDate().getTime() : 0;
    const consider = (uid, lesson, added, classKey, ms) => {
      const key = `${uid}|${lesson}`;
      const existing = resolved.get(key);
      if (!existing || ms >= existing.ms) {
        resolved.set(key, { added, classKey, ms });
      }
    };
    snap.forEach((docSnap) => {
      const x = docSnap.data() || {};
      const lesson = Number(x.lesson);
      if (!Number.isFinite(lesson) || lesson < 1 || lesson > 7) return;
      const classKey = buildClassKeyFromRow(x);
      const ms = msOf(x);
      if (x.newTeacherUid) consider(String(x.newTeacherUid), lesson, true, classKey, ms);
      if (x.originalTeacherUid) consider(String(x.originalTeacherUid), lesson, false, classKey, ms);
    });
  } catch (error) {
    console.error(`[firebase] loadOverridesForDate failed date=${dateISO}: ${error.message}`);
  }

  return resolved;
}

async function loadCustomLessonsByTeacher(dayIndex, lessonTimes) {
  const out = new Map();
  if (dayIndex < 0) return out;
  if (!isFirebaseReady()) {
    console.warn("[firebase] loadCustomLessonsByTeacher skipped: Firebase unavailable");
    return out;
  }

  const defaultByIndex = new Map(
    lessonTimes.map((x) => [
      x.index,
      {
        startMin: parseTimeToMinutes(x.start),
        endMin: parseTimeToMinutes(x.end),
      },
    ])
  );

  try {
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
  } catch (error) {
    console.error(`[firebase] loadCustomLessonsByTeacher failed dayIndex=${dayIndex}: ${error.message}`);
  }

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

  if (!isFirebaseReady()) {
    console.warn(
      `[firebase] buildTeacherLessonsForToday schedules skipped userId=${teacherUid}: Firebase unavailable`
    );
  } else {
    try {
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
    } catch (error) {
      console.error(
        `[firebase] buildTeacherLessonsForToday failed userId=${teacherUid} date=${dateISO}: ${error.message}`
      );
    }
  }

  // `overrides` (from loadOverridesForDate) is pre-resolved per
  // (teacherUid, lesson) to whichever override doc is more recent, so a
  // single pass here is enough — no separate "remove everything, then add
  // everything" ordering that would let a stale removal or addition win
  // just because it was processed later.
  for (const lessonIndex of lessonTimeByIndex.keys()) {
    const decision = overrides.get(`${teacherUid}|${lessonIndex}`);
    if (!decision) continue;
    if (decision.added) {
      if (!decision.classKey) continue;
      const fallback = lessonTimeByIndex.get(lessonIndex) || { startMin: 0, endMin: 0 };
      const key = `${lessonIndex}|${normalizeClassKey(decision.classKey)}`;
      byKey.set(key, {
        lesson: lessonIndex,
        classKey: decision.classKey,
        startMin: fallback.startMin,
        endMin: fallback.endMin,
        source: "override",
      });
    } else {
      for (const [key, item] of byKey.entries()) {
        if (item.lesson === lessonIndex) byKey.delete(key);
      }
    }
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

function parseClassKeyParts(classKey) {
  const raw = String(classKey || "").trim();
  const match = raw.match(/^(\d+)\s*\/\s*(\d+)(?:\s+(.+))?$/);
  if (!match) return null;
  return {
    grade: String(match[1] || "").trim(),
    section: String(match[2] || "").trim(),
    track: String(match[3] || "").trim(),
  };
}

function normalizeTrackValue(value) {
  const raw = String(value || "")
    .trim()
    .replace(/^_+$/g, "");
  return raw;
}

function scheduleRowAppliesToday(row, dateISO, weekdayEnglish) {
  const rowDate = String(row?.date || "").trim();
  if (rowDate && rowDate === dateISO) return true;
  const rowWeekday = row?.weekday ?? row?.day ?? row?.dow ?? row?.dayIndex ?? "";
  return weekdayMatchesToday(rowWeekday, weekdayEnglish);
}

function getCurrentLessonWindow(nowMinutes, lessonTimes) {
  for (const slot of lessonTimes) {
    const lesson = Number(slot?.index);
    if (!Number.isFinite(lesson)) continue;
    const startMin = parseTimeToMinutes(slot?.start);
    const endMin = parseTimeToMinutes(slot?.end);
    if (nowMinutes >= startMin && nowMinutes <= endMin) {
      return {
        lesson,
        startMin,
        endMin,
        start: toTimeLabel(startMin),
        end: toTimeLabel(endMin),
        lessonLabel: DEFAULT_LESSON_TIMES[lesson - 1]?.label || `الحصة ${toArabicDigits(lesson)}`,
      };
    }
  }
  return null;
}

function rowMatchesClass(row, classKey, classParts) {
  const normalizedTarget = normalizeClassKey(classKey);
  const rowClassKey = normalizeClassKey(buildClassKeyFromRow(row));
  if (rowClassKey && rowClassKey === normalizedTarget) return true;

  if (!classParts) return false;
  const rowGrade = String(row?.grade || "").trim();
  const rowSection = String(row?.section || "").trim();
  if (!rowGrade || !rowSection) return false;
  if (rowGrade !== classParts.grade || rowSection !== classParts.section) return false;
  const rowTrack = normalizeTrackValue(row?.track ?? row?.trackKey ?? "");
  return rowTrack === normalizeTrackValue(classParts.track);
}

async function resolveTeacherTelegramTarget(teacherUid, teacherNameHint = "") {
  const uid = String(teacherUid || "").trim();
  if (!uid) {
    return { teacherUid: "", teacherName: "", chatId: "" };
  }

  const memoryChatId = String(users[uid] || "").trim();
  let teacherName = String(teacherNameHint || "").trim();
  let chatId = memoryChatId;

  if (isFirebaseReady()) {
    try {
      const snap = await db.collection("teachers").doc(uid).get();
      if (snap.exists) {
        const data = snap.data() || {};
        if (!teacherName) teacherName = String(data.name || "").trim();
        if (!chatId) chatId = String(data.telegramChatId || "").trim();
      }
    } catch (error) {
      console.error(`[telegram] resolveTeacherTelegramTarget failed userId=${uid}: ${error.message}`);
    }
  }

  return {
    teacherUid: uid,
    teacherName,
    chatId,
  };
}

// Best-effort — a grade with no supervisor yet (or one not connected to
// Telegram) shouldn't fail the request; the class teacher is still the
// primary, required recipient. Never throws.
async function resolveGradeSupervisorTargets(grade) {
  const normalizedGrade = String(grade || "").trim();
  if (!isFirebaseReady() || !normalizedGrade) return [];
  try {
    const snap = await db
      .collection("teachers")
      .where("isSupervisor", "==", true)
      .where("supervisorGrade", "==", normalizedGrade)
      .get();
    const targets = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const chatId = String(data.telegramChatId || "").trim();
      if (!chatId) return;
      targets.push({
        teacherUid: docSnap.id,
        teacherName: String(data.name || "").trim(),
        chatId,
      });
    });
    return targets;
  } catch (error) {
    console.error(`[telegram] resolveGradeSupervisorTargets failed grade=${normalizedGrade}: ${error.message}`);
    return [];
  }
}

async function resolveClassLiveContext({ classKey, now, lessonTimes }) {
  const normalizedClassKey = normalizeClassKey(classKey);
  const classParts = parseClassKeyParts(normalizedClassKey);
  const lessonWindow = getCurrentLessonWindow(now.nowMinutes, lessonTimes);

  if (!lessonWindow) {
    return {
      classKey: normalizedClassKey,
      inLesson: false,
      now: {
        dateISO: now.dateISO,
        weekdayEnglish: now.weekdayEnglish,
        nowMinutes: now.nowMinutes,
        nowTime: toTimeLabel(now.nowMinutes),
      },
      lesson: null,
      teacher: null,
    };
  }

  let teacherUid = "";
  let teacherName = "";
  let subject = "";
  let source = "schedule";

  if (isFirebaseReady()) {
    try {
      const customSnap = await db
        .collection("customDaySchedules")
        .where("classKey", "==", normalizedClassKey)
        .where("dayIndex", "==", now.dayIndex)
        .get();
      customSnap.forEach((docSnap) => {
        if (teacherUid) return;
        const row = docSnap.data() || {};
        if (row.enabled !== true || row.deletedAt) return;
        const lessons = Array.isArray(row.lessons) ? row.lessons : [];
        const lessonRow = lessons[lessonWindow.lesson - 1] || {};
        const uid = String(lessonRow.teacherUid || "").trim();
        if (!uid) return;
        teacherUid = uid;
        teacherName = String(lessonRow.teacherName || "").trim();
        subject = String(lessonRow.subject || "").trim();
        source = "custom";
      });
    } catch (error) {
      console.error(
        `[firebase] resolveClassLiveContext customDaySchedules failed classKey=${normalizedClassKey}: ${error.message}`
      );
    }

    if (!teacherUid) {
      try {
        const overrideSnap = await db.collection("scheduleOverrides").where("date", "==", now.dateISO).get();
        overrideSnap.forEach((docSnap) => {
          if (teacherUid) return;
          const row = docSnap.data() || {};
          const lesson = Number(row.lesson);
          if (!Number.isFinite(lesson) || lesson !== lessonWindow.lesson) return;
          if (!rowMatchesClass(row, normalizedClassKey, classParts)) return;
          if (row.kind !== "new") return;
          const uid = String(row.newTeacherUid || "").trim();
          if (!uid) return;
          teacherUid = uid;
          teacherName = String(row.newTeacherName || "").trim();
          source = "override";
        });
      } catch (error) {
        console.error(
          `[firebase] resolveClassLiveContext scheduleOverrides failed classKey=${normalizedClassKey}: ${error.message}`
        );
      }
    }

    if (!teacherUid) {
      const candidates = [];
      try {
        const classKeySnap = await db.collection("schedules").where("classKey", "==", normalizedClassKey).get();
        classKeySnap.forEach((docSnap) => candidates.push(docSnap.data() || {}));
      } catch (error) {
        console.error(
          `[firebase] resolveClassLiveContext schedules classKey query failed classKey=${normalizedClassKey}: ${error.message}`
        );
      }

      if (candidates.length === 0 && classParts) {
        try {
          const gradeSectionSnap = await db
            .collection("schedules")
            .where("grade", "==", classParts.grade)
            .where("section", "==", classParts.section)
            .get();
          gradeSectionSnap.forEach((docSnap) => candidates.push(docSnap.data() || {}));
        } catch (error) {
          console.error(
            `[firebase] resolveClassLiveContext schedules grade/section query failed classKey=${normalizedClassKey}: ${error.message}`
          );
        }
      }

      for (const row of candidates) {
        if (!rowMatchesClass(row, normalizedClassKey, classParts)) continue;
        if (!scheduleRowAppliesToday(row, now.dateISO, now.weekdayEnglish)) continue;
        const lesson = Number(row.lesson ?? row.lessonIndex ?? row.lessonNumber);
        if (!Number.isFinite(lesson) || lesson !== lessonWindow.lesson) continue;
        const uid = String(row.teacherUid || "").trim();
        if (!uid) continue;
        teacherUid = uid;
        teacherName = String(row.teacherName || "").trim();
        subject = String(row.subject || "").trim();
        source = "schedule";
        break;
      }
    }
  } else {
    console.warn(`[firebase] resolveClassLiveContext skipped class lookup classKey=${normalizedClassKey}: Firebase unavailable`);
  }

  let teacher = null;
  if (teacherUid) {
    const target = await resolveTeacherTelegramTarget(teacherUid, teacherName);
    teacher = {
      teacherUid: target.teacherUid,
      teacherName: target.teacherName || teacherName || "",
      chatId: target.chatId || null,
      connected: Boolean(target.chatId),
    };
  }

  return {
    classKey: normalizedClassKey,
    inLesson: true,
    now: {
      dateISO: now.dateISO,
      weekdayEnglish: now.weekdayEnglish,
      nowMinutes: now.nowMinutes,
      nowTime: toTimeLabel(now.nowMinutes),
    },
    lesson: {
      lesson: lessonWindow.lesson,
      lessonLabel: lessonWindow.lessonLabel,
      start: lessonWindow.start,
      end: lessonWindow.end,
      subject,
      source,
    },
    teacher,
  };
}

async function requireAdminFromRequest(req, res) {
  if (!isFirebaseReady()) {
    res.status(503).json({ ok: false, error: "firebase_unavailable" });
    return null;
  }

  const decoded = await verifyFirebaseUser(req);
  if (!decoded?.uid) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return null;
  }

  try {
    const teacherSnap = await db.collection("teachers").doc(decoded.uid).get();
    const teacherData = teacherSnap.exists ? teacherSnap.data() || {} : {};
    const role = String(teacherData.role || "").toLowerCase();
    const isAdmin = role === "admin" || role === "superadmin" || decoded.admin === true;
    if (!isAdmin) {
      res.status(403).json({ ok: false, error: "forbidden" });
      return null;
    }
    return {
      uid: decoded.uid,
      name: String(teacherData.name || "").trim(),
      role,
    };
  } catch (error) {
    console.error(`[firebase] requireAdminFromRequest failed userId=${decoded.uid}: ${error.message}`);
    res.status(500).json({ ok: false, error: "admin_check_failed" });
    return null;
  }
}

// Mirrors firestore.rules' canonicalDepartment()/headDepartment()/
// teacherInHeadDepartment() exactly (same merged-department groups), so a
// department head's server-side authorization here agrees with what their
// client-side Firestore writes are already scoped to.
const MERGED_DEPARTMENTS = [
  { department: "الفيزياء والكيمياء", subjects: ["الفيزياء", "الكيمياء"] },
  { department: "الجيولوجيا والأحياء", subjects: ["الجيولوجيا", "الأحياء"] },
  { department: "علم النفس والفلسفة", subjects: ["علم النفس", "الفلسفة"] },
  { department: "التاريخ والجغرافيا", subjects: ["التاريخ", "الجغرافيا", "جغرافيا"] },
];
function canonicalDepartment(raw) {
  const value = typeof raw === "string" ? raw : "";
  for (const group of MERGED_DEPARTMENTS) {
    if (value === group.department || group.subjects.includes(value)) return group.department;
  }
  return value;
}
function teacherDepartment(data) {
  const raw = (data && (data.department || data.subject)) || "";
  return canonicalDepartment(String(raw).trim());
}

// For /api/admin/set-teacher-password: an admin may reset any teacher's
// password; a department head may only reset the password of a plain
// 'user' teacher in their own department — same scoping as the head-
// authored Firestore rules on teachers/{uid} (firestore.rules'
// teacherInHeadDepartment()/headDepartment()). Returns { callerUid,
// callerName, isAdmin, targetData }, or null after writing an error
// response (including teacher_not_found, checked here so callers don't
// need their own separate existence check).
async function requireAdminOrHeadForTeacherFromRequest(req, res, targetUid) {
  if (!isFirebaseReady()) {
    res.status(503).json({ ok: false, error: "firebase_unavailable" });
    return null;
  }

  const decoded = await verifyFirebaseUser(req);
  if (!decoded?.uid) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return null;
  }

  try {
    const [callerSnap, targetSnap] = await Promise.all([
      db.collection("teachers").doc(decoded.uid).get(),
      db.collection("teachers").doc(targetUid).get(),
    ]);

    if (!targetSnap.exists) {
      res.status(404).json({ ok: false, error: "teacher_not_found" });
      return null;
    }
    const targetData = targetSnap.data() || {};

    const callerData = callerSnap.exists ? callerSnap.data() || {} : {};
    const callerRole = String(callerData.role || "").toLowerCase();
    const callerName = String(callerData.name || "").trim();
    const isAdmin = callerRole === "admin" || callerRole === "superadmin" || decoded.admin === true;
    if (isAdmin) {
      return { callerUid: decoded.uid, callerName, isAdmin: true, targetData };
    }

    const targetRole = String(targetData.role || "").toLowerCase();
    const callerDept = teacherDepartment(callerData);
    const isOwnDeptUser =
      callerRole === "head" &&
      callerDept !== "" &&
      targetRole === "user" &&
      teacherDepartment(targetData) === callerDept;
    if (isOwnDeptUser) {
      return { callerUid: decoded.uid, callerName, isAdmin: false, targetData };
    }

    res.status(403).json({ ok: false, error: "forbidden" });
    return null;
  } catch (error) {
    console.error(`[firebase] requireAdminOrHeadForTeacherFromRequest failed userId=${decoded.uid}: ${error.message}`);
    res.status(500).json({ ok: false, error: "admin_check_failed" });
    return null;
  }
}

// For endpoints that act on a specific teacher account (connect/disconnect):
// the caller must be that teacher, or an admin. Returns the resolved target
// uid, or null after writing an error response.
async function requireSelfOrAdminFromRequest(req, res, targetUserId) {
  if (!isFirebaseReady()) {
    res.status(503).json({ ok: false, error: "firebase_unavailable" });
    return null;
  }

  const decoded = await verifyFirebaseUser(req);
  if (!decoded?.uid) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return null;
  }

  const target = String(targetUserId || "").trim() || decoded.uid;
  if (target === decoded.uid) return target;

  try {
    const teacherSnap = await db.collection("teachers").doc(decoded.uid).get();
    const role = String((teacherSnap.exists ? teacherSnap.data() || {} : {}).role || "").toLowerCase();
    if (role === "admin" || role === "superadmin" || decoded.admin === true) return target;
  } catch (error) {
    console.error(`[firebase] requireSelfOrAdminFromRequest failed userId=${decoded.uid}: ${error.message}`);
    res.status(500).json({ ok: false, error: "auth_check_failed" });
    return null;
  }

  res.status(403).json({ ok: false, error: "forbidden" });
  return null;
}

function buildStudentRequestMessage({
  studentNames,
  classKey,
  destinationLabel,
  destinationDetails,
  withBag,
  requesterName,
}) {
  const namesText = studentNames.join("، ");
  const classText = toArabicDigits(classKey);
  const bagText = withBag ? "مع الحقيبة" : "بدون الحقيبة";
  const lines = [
    "طلب طالب من الإدارة",
    `الطلاب: ${namesText}`,
    `الصف: ${classText}`,
    `الجهة: ${destinationLabel}`,
    `التوجيه: يرجى توجيه الطلاب إلى ${destinationLabel} ${withBag ? "مع الحقيبة" : "بدون الحقيبة"}.`,
  ];
  if (destinationDetails) {
    lines.push(`تفاصيل الطلب: ${destinationDetails}`);
  }
  if (requesterName) {
    lines.push(`المُرسل: ${requesterName}`);
  }
  lines.push(`الوقت: ${new Date().toLocaleString("ar-KW", { timeZone: KUWAIT_TIMEZONE })}`);
  lines.push(`الحالة: ${bagText}`);
  return lines.join("\n");
}

async function getAttendanceSessionState({ dateISO, lesson, classKey, teacherUid = "" }) {
  const checkedSessionIds = buildAttendanceSessionCandidateIds({ dateISO, lesson, classKey });
  if (!isFirebaseReady()) {
    return {
      sessionExists: false,
      attendanceSubmitted: false,
      matchedSessionId: null,
      attendanceRecordCount: 0,
      classKeyMatches: false,
      teacherMatches: false,
      checkedSessionIds,
    };
  }

  const normalizedClassKey = normalizeClassKey(classKey);
  const normalizedTeacherUid = String(teacherUid || "").trim();
  let bestExisting = null;

  for (const sessionId of checkedSessionIds) {
    const sessionRef = db.collection("attendanceSessions").doc(sessionId);
    try {
      const sessionSnap = await sessionRef.get();
      if (!sessionSnap.exists) continue;

      const data = sessionSnap.data() || {};
      const sessionClassKey = normalizeClassKey(data.classKey || "");
      const sessionTeacherUid = String(data.teacherUid || "").trim();
      const sessionDate = String(data.date || "").trim();
      const sessionLesson = Number(data.lesson);

      const classKeyMatches = sessionClassKey === normalizedClassKey;
      const teacherMatches = !normalizedTeacherUid || sessionTeacherUid === normalizedTeacherUid;
      const dateMatches = sessionDate === String(dateISO);
      const lessonMatches = Number.isFinite(sessionLesson) && sessionLesson === Number(lesson);

      let attendanceRecordCount = 0;
      try {
        const recordsSnap = await sessionRef.collection("attendanceRecords").limit(1).get();
        attendanceRecordCount = recordsSnap.size;
      } catch (recordsError) {
        console.error(
          `[firebase] attendance records lookup failed date=${dateISO} lesson=${lesson} classKey=${classKey} sessionId=${sessionId}: ${recordsError.message}`
        );
      }

      const attendanceSubmitted =
        classKeyMatches && teacherMatches && dateMatches && lessonMatches && attendanceRecordCount > 0;

      const candidate = {
        sessionExists: true,
        attendanceSubmitted,
        matchedSessionId: sessionId,
        attendanceRecordCount,
        classKeyMatches,
        teacherMatches,
        score:
          Number(classKeyMatches) + Number(teacherMatches) + Number(dateMatches) + Number(lessonMatches),
      };

      if (attendanceSubmitted) {
        return {
          ...candidate,
          checkedSessionIds,
        };
      }

      if (!bestExisting || candidate.score > bestExisting.score) {
        bestExisting = candidate;
      }
    } catch (error) {
      console.error(
        `[firebase] getAttendanceSessionState failed date=${dateISO} lesson=${lesson} classKey=${classKey} sessionId=${sessionId}: ${error.message}`
      );
    }
  }

  if (bestExisting) {
    return {
      ...bestExisting,
      checkedSessionIds,
    };
  }

  return {
    sessionExists: false,
    attendanceSubmitted: false,
    matchedSessionId: null,
    attendanceRecordCount: 0,
    classKeyMatches: false,
    teacherMatches: false,
    checkedSessionIds,
  };
}

function reminderDocRef({ dateISO, teacherUid, lesson, classKey, type, timeKey }) {
  if (!isFirebaseReady()) return null;
  const normalizedTimeKey = Number.isFinite(Number(timeKey)) ? Number(timeKey) : null;
  const timePart = normalizedTimeKey === null ? "" : `_t${normalizedTimeKey}`;
  const id = `${dateISO}_${type}_${teacherUid}_${lesson}_${shortHash(classKey)}${timePart}`;
  try {
    return db.collection("telegramNotificationLog").doc(id);
  } catch (error) {
    console.error(
      `[firebase] reminderDocRef failed userId=${teacherUid} lesson=${lesson} type=${type}: ${error.message}`
    );
    return null;
  }
}

async function claimReminderSend(meta) {
  const ref = reminderDocRef(meta);
  if (!ref) {
    return { claimed: true, ref: null };
  }
  try {
    await ref.create({
      ...meta,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      sentAt: null,
      retryCount: 0,
    });
    return { claimed: true, ref };
  } catch (error) {
    if (error?.code === 6 || /already exists/i.test(String(error?.message || ""))) {
      try {
        const snap = await ref.get();
        if (!snap.exists) return { claimed: false, ref };

        const existing = snap.data() || {};
        const sentAtMs = timestampToMillis(existing.sentAt);
        if (sentAtMs) {
          return { claimed: false, ref };
        }

        const createdAtMs = timestampToMillis(existing.createdAt);
        const staleAfterMs = REMINDER_CLAIM_STALE_MINUTES * 60 * 1000;
        const isStale = !createdAtMs || Date.now() - createdAtMs >= staleAfterMs;
        if (!isStale) {
          return { claimed: false, ref };
        }

        await ref.set(
          {
            ...meta,
            reclaimedAt: admin.firestore.FieldValue.serverTimestamp(),
            retryCount: Number(existing.retryCount || 0) + 1,
            sentAt: null,
          },
          { merge: true }
        );
        return { claimed: true, ref, reclaimed: true };
      } catch (innerError) {
        console.error(
          `[reminder] claimReminderSend duplicate-check failed userId=${meta.teacherUid} lesson=${meta.lesson} type=${meta.type}: ${innerError.message}`
        );
        return { claimed: false, ref };
      }
    }
    console.error(
      `[reminder] claimReminderSend failed userId=${meta.teacherUid} lesson=${meta.lesson} type=${meta.type}: ${error.message}`
    );
    return { claimed: false, ref: null };
  }
}

async function markReminderSent(ref, meta) {
  if (!ref || !isFirebaseReady()) return;
  try {
    await ref.set(
      {
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    console.error(
      `[reminder] markReminderSent failed userId=${meta.teacherUid} lesson=${meta.lesson} type=${meta.type}: ${error.message}`
    );
  }
}

async function getReminderSendState(meta) {
  if (!isFirebaseReady()) {
    return { exists: false, sent: false };
  }
  const ref = reminderDocRef(meta);
  if (!ref) {
    return { exists: false, sent: false };
  }
  try {
    const snap = await ref.get();
    if (!snap.exists) {
      return { exists: false, sent: false };
    }
    const data = snap.data() || {};
    return {
      exists: true,
      sent: Boolean(timestampToMillis(data.sentAt)),
    };
  } catch (error) {
    console.error(
      `[reminder] getReminderSendState failed userId=${meta.teacherUid} lesson=${meta.lesson} type=${meta.type}: ${error.message}`
    );
    return { exists: false, sent: false };
  }
}

function lessonReminderText({ lesson, classKey }) {
  const classKeyAr = toArabicDigits(classKey);
  const leadMinutesAr = toArabicDigits(LESSON_REMINDER_LEAD_MINUTES);
  return `لديك حصة بعد ${leadMinutesAr} دقائق | الصف: ${classKeyAr} | ${lesson}`;
}

function attendanceReminderText({ lesson, classKey }) {
  const classKeyAr = toArabicDigits(classKey);
  return `تذكير: سجّل الحضور الآن | الصف: ${classKeyAr} | ${lesson}`;
}

function missedAttendanceText({ lesson, classKey }) {
  const classKeyAr = toArabicDigits(classKey);
  return `لم يتم تسجيل الحضور لـ ${lesson} | الصف: ${classKeyAr}`;
}

async function loadConnectedTeachersForSweep() {
  const out = new Map();

  if (!isFirebaseReady()) {
    console.warn("[firebase] loadConnectedTeachersForSweep skipped Firestore: Firebase unavailable");
  } else {
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
      console.error(`[firebase] loadConnectedTeachersForSweep failed: ${error.message}`);
    }
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
    if (!TELEGRAM_BOT_TOKEN) {
      console.warn("[reminder] skipped: TELEGRAM_BOT_TOKEN missing");
      return;
    }
    if (!isFirebaseReady()) {
      console.warn("[reminder] skipped: Firebase unavailable");
      return;
    }

    const now = kuwaitNowContext();
    const lessonTimes = await loadLessonTimes();
    const overrides = await loadOverridesForDate(now.dateISO);
    const customLessonsByTeacher = await loadCustomLessonsByTeacher(now.dayIndex, lessonTimes);

    const connectedTeachers = await loadConnectedTeachersForSweep();
    if (!connectedTeachers.length) return;

    for (const teacherRow of connectedTeachers) {
      try {
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

      for (const item of lessons) {
        const lessonLabel =
          DEFAULT_LESSON_TIMES[item.lesson - 1]?.label || `الحصة ${toArabicDigits(item.lesson)}`;

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
            timeKey: item.startMin,
          };
          const claim = await claimReminderSend(meta);
          if (claim.claimed) {
            try {
              await sendTelegramMessage(
                chatId,
                lessonReminderText({
                  lesson: lessonLabel,
                  classKey: item.classKey,
                })
              );
              await markReminderSent(claim.ref, meta);
              console.log(
                `[reminder] sent type=lesson_start userId=${teacherUid} lesson=${item.lesson} classKey=${item.classKey}`
              );
            } catch (error) {
              console.error(
                `[reminder] send failed type=lesson_start userId=${teacherUid} lesson=${item.lesson}: ${error.message}`
              );
              if (claim.ref) {
                await claim.ref.delete().catch(() => {});
              }
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

        const attendanceState = await getAttendanceSessionState({
          dateISO: now.dateISO,
          lesson: item.lesson,
          classKey: item.classKey,
          teacherUid,
        });
        if (attendanceState.attendanceSubmitted) continue;

        if (inAttendanceReminderWindow) {
          const lateMeta = {
            dateISO: now.dateISO,
            teacherUid,
            lesson: item.lesson,
            classKey: item.classKey,
            type: "attendance_late",
            timeKey: attendanceReminderStart,
          };
          const lateClaim = await claimReminderSend(lateMeta);
          if (lateClaim.claimed) {
            try {
              await sendTelegramMessage(
                chatId,
                attendanceReminderText({
                  lesson: lessonLabel,
                  classKey: item.classKey,
                })
              );
              await markReminderSent(lateClaim.ref, lateMeta);
              console.log(
                `[reminder] sent type=attendance_late userId=${teacherUid} lesson=${item.lesson} classKey=${item.classKey}`
              );
            } catch (error) {
              console.error(
                `[reminder] send failed type=attendance_late userId=${teacherUid} lesson=${item.lesson}: ${error.message}`
              );
              if (lateClaim.ref) {
                await lateClaim.ref.delete().catch(() => {});
              }
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
            timeKey: missedReminderStart,
          };
          const missedClaim = await claimReminderSend(missedMeta);
          if (missedClaim.claimed) {
            try {
              await sendTelegramMessage(
                chatId,
                missedAttendanceText({
                  lesson: lessonLabel,
                  classKey: item.classKey,
                })
              );
              await markReminderSent(missedClaim.ref, missedMeta);
              console.log(
                `[reminder] sent type=attendance_missed userId=${teacherUid} lesson=${item.lesson} classKey=${item.classKey}`
              );
            } catch (error) {
              console.error(
                `[reminder] send failed type=attendance_missed userId=${teacherUid} lesson=${item.lesson}: ${error.message}`
              );
              if (missedClaim.ref) {
                await missedClaim.ref.delete().catch(() => {});
              }
            }
          }
        }
      }
      } catch (teacherError) {
        console.error(`[reminder] teacher sweep failed userId=${teacherRow.teacherUid}: ${teacherError.message}`);
      }
    }
  } catch (error) {
    console.error(`[reminder] sweep failed: ${error.message}`);
  } finally {
    reminderSweepRunning = false;
  }
}

app.get("/api/health", (req, res) => {
  return res.json({
    ok: true,
    firebase: isFirebaseReady(),
    uptime: process.uptime(),
  });
});

function isLoopbackRequest(req) {
  const ip = String(req.ip || req.connection?.remoteAddress || "");
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function denyIfNotLoopback(req, res) {
  if (!isLoopbackRequest(req)) {
    res.status(404).json({ ok: false, error: "not_found" });
    return true;
  }
  return false;
}

app.get("/api/telegram/debug-env", (req, res) => {
  if (denyIfNotLoopback(req, res)) return;
  return res.json({
    hasFirebaseEnv: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
    hasGoogleApplicationCredentials: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
    projectId: process.env.GOOGLE_CLOUD_PROJECT || null,
    hasToken: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    firebaseReady: isFirebaseReady(),
    firebaseCredentialSource: firebaseState.credentialSource || null,
  });
});

app.get("/api/telegram/debug-status", async (req, res) => {
  if (denyIfNotLoopback(req, res)) return;
  const out = {
    ok: true,
    nowIso: new Date().toISOString(),
    firebase: {
      ready: isFirebaseReady(),
      credentialSource: firebaseState.credentialSource || null,
      projectId: firebaseState.projectId || null,
    },
    telegram: {
      hasToken: Boolean(TELEGRAM_BOT_TOKEN),
      configuredUsername: TELEGRAM_BOT_USERNAME || null,
      resolvedUsername: null,
      webhookInfo: null,
    },
  };

  if (!TELEGRAM_BOT_TOKEN) {
    return res.json(out);
  }

  try {
    const me = await telegramApiRequest("getMe", {});
    out.telegram.resolvedUsername = String(me?.result?.username || "") || null;
  } catch (error) {
    out.telegram.getMeError = String(error?.message || error);
  }

  try {
    const webhookInfo = await telegramApiRequest("getWebhookInfo", {});
    out.telegram.webhookInfo = webhookInfo?.result || null;
  } catch (error) {
    out.telegram.webhookInfoError = String(error?.message || error);
  }

  return res.json(out);
});

app.get("/api/telegram/class-live-info", async (req, res) => {
  const adminUser = await requireAdminFromRequest(req, res);
  if (!adminUser) return;

  const classKey = normalizeClassKey(req.query?.classKey);
  if (!classKey) {
    return res.status(400).json({ ok: false, error: "missing_class_key" });
  }

  try {
    const now = kuwaitNowContext();
    const lessonTimes = await loadLessonTimes();
    const context = await resolveClassLiveContext({ classKey, now, lessonTimes });
    return res.json({
      ok: true,
      ...context,
    });
  } catch (error) {
    console.error(`[telegram] class-live-info failed classKey=${classKey}: ${error.message}`);
    return res.status(500).json({
      ok: false,
      error: "class_live_info_failed",
    });
  }
});

app.post("/api/telegram/request-students", async (req, res) => {
  const adminUser = await requireAdminFromRequest(req, res);
  if (!adminUser) return;

  if (!TELEGRAM_BOT_TOKEN) {
    return res.status(503).json({ ok: false, error: "telegram_token_missing" });
  }

  const classKey = normalizeClassKey(req.body?.classKey);
  const studentNames = Array.isArray(req.body?.studentNames)
    ? req.body.studentNames.map((x) => String(x || "").trim().slice(0, 200)).filter(Boolean)
    : [];
  const destinationType = String(req.body?.destinationType || "").trim().slice(0, 64);
  const destinationLabelInput = String(req.body?.destinationLabel || "").trim().slice(0, 200);
  const destinationDetails = String(req.body?.destinationDetails || "").trim().slice(0, 500);
  const withBag = Boolean(req.body?.withBag);

  if (!classKey) {
    return res.status(400).json({ ok: false, error: "missing_class_key" });
  }
  if (!studentNames.length) {
    return res.status(400).json({ ok: false, error: "missing_students" });
  }
  if (studentNames.length > 200) {
    return res.status(400).json({ ok: false, error: "too_many_students" });
  }
  if (!destinationType) {
    return res.status(400).json({ ok: false, error: "missing_destination_type" });
  }
  if (destinationType === "administration" && !destinationDetails) {
    return res.status(400).json({ ok: false, error: "missing_destination_details" });
  }
  if (destinationType === "custom" && !destinationLabelInput) {
    return res.status(400).json({ ok: false, error: "missing_custom_destination" });
  }

  const destinationLabel =
    destinationType === "administration"
      ? "الإدارة المدرسية"
      : destinationType === "absence_office"
        ? "مكتب الغيابات"
        : destinationLabelInput;

  try {
    const now = kuwaitNowContext();
    const lessonTimes = await loadLessonTimes();
    const context = await resolveClassLiveContext({ classKey, now, lessonTimes });

    if (!context.inLesson) {
      return res.status(409).json({ ok: false, error: "no_active_lesson", classKey });
    }

    const teacherUid = context.teacher?.teacherUid || "";
    const chatId = String(context.teacher?.chatId || "").trim();
    if (!teacherUid) {
      return res.status(404).json({ ok: false, error: "teacher_not_found", classKey });
    }
    if (!chatId) {
      return res.status(404).json({ ok: false, error: "teacher_chat_not_connected", teacherUid, classKey });
    }

    const message = buildStudentRequestMessage({
      studentNames,
      classKey,
      destinationLabel,
      destinationDetails: destinationType === "administration" ? destinationDetails : "",
      withBag,
      requesterName: adminUser.name,
    });

    await sendTelegramMessage(chatId, message);

    // Also notify the grade's supervisor(s), if any exist and are
    // connected — best-effort, never blocks/fails the request itself
    // (the class teacher above is the only required recipient).
    const classParts = parseClassKeyParts(classKey);
    const supervisorTargets = await resolveGradeSupervisorTargets(classParts?.grade);
    const supervisorResults = await Promise.allSettled(
      supervisorTargets.map((target) => sendTelegramMessage(target.chatId, message))
    );
    const notifiedSupervisors = supervisorTargets.filter((_, i) => supervisorResults[i].status === "fulfilled");
    supervisorResults.forEach((result, i) => {
      if (result.status === "rejected") {
        const target = supervisorTargets[i];
        console.error(
          `[telegram] request-students supervisor send failed teacherUid=${target.teacherUid} classKey=${classKey}: ${result.reason?.message || result.reason}`
        );
      }
    });

    if (isFirebaseReady()) {
      try {
        await db.collection("telegramStudentRequests").add({
          requestedByUid: adminUser.uid,
          requestedByName: adminUser.name || null,
          classKey,
          studentNames,
          destinationType,
          destinationLabel,
          destinationDetails: destinationType === "administration" ? destinationDetails : "",
          withBag,
          teacherUid,
          teacherName: context.teacher?.teacherName || null,
          teacherChatId: chatId,
          lesson: context.lesson || null,
          supervisorsNotified: notifiedSupervisors.map((t) => ({ teacherUid: t.teacherUid, teacherName: t.teacherName || null })),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (error) {
        console.error(`[telegram] request-students log write failed classKey=${classKey}: ${error.message}`);
      }
    }

    return res.json({
      ok: true,
      classKey,
      teacherUid,
      teacherName: context.teacher?.teacherName || null,
      lesson: context.lesson || null,
      supervisorsNotified: notifiedSupervisors.length,
      sentAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[telegram] request-students failed classKey=${classKey}: ${error.message}`);
    if (error?.code === "telegram_api_error") {
      return res.status(502).json({
        ok: false,
        error: "telegram_send_failed",
        status: Number(error?.status) || 502,
      });
    }
    return res.status(500).json({
      ok: false,
      error: "request_send_failed",
    });
  }
});

app.post("/api/telegram/broadcast", async (req, res) => {
  const adminUser = await requireAdminFromRequest(req, res);
  if (!adminUser) return;

  if (!TELEGRAM_BOT_TOKEN) {
    return res.status(503).json({ ok: false, error: "telegram_token_missing" });
  }

  const message = String(req.body?.message || "").trim();
  if (!message) {
    return res.status(400).json({ ok: false, error: "missing_message" });
  }
  if (message.length > 4096) {
    return res.status(400).json({ ok: false, error: "message_too_long" });
  }

  try {
    const recipients = await loadConnectedTeachersForSweep();
    if (!recipients.length) {
      return res.status(404).json({ ok: false, error: "no_connected_teachers" });
    }

    let sentCount = 0;
    const failures = [];

    for (const recipient of recipients) {
      const chatId = String(recipient.chatId || "").trim();
      if (!chatId) continue;

      try {
        // Telegram caps bots at ~30 messages/second; pace sends so a large
        // staff list can't trip the rate limit mid-broadcast.
        if (sentCount > 0) await delay(50);
        await sendTelegramMessage(chatId, message);
        sentCount += 1;
      } catch (error) {
        failures.push({
          teacherUid: String(recipient.teacherUid || ""),
          status: Number(error?.status) || null,
          code: String(error?.code || ""),
        });
        console.error(
          `[telegram] broadcast send failed userId=${recipient.teacherUid || "unknown"}: ${error.message}`
        );
      }
    }

    const result = {
      ok: sentCount > 0,
      totalRecipients: recipients.length,
      sentCount,
      failedCount: failures.length,
    };
    if (failures.length) {
      result.failures = failures.slice(0, 20);
    }

    if (isFirebaseReady()) {
      try {
        await db.collection("telegramBroadcastLog").add({
          requestedByUid: adminUser.uid,
          requestedByName: adminUser.name || null,
          totalRecipients: result.totalRecipients,
          sentCount: result.sentCount,
          failedCount: result.failedCount,
          messagePreview: message.slice(0, 200),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (error) {
        console.error(`[telegram] broadcast log write failed: ${error.message}`);
      }
    }

    if (!sentCount) {
      return res.status(502).json({ ...result, error: "broadcast_send_failed" });
    }
    return res.json(result);
  } catch (error) {
    console.error(`[telegram] broadcast failed: ${error.message}`);
    return res.status(500).json({ ok: false, error: "broadcast_failed" });
  }
});

app.post("/api/telegram/run-reminder-sweep", async (req, res) => {
  const adminUser = await requireAdminFromRequest(req, res);
  if (!adminUser) return;
  try {
    await runReminderSweep();
    return res.json({ ok: true });
  } catch (error) {
    console.error(`[reminder] manual sweep failed: ${error.message}`);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Firebase's client SDK can only ever change the *signed-in* user's own
// password — an admin (or, for a teacher in their own department, a
// department head) resetting someone else's login has to go through the
// Admin SDK, which only exists server-side. The caller must already have
// re-authenticated their own password client-side (see admins/teachers.html
// and depHead/department.html) before this is ever hit; this endpoint only
// re-checks that the caller is really allowed to touch this specific target.
app.post("/api/admin/set-teacher-password", async (req, res) => {
  const targetUid = String(req.body?.uid || "").trim();
  if (!targetUid) {
    return res.status(400).json({ ok: false, error: "missing_uid" });
  }

  const actor = await requireAdminOrHeadForTeacherFromRequest(req, res, targetUid);
  if (!actor) return;

  const newPassword = String(req.body?.newPassword || "");
  if (newPassword.length < 6) {
    return res.status(400).json({ ok: false, error: "weak_password" });
  }

  try {
    await admin.auth().updateUser(targetUid, { password: newPassword });

    // Keep the admin/head-visible "displayed password" (shown via the
    // reveal toggle on the teacher's profile) in sync — otherwise it would
    // keep showing a stale value after the real login password changed.
    await db
      .collection("teachers")
      .doc(targetUid)
      .collection("private")
      .doc("credentials")
      .set({ displayedPassword: newPassword }, { merge: true });

    try {
      await db.collection("passwordResetLog").add({
        targetUid,
        performedByUid: actor.callerUid,
        performedByName: actor.callerName || null,
        performedByRole: actor.isAdmin ? "admin" : "head",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (logError) {
      console.error(`[admin] password reset log write failed: ${logError.message}`);
    }

    console.log(`[admin] password reset targetUid=${targetUid} by=${actor.callerUid}`);
    return res.json({ ok: true });
  } catch (error) {
    console.error(
      `[admin] set-teacher-password failed targetUid=${targetUid}: ${error.message}`
    );
    const code = String(error?.code || "");
    if (code === "auth/user-not-found") {
      return res.status(404).json({ ok: false, error: "auth_user_not_found" });
    }
    if (code === "auth/invalid-password") {
      return res.status(400).json({ ok: false, error: "weak_password" });
    }
    return res.status(500).json({ ok: false, error: "set_password_failed" });
  }
});

app.get("/api/telegram/connect-link", async (req, res) => {
  const userId = await requireSelfOrAdminFromRequest(req, res, req.query.userId);
  if (!userId) return;
  const resolvedUsername = (await getBotUsername()) || TELEGRAM_BOT_USERNAME || "AbrSchool_bot";
  const url = `https://t.me/${resolvedUsername}?start=${encodeURIComponent(`connect_${userId}`)}`;

  console.log(`[telegram] connect-link generated for userId=${userId} bot=${resolvedUsername}`);
  return res.json({ url });
});

app.post("/api/telegram/disconnect", async (req, res) => {
  const userId = await requireSelfOrAdminFromRequest(req, res, req.body?.userId || req.query?.userId);
  if (!userId) return;
  delete users[userId];
  if (!isFirebaseReady()) {
    console.warn(`[firebase] disconnect skipped Firestore update userId=${userId}: Firebase unavailable`);
  } else {
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
      console.error(`[telegram] disconnect Firestore update failed userId=${userId}: ${error.message}`);
    }
  }
  console.log(`[telegram] disconnected mapping for userId=${userId}`);
  return res.json({ ok: true });
});

app.get("/api/telegram/test-message", async (req, res) => {
  const adminUser = await requireAdminFromRequest(req, res);
  if (!adminUser) return;
  const userId = String(req.query?.userId || adminUser.uid).trim() || adminUser.uid;
  const memoryChatId = String(users[userId] || "").trim();
  let chatId = memoryChatId;

  if (!chatId && isFirebaseReady()) {
    try {
      const teacherSnap = await db.collection("teachers").doc(userId).get();
      if (teacherSnap.exists) {
        const teacherData = teacherSnap.data() || {};
        chatId = String(teacherData.telegramChatId || "").trim();
      }
    } catch (error) {
      console.error(`[telegram] test-message Firestore lookup failed userId=${userId}: ${error.message}`);
    }
  } else if (!chatId) {
    console.warn(`[firebase] test-message skipped Firestore lookup userId=${userId}: Firebase unavailable`);
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
    console.error(`[telegram] test-message send failed userId=${userId}: ${error.message}`);
    if (error?.code === "telegram_api_error") {
      return res.status(502).json({
        ok: false,
        error: "telegram_send_failed",
        status: Number(error?.status) || 502,
        userId,
        chatId,
      });
    }
    return res.status(500).json({ ok: false, error: error.message, userId, chatId });
  }
});

app.get("/api/telegram/debug-reminders", async (req, res) => {
  const adminUser = await requireAdminFromRequest(req, res);
  if (!adminUser) return;
  const userId = String(req.query?.userId || adminUser.uid).trim() || adminUser.uid;

  try {
    const now = kuwaitNowContext();
    const lessonTimes = await loadLessonTimes();
    const overrides = await loadOverridesForDate(now.dateISO);
    const customLessonsByTeacher = await loadCustomLessonsByTeacher(now.dayIndex, lessonTimes);
    const lessons = await buildTeacherLessonsForToday({
      teacherUid: userId,
      dateISO: now.dateISO,
      weekdayEnglish: now.weekdayEnglish,
      lessonTimes,
      overrides,
      customLessonsByTeacher,
    });

    let firestoreChatId = "";
    let teacherName = "";
    if (!isFirebaseReady()) {
      console.warn(`[firebase] debug-reminders skipped teacher lookup userId=${userId}: Firebase unavailable`);
    } else {
      try {
        const teacherSnap = await db.collection("teachers").doc(userId).get();
        if (teacherSnap.exists) {
          const data = teacherSnap.data() || {};
          firestoreChatId = String(data.telegramChatId || "").trim();
          teacherName = String(data.name || "").trim();
        }
      } catch (error) {
        console.error(`[telegram] debug-reminders Firestore lookup failed userId=${userId}: ${error.message}`);
      }
    }

    const memoryChatId = String(users[userId] || "").trim();
    const activeChatId = firestoreChatId || memoryChatId;

    const lessonChecks = [];
    for (const item of lessons) {
      const attendanceState = await getAttendanceSessionState({
        dateISO: now.dateISO,
        lesson: item.lesson,
        classKey: item.classKey,
        teacherUid: userId,
      });
      const before5Window = now.nowMinutes >= item.startMin - LESSON_REMINDER_LEAD_MINUTES && now.nowMinutes < item.startMin;
      const attendanceReminderStart = item.startMin + ATTENDANCE_REMINDER_DELAY_MINUTES;
      const lateWindow = now.nowMinutes >= attendanceReminderStart && now.nowMinutes <= item.endMin + 15;
      const missedReminderStart = item.endMin + 16;
      const missedWindow = now.nowMinutes >= missedReminderStart && now.nowMinutes <= item.endMin + 180;
      const lessonStartState = await getReminderSendState({
        dateISO: now.dateISO,
        teacherUid: userId,
        lesson: item.lesson,
        classKey: item.classKey,
        type: "lesson_start",
        timeKey: item.startMin,
      });
      const attendanceLateState = await getReminderSendState({
        dateISO: now.dateISO,
        teacherUid: userId,
        lesson: item.lesson,
        classKey: item.classKey,
        type: "attendance_late",
        timeKey: attendanceReminderStart,
      });
      const attendanceMissedState = await getReminderSendState({
        dateISO: now.dateISO,
        teacherUid: userId,
        lesson: item.lesson,
        classKey: item.classKey,
        type: "attendance_missed",
        timeKey: missedReminderStart,
      });

      lessonChecks.push({
        lesson: item.lesson,
        lessonLabel: DEFAULT_LESSON_TIMES[item.lesson - 1]?.label || `الحصة_${toArabicDigits(item.lesson)}`,
        classKey: item.classKey,
        start: toTimeLabel(item.startMin),
        end: toTimeLabel(item.endMin),
        source: item.source || "schedule",
        attendanceExists: attendanceState.sessionExists,
        attendanceSubmitted: attendanceState.attendanceSubmitted,
        attendanceRecordCount: attendanceState.attendanceRecordCount,
        attendanceSessionId: attendanceState.matchedSessionId || null,
        attendanceCheck: {
          classKeyMatches: attendanceState.classKeyMatches,
          teacherMatches: attendanceState.teacherMatches,
          checkedSessionIds: attendanceState.checkedSessionIds,
        },
        windows: {
          before5Window,
          lateWindow,
          missedWindow,
        },
        reminderState: {
          lessonStart: lessonStartState,
          attendanceLate: attendanceLateState,
          attendanceMissed: attendanceMissedState,
        },
      });
    }

    return res.json({
      ok: true,
      userId,
      teacherName,
      now: {
        dateISO: now.dateISO,
        weekdayEnglish: now.weekdayEnglish,
        nowMinutes: now.nowMinutes,
        nowTime: toTimeLabel(now.nowMinutes),
      },
      chat: {
        activeChatId: activeChatId || null,
        firestoreChatId: firestoreChatId || null,
        memoryChatId: memoryChatId || null,
      },
      lessonCount: lessonChecks.length,
      lessons: lessonChecks,
    });
  } catch (error) {
    console.error(`[telegram] debug-reminders failed userId=${userId}: ${error.message}`);
    return res.status(500).json({
      ok: false,
      userId,
      error: error.message,
    });
  }
});

app.post("/api/telegram-webhook", async (req, res) => {
  const expectedWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  if (expectedWebhookSecret) {
    const providedSecret = String(req.get("X-Telegram-Bot-Api-Secret-Token") || "");
    if (providedSecret !== expectedWebhookSecret) {
      console.warn("[telegram] webhook rejected: secret token mismatch");
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
  }

  const update = req.body || {};
  const chatId = update?.message?.chat?.id;
  const text = String(update?.message?.text || "").trim();

  if (chatId && text.startsWith("/start")) {
    console.log(`[telegram] /start chatId=${chatId}`);
    console.log(`[telegram] /start text=${text}`);

    const maybePayload = text.split(/\s+/)[1] || "";

    const connectMatch = maybePayload.match(/^connect_(.+)$/);
    if (connectMatch) {
      const userId = String(connectMatch[1] || "").trim();
      if (userId) {
        users[userId] = String(chatId);
        if (!isFirebaseReady()) {
          console.warn(`[firebase] webhook connect skipped Firestore write userId=${userId}: Firebase unavailable`);
        } else {
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
            console.error(`[telegram] webhook connect Firestore save failed userId=${userId}: ${error.message}`);
          }
        }
        console.log(`[telegram] connected userId=${userId} chatId=${chatId}`);
        try {
          await sendTelegramMessage(chatId, `Connected successfully for user: ${userId}.`);
        } catch (error) {
          console.error(`[telegram] webhook connect confirmation send failed userId=${userId}: ${error.message}`);
        }
        return res.sendStatus(200);
      }
    }

    if (!maybePayload) {
      try {
        await sendTelegramMessage(chatId, "Welcome! Open the app and tap Connect Telegram first.");
      } catch (error) {
        console.error(`[telegram] webhook basic /start response failed chatId=${chatId}: ${error.message}`);
      }
      return res.sendStatus(200);
    }

    const verified = resolveTeacherUidFromStartArg(maybePayload);
    if (!verified.ok) {
      try {
        await sendTelegramMessage(chatId, "Invalid or expired link. Please reconnect from the app.");
      } catch (error) {
        console.error(`[telegram] webhook invalid payload response failed chatId=${chatId}: ${error.message}`);
      }
      return res.sendStatus(200);
    }

    try {
      users[verified.teacherUid] = String(chatId);
      if (!isFirebaseReady()) {
        console.warn(
          `[firebase] webhook verified connect skipped Firestore write userId=${verified.teacherUid}: Firebase unavailable`
        );
      } else {
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
      }

      if (verified.plain) {
        await sendTelegramMessage(
          chatId,
          "Connected with teacher ID. For better security, reconnect from the app button next time."
        );
      } else {
        await sendTelegramMessage(chatId, "Welcome! Telegram notifications are now connected.");
      }
      console.log(`[telegram] verified connect success userId=${verified.teacherUid} chatId=${chatId}`);
    } catch (error) {
      console.error(`[telegram] verified connect failed userId=${verified.teacherUid}: ${error.message}`);
      try {
        await sendTelegramMessage(chatId, "Link failed on server. Please try again from the app.");
      } catch (nestedError) {
        console.error(`[telegram] failed to send link error chatId=${chatId}: ${nestedError.message}`);
      }
    }
  }

  return res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("Telegram notification server is running.");
});

app.use((error, req, res, next) => {
  console.error(`[server] unhandled error path=${req.path}: ${error?.message || error}`);
  if (res.headersSent) return next(error);
  return res.status(500).json({ ok: false, error: "internal_error" });
});

app.listen(PORT, () => {
  console.log(`[telegram] server running on port ${PORT}`);
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn("[telegram] missing TELEGRAM_BOT_TOKEN. Webhook replies and reminders are disabled.");
  } else {
    (async () => {
      try {
        const me = await telegramApiRequest("getMe", {});
        const username = String(me?.result?.username || "").trim();
        if (username) {
          botUsernameCache = username;
        }
        console.log(`[telegram] bot ready username=${username || "unknown"}`);
      } catch (error) {
        console.error(`[telegram] startup getMe failed: ${error.message}`);
      }
      try {
        const webhook = await telegramApiRequest("getWebhookInfo", {});
        const webhookUrl = String(webhook?.result?.url || "").trim();
        const pendingCount = Number(webhook?.result?.pending_update_count || 0);
        const lastError = String(webhook?.result?.last_error_message || "").trim();
        console.log(
          `[telegram] webhook url=${webhookUrl || "(not set)"} pending=${pendingCount}${
            lastError ? ` lastError=${lastError}` : ""
          }`
        );
      } catch (error) {
        console.error(`[telegram] startup getWebhookInfo failed: ${error.message}`);
      }
    })().catch(() => {});
  }

  setTimeout(() => {
    runReminderSweep().catch((error) => {
      console.error(`[reminder] startup sweep crashed: ${error.message}`);
    });
  }, 5000);

  setInterval(() => {
    runReminderSweep().catch((error) => {
      console.error(`[reminder] interval sweep crashed: ${error.message}`);
    });
  }, 60 * 1000);
});
