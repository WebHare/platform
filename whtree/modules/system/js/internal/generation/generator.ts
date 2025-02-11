/* Drives the generator, takes care of proper sync/async ordering

   We set up the following directories:
   - whtree/modules/platform/generated/<type>
     - in JS/TS: @mod-platform/generated/<type>/
     - in HS/as resource: mod::platform/generated/<type>/
   - whdata/storage/system/generated/<type>               (might become whdata/storage/<type> but we don't expose that as a resource in JS yet)
     - in JS/TS: wh:<type>/
      - in HS/as resource: storage::system/generated/<type>/

  Types:
  - schema: TS interfaces for shipped schemas (eg moduledefiniton.yml types)
  - config: config.json
  - extract: subsets of gathered moduledefinition.xml info
  - whdb: database definitions
  - wrd: WRD schema definitions
  - openapi: OpenAPI definitions
*/

import { updateWebHareConfigFile } from "@mod-system/js/internal/generation/gen_config";
import { listAllModuleTableDefs } from "@mod-system/js/internal/generation/gen_whdb";
import { listAllModuleWRDDefs } from "@mod-system/js/internal/generation/gen_wrd";
import { listAllModuleOpenAPIDefs } from "@mod-system/js/internal/generation/gen_openapi";
import { backendConfig, toFSPath } from "@webhare/services";
import { getGeneratedFilePath, type FileToUpdate, type GenerateContext, type GeneratorType, type LoadedModuleDefs } from "./shared";
import { mkdir, readFile } from "fs/promises";
import { dirname, join } from "node:path";
import { deleteRecursive, storeDiskFile } from "@webhare/system-tools/src/fs";
import { whconstant_builtinmodules } from "../webhareconstants";
import { DOMParser, type Document } from '@xmldom/xmldom';
import type { ModuleData } from "@webhare/services/src/config";
import { listAllExtracts } from "./gen_extracts";
import type { RecursiveReadonly } from "@webhare/js-api-tools/src/utility-types";
import { listAllSchemas } from "./gen_schema";
import { type ModDefYML, parseModuleDefYML } from "@webhare/services/src/moduledefparser";
import { listAllRegistryDefs } from "./gen_registry";

function getPaths() {
  const installedBaseDir = backendConfig.dataroot + "storage/system/generated/";
  const builtinBaseDir = backendConfig.installationroot + "modules/platform/generated/";

  return { installedBaseDir, builtinBaseDir };
}

function fixFilePaths(files: FileToUpdate[]) {
  return files.map(file => ({
    ...file,
    path: getGeneratedFilePath(file.module, file.type, file.path)
  }));
}

async function listOtherGeneratedFiles(): Promise<FileToUpdate[]> {
  const allmods = ["platform", ...Object.keys(backendConfig.module).filter(m => !whconstant_builtinmodules.includes(m))];
  return fixFilePaths([
    ...await listAllModuleTableDefs(allmods),
    ...await listAllModuleWRDDefs(),
    ...await listAllModuleOpenAPIDefs(),
    ...await listAllRegistryDefs(allmods)
  ]);
}

export async function listAllGeneratedFiles(): Promise<FileToUpdate[]> {
  return [...await listOtherGeneratedFiles(), ...fixFilePaths(await listAllExtracts())];
}

async function loadModuleDefs(name: string, mod: RecursiveReadonly<ModuleData>): Promise<LoadedModuleDefs> {
  const resourceBase = `mod::${name}/`;
  let modXml: Document | null = null;
  try {
    const moddef = resourceBase + "moduledefinition.xml";
    const text = await readFile(toFSPath(moddef), 'utf8');
    modXml = new DOMParser().parseFromString(text, "text/xml");
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

  return {
    moduledefs,
    verbose
  };
}

async function generateFiles(files: FileToUpdate[], context: GenerateContext, options: { dryRun?: boolean; verbose?: boolean; nodb?: boolean }) {
  const generated = files.map(file => file.generator(context));

  //Process them
  for (const [idx, file] of files.entries()) {
    const content = await generated[idx];

    try {
      const currentdata = await readFile(file.path, 'utf8');
      if (currentdata === content) {
        if (options?.verbose)
          console.log(`Keeping file ${file.path}`);
        continue;
      }
    } catch (ignore) {
    }

    if (!options?.dryRun) {
      await mkdir(dirname(file.path), { recursive: true });
      await storeDiskFile(file.path, content, { overwrite: true });
    }
    if (options?.verbose)
      console.log(`Updated ${file.path}`);
  }
}

export async function updateGeneratedFiles(targets: Array<(GeneratorType | "all")>, options: {
  dryRun?: boolean;
  verbose?: boolean;
  nodb?: boolean;
  generateContext?: GenerateContext;
} = {}) {
  if (targets.includes('all') || targets.includes('config')) {
    if (options?.verbose)
      console.time("Updating WebHare config files");
    if (!options.dryRun)
      await updateWebHareConfigFile(options); //will invoke reloadBackendConfig if anything changed
    if (options?.verbose)
      console.timeEnd("Updating WebHare config files");
  }


  if (targets.filter(_ => _ !== 'config').length === 0) //only config was requested
    return;

  const context = options.generateContext || await buildGeneratorContext(null, options?.verbose || false);

  //TODO we might need to be above buildGenerateContext in the future to provide moduledefinition schemas for runtime validation?
  const schemas = fixFilePaths(await listAllSchemas(context));
  if (targets.includes('schema') || targets.includes('all'))
    await generateFiles(schemas, context, options);

  //Start generating files. Finish all extracts before we start the rest, as some extracts are needed input for generators
  const extracts = fixFilePaths(await listAllExtracts());
  if (targets.includes('extract') || targets.includes('all'))
    await generateFiles(extracts, context, options);

  const { installedBaseDir, builtinBaseDir } = getPaths();
  const keepfiles = new Set<string>([
    join(installedBaseDir, "config/config.json"),
    ...schemas.map(file => file.path),
    ...extracts.map(file => file.path)
  ]);

  if (targets.includes('openapi') || targets.includes('whdb') || targets.includes('wrd') || targets.includes('registry') || targets.includes('all')) {
    const otherfiles = await listOtherGeneratedFiles();
    otherfiles.forEach(file => keepfiles.add(file.path));
    const togenerate = targets.includes('all') ? otherfiles : otherfiles.filter(file => targets.includes(file.type));
    await generateFiles(togenerate, context, options);
  }

  //Remove old files - but only if we have a full view of which files there should be
  if (targets.includes('all')) {
    for (const root of [installedBaseDir, builtinBaseDir])
      for (const subdir of ["schema", "whdb", "wrd", "openapi"])
        await deleteRecursive(join(root, subdir), { allowMissing: true, keep: _ => keepfiles.has(_.fullPath), dryRun: options.dryRun, verbose: options.verbose });
  }
  return;
}

export async function updateDebugSettings(debugSettings: {
  tags: string[];
  outputsession: string;
  context: string;
} | null, options: {
  dryRun?: boolean;
  verbose?: boolean;
  nodb?: boolean;
  generateContext?: GenerateContext;
} = {}) {
  if (options?.verbose)
    console.time("Updating WebHare config file");
  if (!options.dryRun)
    await updateWebHareConfigFile({ ...options, debugSettings });
  if (options?.verbose)
    console.timeEnd("Updating WebHare config file");
}
