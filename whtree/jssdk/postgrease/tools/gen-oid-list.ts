import { run } from "@webhare/cli";
import { storeDiskFile } from "@webhare/system-tools";
import { promises as fs } from "node:fs";
import * as path from "node:path";



run({
  description: "Generate OID list from PostgreSQL source install pg_type.dat file",
  arguments: [
    {
      name: "<pgTypeDatFile>",
      description: "Path to pg_type.dat file",
    }
  ],
  async main({ opts, args }) {
    const pg_types = await fs.readFile(args.pgTypeDatFile, "utf8");
    if (pg_types.indexOf("# pg_type.dat") === -1)
      throw new Error("Not a valid pg_type.dat file, expected `# pg_type.dat` header");

    const converted = pg_types
      .split("\n")
      .filter(line => line && !line.trim()
        .startsWith("#"))
      .map(l => l
        .replaceAll(/([_a-zA-Z]*) *=>/g, (x, fieldName) => `${JSON.stringify(fieldName)}: `)
        .replaceAll(`'`, `"`))
      .join("\n")
      .replace(/, *\n *]/m, '\n]');

    const decoded = JSON.parse(converted);

    const oidMap: { name: string; oid: number }[] = [];
    for (const typeDef of decoded) {
      oidMap.push({ name: typeDef.typname, oid: Number(typeDef.oid) });
      if (typeDef.array_type_oid)
        oidMap.push({ name: `_${typeDef.typname}`, oid: Number(typeDef.array_type_oid) });
    }

    oidMap.sort((a, b) => a.oid - b.oid);

    const newFile =
      `// This file is auto-generated from pg_type.dat by gen-oid-lists.ts - do not edit directly

export const DataTypeOids = {
${oidMap.map((typeDef) => `  ${typeDef.name}: ${typeDef.oid},`).join("\n")}
} as const;

export const DataTypeNames = {
${oidMap.map((typeDef) => `  ${typeDef.oid}: ${JSON.stringify(typeDef.name)},`).join("\n")}
} as const;
`;

    const currentContents = await fs.readFile(path.join(__dirname, "../types/oids.ts"), "utf8");
    if (currentContents === newFile) {

      console.log("No changes to oid list");
      return;
    }

    await storeDiskFile(path.join(__dirname, "../types/oids.ts"), newFile, { overwrite: true });
  }
});
