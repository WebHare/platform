import { LinearBufferReader, LinearBufferWriter } from "./bufs";

export enum VariableType {
  Uninitialized = 0x00,                 ///< Not initialised variable
  Variant = 0x01,
  Integer = 0x10,
  Money = 0x11,
  Float = 0x12,
  Boolean = 0x13,
  DateTime = 0x14,
  Table = 0x15,
  Schema = 0x16,
  Integer64 = 0x17,
  FunctionRecord = 0x20,
  Record = 0x21,
  String = 0x22,
  Object = 0x23,
  WeakObject = 0x24,
  Blob = 0x40,
  Array = 0x80,
  VariantArray = 0x81,
  IntegerArray = 0x90,
  MoneyArray = 0x91,
  FloatArray = 0x92,
  BooleanArray = 0x93,
  DateTimeArray = 0x94,
  TableArray = 0x95,
  Integer64Array = 0x97,
  FunctionRecordArray = 0xa0,
  RecordArray = 0xa1,
  StringArray = 0xa2,
  ObjectArray = 0xa3,
  BlobArray = 0xc0,
}

/* new Date(100000000 * 86400000) is also valid, but to keep parity with HS we set
   it at the very last millisecond of a day
*/
const maxDatetimeTotalMsecs = 100000000 * 86400000 - 1;

/** Maximum representable datetime
*/
export const maxDatetime = new Date(maxDatetimeTotalMsecs);

const MarshalFormatType = 2;
const MarshalPacketFormatType = 3;


export function readMarshalData(buffer: Buffer): SimpleMarshallableData {
  const buf = new LinearBufferReader(buffer);
  const version = buf.readU8();
  if (version !== MarshalFormatType) // FIXME: support largeblobs mode
    throw new Error(`Unsupported marshal format type #${version}`);

  const columns: string[] = [];

  const columncount = buf.readU32();
  for (let i = 0; i < columncount; ++i) {
    const colsize = buf.readU8();
    columns.push(buf.readRaw(colsize).toString("utf-8").toLowerCase());
  }

  const type = buf.readU8() as VariableType;
  const retval = marshalReadInternal(buf, type, columns, null);
  if (buf.readpos != buf.length)
    throw new Error(`Garbage at end of marshalling packet`);
  return retval as SimpleMarshallableData;
}

export function readMarshalPacket(buffer: Buffer): IPCMarshallableData {
  const buf = new LinearBufferReader(buffer);
  const version = buf.readU32();
  if (version !== MarshalFormatType) // FIXME: support largeblobs mode
    throw new Error(`Unsupported marshal format type #${version}`);

  const columnsize = buf.readU32();
  const datasize = buf.readU32();
  const totalblobsize = buf.readBigU64();

  const columns: string[] = [];

  if (columnsize) {
    buf.readpos = 20;
    const columncount = buf.readU32();
    for (let i = 0; i < columncount; ++i) {
      const colsize = buf.readU8();
      columns.push(buf.readRaw(colsize).toString("utf-8").toLowerCase());
    }
    if (buf.readpos != 20 + columnsize)
      throw new Error(`Error in marshalling packet: incorrect column section size`);
  }


  const blobs: Uint8Array[] = [];
  if (totalblobsize) {
    buf.readpos = 20 + columnsize + datasize;
    const blobcount = buf.readU32();
    for (let idx = 0; idx < blobcount; ++idx) {
      const blobsize = buf.readBigU64();
      blobs.push(buf.readRaw(Number(blobsize)));
    }
    if (buf.readpos != 20 + columnsize + datasize + Number(totalblobsize))
      throw new Error(`Error in marshalling packet: incorrect blob section size`);
  }

  buf.readpos = 20 + columnsize;
  const dataformat = buf.readU8();
  if (dataformat != MarshalPacketFormatType)
    throw new Error(`Error in marshalling packet: Invalid data format`);
  const type = buf.readU8() as VariableType;
  const retval = marshalReadInternal(buf, type, columns, blobs);
  if (buf.readpos != 20 + columnsize + datasize)
    throw new Error(`Error in marshalling packet: incorrect data section size`);
  return retval;
}

