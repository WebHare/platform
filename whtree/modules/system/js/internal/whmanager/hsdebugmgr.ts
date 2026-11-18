/* HareScript debug manager, a TypeScript port of mod::system/scripts/internal/debugmgr.whscr.

   - HareScript processes connect to wh:debugmgr_internal (the C++ debugger, harescript/vm/hsvm_debugger.cpp)
   - Debuggers (the debugger screen through connector.whlib, mod::platform/js/hsdebugger) connect to wh:debugmgr

   The manager keeps track of the processes and their jobs, relays requests for attached jobs to the process running them,
   and configures the rules that make processes report job starts and attach to matching jobs.

   Unlike the HareScript version, values relayed through this manager lose the difference between FLOAT and INTEGER when a
   float has an integral value, as JavaScript numbers don't keep it.
*/

import { backendConfig, broadcast, readRegistryKey, subscribe } from "@webhare/services";
import { HareScriptType, setHareScriptType } from "@webhare/hscompat";
import bridge from "./bridge";
import type { IPCEndPoint, IPCMessagePacket } from "./ipc";
import type { IPCMarshallableRecord } from "./hsmarshalling";

export const commandPortName = "wh:debugmgr_internal";
export const appPortName = "wh:debugmgr";

type Message = IPCMarshallableRecord & { type: string };
type Link = IPCEndPoint<IPCMarshallableRecord, IPCMarshallableRecord>;
type Port = ReturnType<typeof bridge.createPort>;

let debugLevel = 0;

function log(level: number, ...args: unknown[]) {
  if (debugLevel >= level)
    console.log(...args);
}

function typedArray<T>(type: HareScriptType, array: T[]): T[] {
  const copy = [...array];
  setHareScriptType(copy, type);
  return copy;
}

interface Rule {
  tag: string;
  sites: number;
  hosttype: string;
  script: string;
  script_exclude: string[];
  connect_on_match: boolean;
  inform_start_stop: boolean;
  authrecordrules: Array<{ path: string[]; mask: string }>;
}

function encodeRule(rule: Rule): IPCMarshallableRecord {
  return {
    ...rule,
    script_exclude: typedArray(HareScriptType.StringArray, rule.script_exclude),
    authrecordrules: typedArray(HareScriptType.RecordArray, rule.authrecordrules.map(r => ({ path: typedArray(HareScriptType.StringArray, r.path), mask: r.mask })))
  } as unknown as IPCMarshallableRecord;
}

/** The HareScript debug manager */
export class HSDebugManager {
  appPort: Port | null = null;
  commandPort: Port | null = null;
  idCounter = 0;
  processes = new Map<string, HSProcess>();
  /** Processes that haven't sent their greeting yet */
  pendingProcesses = new Set<HSProcess>();
  applications = new Map<number, ConnectedApplication>();
  keepErrorTerminatedMsecs = 0;

  async start() {
    await this.updateDebuggerConfig();
    await subscribe("system:debugger.configchange", () => void this.updateDebuggerConfig().then(() => this.updateConfiguration(false)));

    this.appPort = bridge.createPort(appPortName, { global: true });
    this.appPort.on("accept", link => new ConnectedApplication(this, link as Link, ++this.idCounter));
    await this.appPort.activate();

    await this.manageCommandPortRegistration();
    broadcast("wh:debugmgr.started");
  }

  async updateDebuggerConfig() {
    // The debugger config matters only for development machines
    this.keepErrorTerminatedMsecs = backendConfig.dtapstage === "development"
      ? await readRegistryKey("system:backend.development.zombietimeout").catch(() => 0)
      : 0;
  }

  /** Processes only connect when the command port exists. In development it always exists, otherwise only while a debugger is connected */
  async manageCommandPortRegistration() {
    const needCommandPort = this.applications.size > 0 || backendConfig.dtapstage === "development";
    if (Boolean(this.commandPort) === needCommandPort)
      return;

    if (!needCommandPort) {
      log(5, "Last application disconnected, closing the command port");
      this.commandPort!.close();
      this.commandPort = null;
      for (const proc of [...this.processes.values(), ...this.pendingProcesses])
        proc.close();
      return;
    }

    log(5, "Opening the command port");
    const port = bridge.createPort(commandPortName, { global: true });
    this.commandPort = port;
    port.on("accept", link => {
      log(5, "New connected process");
      this.pendingProcesses.add(new HSProcess(this, link as Link));
    });
    await port.activate();
  }

