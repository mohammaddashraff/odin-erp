import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const localBrowser =
  "/srv/demo/qa/browser-cache/browsers/chrome-154.0.8037.57/chrome";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync(localBrowser) ? localBrowser : undefined);
export default defineConfig({
  testDir: "./tests/ui-v2",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/ui-v2/results.json" }],
  ],
  outputDir: "test-results/ui-v2/artifacts",
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // This suite creates and posts transactions. Point it only at an isolated QA
    // frontend/API/database. The deployed demo is deliberately not the default.
    baseURL: process.env.ODIN_UI_QA_URL || "http://127.0.0.1:8184",
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath, args: ["--no-sandbox"] },
    trace: "off",
    screenshot: "only-on-failure",
  },
});
