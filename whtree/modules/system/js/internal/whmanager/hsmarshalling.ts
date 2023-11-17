import { LinearBufferReader, LinearBufferWriter } from "./bufs";
// FIXME - import { Money } from "@webhare/std"; - but this breaks the shrinkwrap (it can't find @webhare/std)
import { Money } from "../../../../../jssdk/std/money";
import { dateToParts, defaultDateTime, makeDateFromParts, maxDateTime, maxDateTimeTotalMsecs } from "../../../../../jssdk/hscompat/datetime";
import { WebHareBlob } from "../../../../../jssdk/services/src/webhareblob"; //we need to directly load is to not break gen_config.ts

export enum VariableType {
  Uninitialized = 0x00,                 ///< Not initialised variable
  Variant = 0x01,
  Integer = 0x10,
  HSMoney = 0x11,
  Float = 0x12,
  Boolean = 0x13,
  DateTime = 0x14,
  Table = 0x15,
  Schema = 0x16,
  Integer64 = 0x17,
  FunctionPtr = 0x20,                   // FunctionPtr in hsvm_constants.h
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
  FunctionPtrArray = 0xa0,
  RecordArray = 0xa1,
  StringArray = 0xa2,
  ObjectArray = 0xa3,
  WeakObjectArray = 0xa4,
  BlobArray = 0xc0,
}

export type HSType<T extends VariableType> =
  T extends VariableType.Integer ? number :
  T extends VariableType.HSMoney ? Money :
  T extends VariableType.Float ? number :
  T extends VariableType.Boolean ? boolean :
  T extends VariableType.DateTime ? Date :
  T extends VariableType.Integer64 ? bigint :
  T extends VariableType.Record ? IPCMarshallableRecord :
  T extends VariableType.String ? string :
  T extends VariableType.Blob ? WebHareBlob :
  T extends VariableType.VariantArray ? IPCMarshallableData[] :
  T extends VariableType.IntegerArray ? Array<HSType<VariableType.Integer>> :
  T extends VariableType.MoneyArray ? Array<HSType<VariableType.HSMoney>> :
  T extends VariableType.FloatArray ? Array<HSType<VariableType.Float>> :
  T extends VariableType.BooleanArray ? Array<HSType<VariableType.Boolean>> :
  T extends VariableType.DateTimeArray ? Array<HSType<VariableType.DateTime>> :
  T extends VariableType.Integer64Array ? Array<HSType<VariableType.Integer64>> :
  T extends VariableType.FunctionPtrArray ? Array<HSType<VariableType.FunctionPtr>> :
  T extends VariableType.RecordArray ? Array<HSType<VariableType.Record>> :
  T extends VariableType.StringArray ? Array<HSType<VariableType.String>> :
  T extends VariableType.BlobArray ? Array<HSType<VariableType.Blob>> :
  never;

export function getDefaultValue<T extends VariableType>(type: T): HSType<T> {
  switch (type) {
    case VariableType.Integer: { return 0 as HSType<T>; }
    case VariableType.HSMoney: { return new Money("0") as HSType<T>; }
    case VariableType.Float: { return 0 as HSType<T>; }
    case VariableType.Boolean: { return false as HSType<T>; }
    case VariableType.DateTime: { return defaultDateTime as HSType<T>; }
    case VariableType.Integer64: { return BigInt(0) as HSType<T>; }
    case VariableType.Record: { return null as HSType<T>; }
    case VariableType.String: { return "" as HSType<T>; }
    case VariableType.Blob: { return WebHareBlob.from("") as HSType<T>; }
    case VariableType.VariantArray:
    case VariableType.IntegerArray:
    case VariableType.MoneyArray:
    case VariableType.FloatArray:
    case VariableType.BooleanArray:
    case VariableType.DateTimeArray:
    case VariableType.Integer64Array:
    case VariableType.RecordArray:
    case VariableType.StringArray:
    case VariableType.ObjectArray:
    case VariableType.BlobArray:
    case VariableType.WeakObjectArray:
    case VariableType.FunctionPtrArray:
    case VariableType.TableArray: {
      return Object.defineProperty([] as HSType<T>, "__hstype", { value: type });
    }
    default:
      throw new Error(`Cannot generate default value for type ${VariableType[type] ?? type}`);
  }
}

type ArrayVariableType = VariableType.VariantArray | VariableType.IntegerArray | VariableType.MoneyArray | VariableType.FloatArray | VariableType.BooleanArray | VariableType.DateTimeArray | VariableType.Integer64Array | VariableType.FunctionPtrArray | VariableType.RecordArray | VariableType.StringArray | VariableType.BlobArray | VariableType.ObjectArray;

/** Add a HareScript type annotation to an array, makes sure empty arrays are sent correctly over IPC */
export function getTypedArray<V extends ArrayVariableType, T extends HSType<V>>(type: V, array: T): T {
  const copy = getDefaultValue<V>(type) as unknown[];
  copy.push(...array);
  return copy as T;
}

export function annotateExistingArray<V extends ArrayVariableType>(type: VariableType, array: HSType<V>) {
  return Object.defineProperty(array, "__hstype", { value: type });
}

export function isDate(value: unknown): value is Date {
  return Boolean(typeof value === "object" && value && "getDate" in value);
}

const MarshalFormatType = 2;
const MarshalPacketFormatType = 3;

