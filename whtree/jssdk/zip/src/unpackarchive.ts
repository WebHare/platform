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

const finishHandler = new FinalizationRegistry<[number, Set<number>, ZipArchiveReader]>((reader) => {
  const [idx, activeFiles, archive] = reader;
  activeFiles.delete(idx);
  if (activeFiles.size === 0)
    void archive[Symbol.asyncDispose]();
});

function constructArray(archive: ZipArchiveReader): UnpackArchiveResult {
  const retval: Array<UnpackArchiveDirectory | UnpackArchiveFile> = [];
  const activeFiles = new Set<number>;
  for (const [idx, entry] of archive.entries.entries()) {
    if (entry.type === "folder")
      retval.push(new UnpackArchiveDirectory(entry));
    else {
      const file = new UnpackArchiveFile(entry, archive);
      activeFiles.add(idx);
      finishHandler.register(file, [idx, activeFiles, archive]);
      retval.push(file);
    }
  }
  return retval;
}

export async function unpackArchive(archiveData: RandomAccessReadStreamSource | RandomAccessReadStream, options: { checkCrc?: boolean } = {}): Promise<UnpackArchiveResult> {
  const archive = await ZipArchiveReader.from(archiveData, options);
  return constructArray(archive);
}

export async function unpackArchiveFromDisk(path: string, options: { checkCrc?: boolean } = {}): Promise<UnpackArchiveResult> {
  const archive = await ZipArchiveReader.fromDisk(path, options);
  return constructArray(archive);
}
