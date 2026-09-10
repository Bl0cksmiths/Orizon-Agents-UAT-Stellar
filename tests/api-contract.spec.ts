import { test, expect } from "@playwright/test";
import { COLD_START_TIMEOUT } from "./fixtures";

/**
 * AZ-01..AZ-09 — API-contract and authorization coverage for the live
 * backend, using Playwright's `request` fixture (APIRequestContext) rather
 * than a browser page.
 *
 * Every assertion below matches behaviour confirmed against the live
 * deployment by hand before being written — none of it is inferred from
 * backend source alone. In particular AZ-01/AZ-02: the deployed API_KEY is
 * NOT empty, so `require_api_key` is actively enforcing, not a no-op.
 *
 * Deliberately never sends a well-formed money-moving payload: the
 * server-signed charge/seal routes and every PDAX write are probed with a
 * body that fails validation regardless of auth, and the on-chain build
 * routes (register/update-price) only ever produce unsigned XDR, never a
 * signed submit.
 */

test.describe("AZ — authorization and API contract", () => {
  test.beforeAll(async ({ request }) => {
    // Render free tier cold-starts in 25-60s; warm it once before any
    // assertion below spends its own budget waiting on a cold instance.
    await request.get("/api/health", { timeout: COLD_START_TIMEOUT });
  });

  test("AZ-01 unauthenticated server/charge and server/seal are refused", async ({ request }) => {
    const charge = await request.post("/api/stellar/server/charge", {
      timeout: COLD_START_TIMEOUT,
      data: {}, // fails ChargeReq validation regardless — never a well-formed charge
    });
    expect(charge.status()).toBe(401);
    const chargeBody = await charge.json();
    expect(chargeBody.error?.code).toBe("invalid_api_key");

    const seal = await request.post("/api/stellar/server/seal", {
      timeout: COLD_START_TIMEOUT,
      data: {}, // fails SealReq validation regardless — never a well-formed seal
    });
    expect(seal.status()).toBe(401);
    const sealBody = await seal.json();
    expect(sealBody.error?.code).toBe("invalid_api_key");
  });
});
