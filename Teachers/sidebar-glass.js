// Liquid-glass sidebar links (vertical take on beta/navbar-standalone.html).
// Every .sidebar-group made of .sidebar-link buttons gets its own glass lens;
// the sidebar itself looks exactly as before. The lens rests on the group's
// .is-current link (set by updateSidebarActive in user.html), flows to a
// tapped / keyboard-focused link, and can be picked up — hold on touch,
// press-and-move with a mouse — and dragged up and down; dropping it on a
// link clicks that link. It does not follow the mouse around.
//
// Layers the script adds inside each (invisible) track, .sg-track:
//   .sg-glass  lens body (tint + shadow), under the links
//   .sg-row    the real links; a lens-shaped hole is cut out of it
//   .sg-lens   a tinted, magnified copy of the links, bent at the rim
//   .sg-rim    specular rim on top
// Without this script the sidebar is the plain list it always was.
(function () {
  const HOLD_MS = 220; // touch: hold this long to pick up the lens (moving earlier scrolls)
  const DRAG_PX = 6; // mouse: or move this far

  const LENS_MAG = 0.06; // extra magnification when fully lifted
  const LENS_GROW_X = 10; // lens grows this much wider when lifted, px (the track is narrow)...
  const LENS_GROW_Y = 0.24; // ...and this much taller (it pops out of the track)
  const LENS_BEND = 16; // displacement at the lens rim, px (filter scale)
  const LENS_RADIUS = 12; // the links' own corner radius (.sg-glass in user.css)

  const NS = 'http://www.w3.org/2000/svg';
  const XLINK = 'http://www.w3.org/1999/xlink';
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ua = navigator.userAgent;
  const isIOS = /iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  const sidebar = document.getElementById('sidebar');
  if (!sidebar || !window.ResizeObserver || !window.MutationObserver) return;

  const holeProp = ['clipPath', 'webkitClipPath'].find((p) => {
    const css = p === 'clipPath' ? 'clip-path' : '-webkit-clip-path';
    return window.CSS && CSS.supports(css, 'path(evenodd, "M0 0H1V1Z")');
  });

  function svgEl(name, attrs, parent) {
    const el = document.createElementNS(NS, name);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.append(el);
    return el;
  }

  const svg = svgEl('svg', { width: '0', height: '0', 'aria-hidden': 'true', focusable: 'false' });
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  const defs = svgEl('defs', {}, svg);
  document.body.append(svg);

  // Displacement map for a rounded rect: neutral in the middle; towards the
  // rim it samples further inwards along a circular bevel, which is what
  // makes things look bent through thick glass. `horizontal` tones down the
  // sideways bend (the lens is wide; bending it all the way would mirror the
  // icon into the rim).
  function makeMap(w, h, radius, edge, horizontal) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const r = Math.min(radius, w / 2, h / 2);
    const hx = w / 2 - r;
    const hy = h / 2 - r;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5 - w / 2;
        const py = y + 0.5 - h / 2;
        const qx = Math.abs(px) - hx;
        const qy = Math.abs(py) - hy;
        const ax = Math.max(qx, 0);
        const ay = Math.max(qy, 0);
        const len = Math.hypot(ax, ay);
        const inside = r - (len + Math.min(Math.max(qx, qy), 0)); // distance to the rim
        let nx = 0;
        let ny = 0;
        if (len > 0) {
          nx = (Math.sign(px) * ax) / len;
          ny = (Math.sign(py) * ay) / len;
        } else if (qx > qy) nx = Math.sign(px);
        else ny = Math.sign(py);
        let amt = 0;
        if (inside < edge) {
          const t = 1 - Math.max(inside, 0) / edge;
          amt = 1 - Math.sqrt(1 - t * t);
        }
        const i = (y * w + x) * 4;
        d[i] = 128 - nx * amt * horizontal * 127;
        d[i + 1] = 128 - ny * amt * 127;
        d[i + 2] = 128;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  // Android has vibrate(); iOS 18+ gives a tick when a switch is toggled.
  let hapticLabel = null;
  function haptic() {
    try {
      if (navigator.vibrate) {
        navigator.vibrate(8);
      } else if (isIOS) {
        if (!hapticLabel) {
          hapticLabel = document.createElement('label');
          hapticLabel.setAttribute('aria-hidden', 'true');
          hapticLabel.style.cssText =
            'position:fixed;top:0;left:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;clip-path:inset(50%)';
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.setAttribute('switch', '');
          input.tabIndex = -1;
          hapticLabel.append(input);
          document.body.append(hapticLabel);
        }
        hapticLabel.click();
      }
    } catch {
      // no haptics, no problem
    }
  }

  /* === Springs === */

  const spring = (eps, x = 0) => ({ x, v: 0, t: x, k: 400, z: 1, eps });

  function to(s, t, k, z) {
    s.t = t;
    s.k = k;
    s.z = z;
  }

  function snap(s, t) {
    s.x = s.t = t;
    s.v = 0;
  }

  // Returns true while still moving.
  function step(s, dt) {
    if (motionQuery.matches) {
      s.x = s.t;
      s.v = 0;
      return false;
    }
    const n = Math.ceil(dt * 240);
    const h = dt / n;
    const c = 2 * s.z * Math.sqrt(s.k);
    for (let i = 0; i < n; i++) {
      s.v += (-s.k * (s.x - s.t) - c * s.v) * h;
      s.x += s.v * h;
    }
    if (Math.abs(s.x - s.t) < s.eps && Math.abs(s.v) < s.eps * 10) {
      s.x = s.t;
      s.v = 0;
      return false;
    }
    return true;
  }

  const fx = (n) => n.toFixed(2);
  const rubber = (d, max) => max * (1 - 1 / (1 + (Math.abs(d) * 0.55) / max)) * Math.sign(d);
  const isShown = (el) => el.offsetHeight > 0;

  /* === One glass group === */

  function initGroup(group, index) {
    const track = document.createElement('div');
    track.className = 'sg-track';
    const row = document.createElement('div');
    row.className = 'sg-row';
    group.querySelectorAll(':scope > .sidebar-link').forEach((link) => row.append(link));
    track.append(row);
    group.append(track);

    function layer(cls) {
      const el = document.createElement('span');
      el.className = cls;
      el.setAttribute('aria-hidden', 'true');
      el.hidden = true;
      return el;
    }
    const glass = layer('sg-glass');
    const lens = layer('sg-lens');
    const rim = layer('sg-rim');
    track.prepend(glass);
    track.append(lens, rim);
    const lensLayers = [glass, lens, rim];

    const filterId = `sgLensFx${index}`;
    const filter = svgEl(
      'filter',
      { id: filterId, x: '0', y: '0', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' },
      defs
    );
    const lensMap = svgEl('feImage', { result: 'map', x: '0', y: '0', width: '1', height: '1', preserveAspectRatio: 'none' }, filter);
    const lensBend = svgEl(
      'feDisplacementMap',
      { in: 'SourceGraphic', in2: 'map', scale: '0', xChannelSelector: 'R', yChannelSelector: 'G' },
      filter
    );

    let links = [];
    let clone = null;
    let current = -1; // the group's .is-current link, or -1
    let focus = -1; // where keyboard focus / a tap / a drop put the lens, or -1

    // The copy inside the lens, rebuilt whenever the real links change.
    function rebuildClone() {
      const next = row.cloneNode(true);
      next.className = 'sg-row sg-clone';
      next.removeAttribute('style');
      next.inert = true;
      next.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
      next.querySelectorAll('.sidebar-link').forEach((el) => {
        el.removeAttribute('aria-label');
        el.tabIndex = -1;
      });
      if (clone) clone.replaceWith(next);
      else lens.append(next);
      clone = next;
      if (m) clone.style.width = `${m.rowW}px`;
    }

    /* --- Layout --- */

    let m = null; // metrics, in the track's padding-box coordinates
    let mapKey = '';

    function measure() {
      links = [...row.querySelectorAll(':scope > .sidebar-link')].filter(isShown);
      if (!links.length || !row.offsetWidth) {
        m = null;
        return false;
      }
      const rowX = row.offsetLeft;
      const rowY = row.offsetTop;
      const items = links.map((l) => ({ top: rowY + l.offsetTop, bottom: rowY + l.offsetTop + l.offsetHeight }));
      m = {
        rowX,
        rowY,
        rowW: row.offsetWidth,
        rowH: row.offsetHeight,
        itemW: links[0].offsetWidth,
        itemH: links[0].offsetHeight,
        midX: rowX + links[0].offsetLeft + links[0].offsetWidth / 2,
        items,
        centers: items.map((it) => (it.top + it.bottom) / 2),
      };
      if (clone) clone.style.width = `${m.rowW}px`;
      const w = Math.round(m.itemW + LENS_GROW_X);
      const h = Math.round(m.itemH * (1 + LENS_GROW_Y));
      const key = `${w}x${h}`;
      if (key !== mapKey) {
        mapKey = key;
        const url = makeMap(w, h, LENS_RADIUS, h * 0.34, 0.25);
        if (url) {
          lensMap.setAttribute('href', url);
          lensMap.setAttributeNS(XLINK, 'xlink:href', url);
        }
      }
      return true;
    }

    /* --- Springs --- */

    const T = spring(0.05); // lens top edge
    const B = spring(0.05); // lens bottom edge
    const X = spring(0.05); // lens sideways offset while dragging
    const lift = spring(0.002); // 0 = resting lens, 1 = lifted lens
    const vis = spring(0.002); // 0 = gone, 1 = showing
    const springs = [T, B, X, lift, vis];

    let raf = 0;
    let lastT = 0;
    let settling = false; // the drop-in wobble owns the lift spring

    function kick() {
      if (raf) return;
      lastT = performance.now();
      raf = requestAnimationFrame(frame);
    }

    function frame(now) {
      const dt = Math.min(0.034, Math.max(0.001, (now - lastT) / 1000));
      lastT = now;
      if (!p && !settling) {
        // Not held: the lens turns to glass only while it is flying fast.
        const speed = Math.abs(T.v + B.v) / 2;
        to(lift, Math.min(0.8, speed / 1500), 300, 0.5);
      }
      let moving = false;
      for (const s of springs) moving = step(s, dt) || moving;
      if (settling && lift.x === lift.t && !lift.v) settling = false;
      render();
      raf = moving || p ? requestAnimationFrame(frame) : 0;
    }

    /* --- Render --- */

    let lastBend = -1;
    let lastMapSize = '';

    function render() {
      const show = m && vis.x > 0.01;
      if (glass.hidden === !!show) lensLayers.forEach((el) => (el.hidden = !show));
      if (!show) {
        if (holeProp) row.style[holeProp] = '';
        return;
      }

      const lf = Math.max(0, lift.x);
      const coreH = Math.max(m.itemH * 0.5, B.x - T.x);
      const stretch = Math.min(2.2, Math.max(0.7, coreH / m.itemH));
      const appear = Math.min(1, Math.max(0, vis.x));
      const h = coreH * (1 + LENS_GROW_Y * lf) * (0.82 + 0.18 * appear);
      const w = ((m.itemW + LENS_GROW_X * lf) / Math.pow(stretch, 0.12)) * (0.94 + 0.06 * appear); // keeps its volume
      const cy = (T.x + B.x) / 2;
      const cx = m.midX + X.x;
      const x = cx - w / 2;
      const y = cy - h / 2;

      const box = `translate3d(${fx(x)}px, ${fx(y)}px, 0)`;
      for (const el of lensLayers) {
        el.style.width = `${fx(w)}px`;
        el.style.height = `${fx(h)}px`;
        el.style.transform = box;
        el.style.opacity = appear.toFixed(3);
      }

      // The copy of the links, magnified around the lens centre.
      const mag = 1 + LENS_MAG * lf;
      const ax = cx - x - mag * (cx - m.rowX);
      const ay = cy - y - mag * (cy - m.rowY);
      clone.style.transform = `translate3d(${fx(ax)}px, ${fx(ay)}px, 0) scale(${mag.toFixed(4)})`;

      // Bend the rim (only while lifted, so the resting pill stays crisp).
      const bend = lf > 0.02 ? Math.round(LENS_BEND * Math.min(lf, 1.2) * 4) / 4 : 0;
      if (bend !== lastBend) {
        lastBend = bend;
        lens.style.filter = bend ? `url(#${filterId})` : '';
        lensBend.setAttribute('scale', String(bend));
      }
      if (bend) {
        const size = `${Math.round(w)}x${Math.round(h)}`;
        if (size !== lastMapSize) {
          lastMapSize = size;
          lensMap.setAttribute('width', Math.round(w));
          lensMap.setAttribute('height', Math.round(h));
        }
      }

      // Cut the lens out of the real links so nothing shows twice (only once
      // it is solid; while fading in or out both are seen).
      if (holeProp) {
        if (appear > 0.6) {
          const ox = x - m.rowX;
          const oy = y - m.rowY;
          const r = Math.min(LENS_RADIUS, w / 2, h / 2);
          const pad = 40;
          const outer = `M${-pad} ${-pad}H${m.rowW + pad}V${m.rowH + pad}H${-pad}Z`;
          const hole =
            `M${fx(ox + r)} ${fx(oy)}H${fx(ox + w - r)}A${fx(r)} ${fx(r)} 0 0 1 ${fx(ox + w)} ${fx(oy + r)}` +
            `V${fx(oy + h - r)}A${fx(r)} ${fx(r)} 0 0 1 ${fx(ox + w - r)} ${fx(oy + h)}` +
            `H${fx(ox + r)}A${fx(r)} ${fx(r)} 0 0 1 ${fx(ox)} ${fx(oy + h - r)}` +
            `V${fx(oy + r)}A${fx(r)} ${fx(r)} 0 0 1 ${fx(ox + r)} ${fx(oy)}Z`;
          row.style[holeProp] = `path(evenodd, "${outer}${hole}")`;
        } else {
          row.style[holeProp] = '';
        }
      }

      // Light: tint fades as the lens lifts; the highlight swings with speed.
      const tint = Math.max(0, 1 - Math.min(1, lf) * 0.9);
      const vel = (T.v + B.v) / 2;
      glass.style.setProperty('--tint', tint.toFixed(3));
      glass.style.setProperty('--lift', Math.min(1, lf).toFixed(3));
      rim.style.setProperty('--tint', tint.toFixed(3));
      rim.style.setProperty('--la', `${(160 + Math.max(-35, Math.min(35, vel * 0.02))).toFixed(1)}deg`);
    }

    /* --- Positioning --- */

    function edgesOf(i) {
      return [m.items[i].top, m.items[i].bottom];
    }

    // Moving between links: the leading edge springs ahead, the trailing one lags.
    function flowTo(i, lead, trail) {
      const [t, b] = edgesOf(i);
      const dir = Math.sign(m.centers[i] - (T.x + B.x) / 2);
      to(T, t, ...(dir < 0 ? lead : trail));
      to(B, b, ...(dir > 0 ? lead : trail));
    }

    // Puts the lens on link i (or takes it away for -1).
    function moveTo(i, animate) {
      if (!m && !measure()) return;
      animate = animate && !motionQuery.matches && sidebar.classList.contains('open');
      if (i < 0) {
        if (animate) to(vis, 0, 260, 0.9);
        else snap(vis, 0);
        if (animate) kick();
        else render();
        return;
      }
      if (!animate || vis.x < 0.05) {
        const [t, b] = edgesOf(i);
        snap(T, t);
        snap(B, b);
      } else {
        flowTo(i, [520, 0.68], [230, 0.8]);
      }
      if (animate) {
        to(vis, 1, 380, 0.62);
        kick();
      } else {
        snap(vis, 1);
        render();
      }
    }

    const target = () => (focus >= 0 ? focus : current);

    // Called whenever the links, their .is-current or the sidebar change.
    function sync(animate) {
      const focused = focus >= 0 ? links[focus] : null;
      rebuildClone();
      measure();
      current = links.findIndex((l) => l.classList.contains('is-current'));
      focus = focused ? links.indexOf(focused) : -1;
      if (!p) moveTo(target(), animate);
    }

    // The sidebar slid open: the current lens drops in like a bead of glass.
    function opened() {
      focus = -1;
      sync(false);
      if (current < 0 || motionQuery.matches) return;
      settling = true;
      snap(lift, 0.9);
      to(lift, 0, 170, 0.32);
      snap(vis, 0.4);
      to(vis, 1, 260, 0.55);
      kick();
    }

    function closed() {
      if (p) endPress(false);
      focus = -1;
    }

    const ro = new ResizeObserver(() => {
      if (!measure()) {
        render();
        return;
      }
      if (!p && target() >= 0) {
        const [t, b] = edgesOf(target());
        if (!raf) {
          snap(T, t);
          snap(B, b);
        } else {
          T.t = t;
          B.t = b;
        }
      }
      render();
    });
    ro.observe(row);
    ro.observe(track);

    /* --- Hover & keyboard focus --- */

    function linkIndex(el) {
      const link = el && el.closest && el.closest('.sidebar-link');
      return link ? links.indexOf(link) : -1;
    }

    // The hole cut out of the row takes hit-testing with it, so whatever is
    // under the lens is found from the pointer position instead.
    function indexAt(pt) {
      if (!m || pt.x < m.rowX || pt.x > m.rowX + m.rowW) return -1;
      return m.items.findIndex((it) => pt.y >= it.top && pt.y <= it.bottom);
    }

    // The lens doesn't chase the mouse: only a click, a drag or keyboard focus moves it.
    row.addEventListener('focusin', (e) => {
      if (!e.target.matches(':focus-visible')) return;
      const i = linkIndex(e.target);
      if (i >= 0) {
        focus = i;
        moveTo(i, true);
      }
    });
    row.addEventListener('focusout', (e) => {
      if (row.contains(e.relatedTarget) || p) return;
      focus = -1;
      moveTo(current, true);
    });

    /* --- Hold & drag --- */

    let p = null; // the press: { id, type, x0, y0, lastX, lastY, lastT, vy, dragging, target, timer }
    let swallowClick = false;

    // Pointer position in the track's padding-box coordinates.
    function toLocal(e) {
      const rect = track.getBoundingClientRect();
      return { x: e.clientX - rect.left - track.clientLeft, y: e.clientY - rect.top - track.clientTop };
    }

    function nearest(y) {
      let best = 0;
      let bestDist = Infinity;
      m.centers.forEach((c, i) => {
        const d = Math.abs(y - c);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      return best;
    }

    function follow(pt) {
      const minC = m.centers[0];
      const maxC = m.centers[m.centers.length - 1];
      let c = pt.y;
      let o = 0;
      if (c < minC) o = rubber(c - minC, m.itemH * 0.35);
      else if (c > maxC) o = rubber(c - maxC, m.itemH * 0.35);
      if (o) c = (o < 0 ? minC : maxC) + o;

      // Edges chase the finger; the one in front is stiffer, so speed stretches it.
      const half = m.itemH / 2;
      const lead = [1100, 0.72];
      const trail = [520, 0.82];
      to(T, c - half, ...(p.vy < 0 ? lead : trail));
      to(B, c + half, ...(p.vy > 0 ? lead : trail));
      to(X, rubber(pt.x - m.midX, 7), 700, 0.7);

      const i = nearest(c);
      if (i !== p.target) {
        p.target = i;
        haptic();
      }
    }

    function startDrag() {
      if (!p || p.dragging) return;
      p.dragging = true;
      clearTimeout(p.timer);
      try {
        track.setPointerCapture(p.id);
      } catch {
        // the pointer is already gone
      }
      track.classList.add('dragging');
      if (vis.x < 0.05) {
        const [t, b] = edgesOf(p.target);
        snap(T, t);
        snap(B, b);
      }
      to(vis, 1, 420, 0.6);
      to(lift, 1, 420, 0.55);
      haptic();
      follow({ x: p.lastX, y: p.lastY });
      kick();
    }

    function endPress(commit) {
      if (!p) return;
      clearTimeout(p.timer);
      const { dragging, target: dropped } = p;
      p = null;
      track.classList.remove('dragging');

      to(X, 0, 520, 0.55);
      to(lift, 0, 300, 0.5); // frame() takes over the target from here
      kick();

      if (!dragging) return;
      swallowClick = true; // the release must not also count as a tap
      setTimeout(() => (swallowClick = false), 400);

      if (commit && dropped >= 0 && dropped !== current) {
        focus = dropped;
        flowTo(dropped, [520, 0.6], [300, 0.7]);
        links[dropped].click();
      } else {
        focus = -1;
        if (current >= 0) flowTo(current, [520, 0.6], [300, 0.7]);
        else to(vis, 0, 260, 0.9);
      }
    }

    track.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (p) endPress(false);
      if (!m && !measure()) return;
      const pt = toLocal(e);
      const i = indexAt(pt);
      if (i < 0) return;
      swallowClick = false;

      p = {
        id: e.pointerId,
        type: e.pointerType,
        x0: e.clientX,
        y0: e.clientY,
        lastX: pt.x,
        lastY: pt.y,
        lastT: e.timeStamp,
        vy: 0,
        dragging: false,
        target: i,
        timer: 0,
      };
      // Mouse: pressing the link under the lens lifts it, ready to be dragged.
      if (e.pointerType !== 'touch' && i === target() && vis.x > 0.5) to(lift, 1, 420, 0.55);
      if (e.pointerType === 'touch') p.timer = setTimeout(startDrag, HOLD_MS);
      kick();
    });

    track.addEventListener('pointermove', (e) => {
      if (!p || e.pointerId !== p.id) return;
      const pt = toLocal(e);
      const dt = e.timeStamp - p.lastT;
      if (dt > 0) p.vy = p.vy * 0.6 + ((pt.y - p.lastY) / dt) * 1000 * 0.4;
      p.lastX = pt.x;
      p.lastY = pt.y;
      p.lastT = e.timeStamp;

      if (!p.dragging) {
        const dist = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
        if (dist > DRAG_PX) {
          // A finger that moves before the hold is a scroll; a mouse starts dragging.
          if (p.type === 'touch') endPress(false);
          else startDrag();
        }
        return;
      }
      e.preventDefault();
      follow(pt);
    });

    // Once the lens is held, the finger moves it instead of scrolling the sidebar.
    track.addEventListener(
      'touchmove',
      (e) => {
        if (p && p.dragging && e.cancelable) e.preventDefault();
      },
      { passive: false }
    );

    track.addEventListener('pointerup', (e) => {
      if (p && e.pointerId === p.id) endPress(true);
    });
    track.addEventListener('pointercancel', (e) => {
      if (p && e.pointerId === p.id) endPress(false);
    });
    track.addEventListener('lostpointercapture', (e) => {
      if (p && e.pointerId === p.id && p.dragging) endPress(true);
    });

    // No long-press menu / text selection while holding the lens.
    track.addEventListener('contextmenu', (e) => {
      if (p) e.preventDefault();
    });
    track.addEventListener('selectstart', (e) => e.preventDefault());
    track.addEventListener('dragstart', (e) => e.preventDefault());

    // A tap: the lens flows to the tapped link while the sidebar slides away.
    // (The link's own click handler runs after this.) A tap on the lens
    // lands on the track, so it is handed to the link underneath.
    track.addEventListener(
      'click',
      (e) => {
        if (!e.isTrusted) return; // a drop / a forwarded tap clicks the link itself
        if (swallowClick) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        let i = linkIndex(e.target);
        const forward = i < 0;
        if (forward) i = indexAt(toLocal(e));
        if (i < 0) return;
        focus = i;
        moveTo(i, true);
        if (forward) {
          e.stopPropagation();
          links[i].click();
        }
      },
      true
    );

    return {
      sync,
      opened,
      closed,
      cancel: () => endPress(false),
      owns: (node) => row.contains(node),
    };
  }

  /* === Wire every group === */

  const groups = [...sidebar.querySelectorAll('.sidebar-group:not(.sidebar-group-bottom)')]
    .filter((g) => g.querySelector(':scope > .sidebar-link'))
    .map(initGroup);
  if (!groups.length) return;
  sidebar.classList.add('has-glass');

  let wasOpen = sidebar.classList.contains('open');
  const mo = new MutationObserver((records) => {
    const isOpen = sidebar.classList.contains('open');
    if (isOpen !== wasOpen) {
      wasOpen = isOpen;
      groups.forEach((g) => (isOpen ? g.opened() : g.closed()));
      return;
    }
    // Only the real links count; the layers and the copies in the lenses
    // change on every frame / rebuild.
    const touched = new Set();
    for (const r of records) {
      for (const g of groups) if (g.owns(r.target)) touched.add(g);
    }
    touched.forEach((g) => g.sync(isOpen));
  });
  mo.observe(sidebar, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'hidden', 'disabled'],
  });
  groups.forEach((g) => g.sync(false));
  window.addEventListener('blur', () => groups.forEach((g) => g.cancel()));
})();
