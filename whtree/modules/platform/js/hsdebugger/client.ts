/* TypeScript client for the HareScript debug manager (wh:debugmgr). This replaces the HareScript
   mod::system/lib/internal/debugger/connector.whlib for TypeScript tools, so they don't need a HareScript VM.

   Usage:
     await using conn = await HSDebugConnection.connect();
     const jobs = await conn.listAllJobs();
     await conn.withPausedJob(jobs[0].groupid, async (job, status) => { ... });
*/

import bridge from "@mod-system/js/internal/whmanager/bridge";
import type { IPCEndPoint, IPCMessagePacket } from "@mod-system/js/internal/whmanager/ipc";
import type { IPCMarshallableRecord } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { defaultDateTime } from "@webhare/hscompat";
import { LibraryDebugInfo } from "./debuginfo";
import {
  debugManagerPortName, errorReplyTypes,
  type DebugBreakpoint, type DebugInfoResponse, type DebugJobInfo, type DebugJobStatus, type DebugLibraryInfo,
  type DebugProcessInfo, type GetVariablesRequest, type RawDebugValue, type RawFunctionProfile
} from "./protocol";

type Message = IPCMarshallableRecord & { type: string };
type DebugLink = IPCEndPoint<IPCMarshallableRecord, IPCMarshallableRecord>;

/** Error returned by the debug manager or the debugger in a process */
export class HSDebugError extends Error {
  readonly reply: Message;

  constructor(reply: Message, what: string) {
    super(`${what} failed: ${reply.type}${typeof reply.msg === "string" && reply.msg ? ` (${reply.msg})` : ""}`);
    this.reply = reply;
  }
}

/** A job with its process, as returned by HSDebugConnection.listAllJobs */
export interface DebugJobEntry extends DebugJobInfo {
  processcode: bigint;
  clientname: string;
}

/** Default time to wait for a reply */
const defaultTimeout = 10000;

function sameCode(a: unknown, b: unknown) {
  return a !== undefined && b !== undefined && String(a) === String(b);
}

/** Convert a DATETIME duration (as used for total_running) to milliseconds */
export function durationToMsecs(duration: Date): number {
  return duration.getTime() - defaultDateTime.getTime();
}

interface MessageWaiter {
  match: (msg: Message, replyto: bigint) => boolean;
  resolve: (msg: Message) => void;
}

/** Connection to the HareScript debug manager */
export class HSDebugConnection implements AsyncDisposable, Disposable {
  private link: DebugLink;
  private waiters = new Set<MessageWaiter>();
  private jobs = new Map<string, HSDebugJob>();
  private closed = false;
  /** Debug info cache, keyed by library and compile id */
  private debugInfoCache = new Map<string, LibraryDebugInfo>();

  private constructor(link: DebugLink) {
    this.link = link;
    link.on("message", packet => this.gotMessage(packet as IPCMessagePacket<Message>));
    link.on("close", () => this.gotClose());
  }

  /** Connect to the debug manager. Throws if it isn't running */
  static async connect(): Promise<HSDebugConnection> {
    const link = bridge.connect(debugManagerPortName, { global: true });
    const conn = new HSDebugConnection(link);
    try {
      await link.activate();
    } catch (e) {
      link.close();
      throw new Error(`Cannot connect to the HareScript debug manager (${debugManagerPortName}): ${(e as Error).message}`, { cause: e });
    }
    return conn;
  }

  private gotMessage(packet: IPCMessagePacket<Message>) {
    const msg = packet.message;
    for (const waiter of this.waiters)
      if (waiter.match(msg, packet.replyto)) {
        this.waiters.delete(waiter);
        waiter.resolve(msg);
        return;
      }

    if (msg.type.startsWith("job-") && typeof msg.groupid === "string") {
      const job = this.jobs.get(msg.groupid);
      if (job && sameCode(job.processcode, msg.processcode)) {
        job.gotMessage(msg);
        return;
      }
      if (msg.type === "job-connected") {
        // Connected because of a rule we didn't set (or after we gave up waiting). Let it go again
        this.link.send({ type: "job-disconnect", processcode: msg.processcode, groupid: msg.groupid });
      }
    }
  }

  private gotClose() {
    this.closed = true;
    for (const job of this.jobs.values())
      job.gotDisconnected();
    this.jobs.clear();
    for (const waiter of this.waiters)
      waiter.resolve({ type: "error", msg: "Connection to the debug manager was closed" });
    this.waiters.clear();
  }

