import { defineConfig } from "vitest/config"

// Separate from vite.config.ts so tests don't run the GUI bundle plugin.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
})
