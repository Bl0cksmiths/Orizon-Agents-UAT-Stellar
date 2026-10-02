import { mapLimit } from "./http.ts";
import { simulate } from "./rpc.ts";
import { scSymbol, type ScValue } from "./scval.ts";
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
