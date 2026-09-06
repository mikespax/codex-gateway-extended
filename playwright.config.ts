/// <reference types="node" />

import { defineConfig, devices } from "@playwright/test";
import process from "node:process";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    // Continuous DOM snapshots are larger than the application itself and can push Chromium over
    // the E2E runner's 2 GiB cgroup limit. Failure screenshots and Playwright error context remain.
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /.*\.mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      testMatch: /.*\.mobile\.spec\.ts/,
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "mobile-webkit-core-scroll",
      testMatch: /.*\.mobile\.spec\.ts/,
      grep: /virtualizes a large running turn in one agent timeline|mobile touch scrolling stays anchored while Agent output streams|mobile momentum scrolling stays anchored after touchend while output streams/,
      use: { ...devices["iPhone 13"] },
    },
  ],
});
