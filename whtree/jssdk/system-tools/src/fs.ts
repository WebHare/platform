import { appendToArray, generateRandomId, regExpFromWildcards } from "@webhare/std";
import { constants, unlinkSync, type Dirent } from "node:fs";
import { copyFile, link, mkdir, open, type FileHandle, rename, unlink, readdir, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, parse } from "node:path";
import type Stream from "node:stream";
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

class ListDirectoryEntry {
  readonly type: "file" | "directory" | "symboliclink" | "socket" | null;
  readonly name;
  /** Full path to file */
  readonly fullPath;
  /** Relative path from listDirectory's starting point */
  readonly subPath;

  constructor(d: Dirent, subPath: string) {
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
    this.subPath = subPath;
    this.fullPath = join(d.parentPath, d.name);
  }
}

export interface StoreDiskFileOptions {
  /** Overwrite if the file already exists? (otherwise we would throw) */
  overwrite?: boolean;
  /** Create/overwrite the file in place. Normally, a temporary file is generated first to allow atomic replacement */
  inPlace?: boolean;
  /** Create parent directory recursively if it doesn't exist */
  mkdir?: boolean;
  /** Update only if the file has changed. This takes a bit more time but prevents triggering watchers or updating timestamps. Currently only supported for strings */
  onlyIfChanged?: boolean;
  /** File mode (permissions) to set as an octal string, eg "600" or "0644". Applied to the file handle before any data
   *  is written, and not limited by the process umask. If not set, new files get the default mode and existing files
   *  overwritten in place keep their mode. Note that an existing file overwritten with inPlace: true may already be
   *  open by others, so don't combine mode with inPlace when protecting sensitive data */
  mode?: string;
}

function parseFileMode(mode: string): number {
  if (!/^0?[0-7]{3}$/.test(mode))
    throw new Error(`Invalid file mode '${mode}', expected an octal string such as '600' or '0644'`);
  return parseInt(mode, 8);
}

export type StoreDiskFileSource = string | ArrayBuffer | Uint8Array | Buffer | Stream.Readable | ReadableStream<Uint8Array<ArrayBuffer>> | Blob;

