import { defineConfig, devices } from "@playwright/test";

/**
 * The story 6.03f drill in the browser: every state of the dispute receipt seeded by seed.py,
 * read on the real trace page. Playwright starts `serve.py` (the backend on the 6.03e drill's
 * ledger) and `next dev` from a frontend checkout pointed at it. Local only; see README.md.
 */
const python = process.env.DRILL_PYTHON ?? "python";

export default defineConfig({
  testDir: ".",
  testMatch: "browser.spec.ts",
  // A laptop's first compile of the trace page takes minutes; testnet answers take seconds.
  timeout: 600_000,
  expect: { timeout: 120_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: `${process.env.DRILL_STATE ?? "."}/logs/ui-results`,
  use: { baseURL: "http://127.0.0.1:3100" },
  projects: [
    // Each seeded state is read once: the live and gap states can only be changed once per seed.
    { name: "desktop", grepInvert: /@phone/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "phone",
      grep: /@phone/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: [
    {
      command: `"${python}" serve.py`,
      url: "http://127.0.0.1:8766/health",
      timeout: 600_000,
      reuseExistingServer: true,
    },
    {
      command: "npx next dev -p 3100 -H 127.0.0.1",
      cwd: process.env.DRILL_FRONTEND,
      url: "http://127.0.0.1:3100/app/trace",
      timeout: 600_000,
      reuseExistingServer: true,
      env: { NEXT_PUBLIC_API_BASE: "http://127.0.0.1:8766", NEXT_TELEMETRY_DISABLED: "1" },
    },
  ],
});
