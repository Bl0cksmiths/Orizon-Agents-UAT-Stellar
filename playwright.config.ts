import { defineConfig, devices } from "@playwright/test";

/**
 * UAT suite for the deployed Orizon Agents stack.
 *
 * This suite runs against a REAL deployment, not a local dev server — there is
 * no `webServer` block on purpose. That makes it a true user-acceptance gate:
 * it exercises the same Vercel edge, the same Next rewrite to the backend, and
 * the same Soroban RPC a visitor hits.
 *
 * Target is overridable so the same suite can gate a preview deployment:
 *   UAT_BASE_URL=https://orizon-agents-fe-stellar-<sha>.vercel.app npm test
 */
const BASE_URL = process.env.UAT_BASE_URL ?? "https://orizons.xyz";

/**
 * The Stellar network this target is EXPECTED to run. Configuration, never a
 * constant: the programme is specified testnet-only while the default target
 * currently reports mainnet (defect D-001), so tests assert against this value
 * and the suite turns green on a flip without a single test edit.
 */
export const EXPECTED_NETWORK = process.env.UAT_EXPECTED_NETWORK ?? "testnet";

/**
 * The backend sleeps on Render's free tier and takes 25-60s to answer its
 * first request. Measured, not guessed: a cold /api/health returned 200 at
 * >25s and <90s. Every timeout below is sized around that single fact —
 * a suite that assumes a warm backend fails on its first run of the day and
 * teaches the team to ignore it.
 */
const COLD_START_MS = 90_000;

export default defineConfig({
  testDir: "./tests",
  /* One assertion should not inherit the whole cold-start budget; specs that
     genuinely wait on the backend opt in explicitly. */
  expect: { timeout: 15_000 },
  timeout: 60_000,
  fullyParallel: true,
  /* A `.only` left in a spec silently shrinks the gate to one test. */
  forbidOnly: !!process.env.CI,
  /* Retries absorb genuine network flake against a live site; locally zero,
     so a flaky test is visible to whoever wrote it rather than masked. */
  retries: process.env.CI ? 2 : 0,
  /* Serial-ish in CI: the target is a shared free-tier deployment and the
     backend rate limiter is a whole-service bucket, so a wide fan-out from CI
     throttles the very site under test. */
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["list"]]
    : [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: BASE_URL,
    navigationTimeout: COLD_START_MS,
    actionTimeout: 15_000,
    /* Artifacts only for failures — a green run should cost no storage. */
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ignoreHTTPSErrors: false,
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "webkit-desktop",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "firefox-desktop",
      use: { ...devices["Desktop Firefox"] },
    },
  ],
});
