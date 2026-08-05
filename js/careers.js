(() => {
    const jobsList = document.getElementById('jobs-list');
    const loading = document.getElementById('jobs-loading');
    const empty = document.getElementById('jobs-empty');
    const error = document.getElementById('jobs-error');
    const count = document.getElementById('jobs-count');
    const dialog = document.getElementById('career-dialog');
    const detail = document.getElementById('career-job-detail');
    const form = document.getElementById('career-application-form');
    const formMessage = document.getElementById('career-form-message');
    const applySection = document.getElementById('career-apply-section');
    const success = document.getElementById('career-success');
    const slugInput = document.getElementById('career-job-slug');

    const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
    const label = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
    const list = values => values?.length ? `<ul>${values.map(v => `<li>${escapeHtml(v)}</li>`).join('')}</ul>` : '';
    const salary = value => {
        if (!value) return '';
        const format = n => n ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: value.currency || 'INR', maximumFractionDigits: 0 }).format(n) : '';
        return [format(value.min), format(value.max)].filter(Boolean).join(' – ') + (value.period ? ` / ${escapeHtml(value.period)}` : '');
    };

    function card(job) {
        return `<article class="career-job-card"><div class="career-job-card__main"><p class="career-job-card__department">${escapeHtml(job.department || 'Mom Masale')}</p><h3>${escapeHtml(job.title)}</h3><p>${escapeHtml(job.summary)}</p><div class="career-job-card__tags"><span>${escapeHtml(job.location)}</span><span>${escapeHtml(label(job.workplaceType))}</span><span>${escapeHtml(label(job.employmentType))}</span>${job.experienceLevel ? `<span>${escapeHtml(job.experienceLevel)}</span>` : ''}</div></div><button class="btn btn-outline career-job-card__button" type="button" data-job-slug="${escapeHtml(job.slug)}">View role & apply</button></article>`;
    }

    async function openJob(slug, updateUrl = true) {
        try {
            const response = await fetch(`/api/careers/jobs?slug=${encodeURIComponent(slug)}`);
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Job not found');
            const job = data.job;
            detail.innerHTML = `<div class="career-detail"><p class="careers-eyebrow">${escapeHtml(job.department || 'MOM MASALE')}</p><h1>${escapeHtml(job.title)}</h1><div class="career-detail__facts"><span>${escapeHtml(job.location)}</span><span>${escapeHtml(label(job.workplaceType))}</span><span>${escapeHtml(label(job.employmentType))}</span>${job.experienceLevel ? `<span>${escapeHtml(job.experienceLevel)}</span>` : ''}${salary(job.salary) ? `<span>${salary(job.salary)}</span>` : ''}</div><p class="career-detail__summary">${escapeHtml(job.summary)}</p><div class="career-detail__description">${escapeHtml(job.description).replace(/\n/g, '<br>')}</div>${job.responsibilities?.length ? `<section><h2>What you'll do</h2>${list(job.responsibilities)}</section>` : ''}${job.qualifications?.length ? `<section><h2>What we're looking for</h2>${list(job.qualifications)}</section>` : ''}${job.skills?.length ? `<section><h2>Skills that help</h2>${list(job.skills)}</section>` : ''}</div>`;
            slugInput.value = job.slug;
            form.reset(); slugInput.value = job.slug; formMessage.textContent = '';
            success.hidden = true; applySection.hidden = false;
            dialog.showModal();
            if (updateUrl) history.replaceState(null, '', `${location.pathname}?job=${encodeURIComponent(job.slug)}`);
        } catch (err) { alert(err.message || 'Unable to open this role.'); }
    }

    function clearJobUrl() { history.replaceState(null, '', location.pathname); }
    function closeJob() { if (dialog.open) dialog.close(); else clearJobUrl(); }

    document.getElementById('career-dialog-close').addEventListener('click', closeJob);
    dialog.addEventListener('click', event => { if (event.target === dialog) closeJob(); });
    dialog.addEventListener('close', clearJobUrl);
    jobsList.addEventListener('click', event => { const button = event.target.closest('[data-job-slug]'); if (button) openJob(button.dataset.jobSlug); });

    form.addEventListener('submit', async event => {
        event.preventDefault(); formMessage.textContent = '';
        if (!form.reportValidity()) return;
        const resume = document.getElementById('career-resume').files[0];
        if (!resume || resume.size > 5 * 1024 * 1024) { formMessage.textContent = 'Please choose a CV under 5 MB.'; return; }
        const submit = document.getElementById('career-submit'); submit.disabled = true; submit.textContent = 'Submitting…';
        try {
            const response = await fetch('/api/careers/applications', { method: 'POST', body: new FormData(form) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Unable to submit application');
            form.hidden = true; success.hidden = false;
        } catch (err) { formMessage.textContent = err.message || 'Unable to submit application. Please try again.'; }
        finally { submit.disabled = false; submit.textContent = 'Submit application'; }
    });

    fetch('/api/careers/jobs').then(async response => {
        const data = await response.json(); if (!response.ok) throw new Error();
        const jobs = data.jobs || []; loading.hidden = true;
        count.textContent = jobs.length ? `${jobs.length} opening${jobs.length === 1 ? '' : 's'}` : '';
        if (!jobs.length) { empty.hidden = false; return; }
        jobsList.innerHTML = jobs.map(card).join(''); jobsList.hidden = false;
        const job = new URLSearchParams(location.search).get('job'); if (job) openJob(job, false);
    }).catch(() => { loading.hidden = true; error.hidden = false; });
})();
