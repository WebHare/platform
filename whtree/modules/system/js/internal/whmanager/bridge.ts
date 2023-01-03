import EventSource from "../eventsource";
import { WHManagerConnection, WHMResponse } from "./whmanager_conn";
import { WHMRequest, WHMRequestOpcode, WHMResponseOpcode } from "./whmanager_rpcdefs";
import * as hsmarshalling from "./hsmarshalling";
import { registerAsNonReloadableLibrary } from "../hmrinternal";
import { DeferredPromise } from "../types";
import { createDeferred } from "../tools";
import { DebugConfig, updateDebugConfig } from "@webhare/env/src/envbackend";
import { IPCPort, IPCEndPoint, IPCPortControlMessage, IPCEndPointImplControlMessage, IPCEndPointImpl, IPCPortImpl, IPCPortControlMessageType, IPCEndPointImplControlMessageType } from "./ipc";
import { TypedMessagePort, createTypedMessageChannel, bufferToArrayBuffer } from './transport';
import { RefTracker } from "./refs";
import { generateBase64UniqueID } from "../util/crypto";

export { IPCPort, IPCEndPoint } from "./ipc";
export { SimpleMarshallableData, SimpleMarshallableRecord, IPCMarshallableData, IPCMarshallableRecord } from "./hsmarshalling";


const logpackets = false;
const logmessages = false;

/// Number of milliseconds before connection to whmanager times out
const whmanager_connection_timeout = 1500;

export type BridgeEventData = hsmarshalling.SimpleMarshallableRecord;
export type BridgeMessageData = hsmarshalling.IPCMarshallableRecord;

type BridgeEvents = {
  event: {
    name: string;
    data: BridgeEventData;
  };
  systemconfig: Record<string, unknown>;
};

type CreatePortOptions = {
  global?: boolean;
};

type ConnectOptions = {
  global?: boolean;
};


interface Bridge extends EventSource<BridgeEvents> {
  get connected(): boolean;
  get ready(): Promise<void>;
  get systemconfig(): unknown;

  sendEvent(eventname: string, eventdata: BridgeEventData): Promise<void>;

  createPort<SendType extends object | null = BridgeMessageData, ReceiveType extends object | null = BridgeMessageData>(name: string, options?: CreatePortOptions): IPCPort<SendType, ReceiveType>;

  connect<SendType extends object | null = BridgeMessageData, ReceiveType extends object | null = BridgeMessageData>(name: string, options?: ConnectOptions): IPCEndPoint<SendType, ReceiveType>;

  /** Write a line to a log file
      @param logname - Name of the log file
      @param logline - Line to log
  */
  log(logname: string, logline: string): Promise<void>;

  /** Flushes a log file. Returns when the flushing has been done, throws when the log did not exist
  */
  flushLog(logname: string | "*"): Promise<void>;
}



enum ToLocalBridgeMessageType {
  SystemConfig,
  Event,
  SendEventResult,
  LogResult,
  FlushLogResult,
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
  type: ToLocalBridgeMessageType.SendEventResult;
  requestid: number;
  success: boolean;
} | {
  type: ToLocalBridgeMessageType.LogResult;
  requestid: number;
  success: boolean;
} | {
  type: ToLocalBridgeMessageType.FlushLogResult;
  requestid: number;
  success: boolean;
};

enum ToMainBridgeMessageType {
  SendEvent,
  RegisterPort,
  ConnectLink,
  Log,
  FlushLog,
}

type ToMainBridgeMessage = {
  type: ToMainBridgeMessageType.SendEvent;
  requestid: number;
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
  port: TypedMessagePort<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>;
  global: boolean;
} | {
  type: ToMainBridgeMessageType.Log;
  requestid: number;
  logname: string;
  logline: string;
} | {
  type: ToMainBridgeMessageType.FlushLog;
  requestid: number;
  logname: string;
};

type LocalBridgeInitData = {
  id: string;
  port: TypedMessagePort<ToMainBridgeMessage, ToLocalBridgeMessage>;
};

class LocalBridge extends EventSource<BridgeEvents> {
  id: string;
  port: TypedMessagePort<ToMainBridgeMessage, ToLocalBridgeMessage>;
  requestcounter = 0;
  systemconfig: Record<string, unknown>;
  _ready: DeferredPromise<void>;
  connected = false;
  reftracker: RefTracker;

  pendingeventsends = new Map<number, () => void>;
  pendinglogs = new Map<number, { resolve: () => void; reject: (_: Error) => void }>;
  pendingflushlogs = new Map<number, { resolve: () => void; reject: (_: Error) => void }>;

