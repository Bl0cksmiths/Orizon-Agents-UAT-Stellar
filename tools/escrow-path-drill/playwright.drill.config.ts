import { defineConfig, devices } from "@playwright/test";

/**
 * Story 6.07's escrow path drill: real paid workflows through escrow v2 on the
 * deployed dApp, signed by the drill's own buyer key and checked on testnet.
 * It spends testnet XLM, so it runs by hand under the run lock, never in the
 * default suite. See README.md beside this file.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "escrow-path.spec.ts",
  // A hung step alone holds the run for the backend's 100 s dispatch deadline,
  // then settle, seal and two ratings each wait on the ledger.
  timeout: 900_000,
  // A cold Render backend has taken 90 s to answer its first call.
  expect: { timeout: 120_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  // Traces hold the task's read token, so they stay out of the repo: in the
  // state directory when one is set, in the ignored test-results/ otherwise.
  outputDir: process.env.ESCROW_DRILL_STATE ? `${process.env.ESCROW_DRILL_STATE}/escrow-path-results` : "../../test-results/escrow-path",
  use: {
    baseURL: process.env.ESCROW_DRILL_BASE_URL ?? "https://orizons.xyz",
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
});
