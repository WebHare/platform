/* This script is normally invoked by 'wh console'
   Invoke directly using wh run mod::platform/js/bootstrap/servicemanager/main.ts

   When debugging us, it may be useful to run a second instance for easy restarting. To do this:
   - Start your primary instance with a different service name:
     wh console --name platform:altsm --exclude "webhare_testsuite_temp:*"
   - Start a secondary instance
     wh run mod::platform/js/bootstrap/servicemanager/main.ts --secondary -v --include "webhare_testsuite_temp:*"

  If you're stuck with a lot of stray processes on OSX an effective way to kill them all is:
  kill $(ps ewwax|grep ' WEBHARE_SERVICEMANAGERID=' | cut -d' ' -f1)
*/

import { run } from "@webhare/cli";
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { debugFlags } from "@webhare/env/src/envbackend";
import { backendConfig, logError } from "@webhare/services/src/services";
import { listDirectory, storeDiskFile } from "@webhare/system-tools/src/fs";
import * as child_process from "child_process";
import { generateRandomId, regExpFromWildcards, sleep, stringify, throwError } from "@webhare/std";
import { getCompileServerOrigin, getFullConfigFile, getRescueOrigin, getVersionFile, getVersionInteger, isInvalidWebHareUpgrade } from "@mod-system/js/internal/configuration";
import { RotatingLogFile } from "../../logging/rotatinglogfile";
import { BackendServiceConnection, runBackendService } from "@webhare/services/src/backendservicerunner";
import type { LoggableRecord } from "@webhare/services/src/logmessages";
import bridge from '@mod-system/js/internal/whmanager/bridge';
import { getAllServices, getServiceManagerChildPids, getSpawnSettings } from './gatherservices';
import { defaultShutDownStage, type ServiceDefinition, Stage, shouldRestartService, type WebHareVersionFile } from './smtypes';
import { updateWebHareConfigFile } from '@mod-system/js/internal/generation/gen_config';
import { kill } from "node:process";


export let currentstage = Stage.Bootup;
const DefaultTimeout = 5000;
///minimum time the proces must be running before we throttle startup
const MinimumRunTime = 60000;
///maximum startup delay
const MaxStartupDelay = 60000;
const MaxLineLength = 512;
let verbose = false;
let startedBackendService = false;
const serviceManagerId = process.env.WEBHARE_SERVICEMANAGERID || generateRandomId("base64url");

const setProcessTitles = os.platform() === "linux";
const setTerminalTitles = os.platform() === "darwin";

let logfile: RotatingLogFile | undefined;

const stagetitles: Record<Stage, string> = {
  [Stage.Bootup]: "Booting critical proceses",
  [Stage.StartupScript]: "Running startup scripts", //not entirely accurate, in this phase we also bootup webserver & apprunner etc
  [Stage.Active]: "Online",
  [Stage.Terminating]: "Terminating subprocesses",
  [Stage.ShuttingDown]: "Shutting down bridge and database"
};

class ProcessList {
  private procs = new Map<string, ProcessManager>();
  private lingeringProcesses = new Set<ProcessManager>();

  get(name: string) {
    return this.procs.get(name);
  }
  addProc(name: string, mgr: ProcessManager) {
    const existing = this.procs.get(name);
    if (existing)
      this.lingeringProcesses.add(existing);
    this.procs.set(name, mgr);
  }
  unregister(mgr: ProcessManager) {
    if (this.lingeringProcesses.has(mgr))
      this.lingeringProcesses.delete(mgr);
    else
      this.procs.delete(mgr.name);
  }
  getAllRunning(): ProcessManager[] {
    return [...this.procs.values(), ...this.lingeringProcesses.values()];
  }
}

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

