/* Drives the generator, takes care of proper sync/async ordering */

import { updateWebHareConfigFile } from "@mod-system/js/internal/generation/gen_config";
import { listAllModuleTableDefs } from "@mod-system/js/internal/generation/gen_whdb";
import { listAllModuleWRDDefs } from "@mod-system/js/internal/generation/gen_wrd";
import { listAllModuleOpenAPIDefs } from "@mod-system/js/internal/generation/gen_openapi";
import { updateConfig } from "../configuration";
import { backendConfig } from "@webhare/services";
import { FileToUpdate } from "./shared";
import { mkdir, readFile } from "fs/promises";
import { dirname, join } from "node:path";
import { deleteRecursive, storeDiskFile } from "@webhare/system-tools/src/fs";

function getPaths() {
  const installedBaseDir = backendConfig.dataroot + "storage/system/generated/";
  const builtinBaseDir = backendConfig.installationroot + "modules/system/js/internal/generated/";

  return { installedBaseDir, builtinBaseDir };
}

export async function listAllGeneratedFiles(): Promise<FileToUpdate[]> {
  const { installedBaseDir, builtinBaseDir } = getPaths();

  const files: FileToUpdate[] = [];
  files.push(...await listAllModuleTableDefs(), ...await listAllModuleWRDDefs(), ...await listAllModuleOpenAPIDefs());
  files.forEach(file => {
    file.path = (file.module == "platform" ? builtinBaseDir : installedBaseDir) + file.path;
  });
  return files;
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

  // FIXME listAllGeneratedFiles will list *all* files but the generator can still decide *not* to generate the accompanying file. This needs to be fixed in listAllGeneratedFiles so 'dev' can trust it!
  const files = await listAllGeneratedFiles();
  const togenerate = targets.includes('all') ? files : files.filter(file => targets.includes(file.type));

  //Start generating files
  const { installedBaseDir, builtinBaseDir } = getPaths();
  const generated = togenerate.map(file => file.generator(options));
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
