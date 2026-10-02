import type { Agent, Receipt } from "./chain.ts";
import { SPRINT_START, type Snapshot } from "./snapshot.ts";
import { isTeam } from "./team.ts";

/**
 * The counting rules, as pure functions of a chain snapshot and a cut-off.
 *
 * Every rule takes a cut-off (Unix seconds) so a claim "as of" a date can be
 * checked against exactly what the chain held by then. Registrations,
 * receipts, ratings and transfers are immutable once written, so a count at a
 * past cut-off is the same on every run.
 */

/** SOW §6.3, verbatim (backend scripts/sow_metrics/config.py SOW_ROWS). */
export const SOW_ROWS = [
  { id: "m01", metric: "Externally-operated agents registered on Testnet", target: "≥ 2" },
  { id: "m02", metric: "Unique external operator wallet addresses", target: "≥ 2" },
  { id: "m03", metric: "Workflows routed to external agents & settled on Testnet", target: "≥ 3" },
  { id: "m04", metric: "On-chain USDC settlements (charges) recorded", target: "≥ 3" },
  { id: "m05", metric: "Dispute → partial-refund settlements", target: "≥ 1" },
  { id: "m06", metric: "Permissionless AgentRegistry.register flow live on the dApp", target: "Yes" },
  { id: "m07", metric: "Reputation-gated routing (reads avg_bps, applies a floor) live", target: "Yes" },
  { id: "m08", metric: "Automated dispute window + partial-credit refund live", target: "Yes" },
  { id: "m09", metric: 'Public "List your agent on Orizon" integration guide published', target: "Yes" },
  { id: "m10", metric: "3–5 min demo video published", target: "Yes" },
  { id: "m11", metric: "All source code released under MIT License", target: "Yes" },
] as const;

export const SPRINT_START_S = Date.parse(SPRINT_START) / 1000;

/** The last second of a UTC day ("2026-09-30" → 2026-09-30T23:59:59Z). */
export function endOfDay(day: string): number {
  return Date.parse(`${day}T23:59:59Z`) / 1000;
}

/** m01: agents registered by the cut-off whose owner is neither in the team register nor a platform key. */
export function externalAgents(s: Snapshot, cutoff: number): Agent[] {
  return s.agents.filter((a) => a.registeredAt <= cutoff && !isTeam(s.team, a.owner));
}

/** m02: the distinct owners of those agents. */
export function externalOwners(s: Snapshot, cutoff: number): string[] {
  return [...new Set(externalAgents(s, cutoff).map((a) => a.owner))];
}

export interface Charge extends Receipt {
  payer: string;
  /** The agent's registered owner, or null for an agent no longer in the registry. */
  owner: string | null;
  settler: string;
  version: number;
  /** The transaction that wrote the receipt, from the escrow's `charged` event, when the RPC still holds it. */
  txHash: string | null;
  /** Payer is the agent's owner, the escrow's settler or a platform key. */
  selfPayment: boolean;
  payerIsTeam: boolean;
  ownerIsTeam: boolean;
}

/** Every receipt settled from the sprint's start to the cut-off, with who paid whom. */
export function charges(s: Snapshot, cutoff: number): Charge[] {
  const owners = new Map(s.agents.map((a) => [a.id, a.owner]));
  const out: Charge[] = [];
  for (const escrow of s.escrows) {
    for (const r of escrow.receipts) {
      if (r.settledAt < SPRINT_START_S || r.settledAt > cutoff) continue;
      const auth = escrow.authorizations.get(r.authId);
      if (!auth) throw new Error(`receipt ${r.id} on ${escrow.contract} names unknown authorization ${r.authId}`);
      const owner = owners.get(r.agentId) ?? null;
      const event = s.charged.find((e) => e.escrow === escrow.contract && e.receiptId === r.id);
      out.push({
        ...r,
        payer: auth.payer,
        owner,
        settler: escrow.settler,
        version: escrow.version,
        txHash: event?.txHash ?? null,
        selfPayment: auth.payer === owner || auth.payer === escrow.settler || s.team.platform.has(auth.payer),
        payerIsTeam: isTeam(s.team, auth.payer),
        ownerIsTeam: owner === null || isTeam(s.team, owner),
      });
    }
  }
  return out;
}

/** m04 as the backend counts it: every in-sprint charge that is not a self-payment, whatever the asset. */
export function countedCharges(s: Snapshot, cutoff: number): Charge[] {
  return charges(s, cutoff).filter((c) => !c.selfPayment);
}

/** m04 as the SOW words it: counted charges settled in USDC. The escrow's asset is read from the live API. */
export function usdcCharges(s: Snapshot, cutoff: number): Charge[] {
  return s.team.network.asset === "native" ? [] : countedCharges(s, cutoff);
}
