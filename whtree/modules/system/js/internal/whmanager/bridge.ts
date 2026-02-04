import EventSource from "../eventsource";
import { WHManagerConnection, type WHMResponse } from "./whmanager_conn";
import { type WHMRequest, WHMRequestOpcode, WHMResponseOpcode, WHMProcessType, type LogFileConfiguration } from "./whmanager_rpcdefs";
import * as hsmarshalling from "./hsmarshalling";
import { registerAsNonReloadableLibrary, getState as getHMRState } from "../../../../../jssdk/services/src/hmrinternal";
import { pick, generateRandomId } from "@webhare/std";
import { type IPCPortControlMessage, type IPCEndPointImplControlMessage, IPCEndPointImpl, IPCPortImpl, IPCPortControlMessageType, IPCEndPointImplControlMessageType, type IPCLinkType } from "./ipc";
import { type TypedMessagePort, createTypedMessageChannel, bufferToArrayBuffer, type AnyTypedMessagePort } from './transport';
import { RefTracker } from "./refs";
import * as stacktrace_parser from "stacktrace-parser";
import type { ConsoleLogItem } from "@webhare/env/src/concepts";
import { type DebugIPCLinkType, DebugRequestType, DebugResponseType, type PortList, type ProcessList } from "./debug";
import * as inspector from "node:inspector";
import * as envbackend from "@webhare/env/src/envbackend";
import { getCallerLocation } from "../util/stacktrace";
import { reloadBackendConfig } from "../configuration";
import { getActiveCodeContexts, getCodeContext } from "@webhare/services/src/codecontexts";
import { isMainThread, type TransferListItem, workerData } from "node:worker_threads";
import { formatLogObject, type LoggableRecord } from "@webhare/services/src/logmessages";
import { type ConvertLocalServiceInterfaceToClientInterface, initNewLocalServiceProxy, type LocalServiceRequest, type LocalServiceResponse, type ServiceBase } from "@webhare/services/src/localservice";
import { getScriptName } from "@webhare/system-tools";
import type { Socket } from "node:net";
import { allocateWorkerNr } from "@webhare/services/src/symbols";

export type { IPCMessagePacket, IPCLinkType } from "./ipc";
export type { SimpleMarshallableData, SimpleMarshallableRecord, IPCMarshallableData, IPCMarshallableRecord } from "./hsmarshalling";
export { dumpActiveIPCMessagePorts } from "./transport";

/** Number of milliseconds before connection to whmanager times out. At startup, just the connect alone can
    take multiple seconds, so using a very high number here.
*/
const whmanager_connection_timeout = 15000;

export type BridgeEventData = hsmarshalling.SimpleMarshallableRecord;
export type BridgeMessageData = hsmarshalling.IPCMarshallableRecord;
export type BridgeEvent<DataType extends BridgeEventData = BridgeEventData> = {
  name: string;
  data: DataType;
};

type BridgeEvents = {
  event: BridgeEvent;
  systemconfig: Record<string, unknown>;
};

type CreatePortOptions = {
  global?: boolean;
};

type ConnectOptions = {
  global?: boolean;
};

export interface LogNoticeOptions {
  groupid?: string;
  script?: string;
  ///Error specific data, 'free form'
  data?: LoggableRecord;
  info?: hsmarshalling.IPCMarshallableRecord;
  contextinfo?: hsmarshalling.IPCMarshallableRecord;
}

export interface LogErrorOptions extends LogNoticeOptions {
  errortype?: "exception" | "unhandledRejection";
}

interface Bridge extends EventSource<BridgeEvents> {
  get connected(): boolean;
  get ready(): Promise<void>;
  get systemconfig(): unknown;

  /** Returns the current group id */
  getGroupId(): string;

  /** Send an event
      @param eventname - Name of the event
      @param eventdata - Event data
  */
  sendEvent(eventname: string, eventdata: BridgeEventData): void;

  /** Create an IPC port
      @typeParam LinkType - Type describing the link configuration
      @param name - Name of the port
      @param options - Port creation options
      @returns IPC port
  */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createPort<LinkType extends IPCLinkType<any, any> = IPCLinkType>(name: string, options?: CreatePortOptions): LinkType["Port"];

  /** Connect to an IPC port
    @typeParam LinkType - Type describing the link configuration
    @param name - Name of the port to connect to
    @param options - Connection options
    @returns IPC link endpoint. Messages can be sent immediately.
  */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connect<LinkType extends IPCLinkType<any, any> = IPCLinkType>(name: string, options?: ConnectOptions): LinkType["ConnectEndPoint"];

  /** Write a line to a log file
      @param logname - Name of the log file
      @param logdata - Line to log
  */
  log(logname: string, logdata: LoggableRecord): void;

  /** Write a preformatted line to a log file
      @param logname - Name of the log file
      @param logline - Line to log
  */
  logRaw(logname: string, logline: string): void;

  /** Write a line to the debug log file
*/
  logDebug(logsource: string, logdata: LoggableRecord): void;

  /** Flushes a log file. Returns when the flushing has been done, throws when the log did not exist
  */
  flushLog(logname: string | "*"): Promise<void>;

  /** Log an error message to the notice log
      @param type - Message type
      @param message - Message to log
  */
  logNotice(type: "error" | "warning" | "info", message: string, options?: LogNoticeOptions): void;

  /** Log an error to the notice log
    @param e - Error to log
  */
  logError(e: Error | string, options?: LogErrorOptions): void;

  /** Ensure events and logs have been delivered to the whmanager */
  ensureDataSent(): Promise<void>;

  /** Returns a list of all currently running processes */
  getProcessList(): Promise<ProcessList>;

  /** Returns a list of all currently open ports and the pid of the process that owns them */
  getPortList(): Promise<PortList>;

  /** Return bridge initialization data for the local bridge in a worker */
  getLocalHandlerInitDataForWorker(): LocalBridgeInitData;

  /** Reconfigure log files */
  configureLogs(logfiles: LogFileConfiguration[]): Promise<boolean[]>;

  /** Connect to a local service in the thread where the mainbridge runs */
  connectToLocalService<T extends object>(factory: string, params?: hsmarshalling.IPCMarshallableData[], options?: { linger?: boolean }): Promise<ConvertLocalServiceInterfaceToClientInterface<T> & ServiceBase>;
}

enum ToLocalBridgeMessageType {
  SystemConfig,
  Event,
  FlushLogResult,
  EnsureDataSentResult,
  GetProcessListResult,
  ConfigureLogsResult,
  ConnectToLocalServiceResult,
  GetPortListResult,
}

