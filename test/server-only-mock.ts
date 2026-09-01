// The real `server-only` package throws unconditionally unless it's bundled
// with Next.js's "react-server" module condition set — which Vitest (plain
// Node) never sets. This no-op stands in for it under test so
// src/lib/admin/authorization.ts and src/lib/supabase/admin.ts can keep the
// real safeguard for the Next.js build/runtime (see vitest.config.ts alias).
export {};
