import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // See test/server-only-mock.ts for why this alias exists.
      "server-only": path.resolve(__dirname, "./test/server-only-mock.ts"),
    },
  },
});
