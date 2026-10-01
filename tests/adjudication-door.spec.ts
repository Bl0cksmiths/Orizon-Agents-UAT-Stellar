import { test, expect, type APIResponse } from "@playwright/test";
import { COLD_START_TIMEOUT } from "./fixtures";

/**
 * AD — story 6.03g, the adjudication door and the refund switch, on the deployed service.
 *
 * The guard checks the operator key before it reads the refund switch, so every caller without
 * the key gets the same answer whichever way the switch is set: 401 invalid_api_key, never a
 * 500, and never a 503 or a validation error that would tell a stranger how the route is set
 * or what it expects. Nothing here toggles the switch or holds the key. The keyed half — the
 * boot refusal, the switch's 503 to a keyed caller, and the rejection-reason rules — runs
 * against a real local backend in tools/adjudication-drill/.
 */

const PROBE = "/api/disputes/dsp_uat_probe";

/**
 * The adjudicator guard's refusal: 401 invalid_api_key, and nothing else. Never a 500, never the
 * refund switch's 503 (its state is not a stranger's business), never a 422.
 */
async function expectGuardRefusal(response: APIResponse): Promise<void> {
  expect(response.status(), "never a 500, a 503 or a 422").toBe(401);
  expect((await response.json()).error?.code).toBe("invalid_api_key");
}

test.describe("AD — adjudication door (story 6.03g)", () => {
  for (const action of ["uphold", "reject"] as const) {
    test(`AD-01 ${action} without a key is refused 401 by the guard`, async ({ request }) => {
      await expectGuardRefusal(await request.post(`${PROBE}/${action}`, { timeout: COLD_START_TIMEOUT }));
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
      test(`AD-03 a ${label} key on ${action} is the guard's 401, never a 500`, async ({ request }) => {
        await expectGuardRefusal(await request.post(`${PROBE}/${action}`, { timeout: COLD_START_TIMEOUT, headers: { "X-API-Key": key } }));
      });
    }
  }

  for (const action of ["uphold", "reject"] as const) {
    test(`AD-04 no key and a wrong-shaped body on ${action}: the door answers, not the validator`, async ({ request }) => {
      await expectGuardRefusal(await request.post(`${PROBE}/${action}`, { timeout: COLD_START_TIMEOUT, data: { note: 5, extra: [] } }));
    });
    test(`AD-04 no key and malformed JSON on ${action}: the door answers, not the parser`, async ({ request }) => {
      // D-073: FastAPI parses a JSON body before it runs the route's dependencies, so on reject
      // (the one of the two with a body) malformed JSON is answered 422 json_invalid ahead of
      // the guard. Remove the marker once the guard answers first.
      if (action === "reject") test.fail();
      await expectGuardRefusal(await request.post(`${PROBE}/${action}`, {
        timeout: COLD_START_TIMEOUT,
        headers: { "Content-Type": "application/json" },
        data: Buffer.from("{not json"),
      }));
    });
  }

  test("AD-06 the buyer's routes never ask for the operator key", async ({ request }) => {
    // No run settles on the deploy (D-050), so a dispute cannot be accepted here; that half runs
    // in tools/adjudication-drill/. What holds live: neither route answers invalid_api_key.
    const job = { job_id_hex: "7fc5bc5ea95f15fc7fc5bc5ea95f15fc", step_index: 0 };
    const challenge = await request.post("/api/disputes/challenge", { timeout: COLD_START_TIMEOUT, data: job });
    expect(challenge.status()).toBe(404);
    expect((await challenge.json()).error?.code).toBe("unknown_job");
    const raise = await request.post("/api/disputes", {
      timeout: COLD_START_TIMEOUT,
      data: { ...job, reason: "UAT 6.03g probe", payer: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7", nonce: "0".repeat(32), signature_b64: "AAAA" },
    });
    expect(raise.status()).toBeLessThan(500);
    expect([401, 403]).not.toContain(raise.status());
    expect((await raise.json()).error?.code).not.toBe("invalid_api_key");
  });
});
