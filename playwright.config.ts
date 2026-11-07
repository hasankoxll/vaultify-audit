import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:8787",
    channel: "chrome",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: {
    command: "rm -rf data/e2e && npm run start",
    url: "http://127.0.0.1:8787/api/health",
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      VA_DATA_DIR: "data/e2e",
      VA_HOST: "127.0.0.1",
      VA_PORT: "8787",
      VA_ENABLE_DEMO: "true",
      VA_COOKIE_SECURE: "false",
    },
  },
});
