import EventSource from "../eventsource";
import { readMarshalPacket, writeMarshalPacket, type IPCMarshallableRecord } from './hsmarshalling';
import { type TypedMessagePort, createTypedMessageChannel, registerTransferredPort, bufferToArrayBuffer } from './transport';
import { RefTracker } from "./refs";
import { generateRandomId } from "@webhare/std";
import * as envbackend from "@webhare/env/src/envbackend";
import { type MessagePort, receiveMessageOnPort, type TransferListItem } from 'node:worker_threads';
import { type StackTrace, parseTrace } from "@webhare/js-api-tools";

export type IPCEncodedException = {
  type: string;
  what: string;
  trace?: StackTrace;
};

/** Format of a message containing an exception */
export type IPCExceptionMessage = {
  __exception: IPCEncodedException;
};

/** Custom omit mapper, with TypeScript Omit causes switch type narrowing for the default case doesn't work */
type OmitResponseKey<T> = {
  [Key in keyof T as Key extends "__responseKey" ? never : Key]: T[Key];
} | never;

export interface IPCMessagePacket<ReceiveType extends object | null = IPCMarshallableRecord> {
  msgid: bigint;
  replyto: bigint;
  message: OmitResponseKey<ReceiveType>;
}

type IPCEndPointEvents<ReceiveType extends object | null> = {
  message: IPCMessagePacket<ReceiveType>;
  exception: IPCMessagePacket<IPCExceptionMessage>;
  close: undefined;
};

export type EncodedIPCLinkEndPoint = {
  type: "$IPCEndPoint";
  port: MessagePort;
  id: string;
  mode: "direct" | "connecting" | "accepting";
};

type CalcResponseType<SendType, ReceiveType, T extends OmitResponseKey<SendType>> = OmitResponseKey<SendType & T extends { __responseKey: object }
  ? ReceiveType & (SendType & T)["__responseKey"]
  : ReceiveType>;

export interface IPCEndPoint<SendType extends object | null = IPCMarshallableRecord, ReceiveType extends object | null = IPCMarshallableRecord> extends EventSource<IPCEndPointEvents<ReceiveType>>, Disposable {
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
  send(message: OmitResponseKey<SendType>, replyto?: bigint): bigint;

  /** Sends an exception to the other endpoint. The exception is encoded in a normal message, use parseExceptions
      to decode them when receiving messages.
      @param message - Message to send
      @param replyto - When this message is a reply to another message, set to the msgid of the original message.
  */
  sendException(e: Error | unknown, replyto: bigint): void;

  /** Sends a message to the other endpoint, waits for the reply
      @param message - Message to send
      @param signal - Abort signal to cancel the request
      @returns Contents of the reply, or an exception when the link was closed before a reply was received. Exceptions
        are parsed automatically and used to reject the returned promise.
  */
  doRequest<T extends OmitResponseKey<SendType>>(message: T, options?: { signal?: AbortSignal }): Promise<CalcResponseType<SendType, ReceiveType, T>>;

  /** Parse a message for exceptions. Throws the exception of the message contains an exception.
      @param message - Message to parse
      @returns Message, or throws an exception when the message contains one.
  */
  parseExceptions(message: ReceiveType | IPCExceptionMessage): ReceiveType;

  /** Drop the reference on this endpoint, so the node process won't keep running when this endpoint hasn't been closed yet */
  dropReference(): void;

  /** Synchronously checks for events and emits them */
  checkForEventsSync(): void;

  /** Encode for transfer to another worker */
  encodeForTransfer(): {
    encoded: EncodedIPCLinkEndPoint;
    transferList: TransferListItem[];
  };
}

export enum IPCEndPointImplControlMessageType {
  Message,
  ConnectResult
}

/** Format of MessagePort messages received by an IPCEndPointImpl */
export type IPCEndPointImplControlMessage = {
  type: IPCEndPointImplControlMessageType.Message;
  msgid: bigint;
  replyto: bigint;
  buffer: ArrayBuffer;
} | {
  type: IPCEndPointImplControlMessageType.ConnectResult;
  success: boolean;
};

