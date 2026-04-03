import { doc, getDoc, setDoc, serverTimestamp } from '/shared/firebase.js';

const STYLE_ID = 'abr-notif-popup-style';
const HOST_ID  = 'abr-notif-popup-host';
const LS_KEY   = 'abr_notif_dismissed';

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${HOST_ID} {
      position: fixed;
      inset: 0;
      z-index: 9000;
      display: grid;
      place-items: center;
      padding: 16px;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity .28s ease, visibility .28s ease;
    }
    #${HOST_ID}.anp-open {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
    }
    #${HOST_ID} .anp-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(3, 15, 35, 0.62);
      backdrop-filter: blur(9px);
      -webkit-backdrop-filter: blur(9px);
    }
    #${HOST_ID} .anp-dialog {
      position: relative;
      width: min(520px, calc(100vw - 28px));
      max-height: calc(100dvh - 40px);
      overflow-y: auto;
      border-radius: 24px;
      border: 1px solid #d0e4f0;
      background: linear-gradient(180deg, #ffffff 0%, #f4f9ff 100%);
      box-shadow: 0 28px 60px rgba(3, 60, 84, 0.28);
      padding: 28px 24px 24px;
      transform: translateY(14px) scale(0.95);
      opacity: 0;
      transition: transform .28s cubic-bezier(.22,.7,.25,1), opacity .28s ease;
      font-family: "Noto Kufi Arabic", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      direction: rtl;
      text-align: right;
    }
    #${HOST_ID}.anp-open .anp-dialog {
      transform: translateY(0) scale(1);
      opacity: 1;
    }
    #${HOST_ID} .anp-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 14px;
      border-radius: 999px;
      font-size: .82rem;
      font-weight: 800;
      margin-bottom: 16px;
      background: rgba(3, 60, 84, .08);
      color: #033C54;
    }
    #${HOST_ID} .anp-title {
      margin: 0 0 12px;
      color: #083b57;
      font-size: 1.15rem;
      font-weight: 900;
      line-height: 1.5;
    }
    #${HOST_ID} .anp-text {
      margin: 0;
      color: #2d4a5e;
      font-size: .97rem;
      line-height: 2.1;
      white-space: pre-wrap;
      word-break: break-word;
    }
    #${HOST_ID} .anp-close {
      display: block;
      width: 100%;
      margin-top: 24px;
      min-height: 60px;
      border: none;
      border-radius: 18px;
      background: linear-gradient(145deg, #033C54, #065372);
      color: #fff;
      font-family: "Noto Kufi Arabic", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      font-size: 1.08rem;
      font-weight: 900;
      cursor: pointer;
      transition: transform .15s ease, box-shadow .15s ease;
      box-shadow: 0 14px 32px rgba(3, 60, 84, .32);
      letter-spacing: .2px;
    }
    #${HOST_ID} .anp-close:hover {
      transform: translateY(-2px);
      box-shadow: 0 20px 42px rgba(3, 60, 84, .42);
    }
    #${HOST_ID} .anp-close:active { transform: scale(.997); }
    #${HOST_ID} .anp-close:focus-visible {
      outline: 3px solid rgba(3, 60, 84, .35);
      outline-offset: 2px;
    }
    /* Important variant — red glow */
    #${HOST_ID}.anp-important .anp-dialog {
      border-color: rgba(220, 38, 38, 0.30);
      background: linear-gradient(180deg, #fff8f8 0%, #fff 100%);
      box-shadow:
        0 28px 60px rgba(185, 28, 28, .22),
        0 0 0 1px rgba(220, 38, 38, .10),
        0 0 55px rgba(220, 38, 38, .14);
    }
    #${HOST_ID}.anp-important .anp-badge {
      background: rgba(185, 28, 28, .10);
      color: #b91c1c;
    }
    #${HOST_ID}.anp-important .anp-title { color: #7f1d1d; }
    #${HOST_ID}.anp-important .anp-text  { color: #7c2828; }
    #${HOST_ID}.anp-important .anp-close {
      background: linear-gradient(145deg, #b91c1c, #dc2626);
      box-shadow: 0 14px 32px rgba(185, 28, 28, .35);
    }
    #${HOST_ID}.anp-important .anp-close:hover {
      box-shadow: 0 20px 42px rgba(185, 28, 28, .47);
    }
    @media (max-width: 480px) {
      #${HOST_ID} .anp-dialog {
        padding: 22px 18px 20px;
        border-radius: 20px;
      }
      #${HOST_ID} .anp-title  { font-size: 1.05rem; }
      #${HOST_ID} .anp-text   { font-size: .92rem; }
      #${HOST_ID} .anp-close  {
        min-height: 54px;
        font-size: 1rem;
        border-radius: 16px;
        margin-top: 20px;
      }
    }
  `;
  document.head.appendChild(style);
}

function showPopup(notif, db, uid, name) {
  ensureStyles();

  const existing = document.getElementById(HOST_ID);
  if (existing) existing.remove();

  const isImportant = notif.importance === 'important';
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('aria-hidden', 'true');
  if (isImportant) host.classList.add('anp-important');

  host.innerHTML = `
    <div class="anp-backdrop"></div>
    <div class="anp-dialog" role="alertdialog" aria-modal="true" aria-labelledby="anpDialogTitle">
      <div class="anp-badge">${isImportant ? '🔴&nbsp;إشعار مهم' : '📢&nbsp;إشعار'}</div>
      ${notif.title ? `<h3 id="anpDialogTitle" class="anp-title">${escHtml(notif.title)}</h3>` : ''}
      <p class="anp-text">${escHtml(notif.text)}</p>
      <button type="button" class="anp-close">إغلاق</button>
    </div>
  `;

  document.body.appendChild(host);
  document.body.style.overflow = 'hidden';

  const closeIt = () => {
    try { localStorage.setItem(LS_KEY, notif.notifId); } catch {}
    if (db && uid) {
      setDoc(
        doc(db, 'site_notifications_history', notif.notifId, 'seen', uid),
        { name: name || 'مجهول', seenAt: serverTimestamp() }
      ).catch(() => {});
    }
    host.classList.remove('anp-open');
    document.body.style.overflow = '';
    setTimeout(() => host.remove(), 300);
  };

  host.querySelector('.anp-backdrop').addEventListener('click', closeIt);
  host.querySelector('.anp-close').addEventListener('click', closeIt);

  requestAnimationFrame(() => {
    host.setAttribute('aria-hidden', 'false');
    host.classList.add('anp-open');
    host.querySelector('.anp-close')?.focus({ preventScroll: true });
  });
}

export async function initNotificationPopup(db, { uid = null, name = '' } = {}) {
  try {
    const snap = await getDoc(doc(db, 'site_notifications', 'current'));
    if (!snap.exists()) return;
    const data = snap.data();
    if (!data?.active || !data?.text) return;
    const notifId = data.notifId || 'default';
    try { if (localStorage.getItem(LS_KEY) === notifId) return; } catch {}
    showPopup({ ...data, notifId }, db, uid, name);
  } catch {
    // Silent fail — never break the page
  }
}
