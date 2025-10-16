import { ZipArchiveWriter, type ZipArchiveWriterOptions, type ValidZipDateTimeSources } from "./writer";
import { ReadableStream } from "node:stream/web";



type CreateArchiveSource = {
  build(controller: CreateArchiveController): Promise<void>;

  options?: ZipArchiveWriterOptions;
};

class CreateArchiveController {
  #writer: ZipArchiveWriter;

  constructor(writer: ZipArchiveWriter) {
    this.#writer = writer;
  }

  /** Adds a folder to the archive, returns when the folder data has been streamed to the archive stream */
  async addFolder(fullPath: string, modTime: ValidZipDateTimeSources | null): Promise<void> {
    return await this.#writer.addFolder(fullPath, modTime).written;
  }

  /** Adds a file to the archive, returns when the file data has been streamed to the archive stream */
  async addFile(name: string, data: string | Blob | Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>, modTime: ValidZipDateTimeSources | null, options?: { compressionLevel?: number }): Promise<void> {
    return await this.#writer.addFile(name, data, modTime, options).written;
  }
}

export { type CreateArchiveController, type ValidZipDateTimeSources, type CreateArchiveSource };

/** Creates a new ZIP archive.
 * #example
 * ```ts
 * const archive = createArchive({
 *   build: async (controller) => {
 *     await controller.addFolder("test", null);
 *     await controller.addFile("test/test.txt", "Hello World", null);
 *   }
 * });
 * ```
 */
export function createArchive(source: CreateArchiveSource): ReadableStream<Uint8Array<ArrayBuffer>> {
  const writer = new ZipArchiveWriter(source.options);
  const itr = writer.stream[Symbol.asyncIterator]();

  return new ReadableStream({
    start(controller) {
      const zipController = new CreateArchiveController(writer);
      source.build(zipController).then(async () => {
        await writer.finalize();
      }, async (e) => {
        controller.error(e);
        await writer[Symbol.asyncDispose]();
      });
    },
    async pull(controller) {
      try {
        const res = await itr.next();
        if (res.done) {
          controller.close();
          await writer[Symbol.asyncDispose]();
        } else {
          controller.enqueue(res.value);
        }
      } catch (e) {
        controller.error(e);
      }
    }
  });
}
