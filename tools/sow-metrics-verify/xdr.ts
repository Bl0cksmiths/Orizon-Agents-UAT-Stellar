/**
 * The XDR primitives the verifier needs (RFC 4506): big-endian 32/64-bit
 * integers, fixed and variable opaque data padded to four bytes, and strings.
 * Only what a contract-view simulation, a ledger-entry read and an event
 * decode use; anything else is refused by the callers, never guessed at.
 */

function pad(length: number): number {
  return (4 - (length % 4)) % 4;
}

export class XdrWriter {
  private readonly chunks: Uint8Array[] = [];

  u32(value: number): this {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0);
    this.chunks.push(bytes);
    return this;
  }

  i64(value: bigint): this {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigInt64(0, value);
    this.chunks.push(bytes);
    return this;
  }

  fixed(bytes: Uint8Array): this {
    this.chunks.push(bytes, new Uint8Array(pad(bytes.length)));
    return this;
  }

  varOpaque(bytes: Uint8Array): this {
    return this.u32(bytes.length).fixed(bytes);
  }

  string(text: string): this {
    return this.varOpaque(new TextEncoder().encode(text));
  }

  bytes(): Uint8Array {
    const total = this.chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  base64(): string {
    return Buffer.from(this.bytes()).toString("base64");
  }
}