type ToLocalBridgeMessage = {
  type: ToLocalBridgeMessageType.SystemConfig;
  connected: boolean;
  systemconfig: Record<string, unknown>;
  have_ts_debugger: boolean;
} | {
  type: ToLocalBridgeMessageType.Event;
  name: string;
  data: ArrayBuffer;
} | {
  type: ToLocalBridgeMessageType.FlushLogResult;
  requestid: number;
  success: boolean;
} | {
  type: ToLocalBridgeMessageType.EnsureDataSentResult;
  requestid: number;
} | {
  type: ToLocalBridgeMessageType.GetProcessListResult;
  requestid: number;
  processes: ProcessList;
} | {
  type: ToLocalBridgeMessageType.GetPortListResult;
  requestid: number;
  ports: PortList;
} | {
  type: ToLocalBridgeMessageType.ConfigureLogsResult;
  requestid: number;
  results: boolean[];
} | {
  type: ToLocalBridgeMessageType.ConnectToLocalServiceResult;
  requestid: number;
  error: string;
};

enum ToMainBridgeMessageType {
  SendEvent,
  RegisterPort,
  ConnectLink,
  Log,
  FlushLog,
  EnsureDataSent,
  GetProcessList,
  GetPortList,
  RegisterLocalBridge,
  ConfigureLogs,
  ConnectToLocalService,
}

type ToMainBridgeMessage = {
  type: ToMainBridgeMessageType.SendEvent;
  name: string;
  data: ArrayBuffer;
  local: boolean;
} | {
  type: ToMainBridgeMessageType.RegisterPort;
  name: string;
  port: TypedMessagePort<IPCPortControlMessage, never>;
  global: boolean;
} | {
  type: ToMainBridgeMessageType.ConnectLink;
  name: string;
  id: string;
  port: TypedMessagePort<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>;
  global: boolean;
} | {
  type: ToMainBridgeMessageType.Log;
  logname: string;
  logline: string;
} | {
  type: ToMainBridgeMessageType.FlushLog;
  requestid: number;
  logname: string;
} | {
  type: ToMainBridgeMessageType.EnsureDataSent;
  requestid: number;
} | {
  type: ToMainBridgeMessageType.GetProcessList;
  requestid: number;
} | {
  type: ToMainBridgeMessageType.GetPortList;
  requestid: number;
} | {
  type: ToMainBridgeMessageType.RegisterLocalBridge;
  workerid: string;
  workernr: number;
  port: TypedMessagePort<ToLocalBridgeMessage, ToMainBridgeMessage>;
} | {
  type: ToMainBridgeMessageType.ConfigureLogs;
  requestid: number;
  config: LogFileConfiguration[];
} | {
  type: ToMainBridgeMessageType.ConnectToLocalService;
  requestid: number;
  factory: string;
  port: MessagePort;
};

type LocalBridgeInitData = {
  workerid: string;
  workernr: number;
  port: TypedMessagePort<ToMainBridgeMessage, ToLocalBridgeMessage> | null;
  /// 2 atomic uint32's, 0: console log counter, 1: 1 if workers are (or have been) active, 0 if not
  consoleLogData: Uint32Array;
};


/** Check if all messages types have been handled in a switch. Put this function in the
 * default handler. Warning: only works for union types, because non-union types aren't
 * narrowed
*/
export function checkAllMessageTypesHandled<T extends never>(message: T, key: string): never {
  throw new Error(`message type ${(message as { [type: string]: unknown })[key]} not handled`);
}

type JavaScriptExceptionData = {
  message: string;
  trace: Array<{
    filename: string;
    line: number;
    column: number;
    functionname: string;
  }>;
  causes?: Array<{
    message: string;
    trace: Array<{
      filename: string;
      line: number;
      column: number;
      functionname: string;
    }>;
  }>;
};

let mainbridge: MainBridge | undefined;

class LocalBridge extends EventSource<BridgeEvents> {
  readonly workerid: string;
  readonly workernr: number;
  port: TypedMessagePort<ToMainBridgeMessage, ToLocalBridgeMessage> | null;
  requestcounter = 11000;
  systemconfig: Record<string, unknown>;
  _ready: PromiseWithResolvers<void>;
  connected = false;
  reftracker: RefTracker;
  debuglink?: DebugIPCLinkType["ConnectEndPoint"];

  pendingensuredatasent = new Map<number, () => void>();
  pendingflushlogs = new Map<number, { resolve: () => void; reject: (_: Error) => void }>;
  pendingreconfigurelogs = new Map<number, (results: boolean[]) => void>();
  pendinggetprocesslists = new Map<number, (processlist: ProcessList) => void>();
  pendinggetportlists = new Map<number, (portlist: PortList) => void>();
  pendingconnectlocalservice = new Map<number, (error: string) => void>();

  static getLocalBridgeInitData(localBridge: LocalBridge): LocalBridgeInitData {
    // If this is a worker, use the localHandlerInitData sent to the worker if present
    if (!isMainThread && workerData && "localHandlerInitData" in workerData) {
      return workerData.localHandlerInitData;
    }
    // Main script - initialize the main bridge
    mainbridge ??= new MainBridge;
    return mainbridge.getTopLocalBridgeInitData(localBridge);
  }

  constructor() {
    super();
    const initdata = LocalBridge.getLocalBridgeInitData(this);
    this.workerid = initdata.workerid;
    this.workernr = initdata.workernr;
    this.port = initdata.port;
    this.systemconfig = {};
    this._ready = Promise.withResolvers<void>();
    if (this.port) {
      this.port.on("message", (message) => this.handleControlMessage(message));
      this.port.unref();
      this.reftracker = new RefTracker(this.port, { initialref: false });
    } else {
      this.reftracker = new RefTracker(null, { initialref: false });
    }
  }

  get ready() {
    const lock = this.reftracker.getLock("local bridge: waiting for ready");
    return this._ready.promise.then(() => lock.release());
  }

  getGroupId() {
    return this.workerid;
  }

