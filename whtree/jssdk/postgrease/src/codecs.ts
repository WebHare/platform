/* eslint-disable @typescript-eslint/no-explicit-any */
import { DataTypeOids } from "./types/oids";
import { buildArrayCodec } from "./codec-support";
import { Box, Circle, type Codec, LSeg, Point, Tid } from "./types/codec-types";
import { isDate, isTemporalInstant, throwError } from "@webhare/std";


export const DataTypeOid: Codec<number, number> = {
  name: "oid",
  oid: DataTypeOids.oid,
  encodeBinary: (builder, value) => {
    if (!Number.isInteger(value) || value < 0 || value >= 4294967296)
      throw new Error(`Invalid oid value ${value}`);
    builder.alloc(4);
    builder.dataview.setUint32(builder.idx, value);
    builder.idx += 4;
  },
  decodeBinary: (buffer, dataview, offset, len) => dataview.getUint32(offset),
  jitDecoder: retval => `${retval}=dataview.getUint32(offset);`,
  test: { type: "number", integer: true, signed: false, bits: 32 },
};

export const DataTypeRegProc: Codec<number, number> = {
  ...DataTypeOid,
  name: "regproc",
  oid: DataTypeOids.regproc,
};

export const DataTypeBool: Codec<boolean, boolean> = {
  name: "bool",
  oid: DataTypeOids.bool,
  encodeBinary: (builder, value) => {
    if (value !== true && value !== false)
      throw new Error(`Invalid bool value ${value}`);
    builder.alloc(1);
    builder.dataview.setUint8(builder.idx++, value ? 1 : 0);
  },
  decodeBinary: (buffer, dataview, offset, len) => buffer[offset] !== 0,
  jitDecoder: retval => `${retval}=buffer[offset]!==0;`,
  test: { type: "boolean" },
};

export const DataTypeFloat4: Codec<number, number> = {
  name: "float4",
  oid: DataTypeOids.float4,
  encodeBinary: (builder, value) => {
    if (typeof value !== "number")
      throw new Error(`Invalid float4 value ${value}`);
    builder.alloc(4);
    builder.dataview.setFloat32(builder.idx, value);
    builder.idx += 4;
  },
  decodeBinary: (buffer, dataview, offset, len) => dataview.getFloat32(offset),
  jitDecoder: retval => `${retval}=dataview.getFloat32(offset);`,
  test: { type: "number", integer: false },
};

export const DataTypeFloat8: Codec<number, number> = {
  name: "float8",
  oid: DataTypeOids.float8,
  encodeBinary: (builder, value) => {
    if (typeof value !== "number")
      throw new Error(`Invalid float8 value ${value}`);
    builder.alloc(8);
    builder.dataview.setFloat64(builder.idx, value);
    builder.idx += 8;
  },
  decodeBinary: (buffer, dataview, offset, len) => dataview.getFloat64(offset),
  jitDecoder: retval => `${retval}=dataview.getFloat64(offset);`,
  test: { type: "number", integer: false },
};

export const DataTypeInt2: Codec<number, number> = {
  name: "int2",
  oid: DataTypeOids.int2,
  encodeBinary: (builder, value) => {
    if (!Number.isInteger(value) || value < -32768 || value > 32767)
      throw new Error(`Invalid int2 value ${value}`);
    builder.alloc(2);
    builder.dataview.setInt16(builder.idx, value);
    builder.idx += 2;
  },
  decodeBinary: (buffer, dataview, offset, len) => dataview.getInt16(offset),
  jitDecoder: retval => `${retval}=dataview.getInt16(offset);`,
  test: { type: "number", integer: true, signed: true, bits: 16 },
};

export const DataTypeInt4: Codec<number, number> = {
  name: "int4",
  oid: DataTypeOids.int4,
  encodeBinary: (builder, value) => {
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)
      throw new Error(`Invalid int4 value ${value}`);
    builder.alloc(4);
    builder.dataview.setInt32(builder.idx, value);
    builder.idx += 4;
  },
  decodeBinary: (buffer, dataview, offset, len) => dataview.getInt32(offset),
  jitDecoder: retval => `${retval}=dataview.getInt32(offset);`,
  test: { type: "number", integer: true, signed: true, bits: 32 },
};

