/**
 * Links to posts, in and out of the app — the one place they're built and
 * read (Oct 2026 feed redesign, phase 6). No React, so it's tested in
 * vitest (share-links.test.ts).
 *
 *   https://www.pinpals.ie/feed/<id>   a post, for members (in-app sharing)
 *   https://www.pinpals.ie/s/<token>   a public share link with a card
 *                                      (made by the website; see
 *                                      src/lib/share-links.ts there)
 *
 * Both are universal links (the website's apple-app-site-association claims
 * /feed/* and /s/*), and +native-intent.tsx turns either into the app's own
 * post screen with routeForLink() below. The app reads a share token's
 * payload only to find the post id; it can't and doesn't check the
 * signature — the post screen's RLS decides what the member may see, as
 * everywhere else.
 */

/** The member-facing web address of a post. */
export const postWebPath = (postId: number) => `/feed/${postId}`;
export const postWebUrl = (siteUrl: string, postId: number) => `${siteUrl.replace(/\/$/, "")}${postWebPath(postId)}`;

/** The post id inside a share token, without verifying it. */
export function postIdFromShareToken(token: string): number | null {
  const payload = token.split(".")[0];
  if (!payload || payload.length > 200) return null;
  try {
    const json = decodeBase64Url(payload);
    const data = JSON.parse(json) as { p?: unknown; v?: unknown };
    return data.v === 1 && typeof data.p === "number" && Number.isInteger(data.p) && data.p > 0 ? data.p : null;
  } catch {
    return null;
  }
}

/** The scorecard id inside a scorecard share token (/c/<token>, 0110),
 *  without verifying it — the scorecard screen's RLS decides, and falls back
 *  to the public page (which does verify) when the card isn't visible. */
export function scorecardIdFromShareToken(token: string): number | null {
  const payload = token.split(".")[0];
  if (!payload || payload.length > 200) return null;
  try {
    const data = JSON.parse(decodeBase64Url(payload)) as { c?: unknown; v?: unknown };
    return data.v === 1 && typeof data.c === "number" && Number.isInteger(data.c) && data.c > 0 ? data.c : null;
  } catch {
    return null;
  }
}

/** Where in the app a pinpals.ie path should open, or null to leave it alone. */
export function routeForLink(path: string): string | null {
  const clean = path.replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0];
  const post = /^\/feed\/(\d+)\/?$/.exec(clean);
  if (post) return `/post/${post[1]}`;
  const shared = /^\/s\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\/?$/.exec(clean);
  if (shared) {
    const id = postIdFromShareToken(shared[1]);
    return id ? `/post/${id}` : "/feed";
  }
  return null;
}

/**
 * The post ids linked in a message — "/feed/123" or a share link, on any
 * PinPals host — in order, once each. What a conversation uses to draw a
 * shared post as a card under the message.
 */
export function postIdsInText(text: string): number[] {
  const ids: number[] = [];
  const re = /https?:\/\/(?:www\.)?pinpals\.ie\/(?:feed\/(\d+)|s\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+))/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const id = m[1] ? Number(m[1]) : postIdFromShareToken(m[2]);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// Hermes has atob on recent builds; this keeps the helper independent of it
// (and of Buffer, which React Native doesn't have).
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function decodeBase64Url(input: string): string {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of input.replace(/=+$/, "")) {
    const n = ALPHABET.indexOf(ch === "+" ? "-" : ch === "/" ? "_" : ch);
    if (n < 0) throw new Error("bad base64");
    value = (value << 6) | n;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  // UTF-8 decode (the payload is ASCII JSON in practice).
  return decodeURIComponent(bytes.map((b) => `%${b.toString(16).padStart(2, "0")}`).join(""));
}
