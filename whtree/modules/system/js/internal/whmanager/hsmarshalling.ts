import { LinearBufferReader, LinearBufferWriter } from "./bufs";
// FIXME - import { Money } from "@webhare/std"; - but this breaks the shrinkwrap (it can't find @webhare/std)
import { dateToParts, makeDateFromParts } from "../../../../../jssdk/hscompat/src/datetime";
import { Money } from "../../../../../jssdk/std/src/money";
import { WebHareBlob, WebHareDiskBlob } from "../../../../../jssdk/services/src/webhareblob"; //we need to directly load is to not break gen_config.ts
import { determineType, getDefaultValue, setHareScriptType, HareScriptType, unifyEltTypes, type HSType, type IPCMarshallableData, type IPCMarshallableRecord } from "@webhare/hscompat/src/hson";
import { getWHType } from "@webhare/std/src/quacks";

export { type IPCMarshallableData, type IPCMarshallableRecord, HareScriptType as VariableType };
export type { HSType };
export { getDefaultValue }; //edudex compatibility

type ArrayHareScriptType = HareScriptType.VariantArray | HareScriptType.IntegerArray | HareScriptType.MoneyArray | HareScriptType.FloatArray | HareScriptType.BooleanArray | HareScriptType.DateTimeArray | HareScriptType.Integer64Array | HareScriptType.FunctionPtrArray | HareScriptType.RecordArray | HareScriptType.StringArray | HareScriptType.BlobArray | HareScriptType.ObjectArray;

/** Add a HareScript type annotation to an array, makes sure empty arrays are sent correctly over IPC */
export function getTypedArray<V extends ArrayHareScriptType, T extends HSType<V>>(type: V, array: T): T {
  const copy = [...array];
  setHareScriptType(copy, type);
  return copy as T;
}

const MarshalFormatType = 2;
const MarshalPacketFormatType = 3;
const MarshalPacketHeaderType = 6;


export function readMarshalData(buffer: Buffer | ArrayBuffer, options?: { diskblobsByReference: true }): SimpleMarshallableData {
  const buf = new LinearBufferReader(buffer);
  const version = buf.readU8();
  if (version !== MarshalFormatType)
    throw new Error(`Unsupported marshal format type #${version}`);

  const columns: string[] = [];

  const columncount = buf.readU32();
  for (let i = 0; i < columncount; ++i) {
    const colsize = buf.readU8();
    columns.push(buf.readRaw(colsize).toString("utf-8").toLowerCase());
  }

  const type = buf.readU8() as HareScriptType;
  const retval = marshalReadInternal(buf, type, columns, null, options?.diskblobsByReference || false);
  if (buf.readpos !== buf.length)
    throw new Error(`Garbage at end of marshalling packet`);
  return retval as SimpleMarshallableData;
}

export function readMarshalPacket(buffer: Buffer | ArrayBuffer, options?: { diskblobsByReference: true }): IPCMarshallableData {
  const buf = new LinearBufferReader(buffer);
  const version = buf.readU32();
  if (version !== MarshalPacketHeaderType)
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
    if (buf.readpos !== 20 + columnsize)
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
    if (buf.readpos !== 20 + columnsize + datasize + Number(totalblobsize))
      throw new Error(`Error in marshalling packet: incorrect blob section size`);
  }

  buf.readpos = 20 + columnsize;
  const dataformat = buf.readU8();
  if (dataformat !== MarshalPacketFormatType)
    throw new Error(`Error in marshalling packet: Invalid data format`);
  const type = buf.readU8() as HareScriptType;
  const retval = marshalReadInternal(buf, type, columns, blobs, options?.diskblobsByReference || false);
  if (buf.readpos !== 20 + columnsize + datasize)
    throw new Error(`Error in marshalling packet: incorrect data section size`);
  return retval;
}

