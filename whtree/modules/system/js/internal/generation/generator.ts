/* Drives the generator, takes care of proper sync/async ordering */

import { updateWebHareConfigFile } from "@mod-system/js/internal/generation/gen_config";
import { updateAllModuleTableDefs } from "@mod-system/js/internal/generation/gen_whdb";
import { updateAllModuleWRDDefs } from "@mod-system/js/internal/generation/gen_wrd";
import { updateAllModuleOpenAPIDefs } from "@mod-system/js/internal/generation/gen_openapi";

export async function updateGeneratedFiles(targets: string[], options?: { verbose?: boolean; nodb?: boolean }) {
  if (targets.includes('all') || targets.includes('config')) {
    if (options?.verbose)
      console.time("Updating WebHare config files");
    await updateWebHareConfigFile(options);
    if (options?.verbose)
      console.timeEnd("Updating WebHare config files");
  }

  const promises = new Array<Promise<void>>;

  if (targets.includes('all') || targets.includes('whdb')) {
    promises.push((async function () {
      if (options?.verbose)
        console.time("Updating table definitions");
      await updateAllModuleTableDefs();
      if (options?.verbose)
        console.timeEnd("Updating table definitions");
    })());
  }

  if (targets.includes('all') || targets.includes('wrd')) {
    promises.push((async function () {
      if (options?.verbose)
        console.time("Updating WRD definitions");
      await updateAllModuleWRDDefs(options);
      if (options?.verbose)
        console.timeEnd("Updating WRD definitions");
    })());
  }

  if (targets.includes('all') || targets.includes('openapi')) {
    promises.push((async function () {
      if (options?.verbose)
        console.time("Updating OpenAPI definitions");
      await updateAllModuleOpenAPIDefs(options);
      if (options?.verbose)
        console.timeEnd("Updating OpenAPI definitions");
    })());
  }

  await Promise.all(promises);
  return;
}
