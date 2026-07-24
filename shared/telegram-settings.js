import { getFirestore, doc, onSnapshot, getDoc } from "/shared/firebase.js";

const STYLE_ID = "telegram-settings-style";
const TELEGRAM_BACKEND_BASE_URL = "https://abrschool-bot.onrender.com";

// Render's free tier sleeps the backend after ~15min idle, so the first
// connect/disconnect request after a gap can take 30-60s. Pinging a
// lightweight health route as soon as this module loads (well before the
// user actually clicks connect/disconnect) gives it a head start waking up.
let backendWarmupStarted = false;
function warmBackend() {
  if (backendWarmupStarted) return;
  backendWarmupStarted = true;
  fetch(`${TELEGRAM_BACKEND_BASE_URL}/api/health`, { method: "GET" }).catch(() => {});
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .tg-settings-overlay {
      position: fixed;
      inset: 0;
      z-index: 2500;
      background: rgba(2, 24, 38, 0.55);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
      direction: rtl;
      font-family: "Noto Kufi Arabic", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .tg-settings-overlay.open {
      display: flex;
      opacity: 1;
    }
    .tg-settings-card {
      width: min(480px, 100%);
      background: #ffffff;
      border-radius: 22px;
      box-shadow: 0 28px 60px rgba(2, 43, 66, 0.28);
      overflow: hidden;
      color: #0f172a;
      transform: translateY(12px) scale(0.98);
      opacity: 0;
      transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease;
    }
    .tg-settings-overlay.open .tg-settings-card {
      transform: translateY(0) scale(1);
      opacity: 1;
    }
    .tg-settings-header {
      background: linear-gradient(145deg, #033C54 0%, #065372 60%, #0a5f80 100%);
      color: #ffffff;
      padding: 20px 22px;
      display: flex;
      align-items: center;
      gap: 14px;
      position: relative;
    }
    .tg-settings-header-icon {
      width: 46px;
      height: 46px;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.16);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
      flex-shrink: 0;
    }
    .tg-settings-header-text {
      display: grid;
      gap: 2px;
      flex: 1;
      min-width: 0;
    }
    .tg-settings-title {
      margin: 0;
      font-size: 1.12rem;
      font-weight: 900;
      letter-spacing: 0.2px;
    }
    .tg-settings-subtitle {
      margin: 0;
      font-size: 0.78rem;
      font-weight: 600;
      opacity: 0.82;
    }
    .tg-settings-close {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      border: none;
      background: rgba(255, 255, 255, 0.14);
      color: #ffffff;
      font-size: 0.95rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease, transform 0.15s ease;
      flex-shrink: 0;
      margin-inline-start: auto;
    }
    .tg-settings-close:hover {
      background: rgba(255, 255, 255, 0.24);
      transform: rotate(90deg);
    }
    .tg-settings-body {
      padding: 18px 22px 22px;
      display: grid;
      gap: 16px;
    }
    .tg-settings-status-card {
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 14px 16px;
      background: linear-gradient(145deg, #f8fbfe, #f1f7fb);
      display: flex;
      align-items: center;
      gap: 14px;
      transition: border-color 0.2s ease, background 0.2s ease;
    }
    .tg-settings-status-card.is-connected {
      border-color: #bbe7cf;
      background: linear-gradient(145deg, #f1fbf5, #e6f7ec);
    }
    .tg-settings-status-card.is-disconnected {
      border-color: #f3d7d7;
      background: linear-gradient(145deg, #fdf4f4, #faeaea);
    }
    .tg-settings-status-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.1rem;
      color: #ffffff;
      background: #94a3b8;
      flex-shrink: 0;
      transition: background 0.2s ease;
    }
    .tg-settings-status-card.is-connected .tg-settings-status-icon {
      background: linear-gradient(135deg, #16a34a, #0f8a4b);
    }
    .tg-settings-status-card.is-disconnected .tg-settings-status-icon {
      background: linear-gradient(135deg, #dc2626, #b91c1c);
    }
    .tg-settings-status-content {
      display: grid;
      gap: 4px;
      min-width: 0;
      flex: 1;
    }
    .tg-settings-status-label {
      font-size: 0.78rem;
      font-weight: 700;
      color: #64748b;
    }
    .tg-settings-status-value {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 1rem;
      font-weight: 800;
      color: #0f172a;
    }
    .tg-settings-status-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #94a3b8;
      box-shadow: 0 0 0 4px rgba(148, 163, 184, 0.2);
      flex-shrink: 0;
    }
    .tg-settings-status-card.is-connected .tg-settings-status-dot {
      background: #16a34a;
      box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.18);
      animation: tgPulse 1.8s ease-in-out infinite;
    }
    .tg-settings-status-card.is-disconnected .tg-settings-status-dot {
      background: #dc2626;
      box-shadow: 0 0 0 4px rgba(220, 38, 38, 0.18);
    }
    @keyframes tgPulse {
      0%, 100% { box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.18); }
      50% { box-shadow: 0 0 0 7px rgba(22, 163, 74, 0.08); }
    }
    .tg-settings-message {
      font-size: 0.85rem;
      font-weight: 600;
      color: #475569;
      padding: 10px 12px;
      border-radius: 10px;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      display: none;
      line-height: 1.6;
    }
    .tg-settings-message.show {
      display: block;
    }
    .tg-settings-message.info {
      color: #033C54;
      background: #eaf3f9;
      border-color: #cbe3f0;
    }
    .tg-settings-message.success {
      color: #0f8a4b;
      background: #ecfaf1;
      border-color: #c4ecd1;
    }
    .tg-settings-message.error {
      color: #b91c1c;
      background: #fdecec;
      border-color: #f3c8c8;
    }
    .tg-settings-actions {
      display: grid;
      gap: 10px;
    }
    .tg-settings-btn {
      width: 100%;
      height: 48px;
      border-radius: 12px;
      border: 1px solid rgba(2, 43, 66, 0.18);
      background: #ffffff;
      color: #022b42;
      font-family: inherit;
      font-size: 0.95rem;
      font-weight: 800;
      cursor: pointer;
      padding: 0 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      transition: transform 0.14s ease, box-shadow 0.14s ease, background 0.14s ease, border-color 0.14s ease, opacity 0.14s ease;
    }
    .tg-settings-btn i {
      font-size: 1rem;
    }
    .tg-settings-btn:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 12px 24px rgba(2, 43, 66, 0.14);
    }
    .tg-settings-btn:active:not(:disabled) {
      transform: translateY(0);
    }
    .tg-settings-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .tg-settings-btn.primary {
      color: #ffffff;
      border-color: transparent;
      background: linear-gradient(145deg, #0a5f80, #033C54);
      box-shadow: 0 8px 18px rgba(3, 60, 84, 0.25);
    }
    .tg-settings-btn.primary:hover:not(:disabled) {
      box-shadow: 0 14px 26px rgba(3, 60, 84, 0.32);
    }
    .tg-settings-btn.danger {
      border-color: rgba(185, 28, 28, 0.32);
      color: #b91c1c;
      background: #fff5f5;
    }
    .tg-settings-btn.danger:hover:not(:disabled) {
      background: #ffeaea;
      box-shadow: 0 12px 24px rgba(185, 28, 28, 0.18);
    }
    .tg-settings-btn[hidden] { display: none !important; }
    .tg-settings-spinner {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 2px solid currentColor;
      border-top-color: transparent;
      animation: tgSpin 0.8s linear infinite;
      display: inline-block;
    }
    @keyframes tgSpin { to { transform: rotate(360deg); } }
    @media (max-width: 480px) {
      .tg-settings-header { padding: 18px 18px; }
      .tg-settings-body { padding: 16px 18px 20px; }
      .tg-settings-title { font-size: 1.04rem; }
    }
  `;
  document.head.appendChild(style);
}

function createModal() {
  const overlay = document.createElement("div");
  overlay.className = "tg-settings-overlay";
  overlay.innerHTML = `
    <section class="tg-settings-card" role="dialog" aria-modal="true" aria-label="إعدادات المستخدم">
      <header class="tg-settings-header">
        <div class="tg-settings-header-icon"><i class="fas fa-user-gear"></i></div>
        <div class="tg-settings-header-text">
          <h3 class="tg-settings-title">إعدادات المستخدم</h3>
          <p class="tg-settings-subtitle">إدارة ربط حسابك بالتلجرام</p>
        </div>
        <button type="button" class="tg-settings-close" data-action="close" aria-label="إغلاق">
          <i class="fas fa-xmark"></i>
        </button>
      </header>
      <div class="tg-settings-body">
        <div class="tg-settings-status-card" data-field="statusCard">
          <div class="tg-settings-status-icon" data-field="statusIcon"><i class="fab fa-telegram-plane"></i></div>
          <div class="tg-settings-status-content">
            <span class="tg-settings-status-label">حالة الاتصال بالتلجرام</span>
            <span class="tg-settings-status-value">
              <span class="tg-settings-status-dot"></span>
              <span data-field="statusText">جاري التحقق...</span>
            </span>
          </div>
        </div>
        <div class="tg-settings-message" data-field="message"></div>
        <div class="tg-settings-actions">
          <button type="button" class="tg-settings-btn primary" data-action="connect" hidden>
            <i class="fab fa-telegram-plane"></i>
            <span data-field="connectLabel">ربط حساب التلجرام</span>
          </button>
          <button type="button" class="tg-settings-btn danger" data-action="disconnect" hidden>
            <i class="fas fa-link-slash"></i>
            <span data-field="disconnectLabel">إلغاء ربط التلجرام</span>
          </button>
        </div>
      </div>
    </section>
  `;

  return {
    overlay,
    card: overlay.querySelector(".tg-settings-card"),
    statusCard: overlay.querySelector('[data-field="statusCard"]'),
    statusIcon: overlay.querySelector('[data-field="statusIcon"]'),
    statusText: overlay.querySelector('[data-field="statusText"]'),
    messageBox: overlay.querySelector('[data-field="message"]'),
    connectBtn: overlay.querySelector('[data-action="connect"]'),
    disconnectBtn: overlay.querySelector('[data-action="disconnect"]'),
    connectLabel: overlay.querySelector('[data-field="connectLabel"]'),
    disconnectLabel: overlay.querySelector('[data-field="disconnectLabel"]'),
    closeBtn: overlay.querySelector('[data-action="close"]'),
  };
}

function setMessage(parts, text, kind = "info") {
  if (!text) {
    parts.messageBox.textContent = "";
    parts.messageBox.className = "tg-settings-message";
    return;
  }
  parts.messageBox.textContent = text;
  parts.messageBox.className = `tg-settings-message show ${kind}`;
}

function applyStatusUI(parts, state) {
  parts.statusCard.classList.remove("is-connected", "is-disconnected");
  if (state === "connected") {
    parts.statusCard.classList.add("is-connected");
    parts.statusText.textContent = "متصل";
    parts.connectBtn.hidden = true;
    parts.disconnectBtn.hidden = false;
  } else if (state === "disconnected") {
    parts.statusCard.classList.add("is-disconnected");
    parts.statusText.textContent = "غير متصل";
    parts.connectBtn.hidden = false;
    parts.disconnectBtn.hidden = true;
  } else {
    parts.statusText.textContent = "جاري التحقق...";
    parts.connectBtn.hidden = true;
    parts.disconnectBtn.hidden = true;
  }
}

export async function getTelegramConnectLink(userId = "teacher123") {
  const safeUserId = String(userId || "teacher123").trim() || "teacher123";
  const endpoint =
    `${TELEGRAM_BACKEND_BASE_URL}/api/telegram/connect-link?userId=${encodeURIComponent(safeUserId)}`;

  let response;
  try {
    response = await fetch(endpoint, { method: "GET" });
  } catch (error) {
    throw new Error("NETWORK_ERROR");
  }

  if (response.status === 404) {
    throw new Error("ENDPOINT_NOT_FOUND");
  }
  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }

  const data = await response.json();
  const url = String(data?.url || "").trim();
  if (!url) {
    throw new Error("INVALID_RESPONSE");
  }
  return url;
}

function isConnectedDoc(data) {
  if (!data) return false;
  if (data.telegramConnected === true) return true;
  if (data.telegram && data.telegram.connected === true) return true;
  const chatId = String(data.telegramChatId || data.telegram?.chatId || "").trim();
  return chatId.length > 0;
}

function resolveTrigger({ slotId = "telegramSettingsSlot", extraClass = "" } = {}) {
  const slot = document.getElementById(slotId);
  if (slot) {
    if (slot.dataset.telegramMounted === "1") return null;
    slot.dataset.telegramMounted = "1";
    const button = document.createElement("button");
    button.type = "button";
    button.id = "telegramSettingsBtn";
    button.className = ["btn", "ghost", extraClass].filter(Boolean).join(" ");
    button.textContent = "إعدادات المستخدم";
    slot.replaceWith(button);
    return button;
  }

  // Legacy fallback: pages that still hand-write the <button> tag themselves.
  const legacyButton = document.getElementById("telegramSettingsBtn");
  if (!legacyButton || legacyButton.dataset.telegramMounted === "1") return null;
  legacyButton.dataset.telegramMounted = "1";
  return legacyButton;
}

export function mountTelegramSettings({ auth, slotId, extraClass } = {}) {
  warmBackend();

  const trigger = resolveTrigger({ slotId, extraClass });
  if (!trigger) return;

  ensureStyles();
  const parts = createModal();
  document.body.appendChild(parts.overlay);

  let db = null;
  try {
    if (auth?.app) db = getFirestore(auth.app);
  } catch (error) {
    console.warn("[telegram-settings] failed to init Firestore:", error?.message || error);
  }

  let unsubscribe = null;
  let isOpen = false;
  let lastKnownConnected = null;
  let actionInProgress = false;

  function stopWatching() {
    if (typeof unsubscribe === "function") {
      try { unsubscribe(); } catch (_) {}
    }
    unsubscribe = null;
  }

  function watchStatus(uid) {
    stopWatching();
    if (!db || !uid) return;
    try {
      const ref = doc(db, "teachers", uid);
      unsubscribe = onSnapshot(
        ref,
        (snap) => {
          const data = snap.exists() ? snap.data() : null;
          const connected = isConnectedDoc(data);
          lastKnownConnected = connected;
          if (!actionInProgress) {
            applyStatusUI(parts, connected ? "connected" : "disconnected");
          }
        },
        (error) => {
          console.error("[telegram-settings] snapshot error:", error?.message || error);
          if (!actionInProgress && lastKnownConnected === null) {
            applyStatusUI(parts, "disconnected");
            setMessage(parts, "تعذر التحقق من حالة الاتصال. تأكد من اتصالك بالإنترنت.", "error");
          }
        }
      );
    } catch (error) {
      console.error("[telegram-settings] watch failed:", error?.message || error);
    }
  }

  async function fetchInitialStatus(uid) {
    if (!db || !uid) return null;
    try {
      const snap = await getDoc(doc(db, "teachers", uid));
      const data = snap.exists() ? snap.data() : null;
      const connected = isConnectedDoc(data);
      lastKnownConnected = connected;
      applyStatusUI(parts, connected ? "connected" : "disconnected");
      return connected;
    } catch (error) {
      console.error("[telegram-settings] initial fetch failed:", error?.message || error);
      return null;
    }
  }

  function openModal() {
    parts.overlay.classList.add("open");
    isOpen = true;
    setMessage(parts, "");
    applyStatusUI(parts, "loading");

    const user = auth?.currentUser || null;
    if (!user) {
      applyStatusUI(parts, "disconnected");
      setMessage(parts, "يرجى تسجيل الدخول أولاً.", "error");
      return;
    }

    fetchInitialStatus(user.uid);
    watchStatus(user.uid);
  }

  function closeModal() {
    parts.overlay.classList.remove("open");
    isOpen = false;
    stopWatching();
    setMessage(parts, "");
  }

  async function handleConnect() {
    const user = auth?.currentUser || null;
    if (!user) {
      setMessage(parts, "يرجى تسجيل الدخول أولاً.", "error");
      return;
    }

    actionInProgress = true;
    parts.connectBtn.disabled = true;
    parts.disconnectBtn.disabled = true;
    parts.connectLabel.innerHTML = '<span class="tg-settings-spinner"></span> جاري تجهيز الرابط...';
    setMessage(parts, "جاري إنشاء رابط الربط مع التلجرام...", "info");

    try {
      const url = await getTelegramConnectLink(user.uid);
      window.open(url, "_blank", "noopener,noreferrer");
      setMessage(
        parts,
        "تم فتح التلجرام في نافذة جديدة. اضغط زر Start في البوت لإكمال الربط، وستتحدث الحالة هنا تلقائياً.",
        "success"
      );
    } catch (error) {
      console.error("Telegram connect error:", error.message);
      if (error.message === "ENDPOINT_NOT_FOUND") {
        setMessage(parts, "لم يتم العثور على نقطة الربط في الخادم (404).", "error");
      } else if (error.message === "NETWORK_ERROR") {
        setMessage(parts, "خطأ في الشبكة: لا يمكن الوصول للخادم. تأكد من الاتصال بالإنترنت.", "error");
      } else {
        setMessage(parts, "تعذر إنشاء رابط التلجرام. حاول مرة أخرى.", "error");
      }
    } finally {
      parts.connectLabel.textContent = "ربط حساب التلجرام";
      parts.connectBtn.disabled = false;
      parts.disconnectBtn.disabled = false;
      actionInProgress = false;
      if (lastKnownConnected !== null) {
        applyStatusUI(parts, lastKnownConnected ? "connected" : "disconnected");
      }
    }
  }

  async function handleDisconnect() {
    const user = auth?.currentUser || null;
    if (!user) {
      setMessage(parts, "يرجى تسجيل الدخول أولاً.", "error");
      return;
    }

    actionInProgress = true;
    parts.connectBtn.disabled = true;
    parts.disconnectBtn.disabled = true;
    parts.disconnectLabel.innerHTML = '<span class="tg-settings-spinner"></span> جاري إلغاء الربط...';
    setMessage(parts, "جاري إلغاء ربط التلجرام...", "info");

    try {
      const response = await fetch(`${TELEGRAM_BACKEND_BASE_URL}/api/telegram/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.uid }),
      });
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
      lastKnownConnected = false;
      applyStatusUI(parts, "disconnected");
      setMessage(parts, "تم إلغاء الربط بنجاح.", "success");
    } catch (error) {
      console.error("Telegram disconnect error:", error.message);
      setMessage(parts, "فشل إلغاء الربط. حاول مرة أخرى.", "error");
      if (lastKnownConnected !== null) {
        applyStatusUI(parts, lastKnownConnected ? "connected" : "disconnected");
      }
    } finally {
      parts.disconnectLabel.textContent = "إلغاء ربط التلجرام";
      parts.connectBtn.disabled = false;
      parts.disconnectBtn.disabled = false;
      actionInProgress = false;
    }
  }

  trigger.addEventListener("click", openModal);
  parts.connectBtn.addEventListener("click", handleConnect);
  parts.disconnectBtn.addEventListener("click", handleDisconnect);
  parts.closeBtn.addEventListener("click", closeModal);
  parts.overlay.addEventListener("click", (event) => {
    if (event.target === parts.overlay) closeModal();
  });
  parts.card.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen) closeModal();
  });
}