export class IPCEndPointImpl<SendType extends object | null, ReceiveType extends object | null> extends EventSource<IPCEndPointEvents<ReceiveType>> implements IPCEndPoint<SendType, ReceiveType>, Disposable {
  /** id for logging */
  private id: string;

  /** Counter for message id generation */
  private msgidcounter = BigInt(0);

  /** Message port for communicating with the other side */
  private port: TypedMessagePort<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>;

  /** Queue for control messages, set when link hasn't been enabled yet */
  private queue: IPCEndPointImplControlMessage[] | null = [];

  /** List of pending requests */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- needed because requests can all have different response types
  private requests = new Map<bigint, PromiseWithResolvers<any>>;

  /** Indicator if closed */
  closed = false;

  /** True when already busy emitting events after activation */
  private emitting = false;

  /** Link init mode
      - "direct": Both endpoints immediately
      - "connecting": This endpoint initiated the connection (was connecting when created)
      - "accepting": This endpoint accepted the connection (was accepting the connection when created)
   */
  private mode: "direct" | "connecting" | "accepting";

  /** Defer used to wait for connection results */
  private defer?: PromiseWithResolvers<void>;

  /** Set to true when connected (defer.promise has been resolved, not rejected) */
  private connected = false;

  /** Set to true when connected (defer.promise has been resolved, not rejected) */
  private activationStarted = false;

  /** Reference tracker
  */
  private refs: RefTracker;

  /// Port this link is connecting to (for mode === connecting)
  private connectporttitle?: string;

  constructor(id: string, port: TypedMessagePort<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>, mode: "direct" | "connecting" | "accepting", connectporttitle?: string) {
    super();
    this.id = id;
    this.port = port;
    this.mode = mode;
    this.connectporttitle = connectporttitle;
    this.port.on("message", (message) => this.handleControlMessage(message));
    this.port.on("close", () => this.close());
    this.refs = new RefTracker(this.port, { initialref: true });

    // If this is a link created by 'connect', init a defer that waits on the connection result
    if (mode === "connecting")
      this.defer = Promise.withResolvers<void>();
  }

  checkForEventsSync(): void {
    if (this.closed)
      return;
    let res = receiveMessageOnPort(this.port as MessagePort);
    if (res && this.handleControlMessage(res.message)) {
      // Received connectresult, try again to see if a message is pending

      // synchronously start emitting queued events
      if (this.activationStarted && this.connected && !this.emitting)
        this.emitQueue();

      res = receiveMessageOnPort(this.port as MessagePort);
      if (res)
        this.handleControlMessage(res.message);
    }
  }

  handleControlMessage(ctrlmsg: IPCEndPointImplControlMessage, isqueueitem?: boolean): boolean {
    if (envbackend.debugFlags.ipc) {
      const tolog = ctrlmsg.type === IPCEndPointImplControlMessageType.Message
        ? { ...ctrlmsg, type: IPCEndPointImplControlMessageType[ctrlmsg.type], buffer: readMarshalPacket(Buffer.from(ctrlmsg.buffer)) }
        : { ...ctrlmsg, type: IPCEndPointImplControlMessageType[ctrlmsg.type] };
      console.log(`ipclink ${this.id} received ctrl msg`, tolog, { isqueueitem });
    }
    if (this.closed)
      return false;
    // handle connectresult immediately, don't let it go through the queue
    if (this.queue && !isqueueitem && ctrlmsg.type !== IPCEndPointImplControlMessageType.ConnectResult) {
      this.queue.push(ctrlmsg);
      if (envbackend.debugFlags.ipc)
        console.log(` queued`);
    } else {
      switch (ctrlmsg.type) {
        case IPCEndPointImplControlMessageType.ConnectResult: {
          if (ctrlmsg.success) {
            this.defer?.resolve();
            this.connected = true;
            return true;
          } else {
            this.defer?.reject(new Error(`Could not connect to ${this.connectporttitle}`));
            this.close();
          }
        } break;
        case IPCEndPointImplControlMessageType.Message: {
          const message = readMarshalPacket(Buffer.from(ctrlmsg.buffer));
          if (typeof message !== "object")
            return false;

          const req = ctrlmsg.replyto && this.requests.get(ctrlmsg.replyto);
          if (req) {
            this.requests.delete(ctrlmsg.replyto);
            try {
              req.resolve(this.parseExceptions(message as ReceiveType | IPCExceptionMessage));
            } catch (e) {
              req.reject(e as Error);
            }
            return false;
          }
          if (message && "__exception" in message)
            this.emit("exception", { msgid: ctrlmsg.msgid, replyto: ctrlmsg.replyto, message: message as IPCExceptionMessage });
          else
            this.emit("message", { msgid: ctrlmsg.msgid, replyto: ctrlmsg.replyto, message: message as OmitResponseKey<ReceiveType> });
        } break;
      }
    }
    return false;
  }

