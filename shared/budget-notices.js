// «إشعارات الميزانيات»: what department heads sent those who approve budgets
// («إشعار بميزانية جديدة» in /shared/department-budgets.js). The bot's server
// (index.js: /api/budgets/notify-approvers) sends it on Telegram and keeps a
// copy in budgetNoticeLog/{id}:
//   { to: "approvers" | "head", department, text, byUid, byName, createdAt }
// This module shows the "approvers" ones: a sidebar link with a count of the
// unread, and a panel listing the last 30 days. Read by admins and
// «السماح بكل الميزانيات» / «السماح بتعديل الجدول» (firestore.rules); what is
// read is kept per account in budget_notice_seen/{uid} { seenAt }, so the
// count is the same on every device. (A head's reminders, to: "head", show
// in their «إشعارات القسم», Teachers/user.html.)
//
// mountBudgetNotices({ db, link, badge, onOpenBudgets }) → { start(uid), stop() }
//   link   the sidebar button that opens the panel (shown while started)
//   badge  the element inside it that shows the count
//   onOpenBudgets  optional: «فتح ميزانيات الأقسام» under the list
import { collection, doc, getDoc, setDoc, onSnapshot, query, where, serverTimestamp } from "/shared/firebase.js";

const COLLECTION = "budgetNoticeLog";
const SEEN = "budget_notice_seen";
const DAYS = 30;
const STYLE_ID = "bn-style";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const ar = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[d]);
const ms = (t) => (t && typeof t.toMillis === "function") ? t.toMillis() : 0;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .bn-count { margin-inline-start: auto; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px;
      background: #dc2626; color: #fff; font-size: .72rem; font-weight: 800; display: inline-grid; place-items: center; }
    .bn-count[hidden] { display: none; }
    .bn-host { position: fixed; inset: 0; z-index: 2600; display: none; place-items: center; padding: 16px;
      background: rgba(2, 24, 38, .55); direction: rtl;
      font-family: "Tajawal", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
    .bn-host.open { display: grid; }
    .bn-card { width: min(520px, 100%); max-height: calc(100dvh - 32px); display: flex; flex-direction: column;
      background: #fff; color: #0f172a; border-radius: 20px; overflow: hidden; box-shadow: 0 28px 60px rgba(2, 43, 66, .28); }
    .bn-head { display: flex; align-items: center; gap: 10px; padding: 16px 18px; color: #fff;
      background: linear-gradient(145deg, #033C54 0%, #065372 60%, #0a5f80 100%); }
    .bn-head h3 { margin: 0; font-size: 1.05rem; flex: 1; }
    .bn-x { border: 0; background: rgba(255,255,255,.16); color: #fff; width: 34px; height: 34px; border-radius: 10px;
      font-size: 1.1rem; cursor: pointer; }
    .bn-list { overflow-y: auto; padding: 12px 14px; display: grid; gap: 10px; }
    .bn-item { border: 1px solid #d0e4f0; border-radius: 14px; padding: 12px 14px; background: #f8fbff; }
    .bn-item.is-new { border-color: #f59e0b; background: #fffbeb; }
    .bn-top { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .bn-dept { font-weight: 800; color: #033C54; flex: 1; }
    .bn-new { font-size: .7rem; font-weight: 800; color: #fff; background: #f59e0b; border-radius: 999px; padding: 1px 8px; }
    .bn-time { font-size: .75rem; color: #64748b; }
    .bn-text { white-space: pre-line; line-height: 1.7; font-size: .92rem; }
    .bn-empty { text-align: center; color: #64748b; padding: 28px 8px; }
    .bn-foot { padding: 12px 14px; border-top: 1px solid #e2e8f0; }
    .bn-open { width: 100%; border: 0; border-radius: 12px; padding: 11px; font: inherit; font-weight: 800;
      background: #033C54; color: #fff; cursor: pointer; }
  `;
  document.head.append(s);
}

const fmt = (t) => {
  const v = ms(t);
  return v ? new Intl.DateTimeFormat("ar-KW", { timeZone: "Asia/Kuwait", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(new Date(v)) : "";
};

export function mountBudgetNotices({ db, link, badge, onOpenBudgets }) {
  ensureStyles();
  const host = document.createElement("div");
  host.className = "bn-host";
  host.innerHTML = `<div class="bn-card" role="dialog" aria-modal="true" aria-label="إشعارات الميزانيات">
      <div class="bn-head"><h3>إشعارات الميزانيات</h3><button class="bn-x" type="button" aria-label="إغلاق">✕</button></div>
      <div class="bn-list"></div>
      ${onOpenBudgets ? '<div class="bn-foot"><button class="bn-open" type="button">فتح ميزانيات الأقسام</button></div>' : ""}
    </div>`;
  document.body.append(host);
  const list = host.querySelector(".bn-list");
  let uid = null, unsub = null, items = [], seenMs = 0, newIds = new Set();

  const unread = () => items.filter((x) => ms(x.createdAt) > seenMs);
  function renderBadge() {
    const n = unread().length;
    badge.hidden = n === 0;
    badge.textContent = n > 99 ? "٩٩+" : ar(n);
    link.setAttribute("aria-label", n ? `إشعارات الميزانيات، ${ar(n)} جديدة` : "إشعارات الميزانيات");
  }
  function render() {
    list.replaceChildren();
    if (!items.length) {
      list.append(Object.assign(document.createElement("div"), { className: "bn-empty", textContent: "لا توجد إشعارات في آخر ٣٠ يوماً." }));
      return;
    }
    for (const x of items) {
      const card = document.createElement("div");
      card.className = "bn-item" + (newIds.has(x.id) ? " is-new" : "");
      const top = document.createElement("div");
      top.className = "bn-top";
      top.append(Object.assign(document.createElement("span"), { className: "bn-dept", textContent: "قسم " + (x.department || "—") }));
      if (newIds.has(x.id)) top.append(Object.assign(document.createElement("span"), { className: "bn-new", textContent: "جديد" }));
      top.append(Object.assign(document.createElement("span"), { className: "bn-time", textContent: fmt(x.createdAt) }));
      card.append(top, Object.assign(document.createElement("div"), { className: "bn-text", textContent: x.text || "" }));
      list.append(card);
    }
  }
  // Everything shown counts as read; writes only when something was unread.
  function markSeen() {
    const u = unread();
    if (!u.length || !uid) return;
    u.forEach((x) => newIds.add(x.id));
    seenMs = Math.max(Date.now(), ...u.map((x) => ms(x.createdAt)));
    renderBadge();
    setDoc(doc(db, SEEN, uid), { seenAt: serverTimestamp() })
      .catch((e) => console.warn("[budget-notices] mark seen failed:", e?.message || e));
  }
  const isOpen = () => host.classList.contains("open");
  function open() { host.classList.add("open"); markSeen(); render(); }
  function close() { host.classList.remove("open"); newIds = new Set(); }
  host.addEventListener("click", (e) => { if (e.target === host) close(); });
  host.querySelector(".bn-x").addEventListener("click", close);
  host.querySelector(".bn-open")?.addEventListener("click", () => { close(); onOpenBudgets(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) close(); });
  link.addEventListener("click", open);

  async function start(userUid) {
    if (uid === userUid && unsub) return;
    stop();
    uid = userUid;
    if (!uid) return;
    link.hidden = false;
    try {
      const s = await getDoc(doc(db, SEEN, uid));
      seenMs = ms(s.exists() ? s.data().seenAt : null);
    } catch (e) {
      // Can't tell what was read: don't flood the count.
      console.warn("[budget-notices] seen read failed:", e?.message || e);
      seenMs = Date.now();
    }
    if (uid !== userUid) return;
    unsub = onSnapshot(query(collection(db, COLLECTION), where("to", "==", "approvers")), (snap) => {
      const from = Date.now() - DAYS * 86400000;
      items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((x) => ms(x.createdAt) >= from)
        .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
      renderBadge();
      if (isOpen()) { markSeen(); render(); }
    }, (e) => console.error("[budget-notices] listener:", e));
  }
  function stop() {
    unsub?.();
    unsub = null; uid = null; items = []; newIds = new Set();
    link.hidden = true;
    badge.hidden = true;
    close();
  }
  return { start, stop, open };
}
