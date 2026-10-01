/**
 * A minimal decoder for Soroban `ScVal` XDR, the base64 values Horizon lists
 * as an invoke_host_function operation's `parameters`. It covers the value
 * types a contract call argument can carry and refuses any other, so an
 * unexpected shape fails loudly instead of decoding into something plausible.
 */

import { encodeStrkey, STRKEY_VERSION } from "./strkey.ts";

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
  | { error: [number, number] };

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
      if (r.u32() !== 1) return null;
      const entries: [ScValue, ScValue][] = [];
      for (let n = r.u32(); n > 0; n--) entries.push([readValue(r), readValue(r)]);
      return { map: entries };
    }
    case 18:
      return readAddress(r);
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