  async activate(): Promise<void> {
    const startedActivation = this.activationStarted;
    this.activationStarted = true;
    // send back a message that the link has been accepted (and messages will be received)
    if (this.mode === "accepting") {
      // only send connectresult on first activate() call
      if (!startedActivation)
        this.sendPortMessage({ type: IPCEndPointImplControlMessageType.ConnectResult, success: true });
    } else if (this.mode === "connecting") {
      try {
        await this.defer?.promise;
      } catch (e) {
        // re-throw the error so the stack trace points to the invocation of activate()
        throw new Error((e as Error).message);
      }
    }
    void Promise.resolve(true).then(() => this.emitQueue());
  }

  emitQueue() {
    if (envbackend.debugFlags.ipc)
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

    if (envbackend.debugFlags.ipc) {
      console.log(`ipclink ${this.id} closed`);
    }

    this.port.close();
    this.closed = true;
    this.queue = null;
    this.emit("close", undefined);

    for (const [, { reject }] of this.requests)
      reject(new DOMException(`Request is cancelled, link was closed`, "AbortError"));
    this.defer?.reject(new Error(`Could not connect to ${this.connectporttitle}`));
  }

  [Symbol.dispose]() {
    this.close();
  }

  sendPortMessage(msg: IPCEndPointImplControlMessage, transferlist?: ArrayBuffer[]) {
    if (envbackend.debugFlags.ipc) {
      const tolog = msg.type === IPCEndPointImplControlMessageType.Message
        ? { ...msg, type: IPCEndPointImplControlMessageType[msg.type], buffer: readMarshalPacket(msg.buffer) }
        : { ...msg, type: IPCEndPointImplControlMessageType[msg.type] };
      console.log(`ipclink ${this.id} sends ctrl msg`, tolog);
    }
    this.port.postMessage(msg, transferlist);
  }

  send(message: OmitResponseKey<SendType>, replyto?: bigint): bigint {
    return this.sendInternal(message, replyto);
  }

  sendInternal(message: OmitResponseKey<SendType> | IPCExceptionMessage, replyto?: bigint): bigint {
    if (this.closed)
      return BigInt(0);
    const msgid = ++this.msgidcounter;
    const packet = writeMarshalPacket(message);
    // Copy the packet data into a new ArrayBuffer we can transfer over the MessagePort
    const buffer = bufferToArrayBuffer(packet);
    this.sendPortMessage({
      type: IPCEndPointImplControlMessageType.Message,
      msgid,
      replyto: replyto ?? BigInt(0),
      buffer
    }, [buffer]);
    return msgid;
  }

  sendException(e: Error | unknown, replyto: bigint): void {
    this.sendInternal(encodeIPCException(e), replyto);
  }

  async doRequest<T extends OmitResponseKey<SendType>>(message: T, options?: { signal?: AbortSignal }): Promise<CalcResponseType<SendType, ReceiveType, T>> {
    if (this.closed)
      throw new Error(`IPC link has already been closed`);
    const msgid = this.send(message);
    const defer = Promise.withResolvers<CalcResponseType<SendType, ReceiveType, T>>();
    this.requests.set(msgid, defer);
    const error = new Error(); //FIXME avoid generating a stack trace for every request!  this should be eg behind a debug flag
    const lock = this.refs.getLock("request");
    try {
      if (options?.signal)
        options.signal.addEventListener("abort", () => defer.reject(new Error("Aborted")));
      return await defer.promise;
    } catch (e) {
      // re-throw the error so the stack trace points to the invocation of activate()
      error.message = (e as Error).message;
      error.cause = e;
      throw error;
    } finally {
      lock.release();
    }
  }

