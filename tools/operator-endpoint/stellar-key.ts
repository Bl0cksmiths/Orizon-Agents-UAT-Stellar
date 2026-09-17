/**
 * Stellar account-id (G…) strkey decoding, dependency-free.
 *
 * The operator endpoint verifies Orizon's dispatch signature against the
 * signer published at GET /api/stellar/network. That signer is a strkey, so it
 * has to become raw ed25519 bytes before node:crypto can use it — and the
 * checksum has to be enforced, or a one-character typo in the pinned signer
 * silently becomes "every signature fails".
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ACCOUNT_VERSION_BYTE = 6 << 3;

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
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** Raw 32-byte ed25519 public key of a G… address; throws on any malformation. */
export function decodeAccountId(address: string): Uint8Array {
  if (address.length !== 56 || !address.startsWith("G")) {
    throw new Error("not a Stellar account id (G…, 56 characters)");
  }
  const decoded = base32Decode(address);
  if (decoded.length !== 35 || decoded[0] !== ACCOUNT_VERSION_BYTE) {
    throw new Error("strkey version byte is not an account id");
  }
  const payload = decoded.subarray(0, 33);
  const checksum = decoded[33]! | (decoded[34]! << 8);
  if (crc16Xmodem(payload) !== checksum) {
    throw new Error("strkey checksum mismatch");
  }
  return decoded.slice(1, 33);
}