  /** Send a message and wait for a matching message (a reply, or an event) */
  private async sendAndWait(message: Message, what: string, match: (msg: Message, replyto: bigint, msgid: bigint) => boolean, timeout = defaultTimeout): Promise<Message> {
    if (this.closed)
      throw new Error("Connection to the debug manager is closed");

    let msgid = 0n;
    const { promise, resolve } = Promise.withResolvers<Message>();
    const waiter: MessageWaiter = { match: (msg, replyto) => match(msg, replyto, msgid), resolve };
    this.waiters.add(waiter);
    let timer;
    try {
      msgid = this.link.send(message);
      const timeoutPromise = new Promise<null>(res => { timer = setTimeout(() => res(null), timeout); });
      const result = await Promise.race([promise, timeoutPromise]);
      if (!result)
        throw new Error(`No response from the debug manager to the ${what} request within ${timeout}ms`);
      if (errorReplyTypes.has(result.type))
        throw new HSDebugError(result, `The ${what} request`);
      return result;
    } finally {
      clearTimeout(timer);
      this.waiters.delete(waiter);
    }
  }

  /** Send a request that gets a reply
      @param message - Request
      @param what - Description of the request for error messages
      @param options - timeout: maximum time to wait. groupid: fail the request when this job is disconnected
  */
  async request(message: Message, what: string, { timeout = defaultTimeout, groupid }: { timeout?: number; groupid?: string } = {}): Promise<Message> {
    return await this.sendAndWait(message, what, (msg, replyto, msgid) => replyto === msgid
      || (groupid !== undefined && msg.type === "job-disconnected" && msg.groupid === groupid && sameCode(msg.processcode, message.processcode)), timeout);
  }

  /** List the HareScript processes registered with the debug manager */
  async listProcesses(): Promise<DebugProcessInfo[]> {
    const reply = await this.request({ type: "getprocesslist" }, "process list");
    return (reply.processes as unknown as DebugProcessInfo[]) ?? [];
  }

  /** List the jobs of a process */
  async listJobs(processcode: bigint): Promise<DebugJobInfo[]> {
    const reply = await this.sendAndWait({ type: "getjoblist", processcode }, "job list",
      (msg, replyto, msgid) => (msg.type === "joblist" && sameCode(msg.processcode, processcode)) || (replyto === msgid && msg.type === "process-gone"));
    return (reply.jobs as unknown as DebugJobInfo[]) ?? [];
  }

  /** List the jobs of all processes. Processes that exit while listing are skipped */
  async listAllJobs(): Promise<DebugJobEntry[]> {
    const processes = await this.listProcesses();
    const perProcess = await Promise.all(processes.map(async proc => {
      try {
        return (await this.listJobs(proc.processcode)).map(job => ({ ...job, processcode: proc.processcode, clientname: proc.clientname }));
      } catch {
        return [];
      }
    }));
    return perProcess.flat();
  }

  /** Find a job by its group id */
  async findJob(groupid: string): Promise<DebugJobEntry> {
    const job = (await this.listAllJobs()).find(entry => entry.groupid === groupid);
    if (!job)
      throw new Error(`No job with group id '${groupid}'`);
    return job;
  }

  /** Get the job locks of a process */
  async getLocks(processcode: bigint): Promise<IPCMarshallableRecord[]> {
    const reply = await this.request({ type: "getlocks", processcode }, "locks");
    return (reply.rawdata as IPCMarshallableRecord[]) ?? [];
  }

  /** Attach to a job. Only one debugger can be attached to a job at a time
      @param groupid - Group id of the job
      @param processcode - Process of the job. Looked up if not specified
  */
  async attach(groupid: string, processcode?: bigint): Promise<HSDebugJob> {
    processcode ??= (await this.findJob(groupid)).processcode;
    if (this.jobs.has(groupid))
      throw new Error(`Already attached to job '${groupid}'`);

    const reply = await this.sendAndWait({ type: "jobconnect", processcode, groupid }, "attach",
      (msg, replyto, msgid) => (replyto === msgid && msg.type === "process-gone")
        || ((msg.type === "job-connected" || msg.type === "job-connectfail") && msg.groupid === groupid && sameCode(msg.processcode, processcode)));
    if (reply.type === "job-connectfail")
      throw new Error(`Could not attach to job '${groupid}': ${String(reply.reason) === "already_connected" ? "a debugger is already attached to it" : String(reply.reason)}`);

    const job = new HSDebugJob(this, processcode, groupid, reply.status as unknown as DebugJobStatus);
    this.jobs.set(groupid, job);
    return job;
  }