export const DataTypeInt8: Codec<bigint | number, bigint | number> = {
  name: "int8",
  oid: DataTypeOids.int8,
  encodeBinary: (builder, value) => {
    if (!Number.isInteger(value) && (typeof value !== "bigint" || value < -9223372036854775808n || value > 9223372036854775807n))
      throw new Error(`Invalid int8 value ${value}`);
    builder.alloc(8);
    builder.dataview.setBigInt64(builder.idx, BigInt(value));
    builder.idx += 8;
  },
  decodeBinary: (buffer, dataview, offset, len) => { const v = dataview.getBigInt64(offset); return Number.isSafeInteger(Number(v)) ? Number(dataview.getBigInt64(offset)) : v; },
  jitDecoder: (retval, codecExpr) => `{const v=dataview.getBigInt64(offset);const n=Number(v);${retval}=Number.isSafeInteger(n)?n:v}`,
  test: { type: "number", integer: true, signed: true, bits: 64 },
};

const uuid_regex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const DataTypeUuid: Codec<string, string> = {
  name: "uuid",
  oid: DataTypeOids.uuid,
  encodeBinary: (builder, value) => {
    if (typeof value !== "string")
      throw new Error(`Invalid uuid value: ${value}`);
    const hex = value.replace(/-/g, '');
    if (!hex.match(/^[0-9a-fA-F]{32}$/))
      throw new Error(`Invalid uuid value: ${value}`);
    builder.alloc(16);
    builder.buffer.hexWrite(hex, builder.idx, 16);
    builder.idx += 16;
  },
  decodeBinary: (buffer, dataview, offset, len) => {
    const str = buffer.hexSlice(offset, offset + 16);
    return str.slice(0, 8) + '-' + str.slice(8, 12) + '-' + str.slice(12, 16) + '-' + str.slice(16, 20) + '-' + str.slice(20, 32);
  },
  jitDecoder: retval => {
    return `const str=buffer.hexSlice(offset,offset+16);${retval}=str.slice(0,8)+'-'+str.slice(8,12)+'-'+str.slice(12,16)+'-'+str.slice(16,20)+'-'+str.slice(20,32);`;
  },
  test: { type: "string", test: (value: string): boolean => uuid_regex.test(value) },
};

export const DataTypeBytea: Codec<Buffer, Buffer> = {
  name: "bytea",
  oid: DataTypeOids.bytea,
  encodeBinary: (builder, value) => {
    if (value?.byteLength === undefined)
      throw new Error(`Invalid bytea value`);
    builder.alloc(value.byteLength);
    builder.buffer.set(value, builder.idx);
    builder.idx += value.byteLength;
  },
  decodeBinary: (buffer, dataview, offset, len) => {
    const retval = Buffer.allocUnsafe(len);
    buffer.copy(retval, 0, offset, offset + len);
    return retval;
  },
  jitDecoder: retval => `${retval}=Buffer.allocUnsafe(len);buffer.copy(${retval},0,offset,offset+len);`,
  test: { type: "object", priority: 0, test: (value: object): boolean => Buffer.isBuffer(value) },
};


export const DataTypeText: Codec<string, string> = {
  name: "text",
  oid: DataTypeOids.text,
  encodeBinary: (builder, value) => {
    if (typeof value !== "string")
      throw new Error(`Invalid text value: ${value}`);
    const len = Buffer.byteLength(value);
    builder.alloc(len);
    builder.idx += builder.buffer.utf8Write(value, builder.idx);
  },
  decodeBinary: (buffer, dataview, offset, len) => buffer.utf8Slice(offset, offset + len),
  jitDecoder: retval => `${retval}=buffer.utf8Slice(offset,offset+len);`,
  test: { type: "string" },
};

export const DataTypeVarChar = { ...DataTypeText, name: "varchar", oid: DataTypeOids.varchar };
export const DataTypeName = { ...DataTypeText, name: "name", oid: DataTypeOids.name };

export const DataTypeChar: Codec<string, string> = {
  name: "char",
  oid: DataTypeOids.char,
  encodeBinary: (builder, value) => {
    if (typeof value !== "string")
      throw new Error(`Invalid char value: ${value}`);
    value = (value + " ")[0];
    const len = Buffer.byteLength(value);
    builder.alloc(len);
    builder.idx += builder.buffer.utf8Write(value, builder.idx);
  },
  decodeBinary: (buffer, dataview, offset, len) => buffer.utf8Slice(offset, offset + len),
  jitDecoder: retval => `${retval}=buffer.utf8Slice(offset,offset+len);`,
  test: { type: "string", test: (value: string): boolean => [...value].length === 1 },
};

