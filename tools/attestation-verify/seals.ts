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
  {
    run: "v2-team-runs/h2b",
    jobId: "6dc04f8d08caf312dc1a422378468889",
    sealTx: "a705d6a437469ac1783f372bf60279f5e90a143c4fcde9bcaad20a7f24f68b02",
    claimedIn: "evidence index D4 team run 2 of 3; 5.01 v2-team-runs sheet #8",
    orchestrator: "GCNQAJE6K7LORS7CQTI7RVJTB2TZG5QADTNFDKS5H7QQKRFTRFNLA2GP",
    intentHash: "7226de9bf3fcece3994694329b433e45e2e9d19e11782c2ff9188c0fbca91886",
    agents: ["keyboardai"],
    receipts: ["00000000000000000000000000000003"],
    totalSpent: 2_000_000n,
    sealedAt: 1_790_760_652n,
  },
  {
    run: "v2-team-runs/h3",
    jobId: "dd9089ab7791c4293baf87745d1ea0b6",
    sealTx: "efca274fb83b50865cfc20dc40b6949e5abd1ae23ed3e7a7622e6c9eda37c0a8",
    claimedIn: "evidence index D4 team run 3 of 3; 5.01 v2-team-runs sheet #12",
    orchestrator: "GCNQAJE6K7LORS7CQTI7RVJTB2TZG5QADTNFDKS5H7QQKRFTRFNLA2GP",
    intentHash: "11b833a5e2b0e4aef5991a670000a941673463c028fa8f1c0343a50672f3725f",
    agents: ["calculatorai"],
    receipts: ["00000000000000000000000000000008"],
    totalSpent: 100_000n,
    sealedAt: 1_790_761_172n,
  },
  {
    run: "ac5",
    jobId: "fbc9b0e78d609571b2587a3c39c2de9c",
    sealTx: "41a159ffd7d96265dd4dd0863c0211697d94e77d636c9b9e198d8cf3cc56fd64",
    claimedIn: "5.01 ac4-ac5 sheet #5 (labelled calculatorai only); not in the evidence index",
    orchestrator: "GB4K6YRHDHB2HHNM3E7UUZJU5JP3MSQE3GXKMEA5IT4AM45D23YKAYKK",
    intentHash: "ea2c3c76199ca9f67b99101ce60163a55ff4eb274b2bcda464e8f9468480695d",
    agents: ["calculatorai", "keyboardai"],
    receipts: ["0000000000000000000000000000000a"],
    totalSpent: 100_000n,
    sealedAt: 1_790_790_452n,
  },
  {
    run: "ac4",
    jobId: "b263f1ebde6bebbde5f8b99b71e74f7c",
    sealTx: "77605170243e5e7690a5ece510144363c7a1a57aeb77ebcea2ce0e0473f9503c",
    claimedIn: "5.01 ac4-ac5 sheet #9; not in the evidence index",
    orchestrator: "GCNQAJE6K7LORS7CQTI7RVJTB2TZG5QADTNFDKS5H7QQKRFTRFNLA2GP",
    intentHash: "f08c86a137e983bcbe126706cd24932ddf374616c1acae06de5647f402bd76a6",
    agents: ["calculatorai"],
    receipts: ["0000000000000000000000000000000c"],
    totalSpent: 100_000n,
    sealedAt: 1_790_790_517n,
  },
];

/**
 * The 8 seals of 2026-05-13 to 2026-06-09 the evidence index cites as
 * pre-sprint history ("8 pre-sprint seals"), sealed by the former sealer
 * GA7AI…5OQV. Found through Horizon (the RPC keeps a week of events); their
 * ledger entries are long archived, which makes them the live check that
 * write-once survives archival.
 */
export const PRE_SPRINT_SEALS: { jobId: string; sealTx: string; sealedOn: string }[] = [
  { jobId: "1f895f9c76231a814e4df85a5b06b177", sealTx: "64f4395dbd1c6505f386a037184dd5b2aa1c7b6f72ff56075172f59e8d9618a1", sealedOn: "2026-05-13" },
  { jobId: "ab06861259027b7c15d91106302df246", sealTx: "41277b734af9bc3048326a8f425f9bdedbe29d22294fb35f7ca0ce7a127ec56e", sealedOn: "2026-05-13" },
  { jobId: "b44ea40cfba1494656f8ed6de74dfb52", sealTx: "82b5df590cff79c5a2d2ec01b27e3c34990e2cf4c6b7f203c2e97e6427d22354", sealedOn: "2026-05-14" },
  { jobId: "964245449012b8abf71123f891a45257", sealTx: "480241be88d2c6a5842bca26a7eb8290cefe4a7087c17f5d7f5ebbb12522fa7f", sealedOn: "2026-05-14" },
  { jobId: "a5bee30a100cc1ab47c761d1b4ca911e", sealTx: "f0ae4a6fc928875289f9faf1630dd4fc8e8606beb20702be3355ea3989d0c0fd", sealedOn: "2026-05-18" },
  { jobId: "e8245440f53695f45932666a528ff8a6", sealTx: "9061a314b74c73165e3bed414fcca749d380f28dc0e727422156f1639afa6ecf", sealedOn: "2026-06-09" },
  { jobId: "052d4289271335eb899abdef76f7a48a", sealTx: "41614124a7fb5cdbfa7306e64eb02feda6032eebba45fbd42dff7141702d9154", sealedOn: "2026-06-09" },
  { jobId: "558ba50de6bc09cb3014ed288f33a2cc", sealTx: "03c3f815eb9a87c705b1ee14a3ed75ba49f24c653c164c26def138dea36367b7", sealedOn: "2026-06-09" },
];
