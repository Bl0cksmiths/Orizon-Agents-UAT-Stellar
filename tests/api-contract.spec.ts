import { test, expect } from "@playwright/test";
import { COLD_START_TIMEOUT, ONCHAIN_AGENT_ID, ONCHAIN_AGENT_OWNER } from "./fixtures";

/**
 * AZ-01..AZ-09, AM-06 and VR-01..VR-03 — API-contract, authorization,
 * agent-management and pre-signature id-availability coverage for the live
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

/**
 * VR-01, VR-02 and VR-03 — the agent-id availability endpoint's reason
 * codes. This is the pre-signature gate: the whole point of
 * GET /api/stellar/agent-id-available/{id} is that it refuses a bad id
 * BEFORE the wallet is asked to sign. If it ever started returning
 * `available: true` for a taken or malformed id, the failure would move to
 * the chain — the operator would sign, pay a fee, and get `AlreadyExists`
 * instead of an inline form message. So every case below asserts
 * `available === false` as firmly as the reason string, and for id_taken it
 * asserts the owner is returned — that's what lets the UI say who holds the
 * id.
 */
test.describe("VR — agent-id availability reason codes", () => {
  test.beforeAll(async ({ request }) => {
    // Render free tier cold-starts in 25-60s; warm it once before any
    // assertion below spends its own budget waiting on a cold instance.
    await request.get("/api/health", { timeout: COLD_START_TIMEOUT });
  });

  test("VR-01 a disallowed character or an over-length id is refused as id_malformed before any signature", async ({
    request,
  }) => {
    // Two distinct ways to fail AGENT_ID_PATTERN (^[A-Za-z0-9_]{1,32}$):
    // a charset violation, and a length violation (33+ chars). Both must be
    // caught here, at the advisory check, rather than only at the stricter
    // Path(..., pattern=...) 422 that /api/stellar/agent/{id} enforces —
    // this endpoint answers 200 with a reason so the form can show it inline.
    const cases = [
      { label: "disallowed character (hyphen)", id: "has-hyphen" },
      { label: "35 chars — over the 32 cap", id: "a".repeat(35) },
    ];

    for (const { label, id } of cases) {
      const response = await request.get(`/api/stellar/agent-id-available/${id}`, {
        timeout: COLD_START_TIMEOUT,
      });
      expect(response.status(), `${label}: advisory 200, never a bare 422`).toBe(200);
      const body = await response.json();
      expect(body, label).toEqual({
        available: false,
        reason: "id_malformed",
        message: "allowed: letters, digits and underscore, 1-32 chars",
        owner: null,
      });
    }
  });

  test("VR-02 an agt_-prefixed id is refused as id_reserved", async ({ request }) => {
    // The seeded catalog owns the agt_ namespace — an operator-chosen id in
    // that namespace must be refused here, before a signature, not only at
    // build/register-agent (see AZ-05) after the wallet is already involved.
    const response = await request.get("/api/stellar/agent-id-available/agt_01h8", {
      timeout: COLD_START_TIMEOUT,
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      available: false,
      reason: "id_reserved",
      message: "agt_ ids belong to the seeded catalog",
      owner: null,
    });
  });

  test("VR-03 an id already registered on-chain is refused as id_taken and names the current owner", async ({
    request,
  }) => {
    // ONCHAIN_AGENT_ID/OWNER are read from the live registry (fixtures.ts),
    // not hardcoded blind, so a reseed fails this loudly rather than
    // silently asserting nothing. `owner` is the field that lets the UI
    // say who holds the id — assert it as firmly as `available` and `reason`.
    const response = await request.get(`/api/stellar/agent-id-available/${ONCHAIN_AGENT_ID}`, {
      timeout: COLD_START_TIMEOUT,
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      available: false,
      reason: "id_taken",
      message: null,
      owner: ONCHAIN_AGENT_OWNER,
    });
  });

  test("VR-01/02/03 a well-formed, non-reserved, never-registered id is available", async ({ request }) => {
    // The contrast case: proves the endpoint isn't hardcoded to always
    // refuse — a genuinely free id must come back available with every
    // reason field null, or the malformed/reserved/taken assertions above
    // would be trivially satisfied by an endpoint that refuses everything.
    const response = await request.get("/api/stellar/agent-id-available/fresh_id_probe_xyz", {
      timeout: COLD_START_TIMEOUT,
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      available: true,
      reason: null,
      message: null,
      owner: null,
    });
  });

  test("VR-01 build/register-agent's own pattern guard is a different mechanism and answers differently", async ({
    request,
  }) => {
    // Two independent layers exist: this availability endpoint returns a
    // friendly 200 + id_malformed (asserted above), while
    // build/register-agent's RegisterAgentReq field carries its own
    // Pydantic `pattern=AGENT_ID_PATTERN` and refuses the same bad id with
    // 422 validation_error instead — never id_malformed. Pinning both
    // shapes stops a future change from "helpfully" unifying them and
    // silently removing the pre-signature gate this whole suite exists to
    // protect.
    const owner = `G${"A".repeat(55)}`;
    const response = await request.post("/api/stellar/build/register-agent", {
      timeout: COLD_START_TIMEOUT,
      data: {
        owner,
        agent_id: "has-hyphen",
        name: "probe",
        skills: [],
        price_usdc: 1,
      },
    });
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toBeTruthy();
    expect(body.error.request_id).toBeTruthy();
    // Never id_malformed here — that reason string belongs exclusively to
    // the availability endpoint's own check.
    expect(body.error.code).not.toBe("id_malformed");
  });
});

