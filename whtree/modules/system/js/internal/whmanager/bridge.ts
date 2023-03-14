import EventSource from "../eventsource";
import { WHManagerConnection, WHMResponse } from "./whmanager_conn";
import { WHMRequest, WHMRequestOpcode, WHMResponseOpcode, WHMProcessType } from "./whmanager_rpcdefs";
import * as hsmarshalling from "./hsmarshalling";
import { registerAsNonReloadableLibrary } from "../hmrinternal";
import { createDeferred, DeferredPromise } from "@webhare/std";
import { DebugConfig, updateDebugConfig } from "@webhare/env/src/envbackend";
import { IPCPortControlMessage, IPCEndPointImplControlMessage, IPCEndPointImpl, IPCPortImpl, IPCPortControlMessageType, IPCEndPointImplControlMessageType, IPCLinkType } from "./ipc";
import { TypedMessagePort, createTypedMessageChannel, bufferToArrayBuffer } from './transport';
import { RefTracker } from "./refs";
import { generateBase64UniqueID } from "../util/crypto";
import * as stacktrace_parser from "stacktrace-parser";
import { ProcessList, DebugIPCLinkType, DebugRequestType, DebugResponseType, ConsoleLogItem } from "./debug";
import * as inspector from "node:inspector";
import * as envbackend from "@webhare/env/src/envbackend";
import { getCallerLocation } from "../util/stacktrace";

export { IPCMessagePacket, IPCLinkType } from "./ipc";
export { SimpleMarshallableData, SimpleMarshallableRecord, IPCMarshallableData, IPCMarshallableRecord } from "./hsmarshalling";
export { dumpActiveIPCMessagePorts } from "./transport";

const logmessages = envbackend.flags.ipc;
const logpackets = envbackend.flags.ipcpackets;

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

export interface LogErrorOptions {
  groupid?: string;
  script?: string;
  info?: string;
  contextinfo?: hsmarshalling.IPCMarshallableRecord;
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
  log(logname: string, logline: string): void;

  /** Flushes a log file. Returns when the flushing has been done, throws when the log did not exist
  */
  flushLog(logname: string | "*"): Promise<void>;

  /** Log an error to the notice log
      @param e - Error to log
  */
  logError(e: Error, options?: LogErrorOptions): void;

  /** Ensure events and logs have been delivered to the whmanager */
  ensureDataSent(): Promise<void>;

  /** Returns a list of all currently running processes */
  getProcessList(): Promise<ProcessList>;
}

enum ToLocalBridgeMessageType {
  SystemConfig,
  Event,
  FlushLogResult,
  EnsureDataSentResult,
  GetProcessListResult,
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
};

enum ToMainBridgeMessageType {
  SendEvent,
  RegisterPort,
  ConnectLink,
  Log,
  FlushLog,
  EnsureDataSent,
  GetProcessList,
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
};

type LocalBridgeInitData = {
  id: string;
  port: TypedMessagePort<ToMainBridgeMessage, ToLocalBridgeMessage>;
};

/** Check if all messages types have been handled in a switch. Put this function in the
 * default handler. Warning: only works for union types, because non-union types aren't
 * narrowed
*/
export function checkAllMessageTypesHandled<T extends never>(message: T, key: string): never {
  throw new Error(`message type ${(message as { [type: string]: unknown })[key]} not handled`);
}

class LocalBridge extends EventSource<BridgeEvents> {
  id: string;
  port: TypedMessagePort<ToMainBridgeMessage, ToLocalBridgeMessage>;
  requestcounter = 11000;
  systemconfig: Record<string, unknown>;
  _ready: DeferredPromise<void>;
  connected = false;
  reftracker: RefTracker;

  pendingensuredatasent = new Map<number, () => void>();
  pendingflushlogs = new Map<number, { resolve: () => void; reject: (_: Error) => void }>;
  pendinggetprocesslists = new Map<number, (processlist: ProcessList) => void>();

