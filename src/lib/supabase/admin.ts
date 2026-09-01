import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";

// Server-only Supabase client authenticated with the SERVICE ROLE key — it
// bypasses RLS entirely. The `server-only` import above turns an accidental
// import from a Client Component into a build failure, so this can never end
// up in a browser bundle.
//
// Not called anywhere yet in this phase (no admin mutations exist yet). It's
// the seam later phases (moderation actions, staff management, payouts) use
// for the specific, audited writes that need to touch another user's data —
// every caller should log to the audit log when that lands, not just this
// file existing.
//
// Requires SUPABASE_SERVICE_ROLE_KEY to be set as a server-only environment
// variable (Vercel: mark it "sensitive", never prefix it NEXT_PUBLIC_).
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. This client must never fall back to the anon key."
    );
  }

  return createSupabaseClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
