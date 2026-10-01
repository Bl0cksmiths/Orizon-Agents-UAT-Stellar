/**
 * The slice of Stellar XDR the attestation reads need: enough to build an
 * InvokeHostFunction envelope for simulation, a contract-data ledger key, and
 * to decode the SCVal an AttestationRegistry `get` returns.
 */

/** Big-endian XDR writer: every item is 4-byte aligned. */
export class XdrWriter {
  private readonly parts: Buffer[] = [];

  u32(value: number): this {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(value);
    this.parts.push(buf);
    return this;
  }

  i64(value: bigint): this {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(value);
    this.parts.push(buf);
    return this;
  }

  u64(value: bigint): this {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(value);
    this.parts.push(buf);
    return this;
  }

  /** Fixed-length opaque (a hash, a key) or an already-encoded XDR item. */
  raw(bytes: Uint8Array): this {
    this.parts.push(Buffer.from(bytes));
    return this;
  }

  /** Variable-length opaque or string: length, bytes, zero padding to 4. */
  opaque(bytes: Uint8Array): this {
    this.u32(bytes.length).raw(bytes);
    const pad = (4 - (bytes.length % 4)) % 4;
    if (pad) this.parts.push(Buffer.alloc(pad));
    return this;
  }

  bytes(): Buffer {
    return Buffer.concat(this.parts);
  }
}
