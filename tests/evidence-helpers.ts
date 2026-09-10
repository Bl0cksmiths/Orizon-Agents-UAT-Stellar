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
