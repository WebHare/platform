// Lists the installed (non-builtin) modules whose node_modules are missing or out of date, one per line. Used by wh fixmodules

import { intOption, runCli } from "@webhare/cli";
import { backendConfig } from "@webhare/services";
import { createConcurrencyLimiter } from "@webhare/std";
import { whconstant_builtinmodules } from "@mod-system/js/internal/webhareconstants";
import { checkNodeModulesInModule } from "@mod-platform/js/devsupport/npm";
import { availableParallelism } from "node:os";

runCli({
  description: "List modules with broken node_modules",
  options: {
    "j,jobs": { default: Math.min(4, availableParallelism()), description: "Number of package roots to check in parallel (defaults to the number of CPUs, at most 4)", type: intOption({ start: 1 }) }
  },
  async main({ opts }) {
    const tocheck = Object.entries(backendConfig.module).filter(([name]) => !whconstant_builtinmodules.includes(name)).sort(([a], [b]) => a.localeCompare(b));
    //Every check runs 'npm ls' for each of the module's package roots, so limit the number of 'npm ls' invocations across all modules
    const concurrencyLimiter = createConcurrencyLimiter(opts.jobs);
    const problems = await Promise.all(tocheck.map(([, mod]) => checkNodeModulesInModule(mod.root, { concurrencyLimiter })));

    for (const [idx, [name]] of tocheck.entries())
      if (problems[idx].length > 0)
        console.log(name);
  }
});