/**
 * PR-01, PR-05 and the mapping PR-02/PR-03 depend on — on-chain provenance
 * in the marketplace and the on-demand sync path. Every shape below was
 * confirmed against the live deployment (GET /api/agents, POST
 * /api/stellar/agents/sync, GET /api/stellar/agent/{id}) before being
 * written. PR-02/PR-03/PR-04's write halves need a signed transaction and
 * stay out of scope here (testnet-only programme, target reports mainnet —
 * D-001); this suite only ever reads and calls the read-only sync mirror.
 */
test.describe("PR — on-chain provenance and sync", () => {
  test.beforeAll(async ({ request }) => {
    // Render free tier cold-starts in 25-60s; warm it once before any
    // assertion below spends its own budget waiting on a cold instance.
    await request.get("/api/health", { timeout: COLD_START_TIMEOUT });
  });

  test("PR-01 seeded and on-chain agents are distinguishable in both directions", async ({ request }) => {
    const response = await request.get("/api/agents", { timeout: COLD_START_TIMEOUT });
    expect(response.ok()).toBe(true);
    const agents: Array<{ id: string; source: string; owner: string | null }> = await response.json();

    const seeded = agents.filter((a) => a.source === "seeded");
    const onchain = agents.filter((a) => a.source === "onchain");

    // Pinned to exactly 12 so a reseed that changes the catalog size fails
    // loudly here rather than the direction checks below passing vacuously
    // over an empty or shrunk seeded set.
    expect(seeded.length, "exactly 12 seeded catalog agents").toBe(12);
    expect(onchain.length, "at least one on-chain agent is mirrored").toBeGreaterThan(0);

    for (const agent of seeded) {
      expect(agent.id.startsWith("agt_"), `seeded agent ${agent.id} carries the agt_ namespace`).toBe(true);
      expect(agent.owner, `seeded agent ${agent.id} has a null owner`).toBeNull();
    }

    for (const agent of onchain) {
      expect(agent.owner, `on-chain agent ${agent.id} has a non-null owner`).toBeTruthy();
      expect(agent.id.startsWith("agt_"), `on-chain agent ${agent.id} is outside the agt_ namespace`).toBe(false);
    }
  });

  test("PR-01 the on-chain agent's marketplace owner mirrors the raw contract read", async ({ request }) => {
    const agentsResponse = await request.get("/api/agents", { timeout: COLD_START_TIMEOUT });
    expect(agentsResponse.ok()).toBe(true);
    const agents: Array<{ id: string; owner: string | null }> = await agentsResponse.json();
    const onchainAgent = agents.find((a) => a.id === ONCHAIN_AGENT_ID);
    expect(onchainAgent, `${ONCHAIN_AGENT_ID} is listed in the marketplace`).toBeTruthy();

    const rawResponse = await request.get(`/api/stellar/agent/${ONCHAIN_AGENT_ID}`, { timeout: COLD_START_TIMEOUT });
    expect(rawResponse.ok()).toBe(true);
    const raw: { agent: { owner: string } } = await rawResponse.json();

    // The assertion that proves the marketplace mirrors the chain rather
    // than inventing a value: the same owner must appear on both reads.
    expect(onchainAgent!.owner, "marketplace owner matches the raw contract owner").toBe(raw.agent.owner);
    expect(onchainAgent!.owner, "matches the known on-chain agent owner").toBe(ONCHAIN_AGENT_OWNER);
  });

  test("PR-02/PR-03 the raw contract's active flag agrees with the marketplace status", async ({ request }) => {
    // app/services/registry_sync.py maps status = "online" if raw["active"]
    // else "offline". Flipping the flag needs a signed transaction (out of
    // scope: testnet-only programme, target reports mainnet — D-001), but
    // pinning that the two views currently agree is exactly what a broken
    // sync pass would violate.
    const rawResponse = await request.get(`/api/stellar/agent/${ONCHAIN_AGENT_ID}`, { timeout: COLD_START_TIMEOUT });
    expect(rawResponse.ok()).toBe(true);
    const raw: { agent: { active: boolean } } = await rawResponse.json();

    const agentsResponse = await request.get("/api/agents", { timeout: COLD_START_TIMEOUT });
    expect(agentsResponse.ok()).toBe(true);
    const agents: Array<{ id: string; status: string }> = await agentsResponse.json();
    const onchainAgent = agents.find((a) => a.id === ONCHAIN_AGENT_ID);
    expect(onchainAgent, `${ONCHAIN_AGENT_ID} is listed in the marketplace`).toBeTruthy();

    const expectedStatus = raw.agent.active ? "online" : "offline";
    expect(onchainAgent!.status, "active <-> status mapping holds").toBe(expectedStatus);
  });

  test("PR-05 the sync endpoint returns a numeric count and is idempotent for an unchanged chain", async ({
    request,
  }) => {
    const before = await request.get("/api/agents", { timeout: COLD_START_TIMEOUT });
    expect(before.ok()).toBe(true);
    const beforeAgents: Array<{ id: string }> = await before.json();

    // Read-only mirror pass — safe to call, never a broadcast. This is the
    // mechanism that makes PR-04 immediate rather than eventual.
    const syncResponse = await request.post("/api/stellar/agents/sync", { timeout: COLD_START_TIMEOUT });
    expect(syncResponse.status(), "sync is read-only and always answers 200").toBe(200);
    const syncBody: { synced: number } = await syncResponse.json();
    expect(Number.isInteger(syncBody.synced), "synced is a numeric count").toBe(true);
    expect(syncBody.synced, "at least the one on-chain agent is mirrored").toBeGreaterThan(0);

    const after = await request.get("/api/agents", { timeout: COLD_START_TIMEOUT });
    expect(after.ok()).toBe(true);
    const afterAgents: Array<{ id: string }> = await after.json();

    // Idempotent for an unchanged chain: same agents, same count — a sync
    // pass mirrors, it never duplicates or drops entries.
    expect(afterAgents.length, "agent count is unchanged by a sync pass").toBe(beforeAgents.length);
    expect(
      afterAgents.map((a) => a.id).sort(),
      "the same set of agent ids is present after a sync pass",
    ).toEqual(beforeAgents.map((a) => a.id).sort());
  });

  test("marketplace price mirrors the raw contract price divided by 1e7", async ({ request }) => {
    const rawResponse = await request.get(`/api/stellar/agent/${ONCHAIN_AGENT_ID}`, { timeout: COLD_START_TIMEOUT });
    expect(rawResponse.ok()).toBe(true);
    const raw: { agent: { price: number } } = await rawResponse.json();

    const agentsResponse = await request.get("/api/agents", { timeout: COLD_START_TIMEOUT });
    expect(agentsResponse.ok()).toBe(true);
    const agents: Array<{ id: string; price: number }> = await agentsResponse.json();
    const onchainAgent = agents.find((a) => a.id === ONCHAIN_AGENT_ID);
    expect(onchainAgent, `${ONCHAIN_AGENT_ID} is listed in the marketplace`).toBeTruthy();

    // orizon_batch is registered free (price 0) ON PURPOSE — a free
    // meta-agent, with the payer setting the spend cap per workflow. 0 is a
    // valid mirrored price here, not a sign the mapping failed.
    expect(onchainAgent!.price, "marketplace price equals raw price / 1e7").toBe(raw.agent.price / 1e7);
  });
});
