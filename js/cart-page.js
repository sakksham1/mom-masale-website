// js/cart-page.js
// Runs only on cart.html. Loaded after main.min.js — reuses its global
// cart state (getCart/saveCart/updateCartBadge/cartReady/settingsReady)
// rather than duplicating it, same pattern as checkout.js and account.js.

(function () {
    const loadingEl = document.getElementById('cart-loading');
    const loginRequiredEl = document.getElementById('cart-login-required');
    const emptyEl = document.getElementById('cart-empty-state');
    const layoutEl = document.getElementById('cart-page-layout');
    const itemsEl = document.getElementById('cart-page-items');
    const itemCountEl = document.getElementById('cart-item-count');
    const clearBtn = document.getElementById('cart-page-clear-btn');

    // Shared with checkout.js via the same sessionStorage key — a coupon
    // applied on the cart page is still applied when the person reaches
    // checkout, without a server round trip to "remember" it for them.
    const COUPON_STORAGE_KEY = 'mm_applied_coupon';

    function getAppliedCoupon() {
        try {
            const raw = sessionStorage.getItem(COUPON_STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (err) { return null; }
    }
    function setAppliedCoupon(coupon) {
        sessionStorage.setItem(COUPON_STORAGE_KEY, JSON.stringify(coupon));
    }
    function clearAppliedCoupon() {
        sessionStorage.removeItem(COUPON_STORAGE_KEY);
    }

    function subtotal() {
        return getCart().reduce((sum, item) => sum + (item.price || 0) * item.qty, 0);
    }

    async function init() {
        await window.cartReady;
        loadingEl.hidden = true;

        if (!cartIsLoggedIn) {
            loginRequiredEl.hidden = false;
            return;
        }
        await render();
    }

    async function render() {
        const cart = getCart();

        if (cart.length === 0) {
            emptyEl.hidden = false;
            layoutEl.hidden = true;
            clearAppliedCoupon();
            return;
        }

        emptyEl.hidden = true;
        layoutEl.hidden = false;

        itemCountEl.textContent = cart.reduce((sum, i) => sum + i.qty, 0);
        itemsEl.innerHTML = cart.map(renderItem).join('');

        await window.settingsReady;
        renderShippingProgress();
        await refreshCouponIfApplied();
        renderSummary();
    }

    function renderItem(item, index) {
        const fallbackImg = 'https://placehold.co/100x100/7b1120/fff?text=' + encodeURIComponent((item.name || '?')[0]);
        return `
            <div class="cart-page-item" data-index="${index}">
                <img class="cart-page-item-img" src="${escapeHtml(item.image || fallbackImg)}" alt="${escapeHtml(item.name)}" loading="lazy" onerror="this.src='${fallbackImg}'">
                <div class="cart-page-item-info">
                    <span class="cart-page-item-name">${escapeHtml(item.name)}</span>
                    <span class="cart-page-item-size">Size: ${escapeHtml(item.size)}</span>
                    ${item.price ? `<span class="cart-page-item-unit-price">₹${item.price} each</span>` : ''}
                </div>
                <div class="cart-page-item-qty">
                    <button type="button" class="qty-btn" data-action="dec" data-index="${index}" aria-label="Decrease quantity">−</button>
                    <span class="qty-value">${item.qty}</span>
                    <button type="button" class="qty-btn" data-action="inc" data-index="${index}" aria-label="Increase quantity">+</button>
                </div>
                <div class="cart-page-item-subtotal">${item.price ? `₹${item.price * item.qty}` : ''}</div>
                <button type="button" class="cart-page-item-remove" data-index="${index}" aria-label="Remove ${escapeHtml(item.name)}">🗑</button>
            </div>
        `;
    }

    function renderShippingProgress() {
        const wrap = document.getElementById('cart-page-shipping-progress');
        const text = document.getElementById('cart-page-shipping-text');
        const fill = document.getElementById('cart-page-shipping-fill');
        if (!wrap) return;

        const sub = subtotal();
        wrap.hidden = false;
        wrap.classList.remove('unlocked', 'warning');

        if (sub < SMALL_ORDER_THRESHOLD_CFG) {
            const remaining = SMALL_ORDER_THRESHOLD_CFG - sub;
            fill.style.width = `${Math.min((sub / SMALL_ORDER_THRESHOLD_CFG) * 100, 100)}%`;
            text.textContent = `⚠️ Add ₹${remaining} more to avoid the ₹${SMALL_ORDER_FEE_CFG} Small Order Fee`;
            wrap.classList.add('warning');
            return;
        }
        const remaining = FREE_SHIPPING_THRESHOLD_CFG - sub;
        fill.style.width = `${Math.min((sub / FREE_SHIPPING_THRESHOLD_CFG) * 100, 100)}%`;
        if (remaining <= 0) {
            text.textContent = "✅ You've unlocked free shipping!";
            wrap.classList.add('unlocked');
        } else {
            text.textContent = `🚚 Add ₹${remaining} more for free shipping`;
        }
    }

    function renderSummary() {
        const sub = subtotal();
        document.getElementById('cart-summary-subtotal').textContent = `₹${sub}`;

        const coupon = getAppliedCoupon();
        const discountLine = document.getElementById('cart-summary-discount-line');
        const shippingEl = document.getElementById('cart-summary-shipping');
        const discount = coupon ? coupon.discountAmount : 0;

        if (coupon) {
            discountLine.hidden = false;
            document.getElementById('cart-summary-discount').textContent = `− ₹${discount}`;
        } else {
            discountLine.hidden = true;
        }

        if (sub < SMALL_ORDER_THRESHOLD_CFG) {
            shippingEl.textContent = `₹${SMALL_ORDER_FEE_CFG} (small order fee)`;
        } else if (sub >= FREE_SHIPPING_THRESHOLD_CFG) {
            shippingEl.textContent = 'Free';
        } else {
            shippingEl.textContent = 'Calculated at checkout';
        }

        document.getElementById('cart-summary-total').textContent = `₹${Math.max(sub - discount, 0)}`;

        renderCouponUI(coupon);
    }

    function renderCouponUI(coupon) {
        const inputRow = document.getElementById('cart-coupon-input-row');
        const appliedEl = document.getElementById('cart-coupon-applied');
        if (coupon) {
            inputRow.hidden = true;
            appliedEl.hidden = false;
            document.getElementById('cart-coupon-applied-code').textContent = coupon.code;
            document.getElementById('cart-coupon-applied-desc').textContent =
                coupon.description || `You saved ₹${coupon.discountAmount}`;
        } else {
            inputRow.hidden = false;
            appliedEl.hidden = true;
        }
    }

    // Re-checks an already-applied coupon against the current subtotal —
    // a qty change or removal can push the cart under a coupon's minimum,
    // or change a percent-based discount amount. Silently drops it (with a
    // toast) rather than letting the summary show a stale discount.
    async function refreshCouponIfApplied() {
        const coupon = getAppliedCoupon();
        if (!coupon) return;
        try {
            const res = await fetch('/api/coupons/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: coupon.code, subtotal: subtotal() }),
            });
            const data = await res.json();
            if (!res.ok || !data.valid) {
                clearAppliedCoupon();
                showCartToast(data.error || 'Your coupon is no longer valid and was removed.');
                return;
            }
            setAppliedCoupon({ code: data.code, description: data.description, discountAmount: data.discountAmount });
        } catch (err) {
            // network hiccup — leave the previously stored coupon as-is
        }
    }

    // ── EVENTS ──

    itemsEl.addEventListener('click', e => {
        const qtyBtn = e.target.closest('.qty-btn');
        if (qtyBtn) {
            const cart = getCart();
            const idx = parseInt(qtyBtn.dataset.index, 10);
            if (qtyBtn.dataset.action === 'inc') cart[idx].qty += 1;
            if (qtyBtn.dataset.action === 'dec') {
                cart[idx].qty -= 1;
                if (cart[idx].qty <= 0) cart.splice(idx, 1);
            }
            saveCart(cart);
            updateCartBadge();
            if (typeof syncAllCardUI === 'function') syncAllCardUI();
            render();
            return;
        }
        const removeBtn = e.target.closest('.cart-page-item-remove');
        if (removeBtn) {
            const cart = getCart();
            cart.splice(parseInt(removeBtn.dataset.index, 10), 1);
            saveCart(cart);
            updateCartBadge();
            if (typeof syncAllCardUI === 'function') syncAllCardUI();
            render();
        }
    });

    clearBtn?.addEventListener('click', () => {
        if (!confirm('Remove all items from your cart?')) return;
        saveCart([]);
        updateCartBadge();
        clearAppliedCoupon();
        if (typeof syncAllCardUI === 'function') syncAllCardUI();
        render();
    });

    const couponInput = document.getElementById('cart-coupon-input');
    const couponApplyBtn = document.getElementById('cart-coupon-apply-btn');
    const couponErrorEl = document.getElementById('cart-coupon-error');

    async function applyCoupon() {
        const code = couponInput.value.trim();
        couponErrorEl.classList.remove('show');
        if (!code) {
            couponErrorEl.textContent = 'Please enter a coupon code.';
            couponErrorEl.classList.add('show');
            return;
        }
        couponApplyBtn.disabled = true;
        couponApplyBtn.textContent = 'Applying…';
        try {
            const res = await fetch('/api/coupons/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, subtotal: subtotal() }),
            });
            const data = await res.json();
            if (!res.ok || !data.valid) {
                couponErrorEl.textContent = data.error || 'This coupon could not be applied.';
                couponErrorEl.classList.add('show');
                return;
            }
            setAppliedCoupon({ code: data.code, description: data.description, discountAmount: data.discountAmount });
            couponInput.value = '';
            showCartToast(`Coupon "${data.code}" applied!`);
            renderSummary();
        } catch (err) {
            couponErrorEl.textContent = 'Could not reach the server. Please try again.';
            couponErrorEl.classList.add('show');
        } finally {
            couponApplyBtn.disabled = false;
            couponApplyBtn.textContent = 'Apply';
        }
    }

    couponApplyBtn?.addEventListener('click', applyCoupon);
    couponInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); }
    });
    document.getElementById('cart-coupon-remove-btn')?.addEventListener('click', () => {
        clearAppliedCoupon();
        showCartToast('Coupon removed.');
        renderSummary();
    });

    init();
})();