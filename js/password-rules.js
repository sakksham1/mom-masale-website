// js/password-rules.js — mirrors functions/api/_utils/password.js
const PASSWORD_RULES = [
  { id: 'length', label: 'At least 8 characters', test: v => v.length >= 8 },
  { id: 'upper', label: 'One uppercase letter', test: v => /[A-Z]/.test(v) },
  { id: 'lower', label: 'One lowercase letter', test: v => /[a-z]/.test(v) },
  { id: 'number', label: 'One number', test: v => /[0-9]/.test(v) },
  { id: 'special', label: 'One special character', test: v => /[!@#$%^&*(),.?":{}|<>_\-+=~`\[\]\\;'/]/.test(v) },
  { id: 'repeat', label: 'No character repeated 3+ times in a row', test: v => !/(.)\1\1/.test(v) },
];

function passwordIsValid(value) {
  return PASSWORD_RULES.every(rule => rule.test(value || ''));
}

function attachPasswordChecklist(inputEl, checklistEl, submitBtn) {
  if (!inputEl || !checklistEl) return;

  checklistEl.innerHTML = PASSWORD_RULES.map(rule => `
    <li data-rule="${rule.id}" style="color:var(--text-light);font-size:0.82rem;list-style:none;display:flex;align-items:center;gap:6px">
      <span class="rule-icon">○</span><span>${rule.label}</span>
    </li>
  `).join('');

  function update() {
    const value = inputEl.value || '';
    let allPass = true;
    PASSWORD_RULES.forEach(rule => {
      const li = checklistEl.querySelector(`li[data-rule="${rule.id}"]`);
      const pass = rule.test(value);
      if (!pass) allPass = false;
      if (li) {
        li.style.color = pass ? '#1ebe5b' : 'var(--text-light)';
        li.querySelector('.rule-icon').textContent = pass ? '✓' : '○';
      }
    });
    if (submitBtn) submitBtn.disabled = !allPass || !value;
    return allPass;
  }

  inputEl.addEventListener('input', update);
  update();
  return update;
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.password-toggle-btn');
  if (!btn) return;
  const input = btn.parentElement.querySelector('input');
  if (!input) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.textContent = showing ? '👁' : '🙈';
  btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
});

window.passwordIsValid = passwordIsValid;
window.attachPasswordChecklist = attachPasswordChecklist;