// js/return-policy.js
// Runs only on return-policy.html. Fetches data/return-policy.json (the
// same static-file pattern as data/settings.json — edited via the admin
// app, staged, then committed to GitHub on Publish) and renders it.

(function () {
    const introMount = document.getElementById('return-policy-intro');
    const updatedMount = document.getElementById('return-policy-updated');
    const sectionsMount = document.getElementById('return-policy-sections');
    const contactMount = document.getElementById('return-policy-contact');
    if (!sectionsMount) return;

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function renderSection(s) {
        const bodyHtml = (s.body || []).map(p => `<p>${escapeHtml(p)}</p>`).join('');
        const listHtml = (s.list && s.list.length)
            ? `<ul class="rp-list">${s.list.map(li => `<li>${escapeHtml(li)}</li>`).join('')}</ul>`
            : '';
        return `
            <section class="rp-section" id="${escapeHtml(s.id)}">
                <h2 class="rp-heading">${escapeHtml(s.title)}</h2>
                ${bodyHtml}
                ${listHtml}
            </section>`;
    }

    fetch('data/return-policy.json')
        .then(r => r.json())
        .then(data => {
            if (updatedMount && data.lastUpdated) {
                const d = new Date(data.lastUpdated);
                updatedMount.textContent = isNaN(d)
                    ? ''
                    : `Last updated: ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`;
            }
            if (introMount && data.intro) {
                introMount.innerHTML = `<p>${escapeHtml(data.intro)}</p>`;
            }

            sectionsMount.innerHTML = (data.sections || []).map(renderSection).join('');

            if (contactMount && data.contact) {
                const c = data.contact;
                contactMount.innerHTML = `
                    <h2 class="rp-heading">Contact Us</h2>
                    ${c.note ? `<p>${escapeHtml(c.note)}</p>` : ''}
                    <div class="contact-item">
                        <span class="contact-icon">📞</span>
                        <a href="tel:${escapeHtml(c.phone || '')}">${escapeHtml(c.phone || '')}</a>
                    </div>
                    <div class="contact-item">
                        <span class="contact-icon">✉</span>
                        <a href="mailto:${escapeHtml(c.email || '')}">${escapeHtml(c.email || '')}</a>
                    </div>
                `;
            }
        })
        .catch(() => {
            sectionsMount.innerHTML = '<p class="empty-state-msg">Could not load the return policy right now. Please contact us directly using the details in our Contact page.</p>';
        });
})();
