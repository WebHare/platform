/* Debugger support for HareScript running in the WASM engine.

   Native HareScript processes have a C++ debugger thread (harescript/vm/hsvm_debugger.cpp) that connects to the debug
   manager's wh:debugmgr_internal port. This agent does the same for the VMs running scripts in this thread, speaking the
   same protocol, so the debugger screen, the TypeScript debugger client and the MCP tools see them as jobs.

   There's no separate thread here: the agent runs when the VM isn't executing instructions.
   - A VM that waits for an async external function (IPC, database, timers...) can be inspected right away. It is paused
     by not letting it continue when the external function finishes until the debugger continues it
   - Breakpoints and steps stop the VM through a JSPI suspension (supportDebugStop in hsvm_context.cpp)
   - While a debugger is attached, the VM runs in debug mode and gives the event loop a chance to run every so often
     (supportDebugPoll), so a busy VM can be paused too
   Only VMs that run a script (run(), eg jobs and `wh run` of a WASM engine script) are registered, not VMs used for loadlib.
*/

import { threadId } from "node:worker_threads";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import type { IPCEndPoint, IPCMessagePacket } from "@mod-system/js/internal/whmanager/ipc";
import { readMarshalPacket, writeMarshalPacket, type IPCMarshallableRecord } from "@mod-system/js/internal/whmanager/hsmarshalling";
import type { HSVM_VariableId } from "../../../lib/harescript-interface";
import type { HareScriptVM } from "./wasm-hsvm";
import { makeDateFromParts } from "@webhare/hscompat/src/datetime";

type Message = IPCMarshallableRecord & { type: string };
type Link = IPCEndPoint<IPCMarshallableRecord, IPCMarshallableRecord>;

const commandPortName = "wh:debugmgr_internal";

/** Pause reasons, as used by the native debugger */
const PauseReason = { request: 1 } as const;

/** Minimum time between giving the event loop a chance to run while a debugger is attached */
const pollIntervalMs = 50;

/** Debugger state of a VM */
export class WasmVMDebugState {
  readonly vm: HareScriptVM;
  readonly agent: WasmDebugAgent;
  readonly script: string;
  readonly creationdate = new Date;
  connected = false;
  /** Number of async external function calls the VM is waiting for */
  waitingCalls = 0;
  /** Set while the VM is suspended in a debug poll */
  polling = false;
  /** Gate that holds the VM while it's paused */
  private gate: PromiseWithResolvers<void> | null = null;
  pauseReasons = 0;
  /** A pause was requested while the VM was running */
  wantPause = false;
  private lastPoll = Date.now();

  constructor(agent: WasmDebugAgent, vm: HareScriptVM, script: string) {
    this.agent = agent;
    this.vm = vm;
    this.script = script;
  }

  get groupid() {
    return this.vm.currentgroup;
  }

  get paused() {
    return Boolean(this.gate);
  }

  /** Status as known by the native debugger: DebugStopped, WaitForMultiple or Running */
  getRealStatus() {
    return this.gate ? "DebugStopped" : this.waitingCalls ? "WaitForMultiple" : "Running";
  }

  /** Keeps the process alive while the VM is paused, as nothing else may */
  private keepAlive: NodeJS.Timeout | null = null;

  /** Pause the VM. It must not be executing instructions (ie we're running because it waits or polls) */
  pauseNow(reason: number) {
    if (this.gate)
      return;
    this.gate = Promise.withResolvers<void>();
    this.keepAlive = setInterval(() => { }, 1 << 30);
    this.pauseReasons |= reason;
    this.wantPause = false;
    this.agent.sendStatus(this, "job-paused", true);
  }

  resume() {
    if (!this.gate)
      return;
    const gate = this.gate;
    this.gate = null;
    if (this.keepAlive)
      clearInterval(this.keepAlive);
    this.keepAlive = null;
    this.pauseReasons = 0;
    this.agent.sendStatus(this, "job-running", false);
    gate.resolve();
  }

  /** Wait while the VM is paused */
  async waitWhilePaused() {
    while (this.gate)
      await this.gate.promise;
  }

  // Hooks called by the VM (through WASMModule)

  /** The VM starts waiting for an async external function */
  asyncCallStart() {
    ++this.waitingCalls;
  }

