import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "**/integration/**",
  outputDir: "../tmp/playwright/videos",
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    video: "on",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile", use: { viewport: { width: 375, height: 812 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 } } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: "npm run dev -- --port 3100",
    // Mock tests must never reach the running development API.
    env: { API_ORIGIN: "http://127.0.0.1:18081" },
    url: "http://127.0.0.1:3100/register",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
