/**
 * Shared limits for member profile photos. Plain constants in their own
 * module (no "use server", no Supabase) so both the server action that
 * enforces them and the client form that hints at them can import the same
 * numbers — the same split MAX_LISTING_IMAGES/MAX_IMAGE_SIZE_BYTES already
 * use in src/lib/marketplace.ts.
 *
 * Both mirror the 'member-avatars' bucket's own configuration
 * (supabase/migrations/0059_member_photos_and_age_bands.sql). The bucket is
 * what's actually trusted — a request that gets past these checks still
 * fails at Storage — but checking here turns "upload rejected" into a
 * readable sentence instead of a raw storage error.
 */

/** 2MB. An avatar renders at 64px; anything larger is wasted bytes on every
 * directory page load. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function avatarExtensionFor(mimeType: string): string {
  return mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
}
