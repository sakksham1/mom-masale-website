// js/studio.js
// Registry-driven content manager. Each RESOURCE entry describes one
// GitHub-JSON-backed collection; the generic renderCollection() function
// builds the list + add-form for all of them. New resources (FAQ, and
// eventually ERP entities) just add a registry entry — no new UI code.

(function () {
    const { escapeHtml, api, showToast, initGate } = window.AdminShared;

    const RESOURCES = {
        products: {
            label: 'Products',
            listPath: '/api/admin/products',
            createPath: '/api/admin/products',
            updatePath: '/api/admin/products',       // PATCH { slug, updates }
            deletePath: (slug) => `/api/admin/products?slug=${encodeURIComponent(slug)}`,
            idField: 'slug',
            titleField: 'name',
            subtitleField: (item) => `${item.category} · ${(item.sizes || []).join(', ')}`,
            imageField: 'image',
            createFields: [
                { key: 'name', label: 'Name', type: 'text', required: true },
                { key: 'category', label: 'Category', type: 'text', required: true },
                { key: 'pricesRaw', label: 'Sizes & Prices', type: 'text', placeholder: '100g:50, 200g:90', required: true,
                  toPayload: (v) => {
                      const prices = {};
                      v.split(',').forEach(pair => {
                          const [size, price] = pair.split(':').map(s => s.trim());
                          if (size && price && !isNaN(Number(price))) prices[size] = Number(price);
                      });
                      return { prices };
                  } },
                { key: 'image', label: 'Image path', type: 'text', placeholder: 'images/products/slug.webp' },
                { key: 'comingSoon', label: 'Mark as "Coming Soon"', type: 'checkbox' },
            ],
            toggleFields: [
                { key: 'comingSoon', label: 'Coming Soon' },
            ],
        },
        recipes: {
            label: 'Recipes',
            listPath: '/api/admin/recipes',
            createPath: '/api/admin/recipes',
            updatePath: '/api/admin/recipes',
            deletePath: (slug) => `/api/admin/recipes?slug=${encodeURIComponent(slug)}`,
            idField: 'slug',
            titleField: 'title',
            subtitleField: (item) => `${item.category || ''}${item.trending ? ' · trending' : ''}${item.essentials ? ' · essential' : ''}`,
            imageField: 'image',
            createFields: [
                { key: 'title', label: 'Title', type: 'text', required: true },
                { key: 'category', label: 'Category', type: 'text', required: true },
                { key: 'cuisine', label: 'Cuisine', type: 'text' },
                { key: 'description', label: 'Description', type: 'text', required: true },
                { key: 'image', label: 'Image path', type: 'text', placeholder: 'images/recipes/slug.webp' },
                { key: 'servings', label: 'Servings', type: 'number' },
                { key: 'trending', label: 'Trending', type: 'checkbox' },
                { key: 'essentials', label: 'Essential', type: 'checkbox' },
            ],
            toggleFields: [
                { key: 'trending', label: 'Trending' },
                { key: 'essentials', label: 'Essential' },
            ],
        },
        blog: {
            label: 'Spice Guide',
            listPath: '/api/admin/blog',
            createPath: '/api/admin/blog',
            updatePath: '/api/admin/blog',
            deletePath: (slug) => `/api/admin/blog?slug=${encodeURIComponent(slug)}`,
            idField: 'slug',
            titleField: 'title',
            subtitleField: (item) => item.category || '',
            imageField: 'image',
            createFields: [
                { key: 'title', label: 'Title', type: 'text', required: true },
                { key: 'category', label: 'Category', type: 'select',
                  options: ['Articles', 'FAQs', 'Buying Guides', 'Cooking Tips', 'Ingredient Comparisons'], required: true },
                { key: 'description', label: 'Description', type: 'text', required: true },
                { key: 'image', label: 'Image path', type: 'text', placeholder: 'images/blog/slug.webp' },
                { key: 'bodyRaw', label: 'Body (one paragraph per line)', type: 'textarea', required: true,
                  toPayload: (v) => ({ body: v.split('\n').map(l => l.trim()).filter(Boolean) }) },
            ],
            toggleFields: [],
        },
        // faq: {...}      — Phase 5, needs data/faq.json + build-site support first
        // settings: {...} — Phase 6, singleton resource not a collection; separate renderer
    };

    let allData = {};

    initGate({
        probePath: '/api/admin/products',
        onGranted: () => {
            document.getElementById('studio-loading').hidden = true;
            document.getElementById('studio-app').hidden = false;
            setupTabs();
            switchTab('products');
        },
        onDenied: () => {
            document.getElementById('studio-loading').hidden = true;
            document.getElementById('studio-denied').hidden = false;
        },
    });

    function setupTabs() {
        const tabsEl = document.getElementById('studio-tabs');
        tabsEl.innerHTML = Object.entries(RESOURCES).map(([key, r], i) =>
            `<button type="button" class="admin-tab-btn${i === 0 ? ' active' : ''}" data-resource="${key}">${escapeHtml(r.label)}</button>`
        ).join('');
        tabsEl.addEventListener('click', e => {
            const btn = e.target.closest('.admin-tab-btn');
            if (!btn) return;
            tabsEl.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            switchTab(btn.dataset.resource);
        });
    }

    async function switchTab(resourceKey) {
        const panel = document.getElementById('studio-panel');
        panel.innerHTML = '<p class="empty-state-msg">Loading…</p>';
        const config = RESOURCES[resourceKey];
        try {
            allData[resourceKey] = await api(config.listPath);
            renderCollection(resourceKey);
        } catch (err) {
            panel.innerHTML = `<p class="empty-state-msg">Could not load: ${escapeHtml(err.message)}</p>`;
        }
    }

    function renderCollection(resourceKey) {
        const config = RESOURCES[resourceKey];
        const items = allData[resourceKey] || [];
        const panel = document.getElementById('studio-panel');

        panel.innerHTML = `
            <div class="form-card">
                <h2 class="section-title">Add ${escapeHtml(config.label.replace(/s$/, ''))}</h2>
                <form id="studio-create-form" novalidate>
                    ${config.createFields.map(f => renderField(f)).join('')}
                    <div class="field-error" id="studio-create-error"></div>
                    <button type="submit" class="btn">Add</button>
                </form>
            </div>
            <div class="form-card">
                <h2 class="section-title">All ${escapeHtml(config.label)}</h2>
                <div id="studio-list"></div>
            </div>
        `;

        renderList(resourceKey);

        document.getElementById('studio-create-form').addEventListener('submit', async e => {
            e.preventDefault();
            const errorEl = document.getElementById('studio-create-error');
            errorEl.classList.remove('show');
            const payload = {};
            let failed = false;
            config.createFields.forEach(f => {
                const el = document.getElementById(`sf-${f.key}`);
                const raw = f.type === 'checkbox' ? el.checked : el.value.trim();
                if (f.required && !raw) failed = true;
                if (f.toPayload) Object.assign(payload, f.toPayload(raw));
                else payload[f.key] = raw;
            });
            if (failed) {
                errorEl.textContent = 'Please fill in all required fields.';
                errorEl.classList.add('show');
                return;
            }
            const btn = e.target.querySelector('button[type="submit"]');
            btn.disabled = true; btn.textContent = 'Saving…';
            try {
                await api(config.createPath, { method: 'POST', body: JSON.stringify(payload) });
                showToast('Saved — the site will rebuild in a minute or two.');
                await switchTab(resourceKey);
            } catch (err) {
                errorEl.textContent = err.message;
                errorEl.classList.add('show');
            } finally {
                btn.disabled = false; btn.textContent = 'Add';
            }
        });
    }

    function renderField(f) {
        if (f.type === 'checkbox') {
            return `<div class="form-group"><label><input type="checkbox" id="sf-${f.key}"> ${escapeHtml(f.label)}</label></div>`;
        }
        if (f.type === 'select') {
            return `<div class="form-group"><label for="sf-${f.key}">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>
                <select id="sf-${f.key}">${f.options.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}</select></div>`;
        }
        if (f.type === 'textarea') {
            return `<div class="form-group"><label for="sf-${f.key}">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>
                <textarea id="sf-${f.key}" rows="5" placeholder="${escapeHtml(f.placeholder || '')}"></textarea></div>`;
        }
        return `<div class="form-group"><label for="sf-${f.key}">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>
            <input id="sf-${f.key}" type="${f.type === 'number' ? 'number' : 'text'}" placeholder="${escapeHtml(f.placeholder || '')}"></div>`;
    }

    function renderList(resourceKey) {
        const config = RESOURCES[resourceKey];
        const items = allData[resourceKey] || [];
        const listEl = document.getElementById('studio-list');
        if (!items.length) {
            listEl.innerHTML = '<p class="empty-state-msg">Nothing here yet.</p>';
            return;
        }
        listEl.innerHTML = items.map(item => {
            const id = item[config.idField];
            const title = item[config.titleField];
            const subtitle = typeof config.subtitleField === 'function' ? config.subtitleField(item) : item[config.subtitleField];
            const toggles = (config.toggleFields || []).map(t => `
                <label class="admin-coming-soon-toggle">
                    <input type="checkbox" class="studio-toggle" data-resource="${resourceKey}" data-id="${escapeHtml(id)}" data-field="${t.key}" ${item[t.key] ? 'checked' : ''}>
                    ${escapeHtml(t.label)}
                </label>`).join('');
            return `
                <div class="admin-product-row" data-id="${escapeHtml(id)}">
                    ${config.imageField ? `<img src="${escapeHtml(item[config.imageField] || '')}" alt="" width="44" height="44" onerror="this.style.visibility='hidden'">` : ''}
                    <div class="admin-product-info">
                        <strong>${escapeHtml(title)}</strong>
                        <span class="admin-product-meta">${escapeHtml(subtitle)}</span>
                    </div>
                    ${toggles}
                    <button type="button" class="btn btn-outline studio-delete-btn" data-resource="${resourceKey}" data-id="${escapeHtml(id)}">Delete</button>
                </div>`;
        }).join('');
    }

    document.addEventListener('change', async e => {
        const toggle = e.target.closest('.studio-toggle');
        if (!toggle) return;
        const { resource, id, field } = toggle.dataset;
        const config = RESOURCES[resource];
        try {
            await api(config.updatePath, {
                method: 'PATCH',
                body: JSON.stringify({ [config.idField]: id, updates: { [field]: toggle.checked } }),
            });
            showToast('Saved — the site will rebuild in a minute or two.');
        } catch (err) {
            toggle.checked = !toggle.checked;
            alert('Could not save: ' + err.message);
        }
    });

    document.addEventListener('click', async e => {
        const delBtn = e.target.closest('.studio-delete-btn');
        if (!delBtn) return;
        const { resource, id } = delBtn.dataset;
        const config = RESOURCES[resource];
        if (!confirm(`Delete "${id}" permanently? This commits to GitHub immediately.`)) return;
        delBtn.disabled = true; delBtn.textContent = 'Deleting…';
        try {
            await api(config.deletePath(id), { method: 'DELETE' });
            await switchTab(resource);
        } catch (err) {
            alert('Could not delete: ' + err.message);
            delBtn.disabled = false; delBtn.textContent = 'Delete';
        }
    });
})();