import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["server/**/*.test.ts", "src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["server/**/*.ts", "src/utils/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
    },
  },
});
