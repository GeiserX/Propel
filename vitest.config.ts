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
    // Coverage is root-only in Vitest 4 (cannot live inside a project).
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/lib/**", "src/scrapers/**", "src/middleware.ts", "src/app/api/**", "src/components/**"],
      exclude: [
        "src/generated/**",
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/scrapers/cli.ts",
        "src/lib/currency.tsx",
        "src/lib/i18n.tsx",
        "src/lib/theme.tsx",
      ],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          // Integration tests end in .test.ts but require Docker — keep them
          // out of the fast, offline node project.
          exclude: ["src/**/*.integration.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.tsx"],
        },
      },
    ],
  },
});
