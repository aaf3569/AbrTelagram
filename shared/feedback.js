/* Visible feedback for action buttons, shared by every page.
   A classic script (not a module) so any page can load it with
   <script src="/shared/feedback.js" defer></script> and call it from its
   ES modules as window.Feedback.

   Feedback.notify(text, kind = "ok")   kind: "ok" | "err" | "info"
     A toast at the bottom of the screen. A new one replaces the previous
     one. Hides after 3.5s (errors after 6s).

   Feedback.busy(btn, fn, opts)         opts: { ok, err, rethrow }
     Disables btn and shows a small spinner at its start while fn runs.
     On success: notify(opts.ok) if given. On failure: notify(opts.err or
     a default message, "err"); rethrows only when opts.rethrow is true.
     Always restores the button. Returns fn's result.

   Any <button data-reload-page> (the hub pages' «تحديث الشاشة» button)
   shows the refresh spinner, then reloads the page. */
(function () {
  "use strict";
  if (window.Feedback) return;

  const STYLE_ID = "feedback-style";
  const CSS = `
.fb-toast {
  position: fixed;
  bottom: 18px;
  left: 50%;
  transform: translate(-50%, 12px);
  width: min(520px, 92vw);
  box-sizing: border-box;
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: 10px;
  direction: rtl;
  padding: 12px 16px;
  border-radius: 16px;
  background: #fff;
  color: #0f172a;
  box-shadow: 0 10px 30px rgba(3, 60, 84, .18);
  font: inherit;
  font-weight: 800;
  line-height: 1.5;
  opacity: 0;
  transition: opacity .18s ease, transform .18s ease;
  pointer-events: auto;
}
.fb-toast.fb-show {
  opacity: 1;
  transform: translate(-50%, 0);
}
.fb-toast-icon {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-grid;
  place-items: center;
  color: #fff;
  font-size: 14px;
  line-height: 1;
}
.fb-toast-ok .fb-toast-icon { background: #1a7f37; }
.fb-toast-err .fb-toast-icon { background: #b42318; }
.fb-toast-info .fb-toast-icon { background: #033C54; }
.fb-toast-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
@media (prefers-reduced-motion: reduce) {
  .fb-toast { transition: none; }
}
.is-busy { cursor: progress; }
.is-busy::before {
  content: "";
  display: inline-block;
  width: 16px;
  height: 16px;
  margin-inline-end: 6px;
  vertical-align: -3px;
  box-sizing: border-box;
  border: 2px solid currentColor;
  border-inline-end-color: transparent;
  border-radius: 50%;
  animation: fb-spin .8s linear infinite;
  flex: none;
}
@keyframes fb-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .is-busy::before { animation: none; border-inline-end-color: currentColor; opacity: .5; }
}`;

  const ICONS = { ok: "✓", err: "✕", info: "i" };
  let current = null;
  let hideTimer = 0;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function removeToast(el) {
    if (!el) return;
    el.classList.remove("fb-show");
    setTimeout(() => el.remove(), 200);
  }

  function notify(text, kind = "ok") {
    if (!text) return;
    if (!ICONS[kind]) kind = "ok";
    injectStyle();
    clearTimeout(hideTimer);
    if (current) { current.remove(); current = null; }

    const el = document.createElement("div");
    el.className = `fb-toast fb-toast-${kind}`;
    el.setAttribute("role", kind === "err" ? "alert" : "status");
    el.setAttribute("aria-live", kind === "err" ? "assertive" : "polite");
    const icon = document.createElement("span");
    icon.className = "fb-toast-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = ICONS[kind];
    const msg = document.createElement("span");
    msg.className = "fb-toast-text";
    msg.textContent = String(text);
    el.append(icon, msg);
    el.addEventListener("click", () => {
      clearTimeout(hideTimer);
      if (current === el) current = null;
      removeToast(el);
    });
    // An open modal <dialog> sits in the top layer, above any z-index:
    // put the toast inside it so it still shows.
    const modal = [...document.querySelectorAll("dialog[open]")].filter((d) => {
      try { return d.matches(":modal"); } catch { return false; }
    }).pop();
    (modal || document.body || document.documentElement).appendChild(el);
    current = el;
    requestAnimationFrame(() => el.classList.add("fb-show"));
    hideTimer = setTimeout(() => {
      if (current === el) current = null;
      removeToast(el);
    }, kind === "err" ? 6000 : 3500);
    return el;
  }

  async function busy(btn, fn, opts = {}) {
    if (btn && (btn.disabled || btn.classList.contains("is-busy"))) return undefined;
    injectStyle();
    const wasDisabled = btn ? btn.disabled : false;
    if (btn) {
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      btn.classList.add("is-busy");
    }
    try {
      const result = await fn();
      if (opts.ok) notify(opts.ok, "ok");
      return result;
    } catch (err) {
      console.error(err);
      notify(opts.err || "تعذّر الحفظ، حاول مرة أخرى", "err");
      if (opts.rethrow) throw err;
      return undefined;
    } finally {
      if (btn) {
        btn.disabled = wasDisabled;
        btn.removeAttribute("aria-busy");
        btn.classList.remove("is-busy");
      }
    }
  }

  document.addEventListener("click", (event) => {
    const btn = event.target.closest && event.target.closest("[data-reload-page]");
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.classList.add("is-loading");
    btn.setAttribute("aria-busy", "true");
    // Let the spinner paint before the page starts unloading.
    requestAnimationFrame(() => requestAnimationFrame(() => location.reload()));
  });

  window.Feedback = { notify, busy };
})();
