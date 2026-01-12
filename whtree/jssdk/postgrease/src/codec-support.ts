/* eslint-disable @typescript-eslint/no-explicit-any */
import { throwError } from "@webhare/std";
import type { RequestBuilder } from "./request-builder";
import type { Codec } from "./types/codec-types";
import type { UndocumentedBuffer } from "./types/node-types";

export function buildArrayCodec<ElementIn, ElementOut>(arrayEltCodec: Codec<ElementIn, ElementOut>, oid: number, name: string): Codec<ElementIn[], ElementOut[]> {
  const eltCodec = arrayEltCodec.arrayEltCodec ?? arrayEltCodec;

  function writeLeaf(builder: RequestBuilder, data: any[], anyNullHolder: { anyNull: 0 | 1 }) {
    for (const element of data) {
      if (element === null) {
        builder.alloc(4);
        builder.idx = builder.buffer.writeInt32BE(-1, builder.idx);
        anyNullHolder.anyNull ||= 1;
      } else {
        const lenIdx = builder.idx;
        builder.alloc(4);
        builder.idx += 4;
        const oldIdx = builder.idx;
        const res = eltCodec.encodeBinary(builder, element);
        builder.buffer.writeInt32BE(res === null ? -1 : builder.idx - oldIdx, lenIdx);
        if (res === null)
          anyNullHolder.anyNull ||= 1;
      }
    }
  }
  function writeLevel(builder: RequestBuilder, dims: number[], data: any[], anyNullHolder: { anyNull: 0 | 1 }, level: number) {
    if (data.length !== dims[level])
      throw new Error(`Array value does not match expected dimension length ${dims[level]} (got ${data.length})`);
    ++level;
    const expectLen = dims[level];
    if (level === dims.length - 1) {
      for (const item of data) {
        if (!Array.isArray(item) || item.length !== expectLen)
          throw new Error(`Array value does not match expected dimension length ${expectLen} at leaf level`);
        writeLeaf(builder, item, anyNullHolder);
      }
    } else {
      for (const item of data) {
        if (!Array.isArray(item) || item.length !== expectLen)
          throw new Error(`Array value does not match expected dimension length ${expectLen} at leaf level`);
        writeLevel(builder, dims, item, anyNullHolder, level);
      }
    }
  }

  return {
    name,
    oid,
    arrayEltCodec,
    encodeBinary: (builder, value) => {
      const anyNullHolder: { anyNull: 0 | 1 } = { anyNull: 0 };
      builder.alloc(12);
      const start = builder.idx;
      // defer writing the number of dimensions and whether nulls present
      builder.idx = builder.buffer.writeInt32BE(eltCodec.oid, builder.idx + 8); // element type OID

      if (!Array.isArray(value))
        throw new Error(`Array binary encoder expected array value, got ${typeof value}`);
      if (value.length === 0 || !Array.isArray(value[0])) { // dimension 1
        builder.buffer.writeInt32BE(1, start);
        builder.alloc(8);
        builder.idx = builder.buffer.writeInt32BE(value.length, builder.idx); // length of dimension
        builder.idx = builder.buffer.writeInt32BE(0, builder.idx); // lower bound, always 0
        writeLeaf(builder, value, anyNullHolder);
      } else {
        // Calculate dimensions
        const dims: number[] = [];
        let dimTestValue: any[] = value;
        while (true) {
          if (!Array.isArray(dimTestValue) || dimTestValue.length === 0)
            break;
          builder.alloc(8);
          dims.push(dimTestValue.length);
          dimTestValue = dimTestValue[0];

          builder.idx = builder.buffer.writeInt32BE(dimTestValue.length, builder.idx); // length of dimension
          builder.idx = builder.buffer.writeInt32BE(0, builder.idx); // lower bound, always 0
        }
        builder.buffer.writeInt32BE(dims.length, start);
        writeLevel(builder, dims, value, anyNullHolder, 0);
      }
      builder.buffer.writeInt32BE(anyNullHolder.anyNull, start + 4);
    },
    decodeBinary: (buffer, dataview, offset, len) => {
      if (len < 12)
        throw new Error(`Array binary data too short: ${len} bytes`);
      const ndims = dataview.getInt32(offset);
      // ignore has-nulls flag
      const elementOID = dataview.getInt32(offset + 8);

      if (ndims <= 0)
        return [];
      if (len < 12 + ndims * 8)
        throw Error(`Array binary data too short for ${ndims} dimensions: ${len} bytes`);

      // fast-path: 1 dimensional arrays
      if (ndims === 1) {
        const dimLength = dataview.getInt32(offset + 12);
        // ignore the lower bound
        if (elementOID !== eltCodec.oid)
          throw Error(`Array binary data has unexpected element OID: ${elementOID} (expected ${eltCodec.oid})`);
        // adjust the expected length for the elements data lengths
        let expectLen = 20 + dimLength * 4;
        if (len < expectLen)
          throw Error(`Array binary data too short for ${dimLength} elements: ${len} bytes`);
        offset += 20;
        const result: ElementOut[] = new Array(dimLength);
        for (let i = 0; i < dimLength; i++) {
          const elementLen = dataview.getInt32(offset);
          offset += 4;
          if (elementLen === -1)
            result[i] = null as any;
          else {
            expectLen += elementLen;
            if (len < expectLen)
              throw Error(`Array binary data too short for element ${i} with length ${elementLen}: ${len} bytes`);
            result[i] = eltCodec.decodeBinary(buffer, dataview, offset, elementLen);
            offset += elementLen;
          }
        }
        return result;
      } else {
        const dimLens: number[] = [];
        let totalElts = 1;
        for (let i = 0; i < ndims; i++) {
          const dimSize = dataview.getInt32(offset + 12 + i * 8);
          // ignore the lower bound
          dimLens.push(dimSize);
          if (dimSize < 0)
            throw new Error(`Array binary data has negative length in dimension ${i}: length ${dimLens[i]}`);
          totalElts *= dimSize;
        }
        offset += 12 + ndims * 8;
        let expectLen = 12 + ndims * 8 + totalElts * 4;
        if (len < expectLen)
          throw Error(`Array binary data too short for ${totalElts} elements: ${len} bytes`);

        function parseLeaf(level: number) {
          const size = dimLens[level];
          const result = [];
          for (let i = 0; i < size; i++) {
            const elementLen = dataview.getInt32(offset);
            offset += 4;
            if (elementLen === -1)
              result.push(null);
            else {
              expectLen += elementLen;
              if (len < expectLen)
                throw Error(`Array binary data too short for element ${i} with length ${elementLen}: ${len} bytes`);
              result.push(eltCodec.decodeBinary(buffer, dataview, offset, elementLen));
              offset += elementLen;
            }
          }
          return result;
        }

        function parseLevel(level: number) {
          const size = dimLens[level];
          ++level;
          const subParse = level === dimLens.length - 1 ? parseLeaf : parseLevel;
          const result: any[] = [];
          for (let i = 0; i < size; i++)
            result.push(subParse(level));
          return result;
        }

        return parseLevel(0);
      }
    },
  };
}