/** Store a file to disk (atomically if possible)
 *
 * Does not replace an existing file unless explicitly specified with overwrite: true.
 * If overwrite is set, inplace is not set, and the filename length is shorter than 230 bytes, a temporary file will be created and moved over the original to ensure an atomic replace
 *
    @param path - Path to the file to create.
    @param data - Blob to write
    @returns \{ skipped: true \} if onlyIfChanged was set and the file was already up-to-date
*/
export async function storeDiskFile(path: string, data: StoreDiskFileSource, options?: StoreDiskFileOptions): Promise<{ skipped: boolean }> {
  const mode = options?.mode !== undefined ? parseFileMode(options.mode) : undefined;
  const usetemp = parse(path).base.length < 230 && !options?.inPlace;
  let writepath = usetemp ? path + ".tmp" + generateRandomId() : null;
  if (options?.onlyIfChanged) { //we'll check the content of any existing target first
    if (typeof data !== "string")
      throw new Error("onlyIfChanged is currently only supported for string data");
    let current: FileHandle | null = null;
    try {
      current = await open(path, "r");
    } catch (err) {
      if ((err as { code: string })?.code !== "ENOENT")
        throw err;
    }
    if (current) {
      try {
        if (await current.readFile('utf-8') === data) {
          //Content is up-to-date, but the mode may not be. Fix it through the same handle we verified the content with
          if (mode !== undefined && ((await current.stat()).mode & 0o7777) !== mode)
            await current.chmod(mode);
          return { skipped: true }; //done!
        }
      } finally {
        await current.close();
      }
    }
  }

  /* To provide both the atomicity guarantee of inplace := FALSE and the exlusive-create guarantee of overwrite := FALSE
     we need to hold handles to both versions */
  let reservefile: FileHandle | null = null;

  try {
    if (options?.mkdir)
      await mkdir(parse(path).dir, { recursive: true });

    if (usetemp && !options?.overwrite) {
      reservefile = await open(path, "ax", mode); //ax = append exclusive (prevent truncation). it stays empty and is replaced by the rename
    }

    const writeData =
      (typeof data === "object" && "stream" in data) ? data.stream() as unknown as NodeReadableStream<Uint8Array>
        : data instanceof ArrayBuffer ? Buffer.from(data)
          : data instanceof Uint8Array ? Buffer.from(data)
            : typeof data === "string" ? data
              : data as unknown as NodeReadableStream<Uint8Array>; //workaround for recent TS type incompatibility
    /* Passing mode to open() makes the file get created with (mode & ~umask), which is never more permissive than mode,
       so there's no window in which others can open it with broader permissions. We then chmod the handle (not the path,
       which could have been swapped) to get the exact mode, and to fix existing files overwritten in place.
       The temporary file is always created exclusively, so we never write into a file someone else created (and may have open) */
    const fh = await open(writepath ?? path, writepath || !options?.overwrite ? "wx" : "w", mode);
    try {
      if (mode !== undefined)
        await fh.chmod(mode);
      await fh.writeFile(writeData);
    } finally {
      await fh.close();
    }

    if (writepath) {
      await rename(writepath, path);
      writepath = null;
    }
  } finally {
    //cleanup, ignore errors at this point
    if (reservefile) {
      try {
        // check if the current file is the same as the reserved file (ie. we created it) and delete it if so
        const reserveStat = await reservefile.stat();
        const targetStat = await stat(path);
        if (reserveStat.dev === targetStat.dev && reserveStat.ino === targetStat.ino) {
          // dev and inode are the same, so we created the file and need to delete it
          await unlink(path);
        }
      } catch (err) { /* ignore */ }
      reservefile.close().catch(function () {/*ignore*/ });
    }
    if (writepath)
      unlink(writepath).catch(function () {/*ignore*/ });
  }
  return { skipped: false };
}

export interface StoreTempFileOptions {
  /** Directory to create the file in. Defaults to the system's temporary directory */
  dir?: string;
  /** File mode (permissions) as an octal string. Defaults to "600" (only readable and writable by the current user) */
  mode?: string;
}

/** Temporary files that haven't been removed yet */
const liveTempFiles = new Set<TempFile>();
/** Signals that terminate the process by default, and after which we should clean up */
const cleanupSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

function removeLiveTempFiles() {
  for (const file of liveTempFiles)
    try {
      file[Symbol.dispose]();
    } catch {
      //ignore, we're terminating and can't do anything about it
    }
}

function onCleanupSignal(signal: NodeJS.Signals) {
  /* If someone else also handles this signal, they decide whether the process ends (and our exit handler will clean up
     if it does). Otherwise the signal would have terminated us: clean up and let it terminate us anyway */
  if (process.listenerCount(signal) > 1)
    return;

  removeLiveTempFiles();
  setCleanupHandlers(false);
  process.kill(process.pid, signal);
}

/** Only keep our handlers installed while there are temporary files, so we don't change signal handling otherwise */
function setCleanupHandlers(install: boolean) {
  for (const signal of cleanupSignals)
    if (install)
      process.on(signal, onCleanupSignal);
    else
      process.off(signal, onCleanupSignal);

  if (install)
    process.on("exit", removeLiveTempFiles);
  else
    process.off("exit", removeLiveTempFiles);
}

function trackTempFile(file: TempFile) {
  if (!liveTempFiles.size)
    setCleanupHandlers(true);
  liveTempFiles.add(file);
}

function untrackTempFile(file: TempFile) {
  if (liveTempFiles.delete(file) && !liveTempFiles.size)
    setCleanupHandlers(false);
}

