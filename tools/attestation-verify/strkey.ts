/**
 * Stellar strkey (G… account, C… contract) decoding, dependency-free.
 *
 * The UAT suite carries no Stellar SDK, so the attestation reads build their
 * own XDR; every address in it starts life as a strkey. The checksum is
 * enforced so a typo in a pinned id fails loudly instead of reading the wrong
 * ledger entry.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const ACCOUNT_VERSION = 6 << 3;
export const CONTRACT_VERSION = 2 << 3;

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

/** The raw 32-byte payload of a strkey with the given version byte; throws on any malformation. */
export function decodeStrkey(strkey: string, version: number): Buffer {
  if (strkey.length !== 56) throw new Error(`strkey ${strkey} is not 56 characters`);
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of strkey) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new Error(`invalid strkey character ${JSON.stringify(char)}`);
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  const decoded = Buffer.from(out);
  if (decoded.length !== 35 || decoded[0] !== version) throw new Error(`strkey ${strkey} has the wrong version byte`);
  if (crc16Xmodem(decoded.subarray(0, 33)) !== decoded.readUInt16LE(33)) throw new Error(`strkey ${strkey} checksum mismatch`);
  return decoded.subarray(1, 33);
}

/** The strkey of a raw 32-byte payload: how `get` results are compared with the addresses the evidence names. */
export function encodeStrkey(raw: Uint8Array, version: number): string {
  const payload = Buffer.concat([Buffer.from([version]), Buffer.from(raw)]);
  const checksum = Buffer.alloc(2);
  checksum.writeUInt16LE(crc16Xmodem(payload));
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of Buffer.concat([payload, checksum])) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >> bits) & 31];
    }
  }
  return bits > 0 ? out + ALPHABET[(buffer << (5 - bits)) & 31] : out;
}
