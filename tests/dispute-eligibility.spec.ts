import { test, expect } from "@playwright/test";
import { COLD_START_TIMEOUT } from "./fixtures";

/**
 * WC — story 6.03c, who may dispute and when: window, wallet and challenge.
 *
 * Every rule here needs a settled step to reach except the reason rules, which
 * the service checks before it looks the job up. Those are asserted live; the
 * window, wallet and challenge rules wait on D-050 and are recorded in
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
  test("WC-05 an empty reason is refused before the job is looked up", async ({ request }) => {
    const response = await request.post("/api/disputes", { timeout: COLD_START_TIMEOUT, data: { ...OPEN, reason: "" } });
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.error?.code).toBe("validation_error");
    expect(JSON.stringify(body.detail)).toContain("reason");
  });

  test("WC-05 a reason of only whitespace is refused as reason_required before the job is looked up", async ({ request }) => {
    const response = await request.post("/api/disputes", { timeout: COLD_START_TIMEOUT, data: { ...OPEN, reason: " \t\n " } });
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.error?.code).toBe("reason_required");
  });

  test("WC-06 a 500-character reason in multi-byte text passes the cap, which counts characters not bytes", async ({ request }) => {
    // 500 × "é" is 1000 UTF-8 bytes. Past validation, the next refusal is the
    // unknown job — so the reason was accepted at full length, not trimmed.
    const response = await request.post("/api/disputes", { timeout: COLD_START_TIMEOUT, data: { ...OPEN, reason: "é".repeat(500) } });
    expect(response.status()).toBe(404);
    expect((await response.json()).error?.code).toBe("unknown_job");
  });
});
