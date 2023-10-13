// short: Updates all generated files (eg database definitions)

import { updateGeneratedFiles } from '@mod-system/js/internal/generation/generator';
import { program } from 'commander';

async function main() {
  program
    .name('update-generated-files')
    .option('-v, --verbose', 'verbose mode')
    .option('--dryrun', 'Do not actually rewrite files')
    .option('--nodb', 'Do not access the database')
    .option('--update <targets>', 'Update specific targets only (one or more of config,whdb,wrd,openapi)');

  program.parse();
  const verbose = program.opts().verbose as boolean;
  const targets = program.opts().update?.split(',') ?? ["all"];
  if (verbose)
    console.time("Updating generated files");
  try {
    await updateGeneratedFiles(targets, { verbose: program.opts().verbose, nodb: program.opts().nodb, dryRun: program.opts().dryrun });
  } finally {
    if (verbose)
      console.timeEnd("Updating generated files");
  }
}

main();
