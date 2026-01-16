/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Codec } from "./types/codec-types";
import type { UndocumentedBuffer } from "./types/node-types";
import type * as Codes from "./types/protocol-codes";

export class RequestBuilder {
  idx = 0;
  buffer = Buffer.allocUnsafe(1024 * 1024) as UndocumentedBuffer;
  lastEnd = 0;

  initPacket(code: number, contentSize: number) {
    if (this.idx !== this.lastEnd)
      throw new Error(`Last packet didn't write to expected end, ${this.idx} but expected ${this.lastEnd}`);
    const wantEnd = this.idx + (code ? 1 : 0) + contentSize + 4;
    if (wantEnd > this.buffer.length) {
      const newBuffer = Buffer.allocUnsafe(Math.max(this.buffer.length * 2, wantEnd + 65536)) as UndocumentedBuffer;
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
    }
    if (code)
      this.buffer.writeUInt8(code, this.idx++);
    this.buffer.writeUInt32BE(contentSize + 4, this.idx); // Length
    this.idx += 4;
    this.lastEnd = this.idx + contentSize;
    //console.log(`RequestBuilder: initPacket code='${code ? String.fromCharCode(code) : 'startup/ssl/cancel'}' size=${contentSize}: ${Codes.getCodeName(code, false)}`);
    return this.idx - 4;
  }

  reset() {
    this.idx = 0;
    this.lastEnd = 0;
  }

  alloc(size: number) {
    if (this.idx !== this.lastEnd)
      throw new Error(`Last packet didn't write to expected end, ${this.idx} but expected ${this.lastEnd}`);
    if (size < 0)
      throw new Error(`Cannot alloc negative size ${size}`);
    const wantEnd = this.idx + size;
    if (wantEnd > this.buffer.length) {
      const newBuffer = Buffer.allocUnsafe(Math.max(this.buffer.length * 2, wantEnd + 65536)) as UndocumentedBuffer;
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
    }
    this.lastEnd = this.idx + size;
  }

  writeBinaryParam(codec: Codec<any, any>, value: any) {
    const lenIdx = this.idx;
    this.alloc(4);
    this.idx += 4;
    if (value === null) {
      this.buffer.writeInt32BE(-1, lenIdx);
      return false;
    } else {
      const res = codec.encodeBinary(this, value);
      this.buffer.writeInt32BE(res === null ? -1 : this.idx - lenIdx - 4, lenIdx);
      return res !== null;
    }
  }

  cancelRequest(processId: number, secretKey: UndocumentedBuffer) {
    this.initPacket(0, 8 + secretKey.byteLength);
    this.idx = this.buffer.writeUInt32BE(80877102, this.idx); // Cancel request code
    this.idx = this.buffer.writeUInt32BE(processId, this.idx);
    this.idx += secretKey.copy(this.buffer, this.idx);
  }

  sslRequest() {
    this.initPacket(0, 4);
    this.buffer.writeUInt32BE(80877103, this.idx); // SSL request code
    this.idx += 4;
  }

  startupMessage(username: string, database: string) {
    this.initPacket(0, 42 + Buffer.byteLength(username) + Buffer.byteLength(database));
    this.idx = this.buffer.writeUInt32BE(196610, this.idx); // Protocol version 3.0
    this.idx += this.buffer.write(`user\0${username}\0`, this.idx, 'utf8');
    this.idx += this.buffer.write(`database\0${database}\0`, this.idx, 'utf8');
    this.idx += this.buffer.write(`client_encoding\0UTF8\0\0`, this.idx, 'utf8');
  }

  bind(portal: string, statement: string, params: unknown[], paramCodecs: { encodeBinary: (rb: RequestBuilder, value: unknown) => void; encodeText?: (value: unknown) => string }[]) {
    if (params.length !== paramCodecs.length)
      throw new Error(`Parameter count mismatch: ${params.length} values but ${paramCodecs.length} codecs`);
    const startPos = this.initPacket(66 as Codes.CodeBind, 6 + Buffer.byteLength(portal) + Buffer.byteLength(statement) + paramCodecs.length * 2);
    this.idx += this.buffer.write(portal + '\0', this.idx, 'utf8');
    this.idx += this.buffer.write(statement + '\0', this.idx, 'utf8');
    this.idx = this.buffer.writeUInt16BE(paramCodecs.length, this.idx);
    const codecIdx = this.idx;
    this.idx += paramCodecs.length * 2;
    this.idx = this.buffer.writeUInt16BE(params.length, this.idx);
    for (let i = 0; i < params.length; i++) {
      const lenIdx = this.idx;
      const codec = paramCodecs[i];
      this.alloc(4);
      this.idx += 4;
      if (params[i] === null) {
        this.buffer.writeInt16BE(1, codecIdx + i * 2);
        this.buffer.writeInt32BE(-1, lenIdx);
      } else {
        let contentLen;
        if (codec.encodeBinary) {
          const oldIdx = this.idx;
          this.buffer.writeInt16BE(1, codecIdx + i * 2);
          const res = codec.encodeBinary(this, params[i]);
          contentLen = res === null ? -1 : this.idx - oldIdx;
        } else {
          this.buffer.writeInt16BE(0, codecIdx + i * 2);
          contentLen = this.buffer.write((codec.encodeText as (value: unknown) => string)(params[i]), this.idx, 'utf8');
        }
        this.buffer.writeInt32BE(contentLen, lenIdx);
      }
    }
    this.alloc(4);
    this.idx = this.buffer.writeInt16BE(1, this.idx); // Result format: [ binary ] - specifies binary for all columns
    this.idx = this.buffer.writeInt16BE(1, this.idx); //  binary
    this.buffer.writeUInt32BE(this.idx - startPos, startPos); // Patchup packet length
  }

