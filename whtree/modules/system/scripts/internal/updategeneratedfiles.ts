// short: Updates all generated files (eg database definitions)

/* updategeneratedfiles is invoked:
   - at WebHare startup (through a <task so currently in the post startup phase)
   - manually using wh update-generated-files without --onlyconfig (with onlyconfig it'll short circuit to updateWebHareConfigFile)
   */

import { program } from 'commander';
import { updateWebHareConfigFile } from "@mod-system/js/internal/generation/gen_config";
import { updateAllModuleTableDefs } from "@mod-system/js/internal/generation/gen_whdb";
import { updateAllModuleWRDDefs } from "@mod-system/js/internal/generation/gen_wrd";
import { updateAllModuleOpenAPIDefs } from "@mod-system/js/internal/generation/gen_openapi";

async function runUpdate(verbose: boolean) {
  if (verbose)
    console.log("Updating WebHare config files");
  await updateWebHareConfigFile(true);

  if (verbose)
    console.log("Updating table definitions");
  await updateAllModuleTableDefs();

  if (verbose)
    console.log("Updating WRD definitions");
  await updateAllModuleWRDDefs();

  if (verbose)
    console.log("Updating OpenAPI definitions");
  await updateAllModuleOpenAPIDefs();
}

program
  .name('update-generated-files')
  .option('-v, --verbose', 'verbose mode');
program.parse();
runUpdate(program.opts().verbose);
