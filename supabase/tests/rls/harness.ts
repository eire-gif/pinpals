// Shared connection pool + per-identity transactional harness for the RLS
// test suite. Deliberately built on plain `pg` rather than @supabase/
// supabase-js/PostgREST: these tests need to freely flip `SET LOCAL ROLE` and
// `request.jwt.claim.sub` at the raw SQL/connection level to simulate six
// different identities, which PostgREST doesn't expose a way to do.
import { Pool, type PoolClient } from "pg";

export type TestRole = "anon" | "authenticated" | "service_role";

// Connects as the Postgres superuser (never a real credential — see
// replay-migrations.sh; this is a throwaway local/CI database only) so
// fixture seeding and ground-truth assertions can bypass RLS the same way
// `postgres`/`service_role` do on the real project. Every actual policy
// check in a test happens only after `withRole()` has switched the
// connection's role for that one transaction — see below.
const connectionString =
  process.env.RLS_TEST_DATABASE_URL ??
  `postgresql://${process.env.PGUSER ?? "postgres"}:${process.env.PGPASSWORD ?? "postgres"}@${
    process.env.PGHOST ?? "localhost"
  }:${process.env.PGPORT ?? "5432"}/${process.env.RLS_TEST_DB ?? "pinpals_rls_test"}`;

export const pool = new Pool({ connectionString, max: 5 });

export async function closePool() {
  await pool.end();
}

/**
 * Runs `fn` inside a transaction impersonating `role` (and, for
 * "authenticated", a specific user via the same `request.jwt.claim.sub` GUC
 * PostgREST sets from a real JWT — see setup-local-db-part1.sql's auth.uid()).
 * The transaction is ALWAYS rolled back afterwards, success or failure, so an
 * INSERT/UPDATE/DELETE test never has to reseed or clean up after itself —
 * the one global fixture seed (see global-setup.ts) stays valid for the
 * entire run.
 *
 * `SET LOCAL ROLE` (transaction-scoped, auto-reverts at transaction end) is
 * used rather than plain `SET ROLE` specifically so this composes with the
 * always-rollback pattern above without any manual role reset.
 */
export async function withRole<T>(
  role: TestRole,
  userId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    await client.query(`set local role ${role}`);
    return await fn(client);
  } finally {
    try {
      await client.query("rollback");
    } catch {
      // Connection may already be aborted by a failed statement inside fn —
      // rollback still clears the aborted-transaction state either way.
    }
    client.release();
  }
}

/**
 * Re-points `request.jwt.claim.sub` to a different user id within an
 * already-open `withRole("authenticated", ...)` transaction — useful for a
 * scenario that legitimately spans two authenticated users on one connection
 * (e.g. seller creates an auction, then a different buyer bids on it) without
 * either committing partway through or opening a second connection that
 * can't see the first one's uncommitted work.
 */
export async function setIdentity(client: PoolClient, userId: string): Promise<void> {
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
}

/**
 * Asserts that `promise` rejects. This is the right shape for the two cases
 * where a denied operation actually throws: an INSERT whose row fails a
 * `WITH CHECK` clause (Postgres raises "new row violates row-level security
 * policy"), and any write a BEFORE trigger explicitly `raise exception`s
 * (e.g. an invalid listing status transition). It is the WRONG shape for a
 * SELECT/UPDATE/DELETE blocked purely by a `USING` clause with no trigger
 * involved — Postgres silently matches zero rows there instead of raising;
 * use `expectZeroRows` for that case.
 */
export async function expectRejected(promise: Promise<unknown>, messagePattern?: RegExp): Promise<void> {
  let threw = false;
  try {
    await promise;
  } catch (err) {
    threw = true;
    if (messagePattern) {
      const message = err instanceof Error ? err.message : String(err);
      if (!messagePattern.test(message)) {
        throw new Error(`Rejected as expected, but message "${message}" did not match ${messagePattern}`);
      }
    }
  }
  if (!threw) {
    throw new Error("Expected the query to be rejected (denied by RLS or a trigger), but it succeeded.");
  }
}

/**
 * Asserts a query matched zero rows — the correct shape for a SELECT/UPDATE/
 * DELETE that RLS's `USING` clause silently filters out (as opposed to an
 * INSERT/trigger rejection, which throws — see `expectRejected`). A `pg`
 * `QueryResult` reports this as `rowCount === 0`, not an error.
 */
export function expectZeroRows(result: { rowCount: number | null }): void {
  if (result.rowCount !== 0) {
    throw new Error(`Expected zero rows (denied by RLS), but got rowCount=${result.rowCount}.`);
  }
}
