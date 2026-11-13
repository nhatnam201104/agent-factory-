import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 45000,
  fullyParallel: false,
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 }
  }
});
