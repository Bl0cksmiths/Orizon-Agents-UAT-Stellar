/**
 * Reads contract storage straight from Stellar RPC testnet (getLedgerEntries),
 * so a claim about who administers a contract, who owns an agent or how many
 * ratings exist is checked against ledger state, not against the app.
 */

import { decodeContractData, encodeAddress, encodeScKey, type ScKey, type ScValue } from "./scval.ts";

export const RPC_TESTNET = "https://soroban-testnet.stellar.org";

/** One JSON POST returning the HTTP status and the parsed JSON body. */
export type PostJson = (url: string, body: unknown) => Promise<{ status: number; body: unknown }>;

/** A contract-data key: the instance entry, or a persistent storage key. */
export type StorageKey = "instance" | ScKey;

/** Base64 `LedgerKey` XDR for one contract-data entry. */
export function ledgerKey(contract: string, key: StorageKey): string {
  const scKey = key === "instance" ? Buffer.from([0, 0, 0, 20]) : encodeScKey(key);
  const durability = Buffer.from([0, 0, 0, 1]);
  return Buffer.concat([Buffer.from([0, 0, 0, 6]), encodeAddress(contract), scKey, durability])
    .toString("base64");
}

type RpcEntry = { key: string; xdr: string };

/**
 * The values stored under `keys` in `contract`, in the same order; undefined
 * where the ledger has no live entry for that key.
 */
export async function readContractData(
  post: PostJson,
  contract: string,
  keys: StorageKey[],
): Promise<(ScValue | undefined)[]> {
  const encoded = keys.map((key) => ledgerKey(contract, key));
  const found = new Map<string, ScValue>();
  for (let start = 0; start < encoded.length; start += 200) {
    const batch = encoded.slice(start, start + 200);
    const res = await post(RPC_TESTNET, {
      jsonrpc: "2.0",
      id: 1,
      method: "getLedgerEntries",
      params: { keys: batch },
    });
    const body = res.body as { result?: { entries?: RpcEntry[] | null }; error?: unknown };
    if (res.status !== 200 || !body.result) {
      throw new Error(`getLedgerEntries answered ${res.status}: ${JSON.stringify(body.error)}`);
    }
    for (const entry of body.result.entries ?? []) {
      found.set(entry.key, decodeContractData(entry.xdr).val);
    }
  }
  return encoded.map((key) => found.get(key));
}

/** A struct field or a map entry by its symbol name. */
export function field(value: ScValue | undefined, name: string): ScValue | undefined {
  if (value && typeof value === "object" && !Array.isArray(value) && "map" in value) {
    return value.map.find(([k]) => k === name)?.[1];
  }
  return undefined;
}

/**
 * A contract's instance storage as name → value, where a unit enum key such
 * as `DataKey::Admin` is named "Admin". Null when the contract is not on the
 * ledger.
 */
export async function readInstance(
  post: PostJson,
  contract: string,
): Promise<Map<string, ScValue> | null> {
  const [value] = await readContractData(post, contract, ["instance"]);
  if (!value || typeof value !== "object" || !("instance" in value)) return null;
  const storage = new Map<string, ScValue>();
  for (const [k, v] of value.instance.storage) {
    if (Array.isArray(k) && k.length === 1 && typeof k[0] === "string") storage.set(k[0], v);
  }
  return storage;
}

export type RegisteredAgent = { id: string; owner: string; registeredAt: Date };

/**
 * Every agent an AgentRegistry lists: its `Ids` instance entry, then each
 * `DataKey::Agent(id)` record for the owner and registration time.
 */
export async function readAgents(post: PostJson, registry: string): Promise<RegisteredAgent[]> {
  const ids = (await readInstance(post, registry))?.get("Ids");
  if (!Array.isArray(ids)) throw new Error(`registry ${registry} has no Ids list`);
  const keys = ids.map((id) => [{ sym: "Agent" }, { sym: String(id) }]);
  const records = await readContractData(post, registry, keys);
  return records.map((record, i) => {
    const owner = field(record, "owner");
    const at = field(record, "registered_at");
    if (typeof owner !== "string" || typeof at !== "bigint") {
      throw new Error(`agent ${String(ids[i])} has no owner or registration time`);
    }
    return { id: String(ids[i]), owner, registeredAt: new Date(Number(at) * 1000) };
  });
}
