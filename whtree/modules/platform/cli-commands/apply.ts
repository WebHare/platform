// short: Reconfigures part of all of WebHare
// @webhare/cli: allowautocomplete

import { type ConfigurableSubsystem, configurableSubsystems, type ApplyConfigurationOptions, executeApply, type ConfigurableSubsystemPart } from '@mod-platform/js/configure/applyconfig';
import { program } from 'commander';
import { run } from "@webhare/cli";
import { applyConfiguration } from '@webhare/services';

run({
  flags: {
    "v,verbose": { description: "Verbose mode" },
    "f,force": { description: "Force updates even if no changes detected" },
    "nodb": { description: "Do not access the database" },
    "offline": { description: "Do not use the apply backend service (dangerous if WebHare is running!)" },
  }, options: {
    "modules": { description: "Limit to these modules (comma separated, not supported by all updates)" }
  }, arguments:
    [{ name: "<subsystems...>", description: "Subsystems to reconfigure (eg registry, wrd) or 'all" }],
  main: async ({ opts, args }) => {

    //Too bad this requires an 'as' even if you 'as const' subsystems. https://stackoverflow.com/questions/52856496/typescript-object-keys-return-string
    const validsubsystems = Object.keys(configurableSubsystems) as ConfigurableSubsystem[];
    const badsubsystem = program.args.find(_ => !validsubsystems.includes(_.split('.')[0] as ConfigurableSubsystem));
    if (badsubsystem) {
      console.error(`Invalid subsystem '${badsubsystem}' specified. Valid subsystems are: ${validsubsystems.join(", ")}`);
      process.exitCode = 1;
      program.help();
      return;
    }

    const toApply: ApplyConfigurationOptions = {
      subsystems: args.subsystems as ConfigurableSubsystemPart[],
      verbose: opts.verbose,
      force: opts.force,
      nodb: opts.nodb,
      source: "wh apply"
    };

    if (opts.modules)
      toApply.modules = program.opts().module.split(',');
    if (opts.offline)
      await executeApply({ ...toApply, offline: true });
    else { //use the service
      if (opts.verbose) //until we get some sort of console-events back from the service:
        console.log("Please note that 'wh apply' verbose info is usually logged to the servicemanager.log");
      await applyConfiguration(toApply);
    }
  }
});
