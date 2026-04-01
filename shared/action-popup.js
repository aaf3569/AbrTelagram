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
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }

    #${POPUP_HOST_ID} .abr-popup-dialog {
      position: relative;
      width: min(460px, calc(100vw - 28px));
      border-radius: 20px;
      border: 1px solid #d9e7f5;
      background: linear-gradient(180deg, #ffffff 0%, #f7fbff 100%);
      box-shadow: 0 24px 55px rgba(15, 40, 75, 0.28);
      padding: 22px 20px 18px;
      transform: translateY(8px) scale(0.97);
      opacity: 0;
      transition: transform .2s ease, opacity .2s ease;
      font-family: "Noto Kufi Arabic", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      direction: rtl;
      text-align: right;
    }

    #${POPUP_HOST_ID}.is-open .abr-popup-dialog {
      transform: translateY(0) scale(1);
      opacity: 1;
    }

    #${POPUP_HOST_ID} .abr-popup-icon {
      width: 46px;
      height: 46px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      margin-bottom: 12px;
      background: linear-gradient(135deg, #0b5f88, #0f7cb0);
      color: #fff;
      font-size: 22px;
      font-weight: 900;
      box-shadow: 0 12px 26px rgba(11, 95, 136, 0.35);
    }

    #${POPUP_HOST_ID} .abr-popup-title {
      margin: 0 0 8px;
      color: #083b57;
      font-size: 1.1rem;
      font-weight: 900;
      line-height: 1.5;
    }

    #${POPUP_HOST_ID} .abr-popup-message {
      margin: 0;
      color: #35546b;
      font-size: 0.94rem;
      line-height: 1.9;
    }

    #${POPUP_HOST_ID} .abr-popup-actions {
      margin-top: 18px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-start;
    }

    #${POPUP_HOST_ID} .abr-popup-btn {
      border: 0;
      border-radius: 12px;
      min-height: 44px;
      padding: 0 14px;
      font-family: inherit;
      font-weight: 800;
      font-size: 0.93rem;
      cursor: pointer;
      transition: transform .14s ease, box-shadow .14s ease, opacity .14s ease;
    }

    #${POPUP_HOST_ID} .abr-popup-btn:focus-visible {
      outline: 3px solid rgba(11, 95, 136, 0.35);
      outline-offset: 2px;
    }

    #${POPUP_HOST_ID} .abr-popup-btn:active {
      transform: translateY(1px);
    }

    #${POPUP_HOST_ID} .abr-popup-btn.cancel {
      background: #f2f7fc;
      color: #24465d;
      border: 1px solid #d8e5f2;
    }

    #${POPUP_HOST_ID} .abr-popup-btn.cancel:hover {
      background: #e8f1fa;
    }

    #${POPUP_HOST_ID} .abr-popup-btn.confirm {
      background: linear-gradient(145deg, #0b5f88, #0f7cb0);
      color: #fff;
      box-shadow: 0 12px 25px rgba(11, 95, 136, 0.3);
    }

    #${POPUP_HOST_ID} .abr-popup-btn.confirm:hover {
      transform: translateY(-1px);
      box-shadow: 0 15px 30px rgba(11, 95, 136, 0.36);
    }

    #${POPUP_HOST_ID}.is-danger .abr-popup-dialog {
      border-color: #f4c7c9;
      background: linear-gradient(180deg, #fff5f5 0%, #fff 100%);
      box-shadow: 0 24px 55px rgba(130, 20, 24, 0.22);
    }

    #${POPUP_HOST_ID}.is-danger .abr-popup-icon {
      background: linear-gradient(145deg, #b42318, #dc2626);
      box-shadow: 0 12px 26px rgba(180, 35, 24, 0.34);
    }

    #${POPUP_HOST_ID}.is-danger .abr-popup-title {
      color: #8f1d1f;
    }

    #${POPUP_HOST_ID}.is-danger .abr-popup-message {
      color: #7f1d1d;
    }

    #${POPUP_HOST_ID}.is-danger .abr-popup-btn:focus-visible {
      outline-color: rgba(220, 38, 38, 0.28);
    }

    #${POPUP_HOST_ID}.is-danger .abr-popup-btn.confirm {
      background: linear-gradient(145deg, #b42318, #dc2626);
      box-shadow: 0 12px 25px rgba(180, 35, 24, 0.31);
    }

    #${POPUP_HOST_ID}.is-danger .abr-popup-btn.confirm:hover {
      box-shadow: 0 15px 30px rgba(180, 35, 24, 0.37);
    }

    @media (max-width: 480px) {
      #${POPUP_HOST_ID} .abr-popup-dialog {
        padding: 18px 16px 16px;
      }

      #${POPUP_HOST_ID} .abr-popup-actions {
        margin-top: 16px;
      }

      #${POPUP_HOST_ID} .abr-popup-btn {
        flex: 1 1 0;
      }
    }
  `;

  document.head.appendChild(style);
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
  refs.icon.textContent = options.icon || (variant === "danger" ? "!" : "؟");
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