/** A temporary file created by storeTempFile. Removed when disposed, or when the process exits or is terminated by SIGINT, SIGTERM or SIGHUP */
export class TempFile implements AsyncDisposable, Disposable {
  #removed = false;
  #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  /** Full path to the temporary file (or its final location after moveTo) */
  get path(): string {
    return this.#path;
  }

  /** Move the file to its final location. It's then no longer a temporary file: it won't be removed on dispose or exit
      @param destination - New path for the file, including its name
      @param options - overwrite: Replace an existing file at the destination (otherwise we throw if it exists)
  */
  async moveTo(destination: string, options?: { overwrite?: boolean }): Promise<void> {
    if (this.#removed)
      throw new Error(`Temporary file '${this.#path}' has already been removed or moved`);

    if (options?.overwrite) {
      try {
        await rename(this.#path, destination); //atomically replaces any existing file
      } catch (err) {
        if ((err as { code?: string })?.code !== "EXDEV")
          throw err;
        await copyFile(this.#path, destination); //different filesystem
        await unlink(this.#path);
      }
    } else {
      try {
        await link(this.#path, destination); //fails if the destination exists, unlike rename
      } catch (err) {
        if ((err as { code?: string })?.code !== "EXDEV")
          throw err;
        await copyFile(this.#path, destination, constants.COPYFILE_EXCL); //different filesystem
      }
      await unlink(this.#path);
    }

    this.#path = destination;
    this.#removed = true; //no longer ours to remove
    untrackTempFile(this);
  }

  /** Remove the temporary file now. Does nothing if it was already removed */
  async unlink(): Promise<void> {
    if (this.#removed)
      return;
    let error: Error | null = null;
    try {
      await unlink(this.#path);
    } catch (err) {
      error = err as Error;
    }
    this.#markRemoved(error);
  }

  async [Symbol.asyncDispose]() {
    await this.unlink();
  }

  [Symbol.dispose]() {
    if (this.#removed)
      return;
    let error: Error | null = null;
    try {
      unlinkSync(this.#path);
    } catch (err) {
      error = err as Error;
    }
    this.#markRemoved(error);
  }

  /** Process the result of an unlink attempt. Only consider the file removed if the unlink worked (or it was already gone), so a failed removal can be retried */
  #markRemoved(error: Error | null) {
    if (error && (error as Error & { code?: string }).code !== "ENOENT")
      throw error;
    this.#removed = true;
    untrackTempFile(this);
  }
}

/** Build a unique filename by inserting a random part before the first dot (not counting a leading dot) */
function getTempFileName(name: string): string {
  const randomPart = generateRandomId();
  if (!name)
    return randomPart;
  const dotPos = name.indexOf(".", 1);
  return dotPos < 0 ? `${name}-${randomPart}` : `${name.substring(0, dotPos)}-${randomPart}${name.substring(dotPos)}`;
}

/** Store data in a new temporary file, which is removed when the returned object is disposed
 *
 * The file is created exclusively (never reusing an existing file) and with its permissions already set, so no one else
 * can open it before or while it's written. Use it with `await using` (or `using`) to have the file removed automatically.
 *
 * Files that haven't been removed yet are also removed when the process exits, or when it's terminated by SIGINT, SIGTERM
 * or SIGHUP. While temporary files exist, a handler is installed for these signals. If no other handler exists for the
 * signal, it removes the files and then lets the signal terminate the process as it would have. If another handler exists,
 * that handler decides whether the process exits, and the files are removed when it does. Files aren't removed if the
 * process is killed with SIGKILL or crashes.
 *
 *
 * ```typescript
 * await using tempFile = await storeTempFile("entity-1.yml", yaml);
 * spawnSync("vi", [tempFile.path], { stdio: "inherit" });
 * ```
 *
    @param name - Filename to base the temporary file's name on. A random part is inserted before the first dot,
                  so `test.screens.yml` becomes eg. `test-<random>.screens.yml`. It may not contain a directory
    @param data - Data to write
    @returns The temporary file. Its `path` is the full path to the file, `unlink()` removes it immediately and `moveTo()`
             moves it to its final location (after which it's no longer removed automatically)
*/
export async function storeTempFile(name: string, data: StoreDiskFileSource, options?: StoreTempFileOptions): Promise<TempFile> {
  if (basename(name) !== name || name === "." || name === "..")
    throw new Error(`Invalid temporary file name '${name}', it should not contain a directory`);

  const tempFile = new TempFile(join(options?.dir ?? tmpdir(), getTempFileName(name)));
  trackTempFile(tempFile); //before writing, so we also clean up if we're terminated while writing
  try {
    //storeDiskFile removes the file itself if writing fails, and won't overwrite an existing file
    await storeDiskFile(tempFile.path, data, { mode: options?.mode ?? "600" });
  } catch (err) {
    untrackTempFile(tempFile);
    throw err;
  }
  return tempFile;
}

async function doReadDir(basepath: string, subpath: string, allowMissing: boolean, recursive: boolean, mask: RegExp | undefined, skip: RegExp | undefined): Promise<ListDirectoryEntry[]> {
  const direntries: ListDirectoryEntry[] = [];
  const subdirs: string[] = [];
  try {
    for (const entry of await readdir(join(basepath, subpath), { withFileTypes: true })) {
      if (skip && skip.test(entry.name))
        continue; //we don't even recurse into these
      if (!mask || mask.test(entry.name))
        direntries.push(new ListDirectoryEntry(entry, join(subpath, entry.name)));
      if (recursive && entry.isDirectory())
        subdirs.push(entry.name);
    }
  } catch (err) {
    if (allowMissing && (err as { code: string })?.code === "ENOENT")
      return [];

    throw err;
  }

  for (const subdir of subdirs) //they were only gathered if recursive === true
    appendToArray(direntries, await doReadDir(basepath, join(subpath, subdir), false, true, mask, skip));
  return direntries;
}

/** List a directory, recursive
 * @param basepath - Starting path. Can be absolute or relative to the current working directory. The returned fullPaths will be absolute, and the subPaths will be relative to this basepath
 * @param options.allowMissing - If true, a missing directory will be treated as an empty directory instead of throwing an error
 * @param options.recursive - If true, subdirectories will be listed as well. The returned entries will have their subPath relative to the basepath
 * @param options.mask - If set, only entries with a name matching the mask (string with wildcards or RegExp) will be returned
 * @param options.skip - If set, entries with a name matching the skip mask (string with wildcards or RegExp) will be ignored, and directories masking the name will not be recursed into
 * @returns An array of directory entries. Each entry has a name, type, fullPath, and subPath (relative to the basepath)
 */
export async function listDirectory(basepath: string, options?: {
  allowMissing?: boolean;
  recursive?: boolean;
  mask?: string | RegExp;
  skip?: string | RegExp;
}): Promise<ListDirectoryEntry[]> {
  const mask = typeof options?.mask === "string" ? regExpFromWildcards(options?.mask) : options?.mask;
  const skip = typeof options?.skip === "string" ? regExpFromWildcards(options?.skip) : options?.skip;
  if (!isAbsolute(basepath))
    basepath = join(process.cwd(), basepath); //ensure stable fullPaths

  return await doReadDir(basepath, "", options?.allowMissing || false, options?.recursive || false, mask, skip);
}

interface DeleteRecursiveOptions {
  /** A function that returns true if the file should be kept */
  keep?: (file: ListDirectoryEntry) => boolean;
  /** If true, the basepath itself will be deleted if it is empty */
  deleteSelf?: boolean;
  /** Log what will be deleted */
  verbose?: boolean;
  /** Log what will be kept */
  showUnchanged?: boolean;
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
    if (!keepit && options?.verbose)
      console.log(`Deleting ${isdir ? "directory" : "file"} ${item.fullPath}`);
    if (keepit && options?.showUnchanged)
      console.log(`Keeping ${isdir ? "directory" : "file"} ${item.fullPath}`);
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
