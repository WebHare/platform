import fs from "node:fs";

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

export async function updateDir<O>(dir: string, wantfiles: Record<string, O>, removeother: boolean, generatecb: (file: string, data: O) => string | Promise<string>) {
  let anyupdate = false;
  fs.mkdirSync(dir, { recursive: true });
  let existingfiles: string[] = [];
  if (removeother) {
    try {
      existingfiles = fs.readdirSync(dir).filter(f => f.endsWith(".ts") || f.endsWith(".json")).map(f => f.substring(0, f.lastIndexOf(".")));
    } catch (e) {
    }
  }

  for (const file of Object.keys(wantfiles)) {
    try {
      const defs = await generatecb(file, wantfiles[file]);
      const filename = `${dir}${file}`;
      if (updateFile(filename, defs))
        anyupdate = true;
    } catch (e) {
      console.error(`Error generating file ${file}: `, e);
    }
  }
  if (removeother) {
    for (const file of existingfiles) {
      if (!Object.keys(wantfiles).includes(file)) {
        const filename = `${dir}${file}`;
        if (updateFile(filename, ""))
          anyupdate = true;
      }
    }
  }
  return anyupdate;
}
