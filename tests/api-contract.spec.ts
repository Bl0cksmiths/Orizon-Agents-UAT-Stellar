import { test, expect } from "@playwright/test";
import { COLD_START_TIMEOUT, ONCHAIN_AGENT_ID, ONCHAIN_AGENT_OWNER } from "./fixtures";

/**
 * AZ-01..AZ-09 and AM-06 — API-contract, authorization and agent-management
 * coverage for the live backend, using Playwright's `request` fixture
 * (APIRequestContext) rather than a browser page.
 *
 * Every assertion below matches behaviour confirmed against the live
 * deployment by hand before being written — none of it is inferred from
 * backend source alone. In particular AZ-01/AZ-02: the deployed API_KEY is
 * NOT empty, so `require_api_key` is actively enforcing, not a no-op.
 *
 * Deliberately never sends a well-formed money-moving payload: the
 * server-signed charge/seal routes and every PDAX write are probed with a
 * body that fails validation regardless of auth, and the on-chain build
 * routes (register/update-price/set-active) only ever produce unsigned XDR,
 * never a signed submit.
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

  test("AZ-05 an id in the reserved agt_ namespace is refused by build/register-agent", async ({ request }) => {
    // Any syntactically valid G... address works here — the reserved-prefix
    // check (agent_id.startswith("agt_")) runs before the owner account or
    // an existing-id lookup is ever touched.
    const owner = `G${"A".repeat(55)}`;
    const response = await request.post("/api/stellar/build/register-agent", {
      timeout: COLD_START_TIMEOUT,
      data: {
        owner,
        agent_id: "agt_reserved_probe",
        name: "probe",
        skills: [],
        price_usdc: 1,
      },
    });
    expect(response.status()).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("id_reserved");
    expect(body.detail).toBe("id_reserved");
  });

  test("AZ-06 build/update-price and build/set-active still return unsigned XDR for an agent the caller does not own", async ({
    request,
  }) => {
    // Ownership is enforced by the contract's owner.require_auth(), not by
    // either endpoint (see app/routers/stellar.py build_update_price and
    // build_set_active) — the build must succeed regardless of who is
    // asking. This pins that deliberate behaviour on BOTH management
    // endpoints so a future change toward API-level ownership enforcement
    // is a conscious decision, not a silent regression.
    const agentsResponse = await request.get("/api/agents", { timeout: COLD_START_TIMEOUT });
    expect(agentsResponse.ok()).toBe(true);
    const agents: Array<{ id: string; source: string; owner: string | null }> = await agentsResponse.json();
    const onchainAgent = agents.find((a) => a.source === "onchain" && a.owner);
    expect(onchainAgent, "at least one on-chain-registered agent is listed to probe against").toBeTruthy();

    // A real, funded, well-known mainnet account (Circle's USDC issuer) that
    // is provably not this agent's owner — needed so the build reaches the
    // ownership question at all, rather than failing earlier on an unfunded
    // source account.
    const nonOwner = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
    expect(nonOwner).not.toBe(onchainAgent!.owner);

    const response = await request.post("/api/stellar/build/update-price", {
      timeout: COLD_START_TIMEOUT,
      data: { owner: nonOwner, agent_id: onchainAgent!.id, price_usdc: 5 },
    });

    expect(response.status(), "the build must succeed — ownership is not checked here").toBe(200);
    const body = await response.json();
    expect(typeof body.xdr, "unsigned XDR is returned").toBe("string");
    expect(body.xdr.length).toBeGreaterThan(0);

    const setActiveResponse = await request.post("/api/stellar/build/set-active", {
      timeout: COLD_START_TIMEOUT,
      data: { owner: nonOwner, agent_id: onchainAgent!.id, active: true },
    });

    expect(setActiveResponse.status(), "set-active must also succeed — ownership is not checked here").toBe(200);
    const setActiveBody = await setActiveResponse.json();
    expect(typeof setActiveBody.xdr, "unsigned XDR is returned for set-active").toBe("string");
    expect(setActiveBody.xdr.length).toBeGreaterThan(0);
  });

  test("AZ-07 an oversized body is refused with 413 carrying the hardening headers", async ({ request }) => {
    // BodyLimitMiddleware's default cap is 1 MiB; comfortably over it so the
    // declared Content-Length short-circuit fires before any parsing — no
    // well-formed payload of any kind is ever read.
    const oversizedPad = "a".repeat(1_100_000);
    const response = await request.post("/api/stellar/build/register-agent", {
      timeout: COLD_START_TIMEOUT,
      data: { pad: oversizedPad },
    });

    expect(response.status()).toBe(413);
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response.headers()["x-frame-options"]).toBe("DENY");

    const body = await response.json();
    expect(body.error.code).toBe("request_too_large");
  });

  test("AZ-08 every response carries the hardening headers", async ({ request }) => {
    // SecurityHeadersMiddleware wraps the whole stack (including the rate
    // limiter's 429s and the body limiter's 413s), and the unhandled-
    // exception handler stamps the same headers by hand for a 500 — so a
    // success, an auth refusal, a validation error and a not-found should
    // all carry them identically.
    const responses = await Promise.all([
      request.get("/api/health", { timeout: COLD_START_TIMEOUT }), // 200
      request.post("/api/stellar/server/charge", { timeout: COLD_START_TIMEOUT, data: {} }), // 401
      request.get(`/api/stellar/agent/${encodeURIComponent("bad id!")}`, { timeout: COLD_START_TIMEOUT }), // 422
      request.get("/api/totally-not-a-route", { timeout: COLD_START_TIMEOUT }), // 404
    ]);

    for (const response of responses) {
      const headers = response.headers();
      expect(headers["x-content-type-options"], `${response.url()} (${response.status()})`).toBe("nosniff");
      expect(headers["referrer-policy"], `${response.url()} (${response.status()})`).toBe("no-referrer");
      expect(headers["x-frame-options"], `${response.url()} (${response.status()})`).toBe("DENY");
    }
  });

  test("AZ-09 no signing key, API key or PDAX credential appears in the client bundle", async ({ request }) => {
    // Crawl a representative set of routes — marketing plus the console
    // pages most likely to embed a credential-shaped literal (wallet, send,
    // pdax, register, orchestrator) — for their Next.js script tags, then
    // search every unique JS chunk actually served to the browser. Reads the
    // LIVE deployed bundle only; never builds one locally.
    const pagesToScan = ["/", "/app", "/app/wallet", "/app/send", "/app/pdax", "/app/register", "/app/orchestrator"];

    const chunkUrls = new Set<string>();
    for (const page of pagesToScan) {
      const response = await request.get(page, { timeout: COLD_START_TIMEOUT });
      expect(response.ok(), `${page} should load`).toBe(true);
      const html = await response.text();
      for (const match of html.matchAll(/\/_next\/static\/[^"'\\]+\.js/g)) {
        chunkUrls.add(match[0]);
      }
    }
    expect(chunkUrls.size, "found at least one JS chunk to scan").toBeGreaterThan(0);

    // Credential-shaped patterns that must never appear in code shipped to
    // the browser. Structural (charset/length), not tied to any one secret's
    // actual value, so the check holds regardless of which key is deployed.
    const forbiddenPatterns: { label: string; re: RegExp }[] = [
      { label: "Stellar secret seed (signing key)", re: /\bS[A-Z2-7]{55}\b/ },
      { label: "literal X-API-Key value assignment", re: /x-api-key["']?\s*[:=]\s*["'][^"'{}$][^"']{5,}["']/i },
      {
        label: "literal PDAX credential assignment",
        re: /pdax[_-]?(password|username|secret)["']?\s*[:=]\s*["'][^"']{3,}["']/i,
      },
      {
        label: "literal Authorization Bearer/Basic value",
        re: /Authorization["']?\s*[:=]\s*["'](Bearer|Basic)\s+[A-Za-z0-9+/=_.-]{10,}["']/i,
      },
    ];

    for (const chunkUrl of chunkUrls) {
      const response = await request.get(chunkUrl, { timeout: COLD_START_TIMEOUT });
      expect(response.ok(), `${chunkUrl} should be fetchable`).toBe(true);
      const source = await response.text();
      for (const { label, re } of forbiddenPatterns) {
        expect(re.test(source), `${label} found in ${chunkUrl}`).toBe(false);
      }
    }
  });

  test("AM-06 an unregistered agent id returns a plain agent_not_found 404 from both management endpoints", async ({
    request,
  }) => {
    // A syntactically valid but never-registered id: it passes the router's
    // AGENT_ID_PATTERN so the request reaches _agent_exists (see
    // app/routers/stellar.py build_update_price / build_set_active), which
    // is the exact code path this criterion pins — a plain 404 in the
    // standard envelope, not an opaque build_failed surfacing after a
    // failed simulate.
    const unregisteredId = "definitely_not_registered_xyz";

    const updatePrice = await request.post("/api/stellar/build/update-price", {
      timeout: COLD_START_TIMEOUT,
      data: { owner: ONCHAIN_AGENT_OWNER, agent_id: unregisteredId, price_usdc: 5 },
    });
    expect(updatePrice.status(), "update-price: unregistered id is 404").toBe(404);
    const updatePriceBody = await updatePrice.json();
    expect(updatePriceBody.detail).toBe("agent_not_found");
    expect(updatePriceBody.error.code).toBe("agent_not_found");

    const setActive = await request.post("/api/stellar/build/set-active", {
      timeout: COLD_START_TIMEOUT,
      data: { owner: ONCHAIN_AGENT_OWNER, agent_id: unregisteredId, active: false },
    });
    expect(setActive.status(), "set-active: unregistered id is 404").toBe(404);
    const setActiveBody = await setActive.json();
    expect(setActiveBody.detail).toBe("agent_not_found");
    expect(setActiveBody.error.code).toBe("agent_not_found");
  });

  test("AM-06 build/update-price rejects invalid input with 422 in the standard envelope", async ({ request }) => {
    // Each case is refused by UpdatePriceReq's Pydantic field validation
    // before any Soroban simulate/build is attempted — never a 500 and
    // never an opaque build_failed from a doomed build.
    const cases: { label: string; data: Record<string, unknown> }[] = [
      {
        label: "bad agent-id charset",
        data: { owner: ONCHAIN_AGENT_OWNER, agent_id: "bad id!", price_usdc: 5 },
      },
      {
        label: "price is zero",
        data: { owner: ONCHAIN_AGENT_OWNER, agent_id: ONCHAIN_AGENT_ID, price_usdc: 0 },
      },
      {
        label: "price is negative",
        data: { owner: ONCHAIN_AGENT_OWNER, agent_id: ONCHAIN_AGENT_ID, price_usdc: -5 },
      },
      {
        label: "price exceeds the 10,000 cap",
        data: { owner: ONCHAIN_AGENT_OWNER, agent_id: ONCHAIN_AGENT_ID, price_usdc: 10_001 },
      },
      {
        label: "malformed owner address",
        data: { owner: "not-a-valid-address", agent_id: ONCHAIN_AGENT_ID, price_usdc: 5 },
      },
    ];

    for (const { label, data } of cases) {
      const response = await request.post("/api/stellar/build/update-price", {
        timeout: COLD_START_TIMEOUT,
        data,
      });
      expect(response.status(), `${label}: expected 422`).toBe(422);
      const body = await response.json();
      expect(body.error.code, `${label}: error code`).toBe("validation_error");
      expect(body.error.message, `${label}: error message`).toBeTruthy();
      expect(body.error.request_id, `${label}: request id`).toBeTruthy();
    }
  });

  test("AM-06 build/set-active rejects invalid input with 422 in the standard envelope", async ({ request }) => {
    // Same field-validation-before-simulate contract as update-price (see
    // SetActiveReq in app/routers/stellar.py); set-active carries no price
    // field, so only the shared agent-id/owner cases apply here.
    const cases: { label: string; data: Record<string, unknown> }[] = [
      {
        label: "bad agent-id charset",
        data: { owner: ONCHAIN_AGENT_OWNER, agent_id: "bad id!", active: false },
      },
      {
        label: "malformed owner address",
        data: { owner: "not-a-valid-address", agent_id: ONCHAIN_AGENT_ID, active: false },
      },
    ];

    for (const { label, data } of cases) {
      const response = await request.post("/api/stellar/build/set-active", {
        timeout: COLD_START_TIMEOUT,
        data,
      });
      expect(response.status(), `${label}: expected 422`).toBe(422);
      const body = await response.json();
      expect(body.error.code, `${label}: error code`).toBe("validation_error");
      expect(body.error.message, `${label}: error message`).toBeTruthy();
      expect(body.error.request_id, `${label}: request id`).toBeTruthy();
    }
  });
});
