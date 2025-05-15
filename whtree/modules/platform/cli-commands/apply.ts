// @webhare/cli: Reconfigures part of all of WebHare

import { type ConfigurableSubsystem, configurableSubsystems, type ApplyConfigurationOptions, executeApply, type ConfigurableSubsystemPart } from '@mod-platform/js/configure/applyconfig';
import { run } from "@webhare/cli";
import { CLISyntaxError } from '@webhare/cli/src/run';

run({
  flags: {
    "v,verbose": { description: "Verbose mode" },
    "show-unchanged": { description: "Show unchanged files" },
    "f,force": { description: "Force updates even if no changes detected" },
    "nodb": { description: "Do not access the database" },
    "offline": { description: "Do not block the apply backend service (dangerous if WebHare is running!)" },
  }, options: {
    "modules": { description: "Limit to these modules (comma separated, not supported by all updates)" }
  }, arguments:
    [{ name: "<subsystems...>", description: "Subsystems to reconfigure (eg registry, wrd) or 'all'" }],
  main: async ({ opts, args }) => {

    //Too bad this requires an 'as' even if you 'as const' subsystems. https://stackoverflow.com/questions/52856496/typescript-object-keys-return-string
    const validsubsystems = Object.keys(configurableSubsystems) as ConfigurableSubsystem[];
    const badsubsystem = args.subsystems.find(_ => _ !== 'all' && !validsubsystems.includes(_.split('.')[0] as ConfigurableSubsystem));
    if (badsubsystem)
      throw new CLISyntaxError(`Invalid subsystem '${badsubsystem}' specified. Valid subsystems are: ${validsubsystems.join(", ")}`);

    const toApply: ApplyConfigurationOptions = {
      subsystems: args.subsystems as ConfigurableSubsystemPart[],
      verbose: opts.verbose,
      force: opts.force,
      offline: opts.offline,
      nodb: opts.nodb,
      showUnchanged: opts.showUnchanged,
      source: "wh apply"
    };
    if (opts.modules)
      toApply.modules = opts.modules.split(',');

    await executeApply(toApply);
  }
});
