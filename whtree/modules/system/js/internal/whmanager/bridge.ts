import EventSource from "../eventsource";
import { WHManagerConnection, WHMResponse } from "./whmanager_conn";
import { WHMRequest, WHMRequestOpcode, WHMResponseOpcode, WHMProcessType, WHMResponse_IncomingEvent, LogFileConfiguration } from "./whmanager_rpcdefs";
import * as hsmarshalling from "./hsmarshalling";
import { registerAsNonReloadableLibrary, getState as getHMRState } from "../hmrinternal";
import { createDeferred, DeferredPromise, pick } from "@webhare/std";
import { DebugConfig, updateDebugConfig } from "@webhare/env/src/envbackend";
import { IPCPortControlMessage, IPCEndPointImplControlMessage, IPCEndPointImpl, IPCPortImpl, IPCPortControlMessageType, IPCEndPointImplControlMessageType, IPCLinkType } from "./ipc";
import { TypedMessagePort, createTypedMessageChannel, bufferToArrayBuffer, AnyTypedMessagePort } from './transport';
import { RefTracker } from "./refs";
import { generateRandomId } from "@webhare/std";
import * as stacktrace_parser from "stacktrace-parser";
import { ProcessList, DebugIPCLinkType, DebugRequestType, DebugResponseType, ConsoleLogItem } from "./debug";
import * as inspector from "node:inspector";
import * as envbackend from "@webhare/env/src/envbackend";
import { getCallerLocation } from "../util/stacktrace";
import { updateConfig } from "../configuration";
import { getActiveCodeContexts } from "@webhare/services/src/codecontexts";
import { isMainThread, TransferListItem, workerData } from "node:worker_threads";
import { formatLogObject, LoggableRecord } from "@webhare/services/src/logmessages";

export { IPCMessagePacket, IPCLinkType } from "./ipc";
export { SimpleMarshallableData, SimpleMarshallableRecord, IPCMarshallableData, IPCMarshallableRecord } from "./hsmarshalling";
export { dumpActiveIPCMessagePorts } from "./transport";

const logmessages = envbackend.debugFlags.ipc;
const logpackets = envbackend.debugFlags.ipcpackets;

/** Number of milliseconds before connection to whmanager times out. At startup, just the connect alone can
    take multiple seconds, so using a very high number here.
*/
const whmanager_connection_timeout = 15000;

export type BridgeEventData = hsmarshalling.SimpleMarshallableRecord;
export type BridgeMessageData = hsmarshalling.IPCMarshallableRecord;
export type BridgeEvent = {
  name: string;
  data: BridgeEventData;
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
      @param logline - Line to log
  */
  log(logname: string, logline: LoggableRecord): void;

  /** Write a line to the debug log file
  */
  logDebug(logsource: string, logline: LoggableRecord): void;

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

  /** Return bridge initialization data for the local bridge in a worker */
  getLocalHandlerInitDataForWorker(): LocalBridgeInitData;

  /** Reconfigure log files */
  configureLogs(logfiles: LogFileConfiguration[]): Promise<boolean[]>;
}

enum ToLocalBridgeMessageType {
  SystemConfig,
  Event,
  FlushLogResult,
  EnsureDataSentResult,
  GetProcessListResult,
  ConfigureLogsResult
}

type ToLocalBridgeMessage = {
  type: ToLocalBridgeMessageType.SystemConfig;
  connected: boolean;
  systemconfig: Record<string, unknown>;
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
  type: ToLocalBridgeMessageType.ConfigureLogsResult;
  requestid: number;
  results: boolean[];
};

enum ToMainBridgeMessageType {
  SendEvent,
  RegisterPort,
  ConnectLink,
  Log,
  FlushLog,
  EnsureDataSent,
  GetProcessList,
  RegisterLocalBridge,
  ConfigureLogs
}

type ToMainBridgeMessage = {
  type: ToMainBridgeMessageType.SendEvent;
  name: string;
  data: ArrayBuffer;
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
  type: ToMainBridgeMessageType.RegisterLocalBridge;
  id: string;
  port: TypedMessagePort<ToLocalBridgeMessage, ToMainBridgeMessage>;
} | {
  type: ToMainBridgeMessageType.ConfigureLogs;
  requestid: number;
  config: LogFileConfiguration[];
};

