// js/spice-wheel.js
// Modular multi-mode hero wheel. Data comes from GET /api/wheel (D1-backed,
// managed via /api/admin/wheel/modes + /api/admin/wheel/items — see the
// Flutter admin app). Falls back to DEFAULT_MODES below if the API is
// unreachable (e.g. local dev before migrations/027_wheel.sql has run).
//
// MODE CYCLING: tapping the center hub advances to the next active mode
// (wraps around). Dragging/spinning and tap-to-navigate on a wedge behave
// identically no matter which mode is showing — only wedge count, labels,
// colors, and center text change between modes. Adding a 3rd mode later
// is a pure data change (POST a mode + items) — no code change needed.

(function () {
  const mount = document.getElementById('spice-wheel-mount');
  if (!mount) return;

  const DEFAULT_MODES = [
    {
      key: 'shop',
      centerLabel: 'MOM|MASALE',
      centerLabelHover: 'Find Recipes',
      centerGlyph: '✦',
      items: [
        { label: 'Turmeric', href: 'products/turmeric-powder', color: '#d4a017' },
        { label: 'Red Chilli', href: 'products/red-chilli-powder', color: '#ad2b17' },
        { label: 'Chaat Masala', href: 'products/chaat-masala', color: '#7c8b4a' },
        { label: 'Biryani Masala', href: 'products/biryani-masala', color: '#3f6b54' },
        { label: 'Chai Masala', href: 'products/chai-masala', color: '#8b5a2b' },
        { label: 'Garam Masala', href: 'products/garam-masala', color: '#3a2420' },
      ],
    },
    {
      key: 'recipes',
      centerLabel: 'Looking for a|recipe?',
      centerLabelHover: 'Shop Spices',
      centerGlyph: '🍲',
      items: [
        { label: 'Kadak Chai', href: 'recipes/kadak-masala-chai', color: '#8b5a2b' },
        { label: 'Pani Puri', href: 'recipes/pani-puri', color: '#3f6b54' },
        { label: 'Veg Biryani', href: 'recipes/vegetable-biryani', color: '#ad2b17' },
        { label: 'Dal Makhani', href: 'recipes/dal-makhani', color: '#3a2420' },
        { label: 'Shahi Paneer', href: 'recipes/shahi-paneer', color: '#d4a017' },
        { label: 'Shahi Thandai', href: 'recipes/shahi-thandai', color: '#7c8b4a' },
      ],
    },
  ];
  const PALETTE = ['#d4a017', '#ad2b17', '#7c8b4a', '#3f6b54', '#8b5a2b', '#3a2420', '#7b1120', '#c98a2b'];

  const inSubdir = /\/(products|recipes|guide)\//.test(location.pathname);
  const SITE_PREFIX = inSubdir ? '../' : '';

  function resolveHref(href) {
    return /^https?:\/\//.test(href) ? href : SITE_PREFIX + href;
  }
  function escapeHtmlLite(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function twoLine(text) {
    return String(text || '').split('|').map(escapeHtmlLite).join('<br>');
  }
  function pointOnCircle(cx, cy, r, angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  }

  let modesData = [];
  let modeIndex = 0;
  let entries = []; // current mode's { wedgeEl, labelEl, centerAngle }

  let svg, labelsWrap, rotor, marker, hub, hubGlyphEl, hubDefaultEl, hubHoverEl;
  let applyRotation = function () {}; // real implementation assigned in setupInteraction()

  fetch('/api/wheel')
    .then(r => (r.ok ? r.json() : Promise.reject()))
    .then(data => {
      modesData = Array.isArray(data?.modes) && data.modes.length ? data.modes : DEFAULT_MODES;
      init();
    })
    .catch(() => { modesData = DEFAULT_MODES; init(); });

  function init() {
    buildShell();
    setupInteraction();
    renderMode(0);
  }

  // ── STATIC SHELL — svg/labels/marker/hub containers, built once ──
  function buildShell() {
    mount.innerHTML = '';

    rotor = document.createElement('div');
    rotor.className = 'spice-wheel-rotor';

    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 200');
    svg.setAttribute('class', 'spice-wheel-svg');

    labelsWrap = document.createElement('div');
    labelsWrap.className = 'spice-wheel-labels';

    rotor.appendChild(svg);
    rotor.appendChild(labelsWrap);
    mount.appendChild(rotor);

    marker = document.createElement('div');
    marker.className = 'spice-wheel-marker';
    marker.setAttribute('aria-hidden', 'true');
    mount.appendChild(marker);

    hub = document.createElement('button');
    hub.type = 'button';
    hub.className = 'spice-wheel-hub';
    hub.setAttribute('aria-label', 'Switch wheel mode');
    hub.innerHTML =
      '<span class="hub-glyph" aria-hidden="true"></span>' +
      '<span class="hub-text hub-text-default"></span>' +
      '<span class="hub-text hub-text-hover"></span>';
    mount.appendChild(hub);

    hubGlyphEl = hub.querySelector('.hub-glyph');
    hubDefaultEl = hub.querySelector('.hub-text-default');
    hubHoverEl = hub.querySelector('.hub-text-hover');

    hub.addEventListener('click', onHubActivate);
    hub.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHubActivate(); }
    });
  }

  // ── RENDER a mode's wedges/labels/center text into the existing shell ──
  function renderMode(idx) {
    modeIndex = ((idx % modesData.length) + modesData.length) % modesData.length;
    const mode = modesData[modeIndex];
    const items = mode.items || [];
    const n = items.length;
    const svgNS = 'http://www.w3.org/2000/svg';
    const cx = 100, cy = 100, r = 100;
    const slice = n ? 360 / n : 0;

    svg.innerHTML = '';
    labelsWrap.innerHTML = '';
    entries = [];

    items.forEach((item, i) => {
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
      a.setAttribute('aria-label', item.label);
      a.dataset.idx = String(i);

      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'wedge');
      path.style.setProperty('--wedge-fill', item.color || PALETTE[i % PALETTE.length]);
      a.appendChild(path);
      svg.appendChild(a);

      const label = document.createElement('a');
      label.className = 'wheel-label';
      label.href = href;
      label.dataset.idx = String(i);
      label.style.setProperty('--ang', `${centerAngle + 90}deg`);
      const inner = document.createElement('span');
      inner.className = 'wheel-label-inner';
      inner.textContent = item.label;
      label.appendChild(inner);
      labelsWrap.appendChild(label);

      entries.push({ wedgeEl: a, labelEl: label, centerAngle });
    });

    hubGlyphEl.textContent = mode.centerGlyph || '✦';
    hubDefaultEl.innerHTML = twoLine(mode.centerLabel);
    hubHoverEl.innerHTML = escapeHtmlLite(mode.centerLabelHover || 'Tap to switch') + ' <span aria-hidden="true">→</span>';

    applyRotation();
  }

  function onHubActivate() {
    if (modesData.length < 2) return; // nothing to switch to
    mount.classList.add('is-switching');
    hub.classList.remove('is-switching');
    void hub.offsetWidth; // restart the pulse animation
    hub.classList.add('is-switching');
    setTimeout(() => {
      renderMode(modeIndex + 1);
      mount.classList.remove('is-switching');
    }, 170);
  }

  // ── INTERACTION: unified idle/drag/momentum loop + tap-vs-drag + marker sync ──
  function setupInteraction() {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const IDLE_VELOCITY = reduceMotion ? 0 : 9;

    let rotation = 0, velocity = IDLE_VELOCITY, dragging = false, pointerId = null;
    let hovering = false, lastAngle = 0, lastMoveTime = 0;
    let startX = 0, startY = 0, startTime = 0, moved = 0, lastFrameTime = 0;

    function angleFromCenter(clientX, clientY) {
      const rect = mount.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      return (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI;
    }

    applyRotation = function () {
      rotor.style.transform = `rotate(${rotation}deg)`;
      mount.style.setProperty('--rotation', `${rotation}deg`);
      syncMarker();
    };

    function syncMarker() {
      if (!entries.length) return;
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

    mount.style.touchAction = 'none';

    mount.addEventListener('pointerdown', e => {
      if (e.target.closest('.spice-wheel-hub')) return; // hub handles its own tap
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = true;
      pointerId = e.pointerId;
      try { mount.setPointerCapture(pointerId); } catch (err) {}
      startX = e.clientX; startY = e.clientY; startTime = performance.now(); moved = 0;
      lastAngle = angleFromCenter(e.clientX, e.clientY);
      lastMoveTime = startTime;
      velocity = 0;
      mount.classList.add('is-dragging');
    });

    mount.addEventListener('pointermove', e => {
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
      mount.classList.remove('is-dragging');
      if (pointerId !== null) { try { mount.releasePointerCapture(pointerId); } catch (err) {} }
      pointerId = null;

      const duration = performance.now() - startTime;
      const isTap = moved < 8 && duration < 350;
      if (isTap) {
        const target = e.target.closest('.wedge-link, .wheel-label');
        if (target) handleActivate(target, e);
      }
    }
    mount.addEventListener('pointerup', endDrag);
    mount.addEventListener('pointercancel', endDrag);

    mount.addEventListener('mouseenter', () => { hovering = true; });
    mount.addEventListener('mouseleave', () => { hovering = false; });
    mount.addEventListener('focusin', () => { hovering = true; });
    mount.addEventListener('focusout', () => { hovering = false; });

    // Delegated hover-sync between a wedge and its matching label — rebuilt
    // DOM after every mode switch still works since this is delegated.
    mount.addEventListener('mouseover', e => {
      const el = e.target.closest('.wedge-link, .wheel-label');
      if (el) setLinkedActive(el.dataset.idx, true);
    });
    mount.addEventListener('mouseout', e => {
      const el = e.target.closest('.wedge-link, .wheel-label');
      if (el) setLinkedActive(el.dataset.idx, false);
    });
    function setLinkedActive(idx, on) {
      entries.forEach((en, i) => {
        if (String(i) !== idx) return;
        en.wedgeEl.classList.toggle('is-linked-active', on);
        en.labelEl.classList.toggle('is-linked-active', on);
      });
    }

    mount.addEventListener('click', e => {
      const el = e.target.closest('.wedge-link, .wheel-label');
      if (!el) return;
      if (moved >= 8) { e.preventDefault(); return; }
      handleActivate(el, e);
    });
    mount.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target.closest('.wedge-link, .wheel-label');
      if (el) handleActivate(el, e);
    });

    function handleActivate(el, e) {
      const href = el.getAttribute('href');
      if (!href) return;
      e.preventDefault();
      mount.classList.remove('is-clicking');
      void mount.offsetWidth;
      mount.classList.add('is-clicking');
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