  /** The async external function finished, the VM is about to continue */
  async asyncCallEnd() {
    if (this.wantPause)
      this.pauseNow(PauseReason.request);
    await this.waitWhilePaused();
    --this.waitingCalls;
    this.lastPoll = Date.now();
  }

  /** The VM hit a breakpoint or finished a step */
  async stop(reason: number) {
    if (!this.connected) // no debugger (anymore), make the VM forget its breakpoints
      return;
    this.pauseNow(reason);
    await this.waitWhilePaused();
    this.lastPoll = Date.now();
  }

  /** The VM gives the debugger a chance to run */
  async poll() {
    if (Date.now() - this.lastPoll < pollIntervalMs && !this.wantPause)
      return;
    this.polling = true;
    try {
      await new Promise(resolve => setImmediate(resolve)); // let the event loop (and so the agent) run
      if (this.wantPause)
        this.pauseNow(PauseReason.request);
      await this.waitWhilePaused();
    } finally {
      this.polling = false;
      this.lastPoll = Date.now();
    }
  }

  // Requests for the VM. Results are built in a temporary variable of the VM and marshalled out of it

  private withTempVar<T>(cb: (varid: HSVM_VariableId) => T): T {
    const module = this.vm.wasmmodule;
    const varid = module._HSVM_AllocateVariable(this.vm.hsvm);
    try {
      return cb(varid);
    } finally {
      module._HSVM_DeallocateVariable(this.vm.hsvm, varid);
    }
  }

  /** Read a variable of the VM as an IPC marshallable value */
  readVariable(varid: HSVM_VariableId): unknown {
    const module = this.vm.wasmmodule;
    const stats = { totalsize: 0 };
    const dataPtr = module._WriteMarshalPacket(this.vm.hsvm, varid, 0, module.Emval.toHandle(stats));
    if (!dataPtr)
      throw new Error("Could not marshal the debugger data");
    try {
      const buffer = Buffer.from(module.HEAPU8.slice(dataPtr, dataPtr + Number(stats.totalsize)));
      return readMarshalPacket(buffer);
    } finally {
      module._free(dataPtr);
    }
  }

  /** Store a value in a variable of the VM */
  writeVariable(varid: HSVM_VariableId, value: unknown) {
    const module = this.vm.wasmmodule;
    const packet = writeMarshalPacket(value);
    const dataPtr = module._malloc(packet.length);
    try {
      module.HEAPU8.set(packet, dataPtr);
      module._ReadMarshalPacket(this.vm.hsvm, varid, dataPtr, dataPtr + packet.length);
    } finally {
      module._free(dataPtr);
    }
  }

  query(func: (varid: HSVM_VariableId) => void): unknown {
    return this.withTempVar(varid => {
      func(varid);
      return this.readVariable(varid);
    });
  }

  /** Call a function with a value stored in a variable of the VM */
  withInput(input: unknown, func: (inputvar: HSVM_VariableId) => void) {
    this.withTempVar(inputvar => {
      this.writeVariable(inputvar, input);
      func(inputvar);
    });
  }

  queryWithInput(input: unknown, func: (inputvar: HSVM_VariableId, varid: HSVM_VariableId) => void): unknown {
    return this.withTempVar(inputvar => {
      this.writeVariable(inputvar, input);
      return this.query(varid => func(inputvar, varid));
    });
  }

  setAttached(attached: boolean) {
    this.vm.wasmmodule._DebugSetAttached(this.vm.hsvm, attached ? 1 : 0);
  }

  /** Status record, as sent by the native debugger */
  getStatus(type: string, extended: boolean): IPCMarshallableRecord {
    const realstatus = this.getRealStatus();
    const status: Record<string, unknown> = {
      type,
      groupid: this.groupid,
      script: this.script,
      realstatus,
      status: realstatus === "DebugStopped" ? (this.waitingCalls ? "WaitForMultiple" : "Running") : realstatus,
      creationdate: this.creationdate,
      total_running: makeDateFromParts(1, 0), // a duration of 0: not tracked
      pausereason: this.pauseReasons,
      authenticationrecord: null
    };
    if (extended)
      Object.assign(status, this.query(varid => this.vm.wasmmodule._DebugGetStatus(this.vm.hsvm, varid)));
    return status as IPCMarshallableRecord;
  }
}