  registerProcess(proc: HSProcess) {
    this.pendingProcesses.delete(proc);
    this.processes.set(String(proc.processcode), proc);
    for (const app of this.applications.values())
      if (app.wantProcessUpdates)
        app.send({ type: "process-connected", data: { processcode: proc.processcode, clientname: proc.clientname } });
  }

  unregisterProcess(proc: HSProcess) {
    this.pendingProcesses.delete(proc);
    if (this.processes.get(String(proc.processcode)) !== proc)
      return;
    for (const app of this.applications.values())
      if (app.wantProcessUpdates)
        app.send({ type: "process-disconnected", data: { processcode: proc.processcode, clientname: proc.clientname } });
    this.processes.delete(String(proc.processcode));
  }

  async registerApplication(app: ConnectedApplication) {
    this.applications.set(app.id, app);
    await this.manageCommandPortRegistration();
  }

  async unregisterApplication(app: ConnectedApplication) {
    for (const proc of this.processes.values())
      proc.applicationDisconnected(app);
    this.applications.delete(app.id);
    // First manage the command port, then update the configuration (when the last app is gone, the processes are closed)
    await this.manageCommandPortRegistration();
    this.updateConfiguration(false);
  }

  getProcesses() {
    return [...this.processes.values()]
      .filter(proc => proc.clientname)
      .sort((a, b) => a.processcode < b.processcode ? -1 : a.processcode > b.processcode ? 1 : 0)
      .map(proc => ({ processcode: proc.processcode, clientname: proc.clientname }));
  }

  getProcessByCode(processcode: unknown): HSProcess | undefined {
    return this.processes.get(String(processcode));
  }

  /** Update the configuration of all processes
      @param reset - Replace all rules in the processes instead of updating them incrementally
  */
  updateConfiguration(reset: boolean) {
    for (const proc of this.processes.values())
      proc.updateConfiguration(reset);
  }
}

interface AppRegistration {
  app: ConnectedApplication;
  joblistLive: boolean;
  joblistOnce: boolean;
}

interface AttachedJobEntry {
  app: ConnectedApplication;
  job: AttachedJob | null;
}

/** A HareScript process connected to the debug manager */
class HSProcess {
  readonly mgr: HSDebugManager;
  readonly link: Link;
  processcode = 0n;
  clientname = "";
  installedRuleTags: string[] = [];
  appRegistrations = new Map<number, AppRegistration>();
  attachedJobs = new Map<string, AttachedJobEntry>();
  /** Requests relayed for applications: msgid of our request to the app and its message id */
  appRequests = new Map<bigint, { app: ConnectedApplication; replyto: bigint }>();
  closed = false;

  constructor(mgr: HSDebugManager, link: Link) {
    this.mgr = mgr;
    this.link = link;
    link.on("message", packet => this.gotMessage(packet as IPCMessagePacket<Message>));
    link.on("close", () => this.gotDisconnected());
    void link.activate().then(() => this.updateConfiguration(true));
  }

  send(message: IPCMarshallableRecord): bigint {
    return this.closed ? 0n : this.link.send(message);
  }

  close() {
    this.link.close();
    this.gotDisconnected();
  }

  private haveLiveJobUpdatesSubscription() {
    return [...this.appRegistrations.values()].some(reg => reg.joblistLive);
  }

