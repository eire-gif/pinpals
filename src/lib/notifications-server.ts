import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSiteUrl } from "./site-url";
import { sendEmail, renderEmailHtml } from "./email";
import { categoryForType, isOptionalCategory, type NotificationType } from "./notifications";

/**
 * The one place this app fires a notification — every Server Action,
 * webhook handler, and SQL trigger that needs to tell a member something
 * either calls notifyUser() below, or (for the offer/auction/bid lifecycle,
 * which already lived entirely in SQL before this phase — see
 * supabase/migrations/0056_marketplace_notifications_reviews.sql's header
 * comment) calls the DB's own notify_user() directly from a trigger/
 * function that already holds the row lock it needs. Both paths write the
 * exact same `notifications` row shape; this is the TS-side entry point for
 * everywhere else (the webhook route, refund admin action, sendMessage()).
 *
 * Always writes the in-app record — never conditional on any preference,
 * per the task's own "store an in-app notification record" requirement.
 * Email is the preference-aware half: transactional categories (payments,
 * disputes_refunds — see src/lib/notifications.ts) always get one;
 * optional categories check notification_preferences first, defaulting to
 * enabled when no row exists.
 *
 * SECURITY / PRIVACY: `title`/`body` here are shown to the recipient both
 * in-app AND (for whichever categories send email) in a real email to
 * their inbox. Never pass a card number, IBAN, full postal address, or any
 * other payment/personal detail through either — same discipline
 * validate_message_content() (0049) already enforces for messages, just
 * without a DB trigger to catch it here since these strings are always
 * built server-side from safe fields (order id, listing title, euro
 * amounts, dates) by this file's own callers, never from raw user input.
 * `href` should always be a same-origin, authenticated app route (e.g.
 * `/dashboard/orders/123`) — never a query string carrying anything
 * sensitive (see the app-wide "never place personal data in URL
 * parameters" rule).
 */
export async function notifyUser(
  admin: SupabaseClient,
  input: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    href: string;
    data?: Record<string, unknown>;
    dedupeKey?: string;
    /** Overrides `body` for the EMAIL only — use this whenever `body` would
     * otherwise carry other-user-authored free text (e.g. a message
     * preview). The in-app notification can safely show a snippet since
     * it's already behind the recipient's own authenticated session; an
     * email travels over a channel this app doesn't control (can be
     * forwarded, stored on a third-party mail server, etc), so it gets a
     * generic, content-free version instead — see this file's own
     * "never include sensitive personal/payment details in email"
     * discipline. */
    emailBody?: string;
  }
): Promise<void> {
  const data = { ...(input.data ?? {}), href: input.href };

  // Best-effort in every sense — a notification failing to write must never
  // fail the purchase/message/refund it's describing. Same discipline as
  // every other post-write side effect in this app (broadcasts, the
  // conversation<->order link).
  const { error: insertError } = await admin.rpc("notify_user", {
    p_user_id: input.userId,
    p_type: input.type,
    p_title: input.title,
    p_body: input.body,
    p_data: data,
    p_dedupe_key: input.dedupeKey ?? null,
  });
  if (insertError) {
    console.error(`[notifications] Failed to write notification (${input.type}) for ${input.userId}:`, insertError.message);
  }

  await maybeSendEmail(admin, input);
}

async function maybeSendEmail(
  admin: SupabaseClient,
  input: { userId: string; type: NotificationType; title: string; body: string; href: string; emailBody?: string }
): Promise<void> {
  const category = categoryForType(input.type);
  if (category === null) return;

  if (isOptionalCategory(category)) {
    const { data: pref } = await admin
      .from("notification_preferences")
      .select("email_enabled")
      .eq("user_id", input.userId)
      .eq("category", category)
      .maybeSingle<{ email_enabled: boolean }>();
    // No stored row means default-enabled — silence isn't opt-out (see
    // src/lib/notifications.ts's shouldSendEmail(), which this mirrors).
    if (pref && pref.email_enabled === false) return;
  }

  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(input.userId);
  if (authError || !authUser?.user?.email) return;

  const href = `${getSiteUrl()}${input.href}`;
  const emailBody = input.emailBody ?? input.body;
  await sendEmail({
    to: authUser.user.email,
    subject: input.title,
    text: `${emailBody}\n\n${href}`,
    html: renderEmailHtml({
      title: input.title,
      bodyLines: [emailBody],
      ctaLabel: "View on Pinpals",
      ctaHref: href,
    }),
  });
}
