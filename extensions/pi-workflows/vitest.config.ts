import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "pi-workflows",
    include: ["src/__tests__/**/*.test.ts"],
  },
});