  parseExceptions(message: ReceiveType | IPCExceptionMessage): ReceiveType {
    if (typeof message === "object" && message && "__exception" in message) {
      const exceptionmessage = message as IPCExceptionMessage;
      const error = new Error(exceptionmessage.__exception.what);
      const trace = exceptionmessage.__exception.trace?.map(item =>
        `\n    at ${item.func ?? "unknown"} (${item.filename}:${item.line}:${item.col})`) ?? [];
      error.stack = exceptionmessage.__exception.what + trace;
      throw error;
    }
    return message;
  }

  dropReference() {
    this.refs.dropInitialReference();
  }

  encodeForTransfer(): {
    encoded: {
      type: "$IPCEndPoint";
      port: MessagePort;
      id: string;
      mode: "direct" | "connecting" | "accepting";
    };
    transferList: TransferListItem[];
  } {
    if (this.emitting || this.closed || this.queue?.length || this.requests.size)
      throw new Error(`IPC endpoint is not in a transferrable state (closed or already emitting events)`);
    return {
      encoded: {
        type: "$IPCEndPoint",
        port: this.port as MessagePort,
        id: this.id,
        mode: this.mode,
      },
      transferList: [this.port as MessagePort]
    };
  }

  static decodeFromTransfer<SendType extends object | null, ReceiveType extends object | null>(data: unknown): IPCEndPointImpl<SendType, ReceiveType> {
    const decoded = data as ReturnType<IPCEndPointImpl<SendType, ReceiveType>["encodeForTransfer"]>["encoded"];
    if (decoded.type !== "$IPCEndPoint")
      throw new Error(`Data does not describe a valid IPC endpoint`);
    registerTransferredPort(decoded.port, decoded.id);
    return new IPCEndPointImpl(decoded.id, decoded.port, decoded.mode);
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
  id: string;
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

  /** Drop the reference on this port, so the node process won't keep running when this port hasn't been closed yet */
  dropReference(): void;

  /** Synchronously checks for events and emits them */
  checkForEventsSync(): void;
}

export class IPCPortImpl<SendType extends object | null, ReceiveType extends object | null> extends EventSource<IPCPortEvents<SendType, ReceiveType>> implements IPCPort<SendType, ReceiveType> {
  name: string;
  port: TypedMessagePort<never, IPCPortControlMessage>;
  defer = Promise.withResolvers<void>();
  queue: Array<IPCEndPointImpl<SendType, ReceiveType>> | null = [];
  closed = false;
  emitting = false;
  refs: RefTracker;

  constructor(name: string, port: TypedMessagePort<never, IPCPortControlMessage>) {
    super();
    this.name = name;
    this.port = port;
    this.port.on("message", (message) => this.handleControlMessage(message));
    this.refs = new RefTracker(this.port, { initialref: true });
  }

  checkForEventsSync(): void {
    if (this.closed)
      return;
    const res = receiveMessageOnPort(this.port as MessagePort);
    if (res)
      this.handleControlMessage(res.message);
  }

  handleControlMessage(ctrlmsg: IPCPortControlMessage) {
    if (envbackend.debugFlags.ipc)
      console.log(`port ${this.name} ctrl msg`, { ...ctrlmsg, type: IPCPortControlMessageType[ctrlmsg.type] });
    switch (ctrlmsg.type) {
      case IPCPortControlMessageType.RegisterResult: {
        if (ctrlmsg.success)
          this.defer.resolve();
        else
          this.defer.reject(new Error(`Port name ${JSON.stringify(this.name)} was already registered`));
      } break;
      case IPCPortControlMessageType.IncomingLink: {
        const link = new IPCEndPointImpl<SendType, ReceiveType>(ctrlmsg.id, ctrlmsg.port, "accepting");
        registerTransferredPort(ctrlmsg.port, ctrlmsg.id);
        this.handleItem(link);
      } break;
    }
  }

