import { toFSPath } from "@webhare/services";
import { FileToUpdate } from "./shared";
import { readFile, readdir } from "fs/promises";
import YAML from "yaml";
import { compile } from 'json-schema-to-typescript';

async function buildSchema(schema: string) {
  const sourceres = `mod::platform/data/schemas/${schema}.schema.yml`;
  const source = YAML.parse(await readFile(toFSPath(sourceres), 'utf8'));
  return await compile(source, schema, {
    bannerComment:
      `/* eslint-disable */
/* This schema was generated from ${sourceres}

To update: wh update-gnerated-files --only schema
*/`
  });
}

export async function listAllSchemas(): Promise<FileToUpdate[]> {
  const schemas = await readdir(toFSPath("mod::platform/data/schemas"));
  return schemas
    .filter(_ => _.endsWith(".schema.yml"))
    .map(_ => _.substring(0, _.length - 11)) //strip .schema.yml
    .map(schema => ({
      path: `schema/${schema}.ts`,
      module: "platform",
      type: "schema",
      generator: () => buildSchema(schema)
    }));
}
