import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "pi-memory",
    include: ["test/**/*.test.ts"],
  },
});