function updateVisibleState() {
  updateTitle(`webhare: ${stagetitles[currentstage]} - ${backendConfig.serverName}`);
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
  stopDefer = Promise.withResolvers();
  killTimeout: NodeJS.Timeout | null = null;
  started: number | null = null;
  startDelay;
  startDelayTimer: NodeJS.Timeout | null = null;
  lastLogText = "";

  constructor(public servicemgr: ServiceManager, name: string, service: ServiceDefinition, startDelay = 0) {
    this.name = name;
    this.displayName = name.startsWith("platform:") ? name.substring(9) : name;
    this.service = service;
    this.startDelay = startDelay;
    this.servicemgr.processes.addProc(name, this);

    this.startDelayTimer = setTimeout(() => this.start(), startDelay);
  }

  log(text: string, data?: LoggableRecord) {
    this.lastLogText = text;
    const at = this.started ? Date.now() - this.started : null;
    smLog(`${this.displayName}: ${text}`, { message: text, service: this.name, at, ...data });
  }

  start() {
    const spawnsettings = getSpawnSettings(serviceManagerId, this.service);

    this.started = Date.now();
    this.startDelayTimer = null;
    if (verbose)
      this.log(`Starting service with command: ${spawnsettings.cmd} ${spawnsettings.args.join(" ")}`, spawnsettings);
    else if (this.startDelay) //because we logged 'Throttling' we should log when we start it again
      this.log(`Restarting service after throttling for ${this.startDelay / 1000} seconds`);

    this.process = child_process.spawn(spawnsettings.cmd, spawnsettings.args, {
      stdio: ['ignore', 'pipe', 'pipe'],  //no STDIN, we catch the reset
      detached: true, //separate process group so a terminal CTRL+C doesn't get sent to our subs (And we get to properly shut them down)
      env: spawnsettings.env
    });

    this.process.stdout!.on('data', data => this.processOutput("stdout", data));
    this.process.stderr!.on('data', data => this.processOutput("stderr", data));
    this.process.on("spawn", () => this.processStarted());
    this.process.on("exit", (code, signal) => this.processExit(code, signal, null));
    this.process.on("error", err => this.processError(err));
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

  processError(e: Error) {
    if (!this.running) //an error before processStarted.
      this.processExit(null, null, e);
    else
      this.log(`Process error: ${e}`, { error: String(e) });
  }

  processExit(exitCode: number | null, signal: string | null, error: Error | null) {
    for (const stream of ["stdout", "stderr"] as const) {
      if (this[stream])
        this.renderOutput(stream, [this[stream]]);
      this.process?.[stream]?.destroy(); //prevent the streams from keeping us alive (ie if something forked off them keeping the FD open)
    }

    if (this.killTimeout)
      clearTimeout(this.killTimeout);

    this.running = false;
    if (error)
      this.log(`Failed to start: ${error.message}`, { error: error.message, stack: error.stack });
    if (signal) {
      // Ignore SIGTERM when shutting down
      if (!this.toldToStop || signal !== "SIGTERM")
        this.log(`Exited with signal ${signal}`, { exitSignal: signal });
    } else if (exitCode || verbose || (this.service.run === "always" && !this.toldToStop)) { //report on error, if it's an always-running service, or if debugging
      // Ignore exit code 207 (used when handling a SIGTERM within the WH signal handler) when shutting down
      if (!this.toldToStop || exitCode !== 207)
        this.log(`Exited with error code ${exitCode}`, { exitCode: exitCode });
    }

    const exitreason = signal ?? exitCode ?? "unknown";
    if (!this.toldToStop && this.service.criticalForStartup && currentstage < Stage.Active) {
      this.log(`Exit is considered fatal, shutting down service manager`);
      this.servicemgr.shutdown();
    }

    this.stopDefer.resolve(exitreason);

    if (this.service.run === "once")
      this.servicemgr.finishedWaitForCompletionServices.add(this.name);
    this.servicemgr.processes.unregister(this);

    const servicesettings = this.servicemgr.expectedServices.get(this.name);
    if (!this.servicemgr.shuttingDown && servicesettings?.run === "always" && !this.toldToStop) {
      if (!this.started || Date.now() < this.started + (servicesettings?.minRunTime ?? MinimumRunTime)) {
        this.startDelay = Math.min(this.startDelay * 2 || 1000, servicesettings?.maxThrottleMsecs ?? MaxStartupDelay);
        this.log(`Throttling, will restart after ${this.startDelay / 1000} seconds`);
      } else {
        this.startDelay = 0;
        this.log(`Restarting service imediately`);
      }
      new ProcessManager(this.servicemgr, this.name, servicesettings, this.startDelay);
    }
  }

  async stop() {
    if (this.startDelayTimer) {
      clearTimeout(this.startDelayTimer);
      this.startDelayTimer = null;
    }

    this.toldToStop = true;
    if (!this.running)
      return;

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

async function unlinkServicestateFiles() {
  try {
    const servicestatepath = backendConfig.dataRoot + "caches/run/";
    await fs.mkdir(servicestatepath, { recursive: true });
    for (const file of await listDirectory(servicestatepath, { mask: "servicestate.*" }))
      await fs.rm(file.fullPath);
  } catch (e) {
    console.error("Failed to remove service state files", e);
  }
}

/* FIXME we probably need this? webhare.cpp did it..  unless changes to 'dev' module fix it
  //Prevent subprocesses that try to access the tty (eg git asking for username/password) from stopping the webserver
  signal(SIGTTIN, SIG_IGN);
  signal(SIGTTOU, SIG_IGN);
*/

class ServiceManagerClient extends BackendServiceConnection {
  constructor() {
    super();
  }

  #mgr() {
    return metaMgr.mgr ?? throwError("Service manager is not available, WebHare may be relaunching");
  }

  getWebHareState() {
    return {
      stage: stagetitles[currentstage],
      serviceManagerId,
      availableServices: [...this.#mgr().expectedServices.entries()].map(([name, service]) => {
        const process = this.#mgr().processes.get(name);
        return {
          name,
          isRunning: process?.running ?? false,
          startedSince: process?.started ? new Date(process.started) : null,
          lastLogText: process?.lastLogText ?? "",
          pid: process?.process?.pid ?? 0,
          run: service.run
        };
      })
    };
  }
  startService(service: string) {
    const serviceinfo = this.#mgr().expectedServices.get(service);
    if (!serviceinfo)
      return { errorMessage: `No such service '${service}'` };
    if (this.#mgr().processes.get(service))
      return { errorMessage: `Service '${service}' is already running` };
    if (!metaMgr.mgr)
      return { errorMessage: `Service manager is not currently running` };

    new ProcessManager(metaMgr.mgr, service, serviceinfo);
    return { ok: true };
  }
  async stopService(service: string) {
    const process = this.#mgr().processes.get(service);
    if (!process)
      return { errorMessage: `Service '${service}' is not running` };

    await process.stop();
    return { ok: true };
  }

  async restartService(service: string) {
    //TODO we should probably tell process.stop to restart and be a bit more robust against parallel start/stop calls
    //TODO I think we could better combine start/stoprestart APIs (especially when enable/disable comes around too)
    const serviceinfo = this.#mgr().expectedServices.get(service);
    const process = this.#mgr().processes.get(service);
    if (!serviceinfo)
      return { errorMessage: `No such service '${service}'` };
    if (process?.running)
      await process.stop();

    if (!metaMgr.mgr)
      return { errorMessage: `Service manager is not currently running` };
    new ProcessManager(metaMgr.mgr, service, serviceinfo);
    return { ok: true };
  }

  async reload() {
    if (!metaMgr.mgr)
      return { errorMessage: `Service manager is not currently running` };

    await metaMgr.mgr.loadServiceList("ServiceMangerClient.reload"); //we block this so the service will be visible in the next getWebhareState from this client
    void metaMgr.mgr.updateForCurrentStage(); //I don't think we need to block clients on startup of services ? they can wait themselves
  }

  async relaunch() {
    await metaMgr.relaunch();
  }
}

async function startBackendService(name: string) {
  for (; ;) {
    try {
      //FIXME do we need to wait for the bridge to be ready? do we auto reregister when the bridge comes back?
      await runBackendService(name, () => new ServiceManagerClient, { autoRestart: false, dropListenerReference: true });
      break;
    } catch (e) {
      smLog(`Service manager backend service failed with error: ${e}`);
      await sleep(1000);
    }
  }
}

class ServiceManager {
  keepAlive: NodeJS.Timeout | null = setInterval(() => { }, 1000 * 60 * 60 * 24); //keep us alive
  shuttingDown: { finished: Promise<void> } | null = null;
  readonly includeServices;
  readonly excludeServices;
  processes = new ProcessList;
  expectedServices = new Map<string, ServiceDefinition>();
  finishedWaitForCompletionServices = new Set<string>;

  constructor(public readonly name: string, public readonly isSecondaryManager: boolean, include: string, exclude: string) {
    this.includeServices = include ? regExpFromWildcards(include) : null;
    this.excludeServices = exclude ? regExpFromWildcards(exclude) : null;

    process.on("SIGINT", this.shutdownSignal);
    process.on("SIGTERM", this.shutdownSignal);
    process.on("SIGTSTP", this.stopContinueSignal);
    process.on("SIGCONT", this.stopContinueSignal);
    process.on("uncaughtException", (err, origin) => {
      console.error("Uncaught exception", err, origin);
      this.shutdown();
      smLog(`Uncaught exception`, { error: String(err), origin: String(origin) });
    });

  }

  async loadServiceList(source: string) {
    const allservices = Object.entries(await getAllServices());
    const removeServices = new Set(this.expectedServices.keys());
    const addedServices = new Set<string>();

    for (const [name, servicedef] of allservices) {
      if ((this.includeServices && !this.includeServices.test(name)) || (this.excludeServices?.test(name)) || (this.isSecondaryManager && !this.includeServices))
        continue;

      if (!this.expectedServices.has(name))
        addedServices.add(name);

      this.expectedServices.set(name, servicedef);
      removeServices.delete(name);
    }

    for (const service of removeServices)
      this.expectedServices.delete(service);

    if (source)
      smLog(`Updated servicelist for ${source}: added ${[...addedServices].join(", ") || "(none)"}, removed ${[...removeServices].join(", ") || "(none)"}`);
  }

  shutdownSignal = (signal: NodeJS.Signals) => {
    smLog(`Received signal '${signal}'${this.shuttingDown ? ' but already shutting down' : ', shutting down'}`, { signal, wasShuttingDown: this.shuttingDown });
    this.shutdown();
  };

  stopContinueSignal = (signal: NodeJS.Signals) => {
    smLog(`Received signal '${signal}'`, { signal });

    //forward STOP and CONT to subprocesses
    for (const proc of this.processes.getAllRunning())
      if (proc.process?.pid) //we need to send the STOP/CONT to the whole process group (hence negative pid). doesn't work for postgres though, its subproceses are in a different group
        process.kill(-proc.process?.pid, signal === "SIGTSTP" ? "SIGSTOP" : signal);

    if (signal === "SIGTSTP") //if we received a stop, now stop ourselves
      process.kill(process.pid, "SIGSTOP");
  };

  shutdown(): { finished: Promise<void> } {
    if (this.shuttingDown)
      return this.shuttingDown;
    if (this.keepAlive)
      clearTimeout(this.keepAlive);

    this.shuttingDown = {
      finished: (async () => { //we handle our own async as we handle our own exceptions
        try {
          const shutdownMonitor = setInterval(() => this.checkShutdownProgress(), 1000);
          await this.startStage(Stage.Terminating);
          await this.startStage(Stage.ShuttingDown);
          clearInterval(shutdownMonitor);
          updateTitle('');

          if (!this.isSecondaryManager) {
            try {
              await fs.rm(backendConfig.dataRoot + ".webhare.pid");
            } catch (e) {
              console.error("Failed to remove webhare.pid file", e);
            }
          }
        } catch (e) {
          smLog("Exception during shutdown", { error: String(e) });
          console.error("Exception during shutdown", e);
          process.exit(1);
        }
      })()
    };
    return this.shuttingDown;
  }

  checkShutdownProgress() {
    smLog(`Shutting down, still running: ${this.processes.getAllRunning().map(_ => `${_.name} (${_.process?.pid || ""})`).join(", ")}`);
  }

  /// Move to a new stage
  async startStage(stage: Stage): Promise<void> {
    if (verbose)
      smLog(`Entering stage: ${stagetitles[stage]}`, { stage: stagetitles[stage] }); //TODO shouldn't we be logging a tag/string instead of a full title
    currentstage = stage;
    return await this.updateForCurrentStage();
  }

  shouldRun(name: string, service: ServiceDefinition): boolean | null {
    if (service.run === "once") //script should be running when we're in the startIn stage and the script hasn't finished yet.
      return currentstage === service.startIn && !this.finishedWaitForCompletionServices.has(name);
    if (currentstage >= (service.stopIn ?? defaultShutDownStage))
      return false; //shut it down once we're past the services' state
    if (service.run === "always") //should run once we reached or passed its state
      return service.startIn <= currentstage;

    return null; //keep the service in whatever its current state it
  }

  /// Actually apply the current stage. Also used when configurationchanges
  async updateForCurrentStage(): Promise<void> {
    updateVisibleState();

    const subpromises = [];
    for (const process of this.processes.getAllRunning()) {
      if (!this.expectedServices.has(process.name))
        subpromises.push(process.stop());
    }
    for (const [name, service] of this.expectedServices.entries()) {
      const shouldRunNow = this.shouldRun(name, service);
      if (shouldRunNow === null)
        continue;

      let process = this.processes.get(name);
      if (process && !shouldRunNow) {
        subpromises.push(process.stop());
      } else if (shouldRunNow) {
        if (process && service.run !== "once" && shouldRestartService(process.service, service)) {
          // Wait for it to stap, don't want to overlap with the new service instance
          await process.stop();
          process = undefined;
        }
        if (!process) {
          const proc = new ProcessManager(this, name, service);
          if (service.run === "once")
            subpromises.push(proc.stopDefer.promise); //TODO should we have a timeout? (but what do you do if it hits? terminate? move to next stage?)
        }
      }
    }

    await Promise.all(subpromises);
  }

  async waitForCompileServer() {
    while (!this.shuttingDown) {
      try {
        await fetch(getCompileServerOrigin());
        return;
      } catch (e) {
        await sleep(100);
      }
    }
  }
}

/* Read webhare.version, check whether we are compatible with whatever ran before */
async function verifyUpgrade() {
  let config: WebHareVersionFile;
  try {
    config = JSON.parse(await fs.readFile(getVersionFile(), 'utf8')) as WebHareVersionFile;
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === 'ENOENT')
      return; //first and clean startup, normal..

    smLog("Error occurred parsing webhare.version: " + (e as Error)?.message); //ignore the error though.
    return;
  }

  const error = isInvalidWebHareUpgrade(config.version, backendConfig.whVersion);
  if (error) {
    smLog(error);
    smLog(`Aborting - if you want to ignore this version check failure, delete ${getVersionFile()} at your own risk!`);
    process.exit(1);
  }
}

async function verifyStrayProcesses() {
  const strayprocs = await getServiceManagerChildPids();
  if (strayprocs.length) {
    console.error("There are still processes running from a previous WebHare instance.");
    console.error("You can try to terminate them using `wh service force-terminate-all` or force it with `wh service force-terminate-all --kill`");
    console.error(`PIDs: ${strayprocs.join(", ")}`);
    process.exit(1);
  }
}

async function setConfigAndVersion() {
  await updateWebHareConfigFile({ debugSettings: null, nodb: true });
  const fullconfig = getFullConfigFile();
  const versionInfo: WebHareVersionFile = {
    ...backendConfig.buildinfo,
    basedataroot: backendConfig.dataRoot,
    installationroot: backendConfig.installationRoot,
    moduledirs: fullconfig.modulescandirs,
    docker: Boolean(process.env.WEBHARE_IN_DOCKER),
    versionnum: getVersionInteger(),
    servicemanagerid: serviceManagerId,
    startdatetime: new Date().toISOString()
  };

  await storeDiskFile(getVersionFile(), stringify(versionInfo, { stable: true, space: 2 }) + '\n', { overwrite: true });
}

class ServiceManagerManager {
  bridgeListener: number | null = null;
  mgr: ServiceManager | null = null;

  public relaunching = false;

  constructor(public name: string, public secondary: boolean, public include: string, public exclude: string) {
  }

  async start() {
    this.relaunching = false; //reset relaunch flag

    const mgr = new ServiceManager(this.name, this.secondary, this.include, this.exclude);
    this.mgr = mgr;
    await mgr.loadServiceList("");

    this.bridgeListener = bridge.on("event", event => {
      if (event.name === "system:configupdate")
        setImmediate(() => updateVisibleState()); //ensure the bridge is uptodate (TODO can't we have bridge's updateConfig signal us so we're sure we're not racing it)
      if (event.name === "system:modulesupdate") {
        mgr.loadServiceList("system:modulesupdate").then(() => mgr.updateForCurrentStage()).catch(e => logError(e));
      }
    });

    smLog(`Starting WebHare ${backendConfig.whVersion} in ${backendConfig.dataRoot} at ${getRescueOrigin()}`, { buildinfo: backendConfig.buildinfo });

    if (!this.secondary) {
      // Update configuration, clear debug settings
      await setConfigAndVersion();

      //remove old servicestate files
      await unlinkServicestateFiles();
      await storeDiskFile(backendConfig.dataRoot + ".webhare.pid", process.pid.toString() + "\n", { overwrite: true });
    }

    await mgr.startStage(Stage.Bootup);
    if (!this.secondary)
      await mgr.waitForCompileServer();

    if (!startedBackendService) {
      startedBackendService = true;
      void startBackendService(this.name); // async start the backend service. this service stays up even if we relaunch but that is mostly as we can't effectively teardown services yet
    }

    if (!mgr.shuttingDown)
      await mgr.startStage(Stage.StartupScript);
    if (!mgr.shuttingDown)
      await mgr.startStage(Stage.Active); //TODO we should run the poststart script instead of execute tasks so we can mark when that's done. as that's when we are really online
  }

  async relaunch() {
    if (this.relaunching)
      return; //alreday relaunching

    this.relaunching = true;
    if (this.bridgeListener) {
      bridge.off(this.bridgeListener);
      this.bridgeListener = null;
    }

    smLog("Relaunching service manager");
    await this.mgr?.shutdown().finished;

    const strayprocs = await getServiceManagerChildPids();
    if (strayprocs.length) {
      smLog("Killing stray processes", { strayprocs });
      for (const proc of strayprocs) {
        try {
          kill(proc, "SIGKILL");
        } catch (ignore) { }
      }
    }

    await this.start();
  }
}

let metaMgr: ServiceManagerManager;

const argv = process.argv.slice(2);
if (argv.at(-1)?.match(/^ +$/))  // To allow us to rewrite our name in the process tree, we're invoked with a dummy space argument.
  argv.pop(); //strip the spaces argument from the parsed list

run({
  flags: {
    "s,secondary": { description: "Mark us as a secondary service manager" },
    "v,verbose": { description: "Verbose output" },
  },
  options: {
    "name": { default: "platform:servicemanager", description: "Name for the backend service to manage us" },
    "include": { default: "", description: "Only manage services that match this mask" },
    "exclude": { default: "", description: "Do not manage services that match this mask" },
  }, async main({ opts }) {
    if (!backendConfig.dataRoot) {
      console.error("Cannot start WebHare. Data root not set");
      return 1;
    }

    //TODO check if webhare isn't already running when not started with --secondary
    verbose = opts.verbose || debugFlags.startup || false;

    //Setting up logs must be one of the first things we do so log() works and even verifyUpgrade can write there
    await fs.mkdir(backendConfig.dataRoot + "log", { recursive: true });
    logfile = new RotatingLogFile(opts.secondary ? null : backendConfig.dataRoot + "log/servicemanager", { stdout: true });

    if (!opts.secondary) { //verify we're allowed to run
      await verifyStrayProcesses();
      await verifyUpgrade();
    }

    metaMgr = new ServiceManagerManager(opts.name, opts.secondary, opts.include, opts.exclude);
    await metaMgr.start(); //this awaits the first start
    return 0; //main() simply ends but the running processes will keep themselves alive
  }
}, { argv });


export type { ServiceManagerClient, ProcessManager };