  private generateRuleList(): Rule[] {
    const rules: Rule[] = [];
    if (this.haveLiveJobUpdatesSubscription())
      rules.push({
        tag: "live-updates",
        sites: 3, // 1=start & 2=terminate
        hosttype: "*",
        script: "*",
        script_exclude: ["*/remoting.shtml"],
        connect_on_match: false,
        inform_start_stop: true,
        authrecordrules: []
      });
    for (const app of this.mgr.applications.values())
      rules.push(...app.rules.values());
    return rules.sort((a, b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0);
  }

  updateConfiguration(reset: boolean) {
    const rules = this.generateRuleList();
    const allTags = rules.map(rule => rule.tag);
    const toAdd: Rule[] = [];
    const installed = new Set(this.installedRuleTags);
    for (const rule of rules)
      if (!installed.has(rule.tag)) {
        toAdd.push(rule);
        installed.add(rule.tag);
      }
    const toDelete = this.installedRuleTags.filter(tag => !allTags.includes(tag));
    this.installedRuleTags = allTags;

    log(5, `Sending configuration to process ${this.processcode}, reset: ${reset}`);
    // Like the HareScript version, all rules are sent as 'addrules'
    this.send({
      type: "configure",
      keep_errorterminated_msecs: this.mgr.keepErrorTerminatedMsecs,
      reset,
      addrules: typedArray(HareScriptType.RecordArray, rules.map(encodeRule)),
      deleterules: typedArray(HareScriptType.StringArray, toDelete)
    });
  }

  updateAppRegistration(app: ConnectedApplication, updates: Partial<Omit<AppRegistration, "app">>) {
    let reg = this.appRegistrations.get(app.id);
    if (!reg) {
      reg = { app, joblistLive: false, joblistOnce: false };
      this.appRegistrations.set(app.id, reg);
    }
    Object.assign(reg, updates);
    if ("joblistLive" in updates)
      this.updateConfiguration(false);
  }

  applicationDisconnected(app: ConnectedApplication) {
    for (const [groupid, entry] of [...this.attachedJobs.entries()])
      if (entry.app === app) {
        entry.job?.disconnect();
        this.attachedJobs.delete(groupid);
      }
    this.appRegistrations.delete(app.id);
  }

  private liveRegistrations() {
    return [...this.appRegistrations.values()].filter(reg => reg.joblistLive);
  }

  /** Register a job that was attached (or is being detached) */
  changeJobRegistration(groupid: string, job: AttachedJob, add: boolean, metadata?: { connectreason: string; ruletag: string }) {
    const entry = this.attachedJobs.get(groupid);
    if (add) {
      if (entry) {
        entry.job = job;
        entry.app.send({ type: "job-connected", processcode: this.processcode, groupid, status: job.status, metadata: metadata ?? null });
      } else
        job.disconnect();
    } else if (entry) {
      this.attachedJobs.delete(groupid);
      entry.app.send({ type: "job-disconnected", processcode: this.processcode, groupid });
      for (const reg of this.liveRegistrations())
        reg.app.send({ type: "job-connectedchange", processcode: this.processcode, groupid, connected: false });
    }
  }

  private gotDisconnected() {
    if (this.closed)
      return;
    this.closed = true;
    for (const [groupid, entry] of this.attachedJobs) {
      if (entry.job)
        entry.job.gotDisconnected();
      else
        entry.app.send({ type: "job-connectfail", processcode: this.processcode, groupid, reason: "connectjob-gone" });
    }
    this.attachedJobs.clear();
    this.mgr.unregisterProcess(this);
  }

  private handleRuleConnect(msg: Message): boolean {
    const tags = (msg.connect_tags as string[] | undefined) ?? [];
    for (const app of this.mgr.applications.values())
      for (const rule of app.rules.values())
        if (tags.includes(rule.tag)) {
          const groupid = msg.groupid as string;
          this.attachedJobs.set(groupid, { app, job: null });
          const job = new AttachedJob(this, app, msg, "rule", rule.tag);
          for (const reg of this.liveRegistrations())
            reg.app.send({ type: "job-connectedchange", processcode: this.processcode, groupid: job.groupid, connected: true });
          return true;
        }
    return false;
  }

  private jobRecord(msg: Message, connected: boolean) {
    return {
      script: msg.script, status: msg.status, groupid: msg.groupid, creationdate: msg.creationdate,
      total_running: msg.total_running, authenticationrecord: msg.authenticationrecord ?? null, connected
    } as IPCMarshallableRecord;
  }

  private gotMessage(packet: IPCMessagePacket<Message>) {
    const msg = packet.message;
    log(5, `Process ${this.processcode} sent message '${msg.type}'`);

    const appRequest = this.appRequests.get(packet.replyto);
    if (packet.replyto && appRequest) {
      this.appRequests.delete(packet.replyto);
      appRequest.app.send(msg, appRequest.replyto);
      return;
    }

    switch (msg.type) {
      case "greeting": {
        this.clientname = msg.clientname as string;
        this.processcode = BigInt(msg.processcode as bigint);
        this.mgr.registerProcess(this);
      } break;

      case "getjobmgrstatus-response": {
        const jobs = typedArray(HareScriptType.RecordArray, ((msg.jobs as Message[]) ?? [])
          .map(job => this.jobRecord(job, this.attachedJobs.has(job.groupid as string)))
          .sort((a, b) => String(a!.groupid) < String(b!.groupid) ? -1 : String(a!.groupid) > String(b!.groupid) ? 1 : 0));
        for (const reg of this.appRegistrations.values())
          if (reg.joblistLive || reg.joblistOnce) {
            reg.joblistOnce = false;
            reg.app.send({ type: "joblist", processcode: this.processcode, gone: false, jobs });
          }
      } break;

      case "job-started": {
        const jobrec = this.jobRecord(msg, this.attachedJobs.has(msg.groupid as string));
        for (const reg of this.liveRegistrations())
          reg.app.send({ type: "job-started", processcode: this.processcode, data: jobrec });
        if (msg.connected && !this.handleRuleConnect(msg))
          this.send({ type: "disconnectjob", groupid: msg.groupid }); // no rule took this job
      } break;

      case "job-rulehit": {
        if (!this.handleRuleConnect(msg))
          this.send({ type: "disconnectjob", groupid: msg.groupid });
      } break;

      case "job-terminated": {
        const groupid = msg.groupid as string;
        const jobrec = { ...this.jobRecord(msg, false), removed: msg.removed ?? false };
        if (msg.connected) {
          const entry = this.attachedJobs.get(groupid);
          if (entry) {
            if (!entry.job) {
              new AttachedJob(this, entry.app, msg, "connect", "");
              for (const reg of this.liveRegistrations())
                reg.app.send({ type: "job-connectedchange", processcode: this.processcode, groupid, connected: true });
            }
          } else if (!this.handleRuleConnect(msg))
            this.send({ type: "disconnectjob", groupid });
        }
        this.attachedJobs.get(groupid)?.job?.gotMessage(msg);
        for (const reg of this.liveRegistrations())
          reg.app.send({ type: "job-terminated", processcode: this.processcode, data: jobrec });
      } break;

      case "job-removed": {
        for (const reg of this.liveRegistrations())
          reg.app.send({ type: "job-removed", processcode: this.processcode, groupid: msg.groupid });
      } break;

      case "connectjob-gone":
      case "connectjob-alreadyconnected": {
        const groupid = msg.groupid as string;
        const entry = this.attachedJobs.get(groupid);
        if (entry) {
          entry.app.send({ type: "job-connectfail", processcode: this.processcode, groupid, reason: msg.type });
          this.attachedJobs.delete(groupid);
        }
      } break;

      case "connectjob-ack": {
        const groupid = msg.groupid as string;
        const entry = this.attachedJobs.get(groupid);
        if (entry) {
          new AttachedJob(this, entry.app, msg, "connect", "");
          for (const reg of this.liveRegistrations())
            reg.app.send({ type: "job-connectedchange", processcode: this.processcode, groupid, connected: true });
        } else // no one waiting for the connect
          this.send({ type: "disconnectjob", groupid });
      } break;

      default: {
        if (msg.type.startsWith("job-")) {
          const job = this.attachedJobs.get(msg.groupid as string)?.job;
          if (job) {
            job.gotMessage(msg, packet.replyto);
            return;
          }
        }
        // Error responses to job requests (eg 'error-notstopped') don't have a 'job-' type
        if (packet.replyto)
          for (const entry of this.attachedJobs.values())
            if (entry.job?.passResponse(msg, packet.replyto))
              return;
        log(1, `Unknown message from the C++ debugger: ${msg.type}`);
      }
    }
  }

  sendAppRequest(app: ConnectedApplication, req: Message, replyto: bigint) {
    const msgid = this.send(req);
    this.appRequests.set(msgid, { app, replyto });
  }

  requestJobListUpdate(app: ConnectedApplication) {
    const pending = [...this.appRegistrations.values()].some(reg => reg.joblistOnce);
    this.updateAppRegistration(app, { joblistOnce: true });
    if (!pending)
      this.send({ type: "getjobmgrstatus" });
  }

  requestConnect(app: ConnectedApplication, groupid: string) {
    if (this.attachedJobs.has(groupid)) { // already connected (or connecting)
      app.send({ type: "job-connectfail", processcode: this.processcode, groupid, reason: "already_connected" });
      return;
    }
    this.attachedJobs.set(groupid, { app, job: null });
    this.send({ type: "connectjob", groupid });
  }

  requestTerminate(groupid: string) {
    this.send({ type: "terminatejob", groupid });
  }
}

/** Requests relayed to the C++ debugger for an attached job, with the type the C++ debugger expects */
const jobRequestTypes: Record<string, { type: string; needsPause: boolean; fields: string[] }> = {
  "job-getvariables": { type: "getvariables", needsPause: true, fields: ["variables"] },
  "job-getlibraries": { type: "getlibraries", needsPause: true, fields: [] },
  "job-getdebuginfo": { type: "getdebuginfo", needsPause: true, fields: ["liburi"] },
  "job-setbreakpoints": { type: "setbreakpoints", needsPause: false, fields: ["minstacksize", "maxstacksize", "breakonexception", "breakpoints"] },
  "job-getprofile": { type: "getprofile", needsPause: false, fields: ["profiletype"] },
  "job-getmemorysnapshot": { type: "getmemorysnapshot", needsPause: false, fields: ["include_unreferenced"] },
  "job-getblobreferences": { type: "getblobreferences", needsPause: false, fields: ["include_unreferenced"] },
  "job-gethandlelist": { type: "gethandlelist", needsPause: false, fields: [] },
  "job-getadhoccachelist": { type: "getadhoccachelist", needsPause: false, fields: [] },
};

/** A job a debugger application is attached to */
class AttachedJob {
  readonly process: HSProcess;
  readonly app: ConnectedApplication;
  readonly groupid: string;
  status: IPCMarshallableRecord;
  paused: boolean;
  /** Our request msgid -> the app's msgid */
  requests = new Map<bigint, bigint>();

