import * as net from "net";
import EventSource from "../eventsource";
import { RefTracker, type RefLock } from "./refs";
import { parseRPC, createRPC } from "./whmanager_rpc";
import type { WHMResponse, WHMRequest } from "./whmanager_rpcdefs";
import * as envbackend from "@webhare/env/src/envbackend";

export * from "./whmanager_rpcdefs";

const logpackets = envbackend.debugFlags.ipcpackets;

type WHManagerConnectionEvents = {
  data: WHMResponse;
  offline: void;
  online: void;
  ref: void;
  unref: void;
};

export type WHManagerConnectionRefLock = RefLock;

export class WHManagerConnection extends EventSource<WHManagerConnectionEvents> {
  private connecting = false;
  private connected = false;
  private backoff_ms = 1;
  private socket: net.Socket;
  private incoming: Buffer = Buffer.from("");
  private writeref?: RefLock;
  private refs;

  constructor() {
    super();
    this.socket = new net.Socket({ allowHalfOpen: false });
    this.socket.setNoDelay(true);
    this.socket.on("connect", () => this.gotConnection());
    this.socket.on("data", (data) => this.gotIncoming(data));
    this.socket.on("drain", () => {
      if (this.writeref)
        this.writeref.release();
      this.writeref = undefined;
    });
    this.socket.on("end", () => this.gotConnectionEnd());
    this.socket.on("close", () => this.gotConnectionClose());
    this.socket.on("error", () => void this.gotConnectionError());
    this.refs = new RefTracker(this.socket, { initialref: false });
    this.refs.on("ref", () => this.emit("ref", void (0)));
    this.refs.on("unref", () => this.emit("unref", void (0)));
    void this.connect(); // no need to await on connection here
  }

  get online(): boolean {
    return this.connected;
  }

  async connect() {
    if (this.connecting || this.connected)
      return;

    this.connecting = true;
    if (this.backoff_ms > 1) {
      if (logpackets)
        console.log(`whmconn: wait for connection backoff, ${this.backoff_ms}ms`);
      await new Promise(resolve => {
        setTimeout(resolve, this.backoff_ms).unref();
      });
    }

    if (logpackets)
      console.log(`whmconn: start connecting`);
    const whmanager_port = parseInt(process.env["WEBHARE_BASEPORT"] || "") + 2;
    this.socket.connect(whmanager_port, "127.0.0.1");
    this.socket.unref();
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
    if (!this.connecting)
      void this.connect();
  }

  async gotConnectionError() {
    this.backoff_ms = Math.min(this.backoff_ms * 2, 10000);
    this.connecting = false;
    if (logpackets)
      console.log(`whmconn: connection error`);
    // wait for backoff, but don't keep node process running for it
    if (!this.connecting)
      void this.connect();
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

  send(value: WHMRequest): void {
    if (this.socket.destroyed)
      throw new Error(`socket was already closed`);

    if (!this.socket.write(createRPC(value)) && !this.writeref) {
      // Ensure all data gets out, unref on drain event
      this.writeref = this.refs.getLock();
    }
  }

  close(): void {
    this.socket.destroy();
  }

  getRef(): WHManagerConnectionRefLock {
    return this.refs.getLock();
  }
}
