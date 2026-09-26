const POPUP_STYLE_ID = "abr-action-popup-style";
const POPUP_HOST_ID = "abr-action-popup-host";

let popupRefs = null;
let activeResolver = null;
let lastFocusedElement = null;
let hideTimerId = null;

function ensurePopupStyles() {
  if (document.getElementById(POPUP_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = POPUP_STYLE_ID;
  style.textContent = `
    #${POPUP_HOST_ID} {
      position: fixed;
      inset: 0;
      z-index: 5000;
      display: grid;
      place-items: center;
      padding: 16px;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity .2s ease, visibility .2s ease;
    }

    #${POPUP_HOST_ID}.is-open {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
    }

    #${POPUP_HOST_ID} .abr-popup-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(5, 15, 35, 0.56);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
    }

    #${POPUP_HOST_ID} .abr-popup-dialog {
      --abr-accent: #0b5f88;
      --abr-accent-2: #0f7cb0;
      --abr-accent-soft: #e6f1f8;
      --abr-accent-glow: rgba(11, 95, 136, 0.32);
      position: relative;
      width: min(360px, calc(100vw - 32px));
      border-radius: 24px;
      border: 1px solid #dbe7f2;
      background: #ffffff;
      box-shadow: 0 30px 70px rgba(10, 30, 60, 0.32);
      padding: 30px 22px 20px;
      transform: translateY(12px) scale(0.96);
      opacity: 0;
      transition: transform .24s cubic-bezier(.22,.7,.25,1), opacity .2s ease;
      font-family: var(--app-font, "Tajawal", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif);
      direction: rtl;
      text-align: center;
      overflow: hidden;
    }

    /* Soft accent wash behind the icon. */
    #${POPUP_HOST_ID} .abr-popup-dialog::before {
      content: "";
      position: absolute;
      top: -70px;
      left: 50%;
      width: 240px;
      height: 170px;
      transform: translateX(-50%);
      background: radial-gradient(closest-side, var(--abr-accent-soft), transparent);
      pointer-events: none;
    }

    #${POPUP_HOST_ID}.is-open .abr-popup-dialog {
      transform: translateY(0) scale(1);
      opacity: 1;
    }

    #${POPUP_HOST_ID} .abr-popup-icon {
      position: relative;
      width: 68px;
      height: 68px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      margin: 0 auto 16px;
      background: linear-gradient(145deg, var(--abr-accent), var(--abr-accent-2));
      color: #fff;
      font-size: 26px;
      font-weight: 900;
      box-shadow: 0 14px 30px var(--abr-accent-glow), 0 0 0 8px var(--abr-accent-soft);
    }

    #${POPUP_HOST_ID} .abr-popup-icon svg {
      width: 30px;
      height: 30px;
      stroke: currentColor;
      fill: none;
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    #${POPUP_HOST_ID} .abr-popup-title {
      position: relative;
      margin: 0 0 8px;
      color: #0a2f47;
      font-size: 1.2rem;
      font-weight: 900;
      line-height: 1.5;
    }

    #${POPUP_HOST_ID} .abr-popup-message {
      position: relative;
      margin: 0 auto;
      max-width: 290px;
      color: #4a6478;
      font-size: 0.95rem;
      font-weight: 600;
      line-height: 1.85;
    }

    #${POPUP_HOST_ID} .abr-popup-actions {
      position: relative;
      margin-top: 22px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    #${POPUP_HOST_ID} .abr-popup-btn {
      border: 0;
      border-radius: 14px;
      min-height: 50px;
      padding: 0 12px;
      font-family: inherit;
      font-weight: 800;
      font-size: 0.95rem;
      cursor: pointer;
      transition: transform .14s ease, box-shadow .14s ease, background-color .14s ease;
    }

    #${POPUP_HOST_ID} .abr-popup-btn:focus-visible {
      outline: 3px solid var(--abr-accent-glow);
      outline-offset: 2px;
    }

    #${POPUP_HOST_ID} .abr-popup-btn:active {
      transform: translateY(1px);
    }

    #${POPUP_HOST_ID} .abr-popup-btn.cancel {
      background: #f1f5f9;
      color: #33526a;
      border: 1px solid #dbe5ee;
    }

    #${POPUP_HOST_ID} .abr-popup-btn.cancel:hover {
      background: #e6edf4;
    }

    #${POPUP_HOST_ID} .abr-popup-btn.confirm {
      background: linear-gradient(145deg, var(--abr-accent), var(--abr-accent-2));
      color: #fff;
      box-shadow: 0 12px 26px var(--abr-accent-glow);
    }

    #${POPUP_HOST_ID} .abr-popup-btn.confirm:hover {
      transform: translateY(-1px);
      box-shadow: 0 16px 32px var(--abr-accent-glow);
    }

    #${POPUP_HOST_ID}.is-danger .abr-popup-dialog {
      --abr-accent: #b42318;
      --abr-accent-2: #dc2626;
      --abr-accent-soft: #fdeceb;
      --abr-accent-glow: rgba(180, 35, 24, 0.32);
      border-color: #f4d3d3;
    }

    #${POPUP_HOST_ID}.is-danger .abr-popup-title {
      color: #8f1d1f;
    }

    #${POPUP_HOST_ID}.is-danger .abr-popup-message {
      color: #7f3a3a;
    }

    @media (max-width: 480px) {
      #${POPUP_HOST_ID} .abr-popup-dialog {
        padding: 26px 18px 18px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      #${POPUP_HOST_ID} .abr-popup-dialog,
      #${POPUP_HOST_ID} .abr-popup-btn {
        transition: none;
      }
    }
  `;

  document.head.appendChild(style);
}

const POPUP_ICONS = {
  "↩": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
  "!": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L14.1 3.9a2 2 0 0 0-3.6 0Z"/></svg>',
  "؟": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5"/><path d="M12 17.5h.01"/></svg>'
};

function setPopupIcon(el, icon) {
  if (POPUP_ICONS[icon]) el.innerHTML = POPUP_ICONS[icon];
  else el.textContent = icon;
}

function closePopup(confirmed) {
  if (!popupRefs || !activeResolver) return;

  const resolve = activeResolver;
  activeResolver = null;

  if (hideTimerId) {
    window.clearTimeout(hideTimerId);
    hideTimerId = null;
  }

  popupRefs.host.classList.remove("is-open");

  hideTimerId = window.setTimeout(() => {
    popupRefs.host.hidden = true;
    popupRefs.host.setAttribute("aria-hidden", "true");
    hideTimerId = null;
  }, 220);

  document.removeEventListener("keydown", handleKeydown, true);

  const previousFocus = lastFocusedElement;
  lastFocusedElement = null;
  if (previousFocus && typeof previousFocus.focus === "function") {
    previousFocus.focus({ preventScroll: true });
  }

  resolve(Boolean(confirmed));
}

function handleKeydown(event) {
  if (!activeResolver) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closePopup(false);
  }
}

function ensurePopup() {
  if (popupRefs) return popupRefs;

  ensurePopupStyles();

  const host = document.createElement("div");
  host.id = POPUP_HOST_ID;
  host.hidden = true;
  host.setAttribute("aria-hidden", "true");
  host.innerHTML = `
    <div class="abr-popup-backdrop"></div>
    <div class="abr-popup-dialog" role="dialog" aria-modal="true" aria-labelledby="abrPopupTitle" aria-describedby="abrPopupMessage">
      <div class="abr-popup-icon" aria-hidden="true">؟</div>
      <h3 id="abrPopupTitle" class="abr-popup-title"></h3>
      <p id="abrPopupMessage" class="abr-popup-message"></p>
      <div class="abr-popup-actions">
        <button type="button" class="abr-popup-btn cancel"></button>
        <button type="button" class="abr-popup-btn confirm"></button>
      </div>
    </div>
  `;

  document.body.appendChild(host);

  const backdrop = host.querySelector(".abr-popup-backdrop");
  const cancelBtn = host.querySelector(".abr-popup-btn.cancel");
  const confirmBtn = host.querySelector(".abr-popup-btn.confirm");

  backdrop.addEventListener("click", () => closePopup(false));
  cancelBtn.addEventListener("click", () => closePopup(false));
  confirmBtn.addEventListener("click", () => closePopup(true));

  popupRefs = {
    host,
    icon: host.querySelector(".abr-popup-icon"),
    title: host.querySelector("#abrPopupTitle"),
    message: host.querySelector("#abrPopupMessage"),
    cancelBtn,
    confirmBtn
  };

  return popupRefs;
}

export function showActionPopup(options = {}) {
  const refs = ensurePopup();

  if (activeResolver) {
    closePopup(false);
  }

  if (hideTimerId) {
    window.clearTimeout(hideTimerId);
    hideTimerId = null;
  }

  const variant = options.variant === "danger" ? "danger" : "default";
  refs.host.classList.toggle("is-danger", variant === "danger");
  setPopupIcon(refs.icon, options.icon || (variant === "danger" ? "!" : "؟"));
  refs.title.textContent = options.title || "تأكيد";
  refs.message.textContent = options.message || "هل تريد المتابعة؟";
  refs.cancelBtn.textContent = options.cancelText || "إلغاء";
  refs.confirmBtn.textContent = options.confirmText || "تأكيد";

  refs.host.hidden = false;
  refs.host.setAttribute("aria-hidden", "false");

  lastFocusedElement = document.activeElement;

  document.addEventListener("keydown", handleKeydown, true);
  window.requestAnimationFrame(() => {
    refs.host.classList.add("is-open");
    refs.confirmBtn.focus({ preventScroll: true });
  });

  return new Promise((resolve) => {
    activeResolver = resolve;
  });
}
