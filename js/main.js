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
    nav.style.transform = 'translateX(-50%) translateY(-20px)';
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

// ── THEME TOGGLE PLACEMENT (desktop: header corner / mobile: drawer) ──
function placeThemeToggle() {
    const toggle = document.getElementById('theme-toggle');
    const headerEl = document.querySelector('header');
    const navEl = document.getElementById('nav-menu');
    if (!toggle || !headerEl || !navEl) return;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (isMobile) {
        if (navEl.firstChild !== toggle) navEl.insertBefore(toggle, navEl.firstChild);
    } else {
        if (toggle.parentElement !== headerEl) headerEl.appendChild(toggle);
    }
}
placeThemeToggle();
window.addEventListener('resize', placeThemeToggle);

// ── CART ICON (injected into navbar) ──
const cartPill = document.createElement('button');
cartPill.className = 'cart-toggle';
cartPill.id = 'cart-toggle';
cartPill.setAttribute('aria-label', 'View cart');
cartPill.setAttribute('aria-expanded', 'false');
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
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
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
const FREE_SHIPPING_THRESHOLD = 499; // change this if the real number is different

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
        <div class="cart-promo-line">🚚 Free Shipping &amp; Same-Day Delivery in Kanpur</div>
        <div class="cart-items" id="cart-items"></div>
        <div class="cart-footer" id="cart-footer">
            <div class="cart-footer-top">
                <div class="shipping-progress" id="shipping-progress" hidden>
                    <div class="shipping-progress-text" id="shipping-progress-text"></div>
                    <div class="shipping-progress-bar"><div class="shipping-progress-fill" id="shipping-progress-fill"></div></div>
                </div>
                <div class="cart-total" id="cart-total"></div>
            </div>
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
    document.getElementById('cart-toggle')?.setAttribute('aria-expanded', 'true');
    document.getElementById('cart-close')?.focus();
}

