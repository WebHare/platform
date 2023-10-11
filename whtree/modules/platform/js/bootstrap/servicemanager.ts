/* For now: experimental service runner to replace webhare.cpp and decentral service managers
   Invoke using wh run mod::platform/js/bootstrap/servicemanager.ts
*/

import * as fs from 'node:fs';
import { debugFlags } from "@webhare/env/src/envbackend";
import { backendConfig } from "@webhare/services/src/services";
import { storeDiskFile } from "@webhare/system-tools/src/fs";
import * as child_process from "child_process";
import { createDeferred, sleep } from "@webhare/std";
import { getCompileServerOrigin, getRescueOrigin } from "@mod-system/js/internal/configuration";
import { RotatingLogFile } from "../logging/rotatinglogfile";

enum Stages { Bootup, StartupScript, Active, Terminating, ShuttingDown }
let currentstage = Stages.Bootup;
const DefaultShutdownStage = Stages.Terminating;
const DefaultTimeout = 5000;
const MaxLineLength = 512;
const earlywebserver = process.env.WEBHARE_WEBSERVER == "node";
let shuttingdown = false;
let logfile;

interface ServiceDefinition {
  cmd: string[];
  startIn: Stages;
  ///stopIn should be used by passive services (ie that only respond to others) to stay up as active processes get terminated, mostly to reduce screams in the log
  stopIn?: Stages;
  ///stopSignal (defaults to SIGTERM)
  stopSignal?: NodeJS.Signals;
  ///Restart this service if it fails?
  keepAlive: boolean;
  ///override the stopTimeout. we used to do this for the WH databse server
  stopTimeout?: number;
  isExitFatal?: (terminationcode: string | number) => boolean;
  current?: ProcessManager;
}

const stagetitles: Record<Stages, string> = {
  [Stages.Bootup]: "Booting critical proceses",
  [Stages.StartupScript]: "Running startup scripts", //not entirely accurate, in this phase we also bootup webserver & apprunner etc
  [Stages.Active]: "Online",
  [Stages.Terminating]: "Terminating subprocesses",
  [Stages.ShuttingDown]: "Shutting down bridge and database"
};

const expectedServices: Record<string, ServiceDefinition> = {
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
    keepAlive: false
  },
  "platform:apprunner": {
    cmd: ["runscript", "mod::system/scripts/internal/apprunner.whscr"],
    startIn: Stages.Active,
    keepAlive: true
  },
  "platform:clusterservices": {
    cmd: ["runscript", "--workerthreads", "4", "mod::system/scripts/internal/clusterservices.whscr"],
    startIn: Stages.StartupScript,
    stopIn: Stages.ShuttingDown, //it'll otherwise quickly cause other scripts to crash with a lost connection
    keepAlive: true
  }
};

class ProcessManager {
  readonly name;
  readonly displayName;
  readonly service;
  process;
  stdout = "";
  stderr = "";
  running = false;
  toldToStop = false;
  stopDefer = createDeferred();
  killTimeout: NodeJS.Timeout | null = null;

  constructor(name: string, service: ServiceDefinition) {
    this.name = name;
    this.displayName = name.startsWith("platform:") ? name.substring(9) : name;
    this.service = service;
    service.current = this;
    processes.add(this);

    const cmd = service.cmd[0].includes('/') ? service.cmd[0] : `${backendConfig.installationroot}bin/${service.cmd[0]}`;
    const args = service.cmd.slice(1);
    if (debugFlags.startup)
      log(`Starting ${name}: ${cmd}${args.length ? ` with ${JSON.stringify(args)}` : ""}`);

    this.process = child_process.spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],  //no STDIN, we catch the reset
      detached: true, //separate process group so a terminal CTRL+C doesn't get sent to our subs (And we get to properly shut them down)
      env: {
        ...process.env,
        //Prevent manual compiles for processes started through us (WE'll manage whcompile)
        WEBHARE_NOMANUALCOMPILE: "1",
        //For backwards compatibility, don't leak these. Maybe we should set them and inherit them everywhere, but it currently breaks starting other node-based services (Eg chatplane)
        NODE_PATH: "",
        NODE_OPTIONS: ""
      }
    });

    this.process.stdout.on('data', data => this.processOutput("stdout", data));
    this.process.stderr.on('data', data => this.processOutput("stderr", data));
    this.process.on("spawn", () => this.processStarted());
    this.process.on("exit", (code, signal) => this.processExit(code, signal));
  }

  processOutput(stream: "stdout" | "stderr", text: string) {
    this[stream] += text;
    if (this[stream].includes("\n")) {
      const lines = this[stream].split("\n");
      this[stream] = lines.pop() || "";
      this.renderOutput(stream, lines);
    }
    if (this[stream].length > MaxLineLength) {
      this.renderOutput(stream, [this[stream]]);
      this[stream] = "";
    }
  }

  renderOutput(stream: "stdout" | "stderr", lines: string[]) {
    for (const line of lines)
      log(`${this.displayName} ${stream}: ${line}`);
  }

  processStarted() {
    this.running = true;
  }

  processExit(errorCode: number | null, signal: string | null) {
    for (const stream of ["stdout", "stderr"] as const)
      if (this[stream])
        this.renderOutput(stream, [this[stream]]);

    if (this.killTimeout)
      clearTimeout(this.killTimeout);

    this.running = false;
    if (!this.toldToStop || debugFlags.startup) {
      if (signal)
        log(`Service ${this.displayName} exited with signal ${signal} `);
      else if (errorCode || this.service.keepAlive) //no need to mention a normal shutdown for a singleshot service
        log(`Service ${this.displayName} exited with code ${errorCode} `);
    }

    const exitreason = signal ?? errorCode ?? "unknown";
    if (this.service.isExitFatal && !this.toldToStop && this.service.isExitFatal(exitreason)) {
      log(`Exit of service ${this.displayName} is considered fatal, shutting down`);
      shutdown();
    }

    this.stopDefer.resolve(exitreason);

    processes.delete(this);

    if (!shuttingdown && this.service.keepAlive) {
      log(`Restarting service ${this.displayName}`);
      new ProcessManager(this.name, this.service);
    }
  }

  async stop() {
    if (!this.running)
      return;

    this.toldToStop = true;
    this.process.kill(this.service.stopSignal ?? "SIGTERM");

    const timeout = this.service.stopTimeout ?? DefaultTimeout;
    if (timeout !== Infinity) {
      this.killTimeout =
        setTimeout(() => {
          if (this.running) {
            log(`Killing service ${this.displayName} - timeout of ${timeout}ms to shutdown reached`);
            this.process.kill("SIGKILL");
          }
        }, timeout);
    }

    return await this.stopDefer.promise;
  }
}

