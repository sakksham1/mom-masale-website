// ── DARK MODE ──
const themeToggle = document.getElementById('theme-toggle');
const toggleIcon = themeToggle?.querySelector('.toggle-icon');
const toggleLabel = themeToggle?.querySelector('.toggle-label');

function setTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    if (toggleIcon) toggleIcon.textContent = dark ? '🌙' : '☀️';
    if (toggleLabel) toggleLabel.textContent = dark ? 'Dark' : 'Light';
    localStorage.setItem('theme', dark ? 'dark' : 'light');
}

const savedTheme = localStorage.getItem('theme');
setTheme(savedTheme === 'dark');

if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        setTheme(!isDark);
    });
}

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
const overlay = document.getElementById('nav-overlay');

function closeNav() {
    nav.style.opacity = '0';
    nav.style.transform = 'translateY(-10px)';
    setTimeout(() => {
        nav.classList.remove('active');
        nav.style.opacity = '';
        nav.style.transform = '';
    }, 400);
    overlay.classList.remove('active');
    hamburger.classList.remove('open');
}

if (hamburger && nav) {
    hamburger.addEventListener('click', () => {
        if (nav.classList.contains('active')) {
            closeNav();
        } else {
            nav.classList.add('active');
            overlay.classList.add('active');
            hamburger.classList.add('open');
        }
    });

    overlay.addEventListener('click', () => closeNav());

    nav.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => closeNav());
    });
}
// ── CART ICON (injected into navbar) ──
const cartPill = document.createElement('button');
cartPill.className = 'cart-toggle';
cartPill.id = 'cart-toggle';
cartPill.setAttribute('aria-label', 'View cart');
cartPill.innerHTML = `
    <svg class="cart-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="9" cy="21" r="1"></circle>
        <circle cx="20" cy="21" r="1"></circle>
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
    </svg>
    <span class="cart-badge" id="cart-badge">0</span>
    <span class="cart-price" id="cart-price"></span>
`;
document.body.appendChild(cartPill);

function updateCartBadge() {
    const pill = document.getElementById('cart-toggle');
    const badge = document.getElementById('cart-badge');
    const priceEl = document.getElementById('cart-price');
    if (!pill || !badge) return;
    const cart = JSON.parse(localStorage.getItem('cart') || '[]');
    const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
    const totalPrice = cart.reduce((sum, item) => sum + (item.price || 0) * item.qty, 0);
    badge.textContent = totalQty;
    if (priceEl) priceEl.textContent = totalPrice ? `₹${totalPrice}` : '';
    pill.classList.toggle('visible', totalQty > 0);
}

updateCartBadge();
function pulseCartPill(type) {
    const pill = document.getElementById('cart-toggle');
    if (!pill) return;
    pill.classList.remove('pill-pop-add', 'pill-pop-remove');
    void pill.offsetWidth; // force reflow so animation restarts if triggered rapidly
    pill.classList.add(type === 'remove' ? 'pill-pop-remove' : 'pill-pop-add');
}

