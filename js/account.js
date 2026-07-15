// js/account.js
// Runs only on account.html. Loaded after main.min.js, so it can use the
// global getCart()/openCart() helpers already defined there.

(function () {
    const authSection = document.getElementById('auth-section');
    const profileSection = document.getElementById('profile-section');

    // ── REDIRECT-AFTER-AUTH (e.g. ?redirect=checkout from checkout.html) ──
    const urlParams = new URLSearchParams(location.search);
    const redirectTarget = urlParams.get('redirect');

    function redirectAfterAuth() {
        if (redirectTarget === 'checkout') {
            window.location.href = 'checkout';
            return true;
        }
        return false;
    }

    if (redirectTarget === 'checkout') {
        const banner = document.createElement('p');
        banner.style.cssText = 'text-align:center;color:var(--maroon);font-weight:600;font-size:0.9rem;margin-bottom:1rem';
        banner.textContent = 'Log in or sign up to continue to checkout.';
        authSection.parentElement.insertBefore(banner, authSection);
    }

    // ── TAB SWITCHING (Login / Sign Up) ──
    const tabBtns = document.querySelectorAll('.auth-tab-btn');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const showLogin = btn.dataset.tab === 'login';
            loginForm.hidden = !showLogin;
            signupForm.hidden = showLogin;
        });
    });

    // ── INIT: check session, show the right section ──
    init();

    async function init() {
        try {
            const res = await fetch('/api/auth/me');
            const data = await res.json();
            if (data.user) {
                showProfile(data.user);
            } else {
                showAuth();
            }
        } catch (err) {
            // API unreachable — fall back to showing login rather than a blank page.
            showAuth();
        }
    }

    function showAuth() {
        authSection.hidden = false;
        profileSection.hidden = true;
    }

    function showProfile(user) {
        authSection.hidden = true;
        profileSection.hidden = false;

        document.getElementById('profile-name').textContent = user.name;
        document.getElementById('profile-email').textContent = user.email;
        document.getElementById('profile-phone').textContent = user.phone ? `📞 ${user.phone}` : '';
        document.getElementById('profile-avatar').textContent = (user.name || '?').trim().charAt(0).toUpperCase();

        loadOrders();
        renderProfileCart();
    }

    // ── LOGIN ──
    loginForm.addEventListener('submit', async e => {
        e.preventDefault();
        const errorEl = document.getElementById('login-error');
        errorEl.classList.remove('show');

        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;

        const submitBtn = loginForm.querySelector('.auth-submit-btn');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Logging in…';

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();

            if (!res.ok) {
                errorEl.textContent = data.error || 'Something went wrong. Please try again.';
                errorEl.classList.add('show');
                return;
            }

            if (redirectAfterAuth()) return;
            showProfile(data);
        } catch (err) {
            errorEl.textContent = 'Could not reach the server. Please try again.';
            errorEl.classList.add('show');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Log In';
        }
    });

    // ── SIGN UP ──
    signupForm.addEventListener('submit', async e => {
        e.preventDefault();
        const errorEl = document.getElementById('signup-error');
        errorEl.classList.remove('show');

        const name = document.getElementById('signup-name').value.trim();
        const email = document.getElementById('signup-email').value.trim();
        const phone = document.getElementById('signup-phone').value.trim();
        const password = document.getElementById('signup-password').value;

        const submitBtn = signupForm.querySelector('.auth-submit-btn');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating account…';

        try {
            const res = await fetch('/api/auth/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, phone, password }),
            });
            const data = await res.json();

            if (!res.ok) {
                errorEl.textContent = data.error || 'Something went wrong. Please try again.';
                errorEl.classList.add('show');
                return;
            }

             if (redirectAfterAuth()) return;
            showProfile(data);
        } catch (err) {
            errorEl.textContent = 'Could not reach the server. Please try again.';
            errorEl.classList.add('show');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create Account';
        }
    });

    // ── LOGOUT ──
    document.getElementById('logout-btn').addEventListener('click', async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch (err) {
            // even if the request fails, drop the user back to the login view
        }
        showAuth();
        loginForm.reset();
        signupForm.reset();
    });

    // ── ORDER HISTORY ──
    async function loadOrders() {
        const listEl = document.getElementById('orders-list');
        const emptyEl = document.getElementById('orders-empty');
        listEl.innerHTML = '';
        emptyEl.hidden = true;

        try {
            const res = await fetch('/api/orders');
            if (res.status === 401) {
                // session expired between page load and this call
                showAuth();
                return;
            }
            const data = await res.json();
            const orders = data.orders || [];

            if (orders.length === 0) {
                emptyEl.hidden = false;
                return;
            }

            listEl.innerHTML = orders.map(renderOrderCard).join('');
        } catch (err) {
            listEl.innerHTML = '<p class="empty-state-msg">Could not load your orders right now.</p>';
        }
    }

    function renderOrderCard(order) {
        const date = new Date(order.created_at).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', year: 'numeric',
        });
        const itemsHtml = (order.items || []).map(item => `
            <div class="order-item-row">
                <span>${escapeHtml(item.product_name)} (${escapeHtml(item.size)}) × ${item.qty}</span>
                <span>₹${item.unit_price * item.qty}</span>
            </div>
        `).join('');

        return `
            <div class="order-card">
                <div class="order-card-header">
                    <div>
                        <span class="order-id">Order #${order.id}</span>
                        <span class="order-date">${date}</span>
                    </div>
                    <div class="order-badges">
                        <span class="order-status-badge order-status-${escapeHtml(order.status)}">${escapeHtml(order.status)}</span>
                        <span class="order-status-badge order-payment-${escapeHtml(order.payment_status)}">${escapeHtml(order.payment_status)}</span>
                    </div>
                </div>
                <div class="order-items-list">${itemsHtml}</div>
                <div class="order-card-footer">
                    <span>Total</span>
                    <span class="order-total">₹${order.total}</span>
                </div>
            </div>
        `;
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ── CART SUMMARY (reuses getCart()/openCart() from main.js) ──
    function renderProfileCart() {
        const summaryEl = document.getElementById('profile-cart-summary');
        const emptyEl = document.getElementById('cart-empty-msg');
        const openBtn = document.getElementById('open-cart-from-profile-btn');
        const browseBtn = document.getElementById('browse-products-btn');

        const cart = typeof getCart === 'function' ? getCart() : [];

        if (cart.length === 0) {
            summaryEl.innerHTML = '';
            emptyEl.hidden = false;
            openBtn.hidden = true;
            browseBtn.hidden = false;
            return;
        }

        emptyEl.hidden = true;
        openBtn.hidden = false;
        browseBtn.hidden = true;

        const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
        const totalPrice = cart.reduce((sum, item) => sum + (item.price || 0) * item.qty, 0);

        summaryEl.innerHTML = `
            <div class="profile-cart-line">${totalQty} item${totalQty === 1 ? '' : 's'} in your cart</div>
            ${totalPrice ? `<div class="profile-cart-line profile-cart-total">Total: ₹${totalPrice}</div>` : ''}
        `;

        openBtn.onclick = () => {
            if (typeof openCart === 'function') openCart();
        };
    }

    // ── PASSWORD CHECKLIST (signup) ──
    attachPasswordChecklist(
        document.getElementById('signup-password'),
        document.getElementById('signup-password-checklist'),
        signupForm.querySelector('.auth-submit-btn')
    );

    // ── FORGOT PASSWORD FLOW ──
    const forgotLink = document.getElementById('forgot-password-link');
    const backToLoginLink = document.getElementById('back-to-login-link');
    const forgotSection = document.getElementById('forgot-password-section');
    const forgotEmailForm = document.getElementById('forgot-email-form');
    const forgotOtpForm = document.getElementById('forgot-otp-form');
    const forgotNewpassForm = document.getElementById('forgot-newpass-form');
    let forgotEmailValue = '';
    let resetTokenValue = '';

    attachPasswordChecklist(
        document.getElementById('forgot-newpass'),
        document.getElementById('forgot-newpass-checklist'),
        forgotNewpassForm.querySelector('.auth-submit-btn')
    );

    function showAuthForms() {
        forgotSection.hidden = true;
        loginForm.hidden = false;
    }
    function showForgotStep(step) {
        forgotEmailForm.hidden = step !== 'email';
        forgotOtpForm.hidden = step !== 'otp';
        forgotNewpassForm.hidden = step !== 'newpass';
    }

    forgotLink?.addEventListener('click', e => {
        e.preventDefault();
        loginForm.hidden = true;
        signupForm.hidden = true;
        forgotSection.hidden = false;
        showForgotStep('email');
    });
    backToLoginLink?.addEventListener('click', e => {
        e.preventDefault();
        showAuthForms();
        tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === 'login'));
    });

    forgotEmailForm.addEventListener('submit', async e => {
        e.preventDefault();
        const errorEl = document.getElementById('forgot-email-error');
        errorEl.classList.remove('show');
        forgotEmailValue = document.getElementById('forgot-email').value.trim();

        const btn = forgotEmailForm.querySelector('.auth-submit-btn');
        btn.disabled = true; btn.textContent = 'Sending…';
        try {
            await fetch('/api/auth/forgot-password', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: forgotEmailValue }),
            });
            showForgotStep('otp');
        } catch (err) {
            errorEl.textContent = 'Could not reach the server. Please try again.';
            errorEl.classList.add('show');
        } finally {
            btn.disabled = false; btn.textContent = 'Send OTP';
        }
    });

    forgotOtpForm.addEventListener('submit', async e => {
        e.preventDefault();
        const errorEl = document.getElementById('forgot-otp-error');
        errorEl.classList.remove('show');
        const otp = document.getElementById('forgot-otp').value.trim();

        const btn = forgotOtpForm.querySelector('.auth-submit-btn');
        btn.disabled = true; btn.textContent = 'Verifying…';
        try {
            const res = await fetch('/api/auth/verify-reset-otp', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: forgotEmailValue, otp }),
            });
            const data = await res.json();
            if (!res.ok) {
                errorEl.textContent = data.error || 'Incorrect code.';
                errorEl.classList.add('show');
                return;
            }
            resetTokenValue = data.resetToken;
            showForgotStep('newpass');
        } catch (err) {
            errorEl.textContent = 'Could not reach the server. Please try again.';
            errorEl.classList.add('show');
        } finally {
            btn.disabled = false; btn.textContent = 'Verify Code';
        }
    });

    forgotNewpassForm.addEventListener('submit', async e => {
        e.preventDefault();
        const errorEl = document.getElementById('forgot-newpass-error');
        errorEl.classList.remove('show');
        const newPassword = document.getElementById('forgot-newpass').value;

        const btn = forgotNewpassForm.querySelector('.auth-submit-btn');
        btn.disabled = true; btn.textContent = 'Resetting…';
        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: forgotEmailValue, resetToken: resetTokenValue, newPassword }),
            });
            const data = await res.json();
            if (!res.ok) {
                errorEl.textContent = data.error || 'Could not reset password.';
                errorEl.classList.add('show');
                btn.disabled = false; btn.textContent = 'Reset Password';
                return;
            }
            showAuthForms();
            loginForm.reset();
            alert('Password reset! Please log in with your new password.');
        } catch (err) {
            errorEl.textContent = 'Could not reach the server. Please try again.';
            errorEl.classList.add('show');
            btn.disabled = false; btn.textContent = 'Reset Password';
        }
    });
})();
