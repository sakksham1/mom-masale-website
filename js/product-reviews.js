// js/product-reviews.js
// Runs only on generated product detail pages (scripts/product-template.html).
// Loaded unminified and directly — same pattern as js/password-rules.js.
// Hydrates the SSR'd review list/summary with live data (so a review
// approved after the last site rebuild shows up immediately), and renders
// the "write a review" widget based on login + existing-review state.

(function () {
    const listMount = document.getElementById('reviews-list-mount');
    const summaryMount = document.getElementById('review-summary-mount');
    const formMount = document.getElementById('review-form-mount');
    if (!listMount || !formMount) return;

    const productSlug = formMount.dataset.productSlug;

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function starString(rating) {
        const rounded = Math.max(0, Math.min(5, Math.round(rating)));
        return '★'.repeat(rounded) + '☆'.repeat(5 - rounded);
    }

    function renderList(reviews) {
        listMount.innerHTML = reviews.map(r => `
            <div class="review-card">
                <div class="review-card-header">
                    <span class="review-card-stars" aria-hidden="true">${starString(r.rating)}</span>
                    <span class="review-card-author">${escapeHtml(r.authorName)}</span>
                    ${r.verifiedPurchase ? '<span class="essentials-chip">✓ Verified Purchase</span>' : ''}
                    <span class="review-card-date">${new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </div>
                ${r.title ? `<h4 class="review-card-title">${escapeHtml(r.title)}</h4>` : ''}
                <p class="review-card-body">${escapeHtml(r.body)}</p>
                ${r.images.length ? `<div class="review-card-images">${r.images.map(src => `<img src="${escapeHtml(src)}" alt="Review photo" loading="lazy" class="review-image-thumb">`).join('')}</div>` : ''}
            </div>
        `).join('');
    }

    function renderSummary(aggregate) {
        summaryMount.innerHTML = (aggregate && aggregate.reviewCount)
            ? `<div class="review-summary">
                    <span class="review-summary-value">${aggregate.ratingValue.toFixed(1)}</span>
                    <span class="review-summary-stars" aria-hidden="true">${starString(aggregate.ratingValue)}</span>
                    <span class="review-summary-count">Based on ${aggregate.reviewCount} review${aggregate.reviewCount === 1 ? '' : 's'}</span>
               </div>`
            : `<p class="empty-state-msg">No reviews yet — be the first to review this product.</p>`;
    }

    async function loadReviews() {
        try {
            const res = await fetch(`/api/reviews?productSlug=${encodeURIComponent(productSlug)}&limit=20`);
            const data = await res.json();
            renderSummary(data.aggregate);
            renderList(data.reviews || []);
        } catch (err) {
            // Static SSR content (baked in at last build) just stays as-is.
        }
    }

    function renderForm({ loggedIn, existing }) {
        if (!loggedIn) {
            const inSubdir = /\/(products|recipes|guide)\//.test(location.pathname);
            const returnTo = encodeURIComponent(location.pathname + location.search);
            formMount.innerHTML = `<p class="empty-state-msg"><a href="${inSubdir ? '../' : ''}account?redirect=cart-login&return=${returnTo}">Log in</a> to write a review.</p>`;
            return;
        }
        if (existing) {
            const msg = existing.status === 'approved'
                ? "You've already reviewed this product."
                : 'Your review is awaiting approval — thanks for your patience!';
            formMount.innerHTML = `<p class="review-status-msg">${escapeHtml(msg)}</p>`;
            return;
        }

        formMount.innerHTML = `
            <button type="button" class="btn" id="write-review-toggle">Write a Review</button>
            <form id="review-form" class="form-card" hidden novalidate>
                <div class="form-group">
                    <label>Your Rating</label>
                    <div class="star-picker" id="star-picker">
                        ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="star-picker-btn" data-value="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}
                    </div>
                    <input type="hidden" id="review-rating" value="0">
                </div>
                <div class="form-group">
                    <label for="review-title">Title (optional)</label>
                    <input id="review-title" type="text" maxlength="120">
                </div>
                <div class="form-group">
                    <label for="review-body">Your Review</label>
                    <textarea id="review-body" rows="4" required minlength="5" maxlength="2000"></textarea>
                </div>
                <div class="form-group">
                    <label for="review-images">Photos (optional, up to 4)</label>
                    <input id="review-images" type="file" accept="image/webp,image/jpeg,image/png" multiple>
                    <div class="review-image-preview" id="review-image-preview"></div>
                </div>
                <div class="field-error" id="review-form-error"></div>
                <button type="submit" class="btn auth-submit-btn">Submit Review</button>
            </form>
        `;

        const toggleBtn = document.getElementById('write-review-toggle');
        const formEl = document.getElementById('review-form');
        toggleBtn.addEventListener('click', () => {
            formEl.hidden = !formEl.hidden;
            toggleBtn.hidden = !formEl.hidden;
        });

        const starPicker = document.getElementById('star-picker');
        const ratingInput = document.getElementById('review-rating');
        starPicker.addEventListener('click', e => {
            const btn = e.target.closest('.star-picker-btn');
            if (!btn) return;
            const value = Number(btn.dataset.value);
            ratingInput.value = value;
            starPicker.querySelectorAll('.star-picker-btn').forEach(b => {
                b.classList.toggle('active', Number(b.dataset.value) <= value);
            });
        });

        const imagesInput = document.getElementById('review-images');
        const previewEl = document.getElementById('review-image-preview');
        imagesInput.addEventListener('change', () => {
            previewEl.innerHTML = '';
            [...imagesInput.files].slice(0, 4).forEach(file => {
                const img = document.createElement('img');
                img.className = 'review-image-thumb';
                img.src = URL.createObjectURL(file);
                previewEl.appendChild(img);
            });
        });

        formEl.addEventListener('submit', async e => {
            e.preventDefault();
            const errorEl = document.getElementById('review-form-error');
            errorEl.classList.remove('show');

            const rating = Number(ratingInput.value);
            if (!rating) {
                errorEl.textContent = 'Please select a star rating.';
                errorEl.classList.add('show');
                return;
            }

            const fd = new FormData();
            fd.append('productSlug', productSlug);
            fd.append('rating', rating);
            fd.append('title', document.getElementById('review-title').value.trim());
            fd.append('body', document.getElementById('review-body').value.trim());
            [...imagesInput.files].slice(0, 4).forEach(file => fd.append('images', file));

            const submitBtn = formEl.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Submitting…';

            try {
                const res = await fetch('/api/reviews', { method: 'POST', body: fd });
                const data = await res.json();
                if (!res.ok) {
                    errorEl.textContent = data.error || 'Something went wrong. Please try again.';
                    errorEl.classList.add('show');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Submit Review';
                    return;
                }
                renderForm({ loggedIn: true, existing: { status: 'pending' } });
                if (typeof showCartToast === 'function') showCartToast('Review submitted — awaiting approval.');
            } catch (err) {
                errorEl.textContent = 'Could not reach the server. Please try again.';
                errorEl.classList.add('show');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit Review';
            }
        });
    }

    async function initForm() {
        try {
            const meRes = await fetch('/api/auth/me');
            const meData = await meRes.json();
            if (!meData.user) { renderForm({ loggedIn: false }); return; }

            const mineRes = await fetch(`/api/reviews?productSlug=${encodeURIComponent(productSlug)}&mine=1`);
            const mineData = await mineRes.json();
            renderForm({ loggedIn: true, existing: mineData.review || null });
        } catch (err) {
            renderForm({ loggedIn: false });
        }
    }

    loadReviews();
    initForm();
})();