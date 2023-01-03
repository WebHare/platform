//import { MessageChannel, MessagePort } from 'node:worker_threads';
import EventSource from "../eventsource";
import { createDeferred, DeferredPromise } from "../tools";
import { readMarshalPacket, writeMarshalPacket, IPCMarshallableRecord } from './hsmarshalling';
import * as stacktrace_parser from "stacktrace-parser";
import { TypedMessagePort, createTypedMessageChannel } from './transport';


const logmessages = false;

function getStructuredTrace(e: Error) {
  if (!e.stack)
    return [];

  const trace = stacktrace_parser.parse(e.stack);
  return trace.map(i => ({ filename: i.file || "", line: i.lineNumber || 1, col: i.column || 1, func: (i.methodName || "") }));
}

/** Format of a message containing an exception */
export type IPCExceptionMessage = {
  __exception: {
    type: string;
    what: string;
    trace?: Array<{ filename: string; line: number; col: number; func: string }>;
  };
};

interface IPCMessagePacket<T> {
  msgid: bigint;
  replyto: bigint;
  message: T | IPCExceptionMessage;
}

type IPCEndPointEvents<T> = {
  message: IPCMessagePacket<T>;
  close: undefined;
};

export interface IPCEndPoint<SendType extends object | null = IPCMarshallableRecord, ReceiveType extends object | null = IPCMarshallableRecord> extends EventSource<IPCEndPointEvents<ReceiveType>> {
  /** Indicator if closed */
  get closed(): boolean;

  /** Activates the link. After this call, message events will be emitted. For connecting links, the
      call returns when the accepting side also has called activate().
  */
  activate(): Promise<void>;

  /** Closes the link. */
  close(): void;

  /** Sends a message to the other endpoint
      @param message - Message to send
      @param replyto - When this message is a reply to another message, set to the msgid of the original message.
  */
  send(message: SendType, replyto?: bigint): bigint;

  /** Sends an exception to the other endpoint. The exception is encoded in a normal message, use parseExceptions
      to decode them when receiving messages.
      @param message - Message to send
      @param replyto - When this message is a reply to another message, set to the msgid of the original message.
  */
  sendException(e: Error, replyto: bigint): void;

  /** Sends a message to the other endpoint, waits for the reply
      @param message - Message to send
      @returns Contents of the reply, or an exception when the link was closed before a reply was received. Exceptions
        are parsed automatically.
  */
  doRequest(message: SendType): Promise<unknown>;

  /** Parse a message for exceptions. Throws the exception of the message contains an exception.
      @param message - Message to parse
      @returns Message, or throws an exception when the message contains one.
  */
  parseExceptions(message: ReceiveType | IPCExceptionMessage): ReceiveType;
}

export enum IPCEndPointImplControlMessageType {
  Close,
  Message,
  ConnectResult
}

/** Format of MessagePort messages received by an IPCEndPointImpl */
export type IPCEndPointImplControlMessage = {
  type: IPCEndPointImplControlMessageType.Close;
} | {
  type: IPCEndPointImplControlMessageType.Message;
  msgid: bigint;
  replyto: bigint;
  buffer: ArrayBuffer;
} | {
  type: IPCEndPointImplControlMessageType.ConnectResult;
  success: boolean;
};

export class IPCEndPointImpl<SendType extends object | null, ReceiveType extends object | null> extends EventSource<IPCEndPointEvents<ReceiveType>> implements IPCEndPoint<SendType, ReceiveType> {
  /** Counter for message id generation */
  private msgidcounter = BigInt(0);

  /** Message port for communicating with the other side */
  private port: TypedMessagePort<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>;

  /** Queue for control messages, set when link hasn't been enabled yet */
  private queue: IPCEndPointImplControlMessage[] | null = [];

  /** List of pending requests */
  private requests = new Map<bigint, DeferredPromise<unknown>>;

  /** Indicator if closed */
  closed = false;

  /** True when already busy emitting events after activation */
  private emitting = false;

  /** Link init mode
      - "direct": Both endpoints immediately
      - "connecting": This endpoint initiated the connection (was connecting when created)
      - "accepting": This endpoint accepted the connection (was accepting the connection when created)
   */
  private mode;

