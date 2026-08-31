"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

// Browser-side Supabase client — safe to use in Client Components.
// Reads the public URL + anon key, which are meant to be exposed to the browser
// (row-level security policies are what actually protect the data).
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
