// Pure: tested in score-queue.test.ts (no React Native here).

/**
 * No connection, as opposed to the database saying no. A refusal from the
 * database always carries a Postgres error code ("P0001", "42501"…); a
 * request that never got there has none (supabase-js reports it with an
 * empty code and "Network request failed").
 */
export function isNetworkError(e: unknown): boolean {
  if (!e) return false;
  const code = (e as { code?: unknown }).code;
  return !(typeof code === "string" && code.length > 0);
}
