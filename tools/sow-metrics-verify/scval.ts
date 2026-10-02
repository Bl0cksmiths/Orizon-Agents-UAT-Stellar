import { ACCOUNT_VERSION, CONTRACT_VERSION, MUXED_VERSION, encodeStrkey } from "./strkey.ts";
import type { XdrReader } from "./xdr.ts";

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
