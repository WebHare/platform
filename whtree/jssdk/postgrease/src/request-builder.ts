/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Codec } from "./types/codec-types";
import type { UndocumentedBuffer } from "./types/node-types";
import type * as Codes from "./types/protocol-codes";

export class RequestBuilder {
  idx = 0;
  buffer = Buffer.allocUnsafe(1024 * 1024) as UndocumentedBuffer;
  dataview = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  lastEnd = 0;

  initPacket(code: number, contentSize: number) {
    if (this.idx !== this.lastEnd)
      throw new Error(`Last packet didn't write to expected end, ${this.idx} but expected ${this.lastEnd}`);
    const wantEnd = this.idx + (code ? 1 : 0) + contentSize + 4;
    if (wantEnd > this.buffer.length) {
      const newBuffer = Buffer.allocUnsafe(Math.max(this.buffer.length * 2, wantEnd + 65536)) as UndocumentedBuffer;
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
      this.dataview = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
    }
    if (code)
      this.dataview.setUint8(this.idx++, code);
    this.dataview.setUint32(this.idx, contentSize + 4);
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
    this.lastEnd = wantEnd;
    if (wantEnd > this.buffer.length) {
      const newBuffer = Buffer.allocUnsafe(Math.max(this.buffer.length * 2, wantEnd + 65536)) as UndocumentedBuffer;
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
      this.dataview = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
    }
  }

  writeBinaryParam(codec: Codec<any, any>, value: any) {
    const lenIdx = this.idx;
    this.alloc(4);
    this.idx += 4;
    if (value === null) {
      this.dataview.setInt32(lenIdx, -1);
      return false;
    } else {
      const res = codec.encodeBinary(this, value);
      this.dataview.setInt32(lenIdx, res === null ? -1 : this.idx - lenIdx - 4);
      return res !== null;
    }
  }

  cancelRequest(processId: number, secretKey: UndocumentedBuffer) {
    this.initPacket(0, 8 + secretKey.byteLength);
    this.dataview.setUint32(this.idx, 80877102); // Cancel request code
    this.idx += 4;
    this.dataview.setUint32(this.idx, processId);
    this.idx += 4;
    this.idx += secretKey.copy(this.buffer, this.idx);
  }

  sslRequest() {
    this.initPacket(0, 4);
    this.dataview.setUint32(this.idx, 80877103); // SSL request code
    this.idx += 4;
  }

  startupMessage(username: string, database: string) {
    this.initPacket(0, 42 + Buffer.byteLength(username) + Buffer.byteLength(database));
    this.dataview.setUint32(this.idx, 196610); // Protocol version 3.0
    this.idx += 4;
    this.idx += this.buffer.utf8Write(`user\0${username}\0`, this.idx);
    this.idx += this.buffer.utf8Write(`database\0${database}\0`, this.idx);
    this.idx += this.buffer.utf8Write(`client_encoding\0UTF8\0\0`, this.idx);
  }

  bind(portal: string, statement: string, params: unknown[], paramCodecs: { encodeBinary: (rb: RequestBuilder, value: unknown) => void; encodeText?: (value: unknown) => string }[]) {
    if (params.length !== paramCodecs.length)
      throw new Error(`Parameter count mismatch: ${params.length} values but ${paramCodecs.length} codecs`);
    const startPos = this.initPacket(66 as Codes.CodeBind, 6 + Buffer.byteLength(portal) + Buffer.byteLength(statement) + paramCodecs.length * 2);
    this.idx += this.buffer.utf8Write(portal + '\0', this.idx);
    this.idx += this.buffer.utf8Write(statement + '\0', this.idx);
    this.dataview.setUint16(this.idx, paramCodecs.length);
    this.idx += 2;
    const codecIdx = this.idx;
    this.idx += paramCodecs.length * 2;
    this.dataview.setUint16(this.idx, params.length);
    this.idx += 2;
    for (let i = 0; i < params.length; i++) {
      const lenIdx = this.idx;
      const codec = paramCodecs[i];
      this.alloc(4);
      this.idx += 4;
      if (params[i] === null) {
        this.dataview.setInt16(codecIdx + i * 2, 1);
        this.dataview.setInt32(lenIdx, -1);
      } else {
        let contentLen;
        if (codec.encodeBinary) {
          const oldIdx = this.idx;
          this.dataview.setInt16(codecIdx + i * 2, 1);
          const res = codec.encodeBinary(this, params[i]);
          contentLen = res === null ? -1 : this.idx - oldIdx;
        } else {
          this.dataview.setInt16(codecIdx + i * 2, 0);
          contentLen = this.buffer.utf8Write((codec.encodeText as (value: unknown) => string)(params[i]), this.idx);
        }
        this.dataview.setInt32(lenIdx, contentLen);
      }
    }
    this.alloc(4);
    this.dataview.setInt16(this.idx, 1); // Result format: [ binary ] - specifies binary for all columns
    this.idx += 2;
    this.dataview.setInt16(this.idx, 1); //  binary
    this.idx += 2;
    this.dataview.setUint32(startPos, this.idx - startPos); // Patchup packet length
  }

