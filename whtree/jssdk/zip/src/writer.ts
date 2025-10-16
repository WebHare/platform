import { max_uint16_t, max_uint32_t, writeStructFields, zip64_minversion, zip64_record_uncomp_bound, zip64EndOfCentralDirectoryLocator, zip64EndOfCentralDirectoryRecordV1, zip64ExtraFieldsHeader, zip64ExtraFieldsInfozipExtendedTimestamps, zip64ExtraFieldsInfozipUnicodePath, zip64ExtraFieldsZip64ExtendedInformation, zip_compressionmethod_deflate, zip_compressionmethod_store, zipCentralDirectoryHeader, zipEndOfCentralDirectoryRecord, zipLocalFileHeader, type StructRes } from "./headers";
import { collapsePathString, concatUint8Arrays, decodeCP437, encodeCP437, makeDOSDateTime } from "./utils";
import platformSupport from "./platformsupport";
import { FileBasedStreamsBuffer, type StreamsBuffer } from "./streamtools";

export type ValidZipDateTimeSources = Date | Temporal.Instant | Temporal.PlainDateTime | Temporal.PlainDate | Temporal.ZonedDateTime;

/** Converts a filename to CP437 encoding, changing non-encodable characters to _
    @param name - Name to encode
    @returns - Encoded name
    return.cp437name CP437-encoded name
    return.need_utf8_version Whether an extra-field with the UTF-8 name
      should be added (true if non-ascii characters or a 0-byte are found)
*/
function convertFileName(name: string) {
  const cp437name = encodeCP437(name.replaceAll("\x00", "_"), { fallback: "_" });
  return { cp437Name: cp437name, needUtf8Version: decodeCP437(cp437name) !== name || Array.from(name).includes("\0") };
}

function convertValidDateTimeSourceToDate(value: ValidZipDateTimeSources | null): Date {
  return value ?
    ("epochMilliseconds" in value ?
      new Date(value.epochMilliseconds) :
      "getTime" in value ?
        value :
        new Date(value.toZonedDateTime("UTC").epochMilliseconds)) :
    new Date();

}

type WriteEntry = {
  storeUtf8Name: boolean;
  cp437Name: Uint8Array;
  utf8Name: string;
  isDirectory: boolean;
  minVersion: number;
  modTime: Date | null;
  headerPos: number;
  dosDateTime: { mod_date: number; mod_time: number };
  crc32: number;
  compressed: boolean;
  uncompressedSize: number;
  compressedSize: number;
};

export type ZipArchiveWriterOptions = {
  /** Compression level, from 0 to 9. 0 means no compression, 9 means maximum compression */
  compressionLevel?: number;

  /** Whether to use ZIP64 format for files larger than 4GB */
  useZip64?: boolean;
};

type CompressionStats = {
  size: number;
  crc32: number;
  compressedSize: number;
  compressed: boolean;
};

type CompressionResult = {
  data: ReadableStream<Uint8Array>;
  compressionDone: Promise<CompressionStats>;
};

type DataSource = string | Blob | Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>;

type AddResult = {
  compressionDone: Promise<void>;
  written: Promise<void>;
};

/* The zip archive writer is now optimized for writing from and to streams. When writing
   to disk (and when the length of the input data is known) it might be more efficient
   to stream the compressed data to the file and using random access writes to write
   the file header later. But, that's a lot more complexity for disk writes specifically.
*/

export class ZipArchiveWriter {
  #buffers: StreamsBuffer;

  #dest: WritableStream<Uint8Array<ArrayBuffer>>;

  #entries: WriteEntry[] = [];

  #requireZip64: boolean;

  #options: Required<ZipArchiveWriterOptions> = { compressionLevel: 6, useZip64: false };

  #writePosition = 0;

  #finalized = false;

  #writePromise: Promise<void> = Promise.resolve();

  stream: ReadableStream<Uint8Array<ArrayBuffer>>;

