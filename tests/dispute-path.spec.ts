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

  for (const action of ["uphold", "reject"] as const) {
    test(`DP-02 an anonymous caller cannot ${action} a dispute`, async ({ request }) => {
      const response = await request.post(`/api/disputes/dsp_uat_probe/${action}`, {
        timeout: COLD_START_TIMEOUT,
        data: {},
      });
      // 401 is the adjudicator guard; 503 is the refunds master switch being
      // off, which the service checks first (D-052). Either way the caller
      // adjudicates nothing — but never 200, and never a validation error that
      // implies the body was considered.
      expect([401, 503], `adjudication must stay closed, got ${response.status()}`).toContain(response.status());
      expect(["invalid_api_key", "dispute_refunds_disabled"]).toContain((await response.json()).error?.code);
    });
  }

  test("DP-01 a paid, delivered run exposes a settlement and a window to dispute against", async ({ request }) => {
    // D-050: the escrow charge never lands (D-039), so _record_settlement
    // returns early and no run is disputable. Remove the marker once a run
    // finishes with a non-null charge_tx.
    test.fail();
    const response = await request.get(`/api/tasks/${DP_TASK_ID}/disputes`, { timeout: COLD_START_TIMEOUT });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.settlement, "a delivered, paid run has a settlement to dispute").not.toBeNull();
    expect(typeof body.window_closes_at, "and a window that closes").toBe("number");
  });
});
