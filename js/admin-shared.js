// js/admin-shared.js
// Shared by admin.html (Operations) and studio.html (Content Management).
// Nothing app-specific lives here — just the plumbing both apps need.

window.AdminShared = (function () {
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

    function showToast(message) {
        if (typeof showCartToast === 'function') { showCartToast(message); return; }
        alert(message);
    }

    // Shared "am I allowed in here" check. `probePath` is any admin-only GET
    // endpoint — /api/admin/stats works for admin.html, /api/admin/products
    // works for studio.html. Runs the same server-side re-check every time.
    async function initGate({ probePath, onGranted, onDenied }) {
        try {
            await api(probePath);
            onGranted();
        } catch (err) {
            onDenied(err);
        }
    }

    return { escapeHtml, rupee, fmtDate, api, showToast, initGate };
})();