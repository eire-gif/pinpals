// Pure, framework-free domain model for web push — the same "no Supabase, no
// Next.js, trivial to unit test" discipline as src/lib/notifications.ts,
// which this file sits beside rather than inside. The split is deliberate:
// notifications.ts owns the *vocabulary* (which types exist, which category
// governs them, whether a channel is enabled); this file owns the
// *transport* (what a payload looks like on the wire, how long it may be,
// which HTTP status means a device is gone).
//
// Nothing here imports `web-push` or touches the network — see
// src/lib/push-server.ts for that.

/** What the service worker receives, JSON-encoded, in the push event.
 * Kept flat and small on purpose — see PUSH_PAYLOAD_MAX_BYTES. `public/sw.js`
 * reads exactly these keys; changing one means changing both. */
export type PushPayload = {
  title: string;
  body: string;
  href: string;
  /** Collapses repeats in the OS tray: a second notification with the same
   * tag REPLACES the first rather than stacking beside it. */
  tag: string;
  type: string;
};

/** The Web Push spec guarantees only 4096 bytes for the encrypted record,
 * and the encryption overhead eats into that. 3000 is a conservative
 * ceiling for the plaintext JSON — well clear of the limit, and far larger
 * than any notification this app actually produces. */
export const PUSH_PAYLOAD_MAX_BYTES = 3000;

/** A push service returns one of these when the subscription is permanently
 * gone — the member cleared site data, uninstalled the PWA, or the browser
 * expired it. This is the ONLY supported cleanup signal in web push; there
 * is no "unsubscribe" callback. Delete the row on sight. */
export const DEAD_SUBSCRIPTION_STATUSES = [404, 410] as const;

/** Transient failures (500s, timeouts, rate limits) increment a counter
 * instead. A subscription that has failed this many times in a row is
 * treated as dead too — otherwise a permanently broken endpoint is retried
 * on every single notification, forever. */
export const MAX_PUSH_FAILURES = 5;

/** Lock-screen real estate is small and truncation is done by the OS with no
 * ellipsis on some platforms. Doing it ourselves keeps the cut somewhere
 * sensible. */
export const PUSH_BODY_MAX_CHARS = 140;

export function isDeadSubscriptionStatus(status: number | null | undefined): boolean {
  if (typeof status !== "number") return false;
  return (DEAD_SUBSCRIPTION_STATUSES as readonly number[]).includes(status);
}

/** Truncates on a word boundary where one is close to the limit, so a body
 * ends "…at Portmarnock" rather than "…at Portmarno". */
export function truncateForPush(text: string, max: number = PUSH_BODY_MAX_CHARS): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;

  const hardCut = collapsed.slice(0, max - 1);
  const lastSpace = hardCut.lastIndexOf(" ");
  const body = lastSpace > max * 0.6 ? hardCut.slice(0, lastSpace) : hardCut;
  return `${body.replace(/[.,;:\s]+$/, "")}…`;
}

/**
 * Builds the payload the service worker will render.
 *
 * `tag` falls back to the notification TYPE when there's no dedupe key,
 * which is a deliberate, slightly aggressive choice: two un-keyed
 * notifications of the same type collapse into one in the tray. For the
 * types that reach here without a key that is the behaviour you want — a
 * member who has three unread messages wants one "new message" line on
 * their lock screen, not three. The in-app list still shows all three.
 */
export function buildPushPayload(input: {
  type: string;
  title: string;
  body: string;
  href: string;
  dedupeKey?: string | null;
}): PushPayload {
  return {
    title: truncateForPush(input.title, 80),
    body: truncateForPush(input.body),
    href: input.href.startsWith("/") ? input.href : "/dashboard",
    tag: input.dedupeKey && input.dedupeKey.length > 0 ? input.dedupeKey : input.type,
    type: input.type,
  };
}

/** Byte length of the encoded payload — the thing the 4096-byte limit
 * actually applies to. Multi-byte characters (a euro sign, an accented
 * name) count for more than one, which is why this is not `.length`. */
export function pushPayloadBytes(payload: PushPayload): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

export function isPushPayloadTooLarge(payload: PushPayload): boolean {
  return pushPayloadBytes(payload) > PUSH_PAYLOAD_MAX_BYTES;
}

/** A short, human label for a stored subscription row, for the device list
 * on the settings page. Deliberately crude — this is a hint to help a member
 * recognise which device to remove, not device fingerprinting, and the
 * input is attacker-controlled text that must still be escaped on render. */
export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";
  const ua = userAgent.toLowerCase();

  if (ua.includes("ipad")) return "iPad";
  if (ua.includes("iphone")) return "iPhone";
  if (ua.includes("android")) return ua.includes("mobile") ? "Android phone" : "Android tablet";
  if (ua.includes("mac os") || ua.includes("macintosh")) return "Mac";
  if (ua.includes("windows")) return "Windows PC";
  if (ua.includes("linux")) return "Linux";
  return "Unknown device";
}
