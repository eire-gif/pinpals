/**
 * A group invite link opened on the website before signing in
 * (/join/g/<code>) is kept in this cookie and finished on the first
 * signed-in request (src/lib/supabase/middleware.ts), the same way a
 * member's own invite link is (find-pinpals.ts, INVITE_COOKIE).
 */
export const GROUP_INVITE_COOKIE = "pp_group_invite";
