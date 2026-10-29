import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const outputRoot =
  process.env.REVIEW_EVIDENCE_DIR || "test-results/remediation";
const systemChromium = "/usr/bin/chromium";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync(systemChromium) ? systemChromium : undefined);

export default defineConfig({
  testDir: "./tests/remediation",
  testMatch: "*.spec.ts",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: `${outputRoot}/artifacts`,
  reporter: [
    ["list"],
    ["json", { outputFile: `${outputRoot}/browser-results.json` }],
  ],
  use: {
    baseURL: process.env.ODIN_REMEDIATION_URL || "http://127.0.0.1:8180",
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath, args: ["--no-sandbox"] },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
