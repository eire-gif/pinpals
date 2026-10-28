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

const PROVIDER_NAME = { apple: "Apple ID", google: "Google account" } as const;

/** What to tell a member when connecting Apple/Google to their account fails. */
export function linkErrorMessage(
  provider: "apple" | "google",
  error: { code?: string; message?: string } | null | undefined,
): string {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  if (code === "identity_already_exists" || message.includes("already linked") || message.includes("already exists")) {
    return `That ${PROVIDER_NAME[provider]} already has its own PinPals account, so it can't be added to this one.`;
  }
  if (code === "manual_linking_disabled" || message.includes("manual linking")) {
    return "Connecting accounts isn't switched on yet. Please try again later.";
  }
  return `Couldn't connect your ${PROVIDER_NAME[provider]}. Please try again.`;
}
