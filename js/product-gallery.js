// js/product-gallery.js
// Runs only on generated product detail pages. Purely presentational:
// thumbnail-driven scroll-snap carousel + a lightweight fullscreen
// lightbox. Never touches cart state — that's still main.js's
// syncCardUI/addToCart via .card event delegation, untouched by any of this.

(function () {
    const gallery = document.getElementById('product-gallery');
    const track = document.getElementById('product-gallery-track');
    if (!gallery || !track) return;

    const slides = [...track.querySelectorAll('.product-gallery-slide')];
    const thumbs = [...gallery.querySelectorAll('.product-gallery-thumb')];
    const dots = [...gallery.querySelectorAll('.product-gallery-dot')];
    const zoomBtn = document.getElementById('product-gallery-zoom-btn');
    let current = 0;

    function setActive(index, { scroll = true } = {}) {
        current = Math.max(0, Math.min(index, slides.length - 1));
        thumbs.forEach((t, i) => t.classList.toggle('active', i === current));
        dots.forEach((d, i) => d.classList.toggle('active', i === current));
        if (scroll) track.scrollTo({ left: track.clientWidth * current, behavior: 'smooth' });
    }

    thumbs.forEach((thumb, i) => thumb.addEventListener('click', () => setActive(i)));
    dots.forEach((dot, i) => dot.addEventListener('click', () => setActive(i)));

    let scrollTimer;
    track.addEventListener('scroll', () => {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
            setActive(Math.round(track.scrollLeft / track.clientWidth), { scroll: false });
        }, 80);
    });

    // ── LIGHTBOX ──
    let lightbox, lightboxImg, lightboxCounter;

    function buildLightbox() {
        if (lightbox) return;
        const overlay = document.createElement('div');
        overlay.className = 'gallery-lightbox-overlay';
        overlay.id = 'gallery-lightbox-overlay';

        lightbox = document.createElement('div');
        lightbox.className = 'gallery-lightbox';
        lightbox.innerHTML = `
            <button type="button" class="gallery-lightbox-close" aria-label="Close">✕</button>
            <button type="button" class="gallery-lightbox-nav gallery-lightbox-prev" aria-label="Previous image">‹</button>
            <img class="gallery-lightbox-img" alt="">
            <button type="button" class="gallery-lightbox-nav gallery-lightbox-next" aria-label="Next image">›</button>
            <span class="gallery-lightbox-counter"></span>
        `;
        document.body.appendChild(overlay);
        document.body.appendChild(lightbox);

        lightboxImg = lightbox.querySelector('.gallery-lightbox-img');
        lightboxCounter = lightbox.querySelector('.gallery-lightbox-counter');

        overlay.addEventListener('click', closeLightbox);
        lightbox.querySelector('.gallery-lightbox-close').addEventListener('click', closeLightbox);
        lightbox.querySelector('.gallery-lightbox-prev').addEventListener('click', () => stepLightbox(-1));
        lightbox.querySelector('.gallery-lightbox-next').addEventListener('click', () => stepLightbox(1));
    }

    function renderLightbox() {
        const img = slides[current].querySelector('img');
        lightboxImg.src = img.src;
        lightboxImg.alt = img.alt;
        lightboxCounter.hidden = slides.length < 2;
        if (slides.length > 1) lightboxCounter.textContent = `${current + 1} / ${slides.length}`;
        lightbox.querySelectorAll('.gallery-lightbox-nav').forEach(btn => { btn.hidden = slides.length < 2; });
    }

    function openLightbox() {
        buildLightbox();
        renderLightbox();
        document.getElementById('gallery-lightbox-overlay').classList.add('active');
        lightbox.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    function closeLightbox() {
        document.getElementById('gallery-lightbox-overlay')?.classList.remove('active');
        lightbox?.classList.remove('open');
        document.body.style.overflow = '';
    }
    function stepLightbox(dir) {
        setActive(current + dir);
        renderLightbox();
    }

    zoomBtn?.addEventListener('click', openLightbox);
    slides.forEach(slide => slide.addEventListener('click', openLightbox));

    document.addEventListener('keydown', e => {
        if (!lightbox || !lightbox.classList.contains('open')) return;
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') stepLightbox(-1);
        if (e.key === 'ArrowRight') stepLightbox(1);
    });
})();