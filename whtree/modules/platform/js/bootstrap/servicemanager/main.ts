/* For now: experimental service runner to replace webhare.cpp and decentral service managers
   Invoke using wh run mod::platform/js/bootstrap/servicemanager/main.ts

   When debugging us, it may be useful to run a second instance for easy restarting. To do this:
   - Start your primary instance with a different service name:
     wh console --name platform:altsm --exclude "webhare_testsuite_temp:*"
   - Start a secondary instance
     wh run mod::platform/js/bootstrap/servicemanager/main.ts --secondary -v --include "webhare_testsuite_temp:*"

  If you're stuck with a lot of stray processes on OSX an effective way to kill them all is:
  kill $(ps ewwax|grep ' WEBHARE_SERVICEMANAGERID=' | cut -d' ' -f1)
*/

import * as fs from 'node:fs';
import * as os from 'node:os';
import { debugFlags } from "@webhare/env/src/envbackend";
import { backendConfig, logError } from "@webhare/services/src/services";
import { storeDiskFile } from "@webhare/system-tools/src/fs";
import * as child_process from "child_process";
import { createDeferred, generateRandomId, sleep, wildcardsToRegExp } from "@webhare/std";
import { getCompileServerOrigin, getRescueOrigin } from "@mod-system/js/internal/configuration";
import { RotatingLogFile } from "../../logging/rotatinglogfile";
import runBackendService from '@mod-system/js/internal/webhareservice';
import { program } from 'commander'; //https://www.npmjs.com/package/commander
import { LoggableRecord } from "@webhare/services/src/logmessages";
import bridge from '@mod-system/js/internal/whmanager/bridge';
import { getAllServices } from './gatherservices';
import { defaultShutDownStage, ServiceDefinition, Stage, shouldRestartService } from './smtypes';

program.name("servicemanager")
  .option("-s, --secondary", "Mark us as a secondary service manager")
  .option("-v, --verbose", "Verbose logging (also set by 'startup' debug flag)")
  .option("--name [servicename]", "Name for the backend service to manage us", "platform:servicemanager")
  .option("--include <mask>", "Only manage services that match this mask", "")
  .option("--exclude <mask>", "Do not manage services that match this mask", "")
  .parse();

export let currentstage = Stage.Bootup;
const DefaultTimeout = 5000;
///minimum time the proces must be running before we throttle startup
const MinimumRunTime = 60000;
///maximum startup delay
const MaxStartupDelay = 60000;
const MaxLineLength = 512;
const isSecondaryManager: boolean = program.opts().secondary;
const verbose = program.opts().verbose || debugFlags.startup;
const ServiceManagerId = process.env.WEBHARE_SERVICEMANAGERID || generateRandomId("base64url");

const setProcessTitles = os.platform() === "linux";
const setTerminalTitles = os.platform() === "darwin";

let keepAlive: NodeJS.Timeout | null = null;
let shuttingdown = false;
let logfile: RotatingLogFile | undefined;

const stagetitles: Record<Stage, string> = {
  [Stage.Bootup]: "Booting critical proceses",
  [Stage.StartupScript]: "Running startup scripts", //not entirely accurate, in this phase we also bootup webserver & apprunner etc
  [Stage.Active]: "Online",
  [Stage.Terminating]: "Terminating subprocesses",
  [Stage.ShuttingDown]: "Shutting down bridge and database"
};

const expectedServices = new Map<string, ServiceDefinition>();
const processes = new Map<string, ProcessManager>;
const finishedWaitForCompletionServices = new Set<string>;

function smLog(text: string, data?: LoggableRecord) {
  if (!logfile) {
    console.error("** This smLog() call happened too early!");
    console.error(text);
    console.error(data);
    console.error((new Error).stack);
    return;
  }

  logfile.log(text, data);
}

function updateTitle(title: string) {
  if (setProcessTitles)
    process.title = title || "";
  if (setTerminalTitles)
    process.stdout.write(String.fromCharCode(27) + "]0;" + title + String.fromCharCode(7));
}