type DecoderFunction = (context: DecoderContext, buffer: UndocumentedBuffer, dataview: DataView, offset: number, datalen: number) => object;
type DecoderContext = Record<`v${number}`, Codec<any, any>> & {
  cols: { fieldName: string; codec: Codec<any, any> }[];
  throwError(message: string): void;
};

export type RowDecoderData = { func: DecoderFunction; context: DecoderContext };

const rowDecoderCache = new Map<string, RowDecoderData>;
let funcConstructorEnabled = true;

export function getRowDecoder(cols: { fieldName: string; codec: Codec<any, any> }[]): { func: DecoderFunction; context: DecoderContext } {
  const key = cols.map(col => `${col.fieldName}\x00${col.codec.oid}`).join('\x00');
  let retval: { func: DecoderFunction; context: DecoderContext } | undefined = rowDecoderCache.get(key);
  if (!retval) {
    const context = { cols, throwError };
    if (funcConstructorEnabled)
      retval = { func: compileJITRowDecoder(context) ?? genericRowDecoder, context };
    retval ??= { func: genericRowDecoder, context };
    rowDecoderCache.set(key, retval);
  }
  return retval;
}

export function compileJITRowDecoder(context: DecoderContext): DecoderFunction | null {
  let fnBody = `const fieldCount=dataview.getInt16(offset);if(fieldCount!==${context.cols.length})return throwError(\`Unexpected number of fields (expected ${context.cols.length}, got \${fieldCount}\`);offset+=2;`;
  for (const [idx, col] of context.cols.entries()) {
    if (col.codec.jitDecoder)
      fnBody += `let v${idx};{const len=dataview.getInt32(offset);offset+=4;if(len===-1)v${idx}=null;else{${col.codec.jitDecoder(`v${idx}`, `context.cols[${idx}].codec`)};offset+=len;}}`;
    else {
      context[`v${idx}`] = col.codec;
      fnBody += `let v${idx};{const len=dataview.getInt32(offset);offset+=4;if(len===-1)v${idx}=null;else{v${idx}=context[${JSON.stringify(`v${idx}`)}].decodeBinary(buffer,dataview,offset,len);offset+=len;}}`;
    }
  }
  fnBody += `return{${context.cols.entries().toArray().map(([idx, col]) => `${JSON.stringify(col.fieldName)}:v${idx}`).join(",")}};`;

  try {
    // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
    return Function("context", "buffer", "dataview", "offset", "datalen", fnBody) as (context: DecoderContext, buffer: UndocumentedBuffer, dataview: DataView, offset: number, dataLen: number) => object;
  } catch (e) {
    funcConstructorEnabled = false;
    return null;
  }
}

export function genericRowDecoder(context: DecoderContext, buffer: UndocumentedBuffer, dataview: DataView, offset: number, datalen: number): object {
  const fieldCount = dataview.getInt16(offset);
  if (fieldCount !== context.cols.length)
    return throwError(`Unexpected number of fields (expected ${context.cols.length}, got ${fieldCount})`);
  offset += 2;
  const row: Record<string, unknown> = {};
  for (const col of context.cols) {
    const len = dataview.getInt32(offset);
    offset += 4;
    if (len === -1)
      row[col.fieldName] = null;
    else {
      if (!col.codec.decodeBinary) {
        // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
        col.codec.decodeBinary = new Function("buffer", "dataview", "offset", "len", col.codec.jitDecoder!("return", "this")) as (buffer: UndocumentedBuffer, dataview: DataView, offset: number, len: number) => any;
      }
      row[col.fieldName] = col.codec.decodeBinary(buffer, dataview, offset, len);
      offset += len;
    }
  }
  return row;
}

export function __setJITDecoderEnabled(enabled: boolean) {
  funcConstructorEnabled = enabled;
  rowDecoderCache.clear();
}