export const DataTypeTid: Codec<Tid, Tid> = {
  name: "tid",
  oid: DataTypeOids.tid,
  encodeBinary: (builder, value) => {
    if (value?.block === undefined || value?.offset === undefined)
      throw new Error(`Invalid tid value`);
    builder.alloc(6);
    builder.dataview.setUint32(builder.idx, value.block);
    builder.dataview.setUint16(builder.idx + 4, value.offset);
    builder.idx += 6;
  },
  decodeBinary: (buffer, dataview, offset, len) => {
    return new Tid(dataview.getUint32(offset), dataview.getUint16(offset + 4));
  },
  jitDecoder: retval => {
    return `${retval}={block:dataview.getUint32(offset),offset:dataview.getUint16(offset+4)};`;
  },
  test: { type: "object", priority: 0, test: (value: object): boolean => typeof value === "object" && value !== null && "block" in value && "offset" in value },
};

/** Fallback for data that can't be determined (only NULL atm) */
export const DataTypeUnknown: Codec<null, never> = {
  name: "unknown",
  oid: DataTypeOids.unknown,
  encodeBinary: (builder, value) => {
    if (value !== null)
      throw new Error(`Invalid unknown value: ${value}`);
    return null;
  },
  decodeBinary: (buffer, dataview, offset, len) => throwError(`Cannot decode 'unknown' type`),
  test: { type: "null" },
};

const timeShiftMs = 946_684_800_000n;
const timeShiftNs = 946_684_800_000_000_000n;
const minInt64 = -9223372036854775808n;
const maxInt64 = 9223372036854775807n;

export const DataTypeTimeStamp: Codec<Date | Temporal.Instant | number, Date | number> = {
  name: "timestamp",
  oid: DataTypeOids.timestamp,
  encodeBinary: (builder, v: Date | Temporal.Instant | number) => {
    if (v === Infinity) {
      builder.alloc(8);
      builder.dataview.setInt32(builder.idx, 0x7fffffff); // hi
      builder.dataview.setUint32(builder.idx + 4, 0xffffffff);
      builder.idx += 8;
      return;
    }
    if (v === -Infinity) {
      builder.alloc(8);
      builder.dataview.setInt32(builder.idx, -0x80000000); // hi
      builder.dataview.setUint32(builder.idx + 4, 0x00000000);
      builder.idx += 8;
      return;
    }
    let n = isDate(v) ?
      BigInt(v.getTime()) :
      isTemporalInstant(v) ?
        BigInt(v.epochMilliseconds) :
        typeof v === "number" ?
          BigInt(new Date(v).getTime()) :
          throwError(`Invalid timestamp value ${v}`);
    n = (n - timeShiftMs) * 1000n;
    builder.alloc(8);
    builder.dataview.setBigInt64(builder.idx, n);
    builder.idx += 8;
  },
  decodeBinary: (buffer, dataview, offset, len) => {
    const microSeconds = dataview.getBigInt64(offset);
    if (microSeconds === maxInt64) return Infinity;
    if (microSeconds === minInt64) return -Infinity;
    return new Date(Number((microSeconds / 1000n) + timeShiftMs));
  },
  test: { type: "object", priority: null, test: (value: object): boolean => isDate(value) || isTemporalInstant(value) },
};