/** Connection of this thread to the debug manager */
export class WasmDebugAgent {
  private link: Link | null = null;
  private connecting = false;
  readonly jobs = new Map<string, WasmVMDebugState>();
  private informStartStop = false;
  readonly processcode = BigInt(process.pid) * 1000n + BigInt(threadId);

  constructor() {
    bridge.on("hsdebugger", present => {
      if (present)
        this.ensureConnected();
      else
        this.link?.close();
    });
  }

  register(vm: HareScriptVM, script: string): WasmVMDebugState {
    const state = new WasmVMDebugState(this, vm, script);
    this.jobs.set(state.groupid, state);
    this.ensureConnected();
    if (this.informStartStop)
      this.send({ ...this.jobRecord(state), type: "job-started", connected: false });
    return state;
  }

  unregister(state: WasmVMDebugState) {
    if (this.jobs.get(state.groupid) !== state)
      return;
    this.jobs.delete(state.groupid);
    state.resume();
    if (this.informStartStop || state.connected)
      this.send({ ...this.jobRecord(state), type: "job-terminated", status: "Terminated", connected: false, removed: true });
    if (!this.jobs.size)
      this.link?.close();
  }

  private ensureConnected() {
    if (this.link || this.connecting || !this.jobs.size || !bridge.haveHSDebugger)
      return;

    this.connecting = true;
    const link = bridge.connect(commandPortName, { global: true }) as Link;
    link.on("message", packet => this.gotMessage(packet as IPCMessagePacket<Message>));
    link.on("close", () => {
      if (this.link === link)
        this.gotDisconnected();
    });
    link.activate().then(() => {
      this.link = link;
      link.dropReference(); // don't keep the process alive for the debugger
      link.send({ type: "greeting", clientname: `node ${process.argv[1] ?? ""} (wasm thread ${threadId})`, processcode: this.processcode });
    }, () => {
      link.close();
    }).finally(() => {
      this.connecting = false;
    });
  }

  private gotDisconnected() {
    this.link = null;
    this.informStartStop = false;
    for (const job of this.jobs.values())
      if (job.connected) {
        job.connected = false;
        job.setAttached(false);
        job.resume();
      }
  }

  send(message: IPCMarshallableRecord, replyto?: bigint) {
    this.link?.send(message, replyto);
  }

  sendStatus(job: WasmVMDebugState, type: string, extended: boolean) {
    if (job.connected)
      this.send(job.getStatus(type, extended));
  }

  private jobRecord(job: WasmVMDebugState): IPCMarshallableRecord {
    const status = job.getStatus("", false) as Record<string, unknown>;
    return { groupid: job.groupid, script: job.script, status: status.realstatus, creationdate: job.creationdate, total_running: status.total_running, authenticationrecord: null } as IPCMarshallableRecord;
  }

  private gotMessage(packet: IPCMessagePacket<Message>) {
    try {
      this.handleMessage(packet.message, packet.msgid);
    } catch (e) {
      let msg = e instanceof Error && e.message ? e.message : String(e);
      const module = this.jobs.get(packet.message.groupid as string)?.vm.wasmmodule as unknown as { getExceptionMessage?: (e: unknown) => string[] } | undefined;
      if (e instanceof WebAssembly.Exception && module?.getExceptionMessage)
        msg = module.getExceptionMessage(e).join(": "); // a C++ exception
      this.send({ type: packet.message.groupid ? "job-error" : "error", groupid: (packet.message.groupid as string) ?? "", msg }, packet.msgid);
    }
  }

