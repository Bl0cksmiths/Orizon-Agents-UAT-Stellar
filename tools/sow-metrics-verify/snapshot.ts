import {
  lifetimeDisputes,
  readAgents,
  readChargedEvents,
  readEscrow,
  readRatings,
  readTransfersFrom,
  type Agent,
  type ChargedEvent,
  type EscrowHistory,
  type Rating,
  type Transfer,
} from "./chain.ts";
import { mapLimit } from "./http.ts";
import { networkPassphrase, retention, TESTNET_PASSPHRASE, type Retention } from "./rpc.ts";
import { CONTRACTS, readTeam, type Team } from "./team.ts";

/** The sprint's first day (SOW: a 30-day sprint from 2026-09-07 UTC). Activity before it is history, not sprint evidence. */
export const SPRINT_START = "2026-09-07T00:00:00Z";

export interface Snapshot {
  team: Team;
  agents: Agent[];
  escrows: EscrowHistory[];
  charged: ChargedEvent[];
  window: Retention;
  /** Every rating a platform key submitted to the ReputationLedger since the sprint began. */
  ratings: Rating[];
  /** Sum over every registered agent of the ledger's lifetime `disputed` count. */
  lifetimeDisputes: number;
  /** Asset-contract transfers out of every platform key since the sprint began. */
  transfers: Transfer[];
}

/**
 * Reads everything once. Refuses anything but testnet: the RPC and the live
 * API must both say so, or a count would be evidence of nothing.
 */
async function readSnapshot(): Promise<Snapshot> {
  const passphrase = await networkPassphrase();
  if (passphrase !== TESTNET_PASSPHRASE) throw new Error(`RPC is not testnet: ${passphrase}`);
  const team = await readTeam();
  if (team.network.network_passphrase !== TESTNET_PASSPHRASE) {
    throw new Error(`the live API is not on testnet: ${team.network.network}`);
  }
  const contracts = team.network.contracts;
  const agents = await readAgents(contracts.agent_registry);
  const escrowIds = [...new Set([contracts.payment_escrow, CONTRACTS.escrowV2, CONTRACTS.escrowV1])];
  const escrows: EscrowHistory[] = [];
  for (const id of escrowIds) escrows.push(await readEscrow(id));
  const window = await retention();
  const charged: ChargedEvent[] = [];
  for (const id of escrowIds) charged.push(...(await readChargedEvents(id, window)));
  const ratings: Rating[] = [];
  for (const key of team.platform.keys()) {
    ratings.push(...(await readRatings(contracts.reputation_ledger, key, SPRINT_START)));
  }
  const perAgent = await mapLimit(agents, 4, (a) => lifetimeDisputes(contracts.reputation_ledger, a.id));
  const disputes = perAgent.reduce((sum, n) => sum + n, 0);
  const transfers: Transfer[] = [];
  for (const key of team.platform.keys()) {
    transfers.push(...(await readTransfersFrom(key, team.network.asset_sac, SPRINT_START)));
  }
  return { team, agents, escrows, charged, window, ratings, lifetimeDisputes: disputes, transfers };
}

let cached: Promise<Snapshot> | undefined;

/** One read per process: every test in a file counts from the same chain state. */
export function snapshot(): Promise<Snapshot> {
  cached ??= readSnapshot();
  return cached;
}
