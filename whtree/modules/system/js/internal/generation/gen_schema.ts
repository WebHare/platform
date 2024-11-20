import { toFSPath } from "@webhare/services";
import { readFile } from "fs/promises";
import { resolveResource } from "@webhare/services";
import { FileToUpdate, type GenerateContext } from "./shared";
import { compile, type JSONSchema } from 'json-schema-to-typescript';
import { decodeYAML } from "@mod-platform/js/devsupport/validation";

async function buildSchema(sourceres: string, tsType: string) {
  const source = decodeYAML<JSONSchema>(await readFile(toFSPath(sourceres), 'utf8'));
  source.title = tsType; //this determines the name of the exported root type
  return await compile(source, "", {
    bannerComment:
      `/* eslint-disable */
/* This schema was generated from ${sourceres}

To update: wh update-generated-files --only schema
*/`
  });
}

export async function listAllSchemas(context: GenerateContext): Promise<FileToUpdate[]> {
  const schemas = [];
  for (const mod of context.moduledefs) {
    for (const type of mod.modYml?.moduleFileTypes ?? []) {
      const tsType = type.tsType;
      if (tsType) {
        const resoucepath = resolveResource(mod.resourceBase, type.schema);
        schemas.push({
          path: `schema/${mod.name === 'platform' ? '' : `${mod.name}/`}${tsType.toLowerCase()}.ts`, // //TODO bail if tsType is not unique, err in moduledef validation
          module: mod.name,
          type: "schema" as const,
          generator: () => buildSchema(resoucepath, tsType)
        });
      }
    }
  }
  return schemas;
}