  constructor(proc: HSProcess, app: ConnectedApplication, status: Message, connectreason: string, ruletag: string) {
    this.process = proc;
    this.app = app;
    this.groupid = status.groupid as string;
    this.status = status;
    this.paused = status.realstatus === "DebugStopped";

    broadcast(`system:debugger.attach.${this.groupid}`);
    if (this.paused)
      broadcast(`system:debugger.paused.${this.groupid}`);
    proc.changeJobRegistration(this.groupid, this, true, { connectreason, ruletag });
  }

  gotDisconnected() {
    broadcast(`system:debugger.detach.${this.groupid}`);
    this.app.send({ type: "job-disconnected", processcode: this.process.processcode, groupid: this.groupid });
  }

  /** Pass a response to a request made through this job on to the app. Returns false if this job didn't make the request */
  passResponse(msg: Message, replyto: bigint): boolean {
    const appMsgid = this.requests.get(replyto);
    if (appMsgid === undefined)
      return false;
    this.requests.delete(replyto);
    this.app.send({ ...msg, processcode: this.process.processcode }, appMsgid);
    return true;
  }

  gotMessage(msg: Message, replyto = 0n) {
    if (replyto && this.passResponse(msg, replyto))
      return;

    switch (msg.type) {
      case "job-paused":
      case "job-status":
      case "job-running":
      case "job-terminated": {
        this.status = msg;
        this.app.send({ type: "job-statechange", processcode: this.process.processcode, groupid: this.groupid, status: msg });
        const newPaused = msg.realstatus === "DebugStopped" || msg.realstatus === "Terminated";
        if (this.paused !== newPaused)
          broadcast(`system:debugger.${newPaused ? "paused" : "running"}.${this.groupid}`);
        this.paused = newPaused;
      } break;
      default:
        log(1, `Unhandled message from the C++ debugger: '${msg.type}'`);
    }
  }

