import { test, expect } from "@playwright/test";
import { COLD_START_TIMEOUT } from "./fixtures";

/**
 * DR — story 6.03b, the dispute refusal paths on the deployed service.
 *
 * 6.03a proved the happy path cannot run: no payment settles, so no dispute
 * exists (D-050, D-051). The refusals divide in two. Everything that a
 * stranger, a typo or a forged payload can trigger is reachable today and is
 * asserted live here. Everything that needs a real settled dispute to refuse —
 * a closed window, a duplicate, a second adjudication, the refund cap — is
 * listed in docs/uat/evidence/6.03b-dispute-refusals.md and represented here by
 * one pinned test, because a refusal you cannot reach is not a refusal you have
 * tested.
 *
 * The scope is QA's own reading of "the dispute refusal paths": the story text
 * was not supplied. Correct the criteria in the test plan if it differs.
 */

// The 2026-09-24 attempt: delivered, paid, never charged, so never settled.
const UNSETTLED_JOB_HEX = "7fc5bc5ea95f15fc7fc5bc5ea95f15fc";

test.describe("DR — dispute refusals (story 6.03b)", () => {
  for (const bad of [
    { what: "a malformed job id", data: { job_id_hex: "nothex", step_index: 0 }, field: "job_id_hex" },
    { what: "a negative step index", data: { job_id_hex: UNSETTLED_JOB_HEX, step_index: -1 }, field: "step_index" },
  ]) {
    test(`DR-01 a dispute challenge with ${bad.what} is refused as a validation error`, async ({ request }) => {
      const response = await request.post("/api/disputes/challenge", { timeout: COLD_START_TIMEOUT, data: bad.data });
      expect(response.status()).toBe(422);
      const body = await response.json();
      expect(body.error?.code).toBe("validation_error");
      expect(JSON.stringify(body.detail), "the refusal names the field that was wrong").toContain(bad.field);
    });
  }

  test("DR-02 opening a dispute with a forged nonce and signature is refused, and says nothing about the signature", async ({ request }) => {
    const response = await request.post("/api/disputes", {
      timeout: COLD_START_TIMEOUT,
      data: {
        job_id_hex: UNSETTLED_JOB_HEX,
        step_index: 0,
        reason: "QA refusal probe: forged challenge",
        payer: "GDJHP2I6NRCWYZTB3ZOXRE74V4M4EGXRYORGNPTGQ6BVNJNSSJO4PKXJ",
        nonce: "00000000000000000000000000000000",
        signature_b64: "AAAA",
      },
    });
    expect(response.status()).toBe(404);
    const body = await response.json();
    // The job is checked before the credential, so a forger learns only that
    // the job is unknown — not whether their signature would have passed.
    expect(body.error?.code).toBe("unknown_job");
    expect(JSON.stringify(body).toLowerCase()).not.toContain("signature");
  });
});
