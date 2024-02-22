import { getAllServices, getSpawnSettings } from '@mod-platform/js/bootstrap/servicemanager/gatherservices';
import { connectSM } from '@mod-platform/js/bootstrap/servicemanager/smclient';
import { ServiceDefinition } from '@mod-platform/js/bootstrap/servicemanager/smtypes';
import { spawn } from 'child_process';
import { program } from 'commander'; //https://www.npmjs.com/package/commander

//short: Control the WebHare service manager

type ServiceManagerClient = Awaited<ReturnType<typeof connectSM>>;

async function startService(smservice: ServiceManagerClient, service: string) {
  const result = await smservice.startService(service);
  if (result.errorMessage) {
    console.error(result.errorMessage);
    process.exit(1);
  }
}

async function stopService(smservice: ServiceManagerClient, service: string) {
  const result = await smservice.stopService(service);
  if (result.errorMessage) {
    console.error(result.errorMessage);
    process.exit(1);
  }
}

async function runServiceInDebug(service: string, serviceinfo: ServiceDefinition) {
  const smservice = await connectSM();
  const state = await smservice.getWebHareState();
  const wasrunning = state.availableServices.find(s => s.name === service)?.isRunning;
  if (wasrunning) {
    console.log(`Shutting down the existing '${service}' service`);
    await stopService(smservice, service);
  }

  let abort = false;
  process.on("SIGINT", function () {
    console.log("Service debugger received SIGINT, aborting");
    abort = true;
  });

  do {
    const spawnsettings = getSpawnSettings(state.serviceManagerId, serviceinfo);
    console.log(`Starting service with command: ${spawnsettings.cmd} ${spawnsettings.args.join(" ")}`);
    const proc = spawn(spawnsettings.cmd, spawnsettings.args, {
      stdio: [0, 1, 2],
      env: {
        ...spawnsettings.env,
        WEBHARE_DEBUG_SERVICE: "1"
      }
    });

    const exitinfo = await new Promise<number | string>(resolve =>
      proc.on("exit", (code: number, signal: string) => resolve(signal || code)));
    console.log("Service process exited with:", exitinfo);
    // eslint-disable-next-line no-unmodified-loop-condition -- it's modified by the SIGINT handler
  } while (!abort);

  if (wasrunning) {
    console.log(`Restarting the stopped '${service}' service`);
    await startService(smservice, service);
  }
}

program.name("service")
  .description('Control the WebHare service manager');

program.command("list")
  .description("List all services")
  .action(async () => {
    const smservice = await connectSM();
    const state = await smservice.getWebHareState();
    console.table(state.availableServices);
  });

program.command("reload")
  .description("Tell the servicemanager to reload the module list")
  .action(async () => {
    const smservice = await connectSM();
    await smservice.reload();
  });

program.command("start")
  .description("Start a service")
  .argument("<service>", "Service name")
  .action(async (service: string) => {
    const smservice = await connectSM();
    const result = await smservice.startService(service);
    if (result.errorMessage) {
      console.error(result.errorMessage);
      process.exit(1);
    }
    console.log("Service starting");
  });

program.command("stop")
  .description("Stop a service")
  .argument("<service>", "Service name")
  .action(async (service: string) => {
    const smservice = await connectSM();
    const result = await smservice.stopService(service);
    if (result.errorMessage) {
      console.error(result.errorMessage);
      process.exit(1);
    }
    console.log("Service stopping");
  });

program.command("debug")
  .description("Debug a service")
  .argument("<service>", "Service name")
  .action(async (service: string) => {
    const serviceinfo = (await getAllServices())[service];
    if (!serviceinfo) {
      console.error(`No such service "${service}"`);
      process.exit(1);
    }

    await runServiceInDebug(service, serviceinfo);
  });

program.command("restart")
  .description("Restart a service")
  .argument("<service>", "Service name")
  .action(async (service: string) => {
    const smservice = await connectSM();
    const result = await smservice.restartService(service);
    if (result.errorMessage) {
      console.error(result.errorMessage);
      process.exit(1);
    }
    console.log("Service restarting");
  });

program.addHelpCommand();
program.parse();
