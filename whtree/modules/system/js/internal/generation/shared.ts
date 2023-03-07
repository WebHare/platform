import fs from "node:fs";

function updateFile(filename: string, defs: string) {
  try {
    const current = fs.readFileSync(filename).toString();
    if (defs && current === defs) {
      return;
    }
    if (!defs) {
      // remove the file if none should exist
      fs.rmSync(`${filename}`, { force: true });
      console.log(`removed ${filename}`);
      return;
    }
  } catch (e) {
    // file does not exist
    if (!defs)
      return;
  }

  fs.rmSync(`${filename}.tmp`, { force: true });
  fs.writeFileSync(`${filename}.tmp`, defs);
  fs.renameSync(`${filename}.tmp`, filename);
}

export async function updateDir<O>(dir: string, wantfiles: Record<string, O>, removeother: boolean, generatecb: (file: string, data: O) => string | Promise<string>) {
  fs.mkdirSync(dir, { recursive: true });
  let existingfiles: string[] = [];
  if (removeother) {
    try {
      existingfiles = fs.readdirSync(dir).filter(f => f.endsWith(".ts")).map(f => f.substring(0, f.length - 3));
    } catch (e) {
    }
  }

  for (const file of Object.keys(wantfiles)) {
    const defs = await generatecb(file, wantfiles[file]);
    const filename = `${dir}${file}.ts`;
    updateFile(filename, defs);
  }
  if (removeother) {
    for (const file of existingfiles) {
      if (!Object.keys(wantfiles).includes(file)) {
        const filename = `${dir}${file}.ts`;
        updateFile(filename, "");
      }
    }
  }
}
