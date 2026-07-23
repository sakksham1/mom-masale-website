// js/admin.js
// Runs only on admin.html. Loaded after main.min.js.
// Every real check happens server-side (each /api/admin/* call re-verifies
// is_admin in D1) — this file just decides what to *show*, it never grants
// access on its own.

(function () {
    const loadingEl = document.getElementById('admin-loading');
    const deniedEl = document.getElementById('admin-denied');
    const appEl = document.getElementById('admin-app');

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function rupee(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
    function fmtDate(iso) {
        return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    async function api(path, options) {
        const res = await fetch(path, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
        return data;
    }

    // ── ACCESS CHECK ──
    init();
    async function init() {
        try {
            const stats = await api('/api/admin/stats');
            loadingEl.hidden = true;
            appEl.hidden = false;
            renderOverview(stats);
            setupTabs();
        } catch (err) {
            loadingEl.hidden = true;
            deniedEl.hidden = false;
        }
    }

    // ── TABS ──
    function setupTabs() {
        const tabBtns = document.querySelectorAll('.admin-tab-btn');
        const panels = {
            overview: document.getElementById('panel-overview'),
            orders: document.getElementById('panel-orders'),
            products: document.getElementById('panel-products'),
            customers: document.getElementById('panel-customers'),
        };
        const loaded = new Set(['overview']);

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.tab;
                Object.entries(panels).forEach(([key, el]) => { el.hidden = key !== tab; });

                if (!loaded.has(tab)) {
                    loaded.add(tab);
                    if (tab === 'orders') loadOrders();
                    if (tab === 'products') loadProducts();
                    if (tab === 'customers') loadCustomers();
                }
            });
        });

        document.getElementById('orders-refresh-btn')?.addEventListener('click', loadOrders);
        document.getElementById('order-status-filter')?.addEventListener('change', loadOrders);
        document.getElementById('order-payment-filter')?.addEventListener('change', loadOrders);
    }

    // ── OVERVIEW ──
    function renderOverview(stats) {
        document.getElementById('stats-grid').innerHTML = `
            <div class="admin-stat-card">
                <div class="admin-stat-num">${rupee(stats.totalRevenue)}</div>
                <div class="admin-stat-label">Total Revenue (paid)</div>
            </div>
            <div class="admin-stat-card">
                <div class="admin-stat-num">${rupee(stats.todayRevenue)}</div>
                <div class="admin-stat-label">Today · ${stats.todayOrders} order(s)</div>
            </div>
            <div class="admin-stat-card">
                <div class="admin-stat-num">${rupee(stats.monthRevenue)}</div>
                <div class="admin-stat-label">This Month · ${stats.monthOrders} order(s)</div>
            </div>
            <div class="admin-stat-card">
                <div class="admin-stat-num">${stats.pendingOrders}</div>
                <div class="admin-stat-label">Pending Fulfilment</div>
            </div>
            <div class="admin-stat-card">
                <div class="admin-stat-num">${stats.totalCustomers}</div>
                <div class="admin-stat-label">Registered Customers</div>
            </div>
        `;

        const topEl = document.getElementById('top-products-list');
        topEl.innerHTML = stats.topProducts.length
            ? stats.topProducts.map(p => `
                <div class="admin-row">
                    <span>${escapeHtml(p.product_name)}</span>
                    <span>${p.total_qty} sold · ${rupee(p.total_revenue)}</span>
                </div>`).join('')
            : '<p class="empty-state-msg">No paid orders yet.</p>';

        const recentEl = document.getElementById('recent-orders-list');
        recentEl.innerHTML = stats.recentOrders.length
            ? stats.recentOrders.map(o => `
                <div class="admin-row">
                    <span>#${o.id} — ${escapeHtml(o.customer_name)}</span>
                    <span>${rupee(o.total)} · <span class="order-status-badge order-status-${escapeHtml(o.status)}">${escapeHtml(o.status)}</span> <span class="order-status-badge order-payment-${escapeHtml(o.payment_status)}">${escapeHtml(o.payment_status)}</span></span>
                </div>`).join('')
            : '<p class="empty-state-msg">No orders yet.</p>';
    }

    // ── ORDERS ──
    async function loadOrders() {
        const listEl = document.getElementById('orders-list');
        listEl.innerHTML = '<p class="empty-state-msg">Loading…</p>';

        const status = document.getElementById('order-status-filter').value;
        const payment = document.getElementById('order-payment-filter').value;
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        if (payment) params.set('payment_status', payment);

        try {
            const data = await api('/api/admin/orders?' + params.toString());
            if (data.orders.length === 0) {
                listEl.innerHTML = '<p class="empty-state-msg">No orders match this filter.</p>';
                return;
            }
            listEl.innerHTML = data.orders.map(renderOrderCard).join('');
        } catch (err) {
            listEl.innerHTML = `<p class="empty-state-msg">Could not load orders: ${escapeHtml(err.message)}</p>`;
        }
    }

    function formatOrderCode(id, createdAt) {
        const iso = String(createdAt).includes('T') ? createdAt : String(createdAt).replace(' ', 'T') + 'Z';
        const d = new Date(iso);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `MM-${y}${m}${day}-${String(id).padStart(4, '0')}`;
    }

    function renderOrderCard(order) {
        const itemsHtml = (order.items || []).map(item => `
            <div class="order-item-row">
                <span>${escapeHtml(item.product_name)} (${escapeHtml(item.size)}) × ${item.qty}</span>
                <span class="order-id">Order ${formatOrderCode(order.id, order.created_at)} — ${escapeHtml(order.customer_name)}</span>
                <span>${rupee(item.unit_price * item.qty)}</span>
            </div>
        `).join('');

        const statusOptions = ['placed', 'packed', 'shipped', 'delivered', 'cancelled']
            .map(s => `<option value="${s}" ${s === order.status ? 'selected' : ''}>${s}</option>`).join('');
        const paymentOptions = ['created', 'paid', 'failed', 'cod']
            .map(s => `<option value="${s}" ${s === order.payment_status ? 'selected' : ''}>${s}</option>`).join('');

        return `
            <div class="order-card" data-order-id="${order.id}">
                <div class="order-card-header">
                    <div>
                        <span class="order-id">Order #${order.id} — ${escapeHtml(order.customer_name)}</span>
                        <span class="order-date">${fmtDate(order.created_at)} · ${escapeHtml(order.phone)}</span>
                    </div>
                </div>
                <div class="order-items-list">${itemsHtml}</div>
                <div style="font-size:0.85rem;color:var(--text-light);margin-bottom:0.6rem">
                    ${escapeHtml(order.address)}, ${escapeHtml(order.city)} – ${escapeHtml(order.pincode)}
                </div>
                <div class="admin-order-controls">
                    <label>Status
                        <select class="admin-order-status" data-order-id="${order.id}">${statusOptions}</select>
                    </label>
                    <label>Payment
                        <select class="admin-order-payment" data-order-id="${order.id}">${paymentOptions}</select>
                    </label>
                    <button type="button" class="btn admin-order-save-btn" data-order-id="${order.id}">Save</button>
                </div>
                <div class="order-card-footer">
                    <span>Subtotal ${rupee(order.subtotal)} + Shipping ${order.shipping_fee ? rupee(order.shipping_fee) : 'Free'}</span>
                    <span class="order-total">${rupee(order.total)}</span>
                </div>
            </div>
        `;
    }

    document.addEventListener('click', async e => {
        const saveBtn = e.target.closest('.admin-order-save-btn');
        if (!saveBtn) return;
        const orderId = saveBtn.dataset.orderId;
        const statusSel = document.querySelector(`.admin-order-status[data-order-id="${orderId}"]`);
        const paymentSel = document.querySelector(`.admin-order-payment[data-order-id="${orderId}"]`);

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        try {
            await api('/api/admin/orders', {
                method: 'PATCH',
                body: JSON.stringify({ orderId: Number(orderId), status: statusSel.value, payment_status: paymentSel.value }),
            });
            saveBtn.textContent = 'Saved ✓';
            setTimeout(() => { saveBtn.textContent = 'Save'; saveBtn.disabled = false; }, 1200);
        } catch (err) {
            alert('Could not save: ' + err.message);
            saveBtn.textContent = 'Save';
            saveBtn.disabled = false;
        }
    });

    // ── PRODUCTS ──
    let allProducts = [];

    async function loadProducts() {
        const listEl = document.getElementById('products-list');
        listEl.innerHTML = '<p class="empty-state-msg">Loading…</p>';
        try {
            allProducts = await api('/api/admin/products');
            renderProductsList();
        } catch (err) {
            listEl.innerHTML = `<p class="empty-state-msg">Could not load products: ${escapeHtml(err.message)}</p>`;
        }
    }

    function renderProductsList() {
        const listEl = document.getElementById('products-list');
        if (!allProducts.length) {
            listEl.innerHTML = '<p class="empty-state-msg">No products found.</p>';
            return;
        }
        listEl.innerHTML = allProducts.map(p => `
            <div class="admin-product-row" data-slug="${escapeHtml(p.slug)}">
                <img src="${escapeHtml(p.image)}" alt="" width="44" height="44" onerror="this.style.visibility='hidden'">
                <div class="admin-product-info">
                    <strong>${escapeHtml(p.name)}</strong>
                    <span class="admin-product-meta">${escapeHtml(p.category)} · ${(p.sizes || []).join(', ')}</span>
                </div>
                <label class="admin-coming-soon-toggle">
                    <input type="checkbox" class="admin-toggle-coming-soon" data-slug="${escapeHtml(p.slug)}" ${p.comingSoon ? 'checked' : ''}>
                    Coming Soon
                </label>
                <button type="button" class="btn btn-outline admin-delete-product-btn" data-slug="${escapeHtml(p.slug)}">Delete</button>
            </div>
        `).join('');
    }

    document.addEventListener('change', async e => {
        const toggle = e.target.closest('.admin-toggle-coming-soon');
        if (!toggle) return;
        try {
            await api('/api/admin/products', {
                method: 'PATCH',
                body: JSON.stringify({ slug: toggle.dataset.slug, updates: { comingSoon: toggle.checked } }),
            });
            showAdminToast('Saved — the site will rebuild in a minute or two.');
        } catch (err) {
            toggle.checked = !toggle.checked;
            alert('Could not save: ' + err.message);
        }
    });

    document.addEventListener('click', async e => {
        const delBtn = e.target.closest('.admin-delete-product-btn');
        if (!delBtn) return;
        const slug = delBtn.dataset.slug;
        if (!confirm(`Delete "${slug}" permanently? This commits to GitHub immediately.`)) return;
        delBtn.disabled = true;
        delBtn.textContent = 'Deleting…';
        try {
            await api('/api/admin/products?slug=' + encodeURIComponent(slug), { method: 'DELETE' });
            allProducts = allProducts.filter(p => p.slug !== slug);
            renderProductsList();
        } catch (err) {
            alert('Could not delete: ' + err.message);
            delBtn.disabled = false;
            delBtn.textContent = 'Delete';
        }
    });

    const addForm = document.getElementById('add-product-form');
    addForm?.addEventListener('submit', async e => {
        e.preventDefault();
        const errorEl = document.getElementById('add-product-error');
        errorEl.classList.remove('show');

        const name = document.getElementById('np-name').value.trim();
        const category = document.getElementById('np-category').value.trim();
        const sizesRaw = document.getElementById('np-sizes').value.trim();
        const image = document.getElementById('np-image').value.trim();
        const comingSoon = document.getElementById('np-coming-soon').checked;

        const prices = {};
        let parseFailed = false;
        sizesRaw.split(',').forEach(pair => {
            const [size, price] = pair.split(':').map(s => s.trim());
            if (!size || !price || isNaN(Number(price))) { parseFailed = true; return; }
            prices[size] = Number(price);
        });

        if (!name || !category || parseFailed || Object.keys(prices).length === 0) {
            errorEl.textContent = 'Please fill in all fields. Sizes must look like "100g:50, 200g:90".';
            errorEl.classList.add('show');
            return;
        }

        const submitBtn = addForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Adding…';

        try {
            await api('/api/admin/products', {
                method: 'POST',
                body: JSON.stringify({ name, category, prices, image: image || undefined, comingSoon }),
            });
            addForm.reset();
            showAdminToast('Product added — the site will rebuild in a minute or two.');
            loadProducts();
        } catch (err) {
            errorEl.textContent = err.message;
            errorEl.classList.add('show');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Add Product';
        }
    });

    // ── CUSTOMERS ──
    async function loadCustomers() {
        const listEl = document.getElementById('customers-list');
        listEl.innerHTML = '<p class="empty-state-msg">Loading…</p>';
        try {
            const data = await api('/api/admin/customers');
            if (!data.customers.length) {
                listEl.innerHTML = '<p class="empty-state-msg">No registered customers yet.</p>';
                return;
            }
            listEl.innerHTML = data.customers.map(c => `
                <div class="admin-row">
                    <span>
                        <strong>${escapeHtml(c.name)}</strong>${c.is_admin ? ' <span class="essentials-chip">Admin</span>' : ''}<br>
                        <span style="font-size:0.82rem;color:var(--text-light)">${escapeHtml(c.email)}${c.phone ? ' · ' + escapeHtml(c.phone) : ''}</span>
                    </span>
                    <span>${c.order_count} order(s) · ${rupee(c.lifetime_spend)}</span>
                </div>
            `).join('');
        } catch (err) {
            listEl.innerHTML = `<p class="empty-state-msg">Could not load customers: ${escapeHtml(err.message)}</p>`;
        }
    }

    // ── TOAST (reuses cart-toast styling from main.js if present) ──
    function showAdminToast(message) {
        if (typeof showCartToast === 'function') { showCartToast(message); return; }
        alert(message);
    }
})();
