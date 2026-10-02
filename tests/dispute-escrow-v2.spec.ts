import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";
import { COLD_START_TIMEOUT } from "./fixtures";

/**
 * DE — story 6.08, dispute and refund on escrow v2 on the live deployment.
 *
 * The console dispute, the uphold and the restart are run by hand with the
 * buyer's wallet and the operator (docs/uat/evidence/6.08-dispute-escrow-v2.md).
 * This spec holds everything those runs leave behind that can be read without
 * a key: the window refusal, and for every credited dispute under test, its
 * refund and rating on Horizon and its receipt in the console.
 */

// The developer harness's two upheld disputes, the second after a Render
// restart. Their windows closed on 2026-10-01.
const CLOSED = [
  { task: "tsk_7e1c369cebaf41b3", job: "dd9089ab7791c4293baf87745d1ea0b6", closedAt: "2026-10-01T09:39:30" },
  { task: "tsk_fcd544e62f0f0958", job: "b263f1ebde6bebbde5f8b99b71e74f7c", closedAt: "2026-10-01T17:48:30" },
];

// Every credited dispute under test. The console disputes from this story are
// added here as they are upheld.
const CREDITED = ["dsp_15acee279ac02852a5877ac1696ec4b5", "dsp_d87167ccf384e41c7cc48b1e78c78e42"];

const HORIZON = "https://horizon-testnet.stellar.org";
const SIGNING_KEY = "GDB4N25UYM3YNTTAWX7LSGI2P7OR62QZQXRNQWAGF5TFVENDKCTTCDHP";

type Dispute = { status: string; payer: string; credited_usdc: number; refund_tx: string; rating_tx: string; agent_id: string };
type BalanceChange = { asset_type: string; from: string; to: string; amount: string; destination_muxed_id?: string };
type Operation = {
  source_account: string;
  transaction_successful: boolean;
  asset_balance_changes?: BalanceChange[];
  parameters?: { value: string }[];
};

/** The muxed id a dispute's refund is paid under: refund_svc.refund_muxed_id. */
function refundMuxedId(disputeId: string): string {
  const digest = createHash("sha256").update(`${disputeId}orizon-refund:v1`, "utf8").digest();
  return digest.readBigUInt64BE(0).toString();
}

/** An XDR ScVal symbol (tag 15) as Horizon gives it, or "" for anything else. */
function scSymbol(b64: string): string {
  const xdr = Buffer.from(b64, "base64");
  return xdr.readUInt32BE(0) === 15 ? xdr.subarray(8, 8 + xdr.readUInt32BE(4)).toString("utf8") : "";
}

test.describe("DE — dispute and refund on escrow v2 (story 6.08)", () => {
  for (const { job, closedAt } of CLOSED) {
    test(`DE-05 a step of ${job.slice(0, 8)}… outside its window is refused, naming when it closed`, async ({ request }) => {
      const response = await request.post("/api/disputes/challenge", {
        timeout: COLD_START_TIMEOUT,
        data: { job_id_hex: job, step_index: 0 },
      });
      expect(response.status()).toBe(409);
      const body = await response.json();
      expect(body.error?.code).toBe("dispute_window_closed");
      expect(body.error?.message).toContain(closedAt);
    });
  }

  for (const { task } of CLOSED) {
    test(`DE-05 the console says ${task}'s window has closed and offers no dispute`, async ({ page }) => {
      test.setTimeout(COLD_START_TIMEOUT * 2);
      await page.goto(`/app/trace?task=${task}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Dispute window closed", { exact: true })).toBeVisible({ timeout: COLD_START_TIMEOUT });
      await expect(page.getByText(/The dispute window closed on /)).toBeAttached();
      await expect(page.getByRole("button", { name: /dispute/i })).toHaveCount(0);
      // A finished task's trace stream keeps reconnecting and holds the context
      // open past teardown; leaving the page closes it.
      await page.goto("about:blank");
    });
  }

  for (const id of CREDITED) {
    test(`DE-03 ${id.slice(0, 12)}…'s refund is one transfer from the signing key to its payer, tagged with the dispute`, async ({ request }) => {
      const response = await request.get(`/api/disputes/${id}`, { timeout: COLD_START_TIMEOUT });
      expect(response.status()).toBe(200);
      const dispute = (await response.json()) as Dispute;
      expect(dispute.status).toBe("credited");
      const ops = await request.get(`${HORIZON}/transactions/${dispute.refund_tx}/operations`, { timeout: COLD_START_TIMEOUT });
      expect(ops.status(), `Horizon has ${dispute.refund_tx}`).toBe(200);
      const records = (await ops.json())._embedded.records as Operation[];
      expect(records).toHaveLength(1);
      expect(records[0]?.transaction_successful).toBe(true);
      expect(records[0]?.source_account, "signed by the platform's signing key").toBe(SIGNING_KEY);
      expect(records[0]?.asset_balance_changes).toEqual([
        expect.objectContaining({
          type: "transfer",
          from: SIGNING_KEY,
          to: dispute.payer,
          amount: dispute.credited_usdc.toFixed(7),
          destination_muxed_id: refundMuxedId(id),
        }),
      ]);
    });
  }

  for (const id of CREDITED) {
    test(`DE-03 ${id.slice(0, 12)}…'s rating is a kind=dispute submit against its agent, from the signing key`, async ({ request }) => {
      const dispute = (await (await request.get(`/api/disputes/${id}`, { timeout: COLD_START_TIMEOUT })).json()) as Dispute & {
        rating_confirmed: boolean;
      };
      expect(dispute.rating_confirmed).toBe(true);
      const ops = await request.get(`${HORIZON}/transactions/${dispute.rating_tx}/operations`, { timeout: COLD_START_TIMEOUT });
      expect(ops.status(), `Horizon has ${dispute.rating_tx}`).toBe(200);
      const records = (await ops.json())._embedded.records as Operation[];
      expect(records).toHaveLength(1);
      expect(records[0]?.transaction_successful).toBe(true);
      expect(records[0]?.source_account).toBe(SIGNING_KEY);
      const symbols = (records[0]?.parameters ?? []).map((parameter) => scSymbol(parameter.value));
      expect(symbols[1]).toBe("submit");
      expect(symbols).toContain(dispute.agent_id);
      expect(symbols.at(-1), "the rating's kind").toBe("dispute");
    });
  }

  test("DE-06 every credited dispute was paid exactly once across the signing key's whole history", async ({ request }) => {
    test.setTimeout(COLD_START_TIMEOUT * 2);
    const tagged: string[] = [];
    let next = `${HORIZON}/accounts/${SIGNING_KEY}/operations?order=asc&limit=200`;
    for (;;) {
      const page = await request.get(next, { timeout: COLD_START_TIMEOUT });
      expect(page.status()).toBe(200);
      const body = await page.json();
      const records = body._embedded.records as Operation[];
      for (const op of records.filter((record) => record.transaction_successful)) {
        for (const change of op.asset_balance_changes ?? []) {
          if (change.from === SIGNING_KEY && change.destination_muxed_id) tagged.push(change.destination_muxed_id);
        }
      }
      if (records.length < 200) break;
      next = body._links.next.href;
    }
    for (const id of CREDITED) {
      expect(tagged.filter((muxed) => muxed === refundMuxedId(id)), `refund transfers tagged ${id}`).toHaveLength(1);
    }
  });
});
