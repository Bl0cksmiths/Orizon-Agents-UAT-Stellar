/**
 * Pure-logic mirror of the FE's stellar.expert link builder
 * (components/ui/stellar-link.tsx). Duplicated, not imported — these specs
 * ship outside the app's TypeScript project and have no module resolution
 * into it (the UAT suite runs against the deployed site, not the source
 * tree; see tests/registry.spec.ts's reputation-math block for the same
 * pattern). Kept byte-for-byte faithful to `explorerSegment` as read from
 * that file so EV-05 assertions check the real algorithm, not a paraphrase.
 * If components/ui/stellar-link.tsx's segment resolution changes, this must
 * change with it.
 */
export function explorerSegment(network: string): "public" | "testnet" {
  return network === "mainnet" || network === "public" ? "public" : "testnet";
}

/** Mirrors `stellarExpertUrl` in components/ui/stellar-link.tsx. */
export function stellarExpertUrl(
  kind: "tx" | "account" | "contract",
  id: string,
  network: string,
): string {
  return `https://stellar.expert/explorer/${explorerSegment(network)}/${kind}/${id}`;
}

/**
 * Mirrors `buildRegistrationEvidence` in lib/registration-evidence.ts —
 * same duplication rationale as above. The network line and both explorer
 * links are derived from `e.network`, never a fixed string, which is the
 * exact property EV-05 requires.
 */
export type RegistrationEvidenceInput = {
  agentId: string;
  owner: string;
  txHash: string;
  network: "testnet" | "public";
  capturedAt?: string;
};

export function buildRegistrationEvidence(
  e: RegistrationEvidenceInput,
): string {
  const captured = e.capturedAt ?? new Date().toISOString();
  const seg = e.network === "public" ? "public" : "testnet";
  const label = e.network === "public" ? "mainnet" : "testnet";
  return [
    "Orizon Agents — registration evidence",
    `agent id:  ${e.agentId}`,
    `owner:     ${e.owner}`,
    `tx hash:   ${e.txHash}`,
    `network:   ${label}`,
    `tx:        https://stellar.expert/explorer/${seg}/tx/${e.txHash}`,
    `account:   https://stellar.expert/explorer/${seg}/account/${e.owner}`,
    `captured:  ${captured}`,
  ].join("\n");
}