  handleControlMessage(message: ToLocalBridgeMessage) {
    if (envbackend.debugFlags.ipc)
      console.log(`localbridge ${this.workerid}: message from mainbridge`, { ...message, type: ToLocalBridgeMessageType[message.type] });
    switch (message.type) {
      case ToLocalBridgeMessageType.SystemConfig: {
        this.systemconfig = message.systemconfig;
        if (message.connected !== this.connected) {
          this.connected = message.connected;
          if (this.connected)
            this._ready.resolve();
          else
            this._ready = Promise.withResolvers<void>();
        }
        this.initDebugger(message.have_ts_debugger);
        //Reload the backend configuration - we may have missed system:configupdate (TODO maybe the bridge should announce the config or at least a moddate)
        reloadBackendConfig();
        this.emit("systemconfig", this.systemconfig);
      } break;
      case ToLocalBridgeMessageType.Event: {
        handleGlobalEvent(message);
        this.emit("event", {
          name: message.name,
          data: hsmarshalling.readMarshalData(message.data) as hsmarshalling.SimpleMarshallableRecord
        });
      } break;
      case ToLocalBridgeMessageType.FlushLogResult: {
        const reg = this.pendingflushlogs.get(message.requestid);
        if (envbackend.debugFlags.ipc)
          console.log(`localbridge ${this.workerid}: pending flush logs`, this.pendingflushlogs, reg);
        if (reg) {
          this.pendingflushlogs.delete(message.requestid);
          if (message.success)
            reg.resolve();
          else
            reg.reject(new Error(`Flushing the logs failed, does this log actually exist?`));
        }
      } break;
      case ToLocalBridgeMessageType.EnsureDataSentResult: {
        const reg = this.pendingensuredatasent.get(message.requestid);
        if (envbackend.debugFlags.ipc)
          console.log(`localbridge ${this.workerid}: ensuredatasent result`, message.requestid, Boolean(reg));
        if (reg) {
          this.pendingensuredatasent.delete(message.requestid);
          reg();
        }
      } break;
      case ToLocalBridgeMessageType.GetProcessListResult: {
        const reg = this.pendinggetprocesslists.get(message.requestid);
        if (envbackend.debugFlags.ipc)
          console.log(`localbridge ${this.workerid}: pendinggetprocesslists result`, message.requestid, Boolean(reg));
        if (reg) {
          this.pendinggetprocesslists.delete(message.requestid);
          reg(message.processes);
        }
      } break;
      case ToLocalBridgeMessageType.GetPortListResult: {
        const reg = this.pendinggetportlists.get(message.requestid);
        if (envbackend.debugFlags.ipc)
          console.log(`localbridge ${this.workerid}: pendinggetportlists result`, message.requestid, Boolean(reg));
        if (reg) {
          this.pendinggetportlists.delete(message.requestid);
          reg(message.ports);
        }
      } break;
      case ToLocalBridgeMessageType.ConfigureLogsResult: {
        const reg = this.pendingreconfigurelogs.get(message.requestid);
        if (envbackend.debugFlags.ipc)
          console.log(`localbridge ${this.workerid}: pendingreconfigurelogs result`, message.requestid, Boolean(reg));
        if (reg) {
          this.pendinggetprocesslists.delete(message.requestid);
          reg(message.results);
        }
      } break;
      case ToLocalBridgeMessageType.ConnectToLocalServiceResult: {
        const reg = this.pendingconnectlocalservice.get(message.requestid);
        if (envbackend.debugFlags.ipc)
          console.log(`localbridge ${this.workerid}: pendingconnectlocalservice result`, message.requestid, Boolean(reg));
        if (reg) {
          this.pendinggetprocesslists.delete(message.requestid);
          reg(message.error);
        }
      } break;
      default:
        checkAllMessageTypesHandled(message, "type");
    }
  }

  postMainBridgeMessage(message: ToMainBridgeMessage, transferList?: ReadonlyArray<TransferListItem | AnyTypedMessagePort> | undefined): void {
    if (mainbridge)
      void mainbridge.gotDirectMessage(this.workerid, message);
    else if (this.port)
      this.port.postMessage(message, transferList);
    else
      throw new Error(`no port, no mainbridge`);
  }

  sendEvent(name: string, data: unknown, { local }: { local?: boolean } = {}): void {
    this.postMainBridgeMessage({
      type: ToMainBridgeMessageType.SendEvent,
      name,
      data: bufferToArrayBuffer(hsmarshalling.writeMarshalData(data, { onlySimple: true })),
      local: local ?? false
    });
  }

  log(logname: string, logrecord: LoggableRecord): void {
    this.logRaw(logname, formatLogObject(new Date, logrecord));
  }

  logRaw(logname: string, logline: string): void {
    this.postMainBridgeMessage({
      type: ToMainBridgeMessageType.Log,
      logname,
      logline
    });
  }

  private encodeSingleJavaScriptExceptionData(e: Error): JavaScriptExceptionData {
    const trace = stacktrace_parser.parse(e?.stack ?? "").map(entry => ({
      filename: entry.file || "",
      line: entry.lineNumber || 0,
      column: entry.column || 0,
      functionname: entry.methodName || ""
    }));
    return {
      trace,
      message: e.message || "",
      ...(trace.length ? {
        errors: [{ ...pick(trace[0], ["filename", "line", "column"]), message: e.message }]
      } : {})
    };
  }

  private encodeJavaScriptExceptionData(e: Error, depth: number = 0): JavaScriptExceptionData {
    const mainerror = this.encodeSingleJavaScriptExceptionData(e);
    const causes = new Array<JavaScriptExceptionData>;
    for (let cause = e.cause as Error | undefined; cause && typeof cause === "object" && ("message in cause"); cause = cause.cause as Error) {
      mainerror.causes ??= [];
      mainerror.causes.push(this.encodeSingleJavaScriptExceptionData(cause));
      if (causes.length === 4)
        break;
    }
    return mainerror;
  }

  private encodeJavaScriptException(e: Error | string, options: LogErrorOptions) {
    const data = {
      ...(typeof e === "string" ? { message: e } : this.encodeJavaScriptExceptionData(e)),
      script: options.script ?? getScriptName(),
      browser: { name: "nodejs" },
      ...(options.info ? { info: options.info } : {}),
      ...(options.contextinfo ? { contextinfo: options.contextinfo } : {}),
    };
    return data;
  }

  logNotice(type: string, message: string, options: LogNoticeOptions = {}) {
    const groupid = options.groupid ?? this.getGroupId();
    this.log("system:notice", {
      type,
      groupid,
      ...("data" in options ? { data: options.data } : {}),
      ...this.encodeJavaScriptException(message, options)
    });
  }

  logError(e: Error, options: LogErrorOptions = {}) {
    const groupid = options.groupid ?? this.getGroupId();
    this.log("system:notice", {
      type: options.errortype === "unhandledRejection" ? "script-unhandledrejection" : "script-error",
      groupid,
      ...("data" in options ? { data: options.data } : {}),
      ...this.encodeJavaScriptException(e, options)
    });
  }

  logDebug(source: string, data: LoggableRecord) {
    this.log("system:debug", { source, groupid: this.getGroupId(), data });
  }

  async flushLog(logname: string | "*"): Promise<void> {
    const requestid = ++this.requestcounter;
    const lock = this.reftracker.getLock();
    try {
      await new Promise<void>((resolve, reject) => {
        this.pendingflushlogs.set(requestid, { resolve, reject });
        this.postMainBridgeMessage({
          type: ToMainBridgeMessageType.FlushLog,
          requestid,
          logname,
        });
      });
    } finally {
      lock.release();
    }
  }

