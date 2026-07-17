// functions/api/_utils/email.js
// Sends transactional email via Resend — free tier, plain REST call (Workers
// can't run nodemailer/SMTP sockets, so this is the practical option).
// Requires env.RESEND_API_KEY and env.RESEND_FROM.

export async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');
  // `to` can be a single address, a comma-separated string, or already an array.
  const recipients = Array.isArray(to)
    ? to
    : String(to).split(',').map(s => s.trim()).filter(Boolean);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM || 'Mom Masale <onboarding@resend.dev>',
      to: recipients,
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Email send failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export function otpEmailHtml(otp) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #eee;border-radius:8px">
      <h2 style="color:#7b1120;margin-bottom:8px">Mom Masale — Password Reset</h2>
      <p style="color:#555;font-size:0.95rem">Use this code to reset your password. It expires in 10 minutes.</p>
      <div style="font-size:2rem;font-weight:700;letter-spacing:6px;color:#7b1120;text-align:center;padding:16px 0">${otp}</div>
      <p style="color:#888;font-size:0.8rem">If you didn't request this, you can safely ignore this email.</p>
    </div>
  `;
}