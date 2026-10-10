/* The site's in-page dialogs, in place of the browser's alert(), confirm()
   and prompt() (which look foreign and which in-app browsers such as
   WhatsApp's block). A classic script (not a module), loaded like
   feedback.js: <script src="/shared/dialog.js" defer></script>, before the
   page's modules, which call it as window.Dialog.

   Dialog.confirm({ title, text, ok = "تأكيد", cancel = "إلغاء", danger = false, icon })
     → Promise<boolean>. danger: the ok button is the filled red
       .danger.confirm-delete of /shared/identity.css; otherwise primary.
   Dialog.alert({ title, text, ok = "حسناً", icon }) → Promise<void>
     Only for a message that must be read and acknowledged; a plain
     "it failed" / "saved" goes to Feedback.notify instead.
   Dialog.prompt({ title, text, ok, cancel, value = "", placeholder, type = "text" })
     → Promise<string | null> (null on cancel).
   A string instead of the options object is taken as the text.
   icon (optional): "↩" | "!" | "؟" or a character — shows the round icon
   above a centred title (the look /shared/action-popup.js uses).

   One dialog at a time: a call made while another is open waits for it.
   Esc = cancel, Enter = ok, Tab stays inside, focus returns to the opener.
   When a modal <dialog> is open it sits in the top layer, so the dialog is
   placed inside it (as Feedback's toast is). */