function marshalReadInternal(buf: LinearBufferReader, type: HareScriptType, columns: string[], blobs: Buffer[] | null, diskblobsByReference: boolean): IPCMarshallableData {
  if (type & 0x80) {
    const eltcount = buf.readU32();
    const retval: IPCMarshallableData[] = getDefaultValue(type) as IPCMarshallableData[];
    if (type === HareScriptType.VariantArray) {
      for (let i = 0; i < eltcount; ++i) {
        const subtype = buf.readU8() as HareScriptType;
        retval.push(marshalReadInternal(buf, subtype, columns, blobs, diskblobsByReference));
      }
    } else {
      for (let i = 0; i < eltcount; ++i) {
        retval.push(marshalReadInternal(buf, type & ~0x80, columns, blobs, diskblobsByReference));
      }
    }
    return retval;
  }
  switch (type) {
    case HareScriptType.Integer: {
      return buf.readS32();
    }
    case HareScriptType.Integer64: {
      return buf.readBigS64();
    }
    case HareScriptType.HSMoney: {
      const value = buf.readBigS64();
      let str = value.toString();
      const isnegative = value < BigInt(0);
      str = str.substring(isnegative ? 1 : 0).padStart(6, "0");
      str = str.substring(0, str.length - 5) + "." + str.substring(str.length - 5);
      return new Money((isnegative ? "-" : "") + str);
    }
    case HareScriptType.Float: {
      return buf.readDouble();
    }
    case HareScriptType.Boolean: {
      return buf.readBoolean();
    }
    case HareScriptType.DateTime: {
      const days = buf.readU32();
      const msecs = buf.readU32();
      return makeDateFromParts(days, msecs);
    }
    case HareScriptType.String: {
      return buf.readString();
    }
    case HareScriptType.Blob: { //see /doc/marshalling.md for the exact format used
      const size = buf.readBigU64();
      if (size >= 2 ** 31 - 1)
        throw new Error(`Blob size exceeds maximum supported size`);
      if (size === 0n)
        return WebHareBlob.from("");

      const embedType = buf.readU8();
      if (embedType === 1) { //embedded blob
        if (!diskblobsByReference)
          throw new Error(`Unexpected embedded blob when diskblobsByReference is false`);
        return new WebHareDiskBlob(Number(size), buf.readString());
      }
      if (blobs) {
        const blobid = buf.readU32();
        return WebHareBlob.from(blobs[blobid - 1]);
      }
      //raw embedded
      return WebHareBlob.from(buf.readRaw(Number(size)));
    }
    case HareScriptType.FunctionPtr: {
      throw new Error(`Cannot decode FUNCTIONPTR yet`); // FIXME?
    }
    case HareScriptType.Record: {
      const eltcount = buf.readS32();
      if (eltcount < 0)
        return null;
      const retval: { [s: string]: IPCMarshallableData } = {};
      for (let i = 0; i < eltcount; ++i) {
        const namenr = buf.readU32();
        if (namenr >= columns.length)
          throw new Error(`Corrupt marshal packet: column name nr out of range`);
        const subtype = buf.readU8() as HareScriptType;
        retval[columns[namenr]] = marshalReadInternal(buf, subtype, columns, blobs, diskblobsByReference);
      }
      return retval;
    }
    case HareScriptType.Object: {
      throw new Error(`Cannot decode OBJECT`);
    }
    case HareScriptType.WeakObject: {
      throw new Error(`Cannot decode WEAK OBJECT`);
    }
    default: {
      throw new Error(`Cannot decode type #${type}`);
    }
  }
}

export function writeMarshalData(value: unknown, { onlySimple, diskblobsByReference }: { onlySimple?: boolean; diskblobsByReference?: boolean } = {}): Buffer {
  const columns = new Map<string, number>();

  const datawriter = new LinearBufferWriter();
  const path: object[] = [];
  const blobs = onlySimple ? [] : null;
  writeMarshalDataInternal(value, datawriter, columns, blobs, null, path, diskblobsByReference || false);
  if (blobs && blobs.length)
    throw new Error(`Cannot include Buffers or types arrays in in this mode`);

  const startwriter = new LinearBufferWriter();
  startwriter.writeU8(MarshalFormatType);
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

export function writeMarshalPacket(value: unknown, options?: { diskblobsByReference?: boolean }): Buffer {

  const columns = new Map<string, number>();

  const datawriter = new LinearBufferWriter();
  const path: object[] = [];
  const blobs: Uint8Array[] = [];
  datawriter.writeU8(MarshalPacketFormatType);
  writeMarshalDataInternal(value, datawriter, columns, blobs, null, path, options?.diskblobsByReference || false);

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
    for (const blob of blobs)
      blobwriter.writeU64(BigInt(blob.byteLength));
    for (const blob of blobs)
      blobwriter.writeRaw(blob);
  }

  const data_column = columnwriter.finish();
  const data_data = datawriter.finish();
  const data_blob = blobwriter.finish();

  const startwriter = new LinearBufferWriter();
  startwriter.writeU32(MarshalPacketHeaderType);
  startwriter.writeU32(data_column.byteLength);
  startwriter.writeU32(data_data.byteLength);
  startwriter.writeU64(BigInt(data_blob.byteLength));

  return Buffer.concat([startwriter.finish(), data_column, data_data, data_blob]);
}

