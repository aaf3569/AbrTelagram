const STYLE_ID = "telegram-settings-style";
const TELEGRAM_BACKEND_BASE_URL = "https://abrschool-bot.onrender.com";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .tg-settings-overlay {
      position: fixed;
      inset: 0;
      z-index: 2500;
      background: rgba(15, 23, 42, 0.45);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .tg-settings-overlay.open {
      display: flex;
    }
    .tg-settings-card {
      width: min(520px, 100%);
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      box-shadow: 0 20px 48px rgba(2, 43, 66, 0.22);
      padding: 18px;
      display: grid;
      gap: 12px;
      color: #0f172a;
      font-family: "Noto Kufi Arabic", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    }
    .tg-settings-title {
      margin: 0;
      font-size: 1.06rem;
      font-weight: 900;
      color: #022b42;
    }
    .tg-settings-row {
      display: grid;
      gap: 6px;
    }
    .tg-settings-label {
      font-size: 0.82rem;
      font-weight: 800;
      color: #64748b;
    }
    .tg-settings-value {
      min-height: 44px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #f8fafc;
      display: flex;
      align-items: center;
      padding: 0 12px;
      font-size: 0.92rem;
      font-weight: 700;
      word-break: break-word;
    }
    .tg-settings-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .tg-settings-btn {
      height: 42px;
      border-radius: 10px;
      border: 1px solid rgba(2, 43, 66, 0.22);
      background: #ffffff;
      color: #022b42;
      font-size: 0.9rem;
      font-weight: 800;
      cursor: pointer;
      padding: 0 14px;
      transition: transform 0.12s ease, box-shadow 0.12s ease;
    }
    .tg-settings-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 10px 22px rgba(2, 43, 66, 0.15);
    }
    .tg-settings-btn:disabled {
      opacity: 0.56;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }
    .tg-settings-btn.primary {
      color: #ffffff;
      border-color: #022b42;
      background: linear-gradient(145deg, #044563, #022b42);
    }
    .tg-settings-btn.danger {
      border-color: rgba(185, 28, 28, 0.28);
      color: #b91c1c;
    }
  `;
  document.head.appendChild(style);
}

function createModal() {
  const overlay = document.createElement("div");
  overlay.className = "tg-settings-overlay";
  overlay.innerHTML = `
    <section class="tg-settings-card" role="dialog" aria-modal="true" aria-label="User Settings">
      <h3 class="tg-settings-title">User Settings</h3>
      <div class="tg-settings-row">
        <div class="tg-settings-label">User name</div>
        <div class="tg-settings-value" data-field="name">-</div>
      </div>
      <div class="tg-settings-row">
        <div class="tg-settings-label">Telegram status</div>
        <div class="tg-settings-value" data-field="status">Loading...</div>
      </div>
      <div class="tg-settings-actions">
        <button type="button" class="tg-settings-btn danger" data-action="disconnect">Disconnect</button>
        <button type="button" class="tg-settings-btn primary" data-action="connect">Connect Telegram</button>
        <button type="button" class="tg-settings-btn" data-action="close">Close</button>
      </div>
    </section>
  `;

  const card = overlay.querySelector(".tg-settings-card");
  const nameField = overlay.querySelector('[data-field="name"]');
  const statusField = overlay.querySelector('[data-field="status"]');
  const connectBtn = overlay.querySelector('[data-action="connect"]');
  const disconnectBtn = overlay.querySelector('[data-action="disconnect"]');
  const closeBtn = overlay.querySelector('[data-action="close"]');

  return {
    overlay,
    card,
    nameField,
    statusField,
    connectBtn,
    disconnectBtn,
    closeBtn,
  };
}

function setButtonsDisabled(parts, disabled) {
  parts.connectBtn.disabled = disabled;
  parts.disconnectBtn.disabled = disabled;
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

export function mountTelegramSettings({ auth, getDisplayName } = {}) {
  const trigger = document.getElementById("telegramSettingsBtn");
  if (!trigger || trigger.dataset.telegramMounted === "1") return;
  trigger.dataset.telegramMounted = "1";

  ensureStyles();
  const parts = createModal();
  document.body.appendChild(parts.overlay);

  function openModal() {
    parts.overlay.classList.add("open");
  }

  function closeModal() {
    parts.overlay.classList.remove("open");
  }

  async function fetchConnectInfo() {
    const user = auth?.currentUser || null;
    if (!user) {
      parts.nameField.textContent = "-";
      parts.statusField.textContent = "Please log in first.";
      parts.connectBtn.disabled = false;
      parts.disconnectBtn.disabled = true;
      return;
    }

    const fallbackName = user.displayName || user.email || user.uid;
    const renderedName =
      typeof getDisplayName === "function" ? String(getDisplayName() || "").trim() : "";
    parts.nameField.textContent = renderedName || fallbackName;

    parts.statusField.textContent = "Tap Connect Telegram to link this user.";
    parts.connectBtn.textContent = "Connect Telegram";
    parts.connectBtn.disabled = false;
    parts.disconnectBtn.disabled = false;
  }

  async function disconnectTelegram() {
    const user = auth?.currentUser || null;
    const userId = user?.uid || "teacher123";
    setButtonsDisabled(parts, true);
    parts.statusField.textContent = "Disconnecting...";

    try {
      const response = await fetch(`${TELEGRAM_BACKEND_BASE_URL}/api/telegram/disconnect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId }),
      });
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
      parts.statusField.textContent = "Disconnected.";
      setButtonsDisabled(parts, false);
      parts.disconnectBtn.disabled = true;
    } catch (error) {
      console.error("Telegram disconnect error:", error.message);
      parts.statusField.textContent = "Disconnect failed. Try again.";
      setButtonsDisabled(parts, false);
    }
  }

  trigger.addEventListener("click", async () => {
    openModal();
    await fetchConnectInfo();
  });

  parts.connectBtn.addEventListener("click", async () => {
    const userId = auth?.currentUser?.uid || "teacher123";
    parts.statusField.textContent = "Preparing Telegram link...";
    setButtonsDisabled(parts, true);

    try {
      const url = await getTelegramConnectLink(userId);
      window.open(url, "_blank", "noopener,noreferrer");
      parts.statusField.textContent = "Telegram opened. Press Start in the bot.";
    } catch (error) {
      if (error.message === "ENDPOINT_NOT_FOUND") {
        parts.statusField.textContent = "Backend endpoint not found (404).";
      } else if (error.message === "NETWORK_ERROR") {
        parts.statusField.textContent = "Network error: cannot reach backend.";
      } else {
        parts.statusField.textContent = "Failed to create Telegram link.";
      }
      console.error("Telegram connect error:", error.message);
    } finally {
      setButtonsDisabled(parts, false);
    }
  });

  parts.disconnectBtn.addEventListener("click", async () => {
    await disconnectTelegram();
  });

  parts.closeBtn.addEventListener("click", closeModal);
  parts.overlay.addEventListener("click", (event) => {
    if (event.target === parts.overlay) closeModal();
  });
  parts.card.addEventListener("click", (event) => event.stopPropagation());
}