(function () {
  "use strict";
  if (window.Dialog) return;

  const STYLE_ID = "abr-dialog-style";
  const CSS = `
.abr-dlg-host {
  position: fixed;
  inset: 0;
  z-index: 10001;
  display: grid;
  place-items: center;
  padding: 16px;
  box-sizing: border-box;
  direction: rtl;
  opacity: 0;
  transition: opacity .18s ease;
}
.abr-dlg-host.is-open { opacity: 1; }
.abr-dlg-overlay {
  position: absolute;
  inset: 0;
  background: rgba(2, 6, 23, .5);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.abr-dlg-card {
  position: relative;
  box-sizing: border-box;
  width: min(480px, 92vw);
  max-height: calc(100vh - 32px);
  max-height: calc(100dvh - 32px);
  overflow: auto;
  border-radius: 20px;
  background: #fff;
  color: #0f172a;
  box-shadow: 0 30px 70px rgba(10, 30, 60, .32);
  padding: 24px 22px 20px;
  text-align: right;
  font-family: var(--app-font, "Tajawal", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif);
  transform: translateY(10px) scale(.97);
  transition: transform .22s cubic-bezier(.22, .7, .25, 1);
}
.abr-dlg-host.is-open .abr-dlg-card { transform: none; }
.abr-dlg-card.has-icon { text-align: center; }
.abr-dlg-icon {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  margin: 0 auto 14px;
  background: linear-gradient(145deg, #033C54, #065372);
  color: #fff;
  font-size: 24px;
  font-weight: 900;
  box-shadow: 0 12px 26px rgba(3, 60, 84, .28), 0 0 0 7px #eef5f9;
}
.abr-dlg-card.is-danger .abr-dlg-icon {
  background: #b42318;
  box-shadow: 0 12px 26px rgba(180, 35, 24, .3), 0 0 0 7px #fdeceb;
}
.abr-dlg-icon svg {
  width: 28px;
  height: 28px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.abr-dlg-title {
  margin: 0 0 6px;
  color: #0f172a;
  font-family: var(--app-font, "Tajawal"), system-ui, sans-serif;
  font-size: 1.1rem;
  font-weight: 700;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.abr-dlg-text {
  margin: 0;
  color: #6b7f9f;
  font-size: .95rem;
  font-weight: 600;
  line-height: 1.8;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.abr-dlg-text:empty { display: none; }
.abr-dlg-input {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin-top: 14px;
  min-height: 46px;
  padding: 10px 14px;
  border: 1px solid #cfdbe6;
  border-radius: 12px;
  background: #fff;
  color: #0f172a;
  font: inherit;
  font-size: 1rem;
  direction: rtl;
  text-align: right;
}
.abr-dlg-input:focus {
  outline: none;
  border-color: #065372;
  box-shadow: 0 0 0 3px rgba(6, 83, 114, .2);
}
.abr-dlg-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}
.abr-dlg-btn {
  flex: 1 1 0;
  min-width: 0;
  min-height: 48px;
  padding: 0 12px;
  border-radius: 14px;
  border: 0;
  font-family: var(--app-font, "Tajawal"), system-ui, sans-serif;
  font-size: .95rem;
  font-weight: 700;
  line-height: 1.3;
  cursor: pointer;
  transition: background-color .14s ease, box-shadow .14s ease;
}
.abr-dlg-btn:focus-visible {
  outline: 3px solid rgba(3, 60, 84, .35);
  outline-offset: 2px;
}
.abr-dlg-ok {
  background: linear-gradient(145deg, #065372, #033C54);
  color: #fff;
  box-shadow: 0 10px 22px rgba(3, 60, 84, .22);
}
.abr-dlg-ok.is-danger {
  background: #b42318;
  box-shadow: 0 10px 22px rgba(180, 35, 24, .25);
}
.abr-dlg-ok.is-danger:hover { background: #9b1d14; }
.abr-dlg-ok.is-danger:focus-visible { outline-color: rgba(180, 35, 24, .4); }
.abr-dlg-cancel {
  background: #fff;
  color: #033C54;
  border: 1px solid rgba(3, 60, 84, .25);
}
.abr-dlg-cancel:hover { background: #eef5f9; }
@media (max-width: 360px) {
  .abr-dlg-host { padding: 10px; }
  .abr-dlg-card { padding: 20px 16px 16px; }
  .abr-dlg-actions { gap: 8px; }
  .abr-dlg-btn { padding: 0 8px; font-size: .9rem; }
}
@media (prefers-reduced-motion: reduce) {
  .abr-dlg-host, .abr-dlg-card, .abr-dlg-btn { transition: none; }
}`;

  const ICONS = {
    "↩": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
    "!": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L14.1 3.9a2 2 0 0 0-3.6 0Z"/></svg>',
    "؟": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5"/><path d="M12 17.5h.01"/></svg>'
  };

  let seq = 0;
  let queue = Promise.resolve();

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // The focused element, looking inside shadow roots (sheets render there).
  function deepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  function topModalDialog() {
    return [...document.querySelectorAll("dialog[open]")].filter((d) => {
      try { return d.matches(":modal"); } catch { return false; }
    }).pop() || null;
  }

  function normalize(opts) {
    if (opts == null) return {};
    if (typeof opts === "string") return { text: opts };
    return opts;
  }

  function show(kind, opts) {
    injectStyle();
    const id = ++seq;
    const isPrompt = kind === "prompt";
    const hasCancel = kind !== "alert";
    const danger = Boolean(opts.danger);
    const opener = deepActiveElement();

    const host = document.createElement("div");
    host.className = "abr-dlg-host";

    const overlay = document.createElement("div");
    overlay.className = "abr-dlg-overlay";

    const card = document.createElement("div");
    card.className = "abr-dlg-card";
    if (danger) card.classList.add("is-danger");
    card.setAttribute("role", kind === "alert" ? "alertdialog" : "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", `abrDlgTitle${id}`);

    if (opts.icon) {
      card.classList.add("has-icon");
      const icon = document.createElement("div");
      icon.className = "abr-dlg-icon";
      icon.setAttribute("aria-hidden", "true");
      if (ICONS[opts.icon]) icon.innerHTML = ICONS[opts.icon];
      else icon.textContent = opts.icon;
      card.appendChild(icon);
    }

    const title = document.createElement("h2");
    title.className = "abr-dlg-title";
    title.id = `abrDlgTitle${id}`;
    title.textContent = opts.title || (kind === "alert" ? "تنبيه" : kind === "prompt" ? "إدخال" : "تأكيد");
    card.appendChild(title);

    const text = document.createElement("p");
    text.className = "abr-dlg-text";
    text.id = `abrDlgText${id}`;
    text.textContent = opts.text == null ? "" : String(opts.text);
    card.appendChild(text);
    if (text.textContent) card.setAttribute("aria-describedby", text.id);

    let input = null;
    if (isPrompt) {
      input = document.createElement("input");
      input.className = "abr-dlg-input";
      input.type = opts.type || "text";
      input.value = opts.value == null ? "" : String(opts.value);
      if (opts.placeholder) input.placeholder = opts.placeholder;
      input.setAttribute("aria-labelledby", title.id);
      if (input.type === "password") input.autocomplete = "current-password";
      card.appendChild(input);
    }

    const actions = document.createElement("div");
    actions.className = "abr-dlg-actions";
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "abr-dlg-btn abr-dlg-ok" + (danger ? " is-danger" : "");
    okBtn.textContent = opts.ok || (kind === "alert" ? "حسناً" : "تأكيد");
    actions.appendChild(okBtn);
    let cancelBtn = null;
    if (hasCancel) {
      cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "abr-dlg-btn abr-dlg-cancel";
      cancelBtn.textContent = opts.cancel || "إلغاء";
      actions.appendChild(cancelBtn);
    }
    card.appendChild(actions);
    host.append(overlay, card);

    return new Promise((resolve) => {
      let done = false;

      function finish(confirmed) {
        if (done) return;
        done = true;
        document.removeEventListener("keydown", onKey, true);
        document.removeEventListener("focusin", onFocusIn, true);
        host.classList.remove("is-open");
        setTimeout(() => host.remove(), 180);
        if (opener && opener.isConnected && typeof opener.focus === "function") {
          try { opener.focus({ preventScroll: true }); } catch { /* ignore */ }
        }
        if (kind === "confirm") resolve(Boolean(confirmed));
        else if (kind === "prompt") resolve(confirmed ? input.value : null);
        else resolve();
      }

      function focusables() {
        return [...card.querySelectorAll("input, button")].filter((el) => !el.disabled);
      }

      function onKey(event) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        } else if (event.key === "Enter" && !event.isComposing) {
          // Enter on the focused cancel button cancels; anywhere else it is ok.
          if (event.target === cancelBtn || deepActiveElement() === cancelBtn) return;
          event.preventDefault();
          event.stopPropagation();
          finish(true);
        } else if (event.key === "Tab") {
          const items = focusables();
          if (!items.length) return;
          const first = items[0];
          const last = items[items.length - 1];
          const active = deepActiveElement();
          if (!card.contains(active)) {
            event.preventDefault();
            first.focus();
          } else if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }

      // Focus that escapes (a click on the page behind) is pulled back.
      function onFocusIn(event) {
        if (!card.contains(event.target)) {
          (input || okBtn).focus({ preventScroll: true });
        }
      }

      okBtn.addEventListener("click", () => finish(true));
      if (cancelBtn) cancelBtn.addEventListener("click", () => finish(false));
      overlay.addEventListener("click", () => finish(false));

      (topModalDialog() || document.body || document.documentElement).appendChild(host);
      document.addEventListener("keydown", onKey, true);
      document.addEventListener("focusin", onFocusIn, true);
      requestAnimationFrame(() => host.classList.add("is-open"));
      if (input) {
        input.focus({ preventScroll: true });
        input.select();
      } else {
        okBtn.focus({ preventScroll: true });
      }
    });
  }

  // One dialog at a time: each call waits for the previous one to close.
  function enqueue(kind, opts) {
    const run = () => show(kind, normalize(opts));
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  window.Dialog = {
    confirm: (opts) => enqueue("confirm", opts),
    alert: (opts) => enqueue("alert", opts),
    prompt: (opts) => enqueue("prompt", opts)
  };
})();
