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

  // Header values travel as bytes: the UTF-8 key is sent as its raw bytes, as a client that does
  // not encode would send it. This path has produced a 500 in this codebase before.
  const BAD_KEYS = {
    wrong: "uat-wrong-key-0000",
    short: "uat-wrong-key-000",
    "latin-1": "kéy-ñ",
    "raw UTF-8": Buffer.from("kéy✓—🔑", "utf8").toString("latin1"),
  };
  for (const [label, key] of Object.entries(BAD_KEYS)) {
    for (const action of ["uphold", "reject"] as const) {
      test(`AD-03 a ${label} key on ${action} is the switch's 503, never a 500`, async ({ request }) => {
        await expectSwitchedOff(await request.post(`${PROBE}/${action}`, { timeout: COLD_START_TIMEOUT, headers: { "X-API-Key": key } }));
      });
    }
  }

  for (const action of ["uphold", "reject"] as const) {
    test(`AD-04 no key and a wrong-shaped body on ${action}: the door answers, not the validator`, async ({ request }) => {
      await expectSwitchedOff(await request.post(`${PROBE}/${action}`, { timeout: COLD_START_TIMEOUT, data: { note: 5, extra: [] } }));
    });
    test(`AD-04 no key and malformed JSON on ${action}: the door answers, not the parser`, async ({ request }) => {
      // D-073: FastAPI parses a JSON body before it runs the route's dependencies, so on reject
      // (the one of the two with a body) malformed JSON is answered 422 json_invalid ahead of
      // the guard. Remove the marker once the guard answers first.
      if (action === "reject") test.fail();
      await expectSwitchedOff(await request.post(`${PROBE}/${action}`, {
        timeout: COLD_START_TIMEOUT,
        headers: { "Content-Type": "application/json" },
        data: Buffer.from("{not json"),
      }));
    });
  }
});