export const DataTypeTimeStampTz: Codec<Date | Temporal.Instant | number, Date | number> = {
  name: "timestamptz",
  oid: DataTypeOids.timestamptz,
  encodeBinary: (builder, v: Date | Temporal.Instant | number) => {
    if (v === Infinity) {
      builder.alloc(8);
      builder.dataview.setInt32(builder.idx, 0x7fffffff); // hi
      builder.dataview.setUint32(builder.idx + 4, 0xffffffff);
      builder.idx += 8;
      return;
    }
    if (v === -Infinity) {
      builder.alloc(8);
      builder.dataview.setInt32(builder.idx, -0x80000000); // hi
      builder.dataview.setUint32(builder.idx + 4, 0x00000000);
      builder.idx += 8;
      return;
    }
    let n = isDate(v) ?
      BigInt(v.getTime()) :
      isTemporalInstant(v) ?
        BigInt(v.epochMilliseconds) :
        typeof v === "number" ?
          BigInt(new Date(v).getTime()) :
          throwError(`Invalid timestamp value ${v}`);
    builder.alloc(8);
    n = (n - timeShiftMs) * 1000n;
    builder.dataview.setBigInt64(builder.idx, n);
    builder.idx += 8;
  },
  decodeBinary: (buffer, dataview, offset, len) => {
    const microSeconds = dataview.getBigInt64(offset);
    if (microSeconds === maxInt64) return Infinity;
    if (microSeconds === minInt64) return -Infinity;
    return new Date(Number((microSeconds / 1000n) + timeShiftMs));
  },
  // Prefer timestamps with timezone info when decoding to Date
  test: { type: "object", priority: 0, test: (value: object): boolean => isDate(value) || isTemporalInstant(value) },
};

export const DataTypeTimeStampTemporal: Codec<Temporal.Instant | Date | number | string | bigint, Temporal.Instant | number | bigint> = {
  name: "timestamp",
  oid: DataTypeOids.timestamp,
  encodeBinary: (builder, v: Temporal.Instant | Date | number | string | bigint) => {
    builder.alloc(8);
    let val: bigint;
    if (v === Infinity)
      val = maxInt64;
    else if (v === -Infinity)
      val = minInt64;
    else {
      if (typeof v === "bigint")
        val = v;
      else if (typeof v === "number")
        val = BigInt(Math.floor(v * 1_000_000)); // microseconds to nanoseconds
      else if (typeof v === "string")
        val = Temporal.ZonedDateTime.from(v).epochNanoseconds;
      else if (isDate(v))
        val = BigInt(v.getTime()) * 1_000_000n;
      else if (isTemporalInstant(v))
        val = v.epochNanoseconds;
      else
        throw new Error(`Invalid timestamp value ${v}`);
      val = (val - timeShiftNs) / 1000n;
    }
    builder.dataview.setBigInt64(builder.idx, val);
    builder.idx += 8;
  },
  decodeBinary: (buffer, dataview, offset, len) => {
    const microSeconds = dataview.getBigInt64(offset);
    if (microSeconds === maxInt64) return Infinity as unknown as Temporal.Instant;
    if (microSeconds === minInt64) return -Infinity as unknown as Temporal.Instant;

    // Shift from 2000 to 1970
    return Temporal.Instant.fromEpochNanoseconds(microSeconds * 1000n + timeShiftNs);
  },
  test: { type: "object", priority: null, test: (value: object): boolean => isDate(value) || isTemporalInstant(value) },
};

export const DataTypeTimeStampTzTemporal: Codec<Temporal.Instant | Date | number | string | bigint, Temporal.Instant | number> = {
  name: "timestamptz",
  oid: DataTypeOids.timestamptz,
  encodeBinary: (builder, v: Temporal.Instant | Date | number | string | bigint) => {
    builder.alloc(8);
    let val: bigint;
    if (v === Infinity)
      val = maxInt64;
    else if (v === -Infinity)
      val = minInt64;
    else {
      if (typeof v === "bigint")
        val = v;
      else if (typeof v === "number")
        val = BigInt(Math.floor(v * 1_000_000)); // microseconds to nanoseconds
      else if (typeof v === "string")
        val = Temporal.ZonedDateTime.from(v).epochNanoseconds;
      else if (isDate(v))
        val = BigInt(v.getTime()) * 1_000_000n;
      else if (isTemporalInstant(v))
        val = v.epochNanoseconds;
      else
        throw new Error(`Invalid timestamp value ${v}`);
      val = (val - timeShiftNs) / 1000n;
    }
    builder.dataview.setBigInt64(builder.idx, val);
    builder.idx += 8;
  },
  decodeBinary: (buffer, dataview, offset, len) => {
    const microSeconds = dataview.getBigInt64(offset);
    console.log({ microSeconds });
    if (microSeconds === maxInt64) return Infinity;
    if (microSeconds === minInt64) return -Infinity;

    // Shift from 2000 to 1970
    return Temporal.Instant.fromEpochNanoseconds(microSeconds * 1000n + timeShiftNs);
  },
  test: { type: "object", priority: 0, test: (value: object): boolean => isDate(value) || isTemporalInstant(value) },
};

