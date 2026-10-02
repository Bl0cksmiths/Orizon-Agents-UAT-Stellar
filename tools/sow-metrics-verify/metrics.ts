import type { Agent } from "./chain.ts";
import type { Snapshot } from "./snapshot.ts";
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