function marshalReadInternal(buf: LinearBufferReader, type: VariableType, columns: string[], blobs: Uint8Array[] | null): IPCMarshallableData {
  if (type & 0x80) {
    const eltcount = buf.readU32();
    const retval: IPCMarshallableData[] = [];
    if (type == VariableType.VariantArray) {
      for (let i = 0; i < eltcount; ++i) {
        const subtype = buf.readU8() as VariableType;
        retval.push(marshalReadInternal(buf, subtype, columns, blobs));
      }
    } else {
      for (let i = 0; i < eltcount; ++i) {
        retval.push(marshalReadInternal(buf, type & ~0x80, columns, blobs));
      }
    }
    return retval;
  }
  switch (type) {
    case VariableType.Integer: {
      return buf.readS32();
    }
    case VariableType.Integer64: {
      return buf.readBigS64();
    }
    case VariableType.Money: {
      // ADDME: specialized type?
      return Number(buf.readBigS64()) / 100000;
    }
    case VariableType.Float: {
      return buf.readDouble();
    }
    case VariableType.Boolean: {
      return buf.readBoolean();
    }
    case VariableType.DateTime: {
      const days = buf.readU32() - 719163;
      const msecs = buf.readU32();
      const totalmsecs = days * 86400000 + msecs;
      if (totalmsecs >= maxDatetimeTotalMsecs)
        return maxDatetime;
      return new Date(totalmsecs);
    }
    case VariableType.String: {
      return buf.readString();
    }
    case VariableType.Blob: {
      if (blobs) {
        const blobid = buf.readU32();
        if (!blobid)
          return new Uint8Array();
        else
          return blobs[blobid - 1];
      } else
        return buf.readBinary();
    }
    case VariableType.FunctionRecord: {
      throw new Error(`Cannot decode FUNCTIONRECORD yet`); // FIXME?
    }
    case VariableType.Record: {
      const eltcount = buf.readS32();
      if (eltcount < 0)
        return null;
      const retval: { [s: string]: IPCMarshallableData } = {};
      for (let i = 0; i < eltcount; ++i) {
        const namenr = buf.readU32();
        if (namenr >= columns.length)
          throw new Error(`Corrupt marshal packet: column name nr out of range`);
        const subtype = buf.readU8() as VariableType;
        retval[columns[namenr]] = marshalReadInternal(buf, subtype, columns, blobs);
      }
      return retval;
    }
    case VariableType.Object: {
      throw new Error(`Cannot decode OBJECT`);
    }
    case VariableType.WeakObject: {
      throw new Error(`Cannot decode WEAK OBJECT`);
    }
    default: {
      throw new Error(`Cannot decode type #${type}`);
    }
  }
}

export function writeMarshalData(value: unknown, { onlySimple }: { onlySimple?: boolean } = {}): Buffer {
  const columns = new Map<string, number>();

  const datawriter = new LinearBufferWriter();
  const visited = new Set<object>;
  const blobs = onlySimple ? [] : null;
  writeMarshalDataInternal(value, datawriter, columns, blobs, null, visited);
  if (blobs && blobs.length)
    throw new Error(`Cannot include Buffers or types arrays in in this mode`);

  const startwriter = new LinearBufferWriter();
  startwriter.writeU8(2);
  const len = columns.size;
  startwriter.writeU32(len);
  for (const [key] of [...columns.entries()].sort((a, b) => a[1] - b[1])) {
    const strbuf = Buffer.from(key, "utf-8");
    if (strbuf.length > 64)
      throw new Error(`Key too long: ${JSON.stringify(key)}`);
    startwriter.writeU8(strbuf.length);
    startwriter.writeRaw(strbuf);
  }

  return Buffer.concat([startwriter.finish(), datawriter.finish()]);
}

export function writeMarshalPacket(value: unknown): Buffer {

  const columns = new Map<string, number>();

  const datawriter = new LinearBufferWriter();
  const visited = new Set<object>;
  const blobs: Uint8Array[] = [];
  datawriter.writeU8(MarshalPacketFormatType);
  writeMarshalDataInternal(value, datawriter, columns, blobs, null, visited);

  const columnwriter = new LinearBufferWriter();
  columnwriter.writeU32(columns.size);
  for (const [key] of [...columns.entries()].sort((a, b) => a[1] - b[1])) {
    const strbuf = Buffer.from(key, "utf-8");
    if (strbuf.length > 64)
      throw new Error(`Key too long: ${JSON.stringify(key)}`);
    columnwriter.writeU8(strbuf.length);
    columnwriter.writeRaw(strbuf);
  }

  const blobwriter = new LinearBufferWriter();
  if (blobs.length) {

    blobwriter.writeU32(blobs.length);
    for (const blob of blobs) {
      blobwriter.writeU64(BigInt(blob.byteLength));
      blobwriter.writeRaw(blob);
    }
  }

  const data_column = columnwriter.finish();
  const data_data = datawriter.finish();
  const data_blob = blobwriter.finish();

  const startwriter = new LinearBufferWriter();
  startwriter.writeU32(MarshalFormatType);
  startwriter.writeU32(data_column.byteLength);
  startwriter.writeU32(data_data.byteLength);
  startwriter.writeU64(BigInt(data_blob.byteLength));

  return Buffer.concat([startwriter.finish(), data_column, data_data, data_blob]);
}

