import { defineConfig } from "@playwright/test";
import integration from "./playwright.integration.config";

export default defineConfig({
  ...integration,
  testDir: "./tests/e2e/backup",
  outputDir: "../tmp/playwright/videos/backup-restore",
  timeout: 90000,
  // Each run destroys its own source schema, so this test runs once and checks
  // all three viewport sizes against the same restored archive.
  projects: [
    {
      name: "archive-restore",
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    ...integration.webServer,
    command: "ARCHIVE_RESTORE=1 node ../scripts/start-integration.mjs",
    url: "http://127.0.0.1:3200/login",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
