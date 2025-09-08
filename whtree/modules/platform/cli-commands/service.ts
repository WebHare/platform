// @webhare/cli: Control the WebHare service manager

import { getAllServices, getServiceManagerChildPids, getSpawnSettings } from '@mod-platform/js/bootstrap/servicemanager/gatherservices';
import type { ServiceDefinition } from '@mod-platform/js/bootstrap/servicemanager/smtypes';
import { launchService } from '@mod-platform/js/nodeservices/runner';
import { getExtractedConfig } from '@mod-system/js/internal/configuration';
import type { BackendServiceDescriptor } from '@mod-system/js/internal/generation/gen_extracts';
import { openBackendService, type GetBackendServiceInterface } from '@webhare/services';
import { CLIRuntimeError, run } from "@webhare/cli";
import { spawn } from 'child_process';
import { kill } from 'process';

type ServiceManagerClient = GetBackendServiceInterface<"platform:servicemanager">;

async function startService(smservice: ServiceManagerClient, service: string) {
  const result = await smservice.startService(service);
  if (result.errorMessage)
    throw new CLIRuntimeError(result.errorMessage);
}

async function stopService(smservice: ServiceManagerClient, service: string) {
  const result = await smservice.stopService(service);
  if (result.errorMessage)
    throw new CLIRuntimeError(result.errorMessage);
}

async function runBackendServiceInDebug(service: string, serviceinfo: BackendServiceDescriptor) {
  const servicename = serviceinfo.coreService ? "platform:coreservices" : "platform:nodeservices" as const;
  const nodeservices = await openBackendService(servicename);

  await nodeservices.suppress(service);
  void launchService(serviceinfo);
}

async function runServiceInDebug(service: string, serviceinfo: ServiceDefinition) {
  const smservice = await openBackendService("platform:servicemanager");
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

run({
  description: 'Control the WebHare service manager',
  subCommands: {
    "list": {
      description: "List all services",
      main: async ({ opts, args }) => {
        const smservice = await openBackendService("platform:servicemanager");
        const state = await smservice.getWebHareState();
        console.table(state.availableServices);
      }
    },
    "relaunch": {
      description: "Relaunch the service manager",
      main: async ({ opts, args }) => {
        const smservice = await openBackendService("platform:servicemanager");
        try {
          await smservice.relaunch();
        } catch (ignore) { } //Our connection will crash due to bridge reboot. TODO if we ever switch to direct IPC connections we should be able to stay alive!
      }
    },
    "reload": {
      description: "Tell the servicemanager to reload the module list",
      main: async ({ opts, args }) => {
        const smservice = await openBackendService("platform:servicemanager");
        await smservice.reload();
      }
    },
    "start": {
      description: "Start a service",
      arguments: [{ name: "<service>", description: "Service name" }],
      main: async ({ opts, args }) => {
        const smservice = await openBackendService("platform:servicemanager");
        await startService(smservice, args.service);
      }
    },
    "stop": {
      description: "Stop a service",
      arguments: [{ name: "<service>", description: "Service name" }],
      main: async ({ opts, args }) => {
        const smservice = await openBackendService("platform:servicemanager");
        await stopService(smservice, args.service);
      }
    },
    "debug": {
      description: "Debug a service",
      arguments: [{ name: "<service>", description: "Service name" }],
      main: async ({ opts, args }) => {
        const serviceinfo = (await getAllServices())[args.service];
        if (serviceinfo) {
          await runServiceInDebug(args.service, serviceinfo);
          return;
        }

        const backendservice = getExtractedConfig("services").backendServices.find((s) => s.name === args.service);
        if (backendservice) {
          await runBackendServiceInDebug(args.service, backendservice);
          return;
        }

        console.error(`No such service '${args.service}'`);
        process.exit(1);
      }
    },
    "restart": {
      description: "Restart a service",
      arguments: [{ name: "<service>", description: "Service name" }],
      main: async ({ opts, args }) => {
        const smservice = await openBackendService("platform:servicemanager");
        const result = await smservice.restartService(args.service);
        if (result.errorMessage) {
          console.error(result.errorMessage);
          process.exit(1);
        }
        console.log("Service restarting");
      }
    },
    "force-terminate-all": {
      description: "Terminate or kill all child processes of this service manager",
      flags: {
        "kill": { description: "Use kill instead of terminate" },
        "quiet": { description: "Do not report it if no child processes are found" }
      },
      main: async ({ opts, args }) => {
        const pids = await getServiceManagerChildPids();
        if (pids.length === 0) {
          if (!opts.quiet)
            console.error("No child processes found");

          return;
        }

        for (const pid of pids) {
          try {
            kill(pid, opts.kill ? "SIGKILL" : "SIGTERM");
          } catch (e) {
            //ignore
          }
        }
      }
    }
  }
});
