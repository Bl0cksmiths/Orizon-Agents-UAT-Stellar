import { test, expect } from "@playwright/test";
import { COLD_START_TIMEOUT } from "./fixtures";

/**
 * DP — story 6.03a, the dispute happy path on the deployed service.
 *
 * The story's flow starts from a settled payment: pay, watch the receipt
 * appear, dispute a step, have it upheld, then resolve both transactions on
 * Stellar Expert. Escrow v2 settles real runs on the deploy, and one of them
 * was disputed and credited on 2026-09-30. Opening and upholding a dispute
 * needs the payer's key and the adjudicator's, which no spec holds, so those
 * steps are recorded in docs/uat/evidence/6.03a-dispute-path.md. What these
 * tests hold is the path as the deploy serves it: a settled run exposes its
 * settlement and window, a run with none answers empty, and the routes refuse
 * what they should refuse.
 */

// The 2026-09-24 attempt: two seeded agents, both delivered, run finalized
// `complete` with spent 0.033 and charge_tx null.
const DP_TASK_ID = "tsk_7fc5bc5ea95f15fc";

// A run settled on escrow v2 (CCNO5TENCK3EK532I3OZLZ63323FEEULPAKJ74CUP3JZK3XQINRQ5VC4)
// on 2026-09-30: step 0 by calculatorai, paid in native XLM — the settlement's
// `*_usdc` fields carry XLM amounts on this deploy. Its dispute was credited.
// v2 records a settlement only for steps whose agent has an on-chain owner
// (the D-050 change): the seeded `agt_*` agents have none, so their steps
// settle at 0 and are not disputable.
const SETTLED_TASK_ID = "tsk_7e1c369cebaf41b3";
const SETTLED_JOB_HEX = "dd9089ab7791c4293baf87745d1ea0b6";

test.describe("DP — dispute path (story 6.03a)", () => {
  test("DP-04 a finished run with no settlement answers the dispute endpoint with an empty, windowless payload", async ({ request }) => {
    const response = await request.get(`/api/tasks/${DP_TASK_ID}/disputes`, { timeout: COLD_START_TIMEOUT });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.task_id).toBe(DP_TASK_ID);
    expect(body.disputes, "disputes is always a list, even when empty").toEqual([]);
    expect(body.settlement, "nothing settled, so nothing to dispute").toBeNull();
    expect(body.settlement_state).toBeNull();
    expect(body.window_closes_at, "and no window to dispute in").toBeNull();
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
    const response = await request.get(`/api/tasks/${SETTLED_TASK_ID}/disputes`, { timeout: COLD_START_TIMEOUT });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.settlement_state).toBe("settled");
    expect(body.settlement, "a delivered, paid run has a settlement to dispute").not.toBeNull();
    expect(body.settlement.job_id_hex).toBe(SETTLED_JOB_HEX);
    expect(body.settlement.charge_tx, "the escrow charge landed on chain").toMatch(/^[0-9a-f]{64}$/);
    expect(body.settlement.steps[0]).toMatchObject({ step_index: 0, agent_id: "calculatorai", delivered: true });
    expect(body.settlement.steps[0].paid_usdc, "the step was paid more than 0").toBeGreaterThan(0);
    expect(typeof body.window_closes_at, "and a window that closes").toBe("number");
    expect(body.window_closes_at, "a day after settlement").toBeCloseTo(body.settlement.settled_at + 24 * 60 * 60, 3);
    expect(body.disputes).toContainEqual(expect.objectContaining({ step_index: 0, status: "credited" }));
  });
});
