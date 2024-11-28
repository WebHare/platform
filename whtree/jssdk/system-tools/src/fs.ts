import { generateRandomId } from "@webhare/std";
import type { Dirent } from "node:fs";
import { open, type FileHandle, rename, unlink, readdir, rmdir, writeFile } from "node:fs/promises";
import { join, parse } from "node:path";
import type { Stream } from "node:stream";
import type { ReadableStream } from "node:stream/web";

export interface StoreDiskFileOptions {
  ///Overwrite if the file already exists? (other we would throw)
  overwrite?: boolean;
  ///Create/overwrite the file in place. Normally, a temporary file is generated first to allow atomic replacement
  inPlace?: boolean;
}

/** Store a file to disk (atomically if possible)
 *
 * Does not replace an existing file unless explicitly specified with overwrite: true.
 * If overwrite is set, inplace is not set, and the filename length is shorter than 230 bytes, a temporary file will be created and moved over the original to ensure an atomic replace
 *
    @param path - Path to the file to create.
    @param data - Blob to write
*/
export async function storeDiskFile(path: string, data: string | Buffer | Stream | ReadableStream<Uint8Array> | Blob, options?: StoreDiskFileOptions) {
  const usetemp = parse(path).base.length < 230 && !options?.inPlace;
  let writepath = usetemp ? path + ".tmp" + generateRandomId() : null;

  /* To provide both the atomicity guarantee of inplace := FALSE and the exlusive-create guarantee of overwrite := FALSE
     we need to hold handles to both versions */
  let reservefile: FileHandle | null = null;
  if (usetemp && !options?.overwrite) {
    reservefile = await open(path, "ax"); //ax = append exclusive (prevent truncation)
  }

  try {
    await writeFile(writepath ?? path, (typeof data === "object" && "stream" in data) ? data.stream() : data, { flag: options?.overwrite ? "w" : "wx" });
    if (writepath) {
      await rename(writepath, path);
      writepath = null;
    }
  } finally {
    //cleanup, ignore errors at this point
    reservefile?.close().catch(function () {/*ignore*/ });
    if (writepath)
      unlink(writepath).catch(function () {/*ignore*/ });
  }
}

async function readDirRecursiveDeeper(basepath: string, subpath: string, allowMissing?: boolean): Promise<Dirent[]> {
  const direntries = [];
  try {
    direntries.push(...await readdir(join(basepath, subpath), { withFileTypes: true }));
  } catch (err) {
    if (allowMissing && (err as { code: string })?.code === "ENOENT")
      return [];

    throw err;
  }

  for (const item of direntries.filter(_ => _.isDirectory()))
    direntries.push(...await readDirRecursiveDeeper(basepath, join(subpath, item.name), allowMissing));
  return direntries;
}

/** Read a directory, recursive */
export async function readDirRecursive(basepath: string, { allowMissing }: { allowMissing?: boolean } = {}): Promise<Dirent[]> {
  return await readDirRecursiveDeeper(basepath, "", allowMissing);
}

interface DeleteRecursiveOptions {
  /** A function that returns true if the file should be kept */
  keep?: (file: Dirent) => boolean;
  /** If true, the basepath itself will be deleted if it is empty */
  deleteSelf?: boolean;
  /** Log what would be deleted or kept */
  verbose?: boolean;
  /** Don't actually delete anything */
  dryRun?: boolean;
  /** Ignore missing directory entries */
  allowMissing?: boolean;
}

async function deleteRecursiveDeeper(basepath: string, subpath: string, options?: DeleteRecursiveOptions): Promise<boolean> {
  const direntries = [];
  try {
    direntries.push(...await readdir(join(basepath, subpath), { withFileTypes: true }));
  } catch (err) {
    if (options?.allowMissing && (err as { code: string })?.code === "ENOENT")
      return true;

    throw err;
  }

  let allgone = true;
  for (const item of direntries) {
    const isdir = item.isDirectory();
    const keepit = options?.keep?.(item) || (isdir && !await deleteRecursiveDeeper(basepath, join(subpath, item.name), options));
    if (options?.verbose)
      console.log(`${keepit ? "Keeping" : "Deleting"} ${isdir ? "directory" : "file"} ${join(basepath, subpath, item.name)}`);
    if (keepit) {
      allgone = false;
      continue;
    }

    if (!options?.dryRun) {
      try {
        await (isdir ? rmdir : unlink)(join(basepath, subpath, item.name));
      } catch (err) {
        if (options?.allowMissing && (err as { code: string })?.code === "ENOENT")
          continue;

        throw err;
      }
    }
  }
  return allgone;
}

/** Delete the contents of a directory
 * @param basepath - Starting path
 * @returns true if the basepath is now empty, false if we had to keep things
 */
export async function deleteRecursive(basepath: string, options?: DeleteRecursiveOptions): Promise<boolean> {
  //TODO should we be throwing on nonexistent files/dirs or just ignore that? (ie. gone=gone)
  const allgone = await deleteRecursiveDeeper(basepath, '', options);
  if (allgone && options?.deleteSelf) {
    try {
      await rmdir(basepath);
    } catch (err) {
      if (options?.allowMissing && (err as { code: string })?.code === "ENOENT")
        return true;

      throw err;
    }
  }

  return allgone;
}
