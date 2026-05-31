import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["extensions/*/vitest.config.ts"],
  },
});