function showCartToast(message) {
    let toast = document.getElementById('cart-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'cart-toast';
        toast.className = 'cart-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 1600);
}
// ── CART DRAWER ──
function buildCartDrawer() {
    if (document.getElementById('cart-drawer')) return;

    const overlay = document.createElement('div');
    overlay.className = 'cart-overlay';
    overlay.id = 'cart-overlay';

    const drawer = document.createElement('div');
    drawer.className = 'cart-drawer';
    drawer.id = 'cart-drawer';
    drawer.innerHTML = `
        <div class="cart-drawer-header">
            <h3>Your Cart</h3>
            <button class="cart-close" id="cart-close" aria-label="Close cart">✕</button>
        </div>
        <div class="cart-items" id="cart-items"></div>
        <div class="cart-footer" id="cart-footer">
         <div class="cart-total" id="cart-total"></div>
            <button class="btn btn-outline cart-clear-btn" id="cart-clear-btn">Clear Cart</button>
            <button class="btn cart-checkout-btn" id="cart-checkout-btn">Checkout via WhatsApp</button>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    overlay.addEventListener('click', closeCart);
    document.getElementById('cart-close').addEventListener('click', closeCart);
}

function openCart() {
    buildCartDrawer();
    renderCartItems();
    document.getElementById('cart-drawer').classList.add('open');
    document.getElementById('cart-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeCart() {
    const drawer = document.getElementById('cart-drawer');
    const overlay = document.getElementById('cart-overlay');
    if (drawer) drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';
}
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        const drawer = document.getElementById('cart-drawer');
        if (drawer && drawer.classList.contains('open')) closeCart();
    }
});

function renderCartItems() {
    const container = document.getElementById('cart-items');
    if (!container) return;
    const cart = getCart();

    const footer = document.getElementById('cart-footer');
    if (cart.length === 0) {
        container.innerHTML = `<p class="cart-empty">Your cart is empty.</p>`;
        if (footer) footer.hidden = true;
        return;
    }
    if (footer) footer.hidden = false;

    container.innerHTML = cart.map((item, i) => `
        <div class="cart-item">
            <img class="cart-item-img" src="${item.image || 'https://placehold.co/60x60/7b1120/fff?text=' + encodeURIComponent(item.name[0])}" alt="${item.name}" loading="lazy">
            <div class="cart-item-info">
                <span class="cart-item-name">${item.name}</span>
                <span class="cart-item-size">${item.size}${item.price ? ` · ₹${item.price} each` : ''}</span>
                ${item.price ? `<span class="cart-item-subtotal">₹${item.price * item.qty}</span>` : ''}
            </div>
            <div class="cart-item-controls">
                <button class="qty-btn" data-action="dec" data-index="${i}">−</button>
                <span class="qty-value">${item.qty}</span>
                <button class="qty-btn" data-action="inc" data-index="${i}">+</button>
                <button class="cart-remove" data-index="${i}" aria-label="Remove item">🗑</button>
            </div>
        </div>
    `).join('');
    const total = cart.reduce((sum, item) => sum + (item.price || 0) * item.qty, 0);
const totalEl = document.getElementById('cart-total');
if (totalEl) totalEl.textContent = total ? `Total: ₹${total}` : '';
}

function buildWhatsAppMessage(cart) {
    const lines = cart.map(item => `- ${item.name} (${item.size}) x${item.qty}${item.price ? ` = ₹${item.price * item.qty}` : ''}`);
    const total = cart.reduce((sum, item) => sum + (item.price || 0) * item.qty, 0);
    const message = `Hi, I'd like to order:\n${lines.join('\n')}${total ? `\n\nTotal: ₹${total}` : ''}\n\nPlease confirm availability & price.`;
    return encodeURIComponent(message);
}

document.addEventListener('click', e => {
    if (e.target.closest('#cart-clear-btn')) {
        if (confirm('Clear all items from your cart?')) {
            saveCart([]);
            updateCartBadge();
            renderCartItems();
            syncAllCardUI();
        }
    }

    if (e.target.closest('#cart-checkout-btn')) {
        const cart = getCart();
        if (cart.length === 0) return;
        const msg = buildWhatsAppMessage(cart);
        window.open(`https://wa.me/917905391434?text=${msg}`, '_blank', 'noopener');
    }
});

document.addEventListener('click', e => {
    const cartToggleBtn = e.target.closest('#cart-toggle');
    if (cartToggleBtn) openCart();

    const qtyBtn = e.target.closest('.qty-btn');
    if (qtyBtn) {
        const cart = getCart();
        const idx = parseInt(qtyBtn.dataset.index);
        if (qtyBtn.dataset.action === 'inc') cart[idx].qty += 1;
        if (qtyBtn.dataset.action === 'dec') {
            cart[idx].qty -= 1;
            if (cart[idx].qty <= 0) cart.splice(idx, 1);
        }
        saveCart(cart);
        updateCartBadge();
        renderCartItems();
        syncAllCardUI();
        pulseCartPill(qtyBtn.dataset.action === 'inc' ? 'add' : 'remove');
    }

    const removeBtn = e.target.closest('.cart-remove');
    if (removeBtn) {
        const cart = getCart();
        cart.splice(parseInt(removeBtn.dataset.index), 1);
        saveCart(cart);
        updateCartBadge();
        renderCartItems();
        syncAllCardUI();
        pulseCartPill('remove');
    }
});
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
            <img src="${p.image}" alt="${p.name}" loading="lazy" width="400" height="400"
                onload="this.closest('.card-image').style.animation='none'"
                onerror="this.src='https://placehold.co/400x400/7b1120/fff?text=${encodeURIComponent(p.name)}'">
        </div>
        <div class="card-body">
            <span class="card-category">${p.category}</span>
            <h3>${p.name}</h3>
            
            <div class="buy-dropdown">
                <button class="btn buy-toggle">Buy Now ▴</button>
                <div class="buy-links">
                    <a href="${p.amazon}" target="_blank" rel="noopener">🛒 Amazon</a>
                    <a href="${p.flipkart}" target="_blank" rel="noopener">🛍 Flipkart</a>
                    <a href="${p.meesho}" target="_blank" rel="noopener">🏷 Meesho</a>
                </div>
            </div>
            <div class="purchase-row">
                <div class="coming-soon-badge">Available Soon on ecom platforms</div>
                    <div class="product-controls">
                        <div class="size-chip-row" data-selected="${p.sizes[0]}" data-selected-price="${p.prices?.[p.sizes[0]] || ''}">
                            ${p.sizes.map((s, i) => `<button type="button" class="size-chip${i === 0 ? ' active' : ''}" data-size="${s}" data-price="${p.prices?.[s] || ''}">${s}</button>`).join('')}
                        </div>
                        <div class="add-to-cart-block">
                            <span class="selected-price">${p.prices?.[p.sizes[0]] ? `₹${p.prices[p.sizes[0]]}` : ''}</span>
                            <div class="cart-action">
                                <button type="button" class="btn add-to-cart-btn" data-name="${p.name}">Add to Cart</button>
                                <div class="card-qty-stepper" hidden>
                                    <button type="button" class="card-qty-btn" data-action="dec">−</button>
                                    <span class="card-qty-value">1</span>
                                    <button type="button" class="card-qty-btn" data-action="inc">+</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            <div class="other-size-note" hidden></div>
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
                const scopeHint = document.getElementById('search-scope-hint');
                const scopeCategory = document.getElementById('scope-category');
                const scopeReset = document.getElementById('scope-reset');

                let activeCategory = 'All';
                let searchTerm = '';

                function applyFilters() {
                    let filtered = data;

                    // Category filter
                    if (activeCategory !== 'All') {
                        filtered = filtered.filter(p => p.category === activeCategory);
                    }

                    // Search filter — match name, category, or alias
                    if (searchTerm) {
                        const q = searchTerm.toLowerCase();
                        filtered = filtered.filter(p =>
                            p.name.toLowerCase().includes(q) ||
                            p.category.toLowerCase().includes(q) ||
                            (p.aliases && p.aliases.some(a => a.toLowerCase().includes(q)))
                        );
                    }

                    // Show a reminder whenever category filter + search are both active
                    if (scopeHint) {
                        if (activeCategory !== 'All' && searchTerm) {
                            scopeCategory.textContent = activeCategory;
                            scopeHint.hidden = false;
                        } else {
                            scopeHint.hidden = true;
                        }
                    }

                    if (filtered.length === 0) {
                        c.innerHTML = '';
                        noResults.hidden = false;
                        noResultsTerm.textContent = searchTerm || activeCategory;
                    } else {
                        noResults.hidden = true;
                        c.innerHTML = renderCards(filtered);
                        observeCards();
                    }
                }

                if (scopeReset) {
                    scopeReset.addEventListener('click', () => {
                        activeCategory = 'All';
                        filterBar.querySelectorAll('.filter-btn').forEach(b => {
                            b.classList.toggle('active', b.dataset.cat === 'All');
                        });
                        applyFilters();
                    });
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
                observeCards();

            } else {
                // Homepage — featured products only
                const featured = data.filter(p => p.featured);
                c.innerHTML = renderCards(featured);
                observeCards();
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

// ── CART ──
function getCart() {
    return JSON.parse(localStorage.getItem('cart') || '[]');
}
function saveCart(cart) {
    localStorage.setItem('cart', JSON.stringify(cart));
}
function addToCart(name, size, price, image) {
    const cart = getCart();
    const existing = cart.find(i => i.name === name && i.size === size);
    if (existing) {
        existing.qty += 1;
    } else {
        cart.push({ name, size, qty: 1, price: price || 0, image: image || '' });
    }
    saveCart(cart);
    updateCartBadge();
    pulseCartPill('add');
    showCartToast(`${name} added to cart`);
}
function decrementCartItem(name, size) {
    const cart = getCart();
    const idx = cart.findIndex(i => i.name === name && i.size === size);
    if (idx === -1) return;
    cart[idx].qty -= 1;
    if (cart[idx].qty <= 0) cart.splice(idx, 1);
    saveCart(cart);
    pulseCartPill('remove');
}

function syncCardUI(card) {
    const addBtn = card.querySelector('.add-to-cart-btn');
    if (!addBtn) return;
    const name = addBtn.dataset.name;
    const sizeDropdown = card.querySelector('.size-chip-row');
    const selectedSize = sizeDropdown.dataset.selected;
    const cart = getCart();
    const currentItem = cart.find(i => i.name === name && i.size === selectedSize);
    const stepper = card.querySelector('.card-qty-stepper');
    const qtyValue = card.querySelector('.card-qty-value');

    if (currentItem) {
        addBtn.hidden = true;
        stepper.hidden = false;
        qtyValue.textContent = currentItem.qty;
    } else {
        addBtn.hidden = false;
        stepper.hidden = true;
    }

    const note = card.querySelector('.other-size-note');
    const otherItems = cart.filter(i => i.name === name && i.size !== selectedSize);
    if (note) {
        if (otherItems.length > 0) {
            note.textContent = `Also in cart: ${otherItems.map(i => `${i.size} ×${i.qty}`).join(', ')}`;
            note.hidden = false;
        } else {
            note.hidden = true;
        }
    }
}

function syncAllCardUI() {
    document.querySelectorAll('.card').forEach(syncCardUI);
}

document.addEventListener('click', e => {
    const addBtn = e.target.closest('.add-to-cart-btn');
    if (!addBtn) return;
    const card = addBtn.closest('.card');
    const sizeDropdown = card.querySelector('.size-chip-row');
    addToCart(addBtn.dataset.name, sizeDropdown.dataset.selected, Number(sizeDropdown.dataset.selectedPrice) || 0, card.querySelector('.card-image img')?.src);
    syncCardUI(card);
});

document.addEventListener('click', e => {
    const cardQtyBtn = e.target.closest('.card-qty-btn');
    if (!cardQtyBtn) return;
    const card = cardQtyBtn.closest('.card');
    const name = card.querySelector('.add-to-cart-btn').dataset.name;
    const size = card.querySelector('.size-chip-row').dataset.selected;
    if (cardQtyBtn.dataset.action === 'inc') addToCart(name, size, Number(card.querySelector('.size-chip-row').dataset.selectedPrice) || 0, card.querySelector('.card-image img')?.src);
    if (cardQtyBtn.dataset.action === 'dec') { decrementCartItem(name, size); updateCartBadge(); }
    syncCardUI(card);
    if (document.getElementById('cart-drawer')?.classList.contains('open')) renderCartItems();
});
document.addEventListener('click', e => {
    const chip = e.target.closest('.size-chip');
    if (!chip) return;
    const row = chip.closest('.size-chip-row');
    row.querySelectorAll('.size-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    row.dataset.selected = chip.dataset.size;
    row.dataset.selectedPrice = chip.dataset.price;
    const card = row.closest('.card');
    const priceEl = card.querySelector('.selected-price');
    if (priceEl) priceEl.textContent = chip.dataset.price ? `₹${chip.dataset.price}` : '';
    syncCardUI(card);
});

// ── BULK ORDER FORM ──
const bulkForm = document.getElementById('bulk-form');

if (bulkForm) {
    bulkForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const honeypot = document.getElementById('website');

        if (honeypot && honeypot.value.trim() !== '') {
        return;
    }
    
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
                    requirement: document.getElementById('field-requirement').value.trim(),
                    website: document.getElementById('website').value,
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
const progressRing = document.querySelector('.progress-ring');

if (backToTop) {
    window.addEventListener('scroll', () => {
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const progress = Math.min(scrollTop / docHeight, 1);
        const circumference = 2 * Math.PI * 23;

        backToTop.classList.toggle('visible', scrollTop > 400);

        if (progressRing) {
            progressRing.style.strokeDasharray = `${progress * circumference} ${circumference}`;
        }
    });

    backToTop.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// ── CARD ENTRANCE ANIMATION ──
function observeCards() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, i) => {
            if (entry.isIntersecting) {
                setTimeout(() => {
                    entry.target.classList.add('visible');
                }, i * 80);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.card').forEach(card => observer.observe(card));
    syncAllCardUI();
}
// ── STAT COUNTER ANIMATION ──
const statNums = document.querySelectorAll('.stat-num');

if (statNums.length) {
    const counterObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const el = entry.target;
            const text = el.textContent.trim();
            const num = parseFloat(text);
            if (isNaN(num)) return;
            const suffix = text.replace(num, '');
            let start = 0;
            const duration = 1500;
            const step = 16;
            const increment = num / (duration / step);
            el.textContent = '0' + suffix;
            const timer = setInterval(() => {
                start += increment;
                if (start >= num) {
                    el.textContent = text;
                    clearInterval(timer);
                } else {
                    el.textContent = Math.floor(start) + suffix;
                }
            }, step);
            counterObserver.unobserve(el);
        });
    }, { threshold: 0.6 });

    statNums.forEach(el => counterObserver.observe(el));
}
// ── CURSOR SPICE TRAIL ──
(function() {
    if (window.matchMedia('(pointer: coarse)').matches) return; // skip on touch devices

    const particles = [];
    const symbols = ['✦', '🌿', '✶', '❋', '✦', '✶'];
    let lastX = 0, lastY = 0;

    function createParticle(x, y) {
        const el = document.createElement('span');
        el.textContent = symbols[Math.floor(Math.random() * symbols.length)];
        el.style.cssText = `
            position: fixed;
            pointer-events: none;
            z-index: 9999;
            font-size: ${Math.random() * 10 + 8}px;
            color: ${Math.random() > 0.5 ? '#d4a017' : '#7b1120'};
            left: ${x}px;
            top: ${y}px;
            transform: translate(-50%, -50%);
            opacity: 1;
            transition: opacity 0.6s ease, transform 0.6s ease;
            user-select: none;
        `;
        document.body.appendChild(el);

        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = `translate(-50%, -120%) scale(0.5)`;
        }, 50);

        setTimeout(() => {
            el.remove();
        }, 650);
    }

    document.addEventListener('mousemove', (e) => {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 18) return; // throttle by distance
        lastX = e.clientX;
        lastY = e.clientY;
        createParticle(e.clientX, e.clientY);
    });
})();
// ── TAP BURST (mobile) ──
(function() {
    if (!window.matchMedia('(pointer: coarse)').matches) return; // touch only

    const symbols = ['✦', '✶', '❋', '🌿', '✦', '✶'];

    function burst(x, y) {
        const count = 6;
        for (let i = 0; i < count; i++) {
            const el = document.createElement('span');
            el.textContent = symbols[Math.floor(Math.random() * symbols.length)];
            const angle = (360 / count) * i;
            const dist = Math.random() * 40 + 20;
            const rad = (angle * Math.PI) / 180;
            const tx = Math.cos(rad) * dist;
            const ty = Math.sin(rad) * dist;
            el.style.cssText = `
                position: fixed;
                pointer-events: none;
                z-index: 9999;
                font-size: ${Math.random() * 8 + 8}px;
                color: ${Math.random() > 0.5 ? '#d4a017' : '#7b1120'};
                left: ${x}px;
                top: ${y}px;
                transform: translate(-50%, -50%);
                opacity: 1;
                transition: opacity 0.5s ease, transform 0.5s ease;
                user-select: none;
            `;
            document.body.appendChild(el);

            setTimeout(() => {
                el.style.opacity = '0';
                el.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(0.4)`;
            }, 30);

            setTimeout(() => el.remove(), 550);
        }
    }

    document.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        burst(t.clientX, t.clientY);
    }, { passive: true });
})();

// ── EVENT GALLERY TAP TOGGLE (mobile) ──
(function() {
    const gallery = document.querySelector('.event-gallery');
    if (!gallery) return;
    if (!window.matchMedia('(pointer: coarse)').matches) return; // touch only

    gallery.addEventListener('click', (e) => {
        const item = e.target.closest('.event-item');
        gallery.querySelectorAll('.event-item.active').forEach(el => {
            if (el !== item) el.classList.remove('active');
        });
        if (item) item.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.event-gallery')) {
            gallery.querySelectorAll('.event-item.active').forEach(el => el.classList.remove('active'));
        }
    });
})();