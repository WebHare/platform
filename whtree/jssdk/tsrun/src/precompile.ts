import * as fs from "node:fs/promises";
import * as path from "node:path";
import { transpile } from "./resolvehook";

async function main() {
  for (const dir of process.argv.slice(3)) {
    const tsFiles = (await fs.readdir(dir, { withFileTypes: true, recursive: true }))
      .filter(entry =>
        //do not descend into a node_modules
        !entry.parentPath.substring(dir.length).includes("node_modules") &&
        //only care for files
        entry.isFile() &&
        //exclude the vendored 'acme' package, which is not installed, but included as a submodule
        //we do want to include acme's 'src' directory (which contains the ts files we're importing), but skip over *.test.ts
        //and *.deno.ts files
        (
          !entry.parentPath.substring(dir.length).includes("vendor/acme") ||
          (
            entry.parentPath.substring(dir.length).includes("vendor/acme/src") &&
            !entry.name.endsWith(".test.ts") &&
            !entry.name.endsWith(".deno.ts")
          )
        ) &&
        //with a transpilable extension
        [".ts", ".tsx"].includes(path.extname(entry.name)));

    for (const file of tsFiles) {
      const fullpath = path.join(file.parentPath, file.name);
      // console.log(`Compiling ${file.parentPath}/${file.name}`);
      transpile(process.argv[2], await fs.readFile(fullpath, { encoding: "utf8" }), fullpath);
    }
  }
}

void main();
