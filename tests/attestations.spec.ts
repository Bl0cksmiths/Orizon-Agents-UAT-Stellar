import { test, expect } from "@playwright/test";
import { getAttestation, jobEntry, type EntryLifetime } from "../tools/attestation-verify/registry.ts";
import { CLAIMED_SEALS } from "../tools/attestation-verify/seals.ts";

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

test.describe("OV-03 — claimed workflow attestations (story 6.04)", () => {
  for (const seal of CLAIMED_SEALS) {
    test(`OV-03 ${seal.run}: get returns the claimed attestation for job ${seal.jobId}`, async () => {
      test.setTimeout(RPC_TIMEOUT);
      const entry = await liveEntry(seal.jobId);
      const read = await getAttestation(seal.jobId);
      expect(read.error, `get(${seal.jobId}) failed`).toBeUndefined();
      expect(read.attestation).toEqual({
        orchestrator: seal.orchestrator,
        intent_hash: seal.intentHash,
        agents: seal.agents,
        receipts: seal.receipts,
        total_spent: seal.totalSpent,
        sealed_at: seal.sealedAt,
      });
      expect(entry.stored, "the stored ledger entry and the get result disagree").toEqual(read.attestation);
    });
  }
});
