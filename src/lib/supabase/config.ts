// Public Supabase project config. The anon key is safe to ship in the client
// bundle by design — row-level security policies are what actually protect
// the data, not secrecy of this key. Falling back to the live project's
// values means the app works immediately on a fresh Vercel deploy with zero
// manual environment-variable setup; set the env vars in Vercel to override
// (e.g. if you ever point this codebase at a different Supabase project).
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://cicluiabimxklgmpmxmn.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpY2x1aWFiaW14a2xnbXBteG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwOTc0MTIsImV4cCI6MjEwMzY3MzQxMn0.MIjjOvYxcJpTL3qmHcyJl51if-wm0zKQndplXjKHrA0";
