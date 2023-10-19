/* Drives the generator, takes care of proper sync/async ordering */

import { updateWebHareConfigFile } from "@mod-system/js/internal/generation/gen_config";
import { listAllModuleTableDefs } from "@mod-system/js/internal/generation/gen_whdb";
import { listAllModuleWRDDefs } from "@mod-system/js/internal/generation/gen_wrd";
import { listAllModuleOpenAPIDefs } from "@mod-system/js/internal/generation/gen_openapi";
import { updateConfig } from "../configuration";
import { backendConfig, toFSPath } from "@webhare/services";
import { FileToUpdate, GenerateContext, LoadedModuleDefs } from "./shared";
import { mkdir, readFile } from "fs/promises";
import { dirname, join } from "node:path";
import { deleteRecursive, storeDiskFile } from "@webhare/system-tools/src/fs";
import { whconstant_builtinmodules } from "../webhareconstants";
import { DOMParser } from '@xmldom/xmldom';
import { ModuleDefinitionYML } from "@webhare/services/src/moduledeftypes";
import YAML from "yaml";
import { ModuleData } from "@webhare/services/src/config";
import { listAllExtracts } from "./gen_extracts";
import { RecursiveReadOnly } from "@webhare/js-api-tools/src/utility-types";

function getPaths() {
  const installedBaseDir = backendConfig.dataroot + "storage/system/generated/";
  const builtinBaseDir = backendConfig.installationroot + "modules/system/js/internal/generated/";

  return { installedBaseDir, builtinBaseDir };
}

export async function listAllGeneratedFiles(): Promise<FileToUpdate[]> {
  const { installedBaseDir, builtinBaseDir } = getPaths();

  const files: FileToUpdate[] = [];
  const allmods = ["platform", ...Object.keys(backendConfig.module).filter(m => !whconstant_builtinmodules.includes(m))];

  files.push(
    ...await listAllModuleTableDefs(allmods),
    ...await listAllModuleWRDDefs(),
    ...await listAllModuleOpenAPIDefs(),
    ...await listAllExtracts()
  );

  //we keep all extracts in the generated dir even if they describe the platform (similar to config.json)
  //extracts are not depended on by TS files anyway
  files.forEach(file => {
    file.path = (file.module == "platform" && file.type != 'extract' ? builtinBaseDir : installedBaseDir) + file.path;
  });
  return files;
}

async function loadModuleDefs(name: string, mod: RecursiveReadOnly<ModuleData>): Promise<LoadedModuleDefs> {
  const resourceBase = `mod::${name}/`;
  let modXml: Document | null = null;
  try {
    const moddef = resourceBase + "moduledefinition.xml";
    const text = await readFile(toFSPath(moddef), 'utf8');
    modXml = new DOMParser().parseFromString(text, "text/xml");
  } catch (ignore) {
  }

  let modYml: ModuleDefinitionYML | null = null;
  try {
    //TODO validate what we read, but we need a schema infrastructure. see also https://gitlab.webhare.com/webharebv/codekloppers/-/issues/890
    modYml = YAML.parse(await readFile(toFSPath(resourceBase + "moduledefinition.yml"), 'utf8'), { strict: true, version: "1.2" }) as ModuleDefinitionYML;
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

  return {
    moduledefs,
    verbose
  };
}

export async function updateGeneratedFiles(targets: string[], options: { dryRun?: boolean; verbose?: boolean; nodb?: boolean } = {}) {
  if (targets.includes('all') || targets.includes('config')) {
    if (options?.verbose)
      console.time("Updating WebHare config files");
    if (!options.dryRun)
      await updateWebHareConfigFile(options);
    if (options?.verbose)
      console.timeEnd("Updating WebHare config files");
  }

  // Reload any configuration updated above (TODO shouldn't updateWebHareConfig have triggered a callback to do this ?)
  updateConfig();

  if (targets.filter(_ => _ !== 'config').length === 0) //only config was requested
    return;

  const context = await buildGeneratorContext(null, options?.verbose || false);

  // FIXME listAllGeneratedFiles will list *all* files but the generator can still decide *not* to generate the accompanying file. This needs to be fixed in listAllGeneratedFiles so 'dev' can trust it! (OTOH, listAll wants to be fast but currently we'd need a lot of XML parsing for elimination..)
  const files = await listAllGeneratedFiles();
  const togenerate = targets.includes('all') ? files : files.filter(file => targets.includes(file.type));

  //Start generating files
  const { installedBaseDir, builtinBaseDir } = getPaths();
  const generated = togenerate.map(file => file.generator(context));
  const keepfiles = new Set<string>([join(installedBaseDir, "config/config.json"), ...files.map(file => file.path)]);

  //Process them
  for (const [idx, file] of togenerate.entries()) {
    const content = await generated[idx];

    try {
      const currentdata = await readFile(file.path, 'utf8');
      if (currentdata === content)
        continue;
    } catch (ignore) {
    }

    if (!options?.dryRun) {
      await mkdir(dirname(file.path), { recursive: true });
      await storeDiskFile(file.path, content, { overwrite: true });
    }
    if (options?.verbose)
      console.log(`Updated ${file.path}`);
  }

  //Remove old files
  await deleteRecursive(installedBaseDir, { allowMissing: true, keep: _ => keepfiles.has(join(_.path, _.name)), dryRun: options.dryRun, verbose: options.verbose });
  await deleteRecursive(builtinBaseDir, { allowMissing: true, keep: _ => keepfiles.has(join(_.path, _.name)), dryRun: options.dryRun, verbose: options.verbose });
  return;
}
