import { ROLE_LABEL } from './roles';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const date = (d: Date, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

export function invitationEmail(o: { company: string; tz: string; fullName: string; role: string; project: string | null; inviter: string; link: string; expiresAt: Date }) {
  const what = `${ROLE_LABEL[o.role] || 'member'}${o.project ? ` on ${o.project}` : ''}`;
  const subject = `${o.inviter} invited you to join ${o.company}`;
  const text = `Hi ${o.fullName},

${o.inviter} has invited you to join ${o.company} as ${what}.

Accept your invitation here:
${o.link}

You'll choose a password and be added to the system straight away.
This link is personal to you and expires on ${date(o.expiresAt, o.tz)}.

If you weren't expecting this, you can ignore this email.`;
  const html = `<!doctype html><html><body style="margin:0;background:#E9EEE9;font-family:Segoe UI,Arial,sans-serif;color:#15262A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:12px;border:1px solid #CFD8D1">
<tr><td style="height:6px;background:#0D5747;border-radius:12px 12px 0 0"></td></tr>
<tr><td style="padding:28px 28px 8px"><div style="font-weight:800;font-size:15px">${esc(o.company)}</div>
<h1 style="font-size:22px;margin:16px 0 8px">You're invited, ${esc(o.fullName)}</h1>
<p style="font-size:15px;line-height:1.5;margin:0 0 20px">${esc(o.inviter)} has invited you to join as <b>${esc(what)}</b>.</p>
<a href="${esc(o.link)}" style="display:inline-block;background:#0D5747;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">Accept invitation</a>
<p style="font-size:13px;color:#566762;line-height:1.5;margin:20px 0 0">You'll choose a password and be added straight away. This link is personal to you and expires on ${esc(date(o.expiresAt, o.tz))}.</p>
<p style="font-size:12px;color:#566762;word-break:break-all;margin:14px 0 24px">Button not working? Paste this into your browser:<br>${esc(o.link)}</p>
</td></tr></table><p style="font-size:12px;color:#566762">If you weren't expecting this, you can ignore this email.</p></td></tr></table></body></html>`;
  return { subject, text, html };
}

export function acceptedEmail(o: { company: string; fullName: string; email: string; role: string; project: string | null }) {
  const what = `${ROLE_LABEL[o.role] || 'member'}${o.project ? ` on ${o.project}` : ''}`;
  const subject = `${o.fullName} accepted your invitation`;
  const text = `${o.fullName} (${o.email}) accepted your invitation and has been added to ${o.company} as ${what}.`;
  return { subject, text, html: `<p style="font-family:Segoe UI,Arial,sans-serif">${esc(text)}</p>` };
}

export function resetEmail(o: { company: string; tz: string; fullName: string; inviter: string; link: string; expiresAt: Date }) {
  const subject = `Choose a new password for ${o.company}`;
  const text = `Hi ${o.fullName},

${o.inviter} sent you a link to choose a new password for ${o.company}:
${o.link}

The link works once and expires on ${date(o.expiresAt, o.tz)}. If you didn't ask for this, you can ignore this email; your current password still works.`;
  const html = `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;color:#15262A;background:#E9EEE9;padding:32px 16px"><div style="max-width:520px;margin:auto;background:#fff;border:1px solid #CFD8D1;border-radius:12px;padding:28px">
<div style="font-weight:800">${esc(o.company)}</div><h1 style="font-size:22px">Choose a new password</h1>
<p>${esc(o.inviter)} sent you a link to choose a new password.</p>
<a href="${esc(o.link)}" style="display:inline-block;background:#0D5747;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">Choose new password</a>
<p style="font-size:13px;color:#566762">The link works once and expires on ${esc(date(o.expiresAt, o.tz))}. If you didn't ask for this, ignore this email.</p></div></body></html>`;
  return { subject, text, html };
}
