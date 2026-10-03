/**
 * SCVal encoding and decoding for the AttestationRegistry interface:
 * `get(job_id: BytesN<16>)` and
 * `seal(caller, job_id, orchestrator, intent_hash, agents, receipts, total_spent)`.
 */
import { ACCOUNT_VERSION, CONTRACT_VERSION, decodeStrkey, encodeStrkey } from "./strkey.ts";
import { XdrReader, XdrWriter } from "./xdr.ts";

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

/** A decoded SCVal: maps keyed by their symbol, bytes as lowercase hex, addresses as strkeys. */
export type ScValue = null | boolean | number | bigint | string | ScValue[] | { [key: string]: ScValue };

/** Reads an SCAddress; only account and contract addresses occur in this registry. */
export function readScAddress(reader: XdrReader): string {
  const kind = reader.u32();
  if (kind === SC_ADDRESS_ACCOUNT) {
    if (reader.u32() !== 0) throw new Error("account id is not an ed25519 key");
    return encodeStrkey(reader.fixed(32), ACCOUNT_VERSION);
  }
  if (kind === SC_ADDRESS_CONTRACT) return encodeStrkey(reader.fixed(32), CONTRACT_VERSION);
  throw new Error(`unexpected SCAddress kind ${kind}`);
}

/** Reads one SCVal of the kinds an Attestation and its storage key are made of. */
export function readScVal(reader: XdrReader): ScValue {
  const type = reader.u32();
  switch (type) {
    case 0:
      return reader.u32() === 1;
    case 1:
      return null;
    case 3:
      return reader.u32();
    case 4:
      return reader.i32();
    case 5:
    case 7:
      return reader.u64();
    case 6:
      return reader.i64();
    case SCV_I128: {
      const hi = reader.i64();
      return (hi << 64n) | reader.u64();
    }
    case SCV_BYTES:
      return reader.opaque().toString("hex");
    case 14:
    case SCV_SYMBOL:
      return reader.opaque().toString("utf8");
    case SCV_VEC: {
      if (reader.u32() !== 1) return null;
      return Array.from({ length: reader.u32() }, () => readScVal(reader));
    }
    case 17: {
      if (reader.u32() !== 1) return null;
      const map: { [key: string]: ScValue } = {};
      for (let i = reader.u32(); i > 0; i--) {
        const key = readScVal(reader);
        map[String(key)] = readScVal(reader);
      }
      return map;
    }
    case SCV_ADDRESS:
      return readScAddress(reader);
    default:
      throw new Error(`unsupported SCVal type ${type}`);
  }
}
