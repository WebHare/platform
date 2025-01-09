// short: Updates all generated files (eg database definitions)
// @webhare/cli: allowautocomplete

import { updateGeneratedFiles } from '@mod-system/js/internal/generation/generator';
import { generatorTypes, type GeneratorType } from '@mod-system/js/internal/generation/shared';
import { run } from "@webhare/cli";

run({
  flags: {
    "v,verbose": { description: "Show extra info" },
    "dryrun": { description: "Do not actually rewrite files" },
    "nodb": { description: "Do not access the database" }
  }, options: {
    "only": { description: `Update specific targets only (one or more of ${generatorTypes.join(", ")}})` }
  },
  main: async ({ opts }) => {
    const only = (opts.only ? opts.only.split(',') : ["all"]) as Array<(GeneratorType | "all")>;
    if (opts.verbose)
      console.time("Updating generated files");
    try {
      await updateGeneratedFiles(only, { verbose: opts.verbose, nodb: opts.nodb, dryRun: opts.dryrun });
    } finally {
      if (opts.verbose)
        console.timeEnd("Updating generated files");
    }
  }
});
