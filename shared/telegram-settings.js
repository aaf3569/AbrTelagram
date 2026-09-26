import {
  getFirestore,
  doc,
  onSnapshot,
  getDoc,
  setDoc,
  serverTimestamp,
  onAuthStateChanged,
} from "/shared/firebase.js";

const STYLE_ID = "telegram-settings-style";
const PROMPT_STYLE_ID = "telegram-prompt-style";
const PROMPT_SEEN_COLLECTION = "telegram_prompt_seen";
const PROMPT_SEEN_LS_PREFIX = "abr_tg_prompt_seen_";
const SITE_NOTIF_HOST_ID = "abr-notif-popup-host";
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
      font-family: "Tajawal", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
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
    a.tg-settings-btn { text-decoration: none; box-sizing: border-box; }
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
          <a class="tg-settings-btn primary" data-field="openLink" href="#" target="_blank" rel="noopener noreferrer" hidden>
            <i class="fab fa-telegram-plane"></i>
            <span>افتح التلجرام</span>
          </a>
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
    openLink: overlay.querySelector('[data-field="openLink"]'),
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
  if (state !== "disconnected") parts.openLink.hidden = true;
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

export async function getTelegramConnectLink(userId, idToken) {
  const safeUserId = String(userId || "").trim();
  const endpoint =
    `${TELEGRAM_BACKEND_BASE_URL}/api/telegram/connect-link?userId=${encodeURIComponent(safeUserId)}`;

  const headers = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;

  let response;
  try {
    response = await fetch(endpoint, { method: "GET", headers });
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

const TELEGRAM_ICON_SVG = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M21.94 4.3 18.7 19.6c-.24 1.08-.88 1.35-1.79.84l-4.94-3.64-2.38 2.29c-.26.26-.49.49-1 .49l.36-5.03 9.15-8.27c.4-.36-.09-.55-.62-.2L6.17 13.2l-4.87-1.52c-1.06-.33-1.08-1.06.22-1.57l19.03-7.33c.88-.33 1.65.2 1.39 1.52z"/>
  </svg>`;

function ensurePromptStyles() {
  if (document.getElementById(PROMPT_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = PROMPT_STYLE_ID;
  style.textContent = `
    .tg-prompt-overlay {
      position: fixed;
      inset: 0;
      z-index: 9100;
      display: grid;
      place-items: center;
      padding: 16px;
      direction: rtl;
      font-family: "Tajawal", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      background: radial-gradient(circle at 50% 35%, rgba(34, 158, 217, 0.35), rgba(2, 20, 34, 0.78) 70%);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    .tg-prompt-overlay.open { opacity: 1; }
    .tg-prompt-card {
      position: relative;
      width: min(440px, 100%);
      max-height: calc(100dvh - 32px);
      overflow-y: auto;
      background: #ffffff;
      border-radius: 28px;
      box-shadow: 0 30px 80px rgba(0, 60, 100, 0.45), 0 0 0 4px rgba(42, 171, 238, 0.35);
      color: #0f172a;
      transform: translateY(40px) scale(0.85);
      opacity: 0;
    }
    .tg-prompt-overlay.open .tg-prompt-card {
      animation: tgPromptIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
                 tgPromptGlow 2.4s ease-in-out 0.6s infinite;
    }
    @keyframes tgPromptIn {
      to { transform: translateY(0) scale(1); opacity: 1; }
    }
    @keyframes tgPromptGlow {
      0%, 100% { box-shadow: 0 30px 80px rgba(0, 60, 100, 0.45), 0 0 0 4px rgba(42, 171, 238, 0.35); }
      50% { box-shadow: 0 30px 80px rgba(0, 60, 100, 0.45), 0 0 0 10px rgba(42, 171, 238, 0.18), 0 0 60px rgba(42, 171, 238, 0.55); }
    }
    .tg-prompt-hero {
      position: relative;
      background: linear-gradient(150deg, #2AABEE 0%, #229ED9 45%, #0a6fa8 100%);
      padding: 34px 20px 30px;
      display: grid;
      place-items: center;
      overflow: hidden;
    }
    .tg-prompt-hero::before,
    .tg-prompt-hero::after {
      content: "";
      position: absolute;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.12);
    }
    .tg-prompt-hero::before { width: 180px; height: 180px; top: -70px; right: -50px; }
    .tg-prompt-hero::after { width: 120px; height: 120px; bottom: -50px; left: -30px; }
    .tg-prompt-close {
      position: absolute;
      top: 14px;
      left: 14px;
      z-index: 2;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: rgba(255, 255, 255, 0.22);
      color: #ffffff;
      font-size: 1.3rem;
      line-height: 1;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease, transform 0.2s ease;
    }
    .tg-prompt-close:hover { background: rgba(255, 255, 255, 0.34); transform: rotate(90deg); }
    .tg-prompt-badge {
      position: absolute;
      top: 16px;
      right: 16px;
      z-index: 2;
      padding: 5px 12px;
      border-radius: 999px;
      background: #ffd43b;
      color: #5c3d00;
      font-size: 0.78rem;
      font-weight: 900;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
      animation: tgPromptWiggle 2.4s ease-in-out 1s infinite;
    }
    @keyframes tgPromptWiggle {
      0%, 80%, 100% { transform: rotate(0); }
      84% { transform: rotate(-8deg); }
      88% { transform: rotate(8deg); }
      92% { transform: rotate(-5deg); }
      96% { transform: rotate(5deg); }
    }
    .tg-prompt-logo {
      position: relative;
      z-index: 1;
      width: 96px;
      height: 96px;
      border-radius: 50%;
      background: #ffffff;
      color: #229ED9;
      display: grid;
      place-items: center;
      box-shadow: 0 14px 30px rgba(0, 40, 70, 0.3);
      animation: tgPromptFloat 3s ease-in-out infinite;
    }
    .tg-prompt-logo svg { width: 52px; height: 52px; margin-inline-end: 6px; }
    .tg-prompt-logo::before,
    .tg-prompt-logo::after {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 3px solid rgba(255, 255, 255, 0.8);
      animation: tgPromptRing 2.2s ease-out infinite;
    }
    .tg-prompt-logo::after { animation-delay: 1.1s; }
    @keyframes tgPromptRing {
      from { transform: scale(1); opacity: 0.9; }
      to { transform: scale(1.8); opacity: 0; }
    }
    @keyframes tgPromptFloat {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-8px); }
    }
    .tg-prompt-body {
      padding: 22px 24px 24px;
      text-align: center;
      display: grid;
      gap: 12px;
    }
    .tg-prompt-title {
      margin: 0;
      font-size: 1.4rem;
      font-weight: 900;
      color: #083b57;
      line-height: 1.5;
    }
    .tg-prompt-text {
      margin: 0;
      font-size: 0.98rem;
      font-weight: 600;
      color: #475569;
      line-height: 1.9;
    }
    .tg-prompt-perks {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
      margin: 4px 0 6px;
      padding: 0;
      list-style: none;
    }
    .tg-prompt-perks li {
      padding: 6px 12px;
      border-radius: 999px;
      background: #e8f6fd;
      color: #0a6fa8;
      font-size: 0.82rem;
      font-weight: 800;
    }
    .tg-prompt-connect {
      position: relative;
      overflow: hidden;
      width: 100%;
      min-height: 58px;
      border: none;
      border-radius: 16px;
      background: linear-gradient(145deg, #2AABEE, #1c8cc4);
      color: #ffffff;
      font-family: inherit;
      font-size: 1.1rem;
      font-weight: 900;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      box-shadow: 0 14px 30px rgba(34, 158, 217, 0.45);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      animation: tgPromptPulse 1.8s ease-in-out 0.8s infinite;
    }
    .tg-prompt-connect svg { width: 22px; height: 22px; }
    .tg-prompt-connect::after {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      width: 40%;
      left: -60%;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.45), transparent);
      transform: skewX(-20deg);
      animation: tgPromptShine 2.6s ease-in-out 1s infinite;
    }
    @keyframes tgPromptShine {
      0% { left: -60%; }
      60%, 100% { left: 130%; }
    }
    @keyframes tgPromptPulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.035); }
    }
    .tg-prompt-connect:hover { box-shadow: 0 18px 38px rgba(34, 158, 217, 0.6); }
    .tg-prompt-later {
      width: 100%;
      min-height: 46px;
      border: none;
      border-radius: 14px;
      background: transparent;
      color: #64748b;
      font-family: inherit;
      font-size: 0.95rem;
      font-weight: 800;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .tg-prompt-later:hover { background: #f1f5f9; color: #334155; }
    .tg-prompt-connect:focus-visible,
    .tg-prompt-later:focus-visible,
    .tg-prompt-close:focus-visible {
      outline: 3px solid rgba(34, 158, 217, 0.5);
      outline-offset: 2px;
    }
    @media (max-width: 480px) {
      .tg-prompt-hero { padding: 30px 16px 26px; }
      .tg-prompt-body { padding: 18px 18px 20px; }
      .tg-prompt-title { font-size: 1.22rem; }
    }
    @media (prefers-reduced-motion: reduce) {
      .tg-prompt-overlay *,
      .tg-prompt-overlay *::before,
      .tg-prompt-overlay *::after { animation: none !important; }
      .tg-prompt-overlay.open .tg-prompt-card { transform: none; opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

function hasSeenPromptLocally(uid) {
  try { return localStorage.getItem(PROMPT_SEEN_LS_PREFIX + uid) === "1"; } catch { return false; }
}

function rememberPromptSeen(db, uid, action) {
  try { localStorage.setItem(PROMPT_SEEN_LS_PREFIX + uid, "1"); } catch {}
  if (!db || !uid) return;
  setDoc(doc(db, PROMPT_SEEN_COLLECTION, uid), { action, seenAt: serverTimestamp() }).catch(() => {});
}

// The site-wide admin notification popup may be open on page load; wait for
// it to close so the two dialogs never stack on top of each other.
function waitForSiteNotificationPopup() {
  return new Promise((resolve) => {
    if (!document.getElementById(SITE_NOTIF_HOST_ID)) return resolve();
    const observer = new MutationObserver(() => {
      if (!document.getElementById(SITE_NOTIF_HOST_ID)) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(document.body, { childList: true });
  });
}

function showTelegramPrompt({ onConnect, onDismiss }) {
  ensurePromptStyles();

  const overlay = document.createElement("div");
  overlay.className = "tg-prompt-overlay";
  overlay.innerHTML = `
    <section class="tg-prompt-card" role="dialog" aria-modal="true" aria-labelledby="tgPromptTitle">
      <div class="tg-prompt-hero">
        <span class="tg-prompt-badge">🔔 جديد</span>
        <button type="button" class="tg-prompt-close" data-action="dismiss" aria-label="إغلاق">&times;</button>
        <div class="tg-prompt-logo">${TELEGRAM_ICON_SVG}</div>
      </div>
      <div class="tg-prompt-body">
        <h3 id="tgPromptTitle" class="tg-prompt-title">لا تفوّت أي إشعار بعد اليوم!</h3>
        <p class="tg-prompt-text">اربط حسابك بالتلجرام لتصلك الإشعارات والتنبيهات المهمة فوراً على هاتفك.</p>
        <ul class="tg-prompt-perks">
          <li>⚡ إشعارات فورية</li>
          <li>📱 على هاتفك مباشرة</li>
          <li>✅ بضغطة واحدة</li>
        </ul>
        <button type="button" class="tg-prompt-connect" data-action="connect">
          ${TELEGRAM_ICON_SVG}
          <span>ربط التلجرام الآن</span>
        </button>
        <button type="button" class="tg-prompt-later" data-action="dismiss">لاحقاً</button>
      </div>
    </section>
  `;

  document.body.appendChild(overlay);
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  let closed = false;
  function close(callback) {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeydown);
    overlay.classList.remove("open");
    document.body.style.overflow = previousOverflow;
    setTimeout(() => overlay.remove(), 300);
    callback();
  }
  function onKeydown(event) {
    if (event.key === "Escape") close(onDismiss);
  }

  overlay.querySelectorAll('[data-action="dismiss"]').forEach((btn) => {
    btn.addEventListener("click", () => close(onDismiss));
  });
  overlay.querySelector('[data-action="connect"]').addEventListener("click", () => close(onConnect));
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close(onDismiss);
  });
  document.addEventListener("keydown", onKeydown);

  requestAnimationFrame(() => {
    overlay.classList.add("open");
    overlay.querySelector('[data-action="connect"]')?.focus({ preventScroll: true });
  });
}

// Mobile browsers (Android Chrome, iOS Safari) only let a page open a new
// tab within a few seconds of a tap. The connect link comes from the Render
// backend, which can take 30-60s to wake up, so fetching it *after* the tap
// and then calling window.open gets silently blocked. The link is fixed per
// user (t.me/<bot>?start=connect_<uid>), so fetch it ahead of time and keep
// it, letting the tap open Telegram synchronously.
const CONNECT_LINK_LS_PREFIX = "abr_tg_connect_link_";
const connectLinkCache = new Map();
const connectLinkInflight = new Map();

function readCachedConnectLink(uid) {
  if (!uid) return "";
  if (connectLinkCache.has(uid)) return connectLinkCache.get(uid);
  try {
    const stored = localStorage.getItem(CONNECT_LINK_LS_PREFIX + uid) || "";
    if (stored.startsWith("https://t.me/")) {
      connectLinkCache.set(uid, stored);
      return stored;
    }
  } catch {}
  return "";
}

function prefetchConnectLink(user) {
  const uid = user?.uid;
  if (!uid) return Promise.reject(new Error("NO_USER"));
  const cached = readCachedConnectLink(uid);
  if (cached) return Promise.resolve(cached);
  if (connectLinkInflight.has(uid)) return connectLinkInflight.get(uid);

  const request = user.getIdToken()
    .then((idToken) => getTelegramConnectLink(uid, idToken))
    .then((url) => {
      connectLinkCache.set(uid, url);
      try { localStorage.setItem(CONNECT_LINK_LS_PREFIX + uid, url); } catch {}
      return url;
    })
    .finally(() => connectLinkInflight.delete(uid));
  connectLinkInflight.set(uid, request);
  return request;
}

// Must be called synchronously inside the tap handler. Returns true when a
// tab was opened (or the page is navigating to Telegram).
function openTelegramUrlNow(url) {
  const win = window.open(url, "_blank");
  if (win) {
    try { win.opener = null; } catch {}
    return true;
  }
  // Popup blocked (common in installed home-screen apps): go to t.me in
  // this tab instead, which hands off to the Telegram app.
  try {
    window.location.href = url;
    return true;
  } catch {
    return false;
  }
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
    prefetchConnectLink(user).catch(() => {});
  }

  function showOpenLink(url) {
    parts.openLink.href = url;
    parts.openLink.hidden = false;
  }

  function closeModal() {
    parts.overlay.classList.remove("open");
    isOpen = false;
    stopWatching();
    setMessage(parts, "");
  }

  // Must stay synchronous up to openTelegramUrlNow(): any await before it
  // loses the tap's permission to open a tab on phones.
  async function handleConnect() {
    const user = auth?.currentUser || null;
    if (!user) {
      setMessage(parts, "يرجى تسجيل الدخول أولاً.", "error");
      return;
    }

    const cachedUrl = readCachedConnectLink(user.uid);
    if (cachedUrl) {
      openTelegramUrlNow(cachedUrl);
      showOpenLink(cachedUrl);
      setMessage(
        parts,
        "تم فتح التلجرام. اضغط زر Start في البوت لإكمال الربط، وستتحدث الحالة هنا تلقائياً. إذا لم يفتح التلجرام، اضغط «افتح التلجرام».",
        "success"
      );
      return;
    }

    actionInProgress = true;
    parts.connectBtn.disabled = true;
    parts.disconnectBtn.disabled = true;
    parts.connectLabel.innerHTML = '<span class="tg-settings-spinner"></span> جاري تجهيز الرابط...';
    setMessage(parts, "جاري تجهيز رابط الربط مع التلجرام... قد يستغرق ذلك حتى دقيقة.", "info");

    try {
      // Too late to open a tab automatically now, so hand the user a real
      // link: tapping it is a fresh tap the browser always allows.
      const url = await prefetchConnectLink(user);
      showOpenLink(url);
      setMessage(
        parts,
        "الرابط جاهز! اضغط «افتح التلجرام» ثم اضغط زر Start في البوت لإكمال الربط.",
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
      const idToken = await user.getIdToken();
      const response = await fetch(`${TELEGRAM_BACKEND_BASE_URL}/api/telegram/disconnect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
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

  // One-time "connect Telegram" prompt, shown once per user ever: any
  // dismissal (لاحقاً, ×, backdrop, Escape) or connect records it in
  // telegram_prompt_seen/{uid} so it never returns, on any device.
  let promptChecked = false;
  async function maybeShowPrompt(user) {
    if (promptChecked || !user || !db) return;
    promptChecked = true;
    const uid = user.uid;
    if (hasSeenPromptLocally(uid)) return;

    try {
      const teacherSnap = await getDoc(doc(db, "teachers", uid));
      if (isConnectedDoc(teacherSnap.exists() ? teacherSnap.data() : null)) {
        rememberPromptSeen(db, uid, "already_connected");
        return;
      }
      const seenSnap = await getDoc(doc(db, PROMPT_SEEN_COLLECTION, uid));
      if (seenSnap.exists()) {
        try { localStorage.setItem(PROMPT_SEEN_LS_PREFIX + uid, "1"); } catch {}
        return;
      }
    } catch (error) {
      // Can't confirm it wasn't shown already; skip rather than risk a repeat.
      console.warn("[telegram-settings] prompt check failed:", error?.message || error);
      return;
    }

    // Let the page finish rendering after login before interrupting.
    await new Promise((resolve) => setTimeout(resolve, 900));
    await waitForSiteNotificationPopup();
    if (auth?.currentUser?.uid !== uid) return;

    showTelegramPrompt({
      onConnect: () => {
        rememberPromptSeen(db, uid, "connect");
        openModal();
        handleConnect();
      },
      onDismiss: () => rememberPromptSeen(db, uid, "later"),
    });
  }

  if (auth) {
    try {
      onAuthStateChanged(auth, (user) => {
        if (user) prefetchConnectLink(user).catch(() => {});
        maybeShowPrompt(user);
      });
    } catch (error) {
      console.warn("[telegram-settings] auth listener failed:", error?.message || error);
    }
  }
}
