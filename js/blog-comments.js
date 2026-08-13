// js/blog-comments.js
(function () {
    const listMount = document.getElementById('comments-list-mount');
    const formMount = document.getElementById('comment-form-mount');
    if (!listMount || !formMount) return;

    const blogSlug = formMount.dataset.blogSlug;

    function escapeHtml(str) {
        return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function renderList(comments) {
        listMount.innerHTML = comments.length ? comments.map(c => `
            <div class="comment-card">
                <div class="comment-card-header">
                    <span class="comment-card-author">${escapeHtml(c.authorName)}</span>
                    <span class="comment-card-date">${new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </div>
                <p class="comment-card-body">${escapeHtml(c.body)}</p>
            </div>
        `).join('') : '<p class="empty-state-msg">No comments yet.</p>';
    }

    async function loadComments() {
        try {
            const res = await fetch(`/api/blog-comments?blogSlug=${encodeURIComponent(blogSlug)}&limit=30`);
            const data = await res.json();
            renderList(data.comments || []);
        } catch (err) { /* static SSR list stays as-is */ }
    }

    function renderForm(loggedIn) {
        if (!loggedIn) {
            const inSubdir = /\/(products|recipes|guide)\//.test(location.pathname);
            const returnTo = encodeURIComponent(location.pathname + location.search);
            formMount.innerHTML = `<p class="empty-state-msg"><a href="${inSubdir ? '../' : ''}account?redirect=cart-login&return=${returnTo}">Log in</a> to leave a comment.</p>`;
            return;
        }
        formMount.innerHTML = `
            <form id="comment-form" class="form-card" novalidate>
                <div class="form-group">
                    <label for="comment-body">Leave a comment</label>
                    <textarea id="comment-body" rows="3" required minlength="3" maxlength="1000"></textarea>
                </div>
                <div class="field-error" id="comment-form-error"></div>
                <button type="submit" class="btn auth-submit-btn">Post Comment</button>
            </form>
        `;
        document.getElementById('comment-form').addEventListener('submit', async e => {
            e.preventDefault();
            const errorEl = document.getElementById('comment-form-error');
            errorEl.classList.remove('show');
            const text = document.getElementById('comment-body').value.trim();
            if (text.length < 3) {
                errorEl.textContent = 'Please write a bit more.';
                errorEl.classList.add('show');
                return;
            }
            const submitBtn = e.target.querySelector('button[type="submit"]');
            submitBtn.disabled = true; submitBtn.textContent = 'Posting…';
            try {
                const res = await fetch('/api/blog-comments', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ blogSlug, body: text }),
                });
                const data = await res.json();
                if (!res.ok) {
                    errorEl.textContent = data.error || 'Something went wrong.';
                    errorEl.classList.add('show');
                    submitBtn.disabled = false; submitBtn.textContent = 'Post Comment';
                    return;
                }
                formMount.innerHTML = '<p class="review-status-msg">Comment submitted — awaiting approval.</p>';
                if (typeof showCartToast === 'function') showCartToast('Comment submitted — awaiting approval.');
            } catch (err) {
                errorEl.textContent = 'Could not reach the server. Please try again.';
                errorEl.classList.add('show');
                submitBtn.disabled = false; submitBtn.textContent = 'Post Comment';
            }
        });
    }

    async function initForm() {
        try {
            const res = await fetch('/api/auth/me');
            const data = await res.json();
            renderForm(!!data.user);
        } catch (err) { renderForm(false); }
    }

    loadComments();
    initForm();
})();