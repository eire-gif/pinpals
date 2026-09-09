import "server-only";

// The first real "send an email" capability this app has ever had. Research
// before writing this file confirmed there was nothing to reuse: the only
// outbound email anywhere in this repo is Supabase Auth's own locked,
// default-template password-reset email (see claude/password-reset-setup.md)
// — no provider SDK, no template renderer, no queue, nothing. This is that
// seam, built narrow and provider-agnostic on purpose:
//
//   - No new npm dependency. RESEND_API_KEY, if set, is used against
//     Resend's plain HTTP API via fetch() — Resend was already the
//     documented "future upgrade" path in password-reset-setup.md's own
//     "Future upgrade" note, so this follows that existing plan rather than
//     picking a fresh provider. Swapping providers later only ever touches
//     this one function.
//   - Fails open, never throws. Same "external service hiccup must never
//     break the feature around it" discipline as
//     src/lib/stripe/balance.ts's getConnectAccountBalance() — a
//     notification's in-app record is written unconditionally by
//     notifyUser() (src/lib/notifications-server.ts) regardless of whether
//     the email send below succeeds, so a missing/invalid API key or a
//     provider outage degrades this app to "in-app notifications only,"
//     never to a thrown error surfacing in a Server Action or a webhook
//     handler.
//   - No sensitive data ever reaches this function to begin with — see
//     notifications-server.ts's own comment on what a notification body is
//     allowed to contain. This module trusts its caller on that; it is not
//     itself a redaction layer.

const FROM_ADDRESS = process.env.NOTIFICATIONS_FROM_EMAIL || "Pinpals <notifications@pinpals.ie>";
const RESEND_API_URL = "https://api.resend.com/emails";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult = { sent: true } | { sent: false; reason: string };

let warnedMissingKeyOnce = false;

/**
 * Sends one transactional email. Returns rather than throws on any failure
 * — see the header comment above. Every caller should treat a `{sent:
 * false}` result as "logged, not fatal," same as every other best-effort
 * side effect in this app (realtime broadcasts, the conversation<->order
 * link, etc).
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Logged once per server lifetime, not once per email, so a dev/preview
    // environment with no key configured doesn't spam its own logs for
    // every notification fired during a normal test session.
    if (!warnedMissingKeyOnce) {
      warnedMissingKeyOnce = true;
      console.warn(
        "[email] RESEND_API_KEY is not set — notification emails will be recorded in-app only, no email will be sent. Set RESEND_API_KEY to enable outbound email."
      );
    }
    return { sent: false, reason: "not_configured" };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`[email] Resend API returned ${response.status}: ${body.slice(0, 500)}`);
      return { sent: false, reason: `provider_error_${response.status}` };
    }

    return { sent: true };
  } catch (err) {
    console.error("[email] Failed to send:", err instanceof Error ? err.message : err);
    return { sent: false, reason: "network_error" };
  }
}

/**
 * Wraps a plain-text-ish body into a minimal, brand-light HTML shell — not
 * a full template system (no logo, no marketing chrome; this app has no
 * design asset pipeline for email yet). Every notification email is short
 * and link-driven by design (see notifications-server.ts) so this is
 * deliberately plain rather than under-building a half-finished template
 * engine no other part of this phase needs.
 */
export function renderEmailHtml(input: { title: string; bodyLines: string[]; ctaLabel: string; ctaHref: string }): string {
  const paragraphs = input.bodyLines.map((line) => `<p style="margin:0 0 12px;color:#3a3a34;font-size:15px;line-height:1.5;">${escapeHtml(line)}</p>`).join("\n");
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#faf7f0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px;border:1px solid #e6e0d4;">
      <h1 style="margin:0 0 16px;color:#14261e;font-size:19px;">${escapeHtml(input.title)}</h1>
      ${paragraphs}
      <a href="${escapeHtml(input.ctaHref)}" style="display:inline-block;margin-top:8px;padding:11px 20px;background:#1f5c2e;color:#faf7f0;text-decoration:none;border-radius:999px;font-weight:700;font-size:14px;">${escapeHtml(input.ctaLabel)}</a>
      <p style="margin:20px 0 0;color:#8a8478;font-size:12px;">Pinpals — golf community &amp; marketplace</p>
    </div>
  </body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
