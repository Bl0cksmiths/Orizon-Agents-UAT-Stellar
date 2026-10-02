/**
 * The deployed AttestationRegistry, read through simulation only.
 *
 * Contract source: Orizon-Agents-Smart-Contract-Stellar,
 * contract/attestation-registry/src/lib.rs. `seal` is write-once: the sealer
 * check comes first (Unauthorized = 1), then the existence check
 * (AlreadyExists = 3); `get` returns NotFound = 2 for an unknown job.
 */
import { readScAddress, readScVal, scAddress, scvAddress, scvBytes, scvI128, scvSymbol, scvVec, type ScValue } from "./scval.ts";
import { XdrReader, XdrWriter } from "./xdr.ts";
import { rpc } from "./rpc.ts";

export const REGISTRY = process.env.UAT_ATTESTATION_REGISTRY ?? "CBYUZKOET43UXTBXZUJIBBJW5ODGD2J2AZVVXCR3QONGOCAHOXQQHEGK";
/** The registered sealer since set_sealer of 2026-09-19 (tx c965980f…). */
export const SEALER = process.env.UAT_ATTESTATION_SEALER ?? "GDB4N25UYM3YNTTAWX7LSGI2P7OR62QZQXRNQWAGF5TFVENDKCTTCDHP";

const ENVELOPE_TYPE_TX = 2;
const OP_INVOKE_HOST_FUNCTION = 24;
const HOST_FUNCTION_INVOKE_CONTRACT = 0;

/**
 * An unsigned one-operation transaction invoking `fn` on the registry, for
 * simulateTransaction only: no signatures, no auth entries (so the RPC records
 * them), and a placeholder sequence number the simulation does not check.
 */
export function invokeEnvelope(source: string, fn: string, args: Buffer[]): string {
  const writer = new XdrWriter()
    .u32(ENVELOPE_TYPE_TX)
    .raw(scAddress(source).subarray(4)) // MuxedAccount KEY_TYPE_ED25519 (0) + key
    .u32(100) // fee
    .i64(1n) // sequence number
    .u32(0) // no preconditions
    .u32(0) // no memo
    .u32(1) // one operation
    .u32(0) // no operation source
    .u32(OP_INVOKE_HOST_FUNCTION)
    .u32(HOST_FUNCTION_INVOKE_CONTRACT)
    .raw(scAddress(REGISTRY))
    .opaque(Buffer.from(fn, "utf8"))
    .u32(args.length);
  for (const arg of args) writer.raw(arg);
  return writer
    .u32(0) // no auth entries
    .u32(0) // transaction ext v0
    .u32(0) // no signatures
    .bytes()
    .toString("base64");
}

export type Simulation = {
  latestLedger: number;
  error?: string;
  results?: { xdr: string; auth?: string[] }[];
  restorePreamble?: unknown;
};

/** An Attestation as `get` returns it (the shared crate's struct, fields by name). */
export type Attestation = {
  orchestrator: string;
  intent_hash: string;
  agents: string[];
  receipts: string[];
  total_spent: bigint;
  sealed_at: bigint;
};

function asAttestation(value: ScValue): Attestation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("get did not return a struct");
  const { orchestrator, intent_hash, agents, receipts, total_spent, sealed_at } = value;
  const strings = (list: ScValue | undefined): list is string[] => Array.isArray(list) && list.every((item) => typeof item === "string");
  if (typeof orchestrator !== "string" || typeof intent_hash !== "string" || !strings(agents) || !strings(receipts)) {
    throw new Error(`get returned an unexpected Attestation shape: ${Object.keys(value).join(", ")}`);
  }
  if (typeof total_spent !== "bigint" || typeof sealed_at !== "bigint") throw new Error("get returned non-integer amounts");
  return { orchestrator, intent_hash, agents, receipts, total_spent, sealed_at };
}

