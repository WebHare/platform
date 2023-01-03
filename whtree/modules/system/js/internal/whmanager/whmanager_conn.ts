import * as net from "net";
import EventSource from "../eventsource";
import { parseRPC, createRPC } from "./whmanager_rpc";
import { WHMResponse, WHMRequest } from "./whmanager_rpcdefs";

export * from "./whmanager_rpcdefs";

const logpackets = false;

type WHManagerConnectionEvents = {
  data: WHMResponse;
  offline: void;
  online: void;
};

class Reference {
  private onclose?: () => void;
  constructor(onclose: () => void) {
    this.onclose = onclose;
  }
  close() {
    if (this.onclose)
      this.onclose();
    this.onclose = undefined;
  }
}

export class WHManagerConnection extends EventSource<WHManagerConnectionEvents>  {
  private connecting = false;
  private connected = false;
  private backoff_ms = 1;
  private socket: net.Socket;
  private incoming: Buffer = Buffer.from("");
  private writeref?: Reference | null = null;
  private refs = new Set<Reference>();

  constructor() {
    super();
    this.socket = new net.Socket({ allowHalfOpen: false });
    this.socket.setNoDelay(true);
    this.socket.on("connect", () => this.gotConnection());
    this.socket.on("data", (data) => this.gotIncoming(data));
    this.socket.on("drain", () => {
      if (this.writeref)
        this.writeref.close();
      this.writeref = null;
    });
    this.socket.on("end", () => this.gotConnectionEnd());
    this.socket.on("close", () => this.gotConnectionClose());
    this.socket.on("error", () => this.gotConnectionError());
    this.socket.unref();
    this.connect();
  }

  get online(): boolean {
    return this.connected;
  }

  connect() {
    if (this.connecting || this.socket.destroyed)
      return;
    this.connecting = true;
    const whmanager_port = parseInt(process.env["WEBHARE_BASEPORT"] || "") + 2;
    this.socket.connect(whmanager_port, "127.0.0.1");
  }

  private gotConnection() {
    if (logpackets)
      console.log(`whmconn: connection online`);
    this.backoff_ms = 1;
    this.connecting = false;
    this.connected = true;
    this.emit("online", void (false));
  }

  private gotConnectionEnd() {
    if (logpackets)
      console.log(`whmconn: connection end`);
    if (this.connected) {
      this.connected = false;
      this.emit("offline", void (false));
    }
  }

  private gotConnectionClose() {
    if (logpackets)
      console.log(`whmconn: connection close`);
    if (this.connected) {
      this.connected = false;
      this.emit("offline", void (false));
    }
    this.connect();
  }

  async gotConnectionError() {
    this.backoff_ms = Math.min(this.backoff_ms * 2, 10000);
    this.connecting = false;
    if (logpackets)
      console.log(`whmconn: connection error`);
    // wait for backoff, but don't keep node process running for it
    await new Promise(resolve => {
      setTimeout(resolve, this.backoff_ms).unref();
    });
    this.connect();
  }

  private isComplete(): boolean {
    if (this.incoming.length < 4)
      return false;
    return this.incoming.length >= this.getFirstBufferLength();
  }

  private getFirstBufferLength() {
    if (this.incoming.length < 4)
      return 0;
    const lensofar = this.incoming.readUInt32LE(0) & 0xffffff;
    if (lensofar > 512 * 1024 || lensofar < 4) {
      this.socket.end();
      throw new Error(`Received broken buffer length from database: ${lensofar}`);
    }
    return lensofar;
  }

  private gotIncoming(newdata: Buffer): void {
    if (logpackets)
      console.log(`whmconn: connection data`, newdata);
    this.incoming = Buffer.concat([this.incoming, newdata]);
    while (this.isComplete()) {
      const len = this.getFirstBufferLength();
      const message = this.incoming.subarray(0, len);
      this.incoming = this.incoming.subarray(len);

      const data = parseRPC(message);
      this.emit("data", data);
    }
  }

  send(value: WHMRequest) {
    if (this.socket.destroyed)
      throw new Error(`socket was already closed`);

    if (!this.socket.write(createRPC(value))) {
      // Ensure all data gets out, unref on drain event
      this.writeref = this.getRef();
    }
  }

  close() {
    this.socket.destroy();
    for (const ref of this.refs)
      ref.close();
    this.refs.clear();
  }

  getRef(): Reference {
    /** Re-adding a reference to the socket doesn't seem to work. Taking a very long-running timer instead */
    const cb = this.socket.destroyed ? null : setTimeout(() => false, 2000000000);
    const ref = new Reference(() => {
      if (cb)
        clearTimeout(cb);
    });
    this.refs.add(ref);
    return ref;
  }
}
