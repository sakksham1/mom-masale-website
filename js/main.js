// ── ACTIVE NAV LINK ──
const currentPage = location.pathname.split('/').pop() || 'index.html';
document.querySelectorAll('nav a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
        a.classList.add('active');
    }
});

// ── HAMBURGER MENU ──
const hamburger = document.getElementById('hamburger');
const nav = document.getElementById('nav-menu');

if (hamburger && nav) {
    hamburger.addEventListener('click', () => nav.classList.toggle('active'));
    nav.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => nav.classList.remove('active'));
    });
}

// ── HERO SLIDER ──
const slides = document.querySelectorAll('.slide');
const dots = document.querySelectorAll('.dot');

if (slides.length) {
    let current = 0;

    function goToSlide(index) {
        slides[current].classList.remove('active');
        dots[current].classList.remove('active');
        current = index;
        slides[current].classList.add('active');
        dots[current].classList.add('active');

    }

    let timer = setInterval(() => {
        goToSlide((current + 1) % slides.length);
    }, 3000);

    dots.forEach(dot => {
        dot.addEventListener('click', () => {
            clearInterval(timer);
            goToSlide(parseInt(dot.dataset.index));
            timer = setInterval(() => {
                goToSlide((current + 1) % slides.length);
            }, 3000);
        });
    });
}

// ── LOAD PRODUCTS ──
async function loadProducts() {
    const containers = document.querySelectorAll('#products-container');
    if (!containers.length) return;

    try {
        const data = await fetch('data/products.json').then(r => r.json());

        const renderCards = (items) => items.map(p => `
    <div class="card" data-category="${p.category}">
        <div class="card-image">
            <img src="${p.image}" alt="${p.name}"
                onerror="this.src='https://placehold.co/400x400/7b1120/fff?text=${encodeURIComponent(p.name)}'">
        </div>
        <div class="card-body">
            <span class="card-category">${p.category}</span>
            <h3>${p.name}</h3>
            <div class="card-sizes">
                ${p.sizes.map(s => `<span class="size-tag">${s}</span>`).join('')}
            </div>
            <div class="buy-dropdown">
                <button class="btn buy-toggle">Buy Now ▴</button>
                <div class="buy-links">
                    <a href="${p.amazon}" target="_blank" rel="noopener">🛒 Amazon</a>
                    <a href="${p.flipkart}" target="_blank" rel="noopener">🛍 Flipkart</a>
                    <a href="${p.meesho}" target="_blank" rel="noopener">🏷 Meesho</a>
                </div>
            </div>
        </div>
    </div>
`).join('');

        containers.forEach(c => {
            const isProductsPage = c.closest('.products-page') !== null;

            if (isProductsPage) {
                // ── PRODUCTS PAGE: filter bar + search ──
                const categories = ['All', ...new Set(data.map(p => p.category))];
                const filterBar = document.getElementById('filter-bar');
                const searchInput = document.getElementById('product-search');
                const searchClear = document.getElementById('search-clear');
                const noResults = document.getElementById('no-results');
                const noResultsTerm = document.getElementById('no-results-term');

                let activeCategory = 'All';
                let searchTerm = '';

                function applyFilters() {
                    let filtered = data;

                    // Category filter
                    if (activeCategory !== 'All') {
                        filtered = filtered.filter(p => p.category === activeCategory);
                    }

                    // Search filter — match name or category
                    if (searchTerm) {
                        const q = searchTerm.toLowerCase();
                        filtered = filtered.filter(p =>
                            p.name.toLowerCase().includes(q) ||
                            p.category.toLowerCase().includes(q)
                        );
                    }

                    if (filtered.length === 0) {
                        c.innerHTML = '';
                        noResults.hidden = false;
                        noResultsTerm.textContent = searchTerm || activeCategory;
                    } else {
                        noResults.hidden = true;
                        c.innerHTML = renderCards(filtered);
                    }
                }

                // Build filter buttons
                if (filterBar) {
                    filterBar.innerHTML = categories.map(cat => `
                        <button class="filter-btn ${cat === 'All' ? 'active' : ''}" data-cat="${cat}">
                            ${cat}
                        </button>
                    `).join('');

                    filterBar.addEventListener('click', e => {
                        const btn = e.target.closest('.filter-btn');
                        if (!btn) return;
                        filterBar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        activeCategory = btn.dataset.cat;
                        applyFilters();
                    });
                }

                // Search input handler
                if (searchInput) {
                    searchInput.addEventListener('input', () => {
                        searchTerm = searchInput.value.trim();
                        searchClear.hidden = !searchTerm;
                        applyFilters();
                    });
                }

                // Clear button
                if (searchClear) {
                    searchClear.addEventListener('click', () => {
                        searchInput.value = '';
                        searchTerm = '';
                        searchClear.hidden = true;
                        searchInput.focus();
                        applyFilters();
                    });
                }

                // Initial render
                applyFilters();

            } else {
                // Homepage — featured products only
                const featured = data.filter(p => p.featured);
                c.innerHTML = renderCards(featured);
            }
        });

        // ── BUY DROPDOWN TOGGLE ──
        document.addEventListener('click', e => {
            const toggle = e.target.closest('.buy-toggle');
            document.querySelectorAll('.buy-dropdown.open').forEach(d => {
                if (d !== toggle?.closest('.buy-dropdown')) d.classList.remove('open');
            });
            if (toggle) {
                toggle.closest('.buy-dropdown').classList.toggle('open');
                toggle.textContent = toggle.closest('.buy-dropdown').classList.contains('open') ? 'Buy Now ▾' : 'Buy Now ▴';
                e.stopPropagation();
            }
        });

    } catch (e) {
        document.querySelectorAll('#products-container').forEach(c => {
            c.innerHTML = '<p style="color:#888;padding:1rem">Could not load products. Make sure you\'re using Live Server.</p>';
        });
    }
}


