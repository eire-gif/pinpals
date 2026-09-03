import "server-only";
import Stripe from "stripe";

// Server-only Stripe SDK singleton. The `server-only` import turns an
// accidental import from a Client Component into a build failure, same
// discipline as src/lib/supabase/admin.ts.
//
// No `apiVersion` is pinned here — the installed `stripe` package (see
// package.json) bundles its own current default API version and sends it
// automatically. Hardcoding a version string here would mean guessing one
// from memory, which is exactly what this phase's task said not to do;
// upgrading the `stripe` dependency is how this app moves to a newer API
// version, deliberately, not a string edited in this file.
//
// Requires STRIPE_SECRET_KEY to be set as a server-only environment variable
// (Vercel: mark it "sensitive", never prefix it NEXT_PUBLIC_). Never a
// publishable key, and never sent to the browser — every Stripe call in
// this app is server-side (Server Actions, Route Handlers), matching the
// hosted-onboarding design (no Stripe.js, no client-side Stripe calls).
let cachedClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (cachedClient) return cachedClient;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Stripe Connect features cannot run without it."
    );
  }

  cachedClient = new Stripe(secretKey);
  return cachedClient;
}