  /** @internal Send a message without waiting */
  send(message: Message) {
    if (!this.closed)
      this.link.send(message);
  }

  /** @internal */
  forgetJob(job: HSDebugJob) {
    if (this.jobs.get(job.groupid) === job)
      this.jobs.delete(job.groupid);
  }

  /** @internal Get debug info from the cache */
  getCachedDebugInfo(key: string) {
    return this.debugInfoCache.get(key);
  }

  /** @internal */
  setCachedDebugInfo(key: string, info: LibraryDebugInfo) {
    this.debugInfoCache.set(key, info);
  }

  /** Attach to a job, pause it, run a callback and let the job continue again (also if the callback throws)
      @param groupid - Group id of the job
      @param callback - Called while the job is paused
      @param options - timeout: maximum time to wait for the job to pause
  */
  async withPausedJob<T>(groupid: string, callback: (job: HSDebugJob, status: DebugJobStatus) => Promise<T>, { timeout = 5000 }: { timeout?: number } = {}): Promise<T> {
    const job = await this.attach(groupid);
    try {
      const status = await job.pause({ timeout });
      try {
        return await callback(job, status);
      } finally {
        job.continue();
      }
    } finally {
      job.detach();
    }
  }

  close() {
    for (const job of [...this.jobs.values()])
      job.detach();
    this.link.close();
    this.gotClose();
  }

  [Symbol.dispose]() {
    this.close();
  }

  async [Symbol.asyncDispose]() {
    this.close();
  }
}

/** A job the debugger is attached to */
export class HSDebugJob {
  private statusWaiters = new Set<(status: DebugJobStatus | null) => void>();
  private _status: DebugJobStatus;
  private _attached = true;

  private readonly conn: HSDebugConnection;
  readonly processcode: bigint;
  readonly groupid: string;

  constructor(conn: HSDebugConnection, processcode: bigint, groupid: string, status: DebugJobStatus) {
    this.conn = conn;
    this.processcode = processcode;
    this.groupid = groupid;
    this._status = status;
  }

  /** Last known status of the job */
  get status(): DebugJobStatus {
    return this._status;
  }

  get attached() {
    return this._attached;
  }

  /** Whether the job is paused (or has terminated, in which case it can also be inspected) */
  get paused() {
    return ["DebugStopped", "Terminated"].includes(this._status.realstatus);
  }

  /** @internal */
  gotMessage(msg: Message) {
    switch (msg.type) {
      case "job-statechange": {
        this._status = msg.status as unknown as DebugJobStatus;
        for (const waiter of this.statusWaiters)
          waiter(this._status);
      } break;
      case "job-disconnected": {
        this.gotDisconnected();
      } break;
    }
  }

  /** @internal */
  gotDisconnected() {
    this._attached = false;
    for (const waiter of this.statusWaiters)
      waiter(null);
    this.statusWaiters.clear();
  }

