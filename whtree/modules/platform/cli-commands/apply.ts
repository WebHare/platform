import { type ConfigurableSubsystem, configurableSubsystems, applyConfiguration, type ApplyConfigurationOptions } from '@mod-platform/js/configure/applyconfig';
import { program } from 'commander';

async function main() {
  program
    .name('apply')
    .option('-v, --verbose', 'verbose mode')
    .option('-f, --force', 'force updates even if no changes detected')
    .option('--module <modules>', 'limit to these modules (comma separated, not supported by all updates')
    .argument('[subsystems...]', 'Subsystems to reconfigure (eg registry, wrd)');

  program.parse();
  const verbose = Boolean(program.opts().verbose);
  const force = Boolean(program.opts().force);

  //Too bad this requires an 'as' even if you 'as const' subsystems. https://stackoverflow.com/questions/52856496/typescript-object-keys-return-string
  const validsubsystems = Object.keys(configurableSubsystems) as ConfigurableSubsystem[];
  const badsubsystem = program.args.find(_ => !validsubsystems.includes(_ as ConfigurableSubsystem));
  if (badsubsystem) {
    console.error(`Invalid subsystem '${badsubsystem}' specified. Valid subsystems are: ${validsubsystems.join(", ")}`);
    process.exitCode = 1;
    program.help();
    return;
  }

  const subsystems = (program.args.length ? program.args : "all") as ConfigurableSubsystem[];
  const opts: ApplyConfigurationOptions = { subsystems, verbose, force, source: "wh apply" };
  if (program.opts().module)
    opts.modules = program.opts().module.split(',');
  await applyConfiguration(opts);
}

void main();
