
/** :Linearly read C++ primitive types from a buffer
*/
export class LinearBufferReader {
  buffer: Buffer;
  readpos = 0;

  constructor(_buffer: Buffer | ArrayBuffer) {
    this.buffer = "length" in _buffer ? _buffer : Buffer.from(_buffer);
  }

  get length() { return this.buffer.length; }

  readU8(): number {
    return this.readU(1);
  }
  readU32(): number {
    return this.readU(4);
  }
  readS32(): number {
    return this.readS(4);
  }
  /// Read a 64bit integer assuming its within the safe range for a JavaScript Number
  readBigNumber(): number {
    if (this.readpos + 8 > this.buffer.length)
      throw new Error("Invalid RPC data");
    const retval = this.buffer.readBigInt64LE(this.readpos);
    if (retval < Number.MIN_SAFE_INTEGER || retval > Number.MAX_SAFE_INTEGER)
      throw new Error("Invalid RPC data - expected a 64bit integer that was within a safe range for a JavaScript Number");
    this.readpos += 8;
    return Number(retval);
  }
  readBigU64(): bigint {
    if (this.readpos + 8 > this.buffer.length)
      throw new Error("Invalid RPC data");
    const retval = this.buffer.readBigUInt64LE(this.readpos);
    this.readpos += 8;
    return retval;
  }
  readBigS64(): bigint {
    if (this.readpos + 8 > this.buffer.length)
      throw new Error("Invalid RPC data");
    const retval = this.buffer.readBigInt64LE(this.readpos);
    this.readpos += 8;
    return retval;
  }
  readDouble(): number {
    if (this.readpos + 8 > this.buffer.length)
      throw new Error("Invalid RPC data");
    const retval = this.buffer.readDoubleLE(this.readpos);
    this.readpos += 8;
    return retval;
  }
  readBoolean(): boolean {
    return this.readU(1) !== 0;
  }
  readString(): string {
    return this.readBinary().toString("utf-8");
  }
  readBinary(): Buffer {
    const size = this.readU32();
    return this.readRaw(size);
  }
  readRaw(size: number): Buffer {
    if (this.readpos + size > this.buffer.length)
      throw new Error("Invalid RPC data");
    const retval = this.buffer.subarray(this.readpos, this.readpos + size);
    this.readpos += size;
    return retval;
  }
  readU(size: number) {
    if (this.readpos + size > this.buffer.length)
      throw new Error("Invalid RPC data");
    const retval = this.buffer.readUIntLE(this.readpos, size);
    this.readpos += size;
    return retval;
  }
  readS(size: number) {
    if (this.readpos + size > this.buffer.length)
      throw new Error("Invalid RPC data");
    const retval = this.buffer.readIntLE(this.readpos, size);
    this.readpos += size;
    return retval;
  }
}

/** Linearly write C++ primitive types to a buffer
*/
export class LinearBufferWriter {
  buffer: Buffer;
  writepos = 0;

  constructor() {
    this.buffer = Buffer.alloc(256, 0);
  }

  ensureRoom(size: number) {
    if (this.writepos + size > this.buffer.length) {
      let need = this.writepos + size - this.buffer.length;
      if (need < this.buffer.length)
        need = this.buffer.length;
      this.buffer = Buffer.concat([this.buffer, Buffer.alloc(need, 0)]);
    }
  }
  writeU8(value: number): void {
    this.writeU(value, 1);
  }
  writeU32(value: number): void {
    this.writeU(value, 4);
  }
  writeS32(value: number): void {
    this.writeS(value, 4);
  }
  writeBigNumber(value: number): void {
    if (value !== Math.floor(value) || value < Number.MIN_SAFE_INTEGER || value > Number.MAX_SAFE_INTEGER)
      throw new Error(`Attempted to write a non-integer or out-of-range number to a 64bit integer buffer: ${value}`);
    this.writeS64(BigInt(value));
  }
  writeU64(value: bigint): void {
    this.ensureRoom(8);
    this.buffer.writeBigUInt64LE(value, this.writepos);
    this.writepos += 8;
  }
  writeS64(value: bigint): void {
    this.ensureRoom(8);
    this.buffer.writeBigInt64LE(value, this.writepos);
    this.writepos += 8;
  }
  writeDouble(value: number): void {
    this.ensureRoom(8);
    this.buffer.writeDoubleLE(value, this.writepos);
    this.writepos += 8;
  }
  writeBoolean(value: boolean): void {
    this.writeU(value ? 1 : 0, 1);
  }
  writeString(value: string): void {
    const strbuf = Buffer.from(value, "utf-8");
    this.writeBinary(strbuf);
  }
  writeBinary(value: ArrayBuffer | Uint8Array): void {
    this.writeU32("length" in value ? value.length : value.byteLength);
    this.writeRaw(value);
  }
  writeRaw(value: ArrayBuffer | Uint8Array | string): void {
    const towrite = typeof value === "string" ? Buffer.from(value) : "length" in value ? value : new Uint8Array(value);
    this.ensureRoom(towrite.length);
    this.buffer.set(towrite, this.writepos);
    this.writepos += towrite.length;
  }
  writeU(value: number, size: number) {
    this.ensureRoom(size);
    this.buffer.writeUIntLE(value, this.writepos, size);
    this.writepos += size;
  }
  writeS(value: number, size: number) {
    this.ensureRoom(size);
    this.buffer.writeIntLE(value, this.writepos, size);
    this.writepos += size;
  }
  finish(): Buffer {
    return this.buffer.subarray(0, this.writepos);
  }
}
