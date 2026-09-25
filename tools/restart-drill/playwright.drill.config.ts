import { defineConfig, devices } from "@playwright/test";

/**
 * The browser half of the story 6.03d restart drill: the real frontend, run by
 * `next dev` from a frontend checkout, against the drill's local backend on a
 * real Postgres. Local only — it restarts a backend process, which the deployed
 * suite cannot do. See README.md beside this file.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "browser.spec.ts",
  timeout: 600_000,
  // The first receipt read on a freshly started backend has taken over a minute locally.
  expect: { timeout: 180_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: `${process.env.DRILL_LOGS ?? "logs"}/browser-results`,
  use: {
    baseURL: "http://127.0.0.1:3100",
    ...devices["Desktop Chrome"],
    ...(process.env.DRILL_CHROMIUM ? { launchOptions: { executablePath: process.env.DRILL_CHROMIUM } } : {}),
  },
  webServer: {
    command: "npx next dev -p 3100 -H 127.0.0.1",
    cwd: process.env.DRILL_FRONTEND,
    url: "http://127.0.0.1:3100/app/trace",
    // The trace page's first compile has taken close to two minutes on a laptop.
    timeout: 600_000,
    reuseExistingServer: true,
    env: { NEXT_PUBLIC_API_BASE: "http://127.0.0.1:8765", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