class ProcessManager {
  readonly name;
  readonly displayName;
  readonly service;
  process: ReturnType<typeof child_process.spawn> | null = null;
  stdout = "";
  stderr = "";
  running = false;
  toldToStop = false;
  stopDefer = createDeferred();
  killTimeout: NodeJS.Timeout | null = null;
  started: number | null = null;
  startDelay;
  startDelayTimer: NodeJS.Timeout | null = null;

  constructor(name: string, service: ServiceDefinition, startDelay = 0) {
    this.name = name;
    this.displayName = name.startsWith("platform:") ? name.substring(9) : name;
    this.service = service;
    this.startDelay = startDelay;
    processes.set(name, this);

    this.startDelayTimer = setTimeout(() => this.start(), startDelay);
  }

  log(text: string, data?: LoggableRecord) {
    const at = this.started ? Date.now() - this.started : null;
    smLog(`${this.displayName}: ${text}`, { message: text, service: this.name, at, ...data });
  }

  start() {
    const cmd = this.service.cmd[0].includes('/') ? this.service.cmd[0] : `${backendConfig.installationroot}bin/${this.service.cmd[0]}`;
    const args = this.service.cmd.slice(1);

    this.started = Date.now();
    this.startDelayTimer = null;
    this.process = child_process.spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],  //no STDIN, we catch the reset
      detached: true, //separate process group so a terminal CTRL+C doesn't get sent to our subs (And we get to properly shut them down)
      env: {
        ...process.env,
        ///Unique ID to find children
        WEBHARE_SERVICEMANAGERID: ServiceManagerId,
        //Prevent manual compiles for processes started through us (We'll manage whcompile)
        WEBHARE_NOMANUALCOMPILE: "1",
        //For backwards compatibility, don't leak these. Maybe we should set them and inherit them everywhere, but it currently breaks starting other node-based services (Eg chatplane)
        NODE_PATH: "",
        NODE_OPTIONS: ""
      }
    });

    this.process.stdout!.on('data', data => this.processOutput("stdout", data));
    this.process.stderr!.on('data', data => this.processOutput("stderr", data));
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
      this.log(line, { stream });
  }

  processStarted() {
    this.running = true;
  }

  processExit(exitCode: number | null, signal: string | null) {
    for (const stream of ["stdout", "stderr"] as const)
      if (this[stream])
        this.renderOutput(stream, [this[stream]]);

    if (this.killTimeout)
      clearTimeout(this.killTimeout);

    this.running = false;
    if (!this.toldToStop || debugFlags.startup) {
      if (signal)
        this.log(`Exited with signal ${signal}`, { exitSignal: signal });
      else if (exitCode || !this.service.waitForCompletion) //no need to mention a normal shutdown for a singleshot service
        this.log(`Exited with code ${exitCode} `, { exitCode: exitCode });
    }

    const exitreason = signal ?? exitCode ?? "unknown";
    if (!this.toldToStop && this.service.ciriticalForStartup && currentstage < Stage.Active) {
      this.log(`Exit is considered fatal, shutting down service manager`);
      shutdown();
    }

    this.stopDefer.resolve(exitreason);

    if (this.service.waitForCompletion)
      finishedWaitForCompletionServices.add(this.name);
    if (processes.get(this.name) === this)
      processes.delete(this.name);

    if (!shuttingdown && !this.service.waitForCompletion) {
      if (!this.started || Date.now() < this.started + MinimumRunTime) {
        this.startDelay = Math.min(this.startDelay * 2 || 1000, MaxStartupDelay);
        this.log(`Throttling, will restart after ${this.startDelay / 1000} seconds`);
      } else {
        this.startDelay = 0;
        this.log(`Restarting`);
      }
      new ProcessManager(this.name, this.service, this.startDelay);
    }
  }

  async stop() {
    if (this.startDelayTimer) {
      clearTimeout(this.startDelayTimer);
      this.startDelayTimer = null;
    }
    if (!this.running)
      return;

    this.toldToStop = true;
    if (verbose)
      this.log(`Stopping service`);
    this.process!.kill(this.service.stopSignal ?? "SIGTERM");

    const timeout = this.service.stopTimeout ?? DefaultTimeout;
    if (timeout !== Infinity) {
      this.killTimeout =
        setTimeout(() => {
          if (this.running) {
            this.log(`Killing service - timeout of ${timeout}ms to shutdown reached`);
            this.process!.kill("SIGKILL");
          }
        }, timeout);
    }

    return await this.stopDefer.promise;
  }
}

