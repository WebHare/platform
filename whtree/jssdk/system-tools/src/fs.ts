import { generateRandomId } from "@webhare/std";
import { open, FileHandle, rename, unlink } from "node:fs/promises";
import { parse } from "node:path";

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
export async function storeDiskFile(path: string, data: string | Buffer, options?: StoreDiskFileOptions) {
  const usetemp = parse(path).base.length < 230 && !options?.inPlace;
  let writepath = usetemp ? path + ".tmp" + generateRandomId() : null;

  /* To provide both the atomicity guarantee of inplace := FALSE and the exlusive-create guarantee of overwrite := FALSE
     we need to hold handles to both versions */
  let reservefile: FileHandle | null = null;
  let newfile: FileHandle | null = null;
  if (usetemp && !options?.overwrite) {
    reservefile = await open(path, "ax"); //ax = append exclusive (prevent truncation)
  }

  try {
    newfile = await open(writepath ?? path, options?.overwrite ? "w" : "wx");
    await newfile.writeFile(data);
    await newfile.close();
    newfile = null;

    if (writepath) {
      await rename(writepath, path);
      writepath = null;
    }
  } finally {
    //cleanup, ignore errors at this point
    newfile?.close().catch(function () {/*ignore*/ });
    reservefile?.close().catch(function () {/*ignore*/ });
    if (writepath)
      unlink(writepath).catch(function () {/*ignore*/ });
  }
}
