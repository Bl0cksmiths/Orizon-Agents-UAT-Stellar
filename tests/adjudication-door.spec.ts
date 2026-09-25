import { test, expect, type APIResponse } from "@playwright/test";
import { COLD_START_TIMEOUT } from "./fixtures";

/**
 * AD — story 6.03g, the adjudication door and the refund switch, on the deployed service.
 *
 * Refunds are off on the deploy (DISPUTE_REFUNDS_ENABLED=false) and must stay off until the
 * private money-path defect D-053 is fixed, so nothing here toggles anything. What holds live is
 * the switch's answer to every kind of caller: 503, never a 500, and never a validation error
 * that would tell a stranger what the route expects. The refunds-on half — the boot refusal,
 * the 401s with a key configured, and the rejection-reason rules — runs against a real local
 * backend in tools/adjudication-drill/.
 */

const PROBE = "/api/disputes/dsp_uat_probe";

/** The refund switch's refusal: 503 dispute_refunds_disabled, and nothing else. */
async function expectSwitchedOff(response: APIResponse): Promise<void> {
  expect(response.status(), "never a 500, never a 422").toBe(503);
  expect((await response.json()).error?.code).toBe("dispute_refunds_disabled");
}

test.describe("AD — adjudication door (story 6.03g)", () => {
  for (const action of ["uphold", "reject"] as const) {
    test(`AD-01 with refunds off, ${action} is refused 503 without a key`, async ({ request }) => {
      await expectSwitchedOff(await request.post(`${PROBE}/${action}`, { timeout: COLD_START_TIMEOUT }));
    });
  }
});
