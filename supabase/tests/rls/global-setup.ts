// Vitest `globalSetup` entry point (see vitest.rls.config.ts) — runs exactly
// once before any RLS test file, in its own process, truncating and
// reseeding the fixture dataset so every test file in the run shares one
// consistent, known-good starting point. Combined with `fileParallelism:
// false` in the config, this means no test file can ever race another over
// the shared fixture rows.
//
// This assumes supabase/tests/rls/replay-migrations.sh has already been run
// against the target database (see the "test:rls" npm script) — this file
// only seeds data, it does not apply migrations.
import { Client } from "pg";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { seed, truncateAll } from "./fixtures";

const FIXTURE_IDS_PATH = path.join(__dirname, ".fixture-ids.json");

export default async function globalSetup() {
  const connectionString =
    process.env.RLS_TEST_DATABASE_URL ??
    `postgresql://${process.env.PGUSER ?? "postgres"}:${process.env.PGPASSWORD ?? "postgres"}@${
      process.env.PGHOST ?? "localhost"
    }:${process.env.PGPORT ?? "5432"}/${process.env.RLS_TEST_DB ?? "pinpals_rls_test"}`;

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await truncateAll(client);
    const ids = await seed(client);
    // globalSetup runs in a separate process from the test files themselves,
    // so fixture ids captured via RETURNING here have to cross that boundary
    // through disk rather than a shared module-level variable.
    writeFileSync(FIXTURE_IDS_PATH, JSON.stringify(ids, null, 2));
  } finally {
    await client.end();
  }

  return async () => {
    // No teardown needed: the seeded rows are left in place intentionally
    // (harmless local/CI-only data) so a developer can inspect them after a
    // test run with a plain psql session.
  };
}
