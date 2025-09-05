/* Drives the generator, takes care of proper sync/async ordering

   We set up the following directories:
   - whtree/modules/platform/generated/<type>
     - in JS/TS: @mod-platform/generated/<type>/
     - in HS/as resource: mod::platform/generated/<type>/
   - whdata/config/<type>
     - in JS/TS: wh:<type>/
     - in HS/as resource: whdata::config/<type>/

  Types:
  - schema: TS interfaces for shipped schemas (eg moduledefiniton.yml types)
  - config: platform.json
  - extracts: subsets of gathered moduledefinition.xml info
  - whdb: database definitions
  - wrd: WRD schema definitions
  - openapi: OpenAPI definitions
*/

import { updateWebHareConfigFile } from "@mod-system/js/internal/generation/gen_config";
import { listAllModuleTableDefs } from "@mod-system/js/internal/generation/gen_whdb";
import { listAllModuleWRDDefs } from "@mod-system/js/internal/generation/gen_wrd";
import { listAllModuleOpenAPIDefs } from "@mod-system/js/internal/generation/gen_openapi";
import { backendConfig, importJSFunction, toFSPath } from "@webhare/services";
import { appliesToModule, getGeneratedFilePath, type FileToUpdate, type GenerateContext, type GeneratorType, type LoadedModuleDefs } from "./shared";
import { readFile } from "fs/promises";
import { join } from "node:path";
import { deleteRecursive, storeDiskFile } from "@webhare/system-tools/src/fs";
import { whconstant_builtinmodules } from "../webhareconstants";
import type { Document } from '@xmldom/xmldom';
import type { ModuleData } from "@webhare/services/src/config";
import { listAllExtracts } from "./gen_extracts";
import type { RecursiveReadonly } from "@webhare/js-api-tools/src/utility-types";
import { listAllSchemas } from "./gen_schema";
import { type ModDefYML, parseModuleDefYML } from "@webhare/services/src/moduledefparser";
import { listAllRegistryTS } from "./gen_registry";
import { listAllServiceTS } from "./gen_services";
import { listMiscTS, listPublicConfig } from "./gen_misc_ts";
import { rm } from "node:fs/promises";
import { parseDocAsXML } from "./xmlhelpers";
import { pick } from "@webhare/std";
import { listAllModuleWHFSTypeDefs } from "./gen_whfs";

function getPaths() {
  const installedBaseDir = backendConfig.dataRoot + "config/";
  const builtinBaseDir = backendConfig.installationRoot + "modules/platform/generated/";

  return { installedBaseDir, builtinBaseDir };
}

function fixFilePaths(files: FileToUpdate[]) {
  return files.map(file => ({
    ...file,
    path: getGeneratedFilePath(file.module, file.type, file.path)
  }));
}

async function listAllGeneratedTypeScript(mods: string[]): Promise<FileToUpdate[]> {
  return [
    ...await listAllServiceTS(mods),
    ...await listAllRegistryTS(),
    ...await listMiscTS(mods)
  ];
}

async function listAllDevKitFiles(): Promise<FileToUpdate[]> {
  if (!backendConfig.module["devkit"])
    return [];
  return await (await importJSFunction<typeof listOtherGeneratedFiles>("@mod-devkit/js/integration/config#listAllDevkitFiles"))();
}

