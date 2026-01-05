import { ZipArchiveReader } from "./reader.ts";
import type { RandomAccessReadStreamSource, RandomAccessReadStream } from "./randomaccessstream.ts";

type ArchiveEntry = ZipArchiveReader["entries"][number];

class UnpackArchiveEntry {
  readonly fullPath: string;
  readonly directory: string;
  readonly name: string;
  readonly type: "folder" | "file";
  readonly modTime: Temporal.Instant;

  constructor(entry: ArchiveEntry) {
    this.fullPath = entry.fullPath;
    this.directory = entry.directory;
    this.name = entry.name;
    this.type = entry.type;
    this.modTime = entry.modTime;
  }
}

class UnpackArchiveDirectory extends UnpackArchiveEntry {
  declare type: "folder";

  constructor(entry: ArchiveEntry & { type: "folder" }) {
    super(entry);
  }
}

class UnpackArchiveFile extends UnpackArchiveEntry {
  declare type: "file";

  #reader: ZipArchiveReader;

  readonly size: number;

  constructor(entry: ArchiveEntry & { type: "file" }, reader: ZipArchiveReader) {
    super(entry);
    this.size = entry.size;
    this.#reader = reader;
  }

  stream(): ReadableStream<Uint8Array> {
    return this.#reader.readFileStream(this.fullPath);
  }

  blob(): Promise<Blob> {
    return this.#reader.readFile(this.fullPath);
  }

  async text(): Promise<string> {
    return (await this.blob()).text();
  }

  async bytes(): Promise<Uint8Array> {
    return new Uint8Array(await this.arrayBuffer());
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return (await this.blob()).arrayBuffer();
  }
}

export type UnpackArchiveResult = Array<UnpackArchiveDirectory | UnpackArchiveFile>;

export type { UnpackArchiveDirectory, UnpackArchiveFile };

export async function unpackArchive(archiveData: RandomAccessReadStreamSource | RandomAccessReadStream, options: { checkCrc?: boolean } = {}): Promise<UnpackArchiveResult> {
  const archive = await ZipArchiveReader.from(archiveData, options);
  const retval: Array<UnpackArchiveDirectory | UnpackArchiveFile> = [];
  for (const entry of archive.entries) {
    if (entry.type === "folder")
      retval.push(new UnpackArchiveDirectory(entry));
    else
      retval.push(new UnpackArchiveFile(entry, archive));
  }
  return Promise.all(retval);
}

export async function unpackArchiveFromDisk(path: string, options: { checkCrc?: boolean } = {}): Promise<UnpackArchiveResult> {
  const archive = await ZipArchiveReader.fromDisk(path, options);
  const retval: Array<UnpackArchiveDirectory | UnpackArchiveFile> = [];
  for (const entry of archive.entries) {
    if (entry.type === "folder")
      retval.push(new UnpackArchiveDirectory(entry));
    else
      retval.push(new UnpackArchiveFile(entry, archive));
  }
  return Promise.all(retval);
}