  close(isPortal: boolean, name: string) {
    this.initPacket(67 as Codes.CodeClose, 2 + Buffer.byteLength(name));
    this.dataview.setUint8(this.idx++, isPortal ? 80 : 83); // 'P' or 'S'
    this.idx += this.buffer.utf8Write(name + '\0', this.idx);
  }

  // copy: to determine - just a stream of bytes

  copyDone() {
    this.initPacket(99 as Codes.CodeCopyDone, 0);
  }

  copyFail(reason: string) {
    this.initPacket(102 as Codes.CodeCopyFail, Buffer.byteLength(reason) + 1);
    this.idx += this.buffer.utf8Write(reason + '\0', this.idx);
  }

  describe(isPortal: boolean, name: string) {
    this.initPacket(68 as Codes.CodeDescribe, 2 + Buffer.byteLength(name));
    this.dataview.setUint8(this.idx++, isPortal ? 80 : 83); // 'P' or 'S'
    this.idx += this.buffer.utf8Write(name + '\0', this.idx);
  }

  execute(portal: string, maxRows: number) {
    this.initPacket(69 as Codes.CodeExecute, 1 + Buffer.byteLength(portal) + 4);
    this.idx += this.buffer.utf8Write(portal + '\0', this.idx);
    this.dataview.setUint32(this.idx, maxRows);
    this.idx += 4;
  }

  flush() {
    this.initPacket(72 as Codes.CodeFlush, 0);
  }

  functionCall(oid: number, params: unknown[], paramCodecs: Codec<any, any>[], binaryResult: boolean) {
    if (params.length !== paramCodecs.length)
      throw new Error(`Parameter count mismatch: ${params.length} values but ${paramCodecs.length} codecs`);
    const startPos = this.initPacket(70 as Codes.CodeFunctionCall, 8 + paramCodecs.length * 2);
    this.dataview.setUint32(this.idx, oid);
    this.idx += 4;
    this.dataview.setUint16(this.idx, paramCodecs.length);
    this.idx += 2;
    const codecIdx = this.idx;
    this.idx += paramCodecs.length * 2;
    this.dataview.setUint16(this.idx, params.length);
    this.idx += 2;
    for (let i = 0; i < params.length; i++) {
      const lenIdx = this.idx;
      this.alloc(4);
      this.idx += 4;
      if (params[i] === null) {
        this.dataview.setInt16(codecIdx + i * 2, 1);
        this.dataview.setInt32(lenIdx, -1);
      } else {
        const codec = paramCodecs[i];
        const oldIdx = this.idx;
        this.dataview.setInt16(codecIdx + i * 2, 1);
        const res = codec.encodeBinary(this, params[i]);
        const contentLen = res === null ? -1 : this.idx - oldIdx;
        this.dataview.setInt32(lenIdx, contentLen);
      }
    }
    this.alloc(2);
    this.dataview.setInt16(this.idx, binaryResult ? 1 : 0);// Result format
    this.idx += 2;
    this.dataview.setUint32(startPos, this.idx - startPos); // Patchup packet length
  }

  parse(name: string, query: string, parameterTypes: number[]) {
    this.initPacket(80 as Codes.CodeParse, 4 + Buffer.byteLength(name) + Buffer.byteLength(query) + (4 * parameterTypes.length));
    let idx = this.idx;
    idx += this.buffer.utf8Write(name + '\0', idx);
    idx += this.buffer.utf8Write(query + '\0', idx);
    this.dataview.setUint16(idx, parameterTypes.length);
    idx += 2;
    for (const type of parameterTypes) {
      this.dataview.setUint32(idx, type);
      idx += 4;
    }
    this.idx = idx;
  }

  query(sql: string) {
    const sqlLen = Buffer.byteLength(sql, 'utf8');
    this.initPacket(81 as Codes.CodeQuery, sqlLen + 1);
    this.idx += this.buffer.utf8Write(sql + '\0', this.idx);
  }

  sync() {
    this.initPacket(83 as Codes.CodeSync, 0);
  }

  terminate() {
    this.initPacket(88 as Codes.CodeTerminate, 0);
  }
}
