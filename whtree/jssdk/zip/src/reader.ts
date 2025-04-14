import { max_uint16_t, max_uint32_t, readStructFields, zip64EndOfCentralDirectoryLocator, zip64EndOfCentralDirectoryRecordV1, zip64ExtraFieldsHeader, zip64ExtraFieldsInfozipExtendedTimestamps, zip64ExtraFieldsInfozipUnicodePath, zip64ExtraFieldsZip64ExtendedInformation, zip_compressionmethod_deflate, zip_compressionmethod_store, zip_generalpurposeflags_languageencoding, zip_generalpurposeflags_withdatadescriptor, zipCentralDirectoryHeader, zipEndOfCentralDirectoryRecord, zipLocalFileHeader, type HeaderDef, type StructRes } from "./headers";
import { RandomAccessReadStream, type RandomAccessReadStreamSource } from "./randomaccessstream";
import { collapsePathString, decodeCP437, hexToUint8Array, isValidUTF8, readDOSDateTime, searchLastSubArray, streamIntoBlob } from "./utils";
import platformSupport from "./platformsupport-browser";

/** Locates the ZIP end of directory record within an archive
    @param file - File to read from
    @returns - End of directory record offset, -1 if not found
*/
async function findEndOfDirectoryRecord(file: RandomAccessReadStream): Promise<number> {
  let curOfs = await file.size();
  let fill = 0;
  const searchBufSize = 256;
  const buffer = new Uint8Array(searchBufSize);

  const toSearch = hexToUint8Array(zipEndOfCentralDirectoryRecord.signature);

  while (curOfs !== 0) {
    // We need to keep a few chars from the previous buffer to catch the signature
    const toKeep = Math.min(fill, 3);
    const toRead = Math.min(curOfs, searchBufSize - toKeep);
    const readOfs = curOfs - toRead;
    buffer.copyWithin(toRead, 0, toKeep);

    curOfs = readOfs;
    const buf = await file.read({ buffer, offset: 0, length: toRead, exactLength: true, position: readOfs });

    fill = toRead + toKeep;
    const idx = searchLastSubArray(buf.buffer, toSearch, toRead);
    if (idx !== -1)
      return readOfs + idx;
  }
  return -1;
}

function buf2txt(buf: Uint8Array) {
  return new TextDecoder().decode(buf);
}

async function readStruct<H extends HeaderDef>(file: RandomAccessReadStream, position: number, header: H, options?: { optional: true; name?: string }): Promise<StructRes<H["struct"]> | null>;
async function readStruct<H extends HeaderDef>(file: RandomAccessReadStream, position: number, header: H, options?: { optional?: boolean; name?: string }): Promise<StructRes<H["struct"]>>;
async function readStruct<H extends HeaderDef>(file: RandomAccessReadStream, position: number, header: H, options?: { optional?: boolean; name?: string }) {
  const readres = await file.read({ position, length: header.size });
  if (readres.bytesRead !== header.size && !options?.optional)
    throw new Error(`Unexpected end of file while reading ${options?.name ?? "header"} at ${position}`);

  // allocate a view on the read buffer to avoid copying
  const data = readStructFields(header.struct, readres.buffer, 0);
  if (header.signature && data.signature !== parseInt(header.signature, 16)) {
    if (options?.optional)
      return null;
    //console.log(` sigs: `, { data, dsh: data.signature.toString(16), header });
    throw new Error(`Invalid signature for ${options?.name ?? "header"} at ${position} (0x${position.toString(16)})`);
  }

  return data;
}

async function readEndOfDirectory(file: RandomAccessReadStream, ofs: number) {
  const data = await readStruct(file, ofs, zipEndOfCentralDirectoryRecord, { name: "end of directory record" });

  const commentRes = data.commentlen ? await file.read({
    position: ofs + zipEndOfCentralDirectoryRecord.size,
    length: Number(data.commentlen),
    exactLength: true
  }) : null;
  return { ...data, comment: commentRes ? buf2txt(commentRes.buffer) : "" };
}

