import {
  decodeScVal,
  instanceLedgerKey,
  readAddress,
  readScVal,
  writeContractAddress,
  type ScArg,
  type ScValue,
} from "./scval.ts";
import { XdrReader, XdrWriter } from "./xdr.ts";
import { postJson } from "./http.ts";

export const TESTNET_RPC = "https://soroban-testnet.stellar.org";
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

/** A contract call that failed in simulation: an answer ("no such receipt"), not an outage. */
export class SimulationFailed extends Error {}

let nextId = 0;

async function rpc<R>(method: string, params?: unknown): Promise<R> {
  const body = await postJson(TESTNET_RPC, { jsonrpc: "2.0", id: ++nextId, method, params });
  const reply = body as { result?: R; error?: { message?: string } };
  if (reply.error) throw new Error(`${method}: ${reply.error.message ?? JSON.stringify(reply.error)}`);
  if (reply.result === undefined) throw new Error(`${method}: no result`);
  return reply.result;
}

export async function networkPassphrase(): Promise<string> {
  return (await rpc<{ passphrase: string }>("getNetwork")).passphrase;
}

export interface Retention {
  oldestLedger: number;
  oldestCloseTime: number;
  latestLedger: number;
}

/**
 * The window slides forward one ledger every few seconds, so a scan that
 * started exactly at the oldest ledger would be refused partway through
 * reading. Scans start this many ledgers (about one hour) inside it.
 */
const SLIDE_MARGIN = 720;

/** The ledger range this RPC still holds events for (about seven days on testnet), less the slide margin. */
export async function retention(): Promise<Retention> {
  const health = await rpc<{ oldestLedger: number; oldestLedgerCloseTime: string; latestLedger: number }>(
    "getHealth",
  );
  return {
    oldestLedger: health.oldestLedger + SLIDE_MARGIN,
    oldestCloseTime: Number(health.oldestLedgerCloseTime) + SLIDE_MARGIN * 5,
    latestLedger: health.latestLedger,
  };
}

/**
 * A never-signed transaction envelope invoking `fn` on `contract`, from the
 * all-zero account at sequence 0. Simulation does not check the source exists.
 */
function simulationEnvelope(contract: string, fn: string, args: ScArg[]): string {
  const w = new XdrWriter()
    .u32(2) // ENVELOPE_TYPE_TX
    .u32(0) // source: KEY_TYPE_ED25519
    .fixed(new Uint8Array(32))
    .u32(100) // fee
    .i64(0n) // sequence
    .u32(0) // PRECOND_NONE
    .u32(0) // MEMO_NONE
    .u32(1) // one operation
    .u32(0) // no operation source
    .u32(24) // INVOKE_HOST_FUNCTION
    .u32(0); // HOST_FUNCTION_TYPE_INVOKE_CONTRACT
  writeContractAddress(w, contract).string(fn).u32(args.length);
  for (const arg of args) w.fixed(arg);
  return w
    .u32(0) // no authorization entries
    .u32(0) // transaction ext v0
    .u32(0) // no signatures
    .base64();
}

/** A contract view, run in simulation and decoded. Throws `SimulationFailed` when the call itself fails. */
export async function simulate(contract: string, fn: string, args: ScArg[] = []): Promise<ScValue> {
  const result = await rpc<{ error?: string; results?: { xdr: string }[] }>("simulateTransaction", {
    transaction: simulationEnvelope(contract, fn, args),
  });
  if (result.error) throw new SimulationFailed(`${fn}: ${result.error.split("\n")[0]}`);
  const xdr = result.results?.[0]?.xdr;
  if (!xdr) throw new Error(`${fn}: simulation returned no value`);
  return decodeScVal(xdr);
}

/**
 * A contract instance's storage, keyed by `DataKey` variant name (`Admin`,
 * `Settler`, `Nonce`, ...), read straight from its ledger entry.
 */
export async function instanceStorage(contract: string): Promise<{ [key: string]: ScValue }> {
  const result = await rpc<{ entries?: { xdr: string }[] }>("getLedgerEntries", {
    keys: [instanceLedgerKey(contract)],
  });
  const entry = result.entries?.[0];
  if (!entry) throw new Error(`${contract} has no contract instance on this network`);
  const r = XdrReader.fromBase64(entry.xdr);
  if (r.u32() !== 6) throw new Error(`${contract}: ledger entry is not contract data`);
  if (r.u32() !== 0) throw new Error(`${contract}: unsupported contract data extension`);
  const owner = readAddress(r);
  if (owner !== contract) throw new Error(`${contract}: ledger answered the entry of ${owner}`);
  readScVal(r); // the key: the instance marker
  r.u32(); // durability
  const storage = readScVal(r);
  r.end();
  if (storage === null || typeof storage !== "object" || Array.isArray(storage)) {
    throw new Error(`${contract}: instance storage is not a map`);
  }
  return storage;
}
