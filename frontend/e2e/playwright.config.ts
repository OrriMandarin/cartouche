import { defineConfig, devices } from "@playwright/test";
import { WEB_URL } from "./env";

const isCI = Boolean(process.env.CI);

// The stack comes from `compose.test.yml` (see `make e2e`): web on 13000, API on 18080.
export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  globalSetup: "./global-setup.ts",
  // One shared database: every test resets and seeds it, so tests cannot run side by side.
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  forbidOnly: isCI,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...devices["iPhone 14"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
});