/// Move to a new stage
async function startStage(stage: Stage): Promise<void> {
  if (verbose)
    smLog(`Entering stage: ${stagetitles[stage]} `, { stage: stagetitles[stage] }); //TODO shouldn't we be logging a tag/string instead of a full title
  currentstage = stage;
  return await updateForCurrentStage();
}

function updateVisibleState() {
  updateTitle(`webhare: ${stagetitles[currentstage]} - ${backendConfig.servername}`);
}

/// Actually apply the current stage. Also used when configurationchanges
async function updateForCurrentStage(): Promise<void> {
  updateVisibleState();

  const subpromises = [];
  for (const process of [...processes.values()]) {
    if (!expectedServices.has(process.name))
      subpromises.push(process.stop());
  }

  for (const [name, service] of expectedServices.entries()) {
    /* When waitForCompletion is true, the script should be running when we're in the startIn stage and the
        script hasn't finished yet.
        If it is false, the script should be running when we're in between the startIn stage and the stopIn stage.
    */
    const shouldRunNow = service.waitForCompletion ?
      currentstage === service.startIn && !finishedWaitForCompletionServices.has(name) :
      service.startIn <= currentstage && currentstage < (service.stopIn ?? defaultShutDownStage);

    let process = processes.get(name);
    if (process && !shouldRunNow) {
      subpromises.push(process.stop());
    } else if (shouldRunNow) {
      if (process && !service.waitForCompletion && shouldRestartService(process.service, service)) {
        // Wait for it to stap, don't want to overlap with the new service instance
        await process.stop();
        process = undefined;
      }
      if (!process) {
        const proc = new ProcessManager(name, service);
        if (service.waitForCompletion)
          subpromises.push(proc.stopDefer.promise); //TODO should we have a timeout? (but what do you do if it hits? terminate? move to next stage?)
      }
    }
  }

  await Promise.all(subpromises);
}

