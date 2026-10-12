import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Database tests (TEST_DATABASE_URL) may run against a remote Postgres such as Supabase: every query is
// a network round trip, and the assessment tests hold table locks in their rolled-back transaction,
// so give them time and run the test files one after another.
const remoteDb = Boolean(process.env.TEST_DATABASE_URL);

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    ...(remoteDb ? { testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false } : {}),
  },
});