function unifyEltTypes(a: VariableType, b: VariableType): VariableType {
  if (a === b || a === VariableType.Variant)
    return a;
  if (b === VariableType.Variant)
    return b;
  if (a === VariableType.Integer && (b === VariableType.Float || b === VariableType.Money || b === VariableType.Integer64))
    return b;
  if (b === VariableType.Integer && (a === VariableType.Float || a === VariableType.Money || a === VariableType.Integer64))
    return a;
  if (a === VariableType.Money && b === VariableType.Float)
    return b;
  if (b === VariableType.Money && a === VariableType.Float)
    return a;

  return VariableType.Variant;
}

function determineType(value: unknown): VariableType {
  if (Array.isArray(value)) {
    if (value.length === 0)
      return VariableType.VariantArray;
    let elttype = determineType(value[0]);
    for (let i = 1; i < value.length; ++i) {
      elttype = unifyEltTypes(elttype, determineType(value[i]));
    }
    return elttype | VariableType.Array;
  }
  switch (typeof value) {
    case "object": {
      if (value instanceof Uint8Array || value instanceof ArrayBuffer)
        return VariableType.Blob;
      if (value instanceof Date)
        return VariableType.DateTime;
      return VariableType.Record;
    }
    case "bigint": {
      return VariableType.Integer64;
    }
    case "boolean": {
      return VariableType.Boolean;
    }
    case "string": {
      return VariableType.String;
    }
    case "number": {
      if (value === Math.floor(value)) {
        if (value >= -2147483648 && value < 2147483648)
          return VariableType.Integer;
        return VariableType.Integer64;
      }
      return VariableType.Float;
    }
    default: {
      throw new Error(`Cannot send variable of type ${JSON.stringify(typeof value)}`);
    }
  }
}

function writeMarshalDataInternal(value: unknown, writer: LinearBufferWriter, columns: Map<string, number>, blobs: Uint8Array[] | null, type: VariableType | null, visited: Set<object>) {
  if (type === null) {
    type = determineType(value);
    writer.writeU8(type);
  }
  if (type & VariableType.Array) {
    if (visited.has(value as unknown[]))
      throw new Error(`Detected a circular reference`);
    visited.add(value as unknown[]);

    const len = (value as unknown[]).length;
    writer.writeU32(len);
    const subtype = type == VariableType.VariantArray ? null : type & ~VariableType.Array;
    for (let i = 0; i < len; ++i) {
      writeMarshalDataInternal((value as unknown[])[i], writer, columns, blobs, subtype, visited);
    }
    return;
  }
  switch (type) {
    case VariableType.Integer: {
      writer.writeS32(value as number);
    } break;
    case VariableType.Integer64: {
      writer.writeS64(BigInt(value as (number | bigint)));
    } break;
    case VariableType.Float: {
      writer.writeDouble(value as number);
    } break;
    case VariableType.Boolean: {
      writer.writeU8(value as boolean ? 1 : 0);
    } break;
    case VariableType.String: {
      writer.writeString(value as string);
    } break;
    case VariableType.DateTime: {
      const totalmsecs = Number(value as Date);
      let days, msecs;
      if (totalmsecs >= maxDatetimeTotalMsecs) {
        days = 2147483647;
        msecs = 86400000 - 1;
      } else {
        days = Math.floor(totalmsecs / 86400000);
        msecs = totalmsecs - days * 86400000;
        days += 719163; // 1970-1-1

        if (days < 0 || msecs < 0) {
          days = 0;
          msecs = 0;
        }
      }
      writer.writeU32(days);
      writer.writeU32(msecs);
    } break;
    case VariableType.Record: {
      if (value === null)
        writer.writeS32(-1);
      else {
        if (visited.has(value as object))
          throw new Error(`Detected a circular reference`);
        visited.add(value as object);

        const entries = Object.entries(value as object);
        writer.writeS32(entries.length);
        for (const [key, subvalue] of entries) {
          let columnid = columns.get(key.toUpperCase());
          if (columnid === undefined) {
            columnid = columns.size;
            columns.set(key.toUpperCase(), columnid);
          }
          writer.writeU32(columnid);
          writeMarshalDataInternal(subvalue, writer, columns, blobs, null, visited);
        }
      }
    } break;
    case VariableType.Blob: {
      const uint8array = new Uint8Array(value as (Uint8Array | ArrayBuffer));
      if (blobs) {
        if (uint8array.byteLength == 0)
          writer.writeU32(0);
        else {
          blobs.push(uint8array);
          writer.writeU32(blobs.length);
        }
      } else {
        writer.writeBinary(uint8array);
      }
    } break;
    default: {
      throw new Error(`Cannot encode type ${type}`);
    }
  }
}

