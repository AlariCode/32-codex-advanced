import { defineConfig } from "@playwright/test";
import ui from "./playwright.config";

const baseURL = "http://127.0.0.1:3110";

export default defineConfig({
  ...ui,
  testMatch: "design.dev.spec.ts",
  testIgnore: [],
  outputDir: "../tmp/playwright/videos/design",
  use: { ...ui.use, baseURL },
  webServer: {
    command: "npm run dev -- --port 3110",
    url: `${baseURL}/design`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
