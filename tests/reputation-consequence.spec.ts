import { test, expect } from "@playwright/test";
import { COLD_START_TIMEOUT } from "./fixtures";

/**
 * RC — story 6.03e, what an upheld dispute costs the agent, and what the next
 * buyer sees.
 *
 * No dispute can be upheld on the deploy: no run settles (D-050) and the
 * adjudication route is switched off (D-051). The upheld path therefore ran on
 * testnet against the drill's own ReputationLedger, with the deployed ledger's
 * wasm (tools/reputation-drill/, docs/uat/evidence/6.03e-reputation-consequence.md).
 * What these tests hold live is everything that path relies on here: the
 * signer is the ledger's scorer, and a plan stamps the numbers the reputation
 * route reads.
 */

// /readiness is served by the backend itself; the frontend's /api/* proxy
// does not forward it.
const BACKEND = "https://orizon-agents-be-stellar.onrender.com";

type Readiness = { ratings?: { writer: string; signer: string; scorer: string } };
type Rep = { count: number; dispute_rate_bps: number; smoothed_bps: number };
type Stamp = {
  agent_id: string;
  rep_bps: number;
  rep_source: string;
  rep_count: number;
  rep_dispute_rate_bps: number;
  rep_degraded: boolean;
};

const AGENT = "agt_09l5";

const HORIZON = "https://horizon-testnet.stellar.org";
const TX_HASH = /^[0-9a-f]{64}$/;
const UPHELD = "dsp_15acee279ac02852a5877ac1696ec4b5";
type Upheld = { status: string; refund_tx: string; rating_tx: string; rating_confirmed: boolean };

test.describe("RC — reputation consequence (story 6.03e)", () => {
  test("RC prerequisite: the deployment's signer is the ledger's authorised scorer", async ({ request }) => {
    const response = await request.get(`${BACKEND}/readiness`, { timeout: COLD_START_TIMEOUT });
    expect(response.status()).toBe(200);
    const { ratings } = (await response.json()) as Readiness;
    expect(ratings, "/readiness must report ratings.writer").toBeDefined();
    expect(ratings?.writer).toBe("scorer");
    expect(ratings?.signer).toBe(ratings?.scorer);
  });

  test("RC-04 a new plan stamps the count and dispute rate the reputation route reads", async ({ request }) => {
    // The calculator kit's research step is always agt_09l5. A plan whose batch
    // read ran out of time is scored on the prior and says so (rep_degraded);
    // only a plan that read the ledger is compared.
    const route = async () =>
      (await (await request.get(`/api/stellar/reputation/${AGENT}`, { timeout: COLD_START_TIMEOUT })).json()) as Rep;
    const stamp = async () => {
      const response = await request.post("/api/orchestrator/decompose", {
        timeout: COLD_START_TIMEOUT,
        data: { intent: "Build me a calculator app" },
      });
      expect(response.status()).toBe(200);
      const { steps } = (await response.json()) as { steps: Stamp[] };
      return steps.find((step) => step.agent_id === AGENT);
    };
    await expect.poll(async () => (await stamp())?.rep_degraded, { timeout: 120_000, intervals: [2_000] }).toBe(false);
    const plan = await stamp();
    const rep = await route();
    expect(plan?.rep_source).toBe("onchain");
    expect(plan?.rep_count).toBe(rep.count);
    expect(plan?.rep_dispute_rate_bps).toBe(rep.dispute_rate_bps);
    expect(plan?.rep_bps).toBe(rep.smoothed_bps);
  });

  test("RC-01 an upheld dispute exists on the deploy, its refund and rating on chain", async ({ request }) => {
    // Upheld on 2026-09-30 while refunds were on. This reads what happened then; it says nothing
    // about how the refund switch is set now.
    const response = await request.get(`/api/disputes/${UPHELD}`, { timeout: COLD_START_TIMEOUT });
    expect(response.status()).toBe(200);
    const dispute = (await response.json()) as Upheld;
    expect(dispute.status).toBe("credited");
    expect(dispute.refund_tx).toMatch(TX_HASH);
    expect(dispute.rating_tx).toMatch(TX_HASH);
    expect(dispute.rating_confirmed).toBe(true);
    for (const hash of [dispute.refund_tx, dispute.rating_tx]) {
      const tx = await request.get(`${HORIZON}/transactions/${hash}`, { timeout: COLD_START_TIMEOUT });
      expect(tx.status(), `Horizon has ${hash}`).toBe(200);
      expect((await tx.json()).successful, `${hash} succeeded`).toBe(true);
    }
  });
});
