import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    coverage: {
      exclude: ["src/domain/models.ts", "src/**/*.test.ts"],
      include: ["src/domain/**/*.ts"],
      provider: "v8",
      reporter: ["text", "html"],
    },
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
