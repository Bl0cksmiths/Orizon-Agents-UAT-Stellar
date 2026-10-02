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

export class XdrReader {
  private offset = 0;
  private readonly buf: Uint8Array;
  private readonly view: DataView;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  static fromBase64(text: string): XdrReader {
    return new XdrReader(Uint8Array.from(Buffer.from(text, "base64")));
  }

  private need(length: number): void {
    if (this.offset + length > this.buf.length) throw new Error("XDR read past the end of the buffer");
  }

  u32(): number {
    this.need(4);
    const value = this.view.getUint32(this.offset);
    this.offset += 4;
    return value;
  }

  i32(): number {
    this.need(4);
    const value = this.view.getInt32(this.offset);
    this.offset += 4;
    return value;
  }

  u64(): bigint {
    this.need(8);
    const value = this.view.getBigUint64(this.offset);
    this.offset += 8;
    return value;
  }

  i64(): bigint {
    this.need(8);
    const value = this.view.getBigInt64(this.offset);
    this.offset += 8;
    return value;
  }

  bool(): boolean {
    const value = this.u32();
    if (value > 1) throw new Error(`XDR bool out of range: ${value}`);
    return value === 1;
  }

  fixed(length: number): Uint8Array {
    this.need(length + pad(length));
    const out = this.buf.slice(this.offset, this.offset + length);
    this.offset += length + pad(length);
    return out;
  }

  varOpaque(): Uint8Array {
    return this.fixed(this.u32());
  }

  string(): string {
    return new TextDecoder().decode(this.varOpaque());
  }

  /** Throws unless every byte was consumed: a short decode is a wrong decode. */
  end(): void {
    if (this.offset !== this.buf.length) {
      throw new Error(`XDR has ${this.buf.length - this.offset} unread trailing bytes`);
    }
  }
}