  /** Wait for a status change matching a condition */
  async waitForStatus(condition: (status: DebugJobStatus) => boolean, { timeout = defaultTimeout }: { timeout?: number } = {}): Promise<DebugJobStatus> {
    if (condition(this._status))
      return this._status;
    if (!this._attached)
      throw new Error(`Not attached to job '${this.groupid}'`);

    const { promise, resolve, reject } = Promise.withResolvers<DebugJobStatus>();
    const waiter = (status: DebugJobStatus | null) => {
      if (!status)
        reject(new Error(`Job '${this.groupid}' was disconnected`));
      else if (condition(status))
        resolve(status);
    };
    this.statusWaiters.add(waiter);
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for job '${this.groupid}'`)), timeout);
    try {
      return await promise;
    } finally {
      clearTimeout(timer);
      this.statusWaiters.delete(waiter);
    }
  }

  /** Pause the job. Throws if it doesn't pause in time; it is told to continue then, so it isn't left paused when the pause
      arrives later
      @returns The status of the paused job, including its stack trace
  */
  async pause({ timeout = 5000 }: { timeout?: number } = {}): Promise<DebugJobStatus> {
    this.conn.send({ type: "job-pause", processcode: this.processcode, groupid: this.groupid });
    try {
      return await this.waitForStatus(status => ["DebugStopped", "Terminated"].includes(status.realstatus), { timeout });
    } catch (e) {
      if (this._attached) {
        this.continue();
        // If the pause still arrives shortly after, continue again
        void this.waitForStatus(status => status.realstatus === "DebugStopped", { timeout: 2000 }).then(() => this.continue(), () => { });
      }
      throw new Error(`Job '${this.groupid}' did not pause within ${timeout} ms (it may be busy inside a native call)`, { cause: e });
    }
  }

  /** Let a paused job continue */
  continue() {
    if (this._attached)
      this.conn.send({ type: "job-continue", processcode: this.processcode, groupid: this.groupid });
  }

  /** Terminate the job */
  terminate() {
    this.conn.send({ type: "job-terminate", processcode: this.processcode, groupid: this.groupid });
  }

  /** Detach from the job. A paused job continues */
  detach() {
    if (this._attached)
      this.conn.send({ type: "job-disconnect", processcode: this.processcode, groupid: this.groupid });
    this.conn.forgetJob(this);
    this.gotDisconnected();
  }

  private async jobRequest(message: Message, what: string): Promise<Message> {
    if (!this._attached)
      throw new Error(`Not attached to job '${this.groupid}'`);
    try {
      return await this.conn.request({ ...message, processcode: this.processcode, groupid: this.groupid }, what, { groupid: this.groupid });
    } catch (e) {
      if (e instanceof HSDebugError && e.reply.type === "job-disconnected")
        this.gotDisconnected();
      throw e;
    }
  }

  /** Get variables (the job must be paused) */
  async getVariables(requests: GetVariablesRequest[]): Promise<RawDebugValue[]> {
    const reply = await this.jobRequest({ type: "job-getvariables", variables: requests as unknown as IPCMarshallableRecord[] }, "get variables");
    return reply.variables as unknown as RawDebugValue[];
  }

  /** Get the libraries the job has loaded (the job must be paused) */
  async getLibraries(): Promise<DebugLibraryInfo[]> {
    const reply = await this.jobRequest({ type: "job-getlibraries" }, "get libraries");
    return reply.libraries as unknown as DebugLibraryInfo[];
  }

  /** Get the debug information of a library as the job loaded it (the job must be paused) */
  async getDebugInfo(liburi: string): Promise<LibraryDebugInfo> {
    const reply = await this.jobRequest({ type: "job-getdebuginfo", liburi }, "get debug info") as unknown as DebugInfoResponse;
    if (reply.type !== "job-debuginfo")
      throw new Error(`The debugger in this process doesn't support debug info requests (got '${(reply as { type: string }).type}')`);
    if (!reply.found)
      throw new Error(`The job hasn't loaded library '${liburi}'`);

    const key = `${liburi}\t${reply.compile_id.toISOString()}`;
    let info = this.conn.getCachedDebugInfo(key);
    if (!info) {
      info = LibraryDebugInfo.fromCompressed(new Uint8Array(await reply.debuginfo_compressed.arrayBuffer()), reply.sourcemap);
      this.conn.setCachedDebugInfo(key, info);
    }
    return info;
  }

  /** Get the open handles of the job (the job must be paused) */
  async getHandleList(): Promise<Array<{ id: number; name: string }>> {
    const reply = await this.jobRequest({ type: "job-gethandlelist" }, "get handles");
    const rawdata = reply.rawdata as { items?: Array<{ id: number; name: string }> } | null;
    return rawdata?.items ?? [];
  }

  /** Switch profiling on or off (the job must be paused)
      @param type - 'function', 'memory', or 'all' (only to switch off)
  */
  async setProfiling(type: "function" | "memory" | "all", enable: boolean, reset: boolean): Promise<void> {
    await this.jobRequest({ type: "job-setprofiling", profiletype: type, enable, reset }, "set profiling");
  }

  /** Get the function profile (the job must be paused) */
  async getFunctionProfile(): Promise<RawFunctionProfile> {
    const reply = await this.jobRequest({ type: "job-getprofile", profiletype: "function" }, "get profile");
    if (!reply.rawdata)
      throw new Error(`The job did not return a profile (response '${reply.type}')`);
    return reply.rawdata as unknown as RawFunctionProfile;
  }

  /** Set the breakpoints of the job. Replaces all earlier breakpoints */
  async setBreakpoints(config: { breakpoints: DebugBreakpoint[]; breakOnException?: boolean; minStackSize?: number; maxStackSize?: number }): Promise<void> {
    await this.jobRequest({
      type: "job-setbreakpoints",
      breakpoints: config.breakpoints as unknown as IPCMarshallableRecord[],
      breakonexception: config.breakOnException ?? false,
      minstacksize: config.minStackSize ?? 0,
      maxstacksize: config.maxStackSize ?? 0x7fffffff,
    }, "set breakpoints");
  }
}
