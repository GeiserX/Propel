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
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/lib/**", "src/scrapers/**", "src/middleware.ts", "src/app/api/**"],
      exclude: ["src/generated/**", "src/**/*.test.ts", "src/scrapers/cli.ts", "src/lib/currency.tsx", "src/lib/i18n.tsx", "src/lib/theme.tsx"],
    },
  },
});
