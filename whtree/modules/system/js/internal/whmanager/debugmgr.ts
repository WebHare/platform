import EventSource from "../eventsource";
import { createDeferred, DeferredPromise } from "@webhare/std";
import bridge, { checkAllMessageTypesHandled } from "./bridge";
import { DebugIPCLinkType, DebugRequestType, DebugResponseType, DebugMgrClientLink, DebugMgrClientLinkRequestType, DebugMgrClientLinkResponseType } from "./debug";


type ProcessRegistration = {
  processcode: number;
  link: DebugIPCLinkType["AcceptEndPoint"];
};

type HandlerEvents = {
  processlist: void;
};

class DebuggerHandler extends EventSource<HandlerEvents>{

  debugport: DebugIPCLinkType["Port"];

  processes = new Map<number, ProcessRegistration>();

  constructor() {
    super();
    this.debugport = bridge.createPort<DebugIPCLinkType>("ts:debugmgr_internal", { global: true });
    this.debugport.on("accept", (link) => this.gotLink(link));
    this.debugport.activate();
  }

  gotLink(link: DebugIPCLinkType["AcceptEndPoint"]): void {
    const reg = {
      processcode: 0,
      link
    };
    link.on("message", (packet) => this.gotLinkMessage(reg, packet));
    link.on("close", () => this.gotLinkClose(reg));
    link.activate();
  }

  gotLinkMessage(reg: ProcessRegistration, packet: DebugIPCLinkType["AcceptEndPointPacket"]) {
    switch (packet.message.type) {
      case DebugResponseType.register: {
        reg.processcode = packet.message.processcode;
        this.processes.set(packet.message.processcode, reg);
        this.emit("processlist", void (0));
      } break;
      case DebugResponseType.enableInspectorResult: break; // only response type
      case DebugResponseType.getRecentLoggedItemsResult: break; // only response type
      default: {
        checkAllMessageTypesHandled(packet.message, "type");
      }
    }
  }

  gotLinkClose(reg: ProcessRegistration) {
    if (reg.processcode) {
      this.processes.delete(reg.processcode);
      this.emit("processlist", void (0));
    }
  }

  close() {
    this.debugport.close();
  }
}

let activeclients = 0;
let globalhandler: DebuggerHandler | undefined;

/*
function arrayPick<T extends object, K extends string & keyof T>(arr: T[], keys: K[]): Array<Pick<T,K>> {
  return arr.map((elt: T) => {
    const ret = {} as Pick<T, K>;
    keys.forEach((key: K) => {
      if (key in elt)
        ret[key] = elt[key];
    });
    return ret;
  });
}
*/
async function start() {
  const port = bridge.createPort<DebugMgrClientLink>("ts:debugmgr", { global: true });
  port.on("accept", (link) => new DebugMgrClient(link));
  await port.activate();
}

let inspectorport = 15000;
start();

class DebugMgrClient {
  handler: DebuggerHandler;
  link: DebugMgrClientLink["AcceptEndPoint"];
  subscribedprocesslist = false;
  gotvalidprocesslist = false;
  processlistcb = 0;
  processlistwaits = new Set<DeferredPromise<void>>();

  constructor(link: DebugMgrClientLink["AcceptEndPoint"]) {
    this.link = link;
    link.on("message", (message) => this._gotMessage(message));
    link.on("close", () => this._gotClose());
    link.activate();
    ++activeclients;
    if (!globalhandler) {
      globalhandler = new DebuggerHandler;
    }
    this.handler = globalhandler;
    this.processlistcb = this.handler.on("processlist", () => {
      if (this.subscribedprocesslist && this.gotvalidprocesslist) {
        this.gotvalidprocesslist = false;
        this.link.send({ type: DebugMgrClientLinkResponseType.eventProcessListUpdated });
      }
      for (const defer of this.processlistwaits)
        defer.resolve();
    });
  }

  _gotProcessListUpdate() {
    if (this.gotvalidprocesslist) {
      this.gotvalidprocesslist = false;
      this.link.send({ type: DebugMgrClientLinkResponseType.eventProcessListUpdated });
    }
  }

  async ensureProcessConnected(processcode: number): Promise<ProcessRegistration | undefined> {
    {
      const proc = this.handler.processes.get(processcode);
      if (proc)
        return proc;
    }

    for (; ;) {
      const defer = createDeferred<void>();
      this.processlistwaits.add(defer);

      const processlist = await bridge.getProcessList();
      const process = processlist.find(p => p.processcode === processcode);
      if (!process) {  // process is gone
        return undefined;
      }

      await defer.promise;
      this.processlistwaits.delete(defer);

      const proc = this.handler.processes.get(processcode);
      if (proc) {
        return proc;
      }
    }
  }

  async _gotMessage(packet: DebugMgrClientLink["AcceptEndPointPacket"]) {
    switch (packet.message.type) {
      case DebugMgrClientLinkRequestType.subscribeProcessList: {
        if (this.subscribedprocesslist !== packet.message.enable) {
          if (packet.message.enable) {
            if (!this.gotvalidprocesslist)
              this.link.send({ type: DebugMgrClientLinkResponseType.eventProcessListUpdated });
          }
          this.subscribedprocesslist = packet.message.enable;
        }
        this.link.send({ type: DebugMgrClientLinkResponseType.subscribeProcessListResult }, packet.msgid);
      } break;
      case DebugMgrClientLinkRequestType.getProcessList: {
        try {
          const processlist = await bridge.getProcessList();
          this.gotvalidprocesslist = true;
          this.link.send({
            type: DebugMgrClientLinkResponseType.getProcessListResult,
            processlist: processlist.map(p => ({ ...p, debuggerconnected: Boolean(this.handler.processes.get(p.processcode)) }))
          }, packet.msgid);
        } catch (e) {
          this.link.sendException(e as Error, packet.msgid);
        }
      } break;
      case DebugMgrClientLinkRequestType.enableInspector: {
        try {
          const reg = await this.ensureProcessConnected(packet.message.processcode);
          if (!reg) {
            this.link.send({
              type: DebugMgrClientLinkResponseType.enableInspectorResult,
              url: ""
            }, packet.msgid);
            return;
          }

          ++inspectorport;
          const res = await reg.link.doRequest({ type: DebugRequestType.enableInspector, port: inspectorport });
          this.link.send({
            type: DebugMgrClientLinkResponseType.enableInspectorResult,
            url: res.url
          }, packet.msgid);
        } catch (e) {
          this.link.sendException(e as Error, packet.msgid);
        }
      } break;
      case DebugMgrClientLinkRequestType.getRecentlyLoggedItems: {
        try {
          const reg = await this.ensureProcessConnected(packet.message.processcode);
          if (!reg)
            throw new Error(`Process has already terminated`);
          const res = await reg.link.doRequest({ type: DebugRequestType.getRecentLoggedItems });
          this.link.send({
            type: DebugMgrClientLinkResponseType.getRecentlyLoggedItemsResult,
            items: res.items
          }, packet.msgid);
        } catch (e) {
          this.link.sendException(e as Error, packet.msgid);
        }
      } break;
      default:
        checkAllMessageTypesHandled(packet.message, "type");
    }
  }

  _gotClose() {
    if (this.processlistcb)
      this.handler.off(this.processlistcb);
    this.processlistcb = 0;
    --activeclients;
    if (!activeclients) {
      globalhandler?.close();
      globalhandler = undefined;
    }
  }
}