  constructor(initdata: LocalBridgeInitData) {
    super();
    this.id = initdata.id;
    this.port = initdata.port;
    this.systemconfig = {};
    this._ready = createDeferred<void>();
    this.port.on("message", (message) => this.handleControlMessage(message));
    this.port.unref();
    this.reftracker = new RefTracker(() => this.port.ref(), () => this.port.unref(), { initialref: false });
  }

  get ready() {
    const lock = this.reftracker.getLock("local bridge: waiting for ready");
    return this._ready.promise.then(() => lock.release());
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
      case ToLocalBridgeMessageType.SendEventResult: {
        const reg = this.pendingeventsends.get(message.requestid);
        if (reg) {
          this.pendingeventsends.delete(message.requestid);
          reg();
        }
      } break;
      case ToLocalBridgeMessageType.LogResult: {
        const reg = this.pendinglogs.get(message.requestid);
        if (reg) {
          this.pendinglogs.delete(message.requestid);
          if (message.success)
            reg.resolve();
          else
            reg.reject(new Error(`Logging failed, no connection to the whmanager`));
        }
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
    }
  }

  async sendEvent(name: string, data: unknown): Promise<void> {
    const requestid = ++this.requestcounter;
    const lock = this.reftracker.getLock();
    try {
      await new Promise<void>(resolve => {
        this.pendingeventsends.set(requestid, resolve);
        this.port.postMessage({
          type: ToMainBridgeMessageType.SendEvent,
          requestid,
          name,
          data: bufferToArrayBuffer(hsmarshalling.writeMarshalData(data, { onlySimple: true }))
        });
      });
    } finally {
      lock.release();
    }
  }

  async log(logname: string, logline: string): Promise<void> {
    const requestid = ++this.requestcounter;
    const lock = this.reftracker.getLock();
    try {
      await new Promise<void>((resolve, reject) => {
        this.pendinglogs.set(requestid, { resolve, reject });
        this.port.postMessage({
          type: ToMainBridgeMessageType.Log,
          requestid,
          logname,
          logline
        });
      });
    } finally {
      lock.release();
    }
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

  createPort<SendType extends object | null = BridgeMessageData, ReceiveType extends object | null = BridgeMessageData>(name: string, { global }: { global?: boolean } = {}): IPCPort<SendType, ReceiveType> {
    const { port1, port2 } = createTypedMessageChannel<never, IPCPortControlMessage>();
    this.port.postMessage({
      type: ToMainBridgeMessageType.RegisterPort,
      name,
      port: port2,
      global: global || false
    }, [port2]);
    return new IPCPortImpl(name, port1);
  }

  connect<SendType extends object | null = BridgeMessageData, ReceiveType extends object | null = BridgeMessageData>(name: string, { global }: { global?: boolean } = {}): IPCEndPoint<SendType, ReceiveType> {
    const { port1, port2 } = createTypedMessageChannel<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>();
    this.port.postMessage({
      type: ToMainBridgeMessageType.ConnectLink,
      name,
      port: port1,
      global: global || false
    }, [port1]);
    return new IPCEndPointImpl(port2, "connecting");
  }
}

type PortRegistration = {
  name: string;
  port: TypedMessagePort<IPCPortControlMessage, never>;
  globalregconnectcounter: number;
  initialregistration: boolean;
};

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
  links = new Map<number, { name: string; port: TypedMessagePort<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage> }>;

  requestcounter = 34000; // start here to aid debugging
  flushlogrequests = new Map<number, { port: TypedMessagePort<ToLocalBridgeMessage, ToMainBridgeMessage>; requestid: number }>;

  systemconfig: Record<string, unknown>;

  bridgename = "main bridge";

  constructor() {
    super();
    this.systemconfig = {};
    this.conn = new WHManagerConnection;
    this.conn.on("online", () => this.register());
    this.conn.on("offline", () => this.gotConnectionClose());
    this.conn.on("data", (response) => this.gotWHManagerResponse(response));
    this._conntimeout = setTimeout(() => this.gotConnTimeout(), whmanager_connection_timeout).unref();
  }

