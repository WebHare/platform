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

export function readMarshalPacket(buffer: Buffer) {
  const buf = new LinearBufferReader(buffer);
  const version = buf.readU8();
  if (version !== 2) // FIXME: support largeblobs mode
    throw new Error(`Unsupported marshal format type: connect with the same Webhare version`);

  const columns: string[] = [];

  const columncount = buf.readU32();
  for (let i = 0; i < columncount; ++i) {
    const colsize = buf.readU8();
    columns.push(buf.readRaw(colsize).toString("utf-8").toLowerCase());
  }

  const type = buf.readU8() as VariableType;
  const retval = marshalReadInternal(buf, type, columns);
  if (buf.readpos != buf.length)
    throw new Error(`Garbage at end of marshalling packet`);
  return retval;
}

function marshalReadInternal(buf: LinearBufferReader, type: VariableType, columns: string[]): unknown {
  if (type & 0x80) {
    const eltcount = buf.readU32();
    const retval: unknown[] = [];
    if (type == VariableType.VariantArray) {
      for (let i = 0; i < eltcount; ++i) {
        const subtype = buf.readU8() as VariableType;
        retval.push(marshalReadInternal(buf, subtype, columns));
      }
    } else {
      for (let i = 0; i < eltcount; ++i) {
        retval.push(marshalReadInternal(buf, type & ~0x80, columns));
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
      const days = buf.readU32();
      const msecs = buf.readU32();
      return new Date((days - 719163) * 86400000 + msecs);
    }
    case VariableType.String: {
      return buf.readString();
    }
    case VariableType.Blob: {
      return buf.readBinary();
    }
    case VariableType.FunctionRecord: {
      throw new Error(`Cannot decode FUNCTIONRECORD yet`); // FIXME?
    }
    case VariableType.Record: {
      const eltcount = buf.readS32();
      if (eltcount < 0)
        return null;
      const retval: { [s: string]: unknown } = {};
      for (let i = 0; i < eltcount; ++i) {
        const namenr = buf.readU32();
        if (namenr >= columns.length)
          throw new Error(`Corrupt marshal packet: column name nr out of range`);
        const subtype = buf.readU8() as VariableType;
        retval[columns[namenr]] = marshalReadInternal(buf, subtype, columns);
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

export function writeMarshalPacket(value: unknown): Buffer {
  const columns = new Map<string, number>();

  const datawriter = new LinearBufferWriter();
  writeMarshalPacketInternal(value, datawriter, columns, null);

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
      if (value instanceof Uint8Array)
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

function writeMarshalPacketInternal(value: unknown, writer: LinearBufferWriter, columns: Map<string, number>, type: VariableType | null) {
  if (type === null) {
    type = determineType(value);
    writer.writeU8(type);
  }
  if (type & VariableType.Array) {
    const len = (value as unknown[]).length;
    writer.writeU32(len);
    const subtype = type == VariableType.VariantArray ? null : type & ~VariableType.Array;
    for (let i = 0; i < len; ++i) {
      writeMarshalPacketInternal((value as unknown[])[i], writer, columns, subtype);
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
      let days = Math.floor(totalmsecs / 86400000);
      let msecs = totalmsecs - days * 86400000;
      days += 719163; // 1970-1-1
      if (days < 1) {
        days = 0;
        msecs = 0;
      }
      writer.writeU32(days);
      writer.writeU32(msecs);
    } break;
    case VariableType.Record: {
      if (value === null)
        writer.writeS32(-1);
      else {
        const entries = Object.entries(value as object);
        writer.writeS32(entries.length);
        for (const [key, subvalue] of entries) {
          let columnid = columns.get(key.toUpperCase());
          if (columnid === undefined) {
            columnid = columns.size;
            columns.set(key.toUpperCase(), columnid);
          }
          writer.writeU32(columnid);
          writeMarshalPacketInternal(subvalue, writer, columns, null);
        }
      }
    } break;
    default: {
      throw new Error(`Cannot encode type ${type}`);
    }
  }
}
