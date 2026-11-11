import { backendConfig, toFSPath } from "@webhare/services";
import { GenerateContext, type LoadedModuleDefs } from "./shared";
import { readFile } from "fs/promises";
import type { Document } from '@xmldom/xmldom';
import type { ModuleData } from "@webhare/services/src/config";
import type { RecursiveReadonly } from "@webhare/js-api-tools/src/utility-types";
import { type ModDefYML, parseModuleDefYML } from "@webhare/services/src/moduledefparser";
import { parseDocAsXML } from "./xmlhelpers";

async function loadModuleDefs(name: string, mod: RecursiveReadonly<ModuleData>): Promise<LoadedModuleDefs> {
  const resourceBase = `mod::${name}/`;
  let modXml: Document | null = null;
  try {
    const moddef = resourceBase + "moduledefinition.xml";
    const text = await readFile(toFSPath(moddef), 'utf8');
    modXml = parseDocAsXML(text, "text/xml");
  } catch (ignore) {
  }

  let modYml: ModDefYML | null = null;
  try {
    //TODO validate what we read, but we need a schema infrastructure. see also https://gitlab.webhare.com/webharebv/codekloppers/-/issues/890
    modYml = await parseModuleDefYML(name);
  } catch (ignore) {
  }

  return { name, resourceBase, modXml, modYml };
}

export async function buildGeneratorContext(modules: string[] | null, verbose: boolean): Promise<GenerateContext> {
  const moduledefs = await Promise.all(
    Object.entries(backendConfig.module)
      .filter(([key]) => modules === null || modules.includes(key))
      .map(([key, value]) => loadModuleDefs(key, value))
  );

  return new GenerateContext(moduledefs, verbose);
}
