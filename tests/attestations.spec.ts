import { test, expect } from "@playwright/test";
import { getAttestation, jobEntry, simulateSeal, SEALER, type Attestation, type EntryLifetime } from "../tools/attestation-verify/registry.ts";
import { CLAIMED_SEALS, type ClaimedSeal } from "../tools/attestation-verify/seals.ts";

/**
 * OV-03 — story 6.04: every workflow attestation the sprint claims is on the
 * deployed AttestationRegistry with the claimed contents, and is write-once.
 *
 * Every read is a Stellar RPC simulation or a ledger-entry read; nothing here
 * signs or submits. The registry never extends a job entry's TTL, so each seal
 * archives about a week after it was written. Simulation restores archived
 * entries on the fly, so `get` alone would keep passing on an archived seal:
 * the entry's live-until ledger is checked first, and a lapsed one fails with
 * "seal archived, restore needed" (docs/uat/evidence/6.04-attestations.md).
 */

const RPC_TIMEOUT = 120_000;
/** The team admin key, the registry's sealer until set_sealer of 2026-09-19 (tx c965980f…). */
const FORMER_SEALER = "GA7AI5TAJEZA27I666DSJC4MUJYBEWUYNNZWPU7R2ONA7IZQVO6R5OQV";

/** The job's ledger entry, failing loudly once it is missing or past its live-until ledger. */
async function liveEntry(jobId: string): Promise<EntryLifetime> {
  const entry = await jobEntry(jobId);
  if (!entry) throw new Error(`job ${jobId} has no ledger entry: seal archived, restore needed`);
  expect(
    entry.liveUntil,
    `job ${jobId} lived until ledger ${entry.liveUntil}, latest is ${entry.latestLedger}: seal archived, restore needed`,
  ).toBeGreaterThanOrEqual(entry.latestLedger);
  return entry;
}

/** The attestation a claim says was sealed, in the shape `get` returns. */
function claimed(seal: ClaimedSeal): Attestation {
  return {
    orchestrator: seal.orchestrator,
    intent_hash: seal.intentHash,
    agents: seal.agents,
    receipts: seal.receipts,
    total_spent: seal.totalSpent,
    sealed_at: seal.sealedAt,
  };
}

test.describe("OV-03 — claimed workflow attestations (story 6.04)", () => {
  for (const seal of CLAIMED_SEALS) {
    test(`OV-03 ${seal.run}: get returns the claimed attestation for job ${seal.jobId}`, async () => {
      test.setTimeout(RPC_TIMEOUT);
      const entry = await liveEntry(seal.jobId);
      const read = await getAttestation(seal.jobId);
      expect(read.error, `get(${seal.jobId}) failed`).toBeUndefined();
      expect(read.attestation).toEqual(claimed(seal));
      expect(entry.stored, "the stored ledger entry and the get result disagree").toEqual(read.attestation);
    });

    test(`OV-03 ${seal.run}: a re-seal of job ${seal.jobId} by the sealer fails AlreadyExists`, async () => {
      test.setTimeout(RPC_TIMEOUT);
      await liveEntry(seal.jobId);
      const probe = await simulateSeal(SEALER, seal.jobId, claimed(seal));
      expect(probe.restoreNeeded, "the re-seal simulation asked for a restore: seal archived, restore needed").toBe(false);
      expect(probe.error, "a re-seal by the sealer must reach the existence check and fail AlreadyExists (#3)").toContain(
        "Error(Contract, #3)",
      );
    });
  }

  test("OV-03: a seal by anyone but the sealer is refused Unauthorized, before the existence check", async () => {
    test.setTimeout(RPC_TIMEOUT);
    const [seal] = CLAIMED_SEALS;
    if (!seal) throw new Error("no claimed seals to probe");
    const probe = await simulateSeal(FORMER_SEALER, seal.jobId, claimed(seal));
    expect(probe.error, "the former sealer must no longer be able to seal").toContain("Error(Contract, #1)");
  });
});