export function encodeHSON(value: IPCMarshallableData): string {
  return "hson:" + encodeHSONInternal(value);
}

function encodeHSONInternal(value: IPCMarshallableData): string {
  const type = determineType(value);
  let retval = "";
  switch (type) {
    case VariableType.VariantArray: retval = "va["; break;
    case VariableType.BooleanArray: retval = "ba["; break;
    case VariableType.DateTimeArray: retval = "da["; break;
    case VariableType.MoneyArray: retval = "ma["; break;
    case VariableType.FloatArray: retval = "fa["; break;
    case VariableType.StringArray: retval = "sa["; break;
    case VariableType.BlobArray: retval = "xa["; break;
    case VariableType.Integer64Array: retval = "i64a["; break;
    case VariableType.IntegerArray: retval = "ia["; break;
    case VariableType.RecordArray: retval = "ra["; break;
    case VariableType.ObjectArray: retval = "oa["; break;

    case VariableType.Boolean: retval = value ? "true" : "false"; break;
    case VariableType.DateTime: {
      const dt = value as Date;
      const totalmsecs = Number(dt);

      let daysvalue = Math.floor(totalmsecs / 86400000);
      const msecsvalue = totalmsecs - daysvalue * 86400000;
      daysvalue += 719163; // 1970-1-1

      if (totalmsecs >= maxDatetimeTotalMsecs) {
        retval = `d"MAX"`;
      } else if (daysvalue == 0 && msecsvalue == 0 || daysvalue < 0 || msecsvalue < 0) {
        retval = `d""`;
      } else if (daysvalue == 0) {
        retval = `d"T${msecsvalue}"`;
      } else {
        const year = String(dt.getUTCFullYear()).padStart(4, "0");
        const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
        const day = String(dt.getUTCDate()).padStart(2, "0");
        const hours = String(dt.getUTCHours()).padStart(2, "0");
        const minutes = String(dt.getUTCMinutes()).padStart(2, "0");
        const seconds = String(dt.getUTCSeconds()).padStart(2, "0");
        const mseconds = String(dt.getUTCMilliseconds()).padStart(3, "0");
        retval = `d"${year}${month}${day}T${hours}${minutes}${seconds}.${mseconds}"`;
      }
    } break;
    case VariableType.Float: retval = "f " + (value as number).toString(); break;
    case VariableType.String: retval = JSON.stringify(value); break;
    case VariableType.Blob: {
      const buf = Buffer.from(value as (Uint8Array | ArrayBuffer));
      retval = `b"` + buf.toString("base64") + `"`;
    } break;
    case VariableType.Integer64: retval = "i64 " + (value as number | bigint).toString(); break;
    case VariableType.Integer: retval = (value as number).toString(); break;
    case VariableType.Record: {
      const recval = value as IPCMarshallableRecord;
      if (!recval)
        retval = "*";
      else {
        retval = "{";
        let first = true;
        for (const [key, propval] of Object.entries(recval).sort(([a], [b]) => a === b ? 0 : a < b ? -1 : 1)) {
          if (!first)
            retval = retval + ",";
          else
            first = false;
          retval = retval + JSON.stringify(key) + ":" + encodeHSONInternal(propval);
        }
        retval = retval + "}";
      }
    } break;

    default:
      throw new Error(`Cannot encode type ${type}`);
  }
  if (type & VariableType.Array) {

    let first = true;
    for (const item of value as IPCMarshallableData[]) {
      if (!first)
        retval = retval + ",";
      else
        first = false;
      retval = retval + encodeHSONInternal(item);
    }
    return retval + "]";
  }
  return retval;
}


export type SimpleMarshallableData = boolean | null | string | number | bigint | Date | { [key in string]: SimpleMarshallableData } | SimpleMarshallableData[];
export type SimpleMarshallableRecord = null | { [key in string]: SimpleMarshallableData };

export type IPCMarshallableData = boolean | null | string | number | bigint | Date | ArrayBuffer | Uint8Array | { [key in string]: IPCMarshallableData } | IPCMarshallableData[];
export type IPCMarshallableRecord = null | { [key in string]: IPCMarshallableData };