  /** Defer used to wait for connection results */
  private defer?: DeferredPromise<void>;

  constructor(port: TypedMessagePort<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>, mode: "direct" | "connecting" | "accepting") {
    super();
    this.port = port;
    this.mode = mode;
    this.port.on("message", (message) => this.handleControlMessage(message));
    this.port.on("close", () => { this.handleControlMessage({ type: IPCEndPointImplControlMessageType.Close }); });

    // If this is a link created by 'connect', init a defer that waits on the connection resukt
    if (mode == "connecting")
      this.defer = createDeferred<void>();
  }

  handleControlMessage(ctrlmsg: IPCEndPointImplControlMessage, isqueueitem?: boolean) {
    if (logmessages)
      console.log(`link ctrl msg`, { ...ctrlmsg, type: IPCEndPointImplControlMessageType[ctrlmsg.type] }, { isqueueitem });
    if (this.closed)
      return;
    // handle connectresult immediately, don't let it go through the queue
    if (this.queue && !isqueueitem && ctrlmsg.type != IPCEndPointImplControlMessageType.ConnectResult) {
      this.queue.push(ctrlmsg);
      if (logmessages)
        console.log(` queued`);
    } else {
      switch (ctrlmsg.type) {
        case IPCEndPointImplControlMessageType.ConnectResult: {
          if (ctrlmsg.success)
            this.defer?.resolve();
          else
            this.close();
        } break;
        case IPCEndPointImplControlMessageType.Message: {
          const message = readMarshalPacket(Buffer.from(ctrlmsg.buffer));
          if (typeof message != "object")
            return;
          const req = ctrlmsg.replyto && this.requests.get(ctrlmsg.replyto);
          if (req) {
            this.requests.delete(ctrlmsg.replyto);
            req.resolve(new Promise(resolve => resolve(this.parseExceptions(message as ReceiveType | IPCExceptionMessage))));
          }
          this.emit("message", { msgid: ctrlmsg.msgid, replyto: ctrlmsg.replyto, message: message as ReceiveType | IPCExceptionMessage });
        } break;
        case IPCEndPointImplControlMessageType.Close: {
          this.close();
        } break;
      }
    }
  }

  async activate(): Promise<void> {
    // send back a message that the link has been accepted (and messages will be received)
    if (this.mode == "accepting")
      this.port.postMessage({ type: IPCEndPointImplControlMessageType.ConnectResult, success: true });
    else if (this.mode == "connecting") {
      await this.defer?.promise;
    }
    Promise.resolve(true).then(() => this.emitQueue());
  }

  emitQueue() {
    if (logmessages)
      console.log(` emitQueue`, this.emitting, this.queue);
    if (this.emitting || !this.queue)
      return;
    this.emitting = true;
    for (const ctrlmsg of this.queue)
      this.handleControlMessage(ctrlmsg, true);
    this.queue = null;
  }

  close() {
    if (this.closed)
      return;
    this.port.close();
    this.closed = true;
    this.queue = null;
    this.emit("close", undefined);

    for (const [, { reject }] of this.requests)
      reject(new Error(`Request is cancelled, link was closed`));
    this.defer?.reject(new Error(`Could not connect to remote port`));
  }

  send(message: SendType, replyto?: bigint): bigint {
    return this.sendInternal(message, replyto);
  }

  sendInternal(message: SendType | IPCExceptionMessage, replyto?: bigint): bigint {
    if (this.closed)
      throw new Error(`IPC link has already been closed`);
    const msgid = ++this.msgidcounter;
    const packet = writeMarshalPacket(message);
    // Copy the packet data into a new ArrayBuffer we can transfer over the MessagePort
    const buffer = packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength);
    this.port.postMessage({
      type: IPCEndPointImplControlMessageType.Message,
      msgid,
      replyto: replyto ?? BigInt(0),
      buffer
    }, [buffer]);
    return msgid;
  }

  sendException(e: Error, replyto: bigint): void {
    const message: IPCExceptionMessage = {
      __exception: {
        type: "exception",
        what: e.message,
        trace: getStructuredTrace(e)
      }
    };
    this.sendInternal(message, replyto);
  }

  doRequest(message: SendType): Promise<unknown> {
    const msgid = this.send(message);
    const defer = createDeferred<unknown>();
    this.requests.set(msgid, defer);
    return defer.promise;
  }

  parseExceptions(message: ReceiveType | IPCExceptionMessage): ReceiveType {
    if (typeof message == "object" && message && "__exception" in message) {
      const exceptionmessage = message as IPCExceptionMessage;
      throw new Error(exceptionmessage.__exception.what);
    }
    return message;
  }
}

