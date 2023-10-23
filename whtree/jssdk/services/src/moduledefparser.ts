import { readFileSync } from "fs";
import { backendConfig, toFSPath } from "./services";
import YAML from "yaml";
import { ModuleDefinitionYML } from "./moduledeftypes";

export async function getAllModuleYAMLs(): Promise<ModuleDefinitionYML[]> { //not promising to stay sync
  const defs = [];
  for (const module of Object.keys(backendConfig.module)) {
    const moduledefresource = `mod::${module}/moduledefinition.yml`;
    try {
      const parsed = YAML.parse(readFileSync(toFSPath(moduledefresource), 'utf8'), { strict: true, version: "1.2" });
      defs.push({ ...parsed, module, baseResourcePath: moduledefresource });
    } catch (ignore) {
      continue; //guess open failure. TODO or syntax failure, but what we're gonna do about it here?
    }
  }
  return defs;
}