async function listOtherGeneratedFiles(): Promise<FileToUpdate[]> {
  const allmods = ["platform", ...Object.keys(backendConfig.module).filter(m => !whconstant_builtinmodules.includes(m))];
  return fixFilePaths([
    ...await listAllModuleTableDefs(allmods),
    ...await listAllModuleWRDDefs(),
    ...await listAllModuleWHFSTypeDefs(),
    ...await listAllModuleOpenAPIDefs(),
    ...await listAllGeneratedTypeScript(allmods),
    ...await listPublicConfig(),
    ...await listAllDevKitFiles()
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

  return {
    moduledefs,
    verbose
  };
}

async function generateFiles(filelist: FileToUpdate[], context: GenerateContext, options: { dryRun?: boolean; verbose?: boolean; nodb?: boolean; showUnchanged?: boolean; modules?: string[] } = {}) {
  const files = filelist.filter(file => !(file.requireDb && options.nodb) && appliesToModule(file.module, options.modules));
  const generated = files.map(file => file.generator(context).catch(e => {
    console.error(`Error generating ${file.path}: ${(e as Error)?.message}`);
    if (options.verbose)
      console.error(e.stack);
    return null;
  }));

  //Process them
  for (const [idx, file] of files.entries()) {
    const content = await generated[idx];
    if (content === null) //already failed
      continue;

    let updated = false;
    if (!options?.dryRun)
      updated = !(await storeDiskFile(file.path, content, { overwrite: true, mkdir: true, onlyIfChanged: true })).skipped;
    if (updated && options?.verbose)
      console.log(`Updated ${file.path}`);
    if (!updated && options?.showUnchanged)
      console.log(`Keeping file ${file.path}`);
  }
}

export async function updateGeneratedFiles(targets: GeneratorType[], options: {
  //TODO remove? dryRun is unreachable now and not currently guaranteed by wh apply to work?
  dryRun?: boolean;
  verbose?: boolean;
  showUnchanged?: boolean;
  nodb?: boolean;
  generateContext?: GenerateContext;
  modules?: string[];
} = {}) {
  const context = options.generateContext || await buildGeneratorContext(null, options?.verbose || false);

  //TODO we might need to be above buildGenerateContext in the future to provide moduledefinition schemas for runtime validation?
  const schemas = fixFilePaths(await listAllSchemas(context));
  if (targets.includes('schema'))
    await generateFiles(schemas, context, options);

  //Start generating files. Finish all extracts before we start the rest, as some extracts are needed input for generators
  const extracts = fixFilePaths(await listAllExtracts());
  if (targets.includes('extracts'))
    await generateFiles(extracts, context, options);

  const { installedBaseDir, builtinBaseDir } = getPaths();
  const keepfiles = new Set<string>([
    join(installedBaseDir, "platform.json"),
    ...schemas.map(file => file.path),
    ...extracts.map(file => file.path)
  ]);

  const otherfiles = await listOtherGeneratedFiles();

  otherfiles.forEach(file => keepfiles.add(file.path));
  //only regenerate requested files
  const togenerate = otherfiles.filter(file => targets.includes(file.type));
  if (togenerate.length)
    await generateFiles(togenerate, context, options);

  //Remove old files from subdirs that contain per-module files
  const deleteOpts = { allowMissing: true, ...pick(options, ["dryRun", "verbose", "showUnchanged"]) };
  for (const subdir of ["schema", "db", "wrd", "openapi"] as const)
    for (const root of [installedBaseDir, builtinBaseDir])
      await deleteRecursive(join(root, subdir), { keep: _ => keepfiles.has(_.fullPath), ...deleteOpts });

  //Delete pre-wh5.7 config locations. We'll do this every time for a while until we're sure noone is switching branches to pre-5.7
  await deleteRecursive(backendConfig.dataRoot + 'storage/system/generated/config', deleteOpts);
  await deleteRecursive(backendConfig.module["platform"].root + 'generated/registry', deleteOpts);
  await deleteRecursive(backendConfig.module["platform"].root + 'generated/whdb', deleteOpts);
  await rm(backendConfig.dataRoot + 'storage/system/js/publicconfig.json', { force: true });
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
  //FIXME this may still be dangerous, we should go through the service to update config files
  if (options?.verbose)
    console.time("Updating WebHare config file");
  if (!options.dryRun)
    await updateWebHareConfigFile({ ...options, debugSettings });
  if (options?.verbose)
    console.timeEnd("Updating WebHare config file");
}
