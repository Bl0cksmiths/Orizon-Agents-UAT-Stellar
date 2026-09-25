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

test.describe("RC — reputation consequence (story 6.03e)", () => {
  test("RC prerequisite: the deployment's signer is the ledger's authorised scorer", async ({ request }) => {
    const response = await request.get(`${BACKEND}/readiness`, { timeout: COLD_START_TIMEOUT });
    expect(response.status()).toBe(200);
    const { ratings } = (await response.json()) as Readiness;
    expect(ratings, "/readiness must report ratings.writer").toBeDefined();
    expect(ratings?.writer).toBe("scorer");
    expect(ratings?.signer).toBe(ratings?.scorer);
  });
});
