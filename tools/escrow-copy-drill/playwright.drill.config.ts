import { defineConfig, devices } from "@playwright/test";

/**
 * EP-05 (story 6.07): the plan card's escrow wording in each of its three
 * cases. The v2 case runs on production; the v1 and mismatch cases run on a
 * local `next dev` of an untouched frontend checkout, with only
 * GET /api/stellar/network intercepted. See README.md beside this file.
 */
const frontend = process.env.DRILL_FRONTEND;

export default defineConfig({
  testDir: ".",
  testMatch: "copy.spec.ts",
  // A cold Render backend (up to 90 s) plus a first `next dev` compile of the orchestrator page.
  timeout: 600_000,
  expect: { timeout: 120_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: `${process.env.DRILL_LOGS ?? "logs"}/escrow-copy-results`,
  use: {
    ...devices["Desktop Chrome"],
    ...(process.env.DRILL_CHROMIUM ? { launchOptions: { executablePath: process.env.DRILL_CHROMIUM } } : {}),
  },
  // Only the local cases need a frontend server; the production part runs without one.
  ...(frontend
    ? {
        webServer: {
          command: "npx next dev -p 3100 -H 127.0.0.1",
          cwd: frontend,
          url: "http://127.0.0.1:3100/app/orchestrator",
          // The orchestrator page's first compile has taken minutes on a loaded laptop.
          timeout: 900_000,
          reuseExistingServer: true,
          env: {
            NEXT_PUBLIC_API_BASE: "https://orizon-agents-be-stellar.onrender.com",
            NEXT_TELEMETRY_DISABLED: "1",
          },
        },
      }
    : {}),
});
