import { RefTracker } from "@mod-system/js/internal/whmanager/refs";
import { type TypedMessagePort, getSingleMessage } from "@mod-system/js/internal/whmanager/transport";
import { describePublicInterface } from "./backendservicerunner";
import type { WebHareServiceDescription } from "@mod-system/js/internal/types";
import { type IPCExceptionMessage, encodeIPCException, parseIPCException } from "@mod-system/js/internal/whmanager/ipc";
import type { TransferListItem } from "node:worker_threads";
import type { ServiceBase } from "./backendservice";
import { localServiceHandlerAddPort } from "./symbols";
export type { ServiceBase } from "./backendservice";

/* Code for node in-process services (over workers threads, using normal messageports and transferLists to communicate)
*/

export class LocalService {
  _gotClose() {
    // called when service is closed
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- needed to accept stuff like (groupid: string) => void
export type LocalConnectionFactory = (...args: any[]) => LocalService | Promise<LocalService>;
export type LocalServiceOptions = { dropListenerReference?: boolean };

export type LocalServiceRequest = {
  type: "init";
  id: number;
  __new: Parameters<LocalConnectionFactory>;
} | {
  type: "callRequest";
  id: number;
  func: string;
  params: unknown[];
};

export type LocalServiceResponse = {
  type: "description";
  id: number;
  description: WebHareServiceDescription;
} | {
  type: "callResponse";
  id: number;
  result: unknown;
} | {
  type: "callError";
  id: number;
  error: IPCExceptionMessage;
};

class LinkState {
  handler: LocalService | null;
  link: TypedMessagePort<LocalServiceResponse, LocalServiceRequest>;
  initDefer = Promise.withResolvers<boolean>();
  ref: RefTracker;

  constructor(handler: LocalService | null, link: TypedMessagePort<LocalServiceResponse, LocalServiceRequest>, unrefLink: boolean) {
    this.handler = handler;
    this.link = link;
    this.ref = new RefTracker(link, { initialref: true });
    if (unrefLink)
      this.ref.dropInitialReference();
  }
}

export class ReturnValueWithTransferList<T> {
  value: T;
  transferList: TransferListItem[];

  constructor(value: T, transferList: TransferListItem[]) {
    this.value = value;
    this.transferList = transferList;
  }
}

export function createReturnValueWithTransferList<T>(value: T, transferList: TransferListItem[]): ReturnValueWithTransferList<T> {
  return new ReturnValueWithTransferList(value, transferList);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- using any is needed for this type definition
type ProxyableFunction = (...a: any[]) => any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- using any is needed for this type definition
type AnyPromise = Promise<any>;

type TransformReturnType<T> = T extends ReturnValueWithTransferList<infer V>
  ? (V extends AnyPromise ? V : Promise<V>)
  : (T extends Promise<ReturnValueWithTransferList<infer V>>
    ? (V extends AnyPromise ? V : Promise<V>)
    : (T extends AnyPromise ? T : Promise<T>));

type PromisifyWorkerFunctionReturnType<T extends ProxyableFunction> = {
  (...a: Parameters<T>): TransformReturnType<ReturnType<T>>;
  callWithTransferList: ((transferList: TransferListItem[], ...a: Parameters<T>) => TransformReturnType<ReturnType<T>>);
};

type ExportedMethods<BackendHandlerType extends object> = keyof {
  [K in Exclude<keyof BackendHandlerType, `_${string}` | "close"> as BackendHandlerType[K] extends ProxyableFunction ? K : never]: boolean
};

/** Converts the interface of a WebHare service to the interface used by a client.
 * Removes the "close" method and all methods starting with `_`, and converts all return types to a promise. Readds "close" as added by ServiceBase
 * @typeParam BackendHandlerType - Type definition of the service class that implements this service.
*/
export type ConvertLocalServiceInterfaceToClientInterface<BackendHandlerType extends object> = {
  [K in ExportedMethods<BackendHandlerType> | "close"]: (K extends "close" ?
    () => void :
    (K extends keyof BackendHandlerType ?
      (BackendHandlerType[K] extends ProxyableFunction ?
        PromisifyWorkerFunctionReturnType<BackendHandlerType[K]> :
        never) :
      never));
} & ServiceBase;

export class LocalServiceHandlerBase {
  private _serviceName: string;
  private _constructor: LocalConnectionFactory;
  private _options: LocalServiceOptions;

  constructor(serviceName: string, constructor: LocalConnectionFactory, options: LocalServiceOptions) {
    this._serviceName = serviceName;
    this._constructor = constructor;
    this._options = options;
  }

  [localServiceHandlerAddPort](link: TypedMessagePort<LocalServiceResponse, LocalServiceRequest>) {
    try {
      const state = new LinkState(null, link, this._options.dropListenerReference ?? false);
      link.on("close", () => this._onClose(state));
      link.on("message", _ => void this._onMessage(state, _));
    } catch (e) {
      link.close();
    }
  }

  _onClose(state: LinkState) {
    state.handler?._gotClose?.();
  }

  async _onMessage(state: LinkState, message: LocalServiceRequest) {
    if (!state.handler) {
      try {
        if (!this._constructor)
          throw new Error("This service does not accept incoming connections");
        if (message.type !== "init")
          throw new Error(`Expected an message with type "init"`);

        const handler = await this._constructor(...message.__new);
        if (!(handler instanceof LocalService))
          throw new Error(`Local service should extends from LocalService`);
        if (!state.handler)
          state.handler = handler;
        if (!state.handler)
          throw new Error(`Service handler initialization failed`);

        state.link.postMessage({ type: "description", id: message.id, description: describePublicInterface(state.handler) });
        state.initDefer.resolve(true);
      } catch (e) {
        state.link.postMessage({ type: "callError", id: message.id, error: encodeIPCException(e as Error) });
        state.link.close();
        state.initDefer.resolve(false);
      }
      return;
    }
    if (message.type !== "callRequest") {
      state.link.postMessage({ type: "callError", id: message.id, error: encodeIPCException(new Error("Duplicate init message")) });
      return;
    }

    if (!await state.initDefer.promise) {
      state.link.postMessage({ type: "callError", id: message?.id, error: encodeIPCException(new Error(`Service has not been properly initialized`)) });
      state.link.close();
      return;
    }

    try {
      const result = await (state.handler as unknown as Record<string, ((...args: unknown[]) => unknown)>)[message.func](...message.params);
      state.link.postMessage({ type: "callResponse", id: message.id, result: result });
    } catch (e) {
      state.link.postMessage({ type: "callError", id: message.id, error: encodeIPCException(e as Error) });
    }
  }

  close() {
  }
}

// Closes the port when the LocalServiceProxy goes out of scope
const portcloser = new FinalizationRegistry((port: TypedMessagePort<object, object>) => {
  port.close();
});

export class LocalServiceProxy<T extends object> implements ProxyHandler<T> {
  port: TypedMessagePort<LocalServiceRequest, LocalServiceResponse>;
  name: string;
  description: WebHareServiceDescription | null;
  refs: RefTracker;
  requests: Record<number, PromiseWithResolvers<LocalServiceResponse>> = {};
  static counter = 0;

  constructor(
    port: TypedMessagePort<LocalServiceRequest, LocalServiceResponse>,
    name: string,
    description: WebHareServiceDescription | null,
    refs: RefTracker,
  ) {
    this.port = port;
    this.name = name;
    this.description = description;
    this.refs = refs;
    /* We're sending a close over the port when this object is garbage collected
    Make sure the port doesn't hold strong references to this object, copy the
    reference to this.requests */
    const requests = this.requests;
    this.port.on("message", (message) => {
      requests[message.id]?.resolve(message);
      delete requests[message.id];
    });
    this.port.on("close", () => {
      for (const defer of Object.values(requests))
        defer.reject(new Error(`Service link to local service ${JSON.stringify(name)} has been closed`));
    });
    // unref the port so it doesn't keep the event loop alive. Do this after adding the message listener, that one will ref() the port
    this.port.unref();
    portcloser.register(this, this.port);
  }

  get(target: object, prop: string, receiver: unknown) {
    if (prop === 'close') //create a close() function
      return () => this.closeService();
    if (!this.description || this.description.methods.find(m => m.name === prop)) {
      const func = (...args: unknown[]) => this.remotingFunc({ name: prop }, args);
      func.callWithTransferList = (transferList: TransferListItem[], ...args: unknown[]) => this.remotingFunc({ name: prop, transferList }, args);
      return func;
    }
    return undefined;
  }

  has(target: object, prop: string): boolean {
    return Boolean(!this.description || this.description.methods.find(m => m.name === prop)) || prop === "close";
  }

  set(target: object, prop: string): boolean {
    throw new Error(`Cannot override service functions, trying to change property ${JSON.stringify(prop)}`);
  }

  ownKeys(target: object) {
    return ["close", ...this.description?.methods.map(method => method.name) ?? []];
  }

  closeService() {
    this.port.close();
  }

  async remotingFunc(method: { name: string; transferList?: TransferListItem[] }, args: unknown[]) {
    const id = ++LocalServiceProxy.counter;
    const deferred = Promise.withResolvers<LocalServiceResponse>();
    this.requests[id] = deferred;
    const lock = this.refs.getLock(`call ${this.name}#${method.name}`);
    try {
      const calldata: LocalServiceRequest = {
        type: "callRequest",
        id,
        func: method.name,
        params: args
      };
      this.port.postMessage(calldata, method.transferList ?? []);
      const result = await deferred.promise;
      if (result.type === "callError")
        throw parseIPCException(result.error);
      else if (result.type === "callResponse")
        return result.result;
      else
        throw new Error(`Got wrong response, type ${result.type}`);
    } finally {
      lock.release();
    }
  }
}

export async function initNewLocalServiceProxy<T extends object>(port: TypedMessagePort<LocalServiceRequest, LocalServiceResponse>, name: string, args: unknown[]): Promise<ConvertLocalServiceInterfaceToClientInterface<T>> {
  port.postMessage({ type: "init", id: 0, __new: args });
  const res = await getSingleMessage(port);
  if (res.type !== "description") {
    if (res.type === "callError")
      throw parseIPCException(res.error);
    throw new Error(`Expected a service description`);
  }
  port.unref();
  const refs = new RefTracker(port);
  return buildLocalServiceProxy<T>(port, name, res.description, refs);
}

export function buildLocalServiceProxy<T extends object>(port: TypedMessagePort<LocalServiceRequest, LocalServiceResponse>, name: string, description: WebHareServiceDescription | null, refs: RefTracker): ConvertLocalServiceInterfaceToClientInterface<T> {
  return new Proxy({}, new LocalServiceProxy<ConvertLocalServiceInterfaceToClientInterface<T>>(
    port,
    name,
    description,
    refs)) as ConvertLocalServiceInterfaceToClientInterface<T>;
}