  async activate() {
    try {
      await this.defer.promise;
      void Promise.resolve(true).then(() => this.emitQueue());
    } catch (e) {
      // re-throw the error so the stack trace points to the invocation of activate()
      throw new Error((e as Error).message);
    }
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
        if (envbackend.debugFlags.ipc)
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

  /** Drop the reference on this port, so the node process won't keep running when this port hasn't been closed yet */
  dropReference(): void {
    this.refs.dropInitialReference();
  }
}

/** Creates an IPC link pair
    @typeParam LinkType - IPC
    @typeParam SendType - the type of messages the second endpoint can send, and the first endpoint can receive
*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createIPCEndPointPair<LinkType extends IPCLinkType<any, any> = IPCLinkType>(title = "IPCEndpointPair"): [LinkType["ConnectEndPoint"], LinkType["AcceptEndPoint"]] {
  const id = generateRandomId();
  const { port1, port2 } = createTypedMessageChannel<IPCEndPointImplControlMessage, IPCEndPointImplControlMessage>(`${title} ${id}`);
  return [new IPCEndPointImpl(`${id} - port1`, port1, "direct"), new IPCEndPointImpl(`${id} - port2`, port2, "direct")];
}

export function encodeIPCException(error: Error | unknown): IPCExceptionMessage {
  //convert it to a real error object with a trace (eg deal with 'throw 1')
  const toThrow = error instanceof Error ? error : new Error(String(error));
  return {
    __exception: {
      type: "exception",
      what: toThrow.message,
      trace: parseTrace(toThrow)
    }
  };
}

export function decodeTransferredIPCEndPoint<SendType extends object | null, ReceiveType extends object | null>(data: unknown): IPCEndPoint<SendType, ReceiveType> {
  return IPCEndPointImpl.decodeFromTransfer<SendType, ReceiveType>(data);
}

export function parseIPCException(message: IPCExceptionMessage): Error {
  const exceptionmessage = message;
  const error = new Error(exceptionmessage.__exception.what);
  const trace = exceptionmessage.__exception.trace?.map(item =>
    `\n    at ${item.func ?? "unknown"} (${item.filename}:${item.line}:${item.col})`) ?? [];
  error.stack = exceptionmessage.__exception.what + trace.join("");
  return error;
}

/** Describes an IPC link configuration, contains all needed type. Use as
 * ```
 * type MyLinkType = IPCLinkType< RequestType, ResponseType >;
 * bridge.createPort< MyLinkType >(); // type: MyLinkType["Port"]
 * function onBridgeLink(link: MyLinkType["AcceptEndPoint"])
 * function onBridgePacket(packet: MyLinkType["AcceptEndPointPacket"])
 * bridge.connect< MyLinkType >(); // type: MyLinkType["ConnectEndPoint"]
 * function onConnectPacket(link: MyLinkType["ConnectEndPointPacket"])
 * ```
 * You can directly specify the expected response for a request as follows:
 * ```
 * type RequestType = {
 *   type: "request";
 *   data: "string";
 *   __responseKey: { type: "response" };
 * };
 * type ResponseType = {
 *   type: "response";
 *   data: "string";
 * };
 * ```
 * @typeParam RequestType - The type of the data that the connecting side of the link will send (and the accepting side will receive). Use __responseKey in a
 * request type to specify the keys of the response (copy the keys of the response into the object)
 * @typeParam ResponseType - The type of the data the accepting side of the link (the one accepting links with a port) will send (and the connecting
 * side will receive)
 */
export type IPCLinkType<RequestType extends object | null = IPCMarshallableRecord, ResponseType extends object | null = IPCMarshallableRecord> = {
  AcceptEndPoint: IPCEndPoint<ResponseType, RequestType>;
  AcceptEndPointPacket: IPCMessagePacket<RequestType>;
  AcceptEndPointMessageType: RequestType;
  ConnectEndPoint: IPCEndPoint<RequestType, ResponseType>;
  ConnectEndPointPacket: IPCMessagePacket<ResponseType>;
  ConnectEndPointMessageType: ResponseType;
  ExceptionPacket: IPCMessagePacket<IPCExceptionMessage>;
  Port: IPCPort<ResponseType, RequestType>;
};