  async ensureDataSent(): Promise<void> {
    const requestid = ++this.requestcounter;
    const lock = this.reftracker.getLock();
    try {
      await new Promise<void>((resolve) => {
        this.pendingensuredatasent.set(requestid, resolve);
        this.postMainBridgeMessage({
          type: ToMainBridgeMessageType.EnsureDataSent,
          requestid,
        });
      });
    } finally {
      lock.release();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createPort<LinkType extends IPCLinkType<any, any> = IPCLinkType>(name: string, { global }: { global?: boolean } = {}): LinkType["Port"] {
    const { port1, port2 } = createTypedMessageChannel<never, IPCPortControlMessage>("createPort " + name);
    this.postMainBridgeMessage({
      type: ToMainBridgeMessageType.RegisterPort,
      name,
      port: port2,
      global: global || false
    }, [port2]);
    return new IPCPortImpl(name, port1);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connect<LinkType extends IPCLinkType<any, any> = IPCLinkType>(name: string, { global }: { global?: boolean } = {}): LinkType["ConnectEndPoint"] {
    const { port1, port2 } = createTypedMessageChannel<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>("connect " + name);
    const id = generateRandomId();
    this.postMainBridgeMessage({
      type: ToMainBridgeMessageType.ConnectLink,
      name,
      id: `${id} - remote (${name})`,
      port: port1,
      global: global || false
    }, [port1]);
    return new IPCEndPointImpl(`${id} - origin (${name})`, port2, "connecting", global ? `global port ${JSON.stringify(name)}` : `local port ${JSON.stringify(name)}`);
  }

  async getProcessList(): Promise<ProcessList> {
    const requestid = ++this.requestcounter;
    const lock = this.reftracker.getLock();
    try {
      return await new Promise<ProcessList>((resolve) => {
        this.pendinggetprocesslists.set(requestid, resolve);
        this.postMainBridgeMessage({
          type: ToMainBridgeMessageType.GetProcessList,
          requestid,
        });
      });
    } finally {
      lock.release();
    }
  }

  async getPortList(): Promise<PortList> {
    const requestid = ++this.requestcounter;
    const lock = this.reftracker.getLock();
    try {
      return await new Promise<PortList>((resolve) => {
        this.pendinggetportlists.set(requestid, resolve);
        this.postMainBridgeMessage({
          type: ToMainBridgeMessageType.GetPortList,
          requestid,
        });
      });
    } finally {
      lock.release();
    }
  }

  getLocalHandlerInitDataForWorker(): LocalBridgeInitData {
    const { port1, port2 } = createTypedMessageChannel<ToLocalBridgeMessage, ToMainBridgeMessage>("getTopLocalBridgeInitData");
    const workernr = allocateWorkerNr();
    const workerid = generateRandomId();
    this.postMainBridgeMessage({
      type: ToMainBridgeMessageType.RegisterLocalBridge,
      workerid,
      workernr,
      port: port1
    }, [port1]);
    port2.unref();
    return { workerid, workernr, port: port2, consoleLogData };
  }

  async configureLogs(logfiles: LogFileConfiguration[]) {
    const requestid = ++this.requestcounter;
    using lock = this.reftracker.getLock();
    void (lock);

    return await new Promise<boolean[]>((resolve) => {
      this.pendingreconfigurelogs.set(requestid, resolve);
      this.postMainBridgeMessage({
        type: ToMainBridgeMessageType.ConfigureLogs,
        requestid,
        config: logfiles
      });
    });
  }

  async connectToLocalService<T extends object>(factory: string, params?: unknown[], options?: { linger?: boolean }): Promise<ConvertLocalServiceInterfaceToClientInterface<T> & ServiceBase> {
    const requestid = ++this.requestcounter;
    using lock = this.reftracker.getLock();
    void (lock);

    const { port1, port2 } = createTypedMessageChannel<LocalServiceRequest, LocalServiceResponse>();

    const error = await new Promise<string>((resolve) => {
      this.pendingconnectlocalservice.set(requestid, resolve);
      this.postMainBridgeMessage({
        type: ToMainBridgeMessageType.ConnectToLocalService,
        requestid,
        factory,
        port: port2 as unknown as MessagePort,
      }, [port2]);
    });

    if (error)
      throw new Error(`Could not connect to local service ${JSON.stringify(factory)}: ${error}`);

    return initNewLocalServiceProxy<T>(port1, "factory", params ?? []);
  }

  initDebugger(has_ts_debugger: boolean) {
    if (this.debuglink && !has_ts_debugger)
      this.debuglink.close();
    else if (!this.debuglink && has_ts_debugger && this.connected) {
      const link = this.connect<DebugIPCLinkType>("ts:debugmgr_internal", { global: true });
      this.debuglink = link;
      this.debuglink.on("message", (packet) => this.gotDebugMessage(packet));
      this.debuglink.on("close", () => { if (this.debuglink === link) this.debuglink = undefined; });
      this.debuglink.send({ type: DebugResponseType.register, pid: process.pid, workerid: this.workerid, workernr: this.workernr });
      this.debuglink.activate().catch(() => { if (this.debuglink === link) this.debuglink = undefined; });
      this.debuglink.dropReference();
    }
  }

  gotDebugMessage(packet: DebugIPCLinkType["ConnectEndPointPacket"]) {
    try {
      return this.processDebugMessage(packet);
    } catch (e) {
      //This shouldn't be fatal to the process, catch and ignore (ie process may not have restarted yet)
      console.error("Error processing debug message", e);
      this.debuglink?.close();
    }
  }

  processDebugMessage(packet: DebugIPCLinkType["ConnectEndPointPacket"]) {
    const message: typeof packet.message = packet.message;
    switch (message.type) {
      case DebugRequestType.enableInspector: {
        let url = inspector.url();
        if (!url) {
          inspector.open(message.port);
          url = inspector.url();
        }
        this.debuglink?.send({
          type: DebugResponseType.enableInspectorResult,
          url: url ?? ""
        }, packet.msgid);
      } break;
      case DebugRequestType.getRecentlyLoggedItems: {
        this.debuglink?.send({
          type: DebugResponseType.getRecentlyLoggedItemsResult,
          items: consoledata
        }, packet.msgid);
      } break;
      case DebugRequestType.getHMRState: {
        this.debuglink?.send({
          type: DebugResponseType.getHMRStateResult,
          ...getHMRState()
        }, packet.msgid);
      } break;
      case DebugRequestType.getCodeContexts: {
        const codecontexts = getActiveCodeContexts();
        this.debuglink?.send({
          type: DebugResponseType.getCodeContextsResult,
          codecontexts: codecontexts.map(c => ({ trace: c.trace, ...pick(c.codecontext, ["id", "title", "metadata"]) }))
        }, packet.msgid);
      } break;
      case DebugRequestType.getWorkers: {
        this.debuglink?.send({
          type: DebugResponseType.getWorkersResult,
          workers: Array.from(mainbridge?.localbridges.values() ?? []).map(_ => pick(_, ['workerid', 'workernr']))
        }, packet.msgid);
      } break;
      case DebugRequestType.getEnvironment: {
        const envkeys = Object.entries(process.env).filter(([, value]) => typeof value === "string");
        this.debuglink?.send({
          type: DebugResponseType.getEnvironmentResult,
          env: Object.fromEntries(envkeys) as Record<string, string>
        }, packet.msgid);
      } break;
      default:
        checkAllMessageTypesHandled(message, "type");
    }
  }
}

type PortRegistration = {
  name: string;
  port: TypedMessagePort<IPCPortControlMessage, never>;
  globalregconnectcounter: number;
  initialregistration: boolean;
};

const consoledata: ConsoleLogItem[] = [];

type LocalBridgeData = {
  workerid: string;
  workernr: number;
  port: TypedMessagePort<ToLocalBridgeMessage, ToMainBridgeMessage>;
  localBridge: null;
} | {
  workerid: string;
  workernr: number;
  port: null;
  localBridge: LocalBridge;
};

function getLocalBridgeName(data: LocalBridgeData) {
  return `local bridge #${data.workernr} (${data.workerid})`;
}

class MainBridge extends EventSource<BridgeEvents> {
  conn: WHManagerConnection;
  connectionactive = false;
  connectcounter = 0;
  localbridges = new Map<string, LocalBridgeData>;
  _ready = Promise.withResolvers<void>();
  _conntimeout?: NodeJS.Timeout;

  ports = new Map<string, PortRegistration>;

  portregistermsgid = BigInt(0);
  portregisterrequests = new Map<bigint, PortRegistration>;

  linkidcounter = 0;
  links = new Map<number, { name: string; port: TypedMessagePort<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>; partialmessages: Map<bigint, Buffer[]> }>;

  requestcounter = 34000; // start here to aid debugging
  flushlogrequests = new Map<number, { localBridge: LocalBridgeData; requestid: number }>;
  getprocesslistrequests = new Map<number, { localBridge: LocalBridgeData; requestid: number }>;
  getportlistrequests = new Map<number, { localBridge: LocalBridgeData; requestid: number }>;
  configurelogrequests = new Map<number, { localBridge: LocalBridgeData; requestid: number }>;

  systemconfig: Record<string, unknown>;

  bridgename = "main bridge";
  have_ts_debugger = false;

  /// Set when waiting for data to flush
  waitunref?: PromiseWithResolvers<void>;


  constructor() {
    super();
    this.systemconfig = {};
    this.conn = new WHManagerConnection;
    this.conn.on("online", () => this.register());
    this.conn.on("offline", () => this.gotConnectionClose());
    this.conn.on("ref", () => this.gotRef());
    this.conn.on("unref", () => this.gotUnref());
    this.conn.on("data", (response) => this.gotWHManagerResponse(response));
    this._conntimeout = setTimeout(() => this.gotConnTimeout(), whmanager_connection_timeout).unref();
  }

  register() {
    this.sendData({
      opcode: WHMRequestOpcode.RegisterProcess,
      pid: process.pid,
      type: WHMProcessType.TypeScript,
      name: getScriptName(),
      parameters: {
        interpreter: process.argv[0] || '',
        script: process.argv[1] || ''
      }
    });

    // retry registrations for all global ports
    for (const [, reg] of this.ports) {
      if (reg.globalregconnectcounter || reg.initialregistration) {
        const msgid = ++this.portregistermsgid;
        this.sendData({
          opcode: WHMRequestOpcode.RegisterPort,
          portname: reg.name,
          linkid: 0,
          msgid
        });
        this.portregisterrequests.set(msgid, reg);
      }
    }
  }

  postLocalBridgeMessage(localBridgeData: LocalBridgeData, message: ToLocalBridgeMessage, transferList?: ReadonlyArray<TransferListItem | AnyTypedMessagePort>): void {
    if (localBridgeData.port)
      localBridgeData.port.postMessage(message, transferList);
    else
      localBridgeData.localBridge.handleControlMessage(message);
  }

  gotConnectionClose() {
    // connection closed
    this.connectionactive = false;
    this._ready = Promise.withResolvers<void>();
    this._conntimeout = setTimeout(() => this.gotConnTimeout(), whmanager_connection_timeout).unref();
    for (const [, { port }] of this.links) {
      port.close();
    }
    this.links.clear();
    for (const bridge of this.localbridges) {
      this.postLocalBridgeMessage(bridge[1], { type: ToLocalBridgeMessageType.SystemConfig, systemconfig: this.systemconfig, connected: false, have_ts_debugger: this.have_ts_debugger });
    }
  }

  gotRef() {
    this.waitunref = Promise.withResolvers();
  }

  gotUnref() {
    if (this.waitunref)
      this.waitunref.resolve();
    this.waitunref = undefined;
  }

  gotConnTimeout() {
    this._conntimeout = undefined;
    this._ready.resolve();
  }

  async waitReadyReturnRef() {
    const ref = this.conn.getRef();
    await this._ready.promise;
    return ref;
  }

  async ready(): Promise<void> {
    const ref = await this.waitReadyReturnRef();
    ref.release();
  }

  sendData(data: WHMRequest) {
    if (envbackend.debugFlags.ipcpackets)
      console.error(`${this.bridgename} send to whmanager`, { ...data, opcode: WHMRequestOpcode[data.opcode] });
    this.conn.send(data);
  }

  gotWHManagerResponse(data: WHMResponse) {
    if (envbackend.debugFlags.ipcpackets)
      console.error(`${this.bridgename} data from whmanager`, { ...data, opcode: WHMResponseOpcode[data.opcode] });

    switch (data.opcode) {
      case WHMResponseOpcode.IncomingEvent: {
        for (const localbridge of this.localbridges)
          this.postLocalBridgeMessage(localbridge[1], {
            type: ToLocalBridgeMessageType.Event,
            name: data.eventname,
            data: bufferToArrayBuffer(data.eventdata)
          });
      } break;
      case WHMResponseOpcode.RegisterProcessResult: {
        // fully connected
        this.connectionactive = true;
        ++this.connectcounter;
        this._ready.resolve();
        if (this._conntimeout) {
          clearTimeout(this._conntimeout);
          this._conntimeout = undefined;
        }

        const decoded = data.systemconfigdata.length
          ? hsmarshalling.readMarshalData(data.systemconfigdata)
          : {};

        if (typeof decoded === "object" && decoded) {
          this.systemconfig = decoded as Record<string, unknown>;
        }
        this.have_ts_debugger = data.have_ts_debugger;
        for (const bridge of this.localbridges) {
          this.postLocalBridgeMessage(bridge[1], { type: ToLocalBridgeMessageType.SystemConfig, connected: true, systemconfig: this.systemconfig, have_ts_debugger: this.have_ts_debugger });
        }
      } break;
      case WHMResponseOpcode.SystemConfig: {
        const decoded = data.systemconfigdata.length
          ? hsmarshalling.readMarshalData(data.systemconfigdata)
          : {};

        this.have_ts_debugger = data.have_ts_debugger;
        this.systemconfig = decoded as (Record<string, unknown> | null) ?? {};
        for (const bridge of this.localbridges) {
          this.postLocalBridgeMessage(bridge[1], { type: ToLocalBridgeMessageType.SystemConfig, connected: true, systemconfig: this.systemconfig, have_ts_debugger: this.have_ts_debugger });
        }
      } break;
      case WHMResponseOpcode.RegisterPortResult: {
        const reg = this.portregisterrequests.get(data.replyto);
        if (reg) {
          this.portregisterrequests.delete(data.replyto);
          if (data.success)
            reg.globalregconnectcounter = this.connectcounter;
          if (reg.initialregistration) {
            reg.initialregistration = false;
            reg.port.postMessage({
              type: IPCPortControlMessageType.RegisterResult,
              success: data.success
            });
            if (!data.success) {
              this.ports.delete(reg.name);
              reg.port.close();
              return;
            }
          }
        } else {
          // no evidence of local registration, remove it again
          this.sendData({ opcode: WHMRequestOpcode.UnregisterPort, portname: data.portname, linkid: 0, msgid: BigInt(0), need_unregister_response: false });
        }
      } break;
      case WHMResponseOpcode.OpenLink: {
        const reg = this.ports.get(data.portname);
        if (!reg) {
          this.sendData({ opcode: WHMRequestOpcode.OpenLinkResult, linkid: data.linkid, replyto: data.msgid, success: false });
        } else {
          const { port1, port2 } = createTypedMessageChannel<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>("OpenLink " + data.portname);
          reg.port.postMessage({
            type: IPCPortControlMessageType.IncomingLink,
            id: `remote ${data.linkid} (${data.portname})`,
            port: port2
          }, [port2]);
          this.initLinkHandling(data.portname, data.linkid, data.msgid, port1);
        }
      } break;
      case WHMResponseOpcode.LinkClosed: {
        const reg = this.links.get(data.linkid);
        if (reg) {
          reg.port.close();
          this.links.delete(data.linkid);
        }
      } break;
      case WHMResponseOpcode.ConnectLinkResult: {
        const reg = this.links.get(data.linkid);
        if (reg) {
          const msg: IPCEndPointImplControlMessage = {
            type: IPCEndPointImplControlMessageType.ConnectResult,
            success: data.success
          };
          reg.port.postMessage(msg);
          if (!data.success) {
            this.links.delete(data.linkid);
          }
        }
      } break;
      case WHMResponseOpcode.IncomingMessage: {
        const reg = this.links.get(data.linkid);
        if (reg) {
          const partial = reg.partialmessages.get(data.msgid);
          if (!data.islastpart) {
            if (!partial) {
              reg.partialmessages.set(data.msgid, [data.messagedata]);
            } else
              partial.push(data.messagedata);
          } else {
            const buffer = bufferToArrayBuffer(partial
              ? Buffer.concat([...partial, data.messagedata])
              : data.messagedata);
            if (partial)
              reg.partialmessages.delete(data.msgid);
            const msg: IPCEndPointImplControlMessage = {
              type: IPCEndPointImplControlMessageType.Message,
              msgid: data.msgid,
              replyto: data.replyto,
              buffer
            };
            reg.port.postMessage(msg, [buffer]);
          }
        }
      } break;
      case WHMResponseOpcode.FlushLogResult: {
        const reg = this.flushlogrequests.get(data.requestid);
        if (reg) {
          this.flushlogrequests.delete(data.requestid);
          this.postLocalBridgeMessage(reg.localBridge, {
            type: ToLocalBridgeMessageType.FlushLogResult,
            requestid: reg.requestid,
            success: data.result
          });
        }
      } break;
      case WHMResponseOpcode.GetProcessListResult: {
        const reg = this.getprocesslistrequests.get(data.requestid);
        if (reg) {
          this.getprocesslistrequests.delete(data.requestid);
          this.postLocalBridgeMessage(reg.localBridge, {
            type: ToLocalBridgeMessageType.GetProcessListResult,
            requestid: reg.requestid,
            processes: data.processes
          });
        }
      } break;
      case WHMResponseOpcode.GetPortListResult: {
        const reg = this.getportlistrequests.get(data.requestid);
        if (reg) {
          this.getportlistrequests.delete(data.requestid);
          this.postLocalBridgeMessage(reg.localBridge, {
            type: ToLocalBridgeMessageType.GetPortListResult,
            requestid: reg.requestid,
            ports: data.ports
          });
        }
      } break;
      case WHMResponseOpcode.ConfigureLogsResult: {
        const reg = this.configurelogrequests.get(data.requestid);
        if (reg) {
          this.configurelogrequests.delete(data.requestid);
          this.postLocalBridgeMessage(reg.localBridge, {
            type: ToLocalBridgeMessageType.ConfigureLogsResult,
            requestid: reg.requestid,
            results: data.results
          });
        }
      } break;
      case WHMResponseOpcode.AnswerException:
      case WHMResponseOpcode.UnregisterPortResult: {
        // all ignored
      } break;
      default:
        checkAllMessageTypesHandled(data, "opcode");
    }
  }

  getBridgeForWorker(worker: string): LocalBridgeData | null {
    const byid = this.localbridges.get(worker);
    if (byid)
      return byid;

    //then look up by nr:
    return [...this.localbridges.values()].find(bridge => bridge.workernr === Number(worker)) || null;
  }

  async gotDirectMessage(id: string, message: ToMainBridgeMessage) {
    const localBridgeData = this.localbridges.get(id);
    if (localBridgeData)
      await this.gotLocalBridgeMessage(localBridgeData, message);
  }

  async gotLocalBridgeMessage(localBridge: LocalBridgeData, message: ToMainBridgeMessage) {
    if (envbackend.debugFlags.ipc)
      console.log(`${this.bridgename}: message from ${getLocalBridgeName(localBridge)}`, { ...message, type: ToMainBridgeMessageType[message.type] });
    switch (message.type) {
      case ToMainBridgeMessageType.SendEvent: {
        const ref = await this.waitReadyReturnRef();
        try {
          if (this.connectionactive && !message.local) {
            this.sendData({
              opcode: WHMRequestOpcode.SendEvent,
              eventname: message.name,
              eventdata: message.data
            });
          }
          /* The bridge doesn't reflect events back to us, so we need to do this ourselves. This also allowed HareScript to
             synchronously process local events (eg ensuring list eventmasks updated the list immediately) */
          for (const bridge of this.localbridges)
            this.postLocalBridgeMessage(bridge[1], { type: ToLocalBridgeMessageType.Event, name: message.name, data: message.data });
        } finally {
          ref.release();
        }
      } break;
      case ToMainBridgeMessageType.RegisterPort: {
        if (this.ports.get(message.name)) {
          message.port.postMessage({
            type: IPCPortControlMessageType.RegisterResult,
            success: false
          });
          message.port.close();
          return;
        }
        const reg: PortRegistration = {
          name: message.name,
          port: message.port,
          globalregconnectcounter: 0,
          initialregistration: message.global
        };
        this.ports.set(message.name, reg);
        if (message.global) {
          const ref = await this.waitReadyReturnRef();
          try {
            await this.ready();
            if (!this.connectionactive) {
              message.port.postMessage({
                type: IPCPortControlMessageType.RegisterResult,
                success: false
              });
              message.port.close();
              this.ports.delete(message.name);
              return;
            }
            const msgid = ++this.portregistermsgid;
            this.sendData({
              opcode: WHMRequestOpcode.RegisterPort,
              portname: message.name,
              linkid: 0,
              msgid
            });
            this.portregisterrequests.set(msgid, reg);
          } finally {
            ref.release();
          }
        } else {
          message.port.postMessage({
            type: IPCPortControlMessageType.RegisterResult,
            success: true
          });
        }
        message.port.on("close", () => {
          if (envbackend.debugFlags.ipc)
            console.log(`main bridge: ${message.global ? "global" : "local"}  port ${message.name} closed`);
          if (this.ports.get(message.name) === reg)
            this.ports.delete(message.name);
          if (message.global) {
            this.sendData({
              opcode: WHMRequestOpcode.UnregisterPort,
              portname: message.name,
              linkid: 0,
              msgid: BigInt(0),
              need_unregister_response: false
            });
          }
        });
      } break;
      case ToMainBridgeMessageType.ConnectLink: {
        const reg = this.ports.get(message.name);
        if (reg) {
          reg.port.postMessage({
            type: IPCPortControlMessageType.IncomingLink,
            id: message.id,
            port: message.port
          }, [message.port]);
          return;
        }
        if (message.global) {
          const ref = await this.waitReadyReturnRef();
          try {
            if (this.connectionactive) {
              const linkid = this.allocateLinkid();
              this.sendData({
                opcode: WHMRequestOpcode.ConnectLink,
                portname: message.name,
                linkid,
                msgid: BigInt(0)
              });
              this.initLinkHandling(message.name, linkid, BigInt(0), message.port);
              return;
            }
          } finally {
            ref.release();
          }
        }
        message.port.postMessage({
          type: IPCEndPointImplControlMessageType.ConnectResult,
          success: false,
        });
        message.port.close();
      } break;
      case ToMainBridgeMessageType.Log: {
        // this keeps the bridge alive until the current connection attempt has finished
        const ref = await this.waitReadyReturnRef();
        try {
          if (this.connectionactive) {
            this.sendData({
              opcode: WHMRequestOpcode.Log,
              logname: message.logname,
              logline: message.logline
            });
          }
        } finally {
          ref.release();
        }
      } break;
      case ToMainBridgeMessageType.FlushLog: {
        // this keeps the bridge alive until the current connection attempt has finished
        const ref = await this.waitReadyReturnRef();
        try {
          if (this.connectionactive) {
            const requestid = this.allocateRequestId();
            this.flushlogrequests.set(requestid, { localBridge, requestid: message.requestid });
            this.sendData({
              opcode: WHMRequestOpcode.FlushLog,
              logname: message.logname,
              requestid
            });
          } else {
            this.postLocalBridgeMessage(localBridge, {
              type: ToLocalBridgeMessageType.FlushLogResult,
              requestid: message.requestid,
              success: false
            });
          }
        } finally {
          ref.release();
        }
      } break;
      case ToMainBridgeMessageType.EnsureDataSent: {
        await this.waitunref?.promise;
        this.postLocalBridgeMessage(localBridge, {
          type: ToLocalBridgeMessageType.EnsureDataSentResult,
          requestid: message.requestid,
        });
      } break;
      case ToMainBridgeMessageType.GetProcessList: {
        const ref = await this.waitReadyReturnRef();
        try {
          if (this.connectionactive) {
            const requestid = this.allocateRequestId();
            this.getprocesslistrequests.set(requestid, { localBridge, requestid: message.requestid });
            this.sendData({
              opcode: WHMRequestOpcode.GetProcessList,
              requestid
            });
          } else {
            this.postLocalBridgeMessage(localBridge, {
              type: ToLocalBridgeMessageType.GetProcessListResult,
              requestid: message.requestid,
              processes: []
            });
          }
        } finally {
          ref.release();
        }
      } break;
      case ToMainBridgeMessageType.GetPortList: {
        const ref = await this.waitReadyReturnRef();
        try {
          if (this.connectionactive) {
            const requestid = this.allocateRequestId();
            this.getportlistrequests.set(requestid, { localBridge, requestid: message.requestid });
            this.sendData({
              opcode: WHMRequestOpcode.GetPortList,
              requestid
            });
          } else {
            this.postLocalBridgeMessage(localBridge, {
              type: ToLocalBridgeMessageType.GetPortListResult,
              requestid: message.requestid,
              ports: []
            });
          }
        } finally {
          ref.release();
        }
      } break;
      case ToMainBridgeMessageType.RegisterLocalBridge: {
        this.registerLocalBridge({ workerid: message.workerid, workernr: message.workernr, port: message.port, localBridge: null });
      } break;
      case ToMainBridgeMessageType.ConfigureLogs: {
        const ref = await this.waitReadyReturnRef();
        try {
          if (this.connectionactive) {
            const requestid = this.allocateRequestId();
            this.configurelogrequests.set(requestid, { localBridge, requestid: message.requestid });
            this.sendData({
              opcode: WHMRequestOpcode.ConfigureLogs,
              requestid,
              config: message.config
            });
          } else {
            this.postLocalBridgeMessage(localBridge, {
              type: ToLocalBridgeMessageType.GetProcessListResult,
              requestid: message.requestid,
              processes: []
            });
          }
        } finally {
          ref.release();
        }
      } break;
      case ToMainBridgeMessageType.ConnectToLocalService: {
        // need to do place the local services instantiator in a delay-loaded import because of circular import problems
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- TODO - our require plugin doesn't support await import yet
        const caller = require(module.path + "/localservices.ts");
        const error = await caller.openLocalServiceForBridge(message.factory, message.port);
        this.postLocalBridgeMessage(localBridge, {
          type: ToLocalBridgeMessageType.ConnectToLocalServiceResult,
          requestid: message.requestid,
          error,
        });
      } break;
      default:
        checkAllMessageTypesHandled(message, "type");
    }
  }

  private registerLocalBridge(data: LocalBridgeData) {
    if (data.port) {
      data.port.on("message", (msg) => void this.gotLocalBridgeMessage(data, msg));
      data.port.on("close", () => this.gotLocalBridgeClose(data));
      // Do not want this port to keep the event loop running.
      data.port.unref();
    }
    this.localbridges.set(data.workerid, data);
    this.postLocalBridgeMessage(data, { type: ToLocalBridgeMessageType.SystemConfig, connected: this.connectionactive, systemconfig: this.systemconfig, have_ts_debugger: this.have_ts_debugger });
  }

  allocateLinkid() {
    /// Keep local link ids below 2^31, and skip link 0. Ignoring the possiblity 2^31 links are open.
    for (; ;) {
      this.linkidcounter = (this.linkidcounter % 2147483647) + 1;
      if (!this.links.get(this.linkidcounter))
        return this.linkidcounter;
    }
  }

  allocateRequestId(): number {
    /// Get next uint32_t for this.requestcounter ('>>> 0' has same effect as % 2**32)
    this.requestcounter = (this.requestcounter + 1) >>> 0;
    return this.requestcounter;
  }

  initLinkHandling(portname: string, linkid: number, msgid: bigint, port: TypedMessagePort<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>) {
    this.links.set(linkid, { name: portname, port: port, partialmessages: new Map });
    port.on("message", (ctrlmsg: IPCEndPointImplControlMessage) => {
      if (envbackend.debugFlags.ipc)
        console.log(`main bridge: incoming message from local endpoint of ${linkid} (${portname})`, { ...ctrlmsg, type: IPCEndPointImplControlMessageType[ctrlmsg.type] });
      switch (ctrlmsg.type) {
        case IPCEndPointImplControlMessageType.ConnectResult: {
          this.sendData({ opcode: WHMRequestOpcode.OpenLinkResult, linkid, replyto: msgid, success: ctrlmsg.success });
          if (!ctrlmsg.success) {
            this.links.delete(linkid);
            port.close();
          }
        } break;
        case IPCEndPointImplControlMessageType.Message: {
          const fragmentsize = 511 * 1024;
          for (let fragmentpos = 0; fragmentpos < ctrlmsg.buffer.byteLength; fragmentpos += fragmentsize) {
            const part = new Uint8Array(ctrlmsg.buffer, fragmentpos, Math.min(fragmentsize, ctrlmsg.buffer.byteLength - fragmentpos));
            this.sendData({
              opcode: WHMRequestOpcode.SendMessageOverLink,
              linkid: linkid,
              msgid: ctrlmsg.msgid,
              replyto: ctrlmsg.replyto,
              islastpart: fragmentpos + fragmentsize >= ctrlmsg.buffer.byteLength,
              messagedata: part
            });
          }
        } break;
      }
    });
    port.on("close", () => {
      port.close();
      if (this.links.get(linkid)) {
        this.sendData({ opcode: WHMRequestOpcode.DisconnectLink, linkid });
        this.links.delete(linkid);
      }
    });
    // Link will be kept alive by client
    port.unref();
  }

  gotLocalBridgeClose(data: LocalBridgeData) {
    if (envbackend.debugFlags.ipc)
      console.log(`${this.bridgename}: ${getLocalBridgeName(data)} closed`);
    this.localbridges.delete(data.workerid);
  }

  getTopLocalBridgeInitData(localBridge: LocalBridge): LocalBridgeInitData {
    const id = generateRandomId();
    this.registerLocalBridge({ workerid: id, workernr: 0, port: null, localBridge });
    return { workerid: id, workernr: 0, port: null, consoleLogData };
  }
}

function handleGlobalEvent(data: { name: string }) {
  switch (data.name) {
    case "system:configupdate": {
      reloadBackendConfig();
    } break;
  }
}

const old_console_funcs = { ...console };
const old_std_writes = {
  stdout: process.stdout.write,
  stderr: process.stderr.write
};

/** Buffer for console logging administration (0: log counter, 1: whether workers have been used)
 * Worker console log messages are written to the main console log via the event loop, so they
 * can be issued out-of-order. Using atomics to get a global ordering.
*/
const consoleLogData = !isMainThread && workerData && "localHandlerInitData" in workerData
  ? workerData.localHandlerInitData.consoleLogData
  : new Uint32Array(new SharedArrayBuffer(8));

// eslint-disable-next-line prefer-const -- eslint doesn't see that console log can be called before bridgeimpl has been set
let bridgeimpl: LocalBridge | undefined;

type ConsoleLogItemSource = Omit<ConsoleLogItem, 'data'> & { loggedlocation: boolean };

const consoleCallbacks = new Set<(data: string, { isError }: { isError: boolean }) => void>();

function hookConsoleLog() {
  const source: ConsoleLogItemSource = {
    method: "",
    when: new Date(),
    loggedlocation: false
  };

  for (const [key, func] of Object.entries(old_console_funcs)) {
    if (key !== "Console" && key !== "trace") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (console as any)[key] = (...args: unknown[]) => {
        if (source.method) { //we already captured log location info, don't overwrite it
          return (func as (...args: unknown[]) => unknown).apply(console, args);
        } else {
          source.method = key;
          source.when = new Date();
          if (envbackend.debugFlags.conloc) {
            source.loggedlocation = false;
            source.location = getCallerLocation(1); // 1 is location of parent
            source.codeContextId = getCodeContext().id;
          }
          try {
            return (func as (...args: unknown[]) => unknown).apply(console, args);
          } finally {
            source.method = ""; //reset captured state
            source.location = undefined;
          }
        }
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function interceptConsoleLog(data: string | Uint8Array, encoding: any, cb: ((err?: Error) => void) | undefined, oldcall: Socket["write"], oldstream: NodeJS.WriteStream) {
    if (envbackend.debugFlags.conloc && source.location && !source.loggedlocation) {
      const workerid = consoleLogData[1] ? ` (${Atomics.add(consoleLogData, 0, 1) + 1}:${bridgeimpl?.workerid})` : ``;
      oldcall.call(oldstream, `${(new Date).toISOString()}${workerid} ${source.location.filename.split("/").at(-1)}:${source.location.line}#${source.codeContextId || "root"}:${source.method === "table" ? "\n" : " "}`, "utf-8");
      source.loggedlocation = true;
    }
    const retval = oldcall.call(oldstream, data, encoding, cb);
    const tolog: string = typeof data === "string" ? data : Buffer.from(data).toString("utf-8");
    const consoleLogItem = { method: source.method, data: tolog, when: source.when, ...(source.location ? { location: source.location } : null) };
    consoledata.push(consoleLogItem);
    if (consoledata.length > 100)
      consoledata.shift();
    if (envbackend.debugFlags.etr) {
      getCodeContext().consoleLog.push(consoleLogItem);
      if (getCodeContext().consoleLog.length > 100)
        getCodeContext().consoleLog.shift();
    }
    for (const consoleCallback of consoleCallbacks) {
      consoleCallback(tolog, { isError: oldstream === process.stderr });
    }
    return retval;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stdout.write = (data: string | Uint8Array, encoding?: any, cb?: (err?: Error) => void): any => {
    return interceptConsoleLog(data, encoding, cb, old_std_writes.stdout, process.stdout);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stderr.write = (data: string | Uint8Array, encoding?: any, cb?: (err?: Error) => void): any => {
    return interceptConsoleLog(data, encoding, cb, old_std_writes.stderr, process.stderr);
  };
}

// Hook the console log before initializing the main bridge or the local bridge (so console.log works there too)
hookConsoleLog();

bridgeimpl = new LocalBridge();

const bridge: Bridge = bridgeimpl;
export default bridge;

/** Called when a worker has been added, triggers printing of counter and bridge id when flag "conloc" has been enabled */
export function initializedWorker() {
  consoleLogData[1] = 1;
}

registerAsNonReloadableLibrary(module);

const process_exit_backup = process.exit; // compatibility with taskrunner.ts taking over process.exit (TODO properly manage process.exit in contexts without breaking bridge)

process.on('uncaughtExceptionMonitor', (error, origin) => {
  console.error(origin === "unhandledRejection" ? "Uncaught rejection" : "Uncaught exception", error);
  bridge.logError(error, { errortype: origin === "unhandledRejection" ? origin : "exception" });
});

async function callProcessExit() {
  await bridge.ensureDataSent();
  process_exit_backup.call(process, 1);
}

export function addConsoleCallback(callback: (data: string, { isError }: { isError: boolean }) => void) {
  consoleCallbacks.add(callback);
  return {
    [Symbol.dispose]() {
      consoleCallbacks.delete(callback);
    }
  };
}

process.on('uncaughtException', (error) => void callProcessExit());

process.on('unhandleRejection', (reason, promise) => void callProcessExit());
