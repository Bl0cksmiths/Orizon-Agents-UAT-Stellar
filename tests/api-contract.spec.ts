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

  test("AZ-02 every API-key-gated PDAX route refuses an unauthenticated call with a consistent error shape", async ({
    request,
  }) => {
    // Every route mounted on pdax.py's `secured` sub-router (the
    // require_api_key dependency) — the money-moving and account-revealing
    // PDAX surface. require_api_key resolves before any query/body
    // validation (confirmed against the live deployment), so no PDAX call is
    // ever reached and no well-formed payload is needed to probe refusal.
    const gatedRoutes: { method: "GET" | "POST"; path: string }[] = [
      { method: "GET", path: "/api/pdax/health/deep" },
      { method: "GET", path: "/api/pdax/trade/price" },
      { method: "GET", path: "/api/pdax/trade/price/v2" },
      { method: "POST", path: "/api/pdax/trade/quote" },
      { method: "POST", path: "/api/pdax/trade/quote/v2" },
      { method: "POST", path: "/api/pdax/trade/order" },
      { method: "GET", path: "/api/pdax/trade/orders/1" },
      { method: "GET", path: "/api/pdax/trade/orders" },
      { method: "GET", path: "/api/pdax/crypto/deposit" },
      { method: "POST", path: "/api/pdax/fiat/deposit" },
      { method: "POST", path: "/api/pdax/fiat/withdraw" },
      { method: "POST", path: "/api/pdax/fiat/user-info-upload" },
      { method: "POST", path: "/api/pdax/crypto/withdraw" },
      { method: "GET", path: "/api/pdax/fiat/transactions" },
      { method: "GET", path: "/api/pdax/crypto/transactions" },
      { method: "GET", path: "/api/pdax/balances" },
      { method: "POST", path: "/api/pdax/webhooks/register" },
      { method: "POST", path: "/api/pdax/ramp/estimate" },
      { method: "POST", path: "/api/pdax/ramp/funding-quote" },
      { method: "POST", path: "/api/pdax/ramp/onramp" },
      { method: "POST", path: "/api/pdax/ramp/offramp" },
      { method: "GET", path: "/api/pdax/ramp" },
      { method: "GET", path: "/api/pdax/ramp/abc123" },
      { method: "POST", path: "/api/pdax/ramp/abc123/reconcile" },
    ];

    for (const route of gatedRoutes) {
      const response =
        route.method === "GET"
          ? await request.get(route.path, { timeout: COLD_START_TIMEOUT })
          : await request.post(route.path, { timeout: COLD_START_TIMEOUT, data: {} });
      expect(response.status(), `${route.method} ${route.path} should refuse with 401`).toBe(401);
      const body = await response.json();
      expect(body.error?.code, `${route.method} ${route.path} error code`).toBe("invalid_api_key");
      expect(body.error?.message, `${route.method} ${route.path} error message`).toBeTruthy();
      expect(body.error?.request_id, `${route.method} ${route.path} request id`).toBeTruthy();
      expect(body.detail, `${route.method} ${route.path} detail`).toBeTruthy();
    }
  });

  test("AZ-03 every error body carries the unified envelope", async ({ request }) => {
    // Deliberately spans the distinct error paths app/main.py's handlers
    // produce (401 from a dependency, 422 from RequestValidationError, 404
    // and 400 from a raised HTTPException) so the assertion is on the
    // envelope contract itself, not on one lucky status code.
    const responses = await Promise.all([
      request.post("/api/stellar/server/charge", { timeout: COLD_START_TIMEOUT, data: {} }), // 401
      request.get(`/api/stellar/agent/${encodeURIComponent("bad id!")}`, { timeout: COLD_START_TIMEOUT }), // 422
      request.get("/api/totally-not-a-route", { timeout: COLD_START_TIMEOUT }), // 404
      request.get("/api/stellar/attestation/00000000000000000000000000000000", { timeout: COLD_START_TIMEOUT }), // 400
    ]);

    for (const response of responses) {
      const body = await response.json();
      expect(body, `status ${response.status()} body has a detail field`).toHaveProperty("detail");
      expect(body, `status ${response.status()} body has an error object`).toHaveProperty("error");
      expect(typeof body.error.code, `status ${response.status()} error.code is a string`).toBe("string");
      expect(typeof body.error.message, `status ${response.status()} error.message is a string`).toBe("string");
      expect(typeof body.error.request_id, `status ${response.status()} error.request_id is a string`).toBe(
        "string",
      );
      expect(
        body.error.request_id.length,
        `status ${response.status()} error.request_id is non-empty`,
      ).toBeGreaterThan(0);
    }
  });

  test("AZ-04 malformed path params answer 422 with no stack trace", async ({ request }) => {
    const cases = [
      { label: "bad agent id charset", path: `/api/stellar/agent/${encodeURIComponent("bad id!")}` },
      { label: "non-hex job id", path: "/api/stellar/attestation/nothex" },
    ];

    for (const { label, path } of cases) {
      const started = Date.now();
      const response = await request.get(path, { timeout: COLD_START_TIMEOUT });
      const elapsedMs = Date.now() - started;
      expect(response.status(), `${label}: expected 422`).toBe(422);

      const bodyText = await response.text();
      // No stack trace ever reaches the client — app/main.py's handlers only
      // ever emit the curated envelope, and this rejection happens at the
      // router edge (a Path(..., pattern=...) mismatch) before any handler
      // code, let alone a traceback-producing one, ever runs.
      expect(bodyText, `${label}: no Python stack trace leaked`).not.toMatch(/Traceback|File "|\.py", line/);

      const body = JSON.parse(bodyText);
      expect(body.error.code, `${label}: error code`).toBe("validation_error");

      // Router-edge pattern validation rejects before any Soroban RPC call.
      // A genuine RPC round-trip is far slower than this even against a warm
      // backend; generous bound to absorb network variance without masking
      // a regression that starts round-tripping to RPC on a malformed id.
      expect(elapsedMs, `${label}: answered without an RPC round-trip`).toBeLessThan(8_000);
    }
  });
});
