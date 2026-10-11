/* An overlay only: never move or resize the teacher's schedule. */
(() => {
  'use strict';
  const phone = window.matchMedia('(max-width: 768px)');
  const threshold = 112;
  let gesture = null;
  let refreshing = false;
  let reloadTimer;
  const indicator = document.createElement('div');
  indicator.className = 'teacher-refresh';
  indicator.setAttribute('role', 'status');
  indicator.setAttribute('aria-live', 'polite');
  indicator.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle class="teacher-refresh-track" cx="20" cy="20" r="16"/><circle class="teacher-refresh-ring" cx="20" cy="20" r="16" pathLength="100"/><path class="teacher-refresh-arrow" d="M25 17a6 6 0 1 0 1 5M25 12v5h-5"/></svg><span class="teacher-refresh-label"></span>';
  document.body.append(indicator);
  const label = indicator.querySelector('span');

  function blocked() {
    return !phone.matches || document.body.classList.contains('modal-open') ||
      !!document.querySelector('.sidebar.open, .sheet.open, .modal.open, dialog[open]') ||
      (window.visualViewport && window.visualViewport.scale > 1.05);
  }

  function atTop(target) {
    if ((document.scrollingElement?.scrollTop || window.scrollY || 0) > 1) return false;
    for (let node = target; node && node !== document.body; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight && node.scrollTop > 1 &&
          /auto|scroll/.test(getComputedStyle(node).overflowY)) return false;
    }
    return true;
  }

  function reset() {
    gesture = null;
    indicator.classList.remove('is-visible', 'is-ready', 'is-refreshing');
    label.textContent = '';
  }

  document.addEventListener('touchstart', event => {
    if (refreshing) return;
    reset();
    if (event.touches.length !== 1 || blocked() || !atTop(event.target) ||
        event.target.closest('input, textarea, select, button, a, [contenteditable], [role="slider"]')) return;
    const touch = event.touches[0];
    gesture = { x: touch.clientX, y: touch.clientY, target: event.target, active: false, progress: 0 };
  }, { passive: true });

  document.addEventListener('touchmove', event => {
    if (!gesture || refreshing) return;
    if (event.touches.length !== 1 || blocked() || !atTop(gesture.target)) { reset(); return; }
    const dx = event.touches[0].clientX - gesture.x;
    const dy = event.touches[0].clientY - gesture.y;
    if (!gesture.active) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      // Decide once, before claiming a gesture: leave horizontal/upward swipes alone.
      if (dy <= 0 || dy < Math.abs(dx) * 1.25 || !event.cancelable) { reset(); return; }
      gesture.active = true;
      indicator.classList.add('is-visible');
    }
    if (!event.cancelable) { reset(); return; }
    event.preventDefault();
    gesture.progress = Math.min(1, Math.max(0, dy / threshold));
    indicator.style.setProperty('--refresh-progress', gesture.progress);
    indicator.style.setProperty('--refresh-drop', `${Math.min(76, Math.max(0, dy) * 0.5)}px`);
    const ready = gesture.progress === 1;
    indicator.classList.toggle('is-ready', ready);
    const message = ready ? 'اترك للتحديث' : 'اسحب للتحديث';
    if (label.textContent !== message) label.textContent = message;
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (!gesture || refreshing) return;
    if (!gesture.active || gesture.progress < 1 || blocked()) { reset(); return; }
    gesture = null;
    refreshing = true;
    indicator.classList.add('is-refreshing');
    label.textContent = 'جارٍ التحديث';
    // Give the release animation a moment to settle before navigating.
    reloadTimer = window.setTimeout(() => window.location.reload(), 320);
  }, { passive: true });
  document.addEventListener('touchcancel', () => { if (!refreshing) reset(); }, { passive: true });
  window.addEventListener('pagehide', () => { clearTimeout(reloadTimer); });
  window.addEventListener('pageshow', () => { refreshing = false; reset(); });
})();
