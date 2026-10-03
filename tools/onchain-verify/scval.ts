/**
 * A minimal decoder for Soroban `ScVal` XDR, the base64 values Horizon lists
 * as an invoke_host_function operation's `parameters`. It covers the value
 * types a contract call argument can carry and refuses any other, so an
 * unexpected shape fails loudly instead of decoding into something plausible.
 */

import { decodeStrkey, encodeStrkey, STRKEY_VERSION } from "./strkey.ts";

/**
 * A decoded value. Symbols and strings are text, addresses their strkey,
 * bytes lowercase hex, 64- and 128-bit integers bigints, a map its entries.
 */
export type ScValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | ScValue[]
  | { map: [ScValue, ScValue][] }
  | { error: [number, number] }
  | { instance: { executable: string; storage: [ScValue, ScValue][] } };

class Reader {
  private offset = 0;
  private readonly bytes: Uint8Array;
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u32(): number {
    const value = this.view.getUint32(this.offset);
    this.offset += 4;
    return value;
  }

  i32(): number {
    const value = this.view.getInt32(this.offset);
    this.offset += 4;
    return value;
  }

  u64(): bigint {
    const value = this.view.getBigUint64(this.offset);
    this.offset += 8;
    return value;
  }

  i64(): bigint {
    const value = this.view.getBigInt64(this.offset);
    this.offset += 8;
    return value;
  }

  fixed(length: number): Uint8Array {
    const slice = this.bytes.slice(this.offset, this.offset + length);
    if (slice.length !== length) throw new Error("ScVal XDR ends early");
    this.offset += length + ((4 - (length % 4)) % 4);
    return slice;
  }

  opaque(): Uint8Array {
    return this.fixed(this.u32());
  }

  done(): boolean {
    return this.offset === this.bytes.length;
  }
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("utf8");

function readAddress(r: Reader): string {
  const kind = r.u32();
  if (kind === 0) {
    if (r.u32() !== 0) throw new Error("unsupported public key type");
    return encodeStrkey(STRKEY_VERSION.account, r.fixed(32));
  }
  if (kind === 1) return encodeStrkey(STRKEY_VERSION.contract, r.fixed(32));
  if (kind === 2) {
    const id = r.fixed(8);
    const key = r.fixed(32);
    const payload = new Uint8Array(40);
    payload.set(key);
    payload.set(id, 32);
    return encodeStrkey(STRKEY_VERSION.muxed, payload);
  }
  throw new Error(`unsupported ScAddress type ${kind}`);
}

function readMap(r: Reader): [ScValue, ScValue][] | null {
  if (r.u32() !== 1) return null;
  const entries: [ScValue, ScValue][] = [];
  for (let n = r.u32(); n > 0; n--) entries.push([readValue(r), readValue(r)]);
  return entries;
}

/** A contract instance: its wasm hash (or "stellar_asset") and instance storage. */
function readInstance(r: Reader): ScValue {
  const kind = r.u32();
  const executable = kind === 0 ? hex(r.fixed(32)) : "stellar_asset";
  if (kind > 1) throw new Error(`unsupported executable type ${kind}`);
  return { instance: { executable, storage: readMap(r) ?? [] } };
}

function readValue(r: Reader): ScValue {
  const type = r.u32();
  switch (type) {
    case 0:
      return r.u32() === 1;
    case 1:
      return null;
    case 2:
      return { error: [r.u32(), r.u32()] };
    case 3:
      return r.u32();
    case 4:
      return r.i32();
    case 5:
    case 7:
    case 8:
      return r.u64();
    case 6:
      return r.i64();
    case 9:
      return (r.u64() << 64n) | r.u64();
    case 10:
      return (r.i64() << 64n) | r.u64();
    case 13:
      return hex(r.opaque());
    case 14:
    case 15:
      return text(r.opaque());
    case 16:
      return r.u32() === 1 ? Array.from({ length: r.u32() }, () => readValue(r)) : null;
    case 17: {
      const entries = readMap(r);
      return entries ? { map: entries } : null;
    }
    case 18:
      return readAddress(r);
    case 19:
      return readInstance(r);
    case 20:
      return null;
    default:
      throw new Error(`unsupported ScVal type ${type}`);
  }
}

/** Decodes one base64 `ScVal`; throws on trailing bytes or unknown types. */
export function decodeScVal(base64: string): ScValue {
  const r = new Reader(Buffer.from(base64, "base64"));
  const value = readValue(r);
  if (!r.done()) throw new Error("trailing bytes after ScVal");
  return value;
}

/**
 * The key and value of a contract-data ledger entry, from the base64
 * `LedgerEntryData` XDR that Stellar RPC's getLedgerEntries returns.
 */
export function decodeContractData(base64: string): { key: ScValue; val: ScValue } {
  const r = new Reader(Buffer.from(base64, "base64"));
  if (r.u32() !== 6) throw new Error("ledger entry is not contract data");
  if (r.u32() !== 0) throw new Error("unsupported contract data extension");
  readAddress(r);
  const key = readValue(r);
  r.u32();
  const val = readValue(r);
  if (!r.done()) throw new Error("trailing bytes after contract data");
  return { key, val };
}

/** A storage key to encode: a symbol, bytes as hex, an address, or a vec of keys. */
export type ScKey = { sym: string } | { bytes: string } | { address: string } | ScKey[];

const u32 = (n: number) => {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(n);
  return out;
};

const padded = (bytes: Buffer) =>
  Buffer.concat([u32(bytes.length), bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);

/** `ScAddress` XDR (no ScVal tag) for a G… account or a C… contract. */
export function encodeAddress(strkey: string): Buffer {
  if (strkey.startsWith("G")) {
    return Buffer.concat([u32(0), u32(0), decodeStrkey(STRKEY_VERSION.account, strkey)]);
  }
  return Buffer.concat([u32(1), decodeStrkey(STRKEY_VERSION.contract, strkey)]);
}

/** `ScVal` XDR for a storage key, the way a `#[contracttype]` enum key is laid out. */
export function encodeScKey(key: ScKey): Buffer {
  if (Array.isArray(key)) {
    return Buffer.concat([u32(16), u32(1), u32(key.length), ...key.map(encodeScKey)]);
  }
  if ("sym" in key) return Buffer.concat([u32(15), padded(Buffer.from(key.sym, "utf8"))]);
  if ("bytes" in key) return Buffer.concat([u32(13), padded(Buffer.from(key.bytes, "hex"))]);
  return Buffer.concat([u32(18), encodeAddress(key.address)]);
}
