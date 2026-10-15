import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e/integration",
  outputDir: "../tmp/playwright/videos/integration",
  workers: 1,
  reporter: "list",
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:3200",
    browserName: "chromium",
    video: "on",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile",
      testIgnore: "**/recovery.spec.ts",
      use: { viewport: { width: 375, height: 812 } },
    },
    {
      name: "tablet",
      testIgnore: "**/recovery.spec.ts",
      use: { viewport: { width: 768, height: 1024 } },
    },
    {
      name: "desktop",
      testIgnore: "**/recovery.spec.ts",
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "recovery",
      testMatch: "**/recovery.spec.ts",
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: "node ../scripts/start-integration.mjs",
    url: "http://127.0.0.1:3200/login",
    reuseExistingServer: false,
    timeout: 120000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15000 },
  },
});