async function readZip64EndOfDirectoryLocator(file: RandomAccessReadStream, ofs: number) {
  return await readStruct(file, ofs, zip64EndOfCentralDirectoryLocator, { name: "zip64 end of directory locator", optional: true });
}

async function readZip64EndOfDirectoryRecord(file: RandomAccessReadStream, ofs: number | bigint) {
  const data = await readStruct(file, Number(ofs), zip64EndOfCentralDirectoryRecordV1, { name: "zip64 end of directory record" });
  if (data.size < 44)
    throw new Error("Size of ZIP64 end of directory record is too small");
  return data;
}

type ExtraFields = Array<{
  parsed: true;
  fieldType: typeof zip64ExtraFieldsZip64ExtendedInformation.fieldType;
  uncompsize?: bigint;
  compsize?: bigint;
  reloffset?: bigint;
  startdisk?: number;
} | {
  parsed: true;
  fieldType: typeof zip64ExtraFieldsInfozipUnicodePath.fieldType;
  version: number;
  crc32: number;
  name: Uint8Array;
} | {
  parsed: true;
  fieldType: typeof zip64ExtraFieldsInfozipExtendedTimestamps.fieldType;
  modtime?: Date;
  accesstime?: Date;
  creationtime?: Date;
} | {
  parsed: false;
  fieldType: number;
  data: Uint8Array;
}>;

type MinimalEntry = {
  uncompsize: number;
  compsize: number;
  reloffset?: number;
  startdisk?: number;
};

async function readExtraFields(file: RandomAccessReadStream, position: number, entry: MinimalEntry, extrafieldslen: number, incentraldirectory: boolean): Promise<ExtraFields> {
  if (extrafieldslen === 0)
    return [];

  const readres = await file.read({ length: extrafieldslen, exactLength: true, position });
  if (readres.bytesRead !== extrafieldslen)
    throw new Error(`Unexpected end of file while reading extra fields at ${position}`);

  let pos = 0;
  const extrafields: ExtraFields = [];
  while (pos + zip64ExtraFieldsHeader.size <= extrafieldslen) {
    const headerData = readres.buffer.subarray(pos, pos + zip64ExtraFieldsHeader.size);
    const header = readStructFields(zip64ExtraFieldsHeader.struct, headerData, 0);

    const newpos = pos + zip64ExtraFieldsHeader.size + header.size;
    if (newpos > extrafieldslen)
      break;

    const data = readres.buffer.subarray(pos + zip64ExtraFieldsHeader.size, pos + zip64ExtraFieldsHeader.size + header.size);
    switch (header.fieldtype) {
      case zip64ExtraFieldsZip64ExtendedInformation.fieldType: {
        const fields: Array<typeof zip64ExtraFieldsZip64ExtendedInformation["struct"][number]> = [];
        if (entry.uncompsize === max_uint32_t)
          fields.push({ name: "uncompsize", type: "B" });
        if (entry.compsize === max_uint32_t)
          fields.push({ name: "compsize", type: "B" });
        if (entry.reloffset === max_uint32_t)
          fields.push({ name: "reloffset", type: "B" });
        if (entry.startdisk === max_uint16_t)
          fields.push({ name: "startdisk", type: "L" });

        if (fields.length) {
          const decoded = readStructFields(fields, data, 0);
          extrafields.push({ parsed: true, fieldType: zip64ExtraFieldsZip64ExtendedInformation.fieldType, ...decoded });
        }
      } break;
      case zip64ExtraFieldsInfozipUnicodePath.fieldType: {
        const decoded = readStructFields(zip64ExtraFieldsInfozipUnicodePath.struct, data, 0);
        extrafields.push({ parsed: true, fieldType: header.fieldtype, ...decoded });
      } break;
      case zip64ExtraFieldsInfozipExtendedTimestamps.fieldType: {
        const flags = data[0];

        const fields: Array<typeof zip64ExtraFieldsInfozipExtendedTimestamps["struct"][number]> = [{ name: "flags", type: "C" }];
        if ((flags & 1) !== 0 && data.length >= 5)
          fields.push({ name: "modtime", type: "L" });
        if ((flags & 2) !== 0 && !incentraldirectory)
          fields.push({ name: "accesstime", type: "L" });
        if ((flags & 4) !== 0 && !incentraldirectory)
          fields.push({ name: "creationtime", type: "L" });

        const decoded = readStructFields(fields, data, 0);

        const retval: { parsed: true; fieldType: typeof zip64ExtraFieldsInfozipExtendedTimestamps.fieldType; modtime?: Date; accesstime?: Date; creationtime?: Date } = { parsed: true, fieldType: header.fieldtype };
        if (decoded.modtime)
          retval.modtime = new Date(decoded.modtime * 1000);
        if (decoded.accesstime)
          retval.accesstime = new Date(decoded.accesstime * 1000);
        if (decoded.creationtime)
          retval.creationtime = new Date(decoded.creationtime * 1000);
        extrafields.push(retval);
      } break;
      default: {
        extrafields.push({ parsed: false, fieldType: header.fieldtype, data });
      }
    }

    pos += zip64ExtraFieldsHeader.size + header.size;
  }
  return extrafields;
}


