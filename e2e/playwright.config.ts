import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 4600);

export default defineConfig({
  testDir: ".",
  // One app, one database: tests run in order and build on each other's state as little as possible
  workers: 1,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${port}`,
    // Locally the installed Chrome; CI installs Playwright's Chromium
    channel: process.env.CI ? undefined : "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node e2e/start.mjs",
    cwd: "..",
    url: `http://localhost:${port}/trpc/health`,
    timeout: 60_000,
    reuseExistingServer: false,
  },
});
