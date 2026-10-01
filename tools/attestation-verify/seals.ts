/**
 * Every workflow attestation the sprint claims, with what the claim says was
 * sealed. Expected values come from the claims, not from the chain: the
 * backend's docs/evidence/5.01/<run>/lifecycle.jsonl `settlement_checks` row
 * (its `attestation` object) and the evidence sheet that lists the seal tx.
 * The frontend's content/evidence/index.json links the three team-run seals.
 */
export type ClaimedSeal = {
  run: string;
  jobId: string;
  sealTx: string;
  claimedIn: string;
  orchestrator: string;
  intentHash: string;
  agents: string[];
  receipts: string[];
  totalSpent: bigint;
  /** Ledger close time (unix seconds) the claim records for the seal. */
  sealedAt: bigint;
};

export const CLAIMED_SEALS: ClaimedSeal[] = [
  {
    run: "v2-team-runs/h1",
    jobId: "83ca44226d0c2ad807e2f76c065d7b7b",
    sealTx: "f0b25fc59ee3c0d3e85cd9d3c92c3d18211411a1c578f8bb2bb58ea59a7e2b5c",
    claimedIn: "evidence index D4 team run 1 of 3; 5.01 v2-team-runs sheet #4",
    orchestrator: "GB4K6YRHDHB2HHNM3E7UUZJU5JP3MSQE3GXKMEA5IT4AM45D23YKAYKK",
    intentHash: "e036ad5823330d45bef4b8f0bc348bb203f426c7439748385ff24ccd2545309a",
    agents: ["calculatorai"],
    receipts: ["00000000000000000000000000000001"],
    totalSpent: 100_000n,
    sealedAt: 1_790_760_582n,
  },
];
