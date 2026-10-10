/**
 * Find PinPals (0118): the invite link and the guest scorecard link.
 *
 * A member's link is /join/<code>; their QR code encodes the same URL, so
 * the iPhone's own camera opens it — in the app when it's installed
 * (universal link), on the website otherwise.
 *
 * Somebody who opens either link before they have an account gets a cookie
 * that outlives sign-up and email confirmation; the first request after they
 * are signed in finishes the job (src/lib/supabase/middleware.ts).
 */
export const INVITE_COOKIE = "pp_invite";
export const GUEST_COOKIE = "pp_guest";
export const PENDING_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export const isInviteCode = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9]{8}$/.test(value.toLowerCase());

export const isGuestToken = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9]{24}$/.test(value.toLowerCase());

export const invitePath = (code: string) => `/join/${code}`;
export const guestPath = (token: string) => `/guest/${token}`;