/** `get(job_id)` simulated at the latest ledger; a contract error is returned as `error`, not thrown. */
export async function getAttestation(jobId: string): Promise<{ ledger: number; attestation?: Attestation; error?: string }> {
  const sim = await rpc<Simulation>("simulateTransaction", { transaction: invokeEnvelope(SEALER, "get", [scvBytes(jobId)]) });
  const xdr = sim.results?.[0]?.xdr;
  if (sim.error || !xdr) return { ledger: sim.latestLedger, error: sim.error?.split("\n")[0] ?? "no result" };
  return { ledger: sim.latestLedger, attestation: asAttestation(readScVal(new XdrReader(xdr))) };
}

export type SealProbe = { ledger: number; error?: string; authEntries: number; restoreNeeded: boolean };

/**
 * `seal(...)` simulated in recording-auth mode with `caller` as both the
 * transaction source and the `caller` argument, so `caller.require_auth()` is
 * satisfied by the source account without a signature and the call reaches
 * the contract's own checks. Never submitted.
 */
export async function simulateSeal(caller: string, jobId: string, sealed: Attestation): Promise<SealProbe> {
  const args = [
    scvAddress(caller),
    scvBytes(jobId),
    scvAddress(sealed.orchestrator),
    scvBytes(sealed.intent_hash),
    scvVec(sealed.agents.map(scvSymbol)),
    scvVec(sealed.receipts.map(scvBytes)),
    scvI128(sealed.total_spent),
  ];
  const sim = await rpc<Simulation>("simulateTransaction", {
    transaction: invokeEnvelope(caller, "seal", args),
    authMode: "record",
  });
  return {
    ledger: sim.latestLedger,
    error: sim.error?.split("\n")[0],
    authEntries: sim.results?.[0]?.auth?.length ?? 0,
    restoreNeeded: sim.restorePreamble !== undefined,
  };
}

const LEDGER_ENTRY_CONTRACT_DATA = 6;
const PERSISTENT = 1;

type LedgerEntries = {
  latestLedger: number;
  entries?: { xdr: string; lastModifiedLedgerSeq: number; liveUntilLedgerSeq?: number }[];
};

export type EntryLifetime = {
  latestLedger: number;
  lastModified: number;
  /** 0 (or absent from the RPC) once the entry has been archived. */
  liveUntil: number;
  stored: Attestation;
};

/**
 * The persistent `DataKey::Job(job_id)` entry read straight from the ledger:
 * its live-until ledger (the registry never extends it) and the stored value.
 * Undefined when the RPC returns no entry at all.
 */
export async function jobEntry(jobId: string): Promise<EntryLifetime | undefined> {
  const storageKey = scvVec([scvSymbol("Job"), scvBytes(jobId)]);
  const key = new XdrWriter().u32(LEDGER_ENTRY_CONTRACT_DATA).raw(scAddress(REGISTRY)).raw(storageKey).u32(PERSISTENT).bytes();
  const result = await rpc<LedgerEntries>("getLedgerEntries", { keys: [key.toString("base64")] });
  const entry = result.entries?.[0];
  if (!entry) return undefined;
  const reader = new XdrReader(entry.xdr);
  if (reader.u32() !== LEDGER_ENTRY_CONTRACT_DATA || reader.u32() !== 0) throw new Error("not a v0 contract-data entry");
  if (readScAddress(reader) !== REGISTRY) throw new Error("entry belongs to another contract");
  readScVal(reader); // the key, already known
  if (reader.u32() !== PERSISTENT) throw new Error("job entry is not persistent");
  return {
    latestLedger: result.latestLedger,
    lastModified: entry.lastModifiedLedgerSeq,
    liveUntil: entry.liveUntilLedgerSeq ?? 0,
    stored: asAttestation(readScVal(reader)),
  };
}

const LEDGER_ENTRY_CONTRACT_CODE = 7;
const SCV_CONTRACT_INSTANCE = 19;
const SCV_LEDGER_KEY_CONTRACT_INSTANCE = 20;
const EXECUTABLE_WASM = 0;

export type ContractLifetime = { latestLedger: number; instanceLiveUntil: number; wasmHash: string; codeLiveUntil: number };

