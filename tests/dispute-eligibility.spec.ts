import { test, expect } from "@playwright/test";
import { COLD_START_TIMEOUT } from "./fixtures";

/**
 * WC — story 6.03c, who may dispute and when: window, wallet and challenge.
 *
 * The reason rules are the service's first check, made before it looks the job
 * up, so they are asserted live against a job that never settled. The window,
 * wallet and challenge rules sit behind the payer's signature over a settled
 * step: escrow v2 now settles real runs (dispute-path.spec.ts reads one), but
 * no spec holds a payer's key, so those rules are recorded in
 * docs/uat/evidence/6.03c-eligibility.md.
 */

// The 2026-09-24 attempt: delivered, paid, never charged, so never settled.
const UNSETTLED_JOB_HEX = "7fc5bc5ea95f15fc7fc5bc5ea95f15fc";

const OPEN = {
  job_id_hex: UNSETTLED_JOB_HEX,
  step_index: 0,
  payer: "GDJHP2I6NRCWYZTB3ZOXRE74V4M4EGXRYORGNPTGQ6BVNJNSSJO4PKXJ",
  nonce: "00000000000000000000000000000000",
  signature_b64: "AAAA",
};

test.describe("WC — dispute eligibility (story 6.03c)", () => {
  test("WC-05 an empty reason is refused as reason_invalid before the job is looked up", async ({ request }) => {
    const response = await request.post("/api/disputes", { timeout: COLD_START_TIMEOUT, data: { ...OPEN, reason: "" } });
    expect(response.status()).toBe(422);
    expect((await response.json()).error?.code).toBe("reason_invalid");
  });

  test("WC-05 a reason of only whitespace is refused as reason_invalid before the job is looked up", async ({ request }) => {
    const response = await request.post("/api/disputes", { timeout: COLD_START_TIMEOUT, data: { ...OPEN, reason: " \t\n " } });
    expect(response.status()).toBe(422);
    expect((await response.json()).error?.code).toBe("reason_invalid");
  });

  for (const [name, reason] of [
    ["a zero-width space", "​"],
    ["a right-to-left override", "‮"],
    ["an empty bidi isolate", "⁦⁩"],
    ["a Hangul filler", "ㅤ"],
  ]) {
    test(`WC-05 a reason of only ${name} is refused as reason_invalid`, async ({ request }) => {
      // D-059, fixed: a reason that displays as nothing is empty, so it is
      // refused before the job lookup rather than reaching 404 unknown_job.
      const response = await request.post("/api/disputes", { timeout: COLD_START_TIMEOUT, data: { ...OPEN, reason } });
      expect(response.status()).toBe(422);
      expect((await response.json()).error?.code).toBe("reason_invalid");
    });
  }

  test("WC-06 a 500-character reason in multi-byte text passes the cap, which counts characters not bytes", async ({ request }) => {
    // 500 × "é" is 1000 UTF-8 bytes. Past validation, the next refusal is the
    // unknown job — so the reason was accepted at full length, not trimmed.
    const response = await request.post("/api/disputes", { timeout: COLD_START_TIMEOUT, data: { ...OPEN, reason: "é".repeat(500) } });
    expect(response.status()).toBe(404);
    expect((await response.json()).error?.code).toBe("unknown_job");
  });

  test("WC-06 a 501-character reason is refused as reason_invalid, never cut to fit", async ({ request }) => {
    // D-062, fixed: one character past the cap is a refusal before the job
    // lookup, not a reason stored shortened or marked truncated.
    const response = await request.post("/api/disputes", { timeout: COLD_START_TIMEOUT, data: { ...OPEN, reason: "é".repeat(501) } });
    expect(response.status()).toBe(422);
    expect((await response.json()).error?.code).toBe("reason_invalid");
  });

  test("WC-01 a dispute after the window closes is refused, stating the closing time", async ({ request }) => {
    // The first run escrow v2 settled on the deploy (dispute-path.spec.ts DP-01):
    // its 24 h window closed at 2026-10-01T09:39:30Z and stays closed, so this
    // answer is permanent. The challenge is refused before anyone signs.
    const response = await request.post("/api/disputes/challenge", {
      timeout: COLD_START_TIMEOUT,
      data: { job_id_hex: "dd9089ab7791c4293baf87745d1ea0b6", step_index: 0 },
    });
    expect(response.status()).toBe(409);
    const error = (await response.json()).error;
    expect(error?.code).toBe("dispute_window_closed");
    expect(error?.message, "the refusal states when the window closed").toContain("closed at 2026-10-01T09:39:30");
  });
});
