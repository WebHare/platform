import { toFSPath } from "./services";
import YAML from "yaml";
import type { ModuleDefinition } from "@mod-platform/generated/schema/moduledefinition";
import { readFile } from "fs/promises";

/// This is the type of the moduledefinition.yml file extended with name/path info
export type ModDefYML = ModuleDefinition & {
  ///Name of the module
  module: string;
  ///Base resource path for relative references
  baseResourcePath: string;
};

export async function parseModuleDefYML(module: string): Promise<ModDefYML> {
  const moduledefresource = `mod::${module}/moduledefinition.yml`;
  const parsed = YAML.parse(await readFile(toFSPath(moduledefresource), 'utf8'), { strict: true, version: "1.2" }) as ModuleDefinition;
  return {
    ...parsed,
    module,
    baseResourcePath: moduledefresource
  };
}
