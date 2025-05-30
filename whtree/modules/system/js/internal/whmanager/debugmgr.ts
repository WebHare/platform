import EventSource from "../eventsource";
import bridge, { checkAllMessageTypesHandled } from "./bridge";
import { type DebugIPCLinkType, DebugRequestType, DebugResponseType, type DebugMgrClientLink, DebugMgrClientLinkRequestType, DebugMgrClientLinkResponseType, directforwards, type ForwardByRequestType } from "./debug";


type ProcessRegistration = {
  pid: number;
  workernr: number;
  workerid: string;
  link: DebugIPCLinkType["AcceptEndPoint"];
};

type HandlerEvents = {
  processlist: void;
};

const firstInsectorPort = 15001; // first port to use for inspectors
const maxInspectorPort = 65535; // maximum port to use for inspectors
let nextInspectorPort = firstInsectorPort;

// Map existing inspectors. Note that process/worker closing will leak on this map but we don't expect that to be a real issue in practice
const inspectorPortMap = new Map<string, number>();

class DebuggerHandler extends EventSource<HandlerEvents> {

  debugport: DebugIPCLinkType["Port"];

  processes = new Map<string, ProcessRegistration>();

  constructor() {
    super();
    this.debugport = bridge.createPort<DebugIPCLinkType>("ts:debugmgr_internal", { global: true });
    this.debugport.on("accept", (link) => this.gotLink(link));
    void this.debugport.activate(); // no need to await on activation here
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
    void link.activate(); // no need to wait on activation here
  }

  gotLinkMessage(reg: ProcessRegistration, packet: DebugIPCLinkType["AcceptEndPointPacket"]) {
    if (this.isResponseToForwardedMessage(packet.message)) {
      console.log("got response", packet.message);
      return;
    }

    switch (packet.message.type) {
      case DebugResponseType.register: {
        const procid = packet.message.pid + '.' + packet.message.workernr;
        if (this.processes.has(procid)) {
          console.error(`Process with id ${packet.message.pid}.${packet.message.workernr} already registered`);
          return;
        }

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
    if (inspectorPortMap.has(reg.workerid)) //as DebuggerHandler doesn't persist when it has no clients, we can't look at this.processes
      return inspectorPortMap.get(reg.workerid)!;

    const listenerPort = nextInspectorPort++;
    if (nextInspectorPort > maxInspectorPort)
      nextInspectorPort = firstInsectorPort; //wrap around

    inspectorPortMap.set(reg.workerid, listenerPort);
    return listenerPort;
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

void start();

class DebugMgrClient {
  handler: DebuggerHandler;
  link: DebugMgrClientLink["AcceptEndPoint"];
  subscribedprocesslist = false;
  gotvalidprocesslist = false;
  processlistcb = 0;
  processlistwaits = new Set<PromiseWithResolvers<void>>();

  constructor(link: DebugMgrClientLink["AcceptEndPoint"]) {
    this.link = link;
    link.on("message", (message) => void this._gotMessage(message));
    link.on("close", () => this._gotClose());
    void link.activate(); // no need to wait on activation here
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
          if (!res.url)
            inspectorPortMap.delete(reg.workerid); //remove the port from the map as it might be broken if enableInspector fails. often caused by a restart of debugmgr-ts losing track of ports in use

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
