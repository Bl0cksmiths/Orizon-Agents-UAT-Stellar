/**
 * SCVal encoding and decoding for the AttestationRegistry interface:
 * `get(job_id: BytesN<16>)` and
 * `seal(caller, job_id, orchestrator, intent_hash, agents, receipts, total_spent)`.
 */
import { ACCOUNT_VERSION, CONTRACT_VERSION, decodeStrkey } from "./strkey.ts";
import { XdrWriter } from "./xdr.ts";

const SCV_I128 = 10;
const SCV_BYTES = 13;
const SCV_SYMBOL = 15;
const SCV_VEC = 16;
const SCV_ADDRESS = 18;

const SC_ADDRESS_ACCOUNT = 0;
const SC_ADDRESS_CONTRACT = 1;

/** An SCAddress (not wrapped in an SCVal), for a G… account or a C… contract. */
export function scAddress(strkey: string): Buffer {
  const writer = new XdrWriter();
  if (strkey.startsWith("C")) return writer.u32(SC_ADDRESS_CONTRACT).raw(decodeStrkey(strkey, CONTRACT_VERSION)).bytes();
  // An account id is a PublicKey union: type 0 (ed25519), then the key.
  return writer.u32(SC_ADDRESS_ACCOUNT).u32(0).raw(decodeStrkey(strkey, ACCOUNT_VERSION)).bytes();
}

export const scvAddress = (strkey: string): Buffer => new XdrWriter().u32(SCV_ADDRESS).raw(scAddress(strkey)).bytes();
export const scvSymbol = (text: string): Buffer => new XdrWriter().u32(SCV_SYMBOL).opaque(Buffer.from(text, "utf8")).bytes();
export const scvBytes = (hex: string): Buffer => new XdrWriter().u32(SCV_BYTES).opaque(Buffer.from(hex, "hex")).bytes();

export function scvVec(items: Buffer[]): Buffer {
  // SCVec is optional inside the SCVal: 1 = present.
  const writer = new XdrWriter().u32(SCV_VEC).u32(1).u32(items.length);
  for (const item of items) writer.raw(item);
  return writer.bytes();
}

export function scvI128(value: bigint): Buffer {
  return new XdrWriter()
    .u32(SCV_I128)
    .i64(value >> 64n)
    .u64(value & 0xffff_ffff_ffff_ffffn)
    .bytes();
}
