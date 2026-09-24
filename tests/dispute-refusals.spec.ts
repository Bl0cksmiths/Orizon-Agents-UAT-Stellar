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

  const VALID_OPEN = {
    job_id_hex: UNSETTLED_JOB_HEX,
    step_index: 0,
    reason: "QA refusal probe",
    payer: "GDJHP2I6NRCWYZTB3ZOXRE74V4M4EGXRYORGNPTGQ6BVNJNSSJO4PKXJ",
    nonce: "00000000000000000000000000000000",
    signature_b64: "AAAA",
  };

  for (const bad of [
    { what: "a reason past the 500-character cap", data: { ...VALID_OPEN, reason: "x".repeat(501) }, field: "reason" },
    { what: "a payer that is not a G-address", data: { ...VALID_OPEN, payer: "not-a-wallet" }, field: "payer" },
    { what: "no reason at all", data: { ...VALID_OPEN, reason: undefined }, field: "reason" },
  ]) {
    test(`DR-03 opening a dispute with ${bad.what} is refused before the job is looked up`, async ({ request }) => {
      const response = await request.post("/api/disputes", { timeout: COLD_START_TIMEOUT, data: bad.data });
      expect(response.status()).toBe(422);
      const body = await response.json();
      expect(body.error?.code).toBe("validation_error");
      expect(JSON.stringify(body.detail)).toContain(bad.field);
    });
  }

  test("DR-04 reading a dispute that does not exist is refused as unknown_dispute, with no stack trace", async ({ request }) => {
    const response = await request.get("/api/disputes/dsp_does_not_exist", { timeout: COLD_START_TIMEOUT });
    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.error?.code).toBe("unknown_dispute");
    expect(body.error?.request_id, "every refusal is traceable in the logs").toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(body)).not.toContain("Traceback");
  });

  test("DR-05 a settled run refuses a dispute challenge from a wallet that is not its payer", async ({ request }) => {
    // Stands for the whole settlement-dependent family: wrong wallet, closed
    // window, duplicate, second adjudication, refund cap. None can be reached
    // while no run settles (D-050), so this fails today at its precondition —
    // the challenge is refused `unknown_job` rather than for the wrong wallet.
    // When it flips green, re-verify the others from the evidence doc's list.
    test.fail();
    const disputes = await request.get("/api/tasks/tsk_7fc5bc5ea95f15fc/disputes", { timeout: COLD_START_TIMEOUT });
    const settlement = (await disputes.json()).settlement;
    expect(settlement, "a settled run to challenge against").not.toBeNull();

    const response = await request.post("/api/disputes/challenge", {
      timeout: COLD_START_TIMEOUT,
      data: { job_id_hex: settlement.job_id_hex, step_index: 0 },
    });
    expect(response.status(), "a challenge exists to sign").toBe(200);
    const open = await request.post("/api/disputes", {
      timeout: COLD_START_TIMEOUT,
      data: {
        job_id_hex: settlement.job_id_hex,
        step_index: 0,
        reason: "QA refusal probe: not the payer",
        // The 6.05 agent owner, which never paid for this run.
        payer: "GBWMD26IB6CMG3JO3HU7SD7ZJSTF4BIJ5JS77ANMLJ52M6FV6K3J7BQJ",
        nonce: (await response.json()).nonce,
        signature_b64: "AAAA",
      },
    });
    expect([401, 403], "a stranger cannot dispute someone else's payment").toContain(open.status());
  });
});
