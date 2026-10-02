/**
 * Prints the OV-03 evidence (docs/uat/evidence/6.04-attestations.md) as
 * Markdown, read live from testnet: for every claimed seal, `get`, the stored
 * entry's live-until ledger as an approximate UTC date, and the sealer's
 * re-seal simulation. Reads and simulations only; nothing is signed.
 *
 *   node --no-warnings tools/attestation-verify/capture.ts
 */
import { isDeepStrictEqual } from "node:util";
import { ledgerClock } from "./clock.ts";
import { getAttestation, jobEntry, REGISTRY, SEALER, simulateSeal, type Attestation } from "./registry.ts";
import { CLAIMED_SEALS } from "./seals.ts";

const short = (hex: string) => `\`${hex.slice(0, 8)}…\``;
const utc = (date: Date) => date.toISOString().slice(0, 16).replace("T", " ") + "Z";

const clock = await ledgerClock();
console.log(`Registry \`${REGISTRY}\`, sealer \`${SEALER}\`.`);
console.log(`Read at ledger ${clock.latest} (closed ${utc(clock.latestClose)}), ${clock.secondsPerLedger.toFixed(2)} s per ledger over the last day.\n`);
console.log("| run | job id | seal tx | get: agents | receipts | total_spent | orchestrator | intent_hash | sealed_at | matches claim | re-seal by sealer | live until ≈ UTC |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");

for (const seal of CLAIMED_SEALS) {
  const read = await getAttestation(seal.jobId);
  const entry = await jobEntry(seal.jobId);
  const got = read.attestation;
  const claim: Attestation = {
    orchestrator: seal.orchestrator,
    intent_hash: seal.intentHash,
    agents: seal.agents,
    receipts: seal.receipts,
    total_spent: seal.totalSpent,
    sealed_at: seal.sealedAt,
  };
  const reseal = await simulateSeal(SEALER, seal.jobId, claim);
  const matches = isDeepStrictEqual(got, claim);
  const cells = got
    ? [
        got.agents.join(", "),
        got.receipts.map((receipt) => `\`${receipt.replace(/^0+/, "") || "0"}\``).join(", "),
        String(got.total_spent),
        `\`${got.orchestrator.slice(0, 5)}…${got.orchestrator.slice(-4)}\``,
        short(got.intent_hash),
        utc(new Date(Number(got.sealed_at) * 1000)),
      ]
    : [`get failed: ${read.error}`, "", "", "", "", ""];
  const lifetime = entry ? `${entry.liveUntil} ≈ ${utc(clock.at(entry.liveUntil))}` : "no entry (archived)";
  console.log(`| ${seal.run} | \`${seal.jobId}\` | ${short(seal.sealTx)} | ${cells.join(" | ")} | ${matches ? "yes" : "NO"} | ${reseal.error ?? "no error"} | ${lifetime} |`);
}
