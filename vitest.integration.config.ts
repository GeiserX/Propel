import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    // Spinning up a PostGIS Testcontainer is slow; allow generous timeouts.
    hookTimeout: 180000,
    testTimeout: 60000,
    // Run all integration suites serially in a single forked process so a
    // single container can be shared without port/resource contention.
    // (Vitest 4 removed `poolOptions.forks.singleFork`; the equivalent is
    // `pool: "forks"` + a single worker + no file-level parallelism.)
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
  },
});