function closeCart() {
    const drawer = document.getElementById('cart-drawer');
    const overlay = document.getElementById('cart-overlay');
    if (drawer) drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';
    document.getElementById('cart-toggle')?.setAttribute('aria-expanded', 'false');
    document.getElementById('cart-toggle')?.focus();
}
document.addEventListener('keydown', e => {
    const drawer = document.getElementById('cart-drawer');
    if (!drawer || !drawer.classList.contains('open')) return;

    if (e.key === 'Escape') {
        closeCart();
        return;
    }

    if (e.key === 'Tab') {
        const focusable = drawer.querySelectorAll('button, a[href]');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
});

// ── PRODUCT DETAIL OVERLAY ──
function buildProductOverlay() {
    if (document.getElementById('product-overlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'product-overlay';
    overlay.id = 'product-overlay';

    const modal = document.createElement('div');
    modal.className = 'product-modal';
    modal.id = 'product-modal';
    modal.innerHTML = `
        <button class="product-modal-close" id="product-modal-close" aria-label="Close product details">✕</button>
        <div class="product-modal-body" id="product-modal-body"></div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    overlay.addEventListener('click', closeProductOverlay);
    document.getElementById('product-modal-close').addEventListener('click', closeProductOverlay);
}

function openProductOverlay(cardEl) {
    buildProductOverlay();
    const body = document.getElementById('product-modal-body');
    const front = cardEl.querySelector('.card-face-front');
    const clone = document.createElement('div');
    clone.className = 'card visible';
    clone.dataset.category = cardEl.dataset.category || '';
    clone.innerHTML = (front || cardEl).innerHTML;
    const hint = clone.querySelector('.tap-hint');
    if (hint) hint.remove();
    body.innerHTML = '';
    body.appendChild(clone);
    syncCardUI(clone);

    document.getElementById('product-overlay').classList.add('active');
    document.getElementById('product-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
    document.getElementById('product-modal-close')?.focus();
}

function closeProductOverlay() {
    const overlay = document.getElementById('product-overlay');
    const modal = document.getElementById('product-modal');
    if (overlay) overlay.classList.remove('active');
    if (modal) modal.classList.remove('open');
    document.body.style.overflow = '';
    syncAllCardUI();
}

document.addEventListener('click', e => {
    if (e.target.closest('#product-modal')) return;
    if (e.target.closest('.card-name-link')) return;
    const card = e.target.closest('.card--collapsed');
    if (!card) return;
    if (card.dataset.justPeeked) {
        delete card.dataset.justPeeked;
        return;
    }
    openProductOverlay(card);
});

document.addEventListener('keydown', e => {
    const modal = document.getElementById('product-modal');
    if (!modal || !modal.classList.contains('open')) return;

    if (e.key === 'Escape') {
        closeProductOverlay();
        return;
    }

    if (e.key === 'Tab') {
        const focusable = modal.querySelectorAll('button, a[href], input, [tabindex]');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
});

function updateShippingProgress(total) {
    const wrap = document.getElementById('shipping-progress');
    const text = document.getElementById('shipping-progress-text');
    const fill = document.getElementById('shipping-progress-fill');
    if (!wrap || !text || !fill) return;
    const remaining = FREE_SHIPPING_THRESHOLD - total;
    const pct = Math.min((total / FREE_SHIPPING_THRESHOLD) * 100, 100);
    fill.style.width = `${pct}%`;
    if (remaining <= 0) {
        text.textContent = "✅ You've unlocked free shipping!";
        wrap.classList.add('unlocked');
    } else {
        text.textContent = `🚚 Add ₹${remaining} more for free shipping`;
        wrap.classList.remove('unlocked');
    }
}

function renderCartItems() {
    const container = document.getElementById('cart-items');
    if (!container) return;
    const cart = getCart();

    const footer = document.getElementById('cart-footer');
    const shippingWrap = document.getElementById('shipping-progress');
    if (cart.length === 0) {
        container.innerHTML = `
            <div class="cart-empty">
                <svg class="cart-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="9" cy="21" r="1"></circle>
                    <circle cx="20" cy="21" r="1"></circle>
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                </svg>
                <p>Your cart is empty.</p>
                <a href="products.html" class="btn cart-browse-btn">Browse Products</a>
            </div>
        `;
        if (footer) footer.hidden = true;
        if (shippingWrap) shippingWrap.hidden = true;
        return;
    }
    if (footer) footer.hidden = false;
    if (shippingWrap) shippingWrap.hidden = false;

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
updateShippingProgress(total);
}

function buildWhatsAppMessage(cart) {
    const lines = cart.map(item => `- ${item.name} (${item.size}) x${item.qty}${item.price ? ` = ₹${item.price * item.qty}` : ''}`);
    const total = cart.reduce((sum, item) => sum + (item.price || 0) * item.qty, 0);
    const message = `Hi, I'd like to order:\n${lines.join('\n')}${total ? `\n\nTotal: ₹${total}` : ''}\n\nPlease confirm availability & order details`;
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
    }, 5000);

    dots.forEach(dot => {
        dot.addEventListener('click', () => {
            clearInterval(timer);
            goToSlide(parseInt(dot.dataset.index));
            timer = setInterval(() => {
                goToSlide((current + 1) % slides.length);
            }, 5000);
        });
    });
}

// ── DISCOUNT ──
const DISCOUNT_PERCENT = 25;
function discountedPrice(original) {
    return Math.round(original * (1 - DISCOUNT_PERCENT / 100));
}

// ── LOAD PRODUCTS ──
async function loadProducts() {
    const containers = document.querySelectorAll('#products-container');
    const homeSections = {
        featured: { el: document.getElementById('featured-container'), wrap: document.getElementById('featured-section'), filter: p => p.featured },
        bestsellers: { el: document.getElementById('bestsellers-container'), wrap: document.getElementById('bestsellers-section'), filter: p => p.bestseller },
        newarrivals: { el: document.getElementById('newarrivals-container'), wrap: document.getElementById('newarrivals-section'), filter: p => p.newArrival },
    };
    const hasHomeSections = Object.values(homeSections).some(s => s.el);
    if (!containers.length && !hasHomeSections) return;

    try {
        const data = await fetch('data/products.json').then(r => r.json());

        const renderCards = (items) => items.map(p => `
    <div class="card card--collapsed" data-category="${p.category}">
      <div class="card-flip-inner">
        <div class="card-face card-face-front">
        <div class="card-image">
            <img src="${p.image}" alt="${p.name}" loading="lazy" width="400" height="400"
                onload="this.closest('.card-image').style.animation='none'"
                onerror="this.src='https://placehold.co/400x400/7b1120/fff?text=${encodeURIComponent(p.name)}'">
            <span class="tap-hint">Preview</span>
        </div>
        <div class="card-body">
            <span class="card-category">${p.category}</span>
            ${p.slug ? (() => {
    const words = p.name.split(' ');
    const lastWord = words.pop();
    const leadingWords = words.length ? words.join(' ') + ' ' : '';
    return `<a class="card-name-link" href="products/${p.slug}.html" onclick="event.stopPropagation()">
        <h3>${leadingWords}<span class="card-name-last">${lastWord}<svg class="card-name-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
        </svg></span></h3>
    </a>`;
})() : `<h3>${p.name}</h3>`}
            
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
                        <div class="size-chip-row" data-selected="${p.sizes[0]}" data-selected-price="${p.prices?.[p.sizes[0]] ? discountedPrice(p.prices[p.sizes[0]]) : ''}" data-selected-original="${p.prices?.[p.sizes[0]] || ''}">
                            ${p.sizes.map((s, i) => `<button type="button" class="size-chip${i === 0 ? ' active' : ''}" data-size="${s}" data-price="${p.prices?.[s] ? discountedPrice(p.prices[s]) : ''}" data-original="${p.prices?.[s] || ''}">${s}</button>`).join('')}
                        </div>
                        <div class="add-to-cart-block">
                            <div class="price-display">
                                ${p.prices?.[p.sizes[0]] ? `<span class="price-original">₹${p.prices[p.sizes[0]]}</span><span class="price-discounted">₹${discountedPrice(p.prices[p.sizes[0]])}</span><span class="discount-badge">25% OFF</span>` : ''}
                            </div>
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
            ${p.slug ? `<a class="product-detail-link" href="products/${p.slug}.html">View Full Details →</a>` : ''}
            </div>
        </div>
        <div class="card-face card-face-back">
            <img class="back-thumb" src="${p.image}" alt="${p.name}" loading="lazy">
            <h3 class="back-name">${p.name}</h3>
            <div class="back-cart-info"></div>
            <span class="back-hint">Tap to edit</span>
        </div>
      </div>
    </div>
`).join('');

        containers.forEach(c => {
            {
                // ── PRODUCTS PAGE: filter bar + search ──
                const categories = [...new Set(data.map(p => p.category))];
                function sizeSortValue(s) {
                    const match = s.match(/^([\d.]+)(rs|kg|g)$/i);
                    if (!match) return Number.MAX_SAFE_INTEGER;
                    const num = parseFloat(match[1]);
                    const unit = match[2].toLowerCase();
                    if (unit === 'kg') return num * 1000;
                    if (unit === 'g') return num;
                    return num * 0.001; // rupee sachets sort first (smallest)
                }
                const allSizes = [...new Set(data.flatMap(p => p.sizes))].sort((a, b) => sizeSortValue(a) - sizeSortValue(b));
                const searchInput = document.getElementById('product-search');
                const searchClear = document.getElementById('search-clear');
                const noResults = document.getElementById('no-results');
                const noResultsTerm = document.getElementById('no-results-term');
                const scopeHint = document.getElementById('search-scope-hint');
                const scopeCategory = document.getElementById('scope-category');
                const scopeReset = document.getElementById('scope-reset');
                const filterToggle = document.getElementById('filter-toggle');
                const filterPanel = document.getElementById('filter-panel');
                const filterCountBadge = document.getElementById('filter-count-badge');
                const filterClearBtn = document.getElementById('filter-clear-btn');
                const categoryList = document.getElementById('filter-category-list');
                const sizeList = document.getElementById('filter-size-list');

                let selectedCategories = new Set();
                let selectedSizes = new Set();
                let searchTerm = '';

                function updateFilterCount() {
                    const total = selectedCategories.size + selectedSizes.size;
                    if (filterCountBadge) {
                        filterCountBadge.textContent = total;
                        filterCountBadge.hidden = total === 0;
                    }
                    if (filterToggle) filterToggle.classList.toggle('has-filters', total > 0);
                }

                function applyFilters() {
                    let filtered = data;

                    // Category filter (OR within group)
                    if (selectedCategories.size > 0) {
                        filtered = filtered.filter(p => selectedCategories.has(p.category));
                    }

                    // Size filter (OR within group) — combined with category via AND
                    if (selectedSizes.size > 0) {
                        filtered = filtered.filter(p => p.sizes.some(s => selectedSizes.has(s)));
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
                        if (selectedCategories.size > 0 && searchTerm) {
                            scopeCategory.textContent = [...selectedCategories].join(', ');
                            scopeHint.hidden = false;
                        } else {
                            scopeHint.hidden = true;
                        }
                    }

                    updateFilterCount();

                    if (filtered.length === 0) {
                        c.innerHTML = '';
                        noResults.hidden = false;
                        noResultsTerm.textContent = searchTerm || [...selectedCategories, ...selectedSizes].join(', ');
                    } else {
                        noResults.hidden = true;
                        c.innerHTML = renderCards(filtered);
                        observeCards();
                    }
                }

                if (scopeReset) {
                    scopeReset.addEventListener('click', () => {
                        selectedCategories.clear();
                        categoryList?.querySelectorAll('input').forEach(cb => cb.checked = false);
                        applyFilters();
                    });
                }

                // Build category checkboxes
                if (categoryList) {
                    categoryList.innerHTML = categories.map(cat => `
                        <label class="filter-checkbox">
                            <input type="checkbox" value="${cat}" data-group="category">
                            <span>${cat}</span>
                        </label>
                    `).join('');
                }

                // Build size checkboxes
                if (sizeList) {
                    sizeList.innerHTML = allSizes.map(size => `
                        <label class="filter-checkbox">
                            <input type="checkbox" value="${size}" data-group="size">
                            <span>${size}</span>
                        </label>
                    `).join('');
                }

                if (filterPanel) {
                    filterPanel.addEventListener('change', e => {
                        const cb = e.target.closest('input[type="checkbox"]');
                        if (!cb) return;
                        const targetSet = cb.dataset.group === 'category' ? selectedCategories : selectedSizes;
                        if (cb.checked) targetSet.add(cb.value);
                        else targetSet.delete(cb.value);
                        applyFilters();
                    });
                    filterPanel.addEventListener('click', e => e.stopPropagation());
                }

                if (filterClearBtn) {
                    filterClearBtn.addEventListener('click', () => {
                        selectedCategories.clear();
                        selectedSizes.clear();
                        filterPanel.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
                        applyFilters();
                    });
                }

                // Toggle dropdown open/close
                const filterOverlayEl = document.getElementById('filter-overlay');
                if (filterToggle && filterPanel) {
                    filterToggle.addEventListener('click', e => {
                        e.stopPropagation();
                        const isOpen = !filterPanel.hidden;
                        filterPanel.hidden = isOpen;
                        filterToggle.setAttribute('aria-expanded', String(!isOpen));
                        if (filterOverlayEl) filterOverlayEl.classList.toggle('active', !isOpen);
                    });
                    document.addEventListener('click', () => {
                        if (!filterPanel.hidden) {
                            filterPanel.hidden = true;
                            filterToggle.setAttribute('aria-expanded', 'false');
                            if (filterOverlayEl) filterOverlayEl.classList.remove('active');
                        }
                    });
                    if (filterOverlayEl) {
                        filterOverlayEl.addEventListener('click', () => {
                            filterPanel.hidden = true;
                            filterToggle.setAttribute('aria-expanded', 'false');
                            filterOverlayEl.classList.remove('active');
                        });
                    }
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
            }
        });

        // ── HOMEPAGE HORIZONTAL SECTIONS ──
        Object.values(homeSections).forEach(section => {
            if (!section.el) return;
            const items = data.filter(section.filter);
            if (items.length === 0) {
                if (section.wrap) section.wrap.hidden = true;
                return;
            }
            if (section.wrap) section.wrap.hidden = false;
            section.el.innerHTML = renderCards(items);
        });
        if (hasHomeSections) observeCards();

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

// ── LOAD RECIPES (recipes.html) ──
async function loadRecipes() {
    const container = document.getElementById('recipes-container');
    if (!container) return;

    try {
        const recipes = await fetch('data/recipes.json').then(r => r.json());

        const renderRecipeBar = (r) => `
            <a class="card recipe-bar" href="recipes/${r.slug}.html">
                <div class="recipe-bar-image">
                    <img src="${r.image}" alt="${r.imageAlt || r.title}" loading="lazy" width="120" height="120"
                        onload="this.closest('.recipe-bar-image').style.animation='none'"
                        onerror="this.src='https://placehold.co/120x120/7b1120/fff?text=${encodeURIComponent(r.title)}'">
                </div>
                <div class="recipe-bar-body">
                    <div class="recipe-bar-main">
                        <span class="card-category">${r.category}</span>${r.trending ? ' <span class="trending-chip">🔥 Trending</span>' : ''}${r.essentials ? ' <span class="essentials-chip">⭐ Essential</span>' : ''}
                        <h3 class="recipe-bar-title">${r.title}</h3>
                        <p class="recipe-desc">${r.description}</p>
                    </div>
                    <div class="recipe-meta recipe-bar-meta">
                        <span>⏱ Prep ${r.prepTime.replace(/PT|M/g, '')} min</span>
                        <span>🔥 Cook ${r.cookTime.replace(/PT|M/g, '')} min</span>
                        <span>🍽 Serves ${r.servings}</span>
                    </div>
                </div>
                <span class="recipe-bar-arrow" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                        <polyline points="12 5 19 12 12 19"></polyline>
                    </svg>
                </span>
            </a>
        `;

        const renderTrendingCard = (r) => `
            <a class="card recipe-trending-card" href="recipes/${r.slug}.html">
                <div class="card-image">
                    <img src="${r.image}" alt="${r.imageAlt || r.title}" loading="lazy" width="200" height="200"
                        onload="this.closest('.card-image').style.animation='none'"
                        onerror="this.src='https://placehold.co/200x200/7b1120/fff?text=${encodeURIComponent(r.title)}'">
                </div>
                <div class="card-body">
                    <span class="card-category">${r.category}</span>
                    <h3>${r.title}</h3>
                    <div class="trending-recipe-meta">
                        <span>⏱ ${r.prepTime.replace(/PT|M/g, '')} min</span>
                        <span>🍽 ${r.servings}</span>
                    </div>
                </div>
            </a>
        `;

        // ── Trending Now / Essentials strips ──
        function renderHscrollSection(sectionId, containerId, filterFn) {
            const section = document.getElementById(sectionId);
            const scrollContainer = document.getElementById(containerId);
            if (!scrollContainer || !section) return;
            const items = recipes.filter(filterFn).sort((a, b) => a.slug.localeCompare(b.slug));
            if (items.length) {
                section.hidden = false;
                scrollContainer.innerHTML = items.map(renderTrendingCard).join('');
            } else {
                section.hidden = true;
            }
        }
        renderHscrollSection('trending-section', 'trending-container', r => r.trending);
        renderHscrollSection('essentials-section', 'essentials-container', r => r.essentials);

        // ── Search + category filter + grouped list ──
        const categories = [...new Set(recipes.map(r => r.category))].sort();
        const searchInput = document.getElementById('recipe-search');
        const searchClear = document.getElementById('recipe-search-clear');
        const noResults = document.getElementById('recipe-no-results');
        const noResultsTerm = document.getElementById('recipe-no-results-term');
        const filterToggle = document.getElementById('recipe-filter-toggle');
        const filterPanel = document.getElementById('recipe-filter-panel');
        const filterCountBadge = document.getElementById('recipe-filter-count-badge');
        const filterClearBtn = document.getElementById('recipe-filter-clear-btn');
        const categoryList = document.getElementById('recipe-filter-category-list');

        let selectedCategories = new Set();
        let searchTerm = '';

        function updateFilterCount() {
            if (filterCountBadge) {
                filterCountBadge.textContent = selectedCategories.size;
                filterCountBadge.hidden = selectedCategories.size === 0;
            }
            if (filterToggle) filterToggle.classList.toggle('has-filters', selectedCategories.size > 0);
        }

        function applyFilters() {
            let filtered = recipes;

            if (selectedCategories.size > 0) {
                filtered = filtered.filter(r => selectedCategories.has(r.category));
            }

            if (searchTerm) {
                const q = searchTerm.toLowerCase();
                filtered = filtered.filter(r =>
                    r.title.toLowerCase().includes(q) ||
                    r.category.toLowerCase().includes(q) ||
                    (r.cuisine && r.cuisine.toLowerCase().includes(q)) ||
                    (r.description && r.description.toLowerCase().includes(q)) ||
                    (r.ingredients && r.ingredients.some(i => i.text.toLowerCase().includes(q)))
                );
            }

            updateFilterCount();

            if (filtered.length === 0) {
                container.innerHTML = '';
                if (noResults) {
                    noResults.hidden = false;
                    noResultsTerm.textContent = searchTerm || [...selectedCategories].join(', ');
                }
                return;
            }
            if (noResults) noResults.hidden = true;

            const grouped = {};
            filtered.forEach(r => {
                if (!grouped[r.category]) grouped[r.category] = [];
                grouped[r.category].push(r);
            });

            container.innerHTML = Object.keys(grouped).sort().map(cat => `
                <div class="recipe-category-block">
                    <h2 class="section-title recipe-category-heading">${cat}</h2>
                    <div class="recipes-list">${grouped[cat].map(renderRecipeBar).join('')}</div>
                </div>
            `).join('');

            observeCards();
        }

        if (categoryList) {
            categoryList.innerHTML = categories.map(cat => `
                <label class="filter-checkbox">
                    <input type="checkbox" value="${cat}" data-group="category">
                    <span>${cat}</span>
                </label>
            `).join('');
        }

        if (filterPanel) {
            filterPanel.addEventListener('change', e => {
                const cb = e.target.closest('input[type="checkbox"]');
                if (!cb) return;
                if (cb.checked) selectedCategories.add(cb.value);
                else selectedCategories.delete(cb.value);
                applyFilters();
            });
            filterPanel.addEventListener('click', e => e.stopPropagation());
        }

        if (filterClearBtn) {
            filterClearBtn.addEventListener('click', () => {
                selectedCategories.clear();
                filterPanel.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
                applyFilters();
            });
        }

        const recipeFilterOverlayEl = document.getElementById('recipe-filter-overlay');
        if (filterToggle && filterPanel) {
            filterToggle.addEventListener('click', e => {
                e.stopPropagation();
                const isOpen = !filterPanel.hidden;
                filterPanel.hidden = isOpen;
                filterToggle.setAttribute('aria-expanded', String(!isOpen));
                if (recipeFilterOverlayEl) recipeFilterOverlayEl.classList.toggle('active', !isOpen);
            });
            document.addEventListener('click', () => {
                if (!filterPanel.hidden) {
                    filterPanel.hidden = true;
                    filterToggle.setAttribute('aria-expanded', 'false');
                    if (recipeFilterOverlayEl) recipeFilterOverlayEl.classList.remove('active');
                }
            });
            if (recipeFilterOverlayEl) {
                recipeFilterOverlayEl.addEventListener('click', () => {
                    filterPanel.hidden = true;
                    filterToggle.setAttribute('aria-expanded', 'false');
                    recipeFilterOverlayEl.classList.remove('active');
                });
            }
        }

        if (searchInput) {
            searchInput.addEventListener('input', () => {
                searchTerm = searchInput.value.trim();
                searchClear.hidden = !searchTerm;
                applyFilters();
            });
        }

        if (searchClear) {
            searchClear.addEventListener('click', () => {
                searchInput.value = '';
                searchTerm = '';
                searchClear.hidden = true;
                searchInput.focus();
                applyFilters();
            });
        }

        applyFilters();
        observeCards();

    } catch (e) {
        container.innerHTML = '<p style="color:#888;padding:1rem">Could not load recipes.</p>';
    }
}

loadRecipes();

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

    const itemsInCart = cart.filter(i => i.name === name);
    const anyInCart = itemsInCart.length > 0;
    card.classList.toggle('card--in-cart', anyInCart);
    const backInfo = card.querySelector('.back-cart-info');
    if (backInfo) {
        backInfo.innerHTML = anyInCart
            ? `<span class="back-cart-label">In Cart</span>` + itemsInCart.map(i => `<span class="back-cart-item">${i.size} ×${i.qty}</span>`).join('')
            : '';
    }

    if (currentItem) {
        addBtn.hidden = true;
        stepper.hidden = false;
        qtyValue.textContent = currentItem.qty;
    } else {
        addBtn.hidden = false;
        stepper.hidden = true;
    }

    const note = card.querySelector('.other-size-note');
    const allItems = cart.filter(i => i.name === name);
    if (note) {
        if (allItems.length > 0) {
            note.textContent = `In Cart: ${allItems.map(i => `${i.size} ×${i.qty}`).join(', ')}`;
            note.hidden = false;
        } else {
            note.hidden = true;
        }
    }
}

function syncAllCardUI() {
    document.querySelectorAll('.card').forEach(syncCardUI);
}
if (document.querySelector('.product-detail-card')) {
    syncAllCardUI();
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
    row.dataset.selectedOriginal = chip.dataset.original;
    const card = row.closest('.card');
    const priceWrap = card.querySelector('.price-display');
    if (priceWrap) {
        priceWrap.innerHTML = chip.dataset.original
            ? `<span class="price-original">₹${chip.dataset.original}</span><span class="price-discounted">₹${chip.dataset.price}</span><span class="discount-badge">25% OFF</span>`
            : '';
    }
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

// ── STICKY SEARCH/FILTER BAR (products.html, recipes.html) ──
(function() {
    const headerEl = document.querySelector('header');
    document.querySelectorAll('.search-filter-bar').forEach(bar => {
        const sentinel = bar.previousElementSibling;
        if (!sentinel || !sentinel.classList.contains('search-filter-sentinel')) return;

        function setStickyTop() {
            bar.style.top = (headerEl ? headerEl.offsetHeight : 0) + 'px';
        }
        setStickyTop();
        window.addEventListener('resize', setStickyTop);

        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                bar.classList.toggle('is-stuck', !entry.isIntersecting);
            });
        }, { threshold: 0 });
        observer.observe(sentinel);
    });
})();

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

