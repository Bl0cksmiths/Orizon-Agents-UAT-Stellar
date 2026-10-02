import { mapLimit } from "./http.ts";
import { contractEvents, instanceStorage, simulate, SimulationFailed, type Retention } from "./rpc.ts";
import { escrowId, scSymbol, type ScValue } from "./scval.ts";
import { isAccountId } from "./strkey.ts";

/**
 * The chain facts the eleven metrics are counted from, read without the
 * backend: the registry's agents, every receipt and authorization each
 * escrow has issued, the escrow and ledger events the RPC still holds, and
 * the platform keys' asset transfers from Horizon.
 */

type Obj = { [key: string]: ScValue };

/** Simulations in flight at once: quick enough for a test, gentle on the public RPC. */
const CONCURRENCY = 4;

function obj(value: ScValue, what: string): Obj {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${what} is not a record`);
  return value;
}

function str(value: ScValue | undefined, what: string): string {
  if (typeof value !== "string") throw new Error(`${what} is not text`);
  return value;
}

function int(value: ScValue | undefined, what: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  throw new Error(`${what} is not an integer`);
}

export interface Agent {
  id: string;
  owner: string;
  name: string;
  active: boolean;
  /** Unix seconds. */
  registeredAt: number;
}

export async function readAgents(registry: string): Promise<Agent[]> {
  const ids = await simulate(registry, "list_ids");
  if (!Array.isArray(ids)) throw new Error("list_ids did not answer a list");
  return mapLimit(ids, CONCURRENCY, async (id) => {
    const agentId = str(id, "agent id");
    const record = obj(await simulate(registry, "get", [scSymbol(agentId)]), `get(${agentId})`);
    const owner = str(record.owner, `${agentId} owner`);
    if (!isAccountId(owner)) throw new Error(`${agentId} owner is not an account: ${owner}`);
    return {
      id: agentId,
      owner,
      name: str(record.name, `${agentId} name`),
      active: record.active === true,
      registeredAt: Number(int(record.registered_at, `${agentId} registered_at`)),
    };
  });
}

export interface Receipt {
  escrow: string;
  id: string;
  authId: string;
  agentId: string;
  amount: bigint;
  jobId: string;
  /** Unix seconds. */
  settledAt: number;
}

export interface Authorization {
  id: string;
  payer: string;
  agentId: string;
  maxAmount: bigint;
  spent: bigint;
}

export interface EscrowHistory {
  contract: string;
  version: number;
  settler: string;
  nonce: number;
  receipts: Receipt[];
  authorizations: Map<string, Authorization>;
  /** Ids the counter issued that read as neither a receipt nor an authorization. */
  unreadable: string[];
}

type EscrowRead =
  | { kind: "receipt"; receipt: Receipt }
  | { kind: "authorization"; authorization: Authorization }
  | { kind: "unreadable"; id: string };

/** Escrow id `n`, read as a receipt or else an authorization. */
async function readEscrowId(contract: string, n: number): Promise<EscrowRead> {
  const id = n.toString(16).padStart(32, "0");
  try {
    const r = obj(await simulate(contract, "receipt", [escrowId(n)]), `receipt ${id}`);
    return {
      kind: "receipt",
      receipt: {
        escrow: contract,
        id,
        authId: str(r.auth_id, "auth_id"),
        agentId: str(r.agent_id, "agent_id"),
        amount: int(r.amount, "amount"),
        jobId: str(r.job_id, "job_id"),
        settledAt: Number(int(r.settled_at, "settled_at")),
      },
    };
  } catch (error) {
    if (!(error instanceof SimulationFailed)) throw error;
  }
  try {
    const a = obj(await simulate(contract, "authorization", [escrowId(n)]), `authorization ${id}`);
    return {
      kind: "authorization",
      authorization: {
        id,
        payer: str(a.payer, "payer"),
        agentId: str(a.agent_id, "agent_id"),
        maxAmount: int(a.max_amount, "max_amount"),
        spent: int(a.spent, "spent"),
      },
    };
  } catch (error) {
    if (!(error instanceof SimulationFailed)) throw error;
    return { kind: "unreadable", id };
  }
}

/**
 * Every id the escrow's instance `Nonce` has issued, each read as a receipt or
 * else an authorization. One counter numbers both, so ids 0..Nonce-1 are the
 * escrow's whole history, however long ago it happened.
 */
export async function readEscrow(contract: string): Promise<EscrowHistory> {
  const storage = await instanceStorage(contract);
  const nonce = Number(int(storage.Nonce, `${contract} Nonce`));
  let version = 1;
  try {
    version = Number(int(await simulate(contract, "version"), "version"));
  } catch (error) {
    if (!(error instanceof SimulationFailed)) throw error;
  }
  const history: EscrowHistory = {
    contract,
    version,
    settler: str(storage.Settler, `${contract} Settler`),
    nonce,
    receipts: [],
    authorizations: new Map(),
    unreadable: [],
  };
  const ids = Array.from({ length: nonce }, (_, n) => n);
  const reads = await mapLimit(ids, CONCURRENCY, (n) => readEscrowId(contract, n));
  for (const read of reads) {
    if (read.kind === "receipt") history.receipts.push(read.receipt);
    else if (read.kind === "authorization") history.authorizations.set(read.authorization.id, read.authorization);
    else history.unreadable.push(read.id);
  }
  return history;
}

export interface ChargedEvent {
  escrow: string;
  receiptId: string;
  authId: string;
  agentId: string;
  amount: bigint;
  jobId: string;
  txHash: string;
  closedAt: string;
}

/** The escrow's `charged` events the RPC still holds: one per receipt, with the transaction that wrote it. */
export async function readChargedEvents(contract: string, window: Retention): Promise<ChargedEvent[]> {
  const events = await contractEvents(contract, window.oldestLedger, window.latestLedger);
  return events
    .filter((e) => e.topics[0] === "charged")
    .map((e) => {
      const v = e.value;
      if (!Array.isArray(v) || v.length < 4) throw new Error(`charged event in ${e.txHash} has an unexpected shape`);
      return {
        escrow: contract,
        receiptId: str(v[0], "receipt id"),
        authId: str(v[1], "auth id"),
        agentId: str(e.topics[1], "agent id"),
        amount: int(v[2], "amount"),
        jobId: str(v[3], "job id"),
        txHash: e.txHash,
        closedAt: e.closedAt,
      };
    });
}