const processes = new Set<ProcessManager>;

async function startStage(stage: Stages): Promise<void> {
  const subpromises = [];
  process.title = `webhare: ${stagetitles[stage]} `;
  currentstage = stage;
  if (debugFlags.startup)
    log(`Starting stage: ${stagetitles[stage]} `);

  for (const process of [...processes]) {
    if ((process.service.stopIn ?? DefaultShutdownStage) === stage)
      subpromises.push(process.stop());
  }

  for (const [name, service] of Object.entries(expectedServices)) {
    if (service.startIn === stage && !service.current)
      new ProcessManager(name, service);
  }

  await Promise.all(subpromises);
}

//FIXME open the servicemanager.log. build or find a rotator. log everything there too
function log(text: string) {
  logfile!.log(text);
}

async function waitForCompileServer() {
  // eslint-disable-next-line no-unmodified-loop-condition -- it's modified through the signal handler
  while (!shuttingdown) {
    try {
      await fetch(getCompileServerOrigin());
      return;
    } catch (e) {
      await sleep(500);
    }
  }
}

function unlinkServicestateFiles() {
  try {
    const servicestatepath = backendConfig.dataroot + "ephemeral/system.servicestate";
    fs.mkdirSync(servicestatepath, { recursive: true });
    for (const file of fs.readdirSync(servicestatepath))
      fs.unlinkSync(servicestatepath + "/" + file);
  } catch (e) {
    console.error("Failed to remove service state files", e);
  }
}

/* FIXME we probably need this? webhare.cpp did it..  unless changes to 'dev' module fix it
  //Prevent subprocesses that try to access the tty (eg git asking for username/password) from stopping the webserver
  signal(SIGTTIN, SIG_IGN);
  signal(SIGTTOU, SIG_IGN);
*/

async function main() {
  if (!backendConfig.dataroot) {
    console.error("Cannot start WebHare. Data root not set");
    return 1;
  }

  fs.mkdirSync(backendConfig.dataroot + "log", { recursive: true });
  logfile = new RotatingLogFile(backendConfig.dataroot + "log/servicemanager", { stdout: true });

  const showversion = process.env.WEBHARE_DISPLAYBUILDINFO ?? backendConfig.buildinfo.version ?? "unknown";
  log(`Starting WebHare ${showversion} in ${backendConfig.dataroot} at ${getRescueOrigin()}`);

  //remove old servicestate files
  unlinkServicestateFiles();

  storeDiskFile(backendConfig.dataroot + ".webhare.pid", process.pid.toString() + "\n", { overwrite: true });

  await startStage(Stages.Bootup);
  await waitForCompileServer();

  if (!shuttingdown)
    await startStage(Stages.StartupScript);
  if (!shuttingdown)
    await startStage(Stages.Active); //TODO we should run the poststart script instead of execute tasks so we can mark when that's done. as that's when we are really online

  return 0;
}

async function shutdownSignal(signal: NodeJS.Signals) {
  log(`Received signal '${signal}', shutting down.`);
  shutdown();
}

async function shutdown() {
  shuttingdown = true;
  await startStage(Stages.Terminating);
  await startStage(Stages.ShuttingDown);
  try {
    fs.unlinkSync(backendConfig.dataroot + ".webhare.pid");
  } catch (e) {
    console.error("Failed to remove webhare.pid file", e);
  }

}

process.on("SIGINT", shutdownSignal);
process.on("SIGTERM", shutdownSignal);
process.on("uncaughtException", (err, origin) => {
  console.error("Uncaught exception", err, origin);
  shutdown();
  log(`Uncaught exception`);
});
main().then(exitcode => { process.exitCode = exitcode; }, e => console.error(e));
