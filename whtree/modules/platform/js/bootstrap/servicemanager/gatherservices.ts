import { resolveResource } from "@webhare/services/src/services";
import { getAllModuleYAMLs } from '@webhare/services/src/moduledefparser';
import { ServiceDefinition, Stages } from './smtypes';
import { currentstage } from "./main"; //TODO cleanup, is a mutual include

const earlywebserver = process.env.WEBHARE_WEBSERVER == "node";

const defaultServices: Record<string, ServiceDefinition> = {
  "platform:whmanager": {
    cmd: ["whmanager"],
    startIn: Stages.Bootup,
    stopIn: Stages.ShuttingDown,
    isExitFatal: () => currentstage < Stages.Active,
    keepAlive: true
  },
  "platform:database": {
    cmd: ["postgres.sh"],
    startIn: Stages.Bootup,
    stopIn: Stages.ShuttingDown,
    isExitFatal: () => currentstage < Stages.Active,
    keepAlive: true,
    /* To terminate the postgres server normally, the signals SIGTERM, SIGINT, or SIGQUIT can be used. The first will wait for all clients to terminate before
       quitting, the second will forcefully disconnect all clients, and the third will quit immediately without proper shutdown, resulting in a recovery run during restart.
    */
    stopSignal: "SIGINT"
  },
  "platform:harescript-compiler": {
    cmd: ["whcompile", "--listen"],
    startIn: Stages.Bootup,
    isExitFatal: () => currentstage < Stages.Active,
    keepAlive: true
  },
  "platform:webserver": {
    cmd: ["webserver.sh"],
    //The node webserver doesn't need to wait for the compileserver so launch it right away
    startIn: earlywebserver ? Stages.Bootup : Stages.StartupScript,
    keepAlive: true
  },
  "platform:webhareservice-startup": {
    cmd: ["runscript", "--workerthreads", "4", "mod::system/scripts/internal/webhareservice-startup.whscr"],
    startIn: Stages.StartupScript,
    keepAlive: false,
    waitForCompletion: true
  },
  "platform:clusterservices": {
    cmd: ["runscript", "--workerthreads", "4", "mod::system/scripts/internal/clusterservices.whscr"],
    startIn: Stages.StartupScript,
    stopIn: Stages.ShuttingDown, //it'll otherwise quickly cause other scripts to crash with a lost connection
    keepAlive: true
  }
};

export async function gatherManagedServices(): Promise<Record<string, ServiceDefinition>> {
  const services: Record<string, ServiceDefinition> = {};

  for (const mod of await getAllModuleYAMLs()) {
    if (mod.managedServices)
      for (const [name, servicedef] of Object.entries(mod.managedServices)) {
        if (servicedef?.script) {
          const cmd = ["wh", "run", resolveResource(mod.baseResourcePath, servicedef.script)];
          services[`${mod.module}:${name}`] = {
            cmd,
            startIn: Stages.Active,
            keepAlive: true
          };
        }
      }
  }

  return services;
}

export async function getAllServices() {
  return { ...await gatherManagedServices(), ...defaultServices };
}