loadProducts();

// ── BULK ORDER FORM ──
const bulkForm = document.getElementById('bulk-form');

if (bulkForm) {
    bulkForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        let valid = true;

        bulkForm.querySelectorAll('.field-error').forEach(el => el.classList.remove('show'));
        bulkForm.querySelectorAll('input, textarea').forEach(el => el.classList.remove('error'));

        const fields = [
            { id: 'field-name', err: 'err-name', msg: 'Please enter your name.' },
            { id: 'field-phone', err: 'err-phone', msg: 'Please enter a valid 10-digit phone number.', pattern: /^[6-9]\d{9}$/ },
            { id: 'field-requirement', err: 'err-requirement', msg: 'Please describe your requirement.' },
        ];

        fields.forEach(({ id, err, msg, pattern }) => {
            const input = document.getElementById(id);
            const errEl = document.getElementById(err);
            const val = input.value.trim();
            let fail = !val;
            if (!fail && pattern) fail = !pattern.test(val);
            if (fail) {
                input.classList.add('error');
                errEl.textContent = msg;
                errEl.classList.add('show');
                valid = false;
            }
        });

        if (!valid) return;

        const submitBtn = bulkForm.querySelector('button[type="submit"]');
        submitBtn.textContent = 'Sending…';
        submitBtn.disabled = true;

        try {
            await fetch('https://script.google.com/macros/s/AKfycbxgTmHS7BtePAM4kNh2saeHbCNvsLsVy28oQdJnRi6opH0Oo6sUqmnSZ-J4V_qiO_HJ/exec', {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: document.getElementById('field-name').value.trim(),
                    business: document.getElementById('field-business').value.trim(),
                    phone: document.getElementById('field-phone').value.trim(),
                    requirement: document.getElementById('field-requirement').value.trim()
                })
            });

            bulkForm.style.display = 'none';
            document.getElementById('form-success').classList.add('show');

        } catch (err) {
            submitBtn.textContent = 'Submit Enquiry';
            submitBtn.disabled = false;
            alert('Something went wrong. Please call us directly at 9984064777.');
        }
    });
}

// ── BACK TO TOP ──
const backToTop = document.getElementById('back-to-top');
if (backToTop) {
    window.addEventListener('scroll', () => {
        backToTop.classList.toggle('visible', window.scrollY > 400);
    });
    backToTop.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}