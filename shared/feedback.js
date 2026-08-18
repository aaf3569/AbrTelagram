import {
  doc, getDoc, collection, addDoc, serverTimestamp,
} from "/shared/firebase.js";

const STYLE_ID = "feedback-sheet-style";

// Relies on the host page's existing .sheet/.sheet-header/.sheet-body/
// .back-btn/.sheet-title/.btn/.btn.primary/.select/.modal/.overlay/.card/
// .card.error/.row chrome (present on every hub page already, since they
// all already mount shared/attendance.js which depends on the same set).
// Only the pieces with no existing host equivalent — the type/message
// fields, the pinned submit bar, and the success checkmark — get their
// own scoped styles here.
const STYLES = `
  #feedbackSheet .fb-field{display:flex;flex-direction:column;gap:8px;margin-bottom:18px}
  #feedbackSheet .fb-field label{font-weight:900;color:var(--primary);font-size:.92rem}
  #feedbackSheet .fb-textarea{
    width:100%;min-height:220px;padding:14px 16px;border-radius:14px;
    border:1px solid var(--border);background:#fff;color:var(--text);
    font-family:"Noto Kufi Arabic", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    font-size:1rem;font-weight:600;line-height:1.7;resize:vertical;
    transition:var(--transition);
  }
  #feedbackSheet .fb-textarea:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px rgba(3,60,84,.12)}
  #feedbackSheet .fb-textarea:disabled{background:rgba(107,127,159,.06);color:var(--muted);cursor:not-allowed}
  #feedbackSheet .fb-textarea::placeholder{color:var(--muted)}
  #feedbackSheet .fb-hint{color:var(--muted);font-size:.86rem;font-weight:700;display:flex;align-items:center;gap:8px}
  #feedbackSheet .fb-hint svg{flex-shrink:0}
  /* .fb-submit-bar is a sibling of .sheet-body (not nested inside it) —
     both direct children of the flex-column .sheet, so it just needs to
     not shrink; no sticky/negative-margin tricks needed to pin it, the
     flex layout already keeps it flush against the sheet's own bottom
     edge. */
  #feedbackSheet .fb-submit-bar{
    flex-shrink:0;
    padding:14px 20px calc(14px + env(safe-area-inset-bottom,0));
    background:rgba(255,255,255,.92);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
    border-top:1px solid var(--border);
    box-shadow:0 -6px 24px rgba(3,60,84,.08);
  }
  #feedbackSheet .fb-submit-bar .btn{width:100%;min-height:56px}
  #fbSuccessModal .success-card{position:relative;z-index:1;width:min(340px,92vw);background:#fff;border:1px solid var(--border);border-radius:18px;box-shadow:0 24px 60px rgba(3,60,84,.24);padding:24px 22px;display:grid;justify-items:center;gap:14px}
  #fbSuccessModal.open .success-card{animation:fbCardIn .2s ease}
  #fbSuccessModal .success-check{width:96px;height:96px;display:grid;place-items:center}
  #fbSuccessModal .success-check svg{width:96px;height:96px;overflow:visible}
  #fbSuccessModal .success-check circle{fill:none;stroke:#16a34a;stroke-width:6;stroke-dasharray:220;stroke-dashoffset:0;transform-origin:50% 50%}
  #fbSuccessModal .success-check path{fill:none;stroke:#16a34a;stroke-width:7;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:70;stroke-dashoffset:0}
  #fbSuccessModal .success-title{font-weight:900;color:#166534;font-size:15px;text-align:center;line-height:1.5}
  #fbSuccessModal .success-ok{width:100%;min-height:52px;margin-top:4px}
  @keyframes fbCardIn{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}
`;

const SHEET_HTML = `
  <section id="feedbackSheet" class="sheet" aria-hidden="true">
    <div class="sheet-header">
      <button id="fbCloseBtn" class="back-btn" type="button" aria-label="رجوع">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        رجوع
      </button>
      <h3 class="sheet-title">اقتراح أو بلاغ</h3>
    </div>
    <div class="sheet-body">
      <div class="fb-field">
        <label for="fbType">نوع الرسالة</label>
        <select id="fbType" class="select" aria-label="نوع الرسالة">
          <option value="">اختر النوع...</option>
          <option value="report">بلاغ</option>
          <option value="suggestion">اقتراح</option>
        </select>
      </div>
      <div class="fb-field">
        <label for="fbMessage">الرسالة</label>
        <textarea id="fbMessage" class="fb-textarea" placeholder="اكتب هنا..." disabled></textarea>
        <div id="fbHint" class="fb-hint">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
          اختر نوع الرسالة أولاً حتى تتمكن من الكتابة.
        </div>
      </div>
    </div>
    <div class="fb-submit-bar">
      <button id="fbSubmitBtn" class="btn primary" type="button" disabled>إرسال</button>
    </div>
  </section>
  <div id="fbSuccessModal" class="modal" aria-hidden="true">
    <div class="overlay"></div>
    <div class="success-card" role="status" aria-live="polite">
      <div class="success-check" aria-hidden="true">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="35"></circle>
          <path d="M32 52 L45 65 L70 40"></path>
        </svg>
      </div>
      <div class="success-title">تم إرسال رسالتك، شكراً لك</div>
      <button id="fbSuccessOk" class="btn primary success-ok" type="button">إغلاق</button>
    </div>
  </div>
  <div id="fbErrorModal" class="modal" aria-hidden="true">
    <div class="overlay"></div>
    <div class="card error" role="alertdialog" aria-modal="true" aria-labelledby="fbErrorTitle">
      <h3 id="fbErrorTitle">تعذّر الإرسال</h3>
      <p id="fbErrorBody">حدث خطأ غير متوقع. حاول مرة أخرى.</p>
      <div class="row">
        <button id="fbErrorOk" class="btn primary" type="button">حسناً</button>
      </div>
    </div>
  </div>
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLES;
  document.head.appendChild(el);
}

function injectMarkup() {
  if (document.getElementById("feedbackSheet")) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = SHEET_HTML.trim();
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
}

// Own body-scroll lock rather than relying on a host-defined .no-scroll
// class — that class only actually exists in 2 of the 4 hub pages this
// module is mounted on, so leaning on inline styles here works everywhere.
function lockBodyScroll(state) {
  if (state.locked) return;
  state.scrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.style.position = "fixed";
  document.body.style.top = `-${state.scrollY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.overflow = "hidden";
  state.locked = true;
}

