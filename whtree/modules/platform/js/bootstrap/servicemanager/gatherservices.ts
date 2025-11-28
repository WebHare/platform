import { backendConfig, resolveResource, toFSPath } from "@webhare/services";
import { type ModDefYML, getAllModuleYAMLs } from '@webhare/services/src/moduledefparser';
import { type ServiceDefinition, Stage, type WebHareVersionFile } from './smtypes';
import type { ManagedServices } from "@mod-platform/generated/schema/moduledefinition";
import { matchesThisServer } from "@mod-system/js/internal/generation/shared";
import { isLikeRandomId, pick } from "@webhare/std";
import { readFileSync } from "node:fs";
import { getVersionFile } from "@mod-system/js/internal/configuration";
import { spawnSync } from "node:child_process";

const defaultServices: Record<string, ServiceDefinition> = {
  /* Bootup stage. Here we bring up all passive services that WebHare scripts will need
  */
  "platform:whmanager": {
    cmd: ["whmanager"],
    startIn: Stage.Bootup,
    stopIn: Stage.ShuttingDown,
    criticalForStartup: true,
    run: "always"
  },
  "platform:database": {
    cmd: ["postgres.sh"],
    startIn: Stage.Bootup,
    stopIn: Stage.ShuttingDown,
    criticalForStartup: true,
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
    criticalForStartup: true,
    run: "always"
  },
  //The HS webserver needs *some* harescript code but that code shouldn't depend on external modules and thus be precompiled. we can launch without a ready whcompile!
  ...(process.env.WEBHARE_WEBSERVER === "node" ? {
    "platform:webserver-node": {
      cmd: ["wh", "run", "mod::platform/js/webserver/cli-webserver.ts"],
      startIn: Stage.Bootup,
      run: "always"
    },
    "platform:webserver": {
      cmd: ["webserver", "--secondary", "--dispatchers", "25"], //50 seems excessive for a secondary?
      //Our startIn should match the platform:webserver
      startIn: Stage.Bootup,
      run: "always"
    }
  } : {
    "platform:webserver": {
      cmd: ["webserver", "--dispatchers", "50"], //50 was the default but we might make it tunable ?
      startIn: Stage.Bootup,
      run: "always"
    },
  }),
  /** The startup stage is executed as soon as the HareScript compiler is responsive
   *
   * webhareservice-startup.ts will run the legacy webhareservice-startup.whscr as soon as basic configuration is in place
   */
  "platform:webhareservice-startup": {
    cmd: ["wh", "run", "mod::system/scripts/internal/webhareservice-startup.ts"],
    startIn: Stage.StartupScript,
    run: "once"
  },
  /// Cluster services enable mutexes (and also set up some after-commit handlers). The startup scripts should not attempt to use cluster services (nothing runs parallel to them anyway)
  "platform:clusterservices": {
    cmd: ["wh", "run", "--workerthreads", "4", "mod::system/scripts/internal/clusterservices.whscr"],
    startIn: Stage.StartupScript,
    stopIn: Stage.ShuttingDown, //it'll otherwise quickly cause other scripts to crash with a lost connection
    run: "always"
  },
  /// Handle core node services (only platform may register these)
  "platform:coreservices": {
    cmd: getRawCommand("mod::platform/js/nodeservices/nodeservices.ts", undefined, ["--core"]),
    startIn: Stage.StartupScript,
    stopIn: Stage.ShuttingDown,
    run: "always"
  },
  /// CLI autocompletion service
  "platform:autocompleteservice": {
    cmd: getRawCommand("mod::platform/js/cli/autocomplete-service.ts", undefined, ["--server"]),
    startIn: Stage.StartupScript,
    stopIn: Stage.ShuttingDown,
    run: "on-demand"
  },
};

export function getSpawnSettings(serviceManagerId: string, service: ServiceDefinition) {
  const cmd = service.cmd[0].includes('/') ? service.cmd[0] : `${backendConfig.installationRoot}bin/${service.cmd[0]}`;
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

function getRawCommand(resourcePath: string, engine: "native" | "wasm" | undefined, args: string[]) {
  if (resourcePath.endsWith(".sh"))
    return [toFSPath(resourcePath), ...args];

  const runner = resourcePath.endsWith(".whscr") && engine === "wasm" ? "runwasm" : "run";
  return ["wh", runner, resourcePath, ...args];
}

function getServiceCommand(mod: ModDefYML, servicedef: ManagedServices[number]): string[] {
  return getRawCommand(resolveResource(mod.baseResourcePath, servicedef.script), servicedef.engine, servicedef.arguments || []);
}

export function gatherManagedServicesFromModDef(mod: ModDefYML): Record<string, ServiceDefinition> {
  const services: Record<string, ServiceDefinition> = {};

  if (mod.managedServices)
    for (const [name, servicedef] of Object.entries(mod.managedServices)) {
      if (servicedef?.ifWebHare && !matchesThisServer(servicedef?.ifWebHare))
        continue;
      if (servicedef?.script) {
        services[`${mod.module}:${name}`] = {
          cmd: getServiceCommand(mod, servicedef),
          startIn: Stage.Active,
          run: servicedef.run,
          ...pick(servicedef, ["minRunTime", "maxThrottleMsecs"])
        };
      }
    }

  return services;
}

export async function gatherManagedServices(): Promise<Record<string, ServiceDefinition>> {
  const services: Record<string, ServiceDefinition> = {};

  for (const mod of await getAllModuleYAMLs())
    Object.assign(services, gatherManagedServicesFromModDef(mod));

  return services;
}

export async function getAllServices() {
  return { ...await gatherManagedServices(), ...defaultServices };
}

export async function getServiceManagerChildPids(): Promise<number[]> {
  try {
    const versioninfo = JSON.parse(readFileSync(getVersionFile(), 'utf8')) as WebHareVersionFile;
    if (!isLikeRandomId(versioninfo.servicemanagerid)) //unsafe to embed in a shell call otherwise
      return [];

    //The empty group () is there to prevent us from matching ourselves in the process list
    const output = spawnSync(`ps ewwax|grep -E ' WEBHARE_SERVICEMANAGERID()=${versioninfo.servicemanagerid}' | cut -d' ' -f1`, { shell: true }).output.toString().split('\n');
    const pids = output.map((line) => parseInt(line.trim())).filter((pid) => !isNaN(pid));
    return pids.filter(_ => _ !== process.pid);
  } catch (e) {
    return [];
  }
}