export function readMarshalData(buffer: Buffer | ArrayBuffer): SimpleMarshallableData {
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

export function readMarshalPacket(buffer: Buffer | ArrayBuffer): IPCMarshallableData {
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


  const blobs: Buffer[] = [];
  if (totalblobsize) {
    buf.readpos = 20 + columnsize + datasize;
    const blobcount = buf.readU32();
    const blobsizes: number[] = [];
    //First we get the sizes of the blobs, THEN the actual blobs
    for (let idx = 0; idx < blobcount; ++idx) {
      blobsizes.push(Number(buf.readBigU64()));
    }
    for (let idx = 0; idx < blobcount; ++idx) {
      blobs.push(buf.readRaw(blobsizes[idx]));
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

function marshalReadInternal(buf: LinearBufferReader, type: VariableType, columns: string[], blobs: Buffer[] | null): IPCMarshallableData {
  if (type & 0x80) {
    const eltcount = buf.readU32();
    const retval: IPCMarshallableData[] = getDefaultValue(type) as IPCMarshallableData[];
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
    case VariableType.HSMoney: {
      const value = buf.readBigS64();
      let str = value.toString();
      const isnegative = value < BigInt(0);
      str = str.substring(isnegative ? 1 : 0).padStart(6, "0");
      str = str.substring(0, str.length - 5) + "." + str.substring(str.length - 5);
      return new Money((isnegative ? "-" : "") + str);
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
      return makeDateFromParts(days, msecs);
    }
    case VariableType.String: {
      return buf.readString();
    }
    case VariableType.Blob: {
      if (blobs) {
        const blobid = buf.readU32();
        if (!blobid)
          return WebHareBlob.from("");
        else
          return WebHareBlob.from(blobs[blobid - 1]);
      } else
        return WebHareBlob.from(buf.readBinary());
    }
    case VariableType.FunctionPtr: {
      throw new Error(`Cannot decode FUNCTIONPTR yet`); // FIXME?
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
  const path: object[] = [];
  const blobs = onlySimple ? [] : null;
  writeMarshalDataInternal(value, datawriter, columns, blobs, null, path);
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
  const path: object[] = [];
  const blobs: Buffer[] = [];
  datawriter.writeU8(MarshalPacketFormatType);
  writeMarshalDataInternal(value, datawriter, columns, blobs, null, path);

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
    }
    for (const blob of blobs) {
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
  if (a === VariableType.Integer && (b === VariableType.Float || b === VariableType.HSMoney || b === VariableType.Integer64))
    return b;
  if ((a === VariableType.Float || a === VariableType.HSMoney || a === VariableType.Integer64) && b === VariableType.Integer)
    return a;
  if (a === VariableType.Float && (b === VariableType.HSMoney || b === VariableType.Integer64))
    return a;
  if ((a === VariableType.HSMoney || a === VariableType.Integer64) && b === VariableType.Float)
    return b;
  return VariableType.Variant;
}

export function determineType(value: unknown): VariableType {
  if (Array.isArray(value)) {
    if (value && typeof value == "object" && "__hstype" in value) {
      const rec = value as Record<"__hstype", VariableType>;
      if (rec.__hstype)
        return rec.__hstype as VariableType;
    }
    if (value.length === 0)
      return VariableType.VariantArray;
    let elttype = determineType(value[0]);
    for (let i = 1; i < value.length; ++i) {
      elttype = unifyEltTypes(elttype, determineType(value[i]));
    }
    if (elttype & VariableType.Array)
      return VariableType.VariantArray;
    return elttype | VariableType.Array;
  }
  switch (typeof value) {
    case "object": {
      if (value instanceof WebHareBlob)
        return VariableType.Blob;
      if (value instanceof Uint8Array || value instanceof ArrayBuffer || value instanceof Buffer)
        return VariableType.String;
      if (isDate(value))
        return VariableType.DateTime;
      if (value && "__hstype" in value) {
        return value.__hstype as VariableType;
      }
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
    case "undefined": //treat as 'null'
      return VariableType.Record;
    default: {
      throw new Error(`Cannot send variable of type ${JSON.stringify(typeof value)}`);
    }
  }
}

function writeMarshalDataInternal(value: unknown, writer: LinearBufferWriter, columns: Map<string, number>, blobs: Uint8Array[] | null, type: VariableType | null, path: object[]) {
  const determinedtype = determineType(value);
  if (type === null) {
    type = determinedtype;
    writer.writeU8(type);
  } else if (type !== determinedtype) {
    if (unifyEltTypes(type, determinedtype) !== type)
      throw new Error(`Cannot store an ${VariableType[determinedtype] ?? determinedtype} in an array for ${VariableType[type] ?? type}`);
  }

  if (type & VariableType.Array) {
    if (path.includes(value as object)) //already seen this value
      throw new Error(`Detected a circular reference`);
    path.push(value as object);

    const len = (value as unknown[]).length;
    writer.writeU32(len);
    const subtype = type == VariableType.VariantArray ? null : type & ~VariableType.Array;
    for (let i = 0; i < len; ++i) {
      writeMarshalDataInternal((value as unknown[])[i], writer, columns, blobs, subtype, path);
    }

    path.pop();
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
      if (typeof value !== "number") { // Money, boxed float??
        if (Money.isMoney(value))
          writer.writeDouble(Number(value.value));
        else
          throw new Error(`Unknown object to encode as float`);
      } else
        writer.writeDouble(value as number);
    } break;
    case VariableType.HSMoney: {
      if (typeof value !== "number") { // Money?
        if (!Money.isMoney(value))
          throw new Error(`Unknown object to encode as money`);
        let str = value.value;
        const dotpos = (str + ".").indexOf('.');
        str = str.substring(0, dotpos) + str.substring(dotpos + 1).padEnd(5, "0").substring(0, 5);
        writer.writeS64(BigInt(str));
      } else {
        writer.writeS64(BigInt(Math.round(value * 100000)));
      }
    } break;
    case VariableType.Boolean: {
      writer.writeU8(value as boolean ? 1 : 0);
    } break;
    case VariableType.String: {
      writer.writeString(value as string);
    } break;
    case VariableType.DateTime: {
      const { days, msecs } = dateToParts(value as Date);
      writer.writeU32(days);
      writer.writeU32(msecs);
    } break;
    case VariableType.Record: {
      if (!value)
        writer.writeS32(-1);
      else {
        if (path.includes(value as object))
          throw new Error(`Detected a circular reference`);
        path.push(value as object);

        const entries = Object.entries(value as object).filter(([, v]) => v !== undefined);// like JSON.stringify we drop undefined values completely
        writer.writeS32(entries.length);
        for (const [key, subvalue] of entries) {
          let columnid = columns.get(key.toUpperCase());
          if (columnid === undefined) {
            columnid = columns.size;
            columns.set(key.toUpperCase(), columnid);
          }
          writer.writeU32(columnid);
          writeMarshalDataInternal(subvalue, writer, columns, blobs, null, path);
        }
        path.pop();
      }
    } break;
    case VariableType.Blob: {
      if (!(value as WebHareBlob).size) { //empty blob
        writer.writeU32(0); //either we write blobid 0 or size 0
        break;
      }

      const data = (value as WebHareBlob).__getAsSyncUInt8Array();
      if (blobs) {
        blobs.push(data);
        writer.writeU32(blobs.length);
      } else {
        writer.writeBinary(data);
      }
    } break;
    default: {
      throw new Error(`Cannot encode type ${VariableType[type] ?? type}`);
    }
  }
}

export function encodeHSON(value: IPCMarshallableData): string {
  return "hson:" + encodeHSONInternal(value);
}

function encodeHSONInternal(value: IPCMarshallableData, needtype?: VariableType): string {
  let type = determineType(value);
  if (needtype !== undefined && type != needtype) {
    if (unifyEltTypes(type, needtype) !== needtype)
      throw new Error(`Cannot store an ${VariableType[type] ?? type} in an array for ${VariableType[needtype] ?? needtype}`);
    type = needtype;
  }

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

      if (totalmsecs >= maxDateTimeTotalMsecs) {
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
        retval = `d"${year}${month}${day}`;
        if (msecsvalue) {
          const minutes = String(dt.getUTCMinutes()).padStart(2, "0");
          const seconds = String(dt.getUTCSeconds()).padStart(2, "0");
          const mseconds = String(dt.getUTCMilliseconds()).padStart(3, "0");
          retval = retval + `T${hours}${minutes}${seconds}${mseconds !== "000" ? `.${mseconds}` : ""}"`;
        } else
          retval = retval + `"`;
      }
    } break;
    case VariableType.Float: {
      if (typeof value === "object") {
        if (Money.isMoney(value))
          retval = "f " + (value as Money).value;
        else
          throw new Error(`Unknown object to encode as float`);
      } else
        retval = "f " + (value as number).toString().replace('+', ''); //format 1e+308 as 1e308
    } break;
    case VariableType.String:
      if (typeof value === "string") { //FIXME this might break if the encodeHSON-ed value is then eg hashed .. as JSON stringify may not have the exact same escaping as HS encodeHSON would do!
        retval = JSON.stringify(value);
        break;
      }
      //FIXME should definitely use EncodeHSON style - binary is a hint that this data is not UTF8 safe.
      retval = JSON.stringify((value as Buffer).toString()).replaceAll("\\u0000", "\\x00");
      break;
    case VariableType.Blob: {
      if (!(value as WebHareBlob).size) {
        retval = `b""`;
        break;
      }

      const data = (value as WebHareBlob).__getAsSyncUInt8Array();
      retval = `b"` + Buffer.from(data).toString("base64") + `"`; //FIXME avoid this buffer copy
    } break;
    case VariableType.Integer64: retval = "i64 " + (value as number | bigint).toString(); break;
    case VariableType.Integer: retval = (value as number).toString(); break;
    case VariableType.HSMoney: {
      if (typeof value === "object") {
        if (!Money.isMoney(value))
          throw new Error(`Unknown object to encode as money`);
        retval = "m " + (value as Money).format({ minDecimals: 0 });
      } else
        retval = "m " + value.toString();
    } break;
    case VariableType.Record: {
      const recval = value as IPCMarshallableRecord;
      if (!recval)
        retval = "*";
      else {
        retval = "{";
        let first = true;
        for (const [key, propval] of Object.entries(recval).sort(([a], [b]) => a === b ? 0 : a < b ? -1 : 1)) {
          if (propval === undefined)
            continue;
          if (!first)
            retval = retval + ",";
          else
            first = false;
          retval = retval + JSON.stringify(key.toLowerCase()) + ":" + encodeHSONInternal(propval);
        }
        retval = retval + "}";
      }
    } break;

    default:
      throw new Error(`Cannot encode type ${VariableType[type] ?? type}`);
  }
  if (type & VariableType.Array) {
    const itemtype = type !== VariableType.VariantArray ? type & ~VariableType.Array : undefined;

    let first = true;
    for (const item of value as IPCMarshallableData[]) {
      if (!first)
        retval = retval + ",";
      else
        first = false;
      retval = retval + encodeHSONInternal(item, itemtype);
    }
    return retval + "]";
  }
  return retval;
}

enum TokenState {
  TS_Initial, // Allow BOM
  TS_Default,
  TS_LongToken,
  TS_QString,
  TS_QStringEsc,
  TS_DQString,
  TS_DQStringEsc,
  TS_NumberPrefix,
  TS_Number,
  TS_Error,
  TS_CommentStart,
  TS_LineComment,
  TS_BlockComment,
  TS_BlockCommentEnd
}

enum TokenType {
  JTT_SpecialToken,
  JTT_Token,
  JTT_String,
  JTT_Number
}

enum ParseState {
  PS_RootValue,
  PS_ObjectWantName,
  PS_ObjectWantColon,
  PS_ObjectWantValue,
  PS_ObjectWantComma,
  PS_ArrayWantValue,
  PS_ArrayWantComma,
  PS_Finished,
  PS_Error,

  PS_HSONStart,
  PS_HSONStartColon,
  PS_HSONWantArray,
  PS_HSONWantTypedValue
}

type LevelParentVar = { [K in number | string]: unknown };

class Level {
  parent: LevelParentVar;
  key: string | number;
  lastarrayelt: unknown;
  restorestate: ParseState;
  arrayelttype: VariableType;

  constructor(parent: LevelParentVar, key: string | number, restorestate: ParseState) {
    this.parent = parent;
    this.key = key;
    this.restorestate = restorestate;
    this.lastarrayelt = null;
    this.arrayelttype = VariableType.Uninitialized;
  }
}


class JSONParser {
  /// Tokenizer state
  state = TokenState.TS_Default;
  comment_after_numberprefix = false;

  /// Current token
  currenttoken = "";

  /// Current parse state
  parsestate = ParseState.PS_HSONStart;

  /// State before hson type specifier
  hsonrestorestate = ParseState.PS_HSONStart;
  lastname = "";
  lasttype = VariableType.Uninitialized;

  root: { value?: IPCMarshallableData } = {};
  levels: Level[] = [];

  hson = true;
  allowcomments = false;

  line = 1;
  column = 1;
  errorline = 1;
  errorcolumn = 1;
  errormessage = "";


  constructor() {
    this.currenttoken = "";
    this.levels.push(new Level(this.root, "value", ParseState.PS_Error));
  }

  handleChar(val: string): boolean {
    if (val === "\n") {
      ++this.line;
      this.column = 1;
    } else
      ++this.column;

    const is_whitespace = val === " " || val === "\r" || val === "\n" || val === "\t";
    const is_tokenchar = val === "{" || val === "}" || val === "[" || val === "]" || val === ":" || val === ",";
    const is_specialchar = val === "'" || val === "\"" || val === "-" || val === "+" || val === ".";
    const is_comment = this.allowcomments && val == '/';

    // First process tokens that are terminated by a token outside their class (that still needs to be processed afterwards)

    if (this.state == TokenState.TS_LongToken) {
      // long token ends by whitespace or tokenchar or specialchar
      if (is_whitespace || is_tokenchar || is_specialchar || is_comment) {
        // Process the long token
        if (!this.handleToken(this.currenttoken, TokenType.JTT_Token))
          return false;
        // Continue to process the current character too
        this.state = TokenState.TS_Default;
      } else {
        // Add character to current token
        this.currenttoken = this.currenttoken + val;
        return true;
      }
    }

    if (this.state == TokenState.TS_Number || this.state == TokenState.TS_NumberPrefix) {
      // Number ends with whitespace after first non-prefix character ('+'/'-')
      if (is_tokenchar) {
        // Token character, ends number. Process the number
        if (!this.handleToken(this.currenttoken, TokenType.JTT_Number)) {
          this.state = TokenState.TS_Error;
          return false;
        }

        // Continue to process the current character too
        this.state = TokenState.TS_Default;
      } else {
        if (this.state == TokenState.TS_NumberPrefix) {
          // Only seen prefixes, skip whitespace
          if (is_comment) {
            this.comment_after_numberprefix = true;
            this.state = TokenState.TS_CommentStart;
            return true;
          }
          if (!is_whitespace) {
            // Check if other than prefix
            if (val != '+' && val != '-') {
              this.state = TokenState.TS_Number;
              this.comment_after_numberprefix = false;
            }

            // Add to token
            this.currenttoken = this.currenttoken + val;
            return true;
          }
        } else if (is_whitespace || is_comment) {
          // Whitespace or comment, ends the number
          if (!this.handleToken(this.currenttoken, TokenType.JTT_Number)) {
            this.state = TokenState.TS_Error;
            return false;
          }

          // Continue to process the current character too
          this.state = TokenState.TS_Default;
        } else {
          // Add to token (this adds also non-number charactes, but don't care now)
          this.currenttoken = this.currenttoken + val;
          return true;
        }
      }
    }

    if (this.state == TokenState.TS_CommentStart) {
      if (val == '/')
        this.state = TokenState.TS_LineComment;
      else if (val == '*')
        this.state = TokenState.TS_BlockComment;
      else {
        this.errormessage = "Unexpected character '" + this.currenttoken + "' encountered, expected '/' or '*'";
        this.errorline = this.line;
        this.errorcolumn = this.column - 1;
        this.state = TokenState.TS_Error;
        return false;
      }
      return true;
    }
    if (this.state == TokenState.TS_LineComment) {
      if (val == '\n')
        this.state = this.comment_after_numberprefix ? TokenState.TS_NumberPrefix : TokenState.TS_Default;
      return true;
    }
    if (this.state == TokenState.TS_BlockComment) {
      if (val == '*')
        this.state = TokenState.TS_BlockCommentEnd;
      return true;
    }
    if (this.state == TokenState.TS_BlockCommentEnd) {
      if (val == '/')
        this.state = this.comment_after_numberprefix ? TokenState.TS_NumberPrefix : TokenState.TS_Default;
      else if (val != '*')
        this.state = TokenState.TS_BlockComment;
      return true;
    }

    if (this.state == TokenState.TS_Default || this.state == TokenState.TS_Initial) {
      // Set start of current token
      this.errorline = this.line;
      this.errorcolumn = this.column - 1;

      // Ignore whitespace
      if (is_whitespace)
        return true;

      if (is_comment) {
        this.state = TokenState.TS_CommentStart;
        return true;
      }

      this.currenttoken = "";
      if (is_tokenchar) {
        // token character, process immediately
        this.currenttoken = this.currenttoken + val;
        if (!this.handleToken(this.currenttoken, TokenType.JTT_SpecialToken)) {
          this.state = TokenState.TS_Error;
          return false;
        }
        return true;
      }
      // Detect strings. No need to add them to token, they are decoded immediately
      if (val == '"') {
        this.state = TokenState.TS_DQString;
        return true;
      }
      if (val == '\'') {
        this.state = TokenState.TS_QString;
        return true;
      }
      // Detect number
      if (val == '+' || val == '-') {
        this.currenttoken = this.currenttoken + val;
        this.state = TokenState.TS_NumberPrefix;
        return true;
      }
      if ((val >= '0' && val <= '9') || val == '.') {
        this.currenttoken = this.currenttoken + val;
        this.state = TokenState.TS_Number;
        return true;
      }

      // No special char, string or number, tread as long token
      this.currenttoken = this.currenttoken + val;
      this.state = TokenState.TS_LongToken;
      return true;
    }

    if (this.state == TokenState.TS_DQString || this.state == TokenState.TS_QString) {
      // End of string?
      if (val == (this.state == TokenState.TS_DQString ? '"' : '\'')) {
        // FIXME: also try to parse `/x`!!  need to use HS compatible decoding
        this.currenttoken = JSON.parse(val + this.currenttoken + val);
        //std::string currentstring;
        //std:: swap(currentstring, currenttoken);
        //Blex:: DecodeJava(currentstring.begin(), currentstring.end(), std:: back_inserter(this.currenttoken));
        this.state = TokenState.TS_Default;
        if (!this.handleToken(this.currenttoken, TokenType.JTT_String)) {
          this.state = TokenState.TS_Error;
          return false;
        }
        return true;
      } else if (val == '\\') { // String escape?
        this.currenttoken = this.currenttoken + val;
        this.state = this.state == TokenState.TS_DQString ? TokenState.TS_DQStringEsc : TokenState.TS_QStringEsc;
      } else if (val < ' ' && val != '\t') {
        // Found a control character in a string, do not like that
        this.errormessage = "Control characters not allowed in strings";
        this.errorline = this.line;
        this.errorcolumn = this.column - 1;
        this.state = TokenState.TS_Error;
        return false;
      } else
        this.currenttoken = this.currenttoken + val;
      return true;
    }

    if (this.state == TokenState.TS_DQStringEsc || this.state == TokenState.TS_QStringEsc) {
      this.currenttoken = this.currenttoken + val;
      this.state = this.state == TokenState.TS_DQStringEsc ? TokenState.TS_DQString : TokenState.TS_QString;
      return true;
    }

    if (this.state != TokenState.TS_Error) {
      this.currenttoken = "";
      this.currenttoken = this.currenttoken + val;
      this.errormessage = "Unexpected character '" + this.currenttoken + "' encountered";
      this.errorline = this.line;
      this.errorcolumn = this.column - 1;
      this.state = TokenState.TS_Error;
    }

    // INV: state = TokenState.TS_Error
    return false;
  }

  finish(): {
    success: boolean;
    msg: string;
    value: IPCMarshallableData;
  } {
    if (this.state === TokenState.TS_LongToken) {
      this.handleToken(this.currenttoken, TokenType.JTT_Token);
      this.state = TokenState.TS_Default;
    }
    if (this.state === TokenState.TS_Number) {
      this.handleToken(this.currenttoken, TokenType.JTT_Number);
      this.state = TokenState.TS_Default;
    }
    if (this.state != TokenState.TS_Default && this.state != TokenState.TS_Error) {
      this.errorline = this.line;
      this.errorcolumn = this.column;
      this.errormessage = "JSON token not complete";
      this.state = TokenState.TS_Error;
    } else if (this.parsestate != ParseState.PS_Finished) {
      this.errorline = this.line;
      this.errorcolumn = this.column;
      switch (this.parsestate) {
        case ParseState.PS_Error: break;
        case ParseState.PS_ObjectWantName:
          {
            this.errormessage = "Expected a cellname";
          } break;
        case ParseState.PS_ObjectWantColon:
        case ParseState.PS_HSONStartColon:
          {
            this.errormessage = "Expected a ':'";
          } break;
        case ParseState.PS_ObjectWantComma:
          {
            this.errormessage = "Expected a ',' or a '}'";
          } break;
        case ParseState.PS_ArrayWantComma:
          {
            this.errormessage = "Expected a ',' or a ']'";
          } break;
        case ParseState.PS_RootValue:
        case ParseState.PS_ArrayWantValue:
        case ParseState.PS_ObjectWantValue:
        case ParseState.PS_HSONStart:
        case ParseState.PS_HSONWantArray:
        case ParseState.PS_HSONWantTypedValue:
          {
            this.errormessage = "Expected a value";
          } break;

        default:
          this.errormessage = "Internal error";
        // fallthrough
      }
      this.state = TokenState.TS_Error;
    }

    return {
      success: this.state !== TokenState.TS_Error,
      msg: this.errormessage ? `At :${this.errorline}:${this.errorcolumn}: ${this.errormessage}` : "",
      value: this.state === TokenState.TS_Error
        ? getDefaultValue(VariableType.Record)
        : this.root.value ?? getDefaultValue(VariableType.Record)
    };
  }

  handleToken(token: string, tokentype: TokenType): boolean {
    /* value ::= object | array | number | string | boolean | null

       object ::= '{' 1( ps_object_wantname string ps_object_wantcolon ':' ps_object_wantvalue value ps_object_wantcomma ( , \1 )? ) '}'
       array ::= [ 1( ps_array_wantvalue value ps_array_wantcomma ( , \1 )? ) ]
    */

    switch (this.parsestate) {
      case ParseState.PS_HSONStart: {
        if (tokentype != TokenType.JTT_Token || (token != "hson" && token != "json")) {
          this.errormessage = "Unrecognized data format";
          this.parsestate = ParseState.PS_Error;
          return false;
        }

        // Switch back to legacy JSON if starts with 'json:'
        if (token == "json")
          this.hson = false;

        this.parsestate = ParseState.PS_HSONStartColon;
        return true;
      }
      case ParseState.PS_HSONStartColon: {
        if (tokentype != TokenType.JTT_SpecialToken || token[0] != ':') {
          this.errormessage = "Expected a ':'";
          this.parsestate = ParseState.PS_Error;
          return false;
        }
        this.parsestate = ParseState.PS_RootValue;
        return true;
      }
      case ParseState.PS_ObjectWantName:
        {
          // End of object (this handles empty objects and extra ',' after last member)
          if (tokentype == TokenType.JTT_SpecialToken && token[0] == '}') {

            this.parsestate = this.levels.pop()?.restorestate ?? ParseState.PS_Error;
            return true;
          }

          if ((tokentype != TokenType.JTT_String && tokentype != TokenType.JTT_Token)) {
            this.errormessage = "Expected a cellname";
            this.parsestate = ParseState.PS_Error;
            return false;
          }
          this.lastname = token;
          this.parsestate = ParseState.PS_ObjectWantColon;
          return true;
        }
      case ParseState.PS_ObjectWantColon:
        {
          if (tokentype != TokenType.JTT_SpecialToken || token[0] != ':') {
            this.errormessage = "Expected a ':'";
            this.parsestate = ParseState.PS_Error;
            return false;
          }
          this.parsestate = ParseState.PS_ObjectWantValue;
          return true;
        }
      case ParseState.PS_ObjectWantComma:
        {
          if (tokentype != TokenType.JTT_SpecialToken || (token[0] != ',' && token[0] != '}')) {
            this.errormessage = "Expected a ',' or a '}'";
            this.parsestate = ParseState.PS_Error;
            return false;
          }
          if (token[0] == ',') {
            this.parsestate = ParseState.PS_ObjectWantName;
          } else {
            this.parsestate = this.levels.pop()?.restorestate ?? ParseState.PS_Error;
          }
          return true;
        }
      case ParseState.PS_ArrayWantComma:
        {
          if (tokentype != TokenType.JTT_SpecialToken || (token[0] != ',' && token[0] != ']')) {
            this.errormessage = "Expected a ',' or a ']'";
            this.parsestate = ParseState.PS_Error;
            return false;
          }
          if (token[0] == ',') {
            this.parsestate = ParseState.PS_ArrayWantValue;
          } else {
            /*
                                                   // Convert arrays that are all integers, strings or records to their equivalent XXXArray
                                                   HSVM_VariableType type = this.levels[this.levels.length - 1].arrayelttype;
                        if (type == VariableType.IntegerArray || type == VariableType.StringArray || type == VariableType.RecordArray)
                          GetVirtualMachine(vm) -> stackmachine.ForcedCastTo(this.levels[this.levels.length - 1].var, static_cast < VariableTypes:: Type > (type));
            */
            this.parsestate = this.levels.pop()?.restorestate ?? ParseState.PS_Error;
          }
          return true;
        }
      case ParseState.PS_HSONWantArray:
        {
          if (tokentype != TokenType.JTT_SpecialToken || token[0] != '[') { // new array
            this.errormessage = "Expected array start token '[']";
            this.parsestate = ParseState.PS_Error;
            return false;
          }

          this.parsestate = ParseState.PS_ArrayWantValue;
          return true;
        }
      case ParseState.PS_ArrayWantValue:
        {
          if (tokentype == TokenType.JTT_SpecialToken && token[0] == ']') {
            /*
                                                   // Convert arrays that are all integers, strings or records to their equivalent XXXArray
                                                   HSVM_VariableType type = this.levels[this.levels.length - 1].arrayelttype;
                        if (type == VariableType.IntegerArray || type == VariableType.StringArray || type == VariableType.RecordArray)
                          GetVirtualMachine(vm) -> stackmachine.ForcedCastTo(this.levels[this.levels.length - 1].var, static_cast < VariableTypes:: Type > (type));
            */
            this.parsestate = this.levels.pop()?.restorestate ?? ParseState.PS_Error;
            return true;
          }
        }
      // Fallthrough
      case ParseState.PS_RootValue:
      case ParseState.PS_ObjectWantValue:
      case ParseState.PS_HSONWantTypedValue:
        {
          let parent: LevelParentVar;
          let key: string | number;
          let restorestate: ParseState;

          const is_hsontypedvalue = this.parsestate == ParseState.PS_HSONWantTypedValue;
          if (is_hsontypedvalue)
            this.parsestate = this.hsonrestorestate;

          switch (this.parsestate) {
            case ParseState.PS_RootValue:
              {
                parent = this.root;
                key = "value";
                //target = this.levels[this.levels.length - 1].variable;
                restorestate = ParseState.PS_Finished;
              } break;
            case ParseState.PS_ArrayWantValue:
              {
                const level = this.levels[this.levels.length - 1];
                parent = level.parent[level.key] as LevelParentVar;
                if (!is_hsontypedvalue) {
                  (parent as unknown as unknown[]).push(null);
                }
                key = (parent as unknown as []).length - 1;
                restorestate = ParseState.PS_ArrayWantComma;
              } break;
            case ParseState.PS_ObjectWantValue: {
              const level = this.levels[this.levels.length - 1];
              parent = level.parent[level.key] as LevelParentVar;
              key = this.lastname;

              restorestate = ParseState.PS_ObjectWantComma;
            } break;
            default:
              throw new Error("Unhandled parserstate #1");
          }
          /*
                    if (!target) {
                      this.errormessage = "Internal error - don't have a target variable available";
                      this.parsestate = ParseState.PS_Error;
                      return false;
                    }
          */
          if (is_hsontypedvalue) {
            if (!this.parseHSONTypedValue(parent, key, token, tokentype)) {
              parent[key] = false;
              return false;
            }

            this.parsestate = restorestate;
            return true;
          }

          if (tokentype == TokenType.JTT_SpecialToken) {
            if (token[0] == '{') { // new object
              if (this.levels[this.levels.length - 1].arrayelttype == 0)
                this.levels[this.levels.length - 1].arrayelttype = VariableType.RecordArray;
              else if (this.levels[this.levels.length - 1].arrayelttype != VariableType.RecordArray)
                this.levels[this.levels.length - 1].arrayelttype = VariableType.VariantArray;
              this.levels.push(new Level(parent, key, restorestate));

              if (this.levels.length >= 2048) {
                this.errormessage = `Too many levels of recursion (${this.levels.length})`;
                this.parsestate = ParseState.PS_Error;
                return false;
              }

              parent[key] = {};
              this.parsestate = ParseState.PS_ObjectWantName;
              return true;
            } else if (token[0] == '[') { // new array
              if (this.hson) {
                this.errormessage = "Expected HSON type before '[' token";
                this.parsestate = ParseState.PS_Error;
                return false;
              }

              this.levels[this.levels.length - 1].arrayelttype = VariableType.VariantArray;
              this.levels.push(new Level(parent, key, restorestate));

              if (this.levels.length >= 2048) {
                this.errormessage = `Too many levels of recursion (${this.levels.length})`;
                this.parsestate = ParseState.PS_Error;
                return false;
              }

              parent[key] = getDefaultValue(VariableType.VariantArray);
              this.parsestate = ParseState.PS_ArrayWantValue;
              return true;
            } else {
              this.errormessage = "Unexpected character encountered";
              this.parsestate = ParseState.PS_Error;
              return false;
            }
          }

          if (this.hson && tokentype == TokenType.JTT_Token) { // Either type specifier, '*', 'true' or 'false'
            if (token.length == 1) {
              switch (token[0]) {
                case 'm': this.lasttype = VariableType.HSMoney; break;
                case 'f': this.lasttype = VariableType.Float; break;
                case 'd': this.lasttype = VariableType.DateTime; break;
                case 'b': this.lasttype = VariableType.Blob; break;
                case 'o': this.lasttype = VariableType.Object; break;
                case 'w': this.lasttype = VariableType.WeakObject; break;
                case 'p': this.lasttype = VariableType.FunctionPtr; break;
                case '*':
                  {
                    parent[key] = null;
                    this.parsestate = restorestate;
                    return true;
                  }
                default: {
                  this.errormessage = "Illegal variable type encoding '" + token + "'";
                  this.parsestate = ParseState.PS_Error;
                  return false;
                }
              }

              this.hsonrestorestate = this.parsestate;
              this.parsestate = ParseState.PS_HSONWantTypedValue;
              return true;
            } else if (token.length == 2) {
              if (token[1] != 'a') {
                this.errormessage = "Illegal variable type encoding '" + token + "'";
                this.parsestate = ParseState.PS_Error;
                return false;
              }

              switch (token[0]) {
                case 'v': this.lasttype = VariableType.VariantArray; break;
                case 'b': this.lasttype = VariableType.BooleanArray; break;
                case 'd': this.lasttype = VariableType.DateTimeArray; break;
                case 'm': this.lasttype = VariableType.MoneyArray; break;
                case 'f': this.lasttype = VariableType.FloatArray; break;
                case 's': this.lasttype = VariableType.StringArray; break;
                case 'x': this.lasttype = VariableType.BlobArray; break;
                case 'i': this.lasttype = VariableType.IntegerArray; break;
                case 'r': this.lasttype = VariableType.RecordArray; break;
                case 'o': this.lasttype = VariableType.ObjectArray; break;
                case 'w': this.lasttype = VariableType.WeakObjectArray; break;
                case 'p': this.lasttype = VariableType.FunctionPtrArray; break;
                default: {
                  this.errormessage = "Illegal variable type encoding '" + token + "'";
                  this.parsestate = ParseState.PS_Error;
                  return false;
                }
              }

              this.levels[this.levels.length - 1].arrayelttype = VariableType.VariantArray;
              this.levels.push(new Level(parent, key, restorestate));
              this.levels[this.levels.length - 1].arrayelttype = this.lasttype;

              if (this.levels.length >= 2048) {
                this.errormessage = `Too many levels of recursion (${this.levels.length})`;
                this.parsestate = ParseState.PS_Error;
                return false;
              }

              parent[key] = getDefaultValue(this.lasttype);
              this.parsestate = ParseState.PS_HSONWantArray;
              return true;
            } else if (token === "i64" || token === "i64a") {
              const is_array = token.length == 4;
              if (!is_array)
                this.hsonrestorestate = this.parsestate;
              else {
                this.levels[this.levels.length - 1].arrayelttype = VariableType.Integer64Array;
                this.levels.push(new Level(parent, key, restorestate));

                if (this.levels.length >= 2048) {
                  this.errormessage = `Too many levels of recursion (${this.levels.length})`;
                  this.parsestate = ParseState.PS_Error;
                  return false;
                }

                parent[key] = getDefaultValue(VariableType.Integer64Array);
              }

              this.lasttype = is_array ? VariableType.Integer64Array : VariableType.Integer64;
              this.parsestate = is_array ? ParseState.PS_HSONWantArray : ParseState.PS_HSONWantTypedValue;
              return true;
            }
          }

          if (!this.parseSimpleValue(parent, key, token, tokentype)) {
            parent[key] = false;
            return false;
          }

          /*
          const type: VariableType = HSVM_GetType(vm, target) | VariableType.Array;
          if (this.levels[this.levels.length - 1].arrayelttype == 0)
            this.levels[this.levels.length - 1].arrayelttype = type;
          else if (this.levels[this.levels.length - 1].arrayelttype != type)
            this.levels[this.levels.length - 1].arrayelttype = VariableType.VariantArray;
          */

          this.parsestate = restorestate;
          return true;
        }
      case ParseState.PS_Finished:
        {
          this.errormessage = "Extra character encountered";
          this.parsestate = ParseState.PS_Error;
          return false;
        }
      default: break;
      // Fallthrough
    }
    return false;

  }

  parseSimpleValue(parent: LevelParentVar, key: string | number, token: string, tokentype: TokenType): boolean {
    switch (tokentype) {
      case TokenType.JTT_String: {
        parent[key] = token;
        return true;
      }
      case TokenType.JTT_Token: {
        if (token == "null" && !this.hson) {
          parent[key] = getDefaultValue(VariableType.Record);
          return true;
        }
        if (token === "false") {
          parent[key] = false;
          return true;
        }
        if (token == "true") {
          parent[key] = true;
          return true;
        }

        this.errormessage = "Unexpected token '" + token + "'";
        this.parsestate = ParseState.PS_Error;
        return false;
      }

      case TokenType.JTT_Number:
        {
          // Don't check value, just return as string
          parent[key] = Number(token);
          /*
                                bool negate = false;

                    Blex::DecimalFloat value;
                    const char * data = token.c_str();
                    const char * limit = data + token.size();

                    while (* data == '+' || * data == '-') {
                      negate = negate ^ (* data == '-');
                      ++data;
                    }

                                char postfix = ' ';
                    const char * finish = limit;
                    Blex:: DecimalFloat::ParseResult res = value.ParseNumberString(data, limit, & postfix, & finish);
                    if (negate)
                      value.Negate();

                    if (finish != limit) {
                      errormessage = "Illegal integer constant '" + token + "'";
                      parsestate = PS_Error;
                      return false;
                    }
                    switch (res) {
                      case Blex:: DecimalFloat:: PR_Error_IllegalIntegerConstant:
                        {
                          errormessage = "Illegal integer constant '" + token + "'";
                          parsestate = PS_Error;
                          return false;
                        }
                      case Blex:: DecimalFloat:: PR_Error_ExpectedReal:
                        {
                          errormessage = "Expected a real value, got '" + token + "'";
                          parsestate = PS_Error;
                          return false;
                        }
                      case Blex:: DecimalFloat:: PR_Error_IllegalExponent:
                        {
                          errormessage = "Expected a valid float exponent value, got '" + token + "'";
                          parsestate = PS_Error;
                          return false;
                        }
                      default: ;
                    }

                    if (postfix == ' ') {
                      // For JSON, we don't auto-convert to MONEY, but immediately to FLOAT
                      if (value.ConvertableToS32())
                        postfix = 'I';
                      else
                        postfix = 'F';
                    }

                    switch (postfix) {
                      case 'I':
                        {
                          if (!value.ConvertableToS32()) {
                            errormessage = "Integer overflow in token '" + token + "'";
                            parsestate = PS_Error;
                            return false;
                          }
                          HSVM_IntegerSet(vm, target, value.ToS32());
                        } break;
                      case '6':
                        {
                          if (!value.ConvertableToS64()) {
                            errormessage = "Integer64 overflow in token '" + token + "'";
                            parsestate = PS_Error;
                            return false;
                          }
                          HSVM_Integer64Set(vm, target, value.ToS64());
                        } break;
                      case 'M':
                        {
                          if (!value.ConvertableToMoney(false)) {
                            errormessage = "Money overflow in token '" + token + "'";
                            parsestate = PS_Error;
                            return false;
                          }
                          HSVM_MoneySet(vm, target, value.ToMoney());
                        } break;
                      case 'F':
                        {
                          if (!value.ConvertableToFloat()) {
                            errormessage = "Float overflow in token '" + token + "'";
                            parsestate = PS_Error;
                            return false;
                          }
                          HSVM_FloatSet(vm, target, value.ToFloat());
                        } break;
                      default:
                        errormessage = "Unknown postfix '" + std:: string(1, postfix) + "' encountered";
                        parsestate = PS_Error;
                        return false;
                    }
          */
          return true;
        } break;

      default:
        this.errormessage = "Unexpected token '" + token + "' encountered";
        this.parsestate = ParseState.PS_Error;
        return false;
    }
  }

  parseHSONTypedValue(parent: LevelParentVar, key: string | number, token: string, tokentype: TokenType): boolean {
    switch (this.lasttype) {
      case VariableType.Integer64: {
        parent[key] = BigInt(token);
        return true;
      }
      case VariableType.HSMoney: {
        parent[key] = new Money(token);
        return true;
      }
      case VariableType.Float: {
        if (tokentype != TokenType.JTT_Number) {
          this.errormessage = "Illegal money/float value '" + token + "'";
          this.parsestate = ParseState.PS_Error;
          return false;
        }

        parent[key] = Number(token);
        return true;
      }
      case VariableType.Blob: {
        if (tokentype != TokenType.JTT_String) {
          this.errormessage = "Illegal blob value '" + token + "'";
          this.parsestate = ParseState.PS_Error;
          return false;
        }
        parent[key] = WebHareBlob.from(Buffer.from(token, "base64"));
        return true;
      }
      case VariableType.DateTime: {
        if (tokentype != TokenType.JTT_String) {
          this.errormessage = "Illegal datetime value '" + token + "'";
          this.parsestate = ParseState.PS_Error;
          return false;
        }
        let value: Date;
        if (token === "")
          value = defaultDateTime;
        else if (token === "MAX")
          value = maxDateTime;
        else if (token[0] === 'T') {
          const msecs = Number(token.substring(1));
          value = new Date(defaultDateTime.getTime() + msecs);
        } else {
          if (token.indexOf("T") === -1)
            token = token + "T000000";
          const parts = /^(\d+)(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d(.\d+)?)$/.exec(token);
          if (!parts) {
            this.errormessage = "Illegal datetime value '" + token + "'";
            this.parsestate = ParseState.PS_Error;
            return false;
          }
          // Can't parse years > 4 digits, so handle them using year correction
          const year = parts[1].padStart(4, "0");
          const datestr = `${year.length > 4 ? "2000" : year}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:${parts[6]}Z`;
          value = new Date(Date.parse(datestr));
          if (year.length > 4)
            value.setUTCFullYear(Number(parts[1]));
          if (isNaN(value.getUTCFullYear())) // assume that overflows will result in a NaN, convert to maxDateTime
            value = maxDateTime;
        }
        parent[key] = value;
        return true;
      }
      case VariableType.Object:
      case VariableType.WeakObject:
      case VariableType.FunctionPtr: {
        throw new Error(`Not supported decoding type ${VariableType[this.lasttype] ?? this.lasttype} in JavaScript`);
      }
      default:
        throw new Error(`Unhandled variabletype in HSON typed decoder: ${VariableType[this.lasttype] ?? this.lasttype}`);
    }
  }
}

export function decodeHSON(hson: string | Uint8Array | ArrayBuffer | Buffer): IPCMarshallableData {
  const str = typeof hson === "string"
    ? hson
    : "length" in hson // true for Uint8Array and Buffer
      ? "copy" in hson
        ? hson.toString("utf-8")
        : Buffer.from(hson).toString("utf-8")
      : Buffer.from(hson).toString("utf-8");

  const decoder = new JSONParser();
  decoder.hson = true;

  for (const c of str) {
    if (!decoder.handleChar(c)) {
      break;
    }
  }
  const res = decoder.finish();
  if (res.success)
    return res.value;
  throw new Error(res.msg);
}


export type SimpleMarshallableData = boolean | null | string | number | bigint | Date | Money | { [key in string]: SimpleMarshallableData } | SimpleMarshallableData[];
export type SimpleMarshallableRecord = null | { [key in string]: SimpleMarshallableData };

/* TODO we may need to support WHDBBlob too - encodeHSON and IPC only currently require that they can transfer the data without await */
export type IPCMarshallableData = boolean | null | string | number | bigint | Date | Money | ArrayBuffer | Uint8Array | WebHareBlob | { [key in string]: IPCMarshallableData } | IPCMarshallableData[];
export type IPCMarshallableRecord = null | { [key in string]: IPCMarshallableData };
