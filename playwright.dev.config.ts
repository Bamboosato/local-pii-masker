import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-dev",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: "output/playwright/dev-test-results",
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "dev-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4174",
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:4174",
  },
});
