import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { verifyDispatch } from "../tools/operator-endpoint/verify-dispatch.ts";
import { COLD_START_TIMEOUT } from "./fixtures";

/**
 * EX — story 6.05, the external agent execution path on the deployed service.
 *
 * The dispatch below is not a fixture anyone wrote: it is the request the
 * deployed backend actually sent to the UAT operator endpoint on 2026-09-17,
 * recorded byte-for-byte before parsing (docs/uat/evidence/6.05-external-dispatch.md).
 * What these tests re-check live is the half an operator relies on — that the
 * signer published at GET /api/stellar/network still verifies it.
 */

interface CapturedDispatch {
  bound_endpoint_url: string;
  headers: Record<string, string>;
  raw_body_base64: string;
}

const captured = JSON.parse(
  readFileSync(join(__dirname, "..", "docs", "uat", "evidence", "6.05", "dispatch-2026-09-24.json"), "utf8"),
) as CapturedDispatch;
const rawBody = Buffer.from(captured.raw_body_base64, "base64");
const signature = captured.headers["x-orizon-signature"] ?? "";

// Registered and bound on testnet by the 6.05 run, and deliberately never
// cleaned up: registration tx 64ad14cd…fa3e.
const EX_AGENT_ID = "uat605_ext_op";
const EX_AGENT_OWNER = "GBWMD26IB6CMG3JO3HU7SD7ZJSTF4BIJ5JS77ANMLJ52M6FV6K3J7BQJ";
// Registered and bound for the 2026-09-24 re-run, by the same owner:
// registration tx e3f58a12…ce1b. The capture above is its first dispatch.
const RERUN_AGENT_ID = "uat624_ext_op";

async function publishedSigner(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const response = await request.get("/api/stellar/network", { timeout: COLD_START_TIMEOUT });
  expect(response.status()).toBe(200);
  const signer = (await response.json()).dispatch_signer as string | null;
  expect(signer, "a deployment with no dispatch key signs nothing").toMatch(/^G[A-Z2-7]{55}$/);
  return signer as string;
}

test.describe("EX — external agent dispatch (story 6.05)", () => {
  test("EX-03 the captured dispatch verifies against the published signer and the bound URL", async ({ request }) => {
    const pinnedSigner = await publishedSigner(request);
    expect(
      verifyDispatch({ rawBody, signatureBase64: signature, pinnedSigner, boundEndpointUrl: captured.bound_endpoint_url }),
    ).toBe(true);
  });

  test("EX-03 a tampered body fails verification", async ({ request }) => {
    const pinnedSigner = await publishedSigner(request);
    const tampered = Buffer.from(rawBody.toString("utf8").replace('"network":"testnet"', '"network":"mainnet"'));
    expect(tampered.equals(rawBody), "the tamper must actually change the bytes").toBe(false);
    expect(
      verifyDispatch({ rawBody: tampered, signatureBase64: signature, pinnedSigner, boundEndpointUrl: captured.bound_endpoint_url }),
    ).toBe(false);
  });

  test("EX-03 the same signature replayed against a different endpoint URL fails", async ({ request }) => {
    const pinnedSigner = await publishedSigner(request);
    expect(
      verifyDispatch({
        rawBody,
        signatureBase64: signature,
        pinnedSigner,
        boundEndpointUrl: "https://another-operator.example/dispatch",
      }),
    ).toBe(false);
  });

  test("EX-01 EX-07 the run's binding still reads back, owned by the registering wallet", async ({ request }) => {
    const response = await request.get(`/api/agents/${EX_AGENT_ID}/binding`, { timeout: COLD_START_TIMEOUT });
    expect(response.status()).toBe(200);
    const binding = await response.json();
    expect(binding.agent_id).toBe(EX_AGENT_ID);
    expect(binding.owner).toBe(EX_AGENT_OWNER);
    // Anonymous reads get the origin only; any https origin proves a binding exists.
    expect(binding.endpoint_url).toMatch(/^https:\/\/[^/]+$/);
  });

  test("EX-02 EX-07 a matching intent is decomposed onto the bound external agent", async ({ request }) => {
    test.setTimeout(COLD_START_TIMEOUT * 2);
    const response = await request.post("/api/orchestrator/decompose", {
      timeout: COLD_START_TIMEOUT,
      data: { intent: "Write a short haiku poem about the Stellar testnet" },
    });
    expect(response.status()).toBe(200);
    const plan = await response.json();
    const agentIds = (plan.steps as { agent_id: string }[]).map((step) => step.agent_id);
    expect(agentIds, "offered to the planner, not merely listed").toContain(EX_AGENT_ID);
  });

  test("EX-00 the settlement evidence route is deployed", async ({ request }) => {
    // 6.05's entry criterion. Was D-036 (route missing on the deployed build);
    // the backend was redeployed on 2026-09-24 and it answers.
    const response = await request.get(`/api/stellar/settlement/${EX_AGENT_ID}`, { timeout: COLD_START_TIMEOUT });
    expect(response.status()).toBe(200);
  });

  test("EX-06 the re-run agent carries on-chain ratings, not the cold-start prior", async ({ request }) => {
    // Was D-038: ratings were gated on a settlement that never lands, so a
    // delivered or failed step changed nothing. The 2026-09-24 re-run put 7
    // ratings on ReputationLedger for this agent across 7 workflows.
    const response = await request.get(`/api/stellar/reputation/${RERUN_AGENT_ID}`, { timeout: COLD_START_TIMEOUT });
    expect(response.status()).toBe(200);
    const reputation = await response.json();
    expect(reputation.source, "a rated agent no longer reads from the prior").toBe("onchain");
    expect(reputation.count, "one rating per finished workflow").toBeGreaterThan(0);
  });

  test("EX-02 the captured dispatch envelope carries the documented fields", () => {
    // Was D-040 (no deadline_ms on the old build). The 2026-09-24 re-run
    // captured an envelope that carries it, against the re-run's own agent.
    const body = JSON.parse(rawBody.toString("utf8"));
    expect(captured.headers["idempotency-key"]).toBe(body.dispatch_id);
    expect(captured.headers["x-orizon-signature-version"]).toBe("orizon-dispatch:v1");
    expect(body).toMatchObject({ v: 2, agent_id: RERUN_AGENT_ID, network: "testnet" });
    expect(typeof body.ts).toBe("number");
    expect(typeof body.deadline_ms).toBe("number");
  });
});