  close(isPortal: boolean, name: string) {
    this.initPacket(67 as Codes.CodeClose, 2 + Buffer.byteLength(name));
    this.buffer.writeUInt8(isPortal ? 80 : 83, this.idx++); // 'P' or 'S'
    this.idx += this.buffer.write(name + '\0', this.idx, 'utf8');
  }

  // copy: to determine - just a stream of bytes

  copyDone() {
    this.initPacket(99 as Codes.CodeCopyDone, 0);
  }

  copyFail(reason: string) {
    this.initPacket(102 as Codes.CodeCopyFail, Buffer.byteLength(reason) + 1);
    this.idx += this.buffer.write(reason + '\0', this.idx, 'utf8');
  }

  describe(isPortal: boolean, name: string) {
    this.initPacket(68 as Codes.CodeDescribe, 2 + Buffer.byteLength(name));
    this.buffer.writeUInt8(isPortal ? 80 : 83, this.idx++); // 'P' or 'S'
    this.idx += this.buffer.write(name + '\0', this.idx, 'utf8');
  }

  execute(portal: string, maxRows: number) {
    this.initPacket(69 as Codes.CodeExecute, 1 + Buffer.byteLength(portal) + 4);
    this.idx += this.buffer.write(portal + '\0', this.idx, 'utf8');
    this.buffer.writeUInt32BE(maxRows, this.idx);
    this.idx += 4;
  }

  flush() {
    this.initPacket(72 as Codes.CodeFlush, 0);
  }

  functionCall(oid: number, params: unknown[], paramCodecs: Codec<any, any>[], binaryResult: boolean) {
    if (params.length !== paramCodecs.length)
      throw new Error(`Parameter count mismatch: ${params.length} values but ${paramCodecs.length} codecs`);
    const startPos = this.initPacket(70 as Codes.CodeFunctionCall, 8 + paramCodecs.length * 2);
    this.idx = this.buffer.writeUInt32BE(oid, this.idx);
    this.idx = this.buffer.writeUInt16BE(paramCodecs.length, this.idx);
    const codecIdx = this.idx;
    this.idx += paramCodecs.length * 2;
    this.idx = this.buffer.writeUInt16BE(params.length, this.idx);
    for (let i = 0; i < params.length; i++) {
      const lenIdx = this.idx;
      this.alloc(4);
      this.idx += 4;
      if (params[i] === null) {
        this.buffer.writeInt16BE(1, codecIdx + i * 2);
        this.buffer.writeInt32BE(-1, lenIdx);
      } else {
        const codec = paramCodecs[i];
        const oldIdx = this.idx;
        this.buffer.writeInt16BE(1, codecIdx + i * 2);
        const res = codec.encodeBinary(this, params[i]);
        const contentLen = res === null ? -1 : this.idx - oldIdx;
        this.buffer.writeInt32BE(contentLen, lenIdx);
      }
    }
    this.alloc(2);
    this.idx = this.buffer.writeInt16BE(binaryResult ? 1 : 0, this.idx); // Result format
    this.buffer.writeUInt32BE(this.idx - startPos, startPos); // Patchup packet length
  }

  parse(name: string, query: string, parameterTypes: number[]) {
    this.initPacket(80 as Codes.CodeParse, 4 + Buffer.byteLength(name) + Buffer.byteLength(query) + (4 * parameterTypes.length));
    this.idx += this.buffer.write(name + '\0', this.idx, 'utf8');
    this.idx += this.buffer.write(query + '\0', this.idx, 'utf8');
    this.buffer.writeUInt16BE(parameterTypes.length, this.idx);
    this.idx += 2;
    for (const type of parameterTypes) {
      this.buffer.writeUInt32BE(type, this.idx);
      this.idx += 4;
    }
  }

  query(sql: string) {
    const sqlLen = Buffer.byteLength(sql, 'utf8');
    this.initPacket(81 as Codes.CodeQuery, sqlLen + 1);
    this.idx += this.buffer.write(sql + '\0', this.idx, 'utf8');
  }

  sync() {
    this.initPacket(83 as Codes.CodeSync, 0);
  }

  terminate() {
    this.initPacket(88 as Codes.CodeTerminate, 0);
  }
}