type LocalBridgeInitData = {
  id: string;
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
  id: string;
  port: TypedMessagePort<ToMainBridgeMessage, ToLocalBridgeMessage> | null;
  requestcounter = 11000;
  systemconfig: Record<string, unknown>;
  _ready: DeferredPromise<void>;
  connected = false;
  reftracker: RefTracker;
  /// interval timer for local bridge in main thread to use while waiting for init
  readyTimer: NodeJS.Timer | undefined;

  pendingensuredatasent = new Map<number, () => void>();
  pendingflushlogs = new Map<number, { resolve: () => void; reject: (_: Error) => void }>;
  pendingreconfigurelogs = new Map<number, (results: boolean[]) => void>();
  pendinggetprocesslists = new Map<number, (processlist: ProcessList) => void>();

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
    this.id = initdata.id;
    this.port = initdata.port;
    this.systemconfig = {};
    this._ready = createDeferred<void>();
    if (this.port) {
      this.port.on("message", (message) => this.handleControlMessage(message));
      this.port.unref();
      this.reftracker = new RefTracker(this.port, { initialref: false });
    } else {
      this.readyTimer = setInterval(() => false, 60000 * 1000);
      this.readyTimer.unref();
      this.reftracker = new RefTracker(this.readyTimer, { initialref: false });
    }
  }

  get ready() {
    const lock = this.reftracker.getLock("local bridge: waiting for ready");
    return this._ready.promise.then(() => lock.release());
  }

  getGroupId() {
    return this.id;
  }

  handleControlMessage(message: ToLocalBridgeMessage) {
    if (logmessages)
      console.log(`localbridge ${this.id}: message from mainbridge`, { ...message, type: ToLocalBridgeMessageType[message.type] });
    switch (message.type) {
      case ToLocalBridgeMessageType.SystemConfig: {
        this.systemconfig = message.systemconfig;
        if (message.connected !== this.connected) {
          this.connected = message.connected;
          if (this.connected)
            this._ready.resolve();
          else
            this._ready = createDeferred<void>();
        }
        this.emit("systemconfig", this.systemconfig);
      } break;
      case ToLocalBridgeMessageType.Event: {
        this.emit("event", {
          name: message.name,
          data: hsmarshalling.readMarshalData(message.data) as hsmarshalling.SimpleMarshallableRecord
        });
      } break;
      case ToLocalBridgeMessageType.FlushLogResult: {
        const reg = this.pendingflushlogs.get(message.requestid);
        if (logmessages)
          console.log(`localbridge ${this.id}: pending flush logs`, this.pendingflushlogs, reg);
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
        if (logmessages)
          console.log(`localbridge ${this.id}: ensuredatasent result`, message.requestid, Boolean(reg));
        if (reg) {
          this.pendingensuredatasent.delete(message.requestid);
          reg();
        }
      } break;
      case ToLocalBridgeMessageType.GetProcessListResult: {
        const reg = this.pendinggetprocesslists.get(message.requestid);
        if (logmessages)
          console.log(`localbridge ${this.id}: pendinggetprocesslists result`, message.requestid, Boolean(reg));
        if (reg) {
          this.pendinggetprocesslists.delete(message.requestid);
          reg(message.processes);
        }
      } break;
      case ToLocalBridgeMessageType.ConfigureLogsResult: {
        const reg = this.pendingreconfigurelogs.get(message.requestid);
        if (logmessages)
          console.log(`localbridge ${this.id}: pendingreconfigurelogs result`, message.requestid, Boolean(reg));
        if (reg) {
          this.pendinggetprocesslists.delete(message.requestid);
          reg(message.results);
        }
      } break;
      default:
        checkAllMessageTypesHandled(message, "type");
    }
  }

  postMainBridgeMessage(message: ToMainBridgeMessage, transferList?: ReadonlyArray<TransferListItem | AnyTypedMessagePort> | undefined): void {
    if (mainbridge)
      mainbridge.gotDirectMessage(this.id, message);
    else if (this.port)
      this.port.postMessage(message, transferList);
    else
      throw new Error(`no port, no mainbridge`);
  }

  sendEvent(name: string, data: unknown): void {
    this.postMainBridgeMessage({
      type: ToMainBridgeMessageType.SendEvent,
      name,
      data: bufferToArrayBuffer(hsmarshalling.writeMarshalData(data, { onlySimple: true }))
    });
  }

  log(logname: string, logrecord: LoggableRecord): void {
    const logline = formatLogObject(new Date, logrecord);
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
      script: options.script ?? require.main?.filename ?? "",
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

  getLocalHandlerInitDataForWorker(): LocalBridgeInitData {
    const { port1, port2 } = createTypedMessageChannel<ToLocalBridgeMessage, ToMainBridgeMessage>("getTopLocalBridgeInitData");
    const id = generateRandomId();
    this.postMainBridgeMessage({
      type: ToMainBridgeMessageType.RegisterLocalBridge,
      id,
      port: port1
    }, [port1]);
    port2.unref();
    return { id, port: port2, consoleLogData };
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
}

type PortRegistration = {
  name: string;
  port: TypedMessagePort<IPCPortControlMessage, never>;
  globalregconnectcounter: number;
  initialregistration: boolean;
};

const consoledata: ConsoleLogItem[] = [];

type LocalBridgeData = {
  id: string;
  port: TypedMessagePort<ToLocalBridgeMessage, ToMainBridgeMessage>;
  localBridge: null;
} | {
  id: string;
  port: | null;
  localBridge: LocalBridge;
};

class MainBridge extends EventSource<BridgeEvents> {
  conn: WHManagerConnection;
  connectionactive = false;
  connectcounter = 0;
  localbridges = new Map<string, LocalBridgeData>;
  _ready = createDeferred<void>();
  _conntimeout?: NodeJS.Timeout;

  ports = new Map<string, PortRegistration>;

  portregistermsgid = BigInt(0);
  portregisterrequests = new Map<bigint, PortRegistration>;

  linkidcounter = 0;
  links = new Map<number, { name: string; port: TypedMessagePort<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>; partialmessages: Map<bigint, Buffer[]> }>;

  requestcounter = 34000; // start here to aid debugging
  flushlogrequests = new Map<number, { localBridge: LocalBridgeData; requestid: number }>;
  getprocesslistrequests = new Map<number, { localBridge: LocalBridgeData; requestid: number }>;
  configurelogrequests = new Map<number, { localBridge: LocalBridgeData; requestid: number }>;

  systemconfig: Record<string, unknown>;

  bridgename = "main bridge";
  processcode = 0;

  /// Set when waiting for data to flush
  waitunref?: DeferredPromise<void>;

  debuglink?: DebugIPCLinkType["ConnectEndPoint"];

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
      processcode: 0,
      pid: process.pid,
      type: WHMProcessType.TypeScript,
      name: require.main?.filename ?? "<unknown javascript script>",
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
    this._ready = createDeferred<void>();
    this._conntimeout = setTimeout(() => this.gotConnTimeout(), whmanager_connection_timeout).unref();
    for (const [, { port }] of this.links) {
      port.close();
    }
    this.links.clear();
    for (const bridge of this.localbridges) {
      this.postLocalBridgeMessage(bridge[1], { type: ToLocalBridgeMessageType.SystemConfig, systemconfig: this.systemconfig, connected: false });
    }
  }

  gotRef() {
    this.waitunref = createDeferred();
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
    if (logpackets)
      console.error(`${this.bridgename} send to whmanager`, { ...data, opcode: WHMRequestOpcode[data.opcode] });
    this.conn.send(data);
  }

  gotWHManagerResponse(data: WHMResponse) {
    if (logpackets)
      console.error(`${this.bridgename} data from whmanager`, { ...data, opcode: WHMResponseOpcode[data.opcode] });

    switch (data.opcode) {
      case WHMResponseOpcode.IncomingEvent: {
        handleGlobalEvent(data);
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

        this.processcode = data.processcode;
        const decoded = data.systemconfigdata.length
          ? hsmarshalling.readMarshalData(data.systemconfigdata)
          : {};

        if (typeof decoded == "object" && decoded) {
          this.systemconfig = decoded as Record<string, unknown>;
          if (this.systemconfig.debugconfig)
            updateDebugConfig(this.systemconfig.debugconfig as DebugConfig);
        }
        for (const bridge of this.localbridges) {
          this.postLocalBridgeMessage(bridge[1], { type: ToLocalBridgeMessageType.SystemConfig, connected: true, systemconfig: this.systemconfig });
        }
        this.initDebugger(data.have_ts_debugger);
      } break;
      case WHMResponseOpcode.SystemConfig: {
        const decoded = data.systemconfigdata.length
          ? hsmarshalling.readMarshalData(data.systemconfigdata)
          : {};

        this.systemconfig = decoded as (Record<string, unknown> | null) ?? {};
        if (this.systemconfig.debugconfig)
          updateDebugConfig(this.systemconfig.debugconfig as DebugConfig);
        this.initDebugger(data.have_ts_debugger);
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
            processes: data.processes.map(p => ({ ...p, debuggerconnected: false }))
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

  async gotDirectMessage(id: string, message: ToMainBridgeMessage) {
    const localBridgeData = this.localbridges.get(id);
    if (localBridgeData)
      await this.gotLocalBridgeMessage(localBridgeData, message);
  }

  async gotLocalBridgeMessage(localBridge: LocalBridgeData, message: ToMainBridgeMessage) {
    if (logmessages)
      console.log(`${this.bridgename}: message from local bridge ${localBridge.id}`, { ...message, type: ToMainBridgeMessageType[message.type] });
    switch (message.type) {
      case ToMainBridgeMessageType.SendEvent: {
        const ref = await this.waitReadyReturnRef();
        try {
          if (this.connectionactive) {
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
        const ref = await this.waitReadyReturnRef();
        try {
          if (this.ports.get(message.name)) {
            message.port.postMessage({
              type: IPCPortControlMessageType.RegisterResult,
              success: false
            });
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
            await this.ready();
            if (!this.connectionactive) {
              message.port.postMessage({
                type: IPCPortControlMessageType.RegisterResult,
                success: false
              });
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
          } else {
            message.port.postMessage({
              type: IPCPortControlMessageType.RegisterResult,
              success: true
            });
          }
          message.port.on("close", () => {
            if (logmessages)
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
        } finally {
          ref.release();
        }
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
      case ToMainBridgeMessageType.RegisterLocalBridge: {
        this.registerLocalBridge({ id: message.id, port: message.port, localBridge: null });
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
      default:
        checkAllMessageTypesHandled(message, "type");
    }
  }

  private registerLocalBridge(data: LocalBridgeData) {
    if (data.port) {
      data.port.on("message", (msg) => this.gotLocalBridgeMessage(data, msg));
      data.port.on("close", () => this.gotLocalBridgeClose(data));
      // Do not want this port to keep the event loop running.
      data.port.unref();
    }
    this.localbridges.set(data.id, data);
    this.postLocalBridgeMessage(data, { type: ToLocalBridgeMessageType.SystemConfig, connected: this.connectionactive, systemconfig: this.systemconfig });
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
      if (logmessages)
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

  initDebugger(has_ts_debugger: boolean) {
    if (this.debuglink && !has_ts_debugger)
      this.debuglink.close();
    else if (!this.debuglink && has_ts_debugger && this.connectionactive) {
      const { port1, port2 } = createTypedMessageChannel<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>("initDebugger");
      const id = generateRandomId();
      this.debuglink = new IPCEndPointImpl(`${id} - origin (ts:debugmgr_internal)`, port2, "connecting", "global port ts:debugmgr_internal");
      const link = this.debuglink;
      this.debuglink.on("message", (packet) => this.gotDebugMessage(packet));
      this.debuglink.on("close", () => { if (this.debuglink === link) this.debuglink = undefined; });
      this.debuglink.send({ type: DebugResponseType.register, processcode: this.processcode });
      this.debuglink.activate().catch(() => { if (this.debuglink === link) this.debuglink = undefined; });
      this.debuglink.dropReference();

      const linkid = this.allocateLinkid();
      this.sendData({
        opcode: WHMRequestOpcode.ConnectLink,
        portname: "ts:debugmgr_internal",
        linkid,
        msgid: BigInt(0)
      });
      this.initLinkHandling("ts:debugmgr_internal", linkid, BigInt(0), port1);
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
          workers: Array.from(this.localbridges.values()).map(({ id }) => ({ id }))
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

  gotLocalBridgeClose(data: LocalBridgeData) {
    if (logmessages)
      console.log(`${this.bridgename}: local bridge ${data.id} closed`);
    this.localbridges.delete(data.id);
  }

  getTopLocalBridgeInitData(localBridge: LocalBridge): LocalBridgeInitData {
    const id = generateRandomId();
    this.registerLocalBridge({ id, port: null, localBridge });
    return { id, port: null, consoleLogData };
  }
}

function handleGlobalEvent(data: WHMResponse_IncomingEvent) {
  switch (data.eventname) {
    case "system:configupdate": {
      updateConfig();
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

function hookConsoleLog() {
  const source: { func: string; location: { filename: string; line: number; col: number; func: string } | null; when: Date; loggedlocation: boolean } = {
    func: "",
    location: null,
    when: new Date(),
    loggedlocation: false
  };
  for (const [key, func] of Object.entries(old_console_funcs)) {
    if (key != "Console" && key != "trace") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (console as any)[key] = (...args: unknown[]) => {
        if (source.func) {
          return (func as (...args: unknown[]) => unknown).apply(console, args);
        } else {
          source.func = key;
          source.when = new Date();
          source.location = getCallerLocation(1); // 1 is location of parent
          try {
            return (func as (...args: unknown[]) => unknown).apply(console, args);
          } finally {
            source.func = "";
            source.location = null;
          }
        }
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stdout.write = (data: string | Uint8Array, encoding?: any, cb?: (err?: Error) => void): any => {
    if (envbackend.debugFlags.conloc && source.location) {
      const workerid = consoleLogData[1] ? ` (${Atomics.add(consoleLogData, 0, 1) + 1}:${bridgeimpl?.id})` : ``;
      old_std_writes.stdout.call(process.stdout, `${(new Date).toISOString()}${workerid} ${source.location.filename.split("/").at(-1)}:${source.location.line}:${source.func === "table" ? "\n" : " "}`, "utf-8");
      source.location = null;
    }
    const retval = old_std_writes.stdout.call(process.stdout, data, encoding, cb);
    const tolog: string = typeof data == "string" ? data : Buffer.from(data).toString("utf-8");
    consoledata.push({ func: source.func, data: tolog, when: source.when, location: source.location });
    if (consoledata.length > 100)
      consoledata.shift();
    return retval;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stderr.write = (data: string | Uint8Array, encoding?: any, cb?: (err?: Error) => void): any => {
    if (envbackend.debugFlags.conloc && source.location) {
      const workerid = consoleLogData[1] ? ` (${Atomics.add(consoleLogData, 0, 1) + 1}:${bridgeimpl?.id})` : ``;
      old_std_writes.stderr.call(process.stderr, `${(new Date).toISOString()}${workerid} ${source.location.filename.split("/").at(-1)}:${source.location.line}: `, "utf-8");
      source.location = null;
    }
    const retval = old_std_writes.stderr.call(process.stderr, data, encoding, cb);
    const tolog: string = typeof data == "string" ? data : Buffer.from(data).toString("utf-8");
    consoledata.push({ func: source.func, data: tolog, when: source.when, location: source.location });
    if (consoledata.length > 100)
      consoledata.shift();
    return retval;
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
  console.error(origin == "unhandledRejection" ? "Uncaught rejection" : "Uncaught exception", error);
  bridge.logError(error, { errortype: origin == "unhandledRejection" ? origin : "exception" });
});

process.on('uncaughtException', async (error) => {
  await bridge.ensureDataSent();
  process_exit_backup.call(process, 1);
});

process.on('unhandleRejection', async (reason, promise) => {
  await bridge.ensureDataSent();
  process_exit_backup.call(process, 1);
});