export enum IPCPortControlMessageType {
  RegisterResult,
  IncomingLink
}

export type IPCPortControlMessage = {
  type: IPCPortControlMessageType.RegisterResult;
  success: boolean;
} | {
  type: IPCPortControlMessageType.IncomingLink;
  port: TypedMessagePort<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>;
};

type IPCPortEvents<SendType extends object | null, ReceiveType extends object | null> = {
  accept: IPCEndPoint<SendType, ReceiveType>;
};

export interface IPCPort<SendType extends object | null = IPCMarshallableRecord, ReceiveType extends object | null = IPCMarshallableRecord> extends EventSource<IPCPortEvents<SendType, ReceiveType>> {
  /** Name of the port */
  get name(): string;

  /** Whether the port has been closed */
  get closed(): boolean;

  /** Activates event handling of the port. After this call, 'accept' events will be fired */
  activate(): Promise<void>;

  /** Closes the port */
  close(): void;
}

export class IPCPortImpl<SendType extends object | null, ReceiveType extends object | null> extends EventSource<IPCPortEvents<SendType, ReceiveType>> implements IPCPort<SendType, ReceiveType> {
  name: string;
  port: TypedMessagePort<never, IPCPortControlMessage>;
  defer = createDeferred<void>();
  queue: Array<IPCEndPointImpl<SendType, ReceiveType>> | null = [];
  closed = false;
  emitting = false;

  constructor(name: string, port: TypedMessagePort<never, IPCPortControlMessage>) {
    super();
    this.name = name;
    this.port = port;
    this.port.on("message", (message) => this.handleControlMessage(message));
  }

  handleControlMessage(ctrlmsg: IPCPortControlMessage) {
    if (logmessages)
      console.log(`port ${this.name} ctrl msg`, { ...ctrlmsg, type: IPCPortControlMessageType[ctrlmsg.type] });
    switch (ctrlmsg.type) {
      case IPCPortControlMessageType.RegisterResult: {
        if (ctrlmsg.success)
          this.defer.resolve();
        else
          this.defer.reject(new Error(`Port name ${JSON.stringify(this.name)} was already registered`));
      } break;
      case IPCPortControlMessageType.IncomingLink: {
        const link = new IPCEndPointImpl<SendType, ReceiveType>(ctrlmsg.port, "accepting");
        this.handleItem(link);
      } break;
    }
  }

  async activate() {
    await this.defer.promise;
    Promise.resolve(true).then(() => this.emitQueue());
  }

  emitQueue() {
    if (this.emitting || !this.queue)
      return;
    this.emitting = true;
    for (const link of this.queue)
      this.handleItem(link, true);
    this.queue = null;
  }

  handleItem(link: IPCEndPointImpl<SendType, ReceiveType>, isqueueitem?: boolean) {
    if (!this.closed) {
      if (this.queue && !isqueueitem) {
        if (logmessages)
          console.log(` queued`);
        this.queue.push(link);
      } else {
        this.emit("accept", link);
      }
    } else {
      // Auto-close links that won't be received anymore
      link.close();
    }
  }

  close() {
    this.port.close();
    this.closed = true;
    this.emitQueue();
  }
}

/** Creates an IPC link pair
    @typeParam ReceiveType - the type of messages the first endpoint can send, and the second endpoint can receive
    @typeParam SendType - the type of messages the second endpoint can send, and the first endpoint can receive
*/
export function createIPCEndPointPair<SendType extends object | null = IPCMarshallableRecord, ReceiveType extends object | null = IPCMarshallableRecord>(): [IPCEndPoint<SendType, ReceiveType>, IPCEndPoint<ReceiveType, SendType>] {
  const { port1, port2 } = createTypedMessageChannel<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>();
  return [new IPCEndPointImpl(port1, "direct"), new IPCEndPointImpl(port2, "direct")];
}