async function readCentralDirectoryHeader(file: RandomAccessReadStream, position: number) {
  const data = await readStruct(file, position, zipCentralDirectoryHeader, { name: "central directory header" });
  position += zipCentralDirectoryHeader.size;
  const name = await file.read({ length: data.filenamelen, position, exactLength: true });
  position += data.filenamelen;
  const extrafields = await readExtraFields(file, position, data, data.extralen, true);
  position += data.extralen;
  const comment = await file.read({ length: data.commentln, exactLength: true, position });
  position += data.commentln;
  return { ...data, extrafields, name: name.buffer, comment: buf2txt(comment.buffer.slice(0, comment.bytesRead)), nextPosition: position };
}

async function readLocalFileHeader(file: RandomAccessReadStream, position: number) {
  const data = await readStruct(file, position, zipLocalFileHeader, { name: "local file header" });
  position += zipLocalFileHeader.size;
  const name = await file.read({ length: data.filenamelen, position, exactLength: true });
  position += data.filenamelen;
  const extrafields = await readExtraFields(file, position, data, data.extralen, false);
  position += data.extralen;
  return { ...data, extrafields, name: name.buffer, nextPosition: position };
}

type RawEntries = Array<{
  modtime: Date;
  type: "file" | "folder";
  size: number;
  name: string;
  reloffset: number;
  compsize: number;
  crc32: number;
}>;

export class ZipArchiveReader {
  #stream: RandomAccessReadStream;

  #checkCrc: boolean;

  #rawEntries: RawEntries = [];

  /** List of entries in the ZIP file, in order read from ZIP central directory
       cell(string) fullpath Full path
       cell(string) Directory of the entry (without the name)
       cell(string) File/directory name
       cell(string) type File type (0=directory, 1=file)
       cell(datetime) modtime Modification date
       cell(integer64) size File size
  */
  readonly entries: Array<{
    fullPath: string;
    directory: string;
    name: string;
    type: "folder";
    modTime: Temporal.Instant;
    size: number;
  } | {
    fullPath: string;
    directory: string;
    name: string;
    type: "file";
    modTime: Temporal.Instant;
    size: number;
  }> = [];

  readonly comment: string;

  private constructor(stream: RandomAccessReadStream, rawentries: RawEntries, entries: typeof this.entries, comment: string, checkCrc: boolean) {
    this.#stream = stream;
    this.#checkCrc = checkCrc;
    this.#rawEntries = rawentries;
    this.entries = entries;
    this.comment = comment;
  }

  static async fromDisk(diskPath: string, options?: { checkCrc?: boolean }) {
    const str = await RandomAccessReadStream.fromDisk(diskPath);
    return ZipArchiveReader.from(str, options);
  }

