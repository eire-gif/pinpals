// Resolves the absolute site URL to use in links that leave the app and need
// to come back (Stripe Account Links' refresh_url/return_url, same category
// of problem as the Supabase email redirect URLs in src/app/signup/actions.ts
// and src/app/forgot-password/actions.ts). Not wired into those two yet —
// they predate this helper and are out of scope for this phase — but any
// new caller should use this rather than repeating the fallback chain a
// third time.
//
// Order of preference: an explicit override, then Vercel's own
// production-domain env var (always set on Vercel, no manual config needed),
// then the same var for a preview deployment, then localhost for local dev.
export function getSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000")
  );
}
