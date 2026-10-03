/**
 * Stellar strkey encoding (SEP-23), written out so the verifier depends on no
 * SDK: the same G…/C…/M… text a Horizon response or an explorer shows, built
 * from the raw bytes found inside contract-call arguments.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Version bytes: account (G), contract (C), muxed account (M). */
export const STRKEY_VERSION = { account: 6 << 3, contract: 2 << 3, muxed: 12 << 3 } as const;

/** CRC16-XModem, little-endian in the strkey checksum. */
function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function base32(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/** The strkey for `payload` under `version`, checksum included, unpadded. */
export function encodeStrkey(version: number, payload: Uint8Array): string {
  const body = new Uint8Array(payload.length + 1);
  body[0] = version;
  body.set(payload, 1);
  const crc = crc16(body);
  const full = new Uint8Array(body.length + 2);
  full.set(body);
  full[body.length] = crc & 0xff;
  full[body.length + 1] = crc >> 8;
  return base32(full);
}

/** The raw payload of a strkey, after checking its version byte and checksum. */
export function decodeStrkey(version: number, strkey: string): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of strkey) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`not a strkey: ${strkey}`);
    buffer = ((buffer << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const payload = Uint8Array.from(bytes.slice(1, -2));
  if (bytes[0] !== version || encodeStrkey(version, payload) !== strkey) {
    throw new Error(`strkey ${strkey} fails its version or checksum`);
  }
  return payload;
}