/**
 * The registry's instance entry (it holds the admin and the sealer) and its
 * wasm code entry. Every `get` and `seal` loads both, so they archive the
 * whole registry when they lapse, whatever the job entries' own TTLs.
 */
export async function contractLifetime(): Promise<ContractLifetime> {
  const instanceKey = new XdrWriter()
    .u32(LEDGER_ENTRY_CONTRACT_DATA)
    .raw(scAddress(REGISTRY))
    .u32(SCV_LEDGER_KEY_CONTRACT_INSTANCE)
    .u32(PERSISTENT)
    .bytes();
  const instance = await rpc<LedgerEntries>("getLedgerEntries", { keys: [instanceKey.toString("base64")] });
  const instanceEntry = instance.entries?.[0];
  if (!instanceEntry) throw new Error(`registry ${REGISTRY} has no instance entry`);
  const reader = new XdrReader(instanceEntry.xdr);
  reader.fixed(8); // entry type and ext
  readScAddress(reader);
  if (reader.u32() !== SCV_LEDGER_KEY_CONTRACT_INSTANCE || reader.u32() !== PERSISTENT) throw new Error("not the instance entry");
  if (reader.u32() !== SCV_CONTRACT_INSTANCE || reader.u32() !== EXECUTABLE_WASM) throw new Error("registry is not a wasm contract");
  const wasmHash = reader.fixed(32);
  const codeKey = new XdrWriter().u32(LEDGER_ENTRY_CONTRACT_CODE).raw(wasmHash).bytes();
  const code = await rpc<LedgerEntries>("getLedgerEntries", { keys: [codeKey.toString("base64")] });
  return {
    latestLedger: instance.latestLedger,
    instanceLiveUntil: instanceEntry.liveUntilLedgerSeq ?? 0,
    wasmHash: wasmHash.toString("hex"),
    codeLiveUntil: code.entries?.[0]?.liveUntilLedgerSeq ?? 0,
  };
}

export type SealEvent = { ledger: number; closedAt: string; txHash: string; jobId: string; orchestrator: string; totalSpent: bigint };

type EventPage = {
  cursor: string;
  latestLedger: number;
  events: { ledger: number; ledgerClosedAt: string; txHash: string; topic: string[]; value: string }[];
};

/**
 * Every `sealed` event the registry emitted inside the RPC's retention window
 * (about a week), oldest first: topics (sealed, job_id), value (orchestrator,
 * total_spent). Seals older than the window are not visible here. The RPC
 * scans a bounded range of ledgers per call, so a page can be empty long
 * before the end: paging stops only once the cursor reaches the latest ledger
 * (a cursor is a TOID, whose high 32 bits are the ledger).
 */
export async function sealEvents(): Promise<SealEvent[]> {
  const { oldestLedger } = await rpc<{ oldestLedger: number }>("getHealth", {});
  const filters = [{ type: "contract", contractIds: [REGISTRY], topics: [[scvSymbol("sealed").toString("base64"), "*"]] }];
  const limit = 100;
  const found: SealEvent[] = [];
  let page = await rpc<EventPage>("getEvents", { startLedger: oldestLedger + 1, filters, pagination: { limit } });
  for (;;) {
    for (const event of page.events) {
      const jobId = readScVal(new XdrReader(event.topic[1] ?? ""));
      const value = readScVal(new XdrReader(event.value));
      const [orchestrator, totalSpent] = Array.isArray(value) ? value : [];
      if (typeof jobId !== "string" || typeof orchestrator !== "string" || typeof totalSpent !== "bigint") {
        throw new Error(`unexpected sealed event in tx ${event.txHash}`);
      }
      found.push({ ledger: event.ledger, closedAt: event.ledgerClosedAt, txHash: event.txHash, jobId, orchestrator, totalSpent });
    }
    const cursorLedger = Number(BigInt(page.cursor.split("-")[0] ?? "0") >> 32n);
    if (page.events.length < limit && cursorLedger >= page.latestLedger) return found;
    page = await rpc<EventPage>("getEvents", { filters, pagination: { cursor: page.cursor, limit } });
  }
}
