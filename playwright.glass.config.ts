import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/glass",
  outputDir: "test-results/glass/artifacts",
  workers: 1,
  timeout: 180000,
  expect: { timeout: 10000 },
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/glass/results.json" }],
  ],
  use: {
    actionTimeout: 10000,
    baseURL: "http://127.0.0.1:8180",
    viewport: { width: 1672, height: 941 },
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
});
