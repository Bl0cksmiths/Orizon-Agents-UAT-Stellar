import { defineConfig, devices } from "@playwright/test";

/**
 * The browser half of the story 6.03e drill: the marketplace badge and the plan card read
 * against the drill's own ReputationLedger. Playwright starts both servers — `drill.py serve`
 * (the backend on the drill's ledger) and `next dev` from a frontend checkout pointed at it —
 * so the pages show exactly what the drill's upheld disputes did. Local only; see README.md.
 */
const python = process.env.DRILL_PYTHON ?? "python";

export default defineConfig({
  testDir: ".",
  testMatch: "browser.spec.ts",
  // A laptop's first compile of the orchestrator page, and the first ledger reads, take minutes.
  timeout: 600_000,
  expect: { timeout: 180_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: `${process.env.DRILL_STATE ?? "."}/logs/browser-results`,
  use: {
    baseURL: "http://127.0.0.1:3100",
    ...devices["Desktop Chrome"],
    ...(process.env.DRILL_CHROMIUM ? { launchOptions: { executablePath: process.env.DRILL_CHROMIUM } } : {}),
  },
  webServer: [
    {
      command: `"${python}" drill.py serve`,
      url: "http://127.0.0.1:8766/health",
      timeout: 600_000,
      reuseExistingServer: true,
    },
    {
      command: "npx next dev -p 3100 -H 127.0.0.1",
      cwd: process.env.DRILL_FRONTEND,
      url: "http://127.0.0.1:3100/app/agents",
      timeout: 600_000,
      reuseExistingServer: true,
      env: { NEXT_PUBLIC_API_BASE: "http://127.0.0.1:8766", NEXT_TELEMETRY_DISABLED: "1" },
    },
  ],
});