export const DataTypeJSON: Codec<any, any> = {
  name: "json",
  oid: DataTypeOids.json,
  encodeBinary: (builder, value) => {
    const json = JSON.stringify(value);
    if (value === undefined || json === undefined || json.indexOf("\\u0000") !== -1)
      throw new Error(`Invalid json value`);
    const len = Buffer.byteLength(json);
    builder.alloc(len);
    builder.idx += builder.buffer.utf8Write(json, builder.idx);
  },
  decodeBinary: (buffer, dataview, offset, len) => {
    if (!len)
      throw new Error(`Invalid json value`);
    return JSON.parse(buffer.utf8Slice(offset, offset + len));
  },
  jitDecoder: retval => `${retval}=JSON.parse(buffer.utf8Slice(offset,offset+len));`,
  test: { type: "json" },
};

export const DataTypeJSONB: Codec<any, any> = {
  name: "jsonb",
  oid: DataTypeOids.jsonb,
  encodeBinary: (builder, value) => {
    const json = JSON.stringify(value);
    if (value === undefined || json === undefined || json.indexOf("\\u0000") !== -1)
      throw new Error(`Invalid jsonb value`);
    const len = Buffer.byteLength(json) + 1;
    builder.alloc(len);
    builder.dataview.setUint8(builder.idx++, 1); // version
    builder.idx += builder.buffer.utf8Write(json, builder.idx);
  },
  decodeBinary: (buffer, dataview, offset, len) => {
    if (len < 2)
      throw new Error(`Invalid jsonb value`);
    if (buffer[offset] !== 1)
      throw new Error(`Unsupported jsonb version ${buffer[offset]}`);
    return JSON.parse(buffer.utf8Slice(offset + 1, offset + len));
  },
  jitDecoder: retval => `${retval}=JSON.parse(buffer.utf8Slice(offset+1,offset+len));`,
  test: { type: "json" },
};

export const DataTypePoint: Codec<Point, Point> = {
  name: "point",
  oid: DataTypeOids.point,
  encodeBinary: (builder, value) => {
    if (value?.x === undefined || value?.y === undefined)
      throw new Error(`Invalid point value`);
    builder.alloc(16);
    builder.dataview.setFloat64(builder.idx, value.x);
    builder.dataview.setFloat64(builder.idx + 8, value.y);
    builder.idx += 16;
  },
  decodeBinary: (buffer, dataview, offset, len) => {
    return {
      x: dataview.getFloat64(offset),
      y: dataview.getFloat64(offset + 8),
    };
  },
  jitDecoder: retval => {
    return `${retval}={x:dataview.getFloat64(offset),y:dataview.getFloat64(offset+8)};`;
  },
  test: { type: "object", priority: 0, test: (value: object): boolean => value instanceof Point },
};

export const DataTypeBox: Codec<Box, Box> = {
  name: "box",
  oid: DataTypeOids.box,
  encodeBinary: (builder, value) => {
    if (value?.x1 === undefined || value?.y1 === undefined || value?.x2 === undefined || value?.y2 === undefined)
      throw new Error(`Invalid box value`);
    builder.alloc(32);
    builder.dataview.setFloat64(builder.idx, value.x1);
    builder.dataview.setFloat64(builder.idx + 8, value.y1);
    builder.dataview.setFloat64(builder.idx + 16, value.x2);
    builder.dataview.setFloat64(builder.idx + 24, value.y2);
    builder.idx += 32;
  },
  decodeBinary: (buffer, dataview, offset, len) => {
    return new Box(
      dataview.getFloat64(offset),
      dataview.getFloat64(offset + 8),
      dataview.getFloat64(offset + 16),
      dataview.getFloat64(offset + 24),
    );
  },
  jitDecoder: (retval, codecExpr) => `${retval}=new (${codecExpr}).jitDecoderContext(dataview.getFloat64(offset),dataview.getFloat64(offset+8),dataview.getFloat64(offset+16),dataview.getFloat64(offset+24));`,
  jitDecoderContext: Box,
  test: { type: "object", priority: 0, test: (value: object): boolean => value instanceof Point },
};

