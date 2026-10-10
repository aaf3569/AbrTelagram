/* showActionPopup: the confirm popup the hub pages use (sign-out, "retry?").
   Since 2026-10-15 it is a thin wrapper over the site's one in-page dialog,
   window.Dialog (/shared/dialog.js, a classic script each page loads with
   defer). If a page has not loaded it, it is loaded here on first use.

   showActionPopup({ title, message, confirmText, cancelText, variant, icon })
     → Promise<boolean>. variant "danger" makes the confirm button red. */

let dialogReady = null;

function loadDialog() {
  if (window.Dialog) return Promise.resolve(window.Dialog);
  if (!dialogReady) {
    dialogReady = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/shared/dialog.js";
      script.onload = () => (window.Dialog ? resolve(window.Dialog) : reject(new Error("Dialog missing")));
      script.onerror = () => {
        dialogReady = null;
        reject(new Error("dialog.js failed to load"));
      };
      document.head.appendChild(script);
    });
  }
  return dialogReady;
}

export async function showActionPopup(options = {}) {
  const Dialog = await loadDialog();
  const danger = options.variant === "danger";
  return Dialog.confirm({
    title: options.title || "تأكيد",
    text: options.message || "هل تريد المتابعة؟",
    ok: options.confirmText || "تأكيد",
    cancel: options.cancelText || "إلغاء",
    danger,
    icon: options.icon || (danger ? "!" : "؟")
  });
}
