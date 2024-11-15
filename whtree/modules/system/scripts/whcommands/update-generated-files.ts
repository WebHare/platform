// short: Updates all generated files (eg database definitions)

import { updateGeneratedFiles } from '@mod-system/js/internal/generation/generator';
import { generatorTypes } from '@mod-system/js/internal/generation/shared';
import { program } from 'commander';

async function main() {
  program
    .name('update-generated-files')
    .option('-v, --verbose', 'verbose mode')
    .option('--dryrun', 'Do not actually rewrite files')
    .option('--nodb', 'Do not access the database')
    .option('--only <targets>', `Update specific targets only (one or more of ${generatorTypes.join(", ")}})`);

  program.parse();
  const verbose = program.opts().verbose as boolean;
  const only = program.opts().only?.split(',') ?? ["all"];
  if (verbose)
    console.time("Updating generated files");
  try {
    await updateGeneratedFiles(only, { verbose: program.opts().verbose, nodb: program.opts().nodb, dryRun: program.opts().dryrun });
  } finally {
    if (verbose)
      console.timeEnd("Updating generated files");
  }
}

void main();
