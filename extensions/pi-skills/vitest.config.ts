import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "pi-skills",
    include: ["test/**/*.test.ts"],
  },
});
