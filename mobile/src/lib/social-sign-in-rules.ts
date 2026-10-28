/**
 * The pure parts of Sign in with Apple / Google (lib/social-sign-in.ts),
 * kept free of React Native so vitest can run them.
 */

/** handle_new_user()'s stand-in when a provider sends no name (0193). */
export const isPlaceholderName = (first: string | null | undefined, last: string | null | undefined): boolean =>
  (first ?? "").trim() === "New" && (last ?? "").trim() === "Golfer";

/** Whether this signed-in member joined with Apple or Google (their first sign-in). */
export function joinedWithProvider(user: { app_metadata?: { provider?: string } } | null | undefined): boolean {
  const p = user?.app_metadata?.provider;
  return p === "apple" || p === "google";
}

/** Everything in a redirect URL's query and fragment, fragment winning. */
export function readRedirectParams(url: string): URLSearchParams {
  const out = new URLSearchParams();
  const query = url.split("?")[1]?.split("#")[0] ?? "";
  const hash = url.split("#")[1] ?? "";
  for (const part of [query, hash]) {
    new URLSearchParams(part).forEach((v, k) => out.set(k, v));
  }
  return out;
}