  private sendRequest(req: IPCMarshallableRecord, appMsgid: bigint) {
    const msgid = this.process.send(req);
    this.requests.set(msgid, appMsgid);
  }

  gotAppMessage(msg: Message, msgid: bigint) {
    switch (msg.type) {
      case "job-disconnect":
      case "job-externdisconnect":
        this.disconnect();
        return;

      case "job-pause": {
        this.process.send({ type: "pausejob", groupid: this.groupid });
        if (!this.paused)
          broadcast(`system:debugger.paused.${this.groupid}`);
        this.paused = true;
      } return;

      case "job-continue": {
        if ((this.status as Message).realstatus === "DebugStopped")
          this.process.send({ type: "continuejob", groupid: this.groupid });
      } return;

      case "job-setprofiling": {
        this.sendRequest({ type: "setprofiling", groupid: this.groupid, profiletype: msg.profiletype, value: msg.enable, reset: msg.reset }, msgid);
      } return;
    }

    const relay = jobRequestTypes[msg.type];
    if (relay) {
      if (relay.needsPause && !this.paused) {
        this.app.send({ type: "error", msg: "notpaused" }, msgid);
        return;
      }
      const req: Record<string, unknown> = { type: relay.type, groupid: this.groupid };
      for (const field of relay.fields)
        req[field] = msg[field];
      this.sendRequest(req as IPCMarshallableRecord, msgid);
      return;
    }

    this.app.send({ type: "error", msg: `Unknown job message type '${msg.type}'` }, msgid);
  }

