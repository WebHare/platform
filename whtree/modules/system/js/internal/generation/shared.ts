import { storeDiskFile } from "@webhare/system-tools";
import { existsSync, Dirent } from "node:fs";
import * as fs from "node:fs/promises";

export interface GenerateOptions {
  verbose?: boolean;
}

export type DirItem<O> = {
  type: "file";
  name: string;
  data: O;
} | {
  type: "folder";
  name: string;
  items: Array<DirItem<O>> | null;
  removeother?: boolean;
};

/** Update a file only if it has changed */
async function updateFile(filename: string, defs: string): Promise<boolean> {
  try {
    const current = await fs.readFile(filename, 'utf8');
    if (defs && current === defs) {
      return false;
    }
    if (!defs) {
      // remove the file if none should exist
      await fs.rm(`${filename}`, { force: true });
      return true;
    }
  } catch (e) {
    // file does not exist
    if (!defs)
      return false;
  }

  await storeDiskFile(filename, defs, { overwrite: true });
  return true;
}


export async function updateDir<O>(dir: string, items: Array<DirItem<O>> | null, removeother: boolean, generatecb: (file: string, data: O) => string | Promise<string>) {
  return updateDirInternal<O>(dir, items, "", removeother, generatecb);
}

async function updateDirInternal<O>(dir: string, items: Array<DirItem<O>> | null, path: string, removeother: boolean, generatecb: (file: string, data: O) => string | Promise<string>) {
  let anyupdate = false;
  if (!items) {
    if (await existsSync(dir)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    return;
  }

  await fs.mkdir(dir, { recursive: true });

  let existingfiles: Dirent[] = [];
  if (removeother) {
    try {
      existingfiles = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
    }
  }

  for (const item of items) {
    if (item.type === "file") {
      try {
        const defs = await generatecb(path + item.name, item.data);
        const filename = `${dir}${item.name}`;
        if (await updateFile(filename, defs))
          anyupdate = true;
      } catch (e) {
        console.log(`Error generating file ${path}${item.name}: `, e);
      }
    } else {
      if (await updateDirInternal<O>(`${dir}${item.name}/`, item.items, `${path}${item.name}/`, item.removeother || removeother, generatecb))
        anyupdate = true;
    }
  }

  if (removeother) {
    for (const file of existingfiles) {
      const existingpath = `${dir}${file.name}`;
      if (!items.find(i => i.name === file.name)) {
        // not referenced, should be deleted
        if (file.isDirectory()) {
          await fs.rm(existingpath, { recursive: true, force: true });
          anyupdate = true;
        } else if (file.isFile()) {
          await fs.rm(existingpath, { force: true });
          anyupdate = true;
        }
      }
    }
  }

  return anyupdate;
}
