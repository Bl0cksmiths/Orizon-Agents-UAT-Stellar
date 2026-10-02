import { readAgents, readChargedEvents, readEscrow, type Agent, type ChargedEvent, type EscrowHistory } from "./chain.ts";
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
  return { team, agents, escrows, charged, window };
}

let cached: Promise<Snapshot> | undefined;

/** One read per process: every test in a file counts from the same chain state. */
export function snapshot(): Promise<Snapshot> {
  cached ??= readSnapshot();
  return cached;
}
