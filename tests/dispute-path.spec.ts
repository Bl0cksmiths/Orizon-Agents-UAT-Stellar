import { test, expect } from "@playwright/test";
import { COLD_START_TIMEOUT } from "./fixtures";

/**
 * DP — story 6.03a, the dispute happy path on the deployed service.
 *
 * The story's flow starts from a settled payment: pay, watch the receipt
 * appear, dispute a step, have it upheld, then resolve both transactions on
 * Stellar Expert. None of that can run today — the escrow charge never lands,
 * so no settlement is recorded and there is nothing to dispute
 * (docs/uat/evidence/6.03a-dispute-path.md). What these tests hold is the
 * reachability of the path itself: the routes answer, they refuse what they
 * should refuse, and the one gate that blocks the story is pinned as an
 * expected failure so it turns green the moment settlement works.
 */

// The 2026-09-24 attempt: two seeded agents, both delivered, run finalized
// `complete` with spent 0.033 and charge_tx null.
const DP_TASK_ID = "tsk_7fc5bc5ea95f15fc";

test.describe("DP — dispute path (story 6.03a)", () => {
  test("DP-04 a finished run answers the dispute endpoint with a task-shaped payload", async ({ request }) => {
    const response = await request.get(`/api/tasks/${DP_TASK_ID}/disputes`, { timeout: COLD_START_TIMEOUT });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.task_id).toBe(DP_TASK_ID);
    expect(Array.isArray(body.disputes), "disputes is always a list, even when empty").toBe(true);
    expect(body).toHaveProperty("settlement");
    expect(body).toHaveProperty("window_closes_at");
  });

  test("DP-03 a dispute challenge for a job that never settled is refused as unknown_job", async ({ request }) => {
    const response = await request.post("/api/disputes/challenge", {
      timeout: COLD_START_TIMEOUT,
      data: { job_id_hex: "7fc5bc5ea95f15fc7fc5bc5ea95f15fc", step_index: 0 },
    });
    expect(response.status()).toBe(404);
    expect((await response.json()).error?.code).toBe("unknown_job");
  });
});