  private handleMessage(msg: Message, msgid: bigint) {
    switch (msg.type) {
      case "configure": {
        // Only the rules that ask to be informed about starting and stopping jobs are supported
        const rules = (msg.addrules as Array<{ inform_start_stop?: boolean }>) ?? [];
        this.informStartStop = rules.some(rule => rule.inform_start_stop);
        return;
      }
      case "getjobmgrstatus":
        this.send({ type: "getjobmgrstatus-response", jobs: [...this.jobs.values()].map(job => this.jobRecord(job)) }, msgid);
        return;
      case "getlocks":
      case "getcomplexfsstats":
      case "getmallocstats":
        this.send({ type: `${msg.type}-response`, rawdata: msg.type === "getlocks" ? [] : null }, msgid);
        return;
    }

    const groupid = msg.groupid as string;
    const job = this.jobs.get(groupid);
    const reply = (type: string) => this.send({ type, groupid }, msgid);

    switch (msg.type) {
      case "connectjob": {
        if (!job)
          return reply("connectjob-gone");
        if (job.connected)
          return reply("connectjob-alreadyconnected");
        job.connected = true;
        job.setAttached(true);
        this.send(job.getStatus("connectjob-ack", false));
        return;
      }
      case "disconnectjob": {
        if (job?.connected) {
          job.connected = false;
          job.setAttached(false);
          job.resume();
        }
        return;
      }
      case "terminatejob":
        // Not supported for VMs in the WASM engine
        return;
    }

    if (!job || !job.connected)
      return reply("error-notconnected");

    switch (msg.type) {
      case "pausejob": {
        if (job.polling || job.waitingCalls)
          job.pauseNow(PauseReason.request);
        else
          job.wantPause = true; // will pause at the next poll or async call
        return;
      }
      case "continuejob":
        job.resume();
        return;
      case "setbreakpoints": {
        job.withInput({
          breakpoints: msg.breakpoints,
          minstacksize: msg.minstacksize,
          maxstacksize: msg.maxstacksize,
          breakonexception: msg.breakonexception
        }, inputvar => job.vm.wasmmodule._DebugSetBreakpoints(job.vm.hsvm, inputvar));
        return reply("job-setbreakpoints");
      }
      case "getjobstatus":
        this.send(job.getStatus("job-status", job.paused), msgid);
        return;
    }

    // The other requests need a paused job
    if (!job.paused)
      return reply("error-notstopped");

    const module = job.vm.wasmmodule, hsvm = job.vm.hsvm;
    switch (msg.type) {
      case "getvariables": {
        const variables = job.queryWithInput(msg.variables, (inputvar, varid) => module._DebugGetVariables(hsvm, inputvar, varid));
        this.send({ type: "job-variables", groupid, variables } as IPCMarshallableRecord, msgid);
        return;
      }
      case "getlibraries": {
        const libraries = job.query(varid => module._DebugGetLibraries(hsvm, varid));
        this.send({ type: "job-libraries", groupid, libraries } as IPCMarshallableRecord, msgid);
        return;
      }
      case "getdebuginfo": {
        const liburi = String(msg.liburi);
        const uriPtr = module.stringToNewUTF8(liburi);
        try {
          const info = job.query(varid => module._DebugGetDebugInfo(hsvm, uriPtr, varid)) as Record<string, unknown>;
          this.send({ ...info, type: "job-debuginfo", groupid, liburi } as IPCMarshallableRecord, msgid);
        } finally {
          module._free(uriPtr);
        }
        return;
      }
      case "gethandlelist": {
        const rawdata = job.query(varid => module._DebugGetHandleList(hsvm, varid));
        this.send({ type: "job-gethandlelist-response", groupid, rawdata } as IPCMarshallableRecord, msgid);
        return;
      }
      case "setprofiling": {
        const type = String(msg.profiletype);
        if (type === "memory")
          throw new Error("Memory profiles aren't supported for VMs in the WASM engine");
        module._DebugSetFunctionProfiling(hsvm, msg.value && type === "function" ? 1 : 0, msg.reset ? 1 : 0);
        return reply("job-setprofiling");
      }
      case "getprofile": {
        if (msg.profiletype !== "function")
          throw new Error("Only function profiles are supported for VMs in the WASM engine");
        const rawdata = job.query(varid => module._DebugGetFunctionProfile(hsvm, varid));
        this.send({ type: "job-getprofile-response", groupid, rawdata } as IPCMarshallableRecord, msgid);
        return;
      }
    }
    throw new Error(`Unsupported debugger request '${msg.type}'`);
  }
}

let agent: WasmDebugAgent | undefined;

/** Register a VM running a script with the debugger */
export function registerVMWithDebugger(vm: HareScriptVM, script: string): WasmVMDebugState {
  agent ??= new WasmDebugAgent;
  return agent.register(vm, script);
}

export function unregisterVMWithDebugger(state: WasmVMDebugState) {
  state.agent.unregister(state);
}
