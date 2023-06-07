import fs, { Dirent } from "node:fs";

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
function updateFile(filename: string, defs: string): boolean {
  try {
    const current = fs.readFileSync(filename).toString();
    if (defs && current === defs) {
      return false;
    }
    if (!defs) {
      // remove the file if none should exist
      fs.rmSync(`${filename}`, { force: true });
      return true;
    }
  } catch (e) {
    // file does not exist
    if (!defs)
      return false;
  }

  fs.rmSync(`${filename}.tmp`, { force: true });
  fs.writeFileSync(`${filename}.tmp`, defs);
  fs.renameSync(`${filename}.tmp`, filename);
  return true;
}


export async function updateDir<O>(dir: string, items: Array<DirItem<O>> | null, removeother: boolean, generatecb: (file: string, data: O) => string | Promise<string>) {
  return updateDirInternal<O>(dir, items, "", removeother, generatecb);
}

async function updateDirInternal<O>(dir: string, items: Array<DirItem<O>> | null, path: string, removeother: boolean, generatecb: (file: string, data: O) => string | Promise<string>) {
  let anyupdate = false;
  if (!items) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return;
  }

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let existingfiles: Dirent[] = [];
  if (removeother) {
    try {
      existingfiles = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
    }
  }

  for (const item of items) {
    if (item.type === "file") {
      try {
        const defs = await generatecb(path + item.name, item.data);
        const filename = `${dir}${item.name}`;
        if (updateFile(filename, defs))
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
          fs.rmSync(existingpath, { recursive: true, force: true });
          anyupdate = true;
        } else if (file.isFile()) {
          fs.rmSync(existingpath, { force: true });
          anyupdate = true;
        }
      }
    }
  }

  return anyupdate;
}
