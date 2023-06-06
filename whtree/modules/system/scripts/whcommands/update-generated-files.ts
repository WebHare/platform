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

async function runUpdate(targets: string[] | undefined, verbose: boolean, nodb: boolean) {
  if (!targets || targets.includes('config')) {
    if (verbose)
      console.time("Updating WebHare config files");
    await updateWebHareConfigFile(!nodb);
    if (verbose)
      console.timeEnd("Updating WebHare config files");
  }

  if (!targets || targets.includes('whdb')) {
    if (verbose)
      console.time("Updating table definitions");
    await updateAllModuleTableDefs();
    if (verbose)
      console.timeEnd("Updating table definitions");
  }

  if (!targets || targets.includes('wrd')) {
    if (verbose)
      console.time("Updating WRD definitions");
    await updateAllModuleWRDDefs({ verbose });
    if (verbose)
      console.timeEnd("Updating WRD definitions");
  }

  if (!targets || targets.includes('openapi')) {
    if (verbose)
      console.time("Updating OpenAPI definitions");
    await updateAllModuleOpenAPIDefs({ verbose });
    if (verbose)
      console.timeEnd("Updating OpenAPI definitions");
  }
}

async function main() {
  program
    .name('update-generated-files')
    .option('-v, --verbose', 'verbose mode')
    .option('--nodb', 'Do not access the database')
    .option('--update <targets>', 'Update specific targets only (one or more of config,whdb,wrd,openapi)');

  program.parse();
  const verbose = program.opts().verbose as boolean;
  const targets = program.opts().update?.split(',') as string[] | undefined;
  if (verbose)
    console.time("Updating generated files");
  try {
    await runUpdate(targets, program.opts().verbose, program.opts().nodb);
  } finally {
    if (verbose)
      console.timeEnd("Updating generated files");
  }
}

main();