// ── WHY CHOOSE US FLIP CARDS ──
const WHY_FUN_FACTS = [
    "Turmeric contains curcumin, used in Ayurveda for over 4,000 years.",
    "Black pepper was once so valuable it was called \"black gold\" and used as currency.",
    "Cardamom is the world's third most expensive spice by weight, after saffron and vanilla.",
    "Chilli heat comes from capsaicin, which also triggers your brain's endorphin release.",
    "\"Garam masala\" means \"hot mixture\" — but it refers to warming spices, not fiery heat.",
    "Cumin seeds have been found in ancient Egyptian tombs dating back thousands of years.",
    "A single kilogram of saffron needs around 150,000 hand-picked flowers.",
    "Cloves were once worth more than gold along ancient spice trade routes.",
    "Coriander is one of the oldest spices on record, used in cooking for over 5,000 years.",
    "India grows and exports roughly 75% of the world's spices — earning it the name \"Land of Spices.\""
];

function setRandomWhyFact(card) {
    const factEl = card.querySelector('.why-fact-text');
    if (!factEl) return;
    const fact = WHY_FUN_FACTS[Math.floor(Math.random() * WHY_FUN_FACTS.length)];
    factEl.textContent = fact;
}

document.querySelectorAll('.why-card').forEach(card => {
    card.addEventListener('mouseenter', () => {
        if (window.matchMedia('(hover: hover)').matches) setRandomWhyFact(card);
    });

    card.addEventListener('click', () => {
        if (!window.matchMedia('(pointer: coarse)').matches) return;
        if (card.classList.contains('why-flipped')) return;
        setRandomWhyFact(card);
        card.classList.add('why-flipped');
        setTimeout(() => card.classList.remove('why-flipped'), 5000);
    });
});

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

// ── FLICK TO PEEK (in-cart cards only, mobile) ──
(function() {
    let startX = 0, startY = 0, startTime = 0, activeCard = null;
    const peekTimers = new WeakMap();

    document.addEventListener('touchstart', e => {
        const card = e.target.closest('.card--collapsed.card--in-cart');
        activeCard = card || null;
        if (!card) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startTime = Date.now();
    }, { passive: true });

    document.addEventListener('touchend', e => {
        if (!activeCard) return;
        const card = activeCard;
        activeCard = null;
        const touch = e.changedTouches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        const dt = Date.now() - startTime;

        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 600) {
            card.classList.add('card--peek');
            card.dataset.justPeeked = 'true';
            clearTimeout(peekTimers.get(card));
            const timer = setTimeout(() => card.classList.remove('card--peek'), 2000);
            peekTimers.set(card, timer);
        }
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