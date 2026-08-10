// js/spice-wheel.js
// Data-driven, fully interactive spice wheel. Renders N wedges from JSON,
// not a fixed 6 — swap the fetch URL below for an API later and nothing
// else needs to change. No-ops instantly if #spice-wheel-mount isn't on
// the page (i.e. every page except index.html).
//
// Motion model: everything (idle spin, drag, momentum) is ONE JS
// requestAnimationFrame loop driving a single `rotation` value in degrees.
// This is what lets mouse-drag, touch-drag, and idle auto-spin all behave
// identically instead of fighting a separate CSS animation.

(function () {
  const mount = document.getElementById('spice-wheel-mount');
  if (!mount) return;

  const DEFAULT_ITEMS = [
    { id: 'turmeric', label: 'Turmeric',      href: 'products/turmeric-powder',   color: '#d4a017' },
    { id: 'chilli',   label: 'Red Chilli',     href: 'products/red-chilli-powder', color: '#ad2b17' },
    { id: 'chaat',    label: 'Chaat Masala',   href: 'products/chaat-masala',      color: '#7c8b4a' },
    { id: 'biryani',  label: 'Biryani Masala', href: 'products/biryani-masala',    color: '#3f6b54' },
    { id: 'chai',     label: 'Chai Masala',    href: 'products/chai-masala',       color: '#8b5a2b' },
    { id: 'garam',    label: 'Garam Masala',   href: 'products/garam-masala',      color: '#3a2420' },
  ];
  const PALETTE = ['#d4a017', '#ad2b17', '#7c8b4a', '#3f6b54', '#8b5a2b', '#3a2420', '#7b1120', '#c98a2b'];

  const inSubdir = /\/(products|recipes|guide)\//.test(location.pathname);
  const SITE_PREFIX = inSubdir ? '../' : '';

  // ── SWAP THIS for the future API call, e.g. fetch(SITE_PREFIX + '/api/spice-wheel') ──
  fetch(SITE_PREFIX + 'data/spice-wheel.json')
    .then(r => (r.ok ? r.json() : Promise.reject()))
    .then(data => build(Array.isArray(data?.items) && data.items.length ? data.items : DEFAULT_ITEMS))
    .catch(() => build(DEFAULT_ITEMS));

  function resolveHref(href) {
    return /^https?:\/\//.test(href) ? href : SITE_PREFIX + href;
  }

  function pointOnCircle(cx, cy, r, angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  }

  // ── BUILD DOM from data ──
  function build(items) {
    const n = items.length;
    const svgNS = 'http://www.w3.org/2000/svg';
    const cx = 100, cy = 100, r = 100;
    const slice = 360 / n;

    mount.innerHTML = '';

    const rotor = document.createElement('div');
    rotor.className = 'spice-wheel-rotor';

    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 200 200');
    svg.setAttribute('class', 'spice-wheel-svg');

    const labelsWrap = document.createElement('div');
    labelsWrap.className = 'spice-wheel-labels';

    const entries = []; // { wedgeEl, labelEl, centerAngle, href }

    items.forEach((item, i) => {
      // 0deg = 3 o'clock, clockwise (standard SVG/atan2 convention).
      // Shifted by -90 so wedge 0 starts at 12 o'clock, matching the marker.
      const startAngle = i * slice - 90;
      const endAngle = startAngle + slice;
      const centerAngle = startAngle + slice / 2;
      const large = slice > 180 ? 1 : 0;
      const [x1, y1] = pointOnCircle(cx, cy, r, startAngle);
      const [x2, y2] = pointOnCircle(cx, cy, r, endAngle);
      const d = `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`;
      const href = resolveHref(item.href);

      const a = document.createElementNS(svgNS, 'a');
      a.setAttribute('class', 'wedge-link');
      a.setAttribute('href', href);
      a.setAttribute('aria-label', `Shop ${item.label}`);

      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'wedge');
      path.style.setProperty('--wedge-fill', item.color || PALETTE[i % PALETTE.length]);
      a.appendChild(path);
      svg.appendChild(a);

      const label = document.createElement('a');
      label.className = 'wheel-label';
      label.href = href;
      // NOTE: this angle offset (+90) reconciles the SVG path's 0°=3-o'clock
      // convention with the label's translate/rotate CSS trick below, which
      // expects 0°=12-o'clock. If labels ever look rotated off their wedge
      // after editing wedge counts, this +90 is the constant to retune.
      label.style.setProperty('--ang', `${centerAngle + 90}deg`);
      const inner = document.createElement('span');
      inner.className = 'wheel-label-inner';
      inner.textContent = item.label;
      label.appendChild(inner);
      labelsWrap.appendChild(label);

      entries.push({ wedgeEl: a, labelEl: label, centerAngle, href });
    });

    rotor.appendChild(svg);
    rotor.appendChild(labelsWrap);
    mount.appendChild(rotor);

    const marker = document.createElement('div');
    marker.className = 'spice-wheel-marker';
    marker.setAttribute('aria-hidden', 'true');
    mount.appendChild(marker);

    const hub = document.createElement('a');
    hub.className = 'spice-wheel-hub';
    hub.href = resolveHref('products');
    hub.setAttribute('aria-label', 'Shop all Mom Masale products');
    hub.innerHTML =
      '<span class="hub-glyph" aria-hidden="true">✦</span>' +
      '<span class="hub-text hub-text-default">MOM<br>MASALE</span>' +
      '<span class="hub-text hub-text-hover">Shop All<span aria-hidden="true"> →</span></span>';
    mount.appendChild(hub);

    setupInteraction(mount, rotor, labelsWrap, entries, hub);
  }

  // ── INTERACTION: unified idle/drag/momentum loop + tap-vs-drag + marker sync ──
  function setupInteraction(wheel, rotor, labelsWrap, entries, hub) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const IDLE_VELOCITY = reduceMotion ? 0 : 9; // deg/sec — ~40s per revolution

    let rotation = 0;
    let velocity = IDLE_VELOCITY;
    let dragging = false;
    let pointerId = null;
    let hovering = false;
    let lastAngle = 0, lastMoveTime = 0;
    let startX = 0, startY = 0, startTime = 0, moved = 0;
    let lastFrameTime = 0;

    function angleFromCenter(clientX, clientY) {
      const rect = wheel.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      return (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI;
    }

    function applyRotation() {
      rotor.style.transform = `rotate(${rotation}deg)`;
      labelsWrap.querySelectorAll('.wheel-label-inner').forEach(el => {
        el.style.transform = `rotate(${-rotation}deg)`;
      });
      syncMarker();
    }

    function syncMarker() {
      // Which wedge center is currently nearest the fixed 12-o'clock marker
      // (marker sits at absolute -90deg; wedges are rotated by `rotation`).
      const target = ((-90 - rotation) % 360 + 360) % 360;
      let nearest = entries[0], best = Infinity;
      entries.forEach(en => {
        const c = ((en.centerAngle % 360) + 360) % 360;
        const diff = Math.min(Math.abs(c - target), 360 - Math.abs(c - target));
        if (diff < best) { best = diff; nearest = en; }
      });
      entries.forEach(en => {
        const active = en === nearest;
        en.wedgeEl.classList.toggle('is-marker-active', active);
        en.labelEl.classList.toggle('is-marker-active', active);
      });
    }

    function loop(now) {
      const dt = lastFrameTime ? Math.min((now - lastFrameTime) / 1000, 0.05) : 0;
      lastFrameTime = now;
      if (!dragging) {
        const target = hovering ? 0 : IDLE_VELOCITY;
        velocity += (target - velocity) * Math.min(dt * 2.2, 1);
        if (Math.abs(velocity) > 0.02) {
          rotation += velocity * dt;
          applyRotation();
        }
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
    syncMarker();

    wheel.style.touchAction = 'none'; // let drag control the gesture, not page scroll

    wheel.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = true;
      pointerId = e.pointerId;
      try { wheel.setPointerCapture(pointerId); } catch (err) {}
      startX = e.clientX; startY = e.clientY; startTime = performance.now(); moved = 0;
      lastAngle = angleFromCenter(e.clientX, e.clientY);
      lastMoveTime = startTime;
      velocity = 0;
      wheel.classList.add('is-dragging');
    });

    wheel.addEventListener('pointermove', e => {
      if (!dragging || e.pointerId !== pointerId) return;
      moved = Math.max(moved, Math.hypot(e.clientX - startX, e.clientY - startY));
      const angle = angleFromCenter(e.clientX, e.clientY);
      let delta = angle - lastAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      const now = performance.now();
      const dt = Math.max((now - lastMoveTime) / 1000, 0.001);
      velocity = delta / dt;
      rotation += delta;
      lastAngle = angle;
      lastMoveTime = now;
      applyRotation();
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      wheel.classList.remove('is-dragging');
      if (pointerId !== null) { try { wheel.releasePointerCapture(pointerId); } catch (err) {} }
      pointerId = null;

      const duration = performance.now() - startTime;
      const isTap = moved < 8 && duration < 350;
      if (isTap) {
        const target = e.target.closest('.wedge-link, .wheel-label, .spice-wheel-hub');
        if (target) handleActivate(target, e);
      }
      // else: released mid-spin — `velocity` carries momentum into the idle loop above
    }
    wheel.addEventListener('pointerup', endDrag);
    wheel.addEventListener('pointercancel', endDrag);

    wheel.addEventListener('mouseenter', () => { hovering = true; });
    wheel.addEventListener('mouseleave', () => { hovering = false; });
    wheel.addEventListener('focusin', () => { hovering = true; });
    wheel.addEventListener('focusout', () => { hovering = false; });

    // Hover-sync a wedge with its matching label (desktop)
    entries.forEach(en => {
      [en.wedgeEl, en.labelEl].forEach(el => {
        el.addEventListener('mouseenter', () => setActive(en, true));
        el.addEventListener('mouseleave', () => setActive(en, false));
        el.addEventListener('focus', () => setActive(en, true));
        el.addEventListener('blur', () => setActive(en, false));
      });
    });
    function setActive(en, on) {
      en.wedgeEl.classList.toggle('is-linked-active', on);
      en.labelEl.classList.toggle('is-linked-active', on);
    }

    // Click/keyboard activation — suppressed if it followed a real drag.
    [...entries.map(en => en.wedgeEl), ...entries.map(en => en.labelEl), hub].forEach(el => {
      el.addEventListener('click', e => {
        if (moved >= 8) { e.preventDefault(); return; }
        handleActivate(el, e);
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') handleActivate(el, e);
      });
    });

    function handleActivate(el, e) {
      const href = el.getAttribute('href');
      if (!href) return;
      e.preventDefault();
      wheel.classList.remove('is-clicking');
      void wheel.offsetWidth;
      wheel.classList.add('is-clicking');
      const point = e.clientX !== undefined && e.clientY
        ? { x: e.clientX, y: e.clientY }
        : el.getBoundingClientRect();
      burst(point.x ?? (point.left + point.width / 2), point.y ?? (point.top + point.height / 2));
      setTimeout(() => { window.location.href = href; }, 260);
    }

    function burst(x, y) {
      const symbols = ['✦', '✶', '❋'];
      const count = 7;
      for (let i = 0; i < count; i++) {
        const el = document.createElement('span');
        el.textContent = symbols[Math.floor(Math.random() * symbols.length)];
        const angle = (360 / count) * i + Math.random() * 20;
        const dist = 30 + Math.random() * 22;
        const rad = (angle * Math.PI) / 180;
        const tx = Math.cos(rad) * dist;
        const ty = Math.sin(rad) * dist;
        el.style.cssText = `position:fixed;left:${x}px;top:${y}px;pointer-events:none;z-index:9999;font-size:${Math.random() * 7 + 10}px;color:${Math.random() > 0.5 ? '#d4a017' : '#7b1120'};transform:translate(-50%,-50%);opacity:1;transition:transform .55s ease,opacity .55s ease;user-select:none;`;
        document.body.appendChild(el);
        requestAnimationFrame(() => {
          el.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(0.4)`;
          el.style.opacity = '0';
        });
        setTimeout(() => el.remove(), 600);
      }
    }
  }
})();