// functions/api/_utils/career-notify.js
// Applicant-facing email for status changes. 'new'/'screening' stay silent —
// applicant already got the submission confirmation, and screening is
// internal-only. 'withdrawn' is silent too, since that's not something you'd
// congratulate/console someone about.

import { sendEmail } from './email.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const STATUS_COPY = {
  shortlisted: {
    subject: job => `You've been shortlisted — ${job}`,
    heading: "Good news — you've been shortlisted!",
    body: (name, job) => `Hi ${escapeHtml(name)},<br><br>Your application for <strong>${escapeHtml(job)}</strong> has been shortlisted. We'll be in touch soon with next steps.`,
  },
  interview: {
    subject: job => `Interview stage — ${job}`,
    heading: "You've moved to the interview stage",
    body: (name, job) => `Hi ${escapeHtml(name)},<br><br>We'd like to move forward with an interview for <strong>${escapeHtml(job)}</strong>. Someone from our team will reach out to schedule a time.`,
  },
  offered: {
    subject: job => `An offer for you — ${job}`,
    heading: "We'd like to offer you the role",
    body: (name, job) => `Hi ${escapeHtml(name)},<br><br>Congratulations! We'd like to offer you the <strong>${escapeHtml(job)}</strong> position. We'll follow up with details shortly.`,
  },
  hired: {
    subject: job => `Welcome to Mom Masale — ${job}`,
    heading: 'Welcome to the team!',
    body: (name, job) => `Hi ${escapeHtml(name)},<br><br>We're delighted to confirm you've joined us for <strong>${escapeHtml(job)}</strong>. Welcome aboard!`,
  },
  rejected: {
    subject: job => `Update on your application — ${job}`,
    heading: 'Application update',
    body: (name, job) => `Hi ${escapeHtml(name)},<br><br>Thank you for your interest in <strong>${escapeHtml(job)}</strong> and for taking the time to apply. We've decided to move forward with other candidates for this role, but we'll keep your profile on file for future openings.`,
  },
};

const SILENT_STATUSES = new Set(['new', 'screening', 'withdrawn']);

export async function notifyApplicantStatusChange(env, { email, applicantName, jobTitle, toStatus }) {
  if (SILENT_STATUSES.has(toStatus) || !email) return;
  const copy = STATUS_COPY[toStatus];
  if (!copy) return;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #eee;border-radius:8px">
      <h2 style="color:#7b1120;margin-bottom:8px">${copy.heading}</h2>
      <p style="color:#333;font-size:0.95rem;line-height:1.6">${copy.body(applicantName, jobTitle)}</p>
      <p style="color:#888;font-size:0.8rem;margin-top:16px">If you have any questions, just reply to this email.</p>
    </div>`;

  try {
    await sendEmail(env, { to: email, subject: copy.subject(jobTitle), html });
  } catch (err) {
    console.error('Applicant status email failed:', err.message);
  }
}