async function waitForCompileServer() {
  // eslint-disable-next-line no-unmodified-loop-condition -- it's modified through the signal handler
  while (!shuttingdown) {
    try {
      await fetch(getCompileServerOrigin());
      return;
    } catch (e) {
      await sleep(100);
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

class ServiceManagerClient {
  getWebHareState() {
    return {
      stage: stagetitles[currentstage],
      availableServices: [...expectedServices.entries()].map(([name, service]) => ({
        name
      }))
    };
  }
  async reload() {
    await loadServiceList(); //we block this so the service will be visible in the next getWebhareState from this client
    updateForCurrentStage(); //I don't think we need to block clients on startup of services ? they can wait themselves
  }
}

async function loadServiceList() {
  const include = program.opts().include ? new RegExp(wildcardsToRegExp(program.opts().include)) : null;
  const exclude = program.opts().exclude ? new RegExp(wildcardsToRegExp(program.opts().exclude)) : null;
  const allservices = Object.entries(await getAllServices());
  const removeServices = new Set(expectedServices.keys());

  for (const [name, servicedef] of allservices) {
    if ((include && !include.test(name)) || (exclude && exclude.test(name)) || (isSecondaryManager && !include))
      continue;

    expectedServices.set(name, servicedef);
    removeServices.delete(name);
  }

  for (const service of removeServices) {
    expectedServices.delete(service);
  }
}

async function startBackendService() {
  // eslint-disable-next-line no-unmodified-loop-condition -- modified by signals
  for (; !shuttingdown;) {
    try {
      //FIXME do we need to wait for the bridge to be ready? do we auto reregister when the bridge comes back?
      await runBackendService(program.opts().name, () => new ServiceManagerClient, { autoRestart: false, dropListenerReference: true });
      break;
    } catch (e) {
      smLog(`Service manager backend service failed with error: ${e}`);
      await sleep(1000);
    }
  }
}

async function main() {
  if (!backendConfig.dataroot) {
    console.error("Cannot start WebHare. Data root not set");
    return 1;
  }

  keepAlive = setInterval(() => { }, 1000 * 60 * 60 * 24); //keep us alive

  //TODO check if webhare isn't already running when not started with --secondary

  //Setting up logs must be one of the first things we do so log() works
  fs.mkdirSync(backendConfig.dataroot + "log", { recursive: true });
  logfile = new RotatingLogFile(isSecondaryManager ? null : backendConfig.dataroot + "log/servicemanager", { stdout: true });

  await loadServiceList();
  bridge.on("event", event => {
    if (event.name === "system:configupdate")
      setImmediate(() => updateVisibleState()); //ensure the bridge is uptodate (TODO can't we have bridge's updateConfig signal us so we're sure we're not racing it)
    if (event.name === "system:modulesupdate") {
      loadServiceList().then(() => updateForCurrentStage()).catch(e => logError(e));
    }
  });

  const showversion = process.env.WEBHARE_DISPLAYBUILDINFO ?? backendConfig.buildinfo.version ?? "unknown";
  smLog(`Starting WebHare ${showversion} in ${backendConfig.dataroot} at ${getRescueOrigin()}`, { version: showversion });

  //remove old servicestate files
  if (!isSecondaryManager) {
    unlinkServicestateFiles();
    storeDiskFile(backendConfig.dataroot + ".webhare.pid", process.pid.toString() + "\n", { overwrite: true });
  }

  await startStage(Stage.Bootup);
  if (!isSecondaryManager)
    await waitForCompileServer();

  startBackendService();

  if (!shuttingdown)
    await startStage(Stage.StartupScript);
  if (!shuttingdown)
    await startStage(Stage.Active); //TODO we should run the poststart script instead of execute tasks so we can mark when that's done. as that's when we are really online

  return 0;
}

async function shutdownSignal(signal: NodeJS.Signals) {
  smLog(`Received signal '${signal}'${shuttingdown ? ' but already shutting down' : ', shutting down'}`, { signal, wasShuttingDown: shuttingdown });
  shutdown();
}

async function stopContinueSignal(signal: NodeJS.Signals) {
  smLog(`Received signal '${signal}'`, { signal });

  //forward STOP and CONT to subprocesses
  for (const proc of [...processes.values()])
    if (proc.process?.pid) //we need to send the STOP/CONT to the whole process group (hence negative pid). doesn't work for postgres though, its subproceses are in a different group
      process.kill(-proc.process?.pid, signal === "SIGTSTP" ? "SIGSTOP" : signal);

  await sleep(100);
  if (signal === "SIGTSTP") //if we received a stop, now stop ourselves
    process.kill(process.pid, "SIGSTOP");
}

async function shutdown() {
  if (shuttingdown)
    return;
  if (keepAlive)
    clearTimeout(keepAlive);

  shuttingdown = true;
  await startStage(Stage.Terminating);
  await startStage(Stage.ShuttingDown);
  updateTitle('');

  if (!isSecondaryManager) {
    try {
      fs.unlinkSync(backendConfig.dataroot + ".webhare.pid");
    } catch (e) {
      console.error("Failed to remove webhare.pid file", e);
    }
  }
}

process.on("SIGINT", shutdownSignal);
process.on("SIGTERM", shutdownSignal);
process.on("SIGTSTP", stopContinueSignal);
process.on("SIGCONT", stopContinueSignal);
process.on("uncaughtException", (err, origin) => {
  console.error("Uncaught exception", err, origin);
  shutdown();
  smLog(`Uncaught exception`, { error: String(err), origin: String(origin) });
});

main().then(exitcode => { process.exitCode = exitcode; }, e => console.error(e));

export type { ServiceManagerClient, ProcessManager };
