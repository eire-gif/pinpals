import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

/**
 * A Supabase client acting as the member who sent a bearer token.
 *
 * The website authenticates from cookies (server.ts). The iOS app has no
 * cookies — it holds an access token in the iOS Keychain and sends it as
 * `Authorization: Bearer …`. This builds a client that carries that token, so
 * `auth.uid()` inside Postgres is the member, and every RLS policy and
 * SECURITY DEFINER function behaves exactly as it does for the website.
 *
 * THE ANON KEY, NEVER THE SERVICE ROLE KEY. That is the whole point. With the
 * anon key plus a member's token, the database remains the thing deciding who
 * may do what — the API route adds a notification, not an authorisation
 * decision. Reach for createAdminClient() here and every policy in 0065,
 * 0066, 0074 and 0078 would have to be re-implemented in TypeScript and kept
 * in step with the SQL forever, which is precisely the drift this design
 * exists to avoid.
 *
 * `persistSession: false` is not optional in a server handler: a client that
 * wrote a session to shared storage would leak one member's session into
 * another member's request.
 */
export function createBearerClient(accessToken: string) {
  return createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