  constructor(options: ZipArchiveWriterOptions = {}) {
    this.#buffers = new FileBasedStreamsBuffer();
    Object.assign(this.#options, options);
    this.#requireZip64 = this.#options.useZip64;

    // Create an id transform stream to return the generated data
    // FIXME: should we move all logic to within the readablestream creator of createArchive?
    const transform = new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
      transform: (chunk, controller) => {
        controller.enqueue(chunk);
      },
    });
    this.#dest = transform.writable;
    this.stream = transform.readable;
  }

  #normalizePath(fullPath: string) {
    fullPath = collapsePathString(fullPath);
    // remove trailing slashes and leading slashes
    while (fullPath.endsWith("/"))
      fullPath = fullPath.slice(0, -1);
    while (fullPath.startsWith("/"))
      fullPath = fullPath.substring(1);
    return fullPath;
  }

  #checkItemPath(fullPath: string) {
    const orgFullPath = fullPath;
    fullPath = this.#normalizePath(fullPath);
    // check for invalid path names
    if (["", ".", ".."].includes(fullPath) || fullPath.endsWith("/.") || fullPath.endsWith("/.."))
      throw new Error(`Invalid path name ${orgFullPath}`);
    return fullPath;
  }

  /* calculates the length of the file. Can be used when writing to files (but only when the uncompressed size is known
     before writing the file, which is not the case for streams)
  #getLocalFileHeaderLength(entry: WriteEntry) {
    const extraFieldsData = this.#getExtraFields(entry, false);
    return zipLocalFileHeader.size + entry.cp437Name.length + extraFieldsData.fields.length;
  }
 */

  async #buildLocalFileHeader(entry: WriteEntry) {
    if (entry.cp437Name.length >= 65535 || entry.utf8Name.length >= 65535)
      throw new Error(`Path name too long`);

    const extraFieldsData = this.#getExtraFields(entry, false);

    const writedata = { ...entry, ...extraFieldsData.entryoverrides };

    /* don't use zip_generalpurposeflags_languageencoding, Windows explorer doesn't honor it, uses the name
       decoded with the default codepage.
       MacOS command lib unzip and default unpacker expect UTF-8, though.
       So, we're encoding in CP437, and adding the Info-ZIP UTF-8 extra field with the UTF-8 name
    */
    const headerdata: StructRes<typeof zipLocalFileHeader.struct> =
    {
      signature: parseInt(zipLocalFileHeader.signature, 16),
      needversion: writedata.minVersion,
      bitflags: 0,
      compmethod: writedata.isDirectory || !writedata.compressed ? zip_compressionmethod_store : zip_compressionmethod_deflate,
      mod_time: writedata.dosDateTime.mod_time,
      mod_date: writedata.dosDateTime.mod_date,

      compsize: writedata.compressedSize,
      uncompsize: writedata.uncompressedSize,
      crc32: writedata.crc32,
      filenamelen: writedata.cp437Name.length,
      extralen: extraFieldsData.fields.length
    };

    const header = writeStructFields(zipLocalFileHeader.struct, headerdata);
    const fileHeader = concatUint8Arrays([header, entry.cp437Name, extraFieldsData.fields]);
    return fileHeader;
  }

  #getExtraFields(entry: WriteEntry, incentraldirectory: boolean): { fields: Uint8Array; minversion: number; entryoverrides: Partial<WriteEntry> } {
    const encoded: Uint8Array[] = [];
    const minversion = 0;
    const entryoverrides: Partial<WriteEntry> = {};

    if (entry.storeUtf8Name) {
      const nameBuf = new TextEncoder().encode(entry.utf8Name);
      encoded.push(writeStructFields([...zip64ExtraFieldsHeader.struct, ...zip64ExtraFieldsInfozipUnicodePath.struct], {
        fieldtype: zip64ExtraFieldsInfozipUnicodePath.fieldType,
        size: zip64ExtraFieldsInfozipUnicodePath.size + nameBuf.length,
        version: 1,
        crc32: platformSupport.crc32(entry.cp437Name),
        name: nameBuf,
      }));
    }

    if (entry.uncompressedSize > max_uint32_t || (incentraldirectory && entry.headerPos > max_uint32_t)) {
      let size = 0;
      const fields: Array<typeof zip64ExtraFieldsZip64ExtendedInformation.struct[number]> = [];


      if (!incentraldirectory) {
        // In a local file header
        if (entry.uncompressedSize > zip64_record_uncomp_bound) {
          fields.push({ name: "uncompsize", type: "B" }, { name: "compsize", type: "B" });
          entryoverrides.uncompressedSize = max_uint32_t;
          entryoverrides.compressedSize = max_uint32_t;
          size = 16;
        }
      } else {
        if (entry.uncompressedSize > max_uint32_t) {
          fields.push({ name: "uncompsize", type: "B" });
          entryoverrides.uncompressedSize = max_uint32_t;
          size += 8;
        }
        if (entry.compressedSize > max_uint32_t) {
          fields.push({ name: "compsize", type: "B" });
          entryoverrides.compressedSize = max_uint32_t;
          size += 8;
        }
        if (entry.headerPos > max_uint32_t) {
          fields.push({ name: "reloffset", type: "B" });
          entryoverrides.headerPos = max_uint32_t;
          size += 8;
        }
      }

      if (fields.length) {
        this.#requireZip64 = true;
        encoded.push(writeStructFields([...zip64ExtraFieldsHeader.struct, ...fields], {
          fieldtype: zip64ExtraFieldsZip64ExtendedInformation.fieldType,
          size,
          uncompsize: BigInt(entry.uncompressedSize),
          compsize: BigInt(entry.compressedSize),
          reloffset: BigInt(entry.headerPos),
          startdisk: 0,
        }));

        entryoverrides.minVersion = zip64_minversion; // MS-DOS 6.2, central directory encryption and zip64 end of directory v2
      }
    } else if (entry.compressedSize > max_uint32_t)
      throw new Error(`Compressed size >4GB but did not use ZIP64 record`);

    // zip64_extrafields_infozip_extendedtimestamps
    // central directory always has modtime, local field header honors flags
    encoded.push(writeStructFields([...zip64ExtraFieldsHeader.struct, ...zip64ExtraFieldsInfozipExtendedTimestamps.struct.filter(e => e.name === "flags" || e.name === "modtime")], {
      fieldtype: zip64ExtraFieldsInfozipExtendedTimestamps.fieldType,
      size: 5, // 1 byte flags 4 bytes modtime
      flags: 1,
      modtime: entry.modTime ? Math.floor(entry.modTime.getTime() / 1000) : 0,
    }));

    return { fields: concatUint8Arrays(encoded), minversion, entryoverrides };
  }

  #compressFile(data: DataSource, options: { compressionLevel?: number }): CompressionResult {
    // Convert the data to a stream
    if (typeof data !== "object" || !("getReader" in data)) {
      // data is not a stream
      if (typeof data === "string")
        data = new TextEncoder().encode(data);
      if (!("stream" in data))
        data = new Blob([data]);
      data = data.stream();
    }

    let curcrc32 = 0;
    let size = 0;
    let compressedSize = 0;
    const compressionDone = Promise.withResolvers<CompressionStats>();

    const calcCRCAndLength = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.length;
        curcrc32 = platformSupport.crc32(chunk, curcrc32);
        controller.enqueue(chunk);
      },
      flush() {
        if (!options?.compressionLevel)
          compressionDone.resolve({ size, crc32: curcrc32, compressedSize: size, compressed: false });
      },
    });

    data = data.pipeThrough(calcCRCAndLength);

    if (options?.compressionLevel) {
      data = data.pipeThrough(platformSupport.createCompressTransform({ compressionLevel: options.compressionLevel }));

      const calcCompressedSize = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          compressedSize += chunk.length;
          controller.enqueue(chunk);
        },
        flush() {
          compressionDone.resolve({ size, crc32: curcrc32, compressedSize, compressed: true });
        }
      });
      data = data.pipeThrough(calcCompressedSize);
    }

    return {
      data: data,
      compressionDone: compressionDone.promise,
    };
  }

  async #addItem(
    fullPath: string,
    isDirectory: boolean,
    modTime: ValidZipDateTimeSources | null,
    data: DataSource | null,
    options: { compressionLevel?: number },
    compressionDone: PromiseWithResolvers<void>,
  ) {
    if (this.#finalized)
      throw new Error("Cannot add files after finalizing the zip archive");

    fullPath = this.#checkItemPath(fullPath);
    if (isDirectory && !fullPath.endsWith("/"))
      fullPath += "/";

    const convertres = convertFileName(fullPath);
    modTime = convertValidDateTimeSourceToDate(modTime);

    const deferFinishedWrite = Promise.withResolvers<void>();
    const oldWritePromise = this.#writePromise;
    this.#writePromise = oldWritePromise.then(() => deferFinishedWrite.promise);

    const entry: WriteEntry = {
      storeUtf8Name: convertres.needUtf8Version,
      cp437Name: convertres.cp437Name,
      utf8Name: fullPath,
      isDirectory,
      minVersion: 20, // MS-DOS, version 2.0
      modTime: modTime,
      headerPos: -1, // not known yet, not written to local file header
      dosDateTime: makeDOSDateTime(modTime),
      crc32: 0,
      compressed: false,
      uncompressedSize: 0,
      compressedSize: 0
    };

    let toWrite: ReadableStream<Uint8Array> | undefined;

    if (data !== null) {
      const toStream = data;
      // FIXME: max 4 compressors parallel
      await (async () => {
        const bufferStream = this.#buffers.getStreamBuffer();
        const res = this.#compressFile(toStream, options);
        await res.data.pipeTo(bufferStream.writable);
        compressionDone.resolve();
        const stats = await res.compressionDone;
        entry.compressed = stats.compressed;
        entry.crc32 = stats.crc32;
        entry.uncompressedSize = stats.size;
        entry.compressedSize = stats.compressedSize;
        toWrite = bufferStream.readable;
      })();
    }

    const header = await this.#buildLocalFileHeader(entry);

    deferFinishedWrite.resolve(oldWritePromise.then((async () => {
      entry.headerPos = this.#writePosition;
      this.#entries.push(entry);
      await new Blob([header]).stream().pipeTo(this.#dest, { preventClose: true });
      this.#writePosition += header.byteLength;
      if (toWrite) {
        await toWrite.pipeTo(this.#dest, { preventClose: true });
        this.#writePosition += entry.compressedSize;
      }
    })));

    await deferFinishedWrite.promise;
  }

  addFolder(fullPath: string, modTime: ValidZipDateTimeSources | null): AddResult {
    if (this.#finalized)
      throw new Error("Cannot add folders after finalizing the zip archive");

    return {
      compressionDone: Promise.resolve(),
      written: this.#addItem(fullPath, true, modTime, null, { compressionLevel: 0 }, Promise.withResolvers()),
    };
  }

  addFile(name: string, data: string | Blob | Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>, modTime: ValidZipDateTimeSources | null, options?: { compressionLevel?: number; length?: number }): AddResult {
    options ??= {};
    options.compressionLevel ??= this.#options.compressionLevel;

    const compressionDoneDefer = Promise.withResolvers<void>();
    const written = this.#addItem(name, false, modTime, data, options, compressionDoneDefer);

    return {
      compressionDone: compressionDoneDefer.promise,
      written,
    };
  }

  async finalize(options?: { comment?: string }): Promise<void> {
    if (this.#finalized)
      throw new Error("Cannot finalize the zip archive more than once");
    this.#finalized = true;
    await this.#buffers[Symbol.asyncDispose]();

    // wait for all scheduled writes to complete
    await this.#writePromise;

    const dirStart = this.#writePosition;
    if (this.#entries.length > 65535)
      this.#requireZip64 = true;

    const toWrite: Uint8Array[] = [];

    for (const entry of this.#entries) {
      const extrafields = this.#getExtraFields(entry, true);

      const writedata = { ...entry, ...extrafields.entryoverrides };
      const cdentry = writeStructFields(zipCentralDirectoryHeader.struct, {
        signature: parseInt(zipCentralDirectoryHeader.signature, 16),
        madeversion: this.#requireZip64 ? zip64_minversion : 20, // Made by MS-DOS, ZIP spec v2.0 or v6.2 when using ZIP64
        needversion: writedata.minVersion,
        bitflags: 0,
        compmethod: writedata.isDirectory || !writedata.compressed ? 0 : 8,
        mod_time: writedata.dosDateTime.mod_time,
        mod_date: writedata.dosDateTime.mod_date,
        crc32: writedata.crc32,
        compsize: writedata.compressedSize,
        uncompsize: writedata.uncompressedSize,
        filenamelen: writedata.cp437Name.length,
        extralen: extrafields.fields.length,
        commentln: 0,
        startdisk: 0,
        infileattr: 0,
        exfileattr: writedata.isDirectory ? 0x10 : 0,
        reloffset: writedata.headerPos
      });

      toWrite.push(cdentry);
      this.#writePosition += cdentry.length;
      toWrite.push(entry.cp437Name);
      this.#writePosition += entry.cp437Name.length;
      toWrite.push(extrafields.fields);
      this.#writePosition += extrafields.fields.length;
    }

    const dirsize = this.#writePosition - dirStart;
    if (this.#requireZip64) {

      // Write ZIP64 end of directory record
      const zip64_eod_record_position = this.#writePosition;
      // We're writing a v1 record, no need for all v2 fields

      const zip64EodRecord = writeStructFields(zip64EndOfCentralDirectoryRecordV1.struct, {
        signature: parseInt(zip64EndOfCentralDirectoryRecordV1.signature, 16),
        size: BigInt(zip64EndOfCentralDirectoryRecordV1.size - 12), /* signature(4) + size(8) */
        madeversion: zip64_minversion,
        needversion: zip64_minversion,
        disknumber: 0,
        dirdisk: 0,
        diskentries: BigInt(this.#entries.length),
        direntries: BigInt(this.#entries.length),
        dirsize: BigInt(dirsize),
        reloffset: BigInt(dirStart)
      });
      toWrite.push(zip64EodRecord);
      this.#writePosition += zip64EodRecord.length;

      const zip64EodLocator = writeStructFields(zip64EndOfCentralDirectoryLocator.struct, {
        signature: parseInt(zip64EndOfCentralDirectoryLocator.signature, 16),
        dirdisk: 0,
        reloffset: BigInt(zip64_eod_record_position),
        totaldisks: 1
      });


      // Write ZIP64 end of directory locator
      toWrite.push(zip64EodLocator);
      this.#writePosition += zip64EodLocator.length;
    }
    const commentBuf = new TextEncoder().encode(options?.comment ?? "");
    const eodlocator = writeStructFields(zipEndOfCentralDirectoryRecord.struct, {
      signature: parseInt(zipEndOfCentralDirectoryRecord.signature, 16),
      disknumber: 0,
      dirdisk: 0,
      diskentries: this.#entries.length > max_uint16_t ? max_uint16_t : this.#entries.length,
      direntries: this.#entries.length > max_uint16_t ? max_uint16_t : this.#entries.length,
      dirsize: dirsize > max_uint32_t ? max_uint32_t : dirsize,
      reloffset: dirStart > max_uint32_t ? max_uint32_t : dirStart,
      commentlen: commentBuf.length
    });
    toWrite.push(eodlocator);
    this.#writePosition += eodlocator.length;
    toWrite.push(commentBuf);
    this.#writePosition += commentBuf.length;

    await new Blob(toWrite).stream().pipeTo(this.#dest);
  }

  async[Symbol.asyncDispose]() {
    if (!this.#finalized)
      await this.#buffers[Symbol.asyncDispose]();
  }
}
