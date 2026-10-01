/**
 * The deployed AttestationRegistry, read through simulation only.
 *
 * Contract source: Orizon-Agents-Smart-Contract-Stellar,
 * contract/attestation-registry/src/lib.rs. `seal` is write-once: the sealer
 * check comes first (Unauthorized = 1), then the existence check
 * (AlreadyExists = 3); `get` returns NotFound = 2 for an unknown job.
 */
import { readScVal, scAddress, scvBytes, type ScValue } from "./scval.ts";
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