export const DataTypeLSeg: Codec<LSeg, LSeg> = {
  name: "lseg",
  oid: DataTypeOids.lseg,
  encodeBinary: (builder, value) => {
    if (value?.x1 === undefined || value?.y1 === undefined || value?.x2 === undefined || value?.y2 === undefined)
      throw new Error(`Invalid lseg value`);
    builder.alloc(32);
    builder.dataview.setFloat64(builder.idx, value.x1);
    builder.dataview.setFloat64(builder.idx + 8, value.y1);
    builder.dataview.setFloat64(builder.idx + 16, value.x2);
    builder.dataview.setFloat64(builder.idx + 24, value.y2);
    builder.idx += 32;
  },
  decodeBinary: (buffer, dataview, offset, len) => {
    return new LSeg(
      dataview.getFloat64(offset),
      dataview.getFloat64(offset + 8),
      dataview.getFloat64(offset + 16),
      dataview.getFloat64(offset + 24),
    );
  },
  jitDecoder: (retval, codecExpr) => `${retval}=new (${codecExpr}).jitDecoderContext(dataview.getFloat64(offset),dataview.getFloat64(offset+8),dataview.getFloat64(offset+16),dataview.getFloat64(offset+24));`,
  jitDecoderContext: LSeg,
  test: { type: "object", priority: 0, test: (value: object): boolean => value instanceof LSeg },
};

export const DataTypeCircle: Codec<Circle, Circle> = {
  name: "circle",
  oid: DataTypeOids.circle,
  encodeBinary: (builder, value) => {
    if (value?.x === undefined || value?.y === undefined || value?.r === undefined)
      throw new Error(`Invalid circle value`);
    builder.alloc(24);
    builder.dataview.setFloat64(builder.idx, value.x);
    builder.dataview.setFloat64(builder.idx + 8, value.y);
    builder.dataview.setFloat64(builder.idx + 16, value.r);
    builder.idx += 24;
  },
  decodeBinary: (buffer, dataview, offset, len) => {
    return new Circle(
      dataview.getFloat64(offset),
      dataview.getFloat64(offset + 8),
      dataview.getFloat64(offset + 16),
    );
  },
  jitDecoder: (retval, codecExpr) => `${retval}=new (${codecExpr}).jitDecoderContext(dataview.getFloat64(offset),dataview.getFloat64(offset+8),dataview.getFloat64(offset+16));`,
  jitDecoderContext: Circle,
  test: { type: "object", priority: 0, test: (value: object): boolean => value instanceof Circle },
};

export const DataTypeFallbackDecoder: Codec<never, Buffer> = {
  name: "--",
  oid: 0,
  encodeBinary: (builder, value) => {
    throw new Error(`Cannot encode value with the fallback decoder`);
  },
  decodeBinary: (buffer, dataview, offset, len) => {
    const retval = Buffer.allocUnsafe(len);
    buffer.copy(retval, 0, offset, offset + len);
    return retval;
  },
  jitDecoder: retval => `${retval}=Buffer.allocUnsafe(len);buffer.copy(${retval},0,offset,offset+len);`,
  test: { type: "object", priority: null, test: (value: object) => false },
};

