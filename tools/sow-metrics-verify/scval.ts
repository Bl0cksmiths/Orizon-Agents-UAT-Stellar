import { ACCOUNT_VERSION, CONTRACT_VERSION, MUXED_VERSION, encodeStrkey } from "./strkey.ts";
import { XdrReader, XdrWriter } from "./xdr.ts";

/**
 * Soroban `SCVal` decoding to plain values, and the few encodings a
 * read-only verifier sends: a symbol, fixed bytes and a contract address.
 *
 * Plain values: integers of 32 bits are numbers, wider ones bigints; bytes are
 * lower-case hex; addresses are strkeys; a map is an object keyed by its keys'
 * plain text (a one-element vector key such as `[Nonce]` becomes `Nonce`,
 * which is how these contracts key their instance storage).
 */
export type ScValue = null | boolean | number | bigint | string | ScValue[] | { [key: string]: ScValue };

const T = {
  Bool: 0,
  Void: 1,
  Error: 2,
  U32: 3,
  I32: 4,
  U64: 5,
  I64: 6,
  Timepoint: 7,
  Duration: 8,
  U128: 9,
  I128: 10,
  Bytes: 13,
  String: 14,
  Symbol: 15,
  Vec: 16,
  Map: 17,
  Address: 18,
  ContractInstance: 19,
  LedgerKeyContractInstance: 20,
} as const;

export function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function readAddress(r: XdrReader): string {
  const kind = r.u32();
  if (kind === 0) {
    const keyType = r.u32();
    if (keyType !== 0) throw new Error(`unsupported account key type ${keyType}`);
    return encodeStrkey(r.fixed(32), ACCOUNT_VERSION);
  }
  if (kind === 1) return encodeStrkey(r.fixed(32), CONTRACT_VERSION);
  if (kind === 2) {
    const id = r.fixed(8);
    const key = r.fixed(32);
    const payload = new Uint8Array(40);
    payload.set(key);
    payload.set(id, 32);
    return encodeStrkey(payload, MUXED_VERSION);
  }
  throw new Error(`unsupported SCAddress type ${kind}`);
}

function keyName(key: ScValue): string {
  if (Array.isArray(key) && key.length === 1 && typeof key[0] === "string") return key[0];
  if (typeof key === "string") return key;
  return JSON.stringify(key, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
}

function readMap(r: XdrReader): { [key: string]: ScValue } {
  const out: { [key: string]: ScValue } = {};
  const count = r.u32();
  for (let i = 0; i < count; i++) {
    const key = readScVal(r);
    out[keyName(key)] = readScVal(r);
  }
  return out;
}

export function readScVal(r: XdrReader): ScValue {
  const type = r.u32();
  switch (type) {
    case T.Bool:
      return r.bool();
    case T.Void:
    case T.LedgerKeyContractInstance:
      return null;
    case T.Error:
      return `error:${r.u32()}:${r.u32()}`;
    case T.U32:
      return r.u32();
    case T.I32:
      return r.i32();
    case T.U64:
    case T.Timepoint:
    case T.Duration:
      return r.u64();
    case T.I64:
      return r.i64();
    case T.U128: {
      const hi = r.u64();
      return (hi << 64n) | r.u64();
    }
    case T.I128: {
      const hi = r.i64();
      return (hi << 64n) | r.u64();
    }
    case T.Bytes:
      return hex(r.varOpaque());
    case T.String:
    case T.Symbol:
      return r.string();
    case T.Vec: {
      if (!r.bool()) return null;
      const count = r.u32();
      const out: ScValue[] = [];
      for (let i = 0; i < count; i++) out.push(readScVal(r));
      return out;
    }
    case T.Map:
      return r.bool() ? readMap(r) : null;
    case T.Address:
      return readAddress(r);
    case T.ContractInstance: {
      const executable = r.u32();
      if (executable === 0) r.fixed(32);
      else if (executable !== 1) throw new Error(`unsupported contract executable ${executable}`);
      return r.bool() ? readMap(r) : {};
    }
    default:
      throw new Error(`unsupported SCVal type ${type}`);
  }
}

/** One base64 `SCVal`, fully consumed. */
export function decodeScVal(base64: string): ScValue {
  const r = XdrReader.fromBase64(base64);
  const value = readScVal(r);
  r.end();
  return value;
}

/** An argument to send: already-encoded `SCVal` bytes. */
export type ScArg = Uint8Array;

export function scSymbol(text: string): ScArg {
  return new XdrWriter().u32(T.Symbol).string(text).bytes();
}

export function scBytes(bytes: Uint8Array): ScArg {
  return new XdrWriter().u32(T.Bytes).varOpaque(bytes).bytes();
}
