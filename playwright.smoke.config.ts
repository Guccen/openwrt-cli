import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/smoke",
  outputDir: "build/smoke-report/results",
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { outputFolder: "build/smoke-report/html", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "bun tests/preview-server.ts",
      url: "http://127.0.0.1:4174/device.json",
      reuseExistingServer: false,
    },
    {
      command: "bun tests/smoke-server.ts",
      url: "http://127.0.0.1:4173/login/",
      reuseExistingServer: false,
    },
  ],
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } },
    { name: "tablet", use: { browserName: "chromium", viewport: { width: 768, height: 1024 } } },
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
