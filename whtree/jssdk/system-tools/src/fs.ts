import { appendToArray, generateRandomId, regExpFromWildcards } from "@webhare/std";
import type { Dirent } from "node:fs";
import { mkdir, open, type FileHandle, rename, unlink, readdir, rmdir, writeFile } from "node:fs/promises";
import { join, parse } from "node:path";
import type { Stream } from "node:stream";
import type { ReadableStream } from "node:stream/web";

class ListDirectoryEntry {
  readonly type: "file" | "directory" | "symboliclink" | "socket" | null;
  readonly name;
  readonly fullPath;

  constructor(d: Dirent) {
    if (d.isDirectory())
      this.type = "directory";
    else if (d.isFile())
      this.type = "file";
    else if (d.isSymbolicLink())
      this.type = "symboliclink";
    else if (d.isSocket())
      this.type = "socket";
    else
      this.type = null;

    this.name = d.name;
    this.fullPath = join(d.parentPath, d.name);
  }
}

export interface StoreDiskFileOptions {
  /** Overwrite if the file already exists? (other we would throw) */
  overwrite?: boolean;
  /** Create/overwrite the file in place. Normally, a temporary file is generated first to allow atomic replacement */
  inPlace?: boolean;
  /** Create parent directory recursively if it doesn't exist */
  mkdir?: boolean;
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

  try {
    if (options?.mkdir)
      await mkdir(parse(path).dir, { recursive: true });

    if (usetemp && !options?.overwrite) {
      reservefile = await open(path, "ax"); //ax = append exclusive (prevent truncation)
    }

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

async function doReadDir(basepath: string, subpath: string, allowMissing: boolean, recursive: boolean, mask: RegExp | undefined): Promise<ListDirectoryEntry[]> {
  const direntries: ListDirectoryEntry[] = [];
  const subdirs: string[] = [];
  try {
    for (const entry of await readdir(join(basepath, subpath), { withFileTypes: true })) {
      if (!mask || mask.test(entry.name))
        direntries.push(new ListDirectoryEntry(entry));
      if (recursive && entry.isDirectory())
        subdirs.push(entry.name);
    }
  } catch (err) {
    if (allowMissing && (err as { code: string })?.code === "ENOENT")
      return [];

    throw err;
  }

  for (const subdir of subdirs) //they were only gathered if recursive === true
    appendToArray(direntries, await doReadDir(basepath, join(subpath, subdir), false, true, mask));
  return direntries;
}

/** List a directory, recursive */
export async function listDirectory(basepath: string, { allowMissing, recursive, mask }: { allowMissing?: boolean; recursive?: boolean; mask?: string | RegExp } = {}): Promise<ListDirectoryEntry[]> {
  if (typeof mask === "string")
    mask = regExpFromWildcards(mask);

  return await doReadDir(basepath, "", allowMissing || false, recursive || false, mask);
}

interface DeleteRecursiveOptions {
  /** A function that returns true if the file should be kept */
  keep?: (file: ListDirectoryEntry) => boolean;
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
  const direntries = await listDirectory(join(basepath, subpath), { allowMissing: options?.allowMissing });

  let allgone = true;
  for (const item of direntries) {
    const isdir = item.type === "directory";
    const keepit = options?.keep?.(item) || (isdir && !await deleteRecursiveDeeper(basepath, join(subpath, item.name), options));
    if (options?.verbose)
      console.log(`${keepit ? "Keeping" : "Deleting"} ${isdir ? "directory" : "file"} ${item.fullPath}`);
    if (keepit) {
      allgone = false;
      continue;
    }

    if (!options?.dryRun) {
      try {
        await (isdir ? rmdir : unlink)(item.fullPath);
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

export type { ListDirectoryEntry };
