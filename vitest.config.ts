import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "./src"),
            // See test/server-only-mock.ts for why this alias exists.
            "server-only": path.resolve(__dirname, "./test/server-only-mock.ts"),
          },
        },
        test: {
          name: "site",
          environment: "node",
          // tools/ is in here so tools/backfill-avatar-exif.test.ts runs in CI
          // with everything else. That script deletes Storage objects for a
          // living, and the helper deciding which ones is worth a regression
          // test even though the script itself is a one-off.
          include: ["src/**/*.test.ts", "tools/**/*.test.ts"],
        },
      },
      {
        // The app has no test runner of its own, and adding one would be a
        // second toolchain to keep current for the sake of a handful of
        // files. So the app modules worth testing are written to be pure —
        // no React, no expo-router, no supabase client — and run here.
        //
        // `tsconfigRaw` is why this needs to be its own project rather than
        // another glob on the one above. esbuild walks up from each file it
        // transforms looking for a tsconfig, finds mobile/tsconfig.json, and
        // tries to resolve its `extends: "expo/tsconfig.base"` — which is in
        // mobile/node_modules, and CI installs only the root's. Handing
        // esbuild an empty config stops it looking. Nothing is lost: these
        // files are deliberately plain TypeScript, and `tsc` in mobile/ is
        // still what typechecks them properly.
        esbuild: { tsconfigRaw: "{}" },
        test: {
          name: "mobile",
          environment: "node",
          include: ["mobile/src/**/*.test.ts"],
        },
      },
    ],
  },
});