  static async from(data: RandomAccessReadStreamSource | RandomAccessReadStream, options?: { checkCrc?: boolean }) {
    const stream = "read" in data ? data : await RandomAccessReadStream.from(data);
    try {
      const rawentries: RawEntries = [];
      const entries: ZipArchiveReader["entries"] = [];

      const pos_eodr = await findEndOfDirectoryRecord(stream);
      if (pos_eodr === -1)
        throw new Error("The file passed to the ZIP archive reader is not a valid ZIP file");

      const eodr = await readEndOfDirectory(stream, pos_eodr);
      let zip64eodr;

      if (eodr.disknumber !== 0 || eodr.dirdisk !== 0)
        throw new Error("Multi-disk ZIP archives are not supported");

      if (pos_eodr > 20) {
        const zip64eodl = await readZip64EndOfDirectoryLocator(stream, pos_eodr - 20);
        if (zip64eodl) {
          if (zip64eodl.dirdisk !== 0 || zip64eodl.totaldisks !== 1)
            throw new Error("Multi-disk ZIP archives are not supported");

          zip64eodr = await readZip64EndOfDirectoryRecord(stream, zip64eodl.reloffset);
          if (zip64eodr.dirdisk !== 0 || zip64eodr.disknumber !== 0)
            throw new Error("Multi-disk ZIP archives are not supported");
        }
      }

      const comment = eodr.comment;
      const locinfo = { ...eodr, ...zip64eodr };

      let entryPosition = Number(locinfo.reloffset);

      for (let i = 0; i < locinfo.direntries; i++) {
        const header = await readCentralDirectoryHeader(stream, entryPosition);
        entryPosition = header.nextPosition;

        const rawentry: RawEntries[number] = {
          modtime: readDOSDateTime(header.mod_date, header.mod_time),
          type: "file",
          size: header.uncompsize,
          name: "",
          reloffset: header.reloffset,
          compsize: header.compsize,
          crc32: header.crc32,
        };

        if (!(header.bitflags & zip_generalpurposeflags_languageencoding) || !isValidUTF8(header.name))
          rawentry.name = decodeCP437(header.name);
        else
          rawentry.name = buf2txt(header.name);


        for (const field of header.extrafields) {
          if (!field.parsed)
            continue;
          switch (field.fieldType) {
            case zip64ExtraFieldsInfozipUnicodePath.fieldType: {
              const org_filename_crc = platformSupport.crc32(header.name, 0);
              if (org_filename_crc === field.crc32)
                rawentry.name = buf2txt(field.name);
            } break;
            case zip64ExtraFieldsZip64ExtendedInformation.fieldType: {
              if (field.compsize)
                rawentry.compsize = Number(field.compsize);
              if (field.uncompsize)
                rawentry.size = Number(field.uncompsize);
              if (field.reloffset)
                rawentry.reloffset = Number(field.reloffset);
            } break;
            case zip64ExtraFieldsInfozipExtendedTimestamps.fieldType: {
              if (field.modtime)
                rawentry.modtime = field.modtime;
            } break;
          }
        }

        //safely handle backslashes, if any
        rawentry.name = rawentry.name.replace(/\\/g, "/");

        // if the filename ends in '/' then it's a directory...
        if (rawentry.name.endsWith("/"))
          rawentry.type = "folder";

        // remove dangerous components from the name
        rawentry.name = collapsePathString(rawentry.name);

        // convert absolute names to relative ones
        while (rawentry.name.startsWith("/"))
          rawentry.name = rawentry.name.slice(1);

        const spos = rawentry.type === "folder"
          ? rawentry.name.length
          : rawentry.name.lastIndexOf("/");

        entries.push({
          fullPath: rawentry.name,
          directory: spos >= 0 ? rawentry.name.slice(0, spos) : "",
          name: rawentry.name.slice(spos + 1),
          type: rawentry.type,
          modTime: rawentry.modtime.toTemporalInstant(),
          size: rawentry.size,
        });

        rawentries.push(rawentry);
      }

      rawentries.sort((a, b) => a.name === b.name ? 0 : a.name > b.name ? 1 : -1);
      return new ZipArchiveReader(stream, rawentries, entries, comment, options?.checkCrc ?? true);
    } catch (e) {
      await stream.close();
      throw e;
    }
  }

  readFileStream(fullpath: string, options: { checkCrc?: boolean; allowMissing: true }): ReadableStream<Uint8Array> | null;
  readFileStream(fullpath: string, options?: { checkCrc?: boolean; allowMissing?: boolean }): ReadableStream<Uint8Array>;

