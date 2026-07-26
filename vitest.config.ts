import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["local-orchestrator/tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/BuildingBlocks/**"],
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
});