export const DataTypeVectorOid = buildArrayCodec(DataTypeOid, DataTypeOids.oidvector, "oidvector");
export const DataTypeOidArray = buildArrayCodec(DataTypeOid, DataTypeOids._oid, "_oid");
export const DataTypeBoolArray = buildArrayCodec(DataTypeBool, DataTypeOids._bool, "_bool");
export const DataTypeFloat4Array = buildArrayCodec(DataTypeFloat4, DataTypeOids._float4, "_float4");
export const DataTypeFloat8Array = buildArrayCodec(DataTypeFloat8, DataTypeOids._float8, "_float8");
export const DataTypeInt2Array = buildArrayCodec(DataTypeInt2, DataTypeOids._int2, "_int2");
export const DataTypeInt4Array = buildArrayCodec(DataTypeInt4, DataTypeOids._int4, "_int4");
export const DataTypeInt8Array = buildArrayCodec(DataTypeInt8, DataTypeOids._int8, "_int8");
export const DataTypeUuidArray = buildArrayCodec(DataTypeUuid, DataTypeOids._uuid, "_uuid");
export const DataTypeByteaArray = buildArrayCodec(DataTypeBytea, DataTypeOids._bytea, "_bytea");
export const DataTypeInt2Vector = buildArrayCodec(DataTypeInt2, DataTypeOids.int2vector, "int2vector");
export const DataTypeInt2VectorArray = buildArrayCodec(DataTypeInt2Vector, DataTypeOids._int2vector, "_int2vector");
export const DataTypeCharArray = buildArrayCodec(DataTypeChar, DataTypeOids._char, "_char");
export const DataTypeVarCharArray = buildArrayCodec(DataTypeVarChar, DataTypeOids._varchar, "_varchar");
export const DataTypeTextArray = buildArrayCodec(DataTypeText, DataTypeOids._text, "_text");
export const DataTypeTidArray = buildArrayCodec(DataTypeTid, DataTypeOids._tid, "_tid");
export const DataTypeTimeStampArray = buildArrayCodec(DataTypeTimeStamp, DataTypeOids._timestamp, "_timestamp");
export const DataTypeTimeStampTzArray = buildArrayCodec(DataTypeTimeStampTz, DataTypeOids._timestamptz, "_timestamptz");
export const DataTypeTimeStampTemporalArray = buildArrayCodec(DataTypeTimeStampTemporal, DataTypeOids._timestamp, "_timestamp");
export const DataTypeTimeStampTzTemporalArray = buildArrayCodec(DataTypeTimeStampTzTemporal, DataTypeOids._timestamptz, "_timestamptz");
export const DataTypeCircleArray = buildArrayCodec(DataTypeCircle, DataTypeOids._circle, "_circle");
export const DataTypeBoxArray = buildArrayCodec(DataTypeBox, DataTypeOids._box, "_box");
export const DataTypePointArray = buildArrayCodec(DataTypePoint, DataTypeOids._point, "_point");

// Generate the codecs for reg* types
const regOidCodesNames = ["regclass", "regcollation", "regconfig", "regdictionary", "regnamespace", "regoper", "regoperator", "regproc", "regprocedure", "regrole", "regtype"] as const;
export const DataTypeRegOidCodecs = regOidCodesNames.map(name => {
  const eltCodec = {
    ...DataTypeOid,
    name,
    oid: DataTypeOids[name],
  };
  const arrayCodec = buildArrayCodec(eltCodec, DataTypeOids[`_${name}`], `_${name}`);
  return [eltCodec, arrayCodec];
}).flat();

export const nonDateCodecs: Codec<any, any>[] = [
  DataTypeOid,
  DataTypeBool,
  DataTypeFloat4,
  DataTypeFloat8,
  DataTypeInt2,
  DataTypeInt4,
  DataTypeInt8,
  DataTypeUuid,
  DataTypeBytea,
  DataTypeText,
  DataTypeVarChar,
  DataTypeName,
  DataTypeChar,
  DataTypeTid,
  DataTypeJSON,
  DataTypeJSONB,
  DataTypePoint,
  DataTypeBox,
  DataTypeCircle,
  DataTypeUnknown,
  DataTypeVectorOid,
  DataTypeOidArray,
  DataTypeBoolArray,
  DataTypeFloat4Array,
  DataTypeFloat8Array,
  DataTypeInt2Array,
  DataTypeInt4Array,
  DataTypeInt8Array,
  DataTypeUuidArray,
  DataTypeByteaArray,
  DataTypeInt2Vector,
  DataTypeInt2VectorArray,
  DataTypeCharArray,
  DataTypeVarCharArray,
  DataTypeTextArray,
  DataTypeTidArray,
  ...DataTypeRegOidCodecs,
];

export const defaultCodecs: Codec<any, any>[] = [
  ...nonDateCodecs,
  DataTypeTimeStamp,
  DataTypeTimeStampTz,
  DataTypeTimeStampArray,
  DataTypeTimeStampTzArray,
];

export const defaultTemporalCodecs: Codec<any, any>[] = [
  ...nonDateCodecs,
  DataTypeTimeStampTemporal,
  DataTypeTimeStampTzTemporal,
  DataTypeTimeStampTemporalArray,
  DataTypeTimeStampTzTemporalArray,
];