  readFileStream(fullpath: string, options?: { checkCrc?: boolean; allowMissing?: boolean }): ReadableStream<Uint8Array> | null {
    const rawentry = this.#rawEntries.find(entry => entry.name === fullpath);
    if (!rawentry) {
      if (options?.allowMissing)
        return null;
      throw new Error(`No such file ${JSON.stringify(fullpath)} in this archive`);
    }

    // This is set up a bit convoluted, but we'd like to set return a ReadableStream directly instead of a promise
    let expectedSize = -1, expectedCrc = -1;

    let realCrc32 = 0;
    let realSize = 0;
    const checkCrc = this.#checkCrc;
    const checkCRCAndLength = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (checkCrc)
          realCrc32 = platformSupport.crc32(chunk, realCrc32);
        realSize += chunk.length;
        controller.enqueue(chunk);
      },
      flush(controller) {
        if (checkCrc && realCrc32 !== expectedCrc)
          throw new Error(`CRC32 mismatch when decompressing file from ZIP archive for file ${JSON.stringify(fullpath)}`);
        if (realSize !== expectedSize)
          throw new Error(`Size mismatch when decompressing file from ZIP archive for file ${JSON.stringify(fullpath)}`);
      }
    });

    this.#getFileStream(rawentry, options).then(async ({ stream, size, crc32 }) => {
      expectedCrc = crc32;
      expectedSize = size;
      await stream.pipeTo(checkCRCAndLength.writable);
    }).catch(e => {
      checkCRCAndLength.writable.abort(e).catch(_ => {
        console.error(`error setting error to ZIP result stream`, _, `, underlying error`, e);
      });
    });

    return checkCRCAndLength.readable;
  }

  async #getFileStream(rawentry: RawEntries[number], options?: { checkCrc?: boolean; allowMissing?: boolean }): Promise<{ stream: ReadableStream<Uint8Array>; size: number; crc32: number }> {
    const localheader = await readLocalFileHeader(this.#stream, rawentry.reloffset);

    for (const field of localheader.extrafields) {
      if (!field.parsed)
        continue;
      switch (field.fieldType) {
        case zip64ExtraFieldsZip64ExtendedInformation.fieldType: {
          if (field.compsize)
            localheader.compsize = Number(field.compsize);
          if (field.uncompsize)
            localheader.uncompsize = Number(field.uncompsize);
        } break;
      }
    }

    if ((localheader.bitflags & zip_generalpurposeflags_withdatadescriptor) !== 0) {
      localheader.compsize = rawentry.compsize;
      localheader.crc32 = rawentry.crc32;
      localheader.uncompsize = rawentry.size;
    }

    const compresseddata = this.#stream.stream({ start: localheader.nextPosition, end: localheader.nextPosition + localheader.compsize });

    let retval: ReadableStream<Uint8Array>;
    switch (localheader.compmethod) {
      case zip_compressionmethod_store:
        retval = compresseddata;
        break;
      case zip_compressionmethod_deflate: {
        // NOTE: in node.js, this seems to keep an infinite queue without applying backpressure
        retval = compresseddata.pipeThrough<Uint8Array>(new DecompressionStream("deflate-raw"));
      } break;
      default:
        throw new Error(`Unsupported ZIP compression method ${localheader.compmethod} for file ${JSON.stringify(rawentry.name)}`);
    }

    return {
      stream: retval,
      size: localheader.uncompsize,
      crc32: localheader.crc32
    };
  }

  async readFile(fullpath: string, options: { checkCrc?: boolean; allowMissing: true }): Promise<Blob | null>;
  async readFile(fullpath: string, options?: { checkCrc?: boolean; allowMissing?: boolean }): Promise<Blob>;

  async readFile(fullpath: string, options?: { checkCrc?: boolean; allowMissing?: boolean }): Promise<Blob | null> {
    const stream = this.readFileStream(fullpath, options);
    if (!stream)
      return null;
    return streamIntoBlob(stream);
  }
}
