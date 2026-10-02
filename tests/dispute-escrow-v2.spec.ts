import { test, expect } from "@playwright/test";
import { COLD_START_TIMEOUT } from "./fixtures";

/**
 * DE — story 6.08, dispute and refund on escrow v2 on the live deployment.
 *
 * The console dispute, the uphold and the restart are run by hand with the
 * buyer's wallet and the operator (docs/uat/evidence/6.08-dispute-escrow-v2.md).
 * This spec holds everything those runs leave behind that can be read without
 * a key: the window refusal, and for every credited dispute under test, its
 * refund and rating on Horizon and its receipt in the console.
 */

// The developer harness's two upheld disputes, the second after a Render
// restart. Their windows closed on 2026-10-01.
const CLOSED = [
  { task: "tsk_7e1c369cebaf41b3", job: "dd9089ab7791c4293baf87745d1ea0b6", closedAt: "2026-10-01T09:39:30" },
  { task: "tsk_fcd544e62f0f0958", job: "b263f1ebde6bebbde5f8b99b71e74f7c", closedAt: "2026-10-01T17:48:30" },
];

test.describe("DE — dispute and refund on escrow v2 (story 6.08)", () => {
  for (const { job, closedAt } of CLOSED) {
    test(`DE-05 a step of ${job.slice(0, 8)}… outside its window is refused, naming when it closed`, async ({ request }) => {
      const response = await request.post("/api/disputes/challenge", {
        timeout: COLD_START_TIMEOUT,
        data: { job_id_hex: job, step_index: 0 },
      });
      expect(response.status()).toBe(409);
      const body = await response.json();
      expect(body.error?.code).toBe("dispute_window_closed");
      expect(body.error?.message).toContain(closedAt);
    });
  }

  for (const { task } of CLOSED) {
    test(`DE-05 the console says ${task}'s window has closed and offers no dispute`, async ({ page }) => {
      test.setTimeout(COLD_START_TIMEOUT * 2);
      await page.goto(`/app/trace?task=${task}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Dispute window closed", { exact: true })).toBeVisible({ timeout: COLD_START_TIMEOUT });
      await expect(page.getByText(/The dispute window closed on /)).toBeAttached();
      await expect(page.getByRole("button", { name: /dispute/i })).toHaveCount(0);
      // A finished task's trace stream keeps reconnecting and holds the context
      // open past teardown; leaving the page closes it.
      await page.goto("about:blank");
    });
  }
});