function writeMarshalDataInternal(value: unknown, writer: LinearBufferWriter, columns: Map<string, number>, blobs: Uint8Array[] | null, type: HareScriptType | null, path: object[], diskblobsByReference: boolean) {
  const determinedtype = determineType(value);
  if (type === null) {
    type = determinedtype;
    writer.writeU8(type);
  } else if (type !== determinedtype) {
    if (unifyEltTypes(type, determinedtype) !== type)
      throw new Error(`Cannot store an ${HareScriptType[determinedtype] ?? determinedtype} in an array for ${HareScriptType[type] ?? type}`);
  }

  if (type & HareScriptType.Array) {
    if (path.includes(value as object)) //already seen this value
      throw new Error(`Detected a circular reference`);
    path.push(value as object);

    const len = (value as unknown[]).length;
    writer.writeU32(len);
    const subtype = type === HareScriptType.VariantArray ? null : type & ~HareScriptType.Array;
    for (let i = 0; i < len; ++i) {
      writeMarshalDataInternal((value as unknown[])[i], writer, columns, blobs, subtype, path, diskblobsByReference);
    }

    path.pop();
    return;
  }
  switch (type) {
    case HareScriptType.Integer: {
      writer.writeS32(value as number);
    } break;
    case HareScriptType.Integer64: {
      writer.writeS64(BigInt(value as (number | bigint)));
    } break;
    case HareScriptType.Float: {
      if (typeof value !== "number") { // Money, boxed float??
        if (Money.isMoney(value))
          writer.writeDouble(Number(value.value));
        else
          throw new Error(`Unknown object to encode as float`);
      } else
        writer.writeDouble(value as number);
    } break;
    case HareScriptType.HSMoney: {
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
    case HareScriptType.Boolean: {
      writer.writeU8(value as boolean ? 1 : 0);
    } break;
    case HareScriptType.String: {
      writer.writeString(value as string);
    } break;
    case HareScriptType.DateTime: {
      const { days, msecs } = dateToParts(value as Date);
      writer.writeU32(days);
      writer.writeU32(msecs);
    } break;
    case HareScriptType.Record: {
      if (!value) {
        writer.writeS32(-1);
        break;
      }

      // if (getWHType(value) === "ResourceDescriptor") { //we can't load isResourceDescriptor due to cyclic deps. If encodeforMessageTransfer becomes more generic we will need to marshall ResourceDescriptors here for CallJS
      //   value = __getHareScriptResourceDescriptor(value as ResourceDescriptor);
      // }

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
        writeMarshalDataInternal(subvalue, writer, columns, blobs, null, path, diskblobsByReference);
      }
      path.pop();
    } break;
    case HareScriptType.Blob: { //see /doc/marshalling.md for the exact format used
      writer.writeU64((value as WebHareBlob).size);
      if (!(value as WebHareBlob).size)  //empty blob
        return;

      if (diskblobsByReference && getWHType(value) === "WebHareDiskBlob" && (value as WebHareDiskBlob).path) {
        writer.writeU8(1); //path marker
        writer.writeString((value as WebHareDiskBlob).path);
        return;
      }

      writer.writeU8(0); //embed marker
      const data = (value as WebHareBlob).__getAsSyncUInt8Array();
      if (blobs) {
        blobs.push(data);
        writer.writeU32(blobs.length);
      } else {
        writer.writeRaw(data);
      }
    } break;
    default: {
      throw new Error(`Cannot encode type ${HareScriptType[type] ?? type}`);
    }
  }
}


export type SimpleMarshallableData = boolean | null | string | number | bigint | Date | Money | { [key in string]: SimpleMarshallableData } | SimpleMarshallableData[];
export type SimpleMarshallableRecord = null | { [key in string]: SimpleMarshallableData };
