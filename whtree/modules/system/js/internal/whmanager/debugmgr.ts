import EventSource from "../eventsource";
import { isTruthy } from "@webhare/std";
import bridge, { checkAllMessageTypesHandled } from "./bridge";
import { DebugIPCLinkType, DebugRequestType, DebugResponseType, DebugMgrClientLink, DebugMgrClientLinkRequestType, DebugMgrClientLinkResponseType, directforwards, ForwardByRequestType } from "./debug";


type ProcessRegistration = {
  pid: number;
  workernr: number;
  workerid: string;
  link: DebugIPCLinkType["AcceptEndPoint"];
  inspectorport: number | undefined;
};

type HandlerEvents = {
  processlist: void;
};

class DebuggerHandler extends EventSource<HandlerEvents> {

  debugport: DebugIPCLinkType["Port"];

  processes = new Map<string, ProcessRegistration>();

  constructor() {
    super();
    this.debugport = bridge.createPort<DebugIPCLinkType>("ts:debugmgr_internal", { global: true });
    this.debugport.on("accept", (link) => this.gotLink(link));
    this.debugport.activate();
  }

  isResponseToForwardedMessage(message: DebugIPCLinkType["AcceptEndPointPacket"]["message"]): message is typeof message & { type: (typeof directforwards)[keyof typeof directforwards]["responsetype"] } {
    return message.type in directforwards && Object.hasOwn(directforwards, message.type);
  }

  gotLink(link: DebugIPCLinkType["AcceptEndPoint"]): void {
    const reg = {
      pid: 0,
      workernr: 0,
      workerid: "",
      link,
      inspectorport: undefined,
    };
    link.on("message", (packet) => this.gotLinkMessage(reg, packet));
    link.on("close", () => this.gotLinkClose(reg));
    link.activate();
  }

  gotLinkMessage(reg: ProcessRegistration, packet: DebugIPCLinkType["AcceptEndPointPacket"]) {
    if (this.isResponseToForwardedMessage(packet.message)) {
      console.log("got response", packet.message);
      return;
    }

    switch (packet.message.type) {
      case DebugResponseType.register: {
        const procid = packet.message.pid + '.' + packet.message.workernr;
        reg.pid = packet.message.pid;
        reg.workernr = packet.message.workernr;
        reg.workerid = packet.message.workerid;
        this.processes.set(procid, reg);
        this.emit("processlist", void (0));
      } break;
      case DebugResponseType.enableInspectorResult: break; // only response type
      default: {
        checkAllMessageTypesHandled(packet.message, "type");
      }
    }
  }

  gotLinkClose(reg: ProcessRegistration) {
    if (reg.pid) {
      this.processes.delete(reg.pid + '.' + reg.workernr);
      this.emit("processlist", void (0));
    }
  }

  allocateInspectorPort(reg: ProcessRegistration) {
    if (reg.inspectorport)
      return reg.inspectorport;
    const allports = new Set(Array.from(this.processes.values()).map(otherReg => otherReg.inspectorport).filter(isTruthy));
    for (let port = inspectorportbase; ; ++port) {
      if (!allports.has(port)) {
        reg.inspectorport = port;
        return port;
      }
    }
  }

  close() {
    this.debugport.close();
  }
}

let activeclients = 0;
let globalhandler: DebuggerHandler | undefined;

async function start() {
  const port = bridge.createPort<DebugMgrClientLink>("ts:debugmgr", { global: true });
  port.on("accept", (link) => new DebugMgrClient(link));
  await port.activate();
}

const inspectorportbase = 15001;
start();

class DebugMgrClient {
  handler: DebuggerHandler;
  link: DebugMgrClientLink["AcceptEndPoint"];
  subscribedprocesslist = false;
  gotvalidprocesslist = false;
  processlistcb = 0;
  processlistwaits = new Set<PromiseWithResolvers<void>>();

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

  async ensureProcessConnected(processid: string): Promise<ProcessRegistration | undefined> {
    {
      if (parseInt(processid) > 0 && !processid.includes('.')) //it's a number without the `.0` suffix. retarget to main thread
        processid = processid + '.0';

      const proc = this.handler.processes.get(processid);
      if (proc)
        return proc;
    }

    for (; ;) {
      const defer = Promise.withResolvers<void>();
      this.processlistwaits.add(defer);

      const processlist = await bridge.getProcessList();
      const findpid = parseInt(processid); //as a processid is formatted as `pid.workernr`, parseint will just give us the PID
      const process = processlist.find(p => p.pid === findpid);
      if (!process) {  // process is gone
        return undefined;
      }

      await defer.promise;
      this.processlistwaits.delete(defer);

      const proc = this.handler.processes.get(processid);
      if (proc) {
        return proc;
      }
    }
  }

  isForwarded(message: DebugMgrClientLink["AcceptEndPointPacket"]["message"]): message is typeof message & { type: keyof typeof directforwards } {
    return message.type in directforwards && Object.hasOwn(directforwards, message.type);
  }

  async forwardRequest<K extends keyof typeof directforwards
  >(message: ForwardByRequestType<K>["Request"], msgid: bigint) {
    try {
      const reg = await this.ensureProcessConnected(message.processid);
      if (!reg) {
        throw new Error(`Process has already terminated`);
      }
      const res = await reg.link.doRequest({ ...message, type: directforwards[message.type].requesttype });
      this.link.send({
        ...res,
        type: directforwards[message.type].clientresponsetype,
      } as unknown as DebugMgrClientLink["ConnectEndPointPacket"]["message"], msgid);
    } catch (e) {
      this.link.sendException(e as Error, msgid);
    }
  }

  async _gotMessage(packet: DebugMgrClientLink["AcceptEndPointPacket"]) {
    if (this.isForwarded(packet.message)) {
      await this.forwardRequest(packet.message, packet.msgid);
      return;
    }

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
            processlist: processlist
          }, packet.msgid);
        } catch (e) {
          this.link.sendException(e as Error, packet.msgid);
        }
      } break;
      case DebugMgrClientLinkRequestType.enableInspector: {
        try {
          const reg = await this.ensureProcessConnected(packet.message.processid);
          if (!reg) {
            this.link.send({
              type: DebugMgrClientLinkResponseType.enableInspectorResult,
              url: ""
            }, packet.msgid);
            return;
          }

          const port = this.handler.allocateInspectorPort(reg);

          const res = await reg.link.doRequest({ type: DebugRequestType.enableInspector, port });
          this.link.send({
            type: DebugMgrClientLinkResponseType.enableInspectorResult,
            url: res.url
          }, packet.msgid);
        } catch (e) {
          this.link.sendException(e as Error, packet.msgid);
        }
      } break;
      default: {
        checkAllMessageTypesHandled(packet.message, "type");
      }
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
