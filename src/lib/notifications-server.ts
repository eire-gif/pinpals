import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSiteUrl } from "./site-url";
import { sendEmail, renderEmailHtml } from "./email";
import {
  categoryForType,
  isOptionalCategory,
  shouldSendEmail,
  shouldSendPush,
  type NotificationType,
} from "./notifications";
import { buildPushPayload } from "./push";
import { sendPushToUser } from "./push-server";

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
 * Email and push are the preference-aware half: transactional categories
 * (payments, disputes_refunds — see src/lib/notifications.ts) always get
 * both; optional categories check notification_preferences first,
 * defaulting to enabled when no row exists.
 *
 * SECURITY / PRIVACY: `title`/`body` here are shown to the recipient
 * in-app, in a real email to their inbox, AND — since 0075 — on their
 * device's lock screen, which is the most exposed of the three: it is
 * readable by anyone standing near the phone, without unlocking it. Never
 * pass a card number, IBAN, full postal address, or any other
 * payment/personal detail through any of them — same discipline
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
    /** Same idea for the lock screen, and defaulting to `emailBody` when
     * that is set. A lock screen is MORE exposed than an inbox, not less,
     * so a body deemed too revealing to email is automatically too
     * revealing to push. Set this explicitly only when push needs wording
     * that differs from both of the others. */
    pushBody?: string;
  }
): Promise<void> {
  const data = { ...(input.data ?? {}), href: input.href };

  // Best-effort in every sense — a notification failing to write must never
  // fail the purchase/message/refund it's describing. Same discipline as
  // every other post-write side effect in this app (broadcasts, the
  // conversation<->order link).
  const { data: notificationId, error: insertError } = await admin.rpc("notify_user", {
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

  // Since 0075, notify_user() returns the inserted id — or null when the
  // partial unique index on (user_id, dedupe_key) suppressed the insert as
  // a duplicate. A duplicate must not be delivered on ANY channel: the
  // member already has this notification, and re-sending it is how a
  // retried webhook turns into a second email, or a second buzz on a phone
  // with nothing new behind it.
  //
  // Note the `!insertError` guard. An RPC *error* is a different case: the
  // in-app write failed for some unrelated reason, and silently swallowing
  // the outbound notification too would turn one transient fault into a
  // member never hearing about their payment. That path still delivers,
  // exactly as it did before this change.
  if (!insertError && notificationId === null) return;

  const category = categoryForType(input.type);
  if (category === null) return;

  // One read, both channels. Worth being deliberate about: this runs once
  // per RECIPIENT inside notifyConnectionsOfInvite()'s fan-out, so a second
  // query here would be a second query per member, up to FANOUT_LIMIT.
  let emailEnabled: boolean | null = null;
  let pushEnabled: boolean | null = null;

  if (isOptionalCategory(category)) {
    const { data: pref } = await admin
      .from("notification_preferences")
      .select("email_enabled, push_enabled")
      .eq("user_id", input.userId)
      .eq("category", category)
      .maybeSingle<{ email_enabled: boolean; push_enabled: boolean }>();
    // No stored row means default-enabled — silence isn't opt-out (see
    // shouldSendEmail()/shouldSendPush() in src/lib/notifications.ts, whose
    // `?? true` this feeds).
    emailEnabled = pref?.email_enabled ?? null;
    pushEnabled = pref?.push_enabled ?? null;
  }

  // allSettled, not all: a push service being down must not stop the email,
  // and vice versa. Both helpers already swallow their own failures; this
  // is belt and braces on a path that must never throw into its caller.
  await Promise.allSettled([
    shouldSendEmail(input.type, emailEnabled) ? deliverEmail(admin, input) : Promise.resolve(),
    shouldSendPush(input.type, pushEnabled) ? deliverPush(admin, input) : Promise.resolve(),
  ]);
}

async function deliverEmail(
  admin: SupabaseClient,
  input: { userId: string; type: NotificationType; title: string; body: string; href: string; emailBody?: string }
): Promise<void> {
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

async function deliverPush(
  admin: SupabaseClient,
  input: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    href: string;
    dedupeKey?: string;
    emailBody?: string;
    pushBody?: string;
  }
): Promise<void> {
  // pushBody -> emailBody -> body. The middle step is the important one: a
  // body that was considered too revealing to put in an email is, by that
  // same judgement, too revealing to put on a lock screen — so the safe
  // wording is inherited automatically rather than every future call site
  // having to remember a second override.
  const body = input.pushBody ?? input.emailBody ?? input.body;

  // Unlike the email path, `href` stays route-relative: the service worker
  // resolves it against the PWA's own origin when the member taps.
  await sendPushToUser(
    admin,
    input.userId,
    buildPushPayload({
      type: input.type,
      title: input.title,
      body,
      href: input.href,
      dedupeKey: input.dedupeKey ?? null,
    })
  );
}
