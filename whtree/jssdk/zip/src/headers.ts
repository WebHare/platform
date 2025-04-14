import { getDataViewFromUint8Array, getUint8ArrayFromDataView } from "./utils";

export const max_uint16_t = 65535;
export const max_uint32_t = 4294967295;


/** If set, the CRC and uncompressed size are put in a data descriptor record (but are
    set correctly in the central directory header)
*/
export const zip_generalpurposeflags_withdatadescriptor = 1 << 3;

/// If set, name and comment are encoded in UTF-8
export const zip_generalpurposeflags_languageencoding = 1 << 11;

/** Use ZIP64 size extensions when the uncompressed size is equal or larger than this value, so we're
    sure the compressed size &lt; 4GB. Smaller than 4GB because the compressed size can be bigger than
    the uncompressed size (for uncompressable files)
*/
export const zip64_record_uncomp_bound = 4000000000;

/// Minimum ZIP version needed to decode ZIP64 extensions
export const zip64_minversion = 45; // 4.5 had first ZIP64 extensions

/// Compression method 'store'
export const zip_compressionmethod_store = 0;

/// Compression method 'deflate'
export const zip_compressionmethod_deflate = 8;


const fieldTypes = {
  C: {
    size: 1,
    read: (buf: DataView, offset: number): number => buf.getUint8(offset),
    write: (buf: DataView | null, offset: number, value: number) => buf?.setUint8(offset, value) ?? offset + 1
  },
  r4: {
    size: 4,
    read: (buf: DataView, offset: number): number => buf.getUint32(offset),
    write: (buf: DataView | null, offset: number, value: number) => buf?.setUint32(offset, value) ?? offset + 4
  },
  S: {
    size: 2,
    read: (buf: DataView, offset: number): number => buf.getUint16(offset, true),
    write: (buf: DataView | null, offset: number, value: number) => buf?.setUint16(offset, value, true) ?? offset + 2
  },
  L: {
    size: 4,
    read: (buf: DataView, offset: number): number => buf.getUint32(offset, true),
    write: (buf: DataView | null, offset: number, value: number) => buf?.setUint32(offset, value, true) ?? offset + 4
  },
  B: {
    size: 8,
    read: (buf: DataView, offset: number): bigint => buf.getBigUint64(offset, true),
    write: (buf: DataView | null, offset: number, value: bigint) => buf?.setBigUint64(offset, value, true) ?? offset + 8
  },
  "r*": {
    size: 0,
    read: (buf: DataView, offset: number): Uint8Array => getUint8ArrayFromDataView(buf).subarray(offset),
    write: (buf: DataView | null, offset: number, value: Uint8Array) => {
      if (buf)
        getUint8ArrayFromDataView(buf).set(value, offset);
      return offset + value.length;
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as const satisfies Record<string, { size: number; read: (buf: DataView, offset: number) => any; write: (buf: DataView, offset: number, value: any) => void }>;

type StructDef = Array<{ name: string; type: keyof typeof fieldTypes }>;
export type StructRes<S extends StructDef> = { [K in S[number]["name"]]: ReturnType<(typeof fieldTypes[(S[number] & { name: K })["type"]])["read"]> };

export type HeaderDef = { struct: StructDef; size: number; signature?: string; fieldType?: number };

export const zipLocalFileHeader = {
  size: 30,
  signature: "504b0304",
  struct: [
    { name: "signature", type: "r4", },
    { name: "needversion", type: "S", },
    { name: "bitflags", type: "S", },
    { name: "compmethod", type: "S", },
    { name: "mod_time", type: "S", },
    { name: "mod_date", type: "S", },
    { name: "crc32", type: "L", },
    { name: "compsize", type: "L", },
    { name: "uncompsize", type: "L", },
    { name: "filenamelen", type: "S", },
    { name: "extralen", type: "S", },
  ]
} as const satisfies HeaderDef;

export const zipCentralDirectoryHeader = {
  size: 46,
  signature: "504b0102",
  struct: [
    { name: "signature", type: "r4", },
    { name: "madeversion", type: "S", },
    { name: "needversion", type: "S", },
    { name: "bitflags", type: "S", },
    { name: "compmethod", type: "S", },
    { name: "mod_time", type: "S", },
    { name: "mod_date", type: "S", },
    { name: "crc32", type: "L", },
    { name: "compsize", type: "L", },
    { name: "uncompsize", type: "L", },
    { name: "filenamelen", type: "S", },
    { name: "extralen", type: "S", },
    { name: "commentln", type: "S", },
    { name: "startdisk", type: "S", },
    { name: "infileattr", type: "S", },
    { name: "exfileattr", type: "L", },
    { name: "reloffset", type: "L", },
  ]
} as const satisfies HeaderDef;

export const zipEndOfCentralDirectoryRecord = {
  size: 22,
  signature: "504b0506",
  struct: [
    { name: "signature", type: "r4", },
    { name: "disknumber", type: "S", },
    { name: "dirdisk", type: "S", },
    { name: "diskentries", type: "S", },
    { name: "direntries", type: "S", },
    { name: "dirsize", type: "L", },
    { name: "reloffset", type: "L", },
    { name: "commentlen", type: "S", },
  ]
} as const satisfies HeaderDef;

export const zip64EndOfCentralDirectoryLocator = {
  size: 20,
  signature: "504b0607",
  struct: [
    { name: "signature", type: "r4", },
    { name: "dirdisk", type: "L", },
    { name: "reloffset", type: "B", },
    { name: "totaldisks", type: "L", },
  ]
} as const satisfies HeaderDef;

export const zip64EndOfCentralDirectoryRecordV1 = {
  size: 56,
  signature: "504b0606",
  struct: [
    { name: "signature", type: "r4", },
    { name: "size", type: "B", },
    { name: "madeversion", type: "S", },
    { name: "needversion", type: "S", },
    { name: "disknumber", type: "L", },
    { name: "dirdisk", type: "L", },
    { name: "diskentries", type: "B", },
    { name: "direntries", type: "B", },
    { name: "dirsize", type: "B", },
    { name: "reloffset", type: "B", },
  ]
} as const satisfies HeaderDef;

export const zip64EndOfCentralDirectoryRecordV2 = {
  size: 56 + 28,
  signature: "504b0606",
  struct: [
    { name: "signature", type: "r4", },
    { name: "size", type: "B", },
    { name: "madeversion", type: "S", },
    { name: "needversion", type: "S", },
    { name: "disknumber", type: "L", },
    { name: "dirdisk", type: "L", },
    { name: "diskentries", type: "B", },
    { name: "direntries", type: "B", },
    { name: "dirsize", type: "B", },
    { name: "reloffset", type: "B", },
    { name: "compmethod", type: "S", },
    { name: "compsize", type: "B", },
    { name: "uncompsize", type: "B", },
    { name: "algid", type: "S", },
    { name: "bitlen", type: "S", },
    { name: "flags", type: "S", },
    { name: "hashid", type: "S", },
    { name: "hashlen", type: "S", },
  ]
} as const satisfies HeaderDef;

export const zip64ExtraFieldsHeader = {
  size: 4,
  struct: [
    { name: "fieldtype", type: "S" },
    { name: "size", type: "S" },
  ]
} as const satisfies HeaderDef;

export const zip64ExtraFieldsInfozipExtendedTimestamps = {
  size: 13,
  fieldType: 0x5455,
  // not actually used, the L fields are all optional and difference between handling in central/local headers
  struct: [
    { name: "flags", type: "C" },
    { name: "modtime", type: "L" },
    { name: "accesstime", type: "L" },
    { name: "creationtime", type: "L" },
  ]
} as const satisfies HeaderDef;

export const zip64ExtraFieldsInfozipUnicodePath = {
  size: 5,
  fieldType: 0x7075,
  struct: [
    { name: "version", type: "C" },
    { name: "crc32", type: "L" },
    { name: "name", type: "r*" },
  ]
} as const satisfies HeaderDef;

export const zip64ExtraFieldsZip64ExtendedInformation = {
  size: 28,
  fieldType: 1,
  // not actually used, these fields are all optional
  struct: [
    { name: "uncompsize", type: "B" },
    { name: "compsize", type: "B" },
    { name: "reloffset", type: "B" },
    { name: "startdisk", type: "L" },
  ]
} as const satisfies HeaderDef;

export function readStructFields<S extends StructDef>(struct: S, buf: Uint8Array, offset: number): StructRes<S> {
  const result = {} as StructRes<S>;
  let fieldOfs = 0;
  const view = getDataViewFromUint8Array(buf);
  for (const field of struct) {
    const fieldType = fieldTypes[field.type];
    result[field.name as keyof StructRes<S>] = fieldType.read(view, offset + fieldOfs) as StructRes<S>[S[number]["name"]];
    fieldOfs += fieldType.size;
  }
  return result;
}

export function writeStructFields<S extends StructDef>(struct: S, value: StructRes<S>): Uint8Array {
  // First calculate the size
  let size = 0;
  for (const field of struct) {
    const fieldType = fieldTypes[field.type];
    size = fieldType.write(null, size, value[field.name as keyof StructRes<S>] as never);
  }
  // Allocate a buffer of appropriate size and write the data
  const buf = new Uint8Array(size);
  const view = getDataViewFromUint8Array(buf);
  let fieldOfs = 0;
  for (const field of struct) {
    const fieldType = fieldTypes[field.type];
    fieldType.write(view, fieldOfs, value[field.name as keyof StructRes<S>] as never);
    fieldOfs += fieldType.size;
  }
  return buf;
}
