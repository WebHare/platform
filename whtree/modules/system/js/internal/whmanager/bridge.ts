import EventSource from "../eventsource";
import { WHManagerConnection, WHMResponse } from "./whmanager_conn";
import { WHMRequestOpcode, WHMResponseOpcode } from "./whmanager_rpcdefs";
import * as hsmarshalling from "./hsmarshalling";
import { registerAsNonReloadableLibrary } from "../hmrinternal";
import { DeferredPromise } from "../types";
import { createDeferred } from "../tools";

type BridgeEvents = {
  event: {
    name: string;
    data: unknown;
  };
  systemconfig: Record< string, unknown >;
};

class Bridge extends EventSource<BridgeEvents> {
  private conn: WHManagerConnection;
  private _systemconfig: Record< string, unknown > | null;
  private _ready: DeferredPromise< void >;

  constructor() {
    super();
    this._ready = createDeferred< void >();
    this._systemconfig = null;
    this.conn = new WHManagerConnection;
    this.conn.on("data", data => this.gotData(data));
    this.conn.on("online", data => this.register());
    setTimeout(() => {
      // after 2 seconds, give up on a connection to the whmanager
      this._systemconfig = {};
      this._ready.resolve();
    }, 2000).unref(); // don't let the eventloop run just for this timeout
  }

  get ready() {
    return this.waitReady();
  }

  get systemconfig() {
    if (!this._systemconfig)
      throw new Error(`Bridge is not ready yet, please await bridge.ready`);
    return this._systemconfig;
  }

  private async waitReady() {
    const ref = this.conn.getRef();
    try {
      await this._ready.promise;
    } finally {
      ref.close();
    }
  }

  private async register() {
    this.conn.send({
      opcode: WHMRequestOpcode.RegisterProcess,
      processcode: BigInt(0),
      clientname: require.main?.filename ?? "<unknown javascript script>"
    });
  }

  private gotData(data: WHMResponse) {
    switch (data.opcode) {
      case WHMResponseOpcode.IncomingEvent: {
        this.emit("event", { name: data.eventname, data: hsmarshalling.readMarshalPacket(data.eventdata) });
      } break;
      case WHMResponseOpcode.RegisterProcessResult: {
        const decoded = hsmarshalling.readMarshalPacket(data.systemconfigdata);
        if (typeof decoded == "object" && decoded)
          this._systemconfig = decoded as Record< string, unknown >;
        this._ready.resolve();
      } break;
    }
  }

  async sendEvent(eventname: string, eventdata: unknown) {
    await this.ready;
    this.conn.send({
      opcode: WHMRequestOpcode.SendEvent,
      eventname,
      eventdata: hsmarshalling.writeMarshalPacket(eventdata)
    });
  }
}

const bridge: Bridge = new Bridge;

export default bridge;

registerAsNonReloadableLibrary(module);
