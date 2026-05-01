(function () {
  const STYLE_ID = "credits-footer-style";

  const STYLES = `
    .credits-footer{width:100%;display:flex;justify-content:center;padding:32px 16px 40px;font-family:"Noto Kufi Arabic", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif}
    .credits-card{position:relative;width:100%;background:#ffffff;border:1px solid var(--border,#e6edf7);border-radius:24px;box-shadow:0 16px 40px rgba(3,60,84,.08),0 2px 6px rgba(3,60,84,.04);padding:36px 28px 22px;display:flex;flex-direction:column;align-items:center;text-align:center;overflow:hidden}
    .credits-card::before{content:'';position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--primary,#033C54) 0%,var(--primary-light,#065372) 50%,var(--primary,#033C54) 100%)}
    .credits-logo{width:96px;height:96px;object-fit:contain;filter:drop-shadow(0 10px 18px rgba(3,60,84,.18));margin-bottom:18px}
    .credits-school-name{margin:0;font-size:1.1rem;font-weight:900;color:var(--primary,#033C54);letter-spacing:.2px;line-height:1.4}
    .credits-tagline{margin:6px 0 22px;font-size:.78rem;font-weight:700;color:var(--muted,#6b7f9f);letter-spacing:.5px}
    .credits-info{width:100%;display:flex;flex-direction:column;gap:10px;margin-bottom:22px}
    .credits-row{display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:14px;background:#f8fbfd;border:1px solid rgba(3,60,84,.06);transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
    .credits-row:hover{transform:translateY(-1px);box-shadow:0 8px 18px rgba(3,60,84,.08);border-color:rgba(3,60,84,.14)}
    .credits-icon{flex-shrink:0;width:34px;height:34px;border-radius:11px;background:linear-gradient(145deg,var(--primary,#033C54),var(--primary-light,#065372));color:#fff;display:grid;place-items:center;box-shadow:0 4px 10px rgba(3,60,84,.18)}
    .credits-icon svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .credits-text{flex:1;display:flex;flex-direction:column;gap:2px;text-align:start;min-width:0}
    .credits-label{font-size:.7rem;font-weight:800;color:var(--muted,#6b7f9f);letter-spacing:.3px}
    .credits-value{font-size:.94rem;font-weight:800;color:var(--text,#0f172a);line-height:1.4;word-break:break-word}
    .credits-socials{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:20px}
    .credits-social{position:relative;width:42px;height:42px;border-radius:12px;background:#f1f6fa;border:1px solid rgba(3,60,84,.08);color:var(--primary,#033C54);display:grid;place-items:center;text-decoration:none;overflow:hidden;transition:transform .25s ease,box-shadow .25s ease,color .25s ease,border-color .25s ease}
    .credits-social::before{content:'';position:absolute;inset:0;opacity:0;transition:opacity .25s ease;z-index:0}
    .credits-social svg{position:relative;width:18px;height:18px;fill:currentColor;z-index:1}
    .credits-social:hover{transform:translateY(-3px);color:#fff;border-color:transparent;box-shadow:0 10px 22px rgba(3,60,84,.22)}
    .credits-social.instagram:hover::before{opacity:1;background:linear-gradient(45deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%)}
    .credits-social.telegram:hover::before{opacity:1;background:linear-gradient(135deg,#229ED9 0%,#1DA1F2 100%)}
    .credits-social.youtube:hover::before{opacity:1;background:#FF0000}
    .credits-copyright{margin:0;font-size:.74rem;font-weight:700;color:var(--muted,#6b7f9f);padding-top:18px;border-top:1px solid var(--border,#e6edf7);width:100%;line-height:1.6}
    @media(max-width:480px){
      .credits-card{padding:30px 18px 20px;border-radius:20px}
      .credits-logo{width:84px;height:84px;margin-bottom:14px}
      .credits-school-name{font-size:1rem}
      .credits-tagline{font-size:.74rem;margin-bottom:18px}
      .credits-row{padding:10px 12px;gap:10px}
      .credits-icon{width:32px;height:32px;border-radius:10px}
      .credits-icon svg{width:14px;height:14px}
      .credits-value{font-size:.9rem}
      .credits-social{width:40px;height:40px}
      .credits-social svg{width:17px;height:17px}
    }
  `;

  const FOOTER_HTML = `
    <footer class="credits-footer" aria-label="اعتمادات الموقع">
      <div class="credits-card">
        <img class="credits-logo" src="/images/schoollogo.png" alt="شعار المدرسة" loading="lazy">
        <h3 class="credits-school-name">ثانوية أحمد البشر الرومي</h3>
        <p class="credits-tagline">منصة المعلم الرقمية</p>
        <div class="credits-info">
          <div class="credits-row">
            <span class="credits-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </span>
            <div class="credits-text">
              <span class="credits-label">مدير المدرسة</span>
              <span class="credits-value">أ/ صلاح الناصر</span>
            </div>
          </div>
          <div class="credits-row">
            <span class="credits-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            </span>
            <div class="credits-text">
              <span class="credits-label">تصميم و برمجة</span>
              <span class="credits-value">الطالب عبدالله الصايغ</span>
            </div>
          </div>
        </div>
        <div class="credits-socials">
          <a class="credits-social instagram" href="https://www.instagram.com/abr.school/" target="_blank" rel="noopener noreferrer" aria-label="انستجرام المدرسة">
            <svg viewBox="0 0 24 24"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.86 5.86 0 0 0-2.13 1.38A5.86 5.86 0 0 0 .63 4.14c-.3.76-.5 1.64-.56 2.91C.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.32.8.74 1.48 1.38 2.13.65.65 1.33 1.06 2.13 1.38.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.86 5.86 0 0 0 2.13-1.38c.65-.65 1.06-1.33 1.38-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.86 5.86 0 0 0-1.38-2.13A5.86 5.86 0 0 0 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0zm0 5.84A6.16 6.16 0 1 0 12 18.16 6.16 6.16 0 0 0 12 5.84zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z"/></svg>
          </a>
          <a class="credits-social telegram" href="https://t.me/ahmedalbesherr" target="_blank" rel="noopener noreferrer" aria-label="تلجرام المدرسة">
            <svg viewBox="0 0 24 24"><path d="M11.94 0C5.36 0 0 5.36 0 12s5.36 12 11.94 12C18.58 24 24 18.64 24 12S18.64 0 11.94 0zm5.6 8.16-1.86 8.78c-.14.62-.5.78-1.02.5l-2.84-2.1-1.36 1.32c-.14.14-.28.28-.58.28l.2-2.96 5.36-4.84c.24-.2-.04-.32-.36-.12L7.86 12.18 5.06 11.3c-.6-.18-.62-.6.12-.88l10.96-4.22c.5-.2.94.12.78.96z"/></svg>
          </a>
          <a class="credits-social youtube" href="https://www.youtube.com/@ahmedalbesherr" target="_blank" rel="noopener noreferrer" aria-label="يوتيوب المدرسة">
            <svg viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
          </a>
        </div>
        <p class="credits-copyright">© 2026 ثانوية أحمد البشر الرومي · جميع الحقوق محفوظة</p>
      </div>
    </footer>
  `;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  function mount() {
    ensureStyles();
    const placeholder = document.querySelector("[data-credits-footer]");
    if (!placeholder) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = FOOTER_HTML.trim();
    const footer = wrapper.firstElementChild;
    placeholder.replaceWith(footer);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
