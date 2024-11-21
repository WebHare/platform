import { backendConfig, toFSPath } from "./services";
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
  return parseModuleDefYMLText(module, await readFile(toFSPath(moduledefresource), 'utf8'));
}

export function parseModuleDefYMLText(module: string, text: string): ModDefYML {
  const moduledefresource = `mod::${module}/moduledefinition.yml`;
  const parsed = YAML.parse(text, { strict: true, version: "1.2" }) as ModuleDefinition;
  return {
    ...parsed,
    module,
    baseResourcePath: moduledefresource
  };
}

/** Get all YMLs without going through the config/extract generator */
export async function getAllModuleYAMLs(): Promise<ModDefYML[]> { //not promising to stay sync
  const defs: ModDefYML[] = [];
  for (const module of Object.keys(backendConfig.module)) {
    try {
      defs.push(await parseModuleDefYML(module));
    } catch (ignore) {
      continue; //guess open failure. TODO or syntax failure, but what we're gonna do about it here?
    }
  }
  return defs;
}
