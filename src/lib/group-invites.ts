/**
 * A group invite link opened on the website before signing in
 * (/join/g/<code>) is kept in this cookie and finished on the first
 * signed-in request (src/lib/supabase/middleware.ts), the same way a
 * member's own invite link is (find-pinpals.ts, INVITE_COOKIE).
 */
export const GROUP_INVITE_COOKIE = "pp_group_invite";

/**
 * A society's emailed invitation (0170): /join/s/<token>, 64 hex
 * characters. Opened signed out, the token waits in this cookie and is
 * claimed on the first signed-in request — so it works even when the member
 * signs up with a different email from the one it was sent to.
 */
export const EMAIL_INVITE_COOKIE = "pp_email_invite";
export const emailInvitePath = (token: string) => `/join/s/${token}`;
export const isEmailInviteToken = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
