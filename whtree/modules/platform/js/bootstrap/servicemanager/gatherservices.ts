import { backendConfig, resolveResource, toFSPath } from "@webhare/services";
import { ModDefYML, getAllModuleYAMLs } from '@webhare/services/src/moduledefparser';
import { ServiceDefinition, Stage } from './smtypes';
import { ManagedServices } from "@mod-platform/generated/schema/moduledefinition";

const earlywebserver = process.env.WEBHARE_WEBSERVER === "node";

const defaultServices: Record<string, ServiceDefinition> = {
  /* Bootup stage. Here we bring up all passive services that WebHare scripts will need
  */
  "platform:whmanager": {
    cmd: ["whmanager"],
    startIn: Stage.Bootup,
    stopIn: Stage.ShuttingDown,
    ciriticalForStartup: true,
    run: "always"
  },
  "platform:database": {
    cmd: ["postgres.sh"],
    startIn: Stage.Bootup,
    stopIn: Stage.ShuttingDown,
    ciriticalForStartup: true,
    /* To terminate the postgres server normally, the signals SIGTERM, SIGINT, or SIGQUIT can be used. The first will wait for all clients to terminate before
       quitting, the second will forcefully disconnect all clients, and the third will quit immediately without proper shutdown, resulting in a recovery run during restart.
    */
    stopSignal: "SIGINT",
    run: "always"
  },
  "platform:harescript-compiler": {
    cmd: ["whcompile", "--listen"],
    startIn: Stage.Bootup,
    stopIn: Stage.ShuttingDown, //it's passive and early termination only creates noise, so keep it a bit longer
    ciriticalForStartup: true,
    run: "always"
  },
  /** The startup stage is executed as soon as the HareScript compiler is responsive
   *
   * webhareservice-startup.ts will run the legacy webhareservice-startup.whscr as soon as basic configuration is in place
   */
  "platform:webserver": {
    cmd: ["webserver.sh"],
    //The node webserver doesn't need to wait for the compileserver so launch it right away
    startIn: earlywebserver ? Stage.Bootup : Stage.StartupScript,
    run: "always"
  },
  "platform:webhareservice-startup": {
    cmd: ["wh", "run", "mod::system/scripts/internal/webhareservice-startup.ts"],
    startIn: Stage.StartupScript,
    run: "once"
  },
  /// Cluster services enable mutexes (and also set up some after-commit handlers). The startup scripts should not attempt to use cluster services (nothing runs parallelo them anyway)
  "platform:clusterservices": {
    cmd: ["runscript", "--workerthreads", "4", "mod::system/scripts/internal/clusterservices.whscr"],
    startIn: Stage.StartupScript,
    stopIn: Stage.ShuttingDown, //it'll otherwise quickly cause other scripts to crash with a lost connection
    run: "always"
  }
};

export function getSpawnSettings(serviceManagerId: string, service: ServiceDefinition) {
  const cmd = service.cmd[0].includes('/') ? service.cmd[0] : `${backendConfig.installationroot}bin/${service.cmd[0]}`;
  const args = service.cmd.slice(1);

  return {
    cmd, args, env: {
      ...process.env,
      ///Unique ID to find children  - get from root servicemanager?
      WEBHARE_SERVICEMANAGERID: serviceManagerId,
      //Prevent manual compiles for processes started through us (We'll manage whcompile)
      WEBHARE_NOMANUALCOMPILE: "1",
      //For backwards compatibility, don't leak these. Maybe we should set them and inherit them everywhere, but it currently breaks starting other node-based services (Eg chatplane)
      NODE_PATH: "",
      NODE_OPTIONS: ""
    }
  };
}

function getServiceCommand(mod: ModDefYML, servicedef: ManagedServices[number]): string[] {
  if (servicedef?.script.endsWith(".sh"))
    return [toFSPath(resolveResource(mod.baseResourcePath, servicedef.script)), ...(servicedef?.arguments ?? [])];

  const runner = servicedef?.script.endsWith(".whscr") && servicedef?.engine === "wasm" ? "runwasm" : "run";
  return ["wh", runner, resolveResource(mod.baseResourcePath, servicedef.script), ...(servicedef?.arguments ?? [])];
}

export async function gatherManagedServices(): Promise<Record<string, ServiceDefinition>> {
  const services: Record<string, ServiceDefinition> = {};

  for (const mod of await getAllModuleYAMLs()) {
    if (mod.managedServices)
      for (const [name, servicedef] of Object.entries(mod.managedServices)) {
        if (servicedef?.script) {
          services[`${mod.module}:${name}`] = {
            cmd: getServiceCommand(mod, servicedef),
            startIn: Stage.Active,
            run: servicedef.run
          };
        }
      }
  }

  return services;
}

export async function getAllServices() {
  return { ...await gatherManagedServices(), ...defaultServices };
}
