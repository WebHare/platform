import { debugFlags } from "@webhare/env";
import { attempt, parseTyped, stringify } from "@webhare/std";
import type { Socket } from "node:net";
import type { ServiceEventMessage } from "../types";

export function getSocketsBaseDir(serviceManagerId?: string): string | null {
  serviceManagerId ||= process.env.WEBHARE_SERVICEMANAGERID;
  if (!serviceManagerId)
    return null;

  //socket paths need to be short, so we need a /tmp/ subpoath
  return `/tmp/whsock.${serviceManagerId}/`;
}

export type USLMethodCall = {
  id: number;
  method: string;
  args?: unknown[];
};
export type USLMethodResponse = {
  id: number;
  result?: unknown;
  error?: string; //TODO traces!
};


type USLProtocol<Client extends boolean> = Client extends true
  ? USLMethodCall
  : USLMethodResponse | ServiceEventMessage;

type USLSendable<Client extends boolean> = USLProtocol<Client>;
type USLReceivable<Client extends boolean> = USLProtocol<Client extends false ? true : false>;

let nextSocketId = 1;

/** Low level typed JSON transport. Used on both sides of a backend service connection */
export abstract class UnixSocketLineBasedConnection<Client extends boolean> {
  #socket: Socket | null;
  #inbuffer = '';
  readonly id = nextSocketId++;

  constructor(socket: Socket) {
    this.#socket = socket;
    this.#socket.on("data", _ => this.#onData(_));
    this.#socket.on("close", _ => this.#onClose(_));
  }

  #onData(data: Buffer) {
    if (debugFlags["ipc-unixsockets"])
      console.log(`[ipc-unixsockets:${this.id}] received: ${data.length} bytes`);

    this.#inbuffer += data.toString('utf8');
    for (; ;) {
      const lfPops = this.#inbuffer.indexOf("\n");
      if (lfPops === -1)
        break;

      const line = this.#inbuffer.slice(0, lfPops);
      this.#inbuffer = this.#inbuffer.slice(lfPops + 1);
      if (debugFlags["ipc-unixsockets"])
        console.log(`[ipc-unixsockets:${this.id}] got line: ${line}`);
      if (line.startsWith('{')) //we only process JSON lines, ignore any other output (eg from subprocesses)
        this.#processLine(line);
      else
        this.fail(`Invalid input line`);
    }
  }
  #onClose(hadError: boolean) {
    if (debugFlags["ipc-unixsockets"])
      console.log(`[ipc-unixsockets:${this.id}] closed, hadError:`, hadError);
    this.processDisconnect();
  }
  #processLine(line: string) {
    const data = attempt(() => parseTyped(line));
    if (data === undefined)
      return this.fail(`Invalid JSON received`);

    void this.processMessage(data);
  }
  fail(message: string) {
    if (!this.#socket)
      return; //already failed

    this.#socket.write(`error:${JSON.stringify({ message })}\n`);
    this.close();
  }
  send(message: USLSendable<Client>) {
    if (debugFlags["ipc-unixsockets"])
      console.log(`[ipc-unixsockets:${this.id}] send:`, message);

    //FIXME what if socket is already closed? assume it'll be handled eventually or reject data outright?
    //TODO if write returns false we should buffer up calls until we receive a drain event.
    this.#socket?.write(stringify(message, { typed: true }) + "\n");
  }

  close() {
    if (debugFlags["ipc-unixsockets"])
      console.log(`[ipc-unixsockets:${this.id}] close() called`);

    this.#socket?.end();
    this.#socket = null;
  }

  ref() {
    this.#socket?.ref();
  }
  unref() {
    this.#socket?.unref();
  }

  abstract processMessage(message: USLReceivable<Client>): void | Promise<void>;
  abstract processDisconnect(): void;
}
