import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // tools/ is in here so tools/backfill-avatar-exif.test.ts runs in CI with
    // everything else. That script deletes Storage objects for a living, and
    // the helper deciding which ones is worth a regression test even though
    // the script itself is a one-off.
    include: ["src/**/*.test.ts", "tools/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // See test/server-only-mock.ts for why this alias exists.
      "server-only": path.resolve(__dirname, "./test/server-only-mock.ts"),
    },
  },
});
