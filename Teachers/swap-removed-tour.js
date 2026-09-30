/* One-time guided tour: "آلية التبديل was removed — take attendance from
   صفوف أخرى instead". Shown once per teacher account (feature_tours_seen/
   {uid}.tours.swapRemovedV1 in Firestore, mirrored to localStorage), then
   never again on any device.

   An intro popup explains the change; its button starts a two-step
   spotlight tour: ☰ → صفوف أخرى. Each step can be done by tapping the
   highlighted element itself or the bottom bar's button. Once صفوف أخرى
   opens the tour ends there, and a closing card says what comes next
   (pick the class, then تسجيل الغياب + reason) — the tour itself never
   records anything. Every other tap on the page is blocked while it runs,
   so the teacher can't wander off mid-step.

   The host page passes its own openers/elements in `hooks`; this module
   never reaches into the page's internals itself. */
import { doc, getDoc, setDoc, serverTimestamp } from "/shared/firebase.js";

const TOUR_ID = "swapRemovedV1";
const COLLECTION = "feature_tours_seen";
const LS_KEY = (uid) => `tour:${TOUR_ID}:${uid}`;
const STYLE_ID = "swtStyles";
const ar = (v) => String(v).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

async function hasSeen(db, uid) {
  if (lsGet(LS_KEY(uid))) return true;
  try {
    const snap = await getDoc(doc(db, COLLECTION, uid));
    const outcome = snap.exists() ? snap.data()?.tours?.[TOUR_ID] : null;
    if (outcome) { lsSet(LS_KEY(uid), outcome); return true; }
    return false;
  } catch (e) {
    // Can't confirm it wasn't shown already — skip rather than risk a repeat.
    console.warn("[tour] seen check failed:", e?.message || e);
    return true;
  }
}

function markSeen(db, uid, outcome) {
  lsSet(LS_KEY(uid), outcome);
  setDoc(doc(db, COLLECTION, uid), { tours: { [TOUR_ID]: outcome }, updatedAt: serverTimestamp() }, { merge: true })
    .catch((e) => console.warn("[tour] mark seen failed:", e?.message || e));
}

// Other one-time popups (site notification, Telegram prompt) go first.
function otherPopupOpen() {
  return !!document.getElementById("abr-notif-popup-host")
    || !!document.querySelector(".tg-prompt-overlay")
    || !!document.querySelector(".modal.open, .sheet.open, .sidebar.open");
}
async function waitForQuietPage() {
  await new Promise((r) => setTimeout(r, 2500));
  while (otherPopupOpen()) await new Promise((r) => setTimeout(r, 700));
}

