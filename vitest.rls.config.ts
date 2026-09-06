import { defineConfig } from "vitest/config";

// Separate from the main vitest.config.ts on purpose: these tests need a live
// Postgres connection (see supabase/tests/rls/replay-migrations.sh) that
// nothing else in the project's default `npm test` / CI `Validate` workflow
// currently provides, so they must never be picked up by the default config's
// `src/**/*.test.ts` glob.
export default defineConfig({
  test: {
    environment: "node",
    include: ["supabase/tests/rls/**/*.test.ts"],
    globalSetup: ["supabase/tests/rls/global-setup.ts"],
    // The whole suite shares one seeded fixture dataset (see global-setup.ts)
    // and every test mutates it only inside a transaction it then rolls back
    // (see harness.ts's withRole()) — but that safety only holds if no two
    // test files can run against the shared connection pool at the same time.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
