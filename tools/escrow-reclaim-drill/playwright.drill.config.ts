import { defineConfig, devices } from "@playwright/test";

/**
 * EP-04 (story 6.07): an authorization that never ran, reclaimed from the
 * console of the deployed dApp after it expired. Live, on testnet, with real
 * signatures, and over half an hour long because expiry is wall-clock. One
 * worker, serial, never part of the default suite. See README.md beside this file.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "reclaim.spec.ts",
  // Each test sets its own ceiling; the wait for expiry sets the longest.
  timeout: 300_000,
  // Render cold starts have taken up to 90 s.
  expect: { timeout: 120_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  outputDir: `${process.env.RECLAIM_STATE ?? "logs"}/results`,
  use: {
    baseURL: process.env.RECLAIM_BASE_URL ?? "https://orizons.xyz",
    ...devices["Desktop Chrome"],
    trace: "off",
    video: "off",
  },
});