function isVisible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0
    && r.right > 0 && r.left < window.innerWidth
    && r.bottom > 0 && r.top < window.innerHeight;
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
  .swt-root { position: fixed; inset: 0; z-index: 2400; pointer-events: none; direction: rtl;
    font-family: "Tajawal", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  .swt-root * { box-sizing: border-box; }

  /* Intro */
  .swt-intro { position: fixed; inset: 0; display: grid; place-items: center; padding: 16px; pointer-events: auto;
    background: radial-gradient(circle at 50% 30%, rgba(4,69,99,.55), rgba(2,20,34,.82) 70%);
    opacity: 0; transition: opacity .25s ease; }
  .swt-intro.open { opacity: 1; }
  .swt-card { width: min(400px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto;
    background: #fff; border-radius: 26px; box-shadow: 0 30px 80px rgba(2,20,34,.45);
    transform: translateY(16px) scale(.95); transition: transform .3s cubic-bezier(.2,.8,.25,1); }
  .swt-intro.open .swt-card { transform: none; }
  .swt-hero { position: relative; padding: 26px 20px 20px; text-align: center; color: #fff; border-radius: 26px 26px 0 0;
    background: linear-gradient(150deg, #065372, #022b42); overflow: hidden; }
  .swt-hero::before, .swt-hero::after { content: ""; position: absolute; border-radius: 50%; background: rgba(255,255,255,.07); }
  .swt-hero::before { width: 180px; height: 180px; top: -70px; left: -60px; }
  .swt-hero::after { width: 120px; height: 120px; bottom: -50px; right: -30px; }
  .swt-badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px;
    background: rgba(255,255,255,.14); font-size: .78rem; font-weight: 800; }
  .swt-hero-icons { position: relative; display: flex; align-items: center; justify-content: center; gap: 14px; margin: 16px 0 4px; font-size: 1.7rem; }
  .swt-hero-old { position: relative; width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center;
    background: rgba(255,255,255,.1); color: rgba(255,255,255,.55); }
  .swt-hero-old::after { content: ""; position: absolute; width: 70%; height: 3px; background: #f87171; border-radius: 3px; transform: rotate(-35deg); }
  .swt-hero-new { width: 64px; height: 64px; border-radius: 18px; display: grid; place-items: center;
    background: #fff; color: #022b42; box-shadow: 0 10px 26px rgba(0,0,0,.25); animation: swtFloat 2.6s ease-in-out infinite; }
  .swt-hero-arrow { font-size: 1rem; opacity: .7; }
  .swt-title { position: relative; margin: 10px 0 0; font-size: 1.3rem; font-weight: 900; }
  .swt-body { padding: 18px 20px 20px; display: grid; gap: 14px; }
  .swt-text { margin: 0; color: #334155; font-weight: 700; font-size: .95rem; line-height: 1.75; text-align: center; }
  .swt-text b { color: #022b42; font-weight: 900; }
  .swt-intro .swt-body { gap: 16px; padding: 22px 20px 18px; }
  .swt-lead { margin: 0; text-align: center; color: #64748b; font-weight: 700; font-size: .92rem; }
  .swt-steps { display: grid; gap: 10px; }
  .swt-step { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 16px;
    background: #f5f8fb; border: 1px solid #e6edf4; }
  .swt-step-icon { flex-shrink: 0; width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center;
    background: #fff; color: #065372; font-size: 1.05rem; box-shadow: 0 2px 8px rgba(2,43,66,.08); }
  .swt-step-text { display: grid; gap: 2px; text-align: right; }
  .swt-step-text b { color: #022b42; font-weight: 900; font-size: .95rem; }
  .swt-step-text small { color: #64748b; font-weight: 700; font-size: .8rem; }
  .swt-foot { margin: -4px 0 0; text-align: center; color: #94a3b8; font-weight: 700; font-size: .76rem; }
  .swt-btn { min-height: 54px; border: none; border-radius: 16px; cursor: pointer; font-family: inherit;
    font-weight: 900; font-size: 1.05rem; display: inline-flex; align-items: center; justify-content: center; gap: 10px;
    background: linear-gradient(145deg, #065372, #022b42); color: #fff; box-shadow: 0 14px 30px rgba(2,43,66,.3);
    transition: transform .15s ease; }
  .swt-btn:hover { transform: translateY(-2px); }

  /* Spotlight + arrow */
  .swt-spot { position: fixed; border-radius: 14px; pointer-events: none; opacity: 0;
    box-shadow: 0 0 0 200vmax rgba(2,20,34,.62); transition: opacity .2s ease; }
  .swt-spot.on { opacity: 1; }
  .swt-spot::after { content: ""; position: absolute; inset: -5px; border-radius: 18px; border: 3px solid #fbbf24;
    animation: swtPulse 1.4s ease-out infinite; }
  .swt-dim { position: fixed; inset: 0; background: rgba(2,20,34,.62); pointer-events: none; opacity: 0; transition: opacity .2s ease; }
  .swt-dim.on { opacity: 1; }
  .swt-arrow { position: fixed; width: 44px; height: 44px; margin-left: -22px; pointer-events: none; opacity: 0;
    color: #fbbf24; font-size: 2.3rem; line-height: 44px; text-align: center; transition: opacity .2s ease;
    filter: drop-shadow(0 4px 10px rgba(0,0,0,.45)); }
  .swt-arrow.on { opacity: 1; }
  .swt-arrow.up { animation: swtBounceUp 1s ease-in-out infinite; }
  .swt-arrow.down { animation: swtBounceDown 1s ease-in-out infinite; }

  /* Bottom (or top) bar */
  .swt-bar { position: fixed; left: 50%; width: min(460px, calc(100vw - 20px)); pointer-events: auto;
    background: #fff; border-radius: 22px; padding: 14px 16px 16px; box-shadow: 0 20px 50px rgba(2,20,34,.4);
    transform: translateX(-50%); display: grid; gap: 10px; transition: top .25s ease, bottom .25s ease; }
  .swt-bar.bottom { bottom: max(12px, env(safe-area-inset-bottom)); }
  .swt-bar.top { top: max(12px, env(safe-area-inset-top)); }
  .swt-bar-head { display: flex; align-items: center; gap: 10px; }
  .swt-step-num { flex-shrink: 0; width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center;
    background: linear-gradient(145deg, #065372, #022b42); color: #fff; font-weight: 900; font-size: 1rem; }
  .swt-bar-title { flex: 1; min-width: 0; }
  .swt-bar-title small { display: block; color: #64748b; font-weight: 800; font-size: .72rem; }
  .swt-bar-title b { display: block; color: #022b42; font-weight: 900; font-size: 1.02rem; }
  .swt-progress { height: 6px; border-radius: 99px; background: #e2e8f0; overflow: hidden; }
  .swt-progress i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, #fbbf24, #f59e0b);
    transition: width .4s ease; }
  .swt-bar-text { margin: 0; color: #334155; font-weight: 700; font-size: .9rem; line-height: 1.65; }
  .swt-bar-actions { display: flex; gap: 10px; }
  .swt-next { flex: 1; min-height: 48px; font-size: .98rem; }
  .swt-skip { min-height: 48px; padding: 0 16px; border-radius: 16px; border: 1px solid #e2e8f0; background: #f8fafc;
    color: #64748b; font-family: inherit; font-weight: 800; font-size: .88rem; cursor: pointer; }
  /* Finish */
  .swt-done-icon { width: 72px; height: 72px; margin: 6px auto 0; border-radius: 22px; display: grid; place-items: center;
    background: #fff; color: #047857; font-size: 2.1rem; box-shadow: 0 12px 28px rgba(0,0,0,.22); }

  @keyframes swtPulse { 0% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1.18); } }
  @keyframes swtBounceUp { 0%,100% { transform: translateY(0); } 50% { transform: translateY(8px); } }
  @keyframes swtBounceDown { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
  @keyframes swtFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
  @media (prefers-reduced-motion: reduce) {
    .swt-spot::after, .swt-arrow, .swt-hero-new { animation: none !important; }
  }`;
  document.head.appendChild(style);
}

/* hooks: {
     toggleBtn, sidebar, openSidebar, closeSidebar,
     otherClassesBtn, ocSheet, openOtherClasses, closeOtherClasses,
     mcSheet, closeClass()   // only used to tidy up if the teacher skips
   } */
export async function maybeStartSwapRemovedTour({ db, uid, hooks }) {
  if (!db || !uid || !hooks) return;
  if (await hasSeen(db, uid)) return;
  await waitForQuietPage();
  ensureStyles();

  const h = hooks;
  const root = document.createElement("div");
  root.className = "swt-root";
  document.body.appendChild(root);

  const steps = [
    {
      title: "افتح القائمة الجانبية",
      text: "اضغط زر القائمة <b>☰</b> في أعلى الشاشة.",
      target: () => h.toggleBtn,
      allow: (el) => h.toggleBtn.contains(el),
      done: () => h.sidebar.classList.contains("open"),
      advance: () => h.openSidebar(),
    },
    {
      title: "اختر «صفوف أخرى»",
      text: "من القائمة اضغط <b>صفوف أخرى</b> — فيها كل فصول المدرسة.",
      target: () => h.otherClassesBtn,
      allow: (el) => h.otherClassesBtn.contains(el),
      done: () => h.ocSheet.classList.contains("open"),
      advance: () => { h.closeSidebar(); h.openOtherClasses(); },
      scroll: true,
      nextLabel: "افتح صفوف أخرى",
    },
  ];

  let stepIndex = -1;
  let raf = 0;
  let timer = 0;
  let ended = false;
  let scrolledFor = -1;

  const dim = el("div", "swt-dim");
  const spot = el("div", "swt-spot");
  const arrow = el("div", "swt-arrow");
  const bar = el("div", "swt-bar bottom");
  bar.setAttribute("role", "dialog");
  bar.setAttribute("aria-live", "polite");
  root.append(dim, spot, arrow, bar);

  function el(tag, cls) { const e = document.createElement(tag); e.className = cls; return e; }

  // Blocks every tap outside the tour UI and the current step's target, in
  // the capture phase so the page's own handlers never see it.
  function guard(e) {
    if (ended || stepIndex < 0) return;
    if (bar.contains(e.target) || root.querySelector(".swt-intro")?.contains(e.target)) return;
    const step = steps[stepIndex];
    const t = step.target();
    if (t && t.contains(e.target) && step.onTargetTap) {
      e.preventDefault(); e.stopPropagation();
      if (e.type === "click") step.onTargetTap();
      return;
    }
    if (step.allow(e.target)) return;
    e.preventDefault(); e.stopPropagation();
  }
  ["click", "pointerdown", "mousedown"].forEach((t) => window.addEventListener(t, guard, true));
  const onKey = (e) => { if (!ended && stepIndex >= 0 && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); } };
  window.addEventListener("keydown", onKey, true);

  function renderBar() {
    const step = steps[stepIndex];
    const pct = Math.round((stepIndex / steps.length) * 100);
    bar.innerHTML = `
      <div class="swt-bar-head">
        <span class="swt-step-num">${ar(stepIndex + 1)}</span>
        <div class="swt-bar-title"><small>الخطوة ${ar(stepIndex + 1)} من ${ar(steps.length)}</small><b>${step.title}</b></div>
      </div>
      <div class="swt-progress" aria-hidden="true"><i style="width:${pct}%"></i></div>
      <p class="swt-bar-text">${step.text}</p>
      <div class="swt-bar-actions">
        <button type="button" class="swt-btn swt-next">${step.nextLabel || "حسناً، التالي"}</button>
        <button type="button" class="swt-skip">تخطي</button>
      </div>`;
    bar.querySelector(".swt-next").addEventListener("click", () => steps[stepIndex]?.advance());
    bar.querySelector(".swt-skip").addEventListener("click", () => end("skipped"));
  }

  function goTo(i) {
    stepIndex = i;
    scrolledFor = -1;
    renderBar();
  }

  // Step progression runs on a timer, not requestAnimationFrame — rAF is
  // throttled in background/headless tabs, which would stall the tour.
  function checkProgress() {
    if (ended) return;
    const step = steps[stepIndex];
    if (step && step.done()) {
      if (stepIndex + 1 < steps.length) goTo(stepIndex + 1);
      else return finish();
    }
    layout();
  }

  function position() {
    if (ended) return;
    layout();
    raf = requestAnimationFrame(position);
  }

  function layout() {
    const step = steps[stepIndex];
    if (step) {
      const t = steps[stepIndex].target();
      if (t && steps[stepIndex].scroll && scrolledFor !== stepIndex && t.getBoundingClientRect().width > 0) {
        scrolledFor = stepIndex;
        t.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
      }
      if (isVisible(t)) {
        const r = t.getBoundingClientRect();
        const pad = 6;
        Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
        spot.classList.add("on");
        dim.classList.remove("on");
        // Keep the bar clear of the target.
        const barH = bar.offsetHeight + 24;
        const atBottom = r.bottom < window.innerHeight - barH;
        bar.classList.toggle("bottom", atBottom);
        bar.classList.toggle("top", !atBottom);
        // Arrow on whichever side of the target has room.
        const below = r.top + r.height / 2 < window.innerHeight * 0.5;
        const cx = Math.min(window.innerWidth - 26, Math.max(26, r.left + r.width / 2));
        arrow.style.left = `${cx}px`;
        arrow.style.top = below ? `${r.bottom + 10}px` : `${r.top - 54}px`;
        arrow.innerHTML = below ? '<i class="fas fa-arrow-up"></i>' : '<i class="fas fa-arrow-down"></i>';
        arrow.classList.toggle("up", below);
        arrow.classList.toggle("down", !below);
        arrow.classList.add("on");
      } else {
        spot.classList.remove("on");
        arrow.classList.remove("on");
        dim.classList.add("on");
      }
    }
  }

  function teardown() {
    ended = true;
    cancelAnimationFrame(raf);
    clearInterval(timer);
    ["click", "pointerdown", "mousedown"].forEach((t) => window.removeEventListener(t, guard, true));
    window.removeEventListener("keydown", onKey, true);
  }

  // Put the teacher back where they started — the tour opened these.
  function restorePage() {
    try { if (h.mcSheet.classList.contains("open")) h.closeClass(); } catch {}
    try { if (h.ocSheet.classList.contains("open")) h.closeOtherClasses(); } catch {}
    try { if (h.sidebar.classList.contains("open")) h.closeSidebar(); } catch {}
  }

  function end(outcome) {
    if (ended) return;
    teardown();
    markSeen(db, uid, outcome);
    restorePage();
    root.remove();
  }

  function finish() {
    if (ended) return;
    teardown();
    markSeen(db, uid, "completed");
    [spot, arrow, bar, dim].forEach((x) => x.remove());
    try { if (h.sidebar.classList.contains("open")) h.closeSidebar(); } catch {}
    showCard({
      hero: `<div class="swt-done-icon"><i class="fas fa-circle-check" aria-hidden="true"></i></div>
             <h2 class="swt-title">هذه هي الطريقة</h2>`,
      body: `
        <p class="swt-lead">من هنا، عند دخولك حصة ليست في جدولك:</p>
        <div class="swt-steps">
          <div class="swt-step">
            <span class="swt-step-icon"><i class="fas fa-users-rectangle" aria-hidden="true"></i></span>
            <span class="swt-step-text"><b>اختر الصف ثم الفصل</b><small>الذي أنت فيه الآن</small></span>
          </div>
          <div class="swt-step">
            <span class="swt-step-icon"><i class="fas fa-clipboard-check" aria-hidden="true"></i></span>
            <span class="swt-step-text"><b>اضغط «تسجيل الغياب»</b><small>واختر السبب: احتياط أو تبديل</small></span>
          </div>
        </div>`,
      button: "حسناً",
      // Back to the main page (الرئيسية) once they've read it.
      onButton: () => { restorePage(); root.remove(); },
    });
  }

  function showCard({ hero, body, button, footer = "", onButton }) {
    const intro = el("div", "swt-intro");
    intro.innerHTML = `
      <section class="swt-card" role="dialog" aria-modal="true">
        <div class="swt-hero">${hero}</div>
        <div class="swt-body">${body}<button type="button" class="swt-btn">${button}</button>${footer}</div>
      </section>`;
    root.appendChild(intro);
    requestAnimationFrame(() => intro.classList.add("open"));
    const btn = intro.querySelector(".swt-btn");
    btn.addEventListener("click", () => {
      intro.classList.remove("open");
      setTimeout(() => { intro.remove(); onButton(); }, 220);
    });
    setTimeout(() => btn.focus({ preventScroll: true }), 300);
  }

  showCard({
    hero: `
      <span class="swt-badge">🔔 تحديث جديد</span>
      <div class="swt-hero-icons">
        <span class="swt-hero-old"><i class="fas fa-right-left" aria-hidden="true"></i></span>
        <span class="swt-hero-arrow"><i class="fas fa-arrow-left" aria-hidden="true"></i></span>
        <span class="swt-hero-new"><i class="fas fa-users-rectangle" aria-hidden="true"></i></span>
      </div>
      <h2 class="swt-title">أوقفنا آلية التبديل</h2>`,
    body: `
      <p class="swt-lead">لم تعد هناك طلبات تبديل أو تغطية.</p>
      <div class="swt-steps">
        <div class="swt-step">
          <span class="swt-step-icon"><i class="fas fa-user-clock" aria-hidden="true"></i></span>
          <span class="swt-step-text"><b>دخلت حصة ليست في جدولك؟</b><small>احتياط أو تبديل</small></span>
        </div>
        <div class="swt-step">
          <span class="swt-step-icon"><i class="fas fa-users-rectangle" aria-hidden="true"></i></span>
          <span class="swt-step-text"><b>سجّل غيابها من «صفوف أخرى»</b><small>في القائمة الجانبية</small></span>
        </div>
      </div>`,
    button: "حسناً، أرني كيف",
    footer: `<p class="swt-foot">جولة قصيرة · خطوتان فقط</p>`,
    onButton: () => {
      goTo(0);
      timer = setInterval(checkProgress, 120);
      raf = requestAnimationFrame(position);
    },
  });
}