  register() {
    this.sendData({
      opcode: WHMRequestOpcode.RegisterProcess,
      processcode: BigInt(0),
      clientname: require.main?.filename ?? "<unknown javascript script>"
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
      port.postMessage({
        type: IPCEndPointImplControlMessageType.Close
      });
      port.close();
    }
    this.links.clear();
    for (const bridge of this.localbridges) {
      bridge.port.postMessage({ type: ToLocalBridgeMessageType.SystemConfig, systemconfig: this.systemconfig, connected: false });
    }
  }

  gotConnTimeout() {
    this._conntimeout = undefined;
    this._ready.resolve();
  }

  async waitReady() {
    const ref = this.conn.getRef();
    try {
      await this._ready.promise;
    } finally {
      ref.close();
    }
  }

  ready(): Promise<void> {
    return this.waitReady();
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
      } break;
      case WHMResponseOpcode.SystemConfig: {
        const decoded = hsmarshalling.readMarshalData(data.systemconfigdata);
        this.systemconfig = decoded as (Record<string, unknown> | null) ?? {};
        if (this.systemconfig.debugconfig)
          updateDebugConfig(this.systemconfig.debugconfig as DebugConfig);
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
          if (data.islastpart) {
            const buffer = data.messagedata.buffer.slice(data.messagedata.byteOffset, data.messagedata.byteOffset + data.messagedata.byteLength);
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
          reg.port.postMessage({ type: ToLocalBridgeMessageType.FlushLogResult, requestid: reg.requestid, success: data.result });
        }
      } break;
    }
  }

  async gotLocalBridgeMessage(id: string, port: TypedMessagePort<ToLocalBridgeMessage, ToMainBridgeMessage>, message: ToMainBridgeMessage) {
    if (logmessages)
      console.log(`${this.bridgename}: message from local bridge ${id}`, { ...message, type: ToMainBridgeMessageType[message.type] });
    switch (message.type) {
      case ToMainBridgeMessageType.SendEvent: {
        await this.ready();
        if (this.connectionactive) {
          this.sendData({
            opcode: WHMRequestOpcode.SendEvent,
            eventname: message.name,
            eventdata: message.data
          });
        }
        port.postMessage({
          type: ToLocalBridgeMessageType.SendEventResult,
          requestid: message.requestid,
          success: this.connectionactive
        });
      } break;
      case ToMainBridgeMessageType.RegisterPort: {
        await this.ready();
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
      } break;
      case ToMainBridgeMessageType.ConnectLink: {
        const reg = this.ports.get(message.name);
        if (reg) {
          reg.port.postMessage({
            type: IPCPortControlMessageType.IncomingLink,
            port: message.port
          }, [message.port]);
          return;
        }
        if (message.global) {
          await this.ready();
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
        }
        message.port.postMessage({
          type: IPCEndPointImplControlMessageType.ConnectResult,
          success: false,
        });
      } break;
      case ToMainBridgeMessageType.Log: {
        await this.ready();
        if (this.connectionactive) {
          this.sendData({
            opcode: WHMRequestOpcode.Log,
            logname: message.logname,
            logline: message.logline
          });
        }
        port.postMessage({
          type: ToLocalBridgeMessageType.LogResult,
          requestid: message.requestid,
          success: this.connectionactive
        });
      } break;
      case ToMainBridgeMessageType.FlushLog: {
        await this.ready();
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
      }
    }
  }

  allocateLinkid() {
    /// Get next uint32_t this.linkidcounter that is not in use yet ('>>> 0' has same effect as % 2**32)
    for (; this.linkidcounter == 0 || this.links.get(this.linkidcounter); this.linkidcounter = ((this.linkidcounter + 1) >>> 0));
    return this.linkidcounter;
  }

  allocateRequestId(): number {
    /// Get next uint32_t for this.requestcounter ('>>> 0' has same effect as % 2**32)
    this.requestcounter = (this.requestcounter + 1) >>> 0;
    return this.requestcounter;
  }

  initLinkHandling(portname: string, linkid: number, msgid: bigint, port: TypedMessagePort<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>) {
    this.links.set(linkid, { name: portname, port: port });
    port.on("message", (ctrlmsg: IPCEndPointImplControlMessage) => {
      switch (ctrlmsg.type) {
        case IPCEndPointImplControlMessageType.ConnectResult: {
          this.sendData({ opcode: WHMRequestOpcode.OpenLinkResult, linkid, replyto: msgid, success: ctrlmsg.success });
          if (!ctrlmsg.success) {
            this.links.delete(linkid);
            port.close();
          }
        } break;
        case IPCEndPointImplControlMessageType.Message: {
          // FIXME: implement message splitting
          this.sendData({ opcode: WHMRequestOpcode.SendMessageOverLink, linkid: linkid, msgid: ctrlmsg.msgid, replyto: ctrlmsg.replyto, islastpart: true, messagedata: ctrlmsg.buffer });
        } break;
        case IPCEndPointImplControlMessageType.Close: {
          this.sendData({ opcode: WHMRequestOpcode.DisconnectLink, linkid });
          port.close();
          this.links.delete(linkid);
        } break;
      }
    });
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

const mainbridge = new MainBridge;

const bridgeimpl = new LocalBridge(mainbridge.getLocalHandlerInitData());

const bridge: Bridge = bridgeimpl;
export default bridge;

registerAsNonReloadableLibrary(module);