  disconnect() {
    this.process.send({ type: "disconnectjob", groupid: this.groupid });
    this.process.changeJobRegistration(this.groupid, this, false);
    broadcast(`system:debugger.detach.${this.groupid}`);
  }
}

/** A debugger application connected to wh:debugmgr */
class ConnectedApplication {
  readonly mgr: HSDebugManager;
  readonly link: Link;
  readonly id: number;
  wantProcessUpdates = false;
  rules = new Map<string, Rule>();
  closed = false;

  constructor(mgr: HSDebugManager, link: Link, id: number) {
    this.mgr = mgr;
    this.link = link;
    this.id = id;
    link.on("message", packet => this.gotMessage(packet as IPCMessagePacket<Message>));
    link.on("close", () => this.gotDisconnected());
    void link.activate();
    void mgr.registerApplication(this);
  }

  send(message: IPCMarshallableRecord, replyto?: bigint) {
    if (!this.closed)
      this.link.send(message, replyto || undefined);
  }

  private gotDisconnected() {
    if (this.closed)
      return;
    this.closed = true;
    void this.mgr.unregisterApplication(this);
  }

  private sendProcessGone(processcode: unknown, replyto: bigint) {
    this.send({ type: "process-gone", processcode: processcode as bigint }, replyto);
  }

  private gotMessage(packet: IPCMessagePacket<Message>) {
    const msg = packet.message, msgid = packet.msgid;
    log(5, `App ${this.id} sent message '${msg.type}'`);

    switch (msg.type) {
      case "getprocesslist":
        this.send({ type: "processlist", processes: typedArray(HareScriptType.RecordArray, this.mgr.getProcesses()) }, msgid);
        return;

      case "subscribeprocessupdates":
        this.wantProcessUpdates = Boolean(msg.enabled);
        return;

      case "addrule": {
        const tag = msg.tag as string;
        if (!this.rules.has(tag)) {
          this.rules.set(tag, {
            tag,
            sites: msg.sites as number,
            hosttype: msg.hosttype as string,
            script: msg.script as string,
            script_exclude: (msg.script_exclude as string[]) ?? [],
            connect_on_match: Boolean(msg.connect_on_match),
            inform_start_stop: false,
            authrecordrules: ((msg.authrecordrules as Array<{ path: string[]; mask: string }>) ?? []).map(r => ({ path: r.path, mask: r.mask }))
          });
          this.mgr.updateConfiguration(false);
        }
      } return;

      case "deleterule": {
        if (this.rules.delete(msg.tag as string))
          this.mgr.updateConfiguration(false);
      } return;
    }

    const proc = this.mgr.getProcessByCode(msg.processcode);
    switch (msg.type) {
      case "getjoblist":
      case "subscribejobupdates":
      case "jobconnect":
      case "job-terminate":
      case "job-externdisconnect":
      case "getcomplexfsstats":
      case "getmallocstats":
      case "getlocks":
        if (!proc) {
          this.sendProcessGone(msg.processcode, msgid);
          return;
        }
    }

    switch (msg.type) {
      case "getjoblist":
        proc!.requestJobListUpdate(this);
        return;
      case "subscribejobupdates":
        proc!.updateAppRegistration(this, { joblistLive: Boolean(msg.enabled) });
        return;
      case "jobconnect":
        proc!.requestConnect(this, msg.groupid as string);
        return;
      case "job-terminate":
        proc!.requestTerminate(msg.groupid as string);
        return;
      case "job-externdisconnect":
        proc!.attachedJobs.get(msg.groupid as string)?.job?.gotAppMessage(msg, msgid);
        return;
      case "getcomplexfsstats":
      case "getmallocstats":
      case "getlocks":
        proc!.sendAppRequest(this, msg, msgid);
        return;
    }

    if (msg.type.startsWith("job-")) {
      if (!proc) {
        this.sendProcessGone(msg.processcode, msgid);
        return;
      }
      const entry = proc.attachedJobs.get(msg.groupid as string);
      if (!entry || entry.app !== this || !entry.job) {
        // Not attached (or attached by another application). Reply, so a requester waiting for a response gets one
        this.send({ type: "job-disconnected", processcode: proc.processcode, groupid: msg.groupid }, msgid);
        return;
      }
      entry.job.gotAppMessage(msg, msgid);
      return;
    }

    this.send({ type: "error", msg: `Unknown app message type '${msg.type}'` }, msgid);
  }
}

export async function startHSDebugManager({ debug = 0 }: { debug?: number } = {}) {
  debugLevel = debug;
  const mgr = new HSDebugManager;
  await mgr.start();
  return mgr;
}
