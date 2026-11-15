import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 45000,
  fullyParallel: false,
  // The office scenarios are frame-timing sensitive; parallel file workers
  // starve the render loop and make pixel/label measurements flaky.
  workers: 1,
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 }
  }
});
