/**
 * Stellar strkeys (G… accounts, C… contracts, M… muxed accounts), dependency-free.
 *
 * The verifier reads the chain with raw RPC and Horizon calls rather than the
 * backend's SDK, so that what it counts does not inherit the backend's own
 * decoding. Every decode enforces the length, the version byte and the CRC16
 * checksum.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const ACCOUNT_VERSION = 6 << 3;
export const CONTRACT_VERSION = 2 << 3;
export const MUXED_VERSION = 12 << 3;

function crc16Xmodem(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function base32Decode(text: string): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new Error(`invalid strkey character ${JSON.stringify(char)}`);
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** The payload of a strkey (32 bytes for G… and C…, 40 for M…); throws on any malformation. */
export function decodeStrkey(text: string, version: number, length = 32): Uint8Array {
  if (text.length !== Math.ceil(((length + 3) * 8) / 5)) throw new Error(`not a strkey of this kind: ${text}`);
  const decoded = base32Decode(text);
  if (decoded.length !== length + 3 || decoded[0] !== version) {
    throw new Error(`strkey version byte mismatch: ${text}`);
  }
  const body = decoded.subarray(0, length + 1);
  const checksum = decoded[length + 1]! | (decoded[length + 2]! << 8);
  if (crc16Xmodem(body) !== checksum) throw new Error(`strkey checksum mismatch: ${text}`);
  return decoded.slice(1, length + 1);
}

function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/** A strkey for a payload under a version byte. */
export function encodeStrkey(payload: Uint8Array, version: number): string {
  const body = new Uint8Array(payload.length + 1);
  body[0] = version;
  body.set(payload, 1);
  const crc = crc16Xmodem(body);
  const full = new Uint8Array(body.length + 2);
  full.set(body);
  full[body.length] = crc & 0xff;
  full[body.length + 1] = crc >> 8;
  return base32Encode(full);
}

/** True for a well-formed account id (G…), checksum included. Anything else, a display name included, is false. */
export function isAccountId(text: unknown): text is string {
  if (typeof text !== "string") return false;
  try {
    decodeStrkey(text, ACCOUNT_VERSION);
    return true;
  } catch {
    return false;
  }
}

/** The G… account behind an address: itself for a G…, the base account of a muxed M…. */
export function baseAccount(address: string): string {
  if (address.startsWith("M")) {
    return encodeStrkey(decodeStrkey(address, MUXED_VERSION, 40).slice(0, 32), ACCOUNT_VERSION);
  }
  return address;
}

/** True for a well-formed muxed account (M…), checksum included. */
export function isMuxedId(text: unknown): text is string {
  if (typeof text !== "string") return false;
  try {
    decodeStrkey(text, MUXED_VERSION, 40);
    return true;
  } catch {
    return false;
  }
}
