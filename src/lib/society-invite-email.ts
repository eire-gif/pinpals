import { escapeHtml, type SendEmailInput } from "@/lib/email";
import { societyInviteEmail } from "@/lib/society-console/member-import";

/**
 * The society invitation email (0170), in the same branded layout as the
 * sign-up emails (supabase/templates/): navy header, gold rule, cream page,
 * green pill button, the link spelled out underneath.
 */
const SANS = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

export function buildSocietyInviteEmail(input: Parameters<typeof societyInviteEmail>[0] & { logoUrl?: string | null }): SendEmailInput {
  const c = societyInviteEmail(input);
  const href = escapeHtml(input.link);
  const logo =
    input.logoUrl && /^https:\/\//.test(input.logoUrl)
      ? `<img src="${escapeHtml(input.logoUrl)}" width="56" height="56" alt="" style="display:block;border:0;border-radius:14px;margin:0 0 18px 0;">`
      : "";
  const paras = c.bodyLines
    .map((l) => `<p style="margin:0 0 16px 0;font-family:${SANS};font-size:16px;line-height:1.55;color:#3d4757;">${escapeHtml(l)}</p>`)
    .join("\n");
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f3ea;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(c.subject)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f3ea;"><tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
    <tr><td style="background:#0c2038;border-radius:16px 16px 0 0;padding:28px 32px 24px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;padding-right:12px;"><img src="https://www.pinpals.ie/icons/icon-192.png" width="40" height="40" alt="" style="display:block;border:0;border-radius:10px;"></td>
        <td style="vertical-align:middle;font-family:${SERIF};font-size:26px;font-weight:bold;color:#f7f3ea;">PinPals</td>
      </tr></table>
      <div style="width:48px;height:3px;background:#e8c46b;border-radius:2px;margin-top:16px;"></div>
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid #ddd2b8;border-top:0;border-radius:0 0 16px 16px;padding:32px;">
      ${logo}
      <h1 style="margin:0 0 16px 0;font-family:${SERIF};font-size:26px;line-height:1.25;color:#0e1520;">${escapeHtml(c.title)}</h1>
      ${paras}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;"><tr><td style="background:#1f5c2e;border-radius:999px;">
        <a href="${href}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:16px;font-weight:bold;color:#f7f3ea;text-decoration:none;border-radius:999px;">${escapeHtml(c.ctaLabel)}</a>
      </td></tr></table>
      <p style="margin:24px 0 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:#647082;word-break:break-all;">If the button doesn't work, paste this into your browser:<br><a href="${href}" style="color:#1f5c2e;">${href}</a></p>
      <p style="margin:16px 0 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:#647082;">You're getting this because the society's organisers added ${escapeHtml(input.email)} to its member list. Not for you? Ignore it — nothing happens unless you sign in.</p>
    </td></tr>
    <tr><td align="center" style="padding:20px 16px 0 16px;font-family:${SANS};font-size:12px;line-height:1.5;color:#647082;">PinPals &middot; Golf is better on PinPals<br><a href="https://www.pinpals.ie" style="color:#647082;">pinpals.ie</a></td></tr>
  </table>
</td></tr></table>
</body>
</html>`;
  const text = [c.title, "", ...c.bodyLines, "", `${c.ctaLabel}: ${input.link}`, "", `Sent because the society's organisers added ${input.email} to its member list.`].join("\n");
  return { to: input.email, subject: c.subject, html, text };
}
