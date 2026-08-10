// js/spice-wheel.js
// Powers the homepage hero's interactive spice wheel. Self-contained —
// doesn't touch or depend on main.js. No-ops instantly on any page that
// doesn't have a .spice-wheel (i.e. every page except index.html).
//
// Two things it does:
//   1. Hover-syncs a wedge with its matching label pill (same href), so
//      hovering either one highlights both.
//   2. On click of a wedge, label, or the center hub: plays a quick
//      particle-burst + pulse, then navigates — so the click always
//      feels acknowledged even though the page is about to change.

(function () {
    const wheel = document.querySelector('.spice-wheel');
    if (!wheel) return;

    const linked = wheel.querySelectorAll('.wedge-link, .wheel-label');
    const hub = wheel.querySelector('.spice-wheel-hub');

    function setActive(href, on) {
        wheel.querySelectorAll(`[href="${href}"]`).forEach(el => {
            el.classList.toggle('is-linked-active', on);
        });
    }

    linked.forEach(el => {
        const href = el.getAttribute('href');
        if (!href) return;
        el.addEventListener('mouseenter', () => setActive(href, true));
        el.addEventListener('mouseleave', () => setActive(href, false));
        el.addEventListener('focus', () => setActive(href, true));
        el.addEventListener('blur', () => setActive(href, false));
    });

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
            el.style.cssText = `
                position: fixed;
                left: ${x}px;
                top: ${y}px;
                pointer-events: none;
                z-index: 9999;
                font-size: ${Math.random() * 7 + 10}px;
                color: ${Math.random() > 0.5 ? '#d4a017' : '#7b1120'};
                transform: translate(-50%, -50%);
                opacity: 1;
                transition: transform 0.55s ease, opacity 0.55s ease;
                user-select: none;
            `;
            document.body.appendChild(el);
            requestAnimationFrame(() => {
                el.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(0.4)`;
                el.style.opacity = '0';
            });
            setTimeout(() => el.remove(), 600);
        }
    }

    function handleActivate(el, e) {
        const href = el.getAttribute('href');
        if (!href) return;
        e.preventDefault();
        wheel.classList.remove('is-clicking');
        void wheel.offsetWidth; // restart animation if clicked again quickly
        wheel.classList.add('is-clicking');
        const point = e.clientX !== undefined && e.clientY
            ? { x: e.clientX, y: e.clientY }
            : el.getBoundingClientRect();
        burst(point.x ?? (point.left + point.width / 2), point.y ?? (point.top + point.height / 2));
        setTimeout(() => { window.location.href = href; }, 260);
    }

    linked.forEach(el => {
        el.addEventListener('click', e => handleActivate(el, e));
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') handleActivate(el, e);
        });
    });

    if (hub) {
        hub.addEventListener('click', e => handleActivate(hub, e));
        hub.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') handleActivate(hub, e);
        });
    }
})();