  constructor(initdata: LocalBridgeInitData) {
    super();
    this.id = initdata.id;
    this.port = initdata.port;
    this.systemconfig = {};
    this._ready = createDeferred<void>();
    this.port.on("message", (message) => this.handleControlMessage(message));
    this.port.unref();
    this.reftracker = new RefTracker(this.port, { initialref: false });
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
      default:
        checkAllMessageTypesHandled(message, "type");
    }
  }

  async sendEvent(name: string, data: unknown): Promise<void> {
    this.port.postMessage({
      type: ToMainBridgeMessageType.SendEvent,
      name,
      data: bufferToArrayBuffer(hsmarshalling.writeMarshalData(data, { onlySimple: true }))
    });
  }

  log(logname: string, logline: string): void {
    this.port.postMessage({
      type: ToMainBridgeMessageType.Log,
      logname,
      logline
    });
  }

  private encodeJavaScriptException(e: Error, options: {
    script?: string;
    contextinfo?: hsmarshalling.IPCMarshallableRecord;
    errortype?: "exception" | "unhandledRejection";
  }) {
    const trace = stacktrace_parser.parse(e?.stack ?? "");
    const data = {
      script: options.script ?? require.main?.filename ?? "",
      trace: trace.map(entry => ({
        filename: entry.file,
        line: entry.lineNumber,
        col: entry.column,
        functionname: entry.methodName
      })),
      error: e.message || "",
      browser: { name: "nodejs" },
      contextinfo: options.contextinfo ? hsmarshalling.encodeHSON(options.contextinfo) : "",
      type: options.errortype === "unhandledRejection" ? "javascript-unhandled-rejection" : "javascript-error"
    };
    return hsmarshalling.encodeHSON(data);
  }

  logError(e: Error, options: LogErrorOptions = {}) {
    const groupid = options.groupid ?? this.getGroupId();
    this.log("system:notice", `ts-node\tERROR\t${groupid}\t\tjavascript-error\t${this.encodeJavaScriptException(e, options)}`);
  }

  async flushLog(logname: string | "*"): Promise<void> {
    const requestid = ++this.requestcounter;
    const lock = this.reftracker.getLock();
    try {
      await new Promise<void>((resolve, reject) => {
        this.pendingflushlogs.set(requestid, { resolve, reject });
        this.port.postMessage({
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
        this.port.postMessage({
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
    const { port1, port2 } = createTypedMessageChannel<never, IPCPortControlMessage>();
    this.port.postMessage({
      type: ToMainBridgeMessageType.RegisterPort,
      name,
      port: port2,
      global: global || false
    }, [port2]);
    return new IPCPortImpl(name, port1);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connect<LinkType extends IPCLinkType<any, any> = IPCLinkType>(name: string, { global }: { global?: boolean } = {}): LinkType["ConnectEndPoint"] {
    const { port1, port2 } = createTypedMessageChannel<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>();
    const id = generateBase64UniqueID();
    this.port.postMessage({
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
        this.port.postMessage({
          type: ToMainBridgeMessageType.GetProcessList,
          requestid,
        });
      });
    } finally {
      lock.release();
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

class MainBridge extends EventSource<BridgeEvents> {
  conn: WHManagerConnection;
  connectionactive = false;
  connectcounter = 0;
  connectionfailedtimeout?: NodeJS.Timer;
  localbridges = new Set<{ id: string; port: TypedMessagePort<ToLocalBridgeMessage, ToMainBridgeMessage> }>;
  _ready = createDeferred<void>();
  _conntimeout?: NodeJS.Timer;

  ports = new Map<string, PortRegistration>;

  portregistermsgid = BigInt(0);
  portregisterrequests = new Map<bigint, PortRegistration>;

  linkidcounter = 0;
  links = new Map<number, { name: string; port: TypedMessagePort<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>; partialmessages: Map<bigint, Buffer[]> }>;

  requestcounter = 34000; // start here to aid debugging
  flushlogrequests = new Map<number, { port: TypedMessagePort<ToLocalBridgeMessage, ToMainBridgeMessage>; requestid: number }>;
  getprocesslistrequests = new Map<number, { port: TypedMessagePort<ToLocalBridgeMessage, ToMainBridgeMessage>; requestid: number }>;

  systemconfig: Record<string, unknown>;

  bridgename = "main bridge";
  processcode = BigInt(0);

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
      processcode: BigInt(0),
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
      bridge.port.postMessage({ type: ToLocalBridgeMessageType.SystemConfig, systemconfig: this.systemconfig, connected: false });
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
        for (const localbridge of this.localbridges)
          localbridge.port.postMessage({
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
          bridge.port.postMessage({ type: ToLocalBridgeMessageType.SystemConfig, connected: true, systemconfig: this.systemconfig });
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
          const { port1, port2 } = createTypedMessageChannel<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>();
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
          reg.port.postMessage({
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
          reg.port.postMessage({
            type: ToLocalBridgeMessageType.GetProcessListResult,
            requestid: reg.requestid,
            processes: data.processes.map(p => ({ ...p, debuggerconnected: false }))
          });
        }
      } break;
      case WHMResponseOpcode.AnswerException:
      case WHMResponseOpcode.ConfigureLogsResult:
      case WHMResponseOpcode.UnregisterPortResult: {
        // all ignored
      } break;
      default:
        checkAllMessageTypesHandled(data, "opcode");
    }
  }

  async gotLocalBridgeMessage(id: string, port: TypedMessagePort<ToLocalBridgeMessage, ToMainBridgeMessage>, message: ToMainBridgeMessage) {
    if (logmessages)
      console.log(`${this.bridgename}: message from local bridge ${id}`, { ...message, type: ToMainBridgeMessageType[message.type] });
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
            bridge.port.postMessage({ type: ToLocalBridgeMessageType.Event, name: message.name, data: message.data });
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
            this.flushlogrequests.set(requestid, { port, requestid: message.requestid });
            this.sendData({
              opcode: WHMRequestOpcode.FlushLog,
              logname: message.logname,
              requestid
            });
          } else {
            port.postMessage({
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
        port.postMessage({
          type: ToLocalBridgeMessageType.EnsureDataSentResult,
          requestid: message.requestid,
        });
      } break;
      case ToMainBridgeMessageType.GetProcessList: {
        const ref = await this.waitReadyReturnRef();
        try {
          if (this.connectionactive) {
            const requestid = this.allocateRequestId();
            this.getprocesslistrequests.set(requestid, { port, requestid: message.requestid });
            this.sendData({
              opcode: WHMRequestOpcode.GetProcessList,
              requestid
            });
          } else {
            port.postMessage({
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
      const { port1, port2 } = createTypedMessageChannel<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>();
      const id = generateBase64UniqueID();
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
      case DebugRequestType.getRecentLoggedItems: {
        this.debuglink?.send({
          type: DebugResponseType.getRecentLoggedItemsResult,
          items: consoledata
        }, packet.msgid);
      } break;
      default:
        checkAllMessageTypesHandled(message, "type");
    }
  }

  gotLocalBridgeClose(id: string, port: TypedMessagePort<ToLocalBridgeMessage, ToMainBridgeMessage>) {
    if (logmessages)
      console.log(`${this.bridgename}: local bridge ${id} closed`);
    for (const bridge of this.localbridges)
      if (bridge.port === port)
        this.localbridges.delete(bridge);
  }

  getLocalHandlerInitData(): LocalBridgeInitData {
    const { port1, port2 } = createTypedMessageChannel<ToLocalBridgeMessage, ToMainBridgeMessage>();
    const id = generateBase64UniqueID();
    port1.on("message", (msg) => this.gotLocalBridgeMessage(id, port1, msg));
    port1.on("close", () => this.gotLocalBridgeClose(id, port1));
    this.localbridges.add({ id, port: port1 });
    port1.postMessage({ type: ToLocalBridgeMessageType.SystemConfig, connected: this.connectionactive, systemconfig: this.systemconfig });
    // Do not want these ports to keep the event loop running.
    port1.unref();
    port2.unref();
    return { id, port: port2 };
  }
}

const old_console_funcs = { ...console };
const old_std_writes = {
  stdout: process.stdout.write,
  stderr: process.stderr.write
};

function hookConsoleLog() {
  const source: { func: string; location: { filename: string; line: number; col: number; func: string } | null; when: Date; loggedlocation: boolean } = {
    func: "",
    location: null,
    when: new Date(),
    loggedlocation: false
  };
  for (const [key, func] of Object.entries(old_console_funcs)) {
    if (key != "Console") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (console as any)[key] = (...args: unknown[]) => {
        source.func = key;
        source.when = new Date();
        source.location = getCallerLocation(1); // 1 is location of parent
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (func as (...args: any[]) => any).apply(console, args);
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stdout.write = (data: string | Uint8Array, encoding?: any, cb?: (err?: Error) => void): any => {
    if (envbackend.flags.conloc && source.location)
      old_std_writes.stdout.call(process.stdout, `${source.location.filename.split("/").at(-1)}:${source.location.line}: `, "utf-8");
    const retval = old_std_writes.stdout.call(process.stdout, data, encoding, cb);
    const tolog: string = typeof data == "string" ? data : Buffer.from(data).toString("utf-8");
    consoledata.push({ func: source.func, data: tolog, when: source.when, location: source.location });
    if (consoledata.length > 100)
      consoledata.shift();
    return retval;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stderr.write = (data: string | Uint8Array, encoding?: any, cb?: (err?: Error) => void): any => {
    if (envbackend.flags.conloc && source.location)
      old_std_writes.stderr.call(process.stderr, `${source.location.filename.split("/").at(-1)}:${source.location.line}: `, "utf-8");
    const retval = old_std_writes.stderr.call(process.stderr, data, encoding, cb);
    const tolog: string = typeof data == "string" ? data : Buffer.from(data).toString("utf-8");
    consoledata.push({ func: source.func, data: tolog, when: source.when, location: source.location });
    if (consoledata.length > 100)
      consoledata.shift();
    return retval;
  };
}

hookConsoleLog();


const mainbridge = new MainBridge;

const bridgeimpl = new LocalBridge(mainbridge.getLocalHandlerInitData());

const bridge: Bridge = bridgeimpl;
export default bridge;


registerAsNonReloadableLibrary(module);

process.on('uncaughtExceptionMonitor', (error, origin) => {
  console.error(origin == "unhandledRejection" ? "Uncaught rejection" : "Uncaught exception", error);
  bridge.logError(error, { errortype: origin == "unhandledRejection" ? origin : "exception" });
});

process.on('uncaughtException', async (error) => {
  await bridge.ensureDataSent();
  process.exit(1);
});

process.on('unhandleRejection', async (reason, promise) => {
  await bridge.ensureDataSent();
  process.exit(1);
});
