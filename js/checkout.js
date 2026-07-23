// js/checkout.js
// Runs only on checkout.html. Loaded after main.min.js (for getCart/saveCart/
// updateCartBadge) and after the Razorpay Checkout.js SDK.
//
// NOTE: the subtotal/shipping/total shown here are for display only, computed
// from whatever price was on the page when the item was added to cart. The
// authoritative amount is always recomputed server-side in
// functions/api/checkout.js — this page never sends a price to the server,
// only product name + size + qty.

(function () {
let DISPLAY_FREE_SHIPPING_THRESHOLD = 499; // fallback until settings load
let DISPLAY_FLAT_SHIPPING_FEE = 40;
fetch('data/settings.json').then(r => r.json()).then(s => {
    DISPLAY_FREE_SHIPPING_THRESHOLD = s.commerce.freeShippingThreshold;
    DISPLAY_FLAT_SHIPPING_FEE = s.commerce.flatShippingFee;
}).catch(() => {});

    const emptyEl = document.getElementById('checkout-empty');
    const loginRequiredEl = document.getElementById('checkout-login-required');
    const formEl = document.getElementById('checkout-form');
    const summaryEl = document.getElementById('checkout-summary');
    const itemsListEl = document.getElementById('checkout-items-list');
    const errorEl = document.getElementById('checkout-error');
    const placeOrderBtn = document.getElementById('place-order-btn');

    checkAuthThenRender();

    async function checkAuthThenRender() {
        await window.cartReady;
        try {
            const res = await fetch('/api/auth/me');
            const data = await res.json();
            if (!data.user) { showLoginRequired(); return; }
        } catch (err) {
            showLoginRequired();
            return;
        }
        renderCartSummary();
    }

    function showLoginRequired() {
        if (loginRequiredEl) loginRequiredEl.hidden = false;
        emptyEl.hidden = true;
        formEl.hidden = true;
        summaryEl.hidden = true;
    }

    function getCartItems() {
        return typeof getCart === 'function' ? getCart() : [];
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderCartSummary() {
        const cart = getCartItems();

        if (cart.length === 0) {
            emptyEl.hidden = false;
            formEl.hidden = true;
            summaryEl.hidden = true;
            return;
        }

        emptyEl.hidden = true;
        formEl.hidden = false;
        summaryEl.hidden = false;

        itemsListEl.innerHTML = cart.map(item => `
            <div class="checkout-item-row">
                <span>${escapeHtml(item.name)} (${escapeHtml(item.size)}) × ${item.qty}</span>
                <span>₹${(item.price || 0) * item.qty}</span>
            </div>
        `).join('');

        const subtotal = cart.reduce((sum, item) => sum + (item.price || 0) * item.qty, 0);
        const shippingFee = subtotal >= DISPLAY_FREE_SHIPPING_THRESHOLD ? 0 : DISPLAY_FLAT_SHIPPING_FEE;
        const total = subtotal + shippingFee;

        document.getElementById('checkout-subtotal').textContent = `₹${subtotal}`;
        document.getElementById('checkout-shipping').textContent = shippingFee === 0 ? 'Free' : `₹${shippingFee}`;
        document.getElementById('checkout-total').textContent = `₹${total}`;
    }

    function showError(msg) {
        errorEl.textContent = msg;
        errorEl.classList.add('show');
    }

    function clearError() {
        errorEl.classList.remove('show');
    }

    function resetButton() {
        placeOrderBtn.disabled = false;
        placeOrderBtn.textContent = 'Place Order';
    }

    function completeOrder(orderId, orderCode) {
        saveCart([]);
        updateCartBadge();
        const codeParam = orderCode ? `&code=${encodeURIComponent(orderCode)}` : '';
        window.location.href = `order-confirmation?order=${encodeURIComponent(orderId)}${codeParam}`;
    }

    formEl.addEventListener('submit', async e => {
        e.preventDefault();
        clearError();

        const cart = getCartItems();
        if (cart.length === 0) return;

        const name = document.getElementById('checkout-name').value.trim();
        const phone = document.getElementById('checkout-phone').value.trim();
        const email = document.getElementById('checkout-email').value.trim();
        const address = document.getElementById('checkout-address').value.trim();
        const city = document.getElementById('checkout-city').value.trim();
        const pincode = document.getElementById('checkout-pincode').value.trim();
        const paymentMethod = document.querySelector('input[name="payment-method"]:checked')?.value;

        if (!name || !phone || !address || !city || !pincode) {
            showError('Please fill in all required fields.');
            return;
        }
        if (!/^[6-9]\d{9}$/.test(phone)) {
            showError('Please enter a valid 10-digit phone number.');
            return;
        }
        if (!/^\d{6}$/.test(pincode)) {
            showError('Please enter a valid 6-digit pincode.');
            return;
        }
        if (!paymentMethod) {
            showError('Please select a payment method.');
            return;
        }

        placeOrderBtn.disabled = true;
        placeOrderBtn.textContent = 'Placing order…';

        let data;
        try {
            const res = await fetch('/api/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customer: { name, phone, email, address, city, pincode },
                    items: cart.map(i => ({ name: i.name, size: i.size, qty: i.qty })),
                    paymentMethod,
                }),
            });
            data = await res.json();

            if (!res.ok) {
                showError(data.error || 'Something went wrong. Please try again.');
                resetButton();
                return;
            }
        } catch (err) {
            showError('Could not reach the server. Please try again.');
            resetButton();
            return;
        }

        if (data.paymentMethod === 'cod') {
            completeOrder(data.orderId, data.orderCode);
            return;
        }

        // ── Razorpay path ──
        const rzp = new Razorpay({
            key: data.razorpayKeyId,
            amount: data.amount,
            currency: data.currency,
            order_id: data.razorpayOrderId,
            name: 'Mom Masale',
            description: 'Order payment',
            prefill: { name, email, contact: phone },
            theme: { color: '#7b1120' },
            handler: async function (response) {
                try {
                    const verifyRes = await fetch('/api/verify-payment', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            orderId: data.orderId,
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                        }),
                    });
                    const verifyData = await verifyRes.json();

                    if (verifyRes.ok && verifyData.success) {
                        completeOrder(data.orderId, data.orderCode);
                    } else {
                        showError(
                            'Payment received but verification failed. Please contact us with your order number: ' + data.orderId
                        );
                        resetButton();
                    }
                } catch (err) {
                    showError(
                        'Payment received but we could not confirm it. Please contact us with your order number: ' + data.orderId
                    );
                    resetButton();
                }
            },
            modal: {
                ondismiss: function () {
                    resetButton();
                },
            },
        });

        rzp.on('payment.failed', function (response) {
            showError('Payment failed: ' + (response.error?.description || 'please try again.'));
            resetButton();
        });

        rzp.open();
    });
})();