function unlockBodyScroll(state) {
  if (!state.locked) return;
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.overflow = "";
  window.scrollTo(0, state.scrollY || 0);
  state.locked = false;
}

export function mountFeedbackSheet({ db, auth, getUserName } = {}) {
  if (!db || !auth) {
    throw new Error("mountFeedbackSheet requires { db, auth }");
  }

  ensureStyles();
  injectMarkup();

  const els = {
    sheet: document.getElementById("feedbackSheet"),
    closeBtn: document.getElementById("fbCloseBtn"),
    type: document.getElementById("fbType"),
    message: document.getElementById("fbMessage"),
    hint: document.getElementById("fbHint"),
    submitBtn: document.getElementById("fbSubmitBtn"),
    successModal: document.getElementById("fbSuccessModal"),
    successOk: document.getElementById("fbSuccessOk"),
    errorModal: document.getElementById("fbErrorModal"),
    errorBody: document.getElementById("fbErrorBody"),
    errorOk: document.getElementById("fbErrorOk"),
  };

  const scrollState = { locked: false, scrollY: 0 };
  const nameCache = new Map();

  function anyOwnUiOpen() {
    return [els.sheet, els.successModal, els.errorModal].some((el) => el?.classList.contains("open"));
  }

  function openSheet() {
    els.sheet.classList.add("open");
    els.sheet.setAttribute("aria-hidden", "false");
    lockBodyScroll(scrollState);
  }

  function closeSheet() {
    els.sheet.classList.remove("open");
    els.sheet.setAttribute("aria-hidden", "true");
    if (!anyOwnUiOpen()) unlockBodyScroll(scrollState);
  }

  function openModal(el) {
    el.classList.add("open");
    el.setAttribute("aria-hidden", "false");
    lockBodyScroll(scrollState);
  }

  function closeModal(el) {
    el.classList.remove("open");
    el.setAttribute("aria-hidden", "true");
    if (!anyOwnUiOpen()) unlockBodyScroll(scrollState);
  }

  function resetForm() {
    els.type.value = "";
    els.message.value = "";
    els.message.disabled = true;
    els.hint.style.display = "";
    updateSubmitState();
  }

  function updateSubmitState() {
    const ok = !!els.type.value && els.message.value.trim().length > 0;
    els.submitBtn.disabled = !ok;
  }

  async function resolveUserName(uid) {
    if (typeof getUserName === "function") {
      const n = getUserName();
      if (n) return n;
    }
    if (nameCache.has(uid)) return nameCache.get(uid);
    let name = "مستخدم";
    try {
      const snap = await getDoc(doc(db, "teachers", uid));
      if (snap.exists()) {
        const d = snap.data() || {};
        name = d.name || d.fullName || d.displayName || d.email || name;
      }
    } catch (e) {
      console.error("[feedback] resolveUserName:", e);
    }
    nameCache.set(uid, name);
    return name;
  }

  els.type.addEventListener("change", () => {
    const has = !!els.type.value;
    els.message.disabled = !has;
    els.hint.style.display = has ? "none" : "";
    if (has) els.message.focus();
    updateSubmitState();
  });

  els.message.addEventListener("input", updateSubmitState);

  els.closeBtn.addEventListener("click", closeSheet);
  els.sheet.addEventListener("click", (e) => {
    if (e.target === els.sheet) closeSheet();
  });

  els.successModal.querySelector(".overlay").addEventListener("click", () => closeModal(els.successModal));
  els.successOk.addEventListener("click", () => closeModal(els.successModal));
  els.errorModal.querySelector(".overlay").addEventListener("click", () => closeModal(els.errorModal));
  els.errorOk.addEventListener("click", () => closeModal(els.errorModal));

  els.submitBtn.addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) return;
    const type = els.type.value;
    const message = els.message.value.trim();
    if (!type || !message) return;

    els.submitBtn.disabled = true;
    try {
      const name = await resolveUserName(user.uid);
      await addDoc(collection(db, "suggestions"), {
        type,
        message,
        createdByUid: user.uid,
        createdByName: name,
        isRead: false,
        createdAt: serverTimestamp(),
      });
      resetForm();
      closeSheet();
      openModal(els.successModal);
    } catch (e) {
      console.error("[feedback] submit failed:", e);
      els.errorBody.textContent = "حدث خطأ غير متوقع. تحقق من اتصالك وحاول مرة أخرى.";
      openModal(els.errorModal);
    } finally {
      updateSubmitState();
    }
  });

  return {
    open() {
      resetForm();
      openSheet();
    },
  };
}
