/* "مهم" reminder on the teacher page: after editing attendance, it has to
   be saved. Shown once per day per device (dismissal is remembered in
   localStorage); resolves when closed so callers can chain the next popup
   (e.g. the swap-removed tour) instead of stacking on top of it. */

const STYLE_ID = 'abr-save-att-style';
const HOST_ID  = 'abr-save-att-host';
const LS_KEY   = 'abr_save_att_notice_day';

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${HOST_ID} {
      position: fixed; inset: 0; z-index: 9000;
      display: grid; place-items: center; padding: 16px;
      opacity: 0; visibility: hidden; pointer-events: none;
      transition: opacity .3s ease, visibility .3s ease;
      font-family: "Tajawal", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      direction: rtl;
    }
    #${HOST_ID}.sa-open { opacity: 1; visibility: visible; pointer-events: auto; }
    #${HOST_ID} .sa-backdrop {
      position: absolute; inset: 0;
      background: rgba(40, 6, 6, .62);
      backdrop-filter: blur(9px); -webkit-backdrop-filter: blur(9px);
    }
    #${HOST_ID} .sa-dialog {
      position: relative;
      width: min(440px, calc(100vw - 32px));
      max-height: calc(100dvh - 40px); overflow-y: auto;
      border-radius: 26px;
      background: #fff;
      box-shadow: 0 30px 70px rgba(127, 29, 29, .38), 0 0 0 4px rgba(220, 38, 38, .18);
      text-align: center;
      transform: translateY(18px) scale(.9);
      opacity: 0;
      transition: transform .38s cubic-bezier(.2,1.4,.4,1), opacity .3s ease;
    }
    #${HOST_ID}.sa-open .sa-dialog {
      transform: translateY(0) scale(1); opacity: 1;
      animation: sa-glow 2.4s ease-in-out .4s infinite;
    }
    @keyframes sa-glow {
      0%, 100% { box-shadow: 0 30px 70px rgba(127, 29, 29, .38), 0 0 0 4px rgba(220, 38, 38, .18); }
      50%      { box-shadow: 0 30px 70px rgba(127, 29, 29, .38), 0 0 0 9px rgba(220, 38, 38, .30); }
    }
    #${HOST_ID} .sa-head {
      background: linear-gradient(145deg, #b91c1c, #ef4444);
      color: #fff;
      padding: 26px 20px 22px;
      border-radius: 26px 26px 0 0;
    }
    #${HOST_ID} .sa-icon {
      width: 68px; height: 68px; margin: 0 auto 10px;
      display: grid; place-items: center;
      border-radius: 50%;
      background: rgba(255, 255, 255, .18);
      border: 2px solid rgba(255, 255, 255, .55);
      font-size: 1.9rem;
      animation: sa-pulse 1.6s ease-in-out infinite;
    }
    @keyframes sa-pulse {
      0%, 100% { transform: scale(1); }
      50%      { transform: scale(1.1); }
    }
    #${HOST_ID} .sa-title {
      margin: 0;
      font-size: 2rem; font-weight: 900; letter-spacing: .5px;
      text-shadow: 0 2px 10px rgba(0, 0, 0, .18);
    }
    #${HOST_ID} .sa-body { padding: 24px 22px 22px; }
    #${HOST_ID} .sa-text {
      margin: 0;
      color: #7f1d1d;
      font-size: 1.22rem; font-weight: 800; line-height: 1.9;
    }
    #${HOST_ID} .sa-text mark {
      background: #fee2e2; color: #b91c1c;
      padding: 1px 8px; border-radius: 8px;
    }
    #${HOST_ID} .sa-ok {
      display: block; width: 100%;
      margin-top: 22px; min-height: 56px;
      border: none; border-radius: 16px;
      background: linear-gradient(145deg, #b91c1c, #dc2626);
      color: #fff;
      font: inherit; font-size: 1.08rem; font-weight: 900;
      cursor: pointer;
      box-shadow: 0 14px 32px rgba(185, 28, 28, .35);
      transition: transform .15s ease, box-shadow .15s ease;
    }
    #${HOST_ID} .sa-ok:hover { transform: translateY(-2px); box-shadow: 0 20px 42px rgba(185, 28, 28, .47); }
    #${HOST_ID} .sa-ok:active { transform: scale(.98); }
    #${HOST_ID} .sa-ok:focus-visible { outline: 3px solid rgba(185, 28, 28, .4); outline-offset: 2px; }
    @media (max-width: 480px) {
      #${HOST_ID} .sa-title { font-size: 1.7rem; }
      #${HOST_ID} .sa-text  { font-size: 1.08rem; }
    }
    @media (prefers-reduced-motion: reduce) {
      #${HOST_ID} .sa-dialog, #${HOST_ID} .sa-icon { animation: none !important; transition: opacity .2s ease; }
    }
  `;
  document.head.appendChild(style);
}

export function maybeShowSaveAttendanceNotice() {
  if (lsGet(LS_KEY) === today()) return Promise.resolve();
  ensureStyles();
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('aria-hidden', 'true');
  host.innerHTML = `
    <div class="sa-backdrop"></div>
    <div class="sa-dialog" role="alertdialog" aria-modal="true" aria-labelledby="saTitle" aria-describedby="saText">
      <div class="sa-head">
        <div class="sa-icon"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i></div>
        <h2 id="saTitle" class="sa-title">مهم</h2>
      </div>
      <div class="sa-body">
        <p id="saText" class="sa-text">عند تعديل الغياب يرجى التأكد من <mark>حفظه</mark></p>
        <button type="button" class="sa-ok">حسناً، فهمت</button>
      </div>
    </div>
  `;
  document.body.appendChild(host);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  return new Promise((resolve) => {
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      lsSet(LS_KEY, today());
      host.classList.remove('sa-open');
      host.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = prevOverflow;
      setTimeout(() => { host.remove(); resolve(); }, 320);
    };
    host.querySelector('.sa-ok').addEventListener('click', close);
    host.querySelector('.sa-backdrop').addEventListener('click', close);
    host.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    requestAnimationFrame(() => {
      host.setAttribute('aria-hidden', 'false');
      host.classList.add('sa-open');
      host.querySelector('.sa-ok')?.focus({ preventScroll: true });
    });
  });
}
