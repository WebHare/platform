import { WebHareServiceDescription, WorkerControlLinkRequest, WorkerControlLinkResponse, WorkerServiceLinkRequest, WorkerServiceLinkResponse } from "./types";
import { TypedMessagePort, createTypedMessageChannel, registerTransferredPort } from "./whmanager/transport";
import { parseIPCException } from "./whmanager/ipc";
import { Worker, TransferListItem } from "node:worker_threads";
import { DeferredPromise, createDeferred } from "@webhare/std/promises";
import { RefTracker } from "./whmanager/refs";
import bridge, { initializedWorker } from "./whmanager/bridge";

// Closes the port when the AsyncWorker / WorkerServiceProxy goes out of scope
const portcloser = new FinalizationRegistry((port: TypedMessagePort<object, object>) => {
  port.close();
});

let counter = 0;

type FunctionRef = string | {
  ref: string;
  transferList?: TransferListItem[];
};


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

export type ExportedMethods<BackendHandlerType extends object> = keyof {
  [K in Exclude<keyof BackendHandlerType, `_${string}` | "close"> as BackendHandlerType[K] extends ProxyableFunction ? K : never]: boolean
};

/** Converts the interface of a WebHare service to the interface used by a client.
 * Removes the "close" method and all methods starting with `_`, and converts all return types to a promise. Readds "close" as added by ServiceBase
 * @typeParam BackendHandlerType - Type definition of the service class that implements this service.
*/
export type ConvertWorkerServiceInterfaceToClientInterface<BackendHandlerType extends object> = {
  [K in ExportedMethods<BackendHandlerType> | "close"]: (K extends "close" ?
    () => void :
    (K extends keyof BackendHandlerType ?
      (BackendHandlerType[K] extends ProxyableFunction ?
        PromisifyWorkerFunctionReturnType<BackendHandlerType[K]> :
        never) :
      never));
};

export class WorkerServiceProxy<T extends object> implements ProxyHandler<T> {
  port: TypedMessagePort<WorkerServiceLinkRequest, WorkerServiceLinkResponse>;
  func: string;
  description: WebHareServiceDescription;
  refs: RefTracker;
  requests: Record<number, DeferredPromise<WorkerControlLinkResponse | WorkerServiceLinkResponse>>;
  checkClosed: () => void;

  constructor(
    port: TypedMessagePort<WorkerServiceLinkRequest, WorkerServiceLinkResponse>,
    func: string,
    description: WebHareServiceDescription,
    refs: RefTracker,
    requests: Record<number, DeferredPromise<WorkerControlLinkResponse | WorkerServiceLinkResponse>>,
    checkClosed: () => void) {
    this.port = port;
    this.func = func;
    this.description = description;
    this.refs = refs;
    this.requests = requests;
    this.checkClosed = checkClosed;
    /* We're sending a close over the port when this object is garbage collected
       Make sure the port doesn't hold strong references to this object, copy the
       reference to this.requests */
    this.port.on("message", (message) => {
      requests[message.id]?.resolve(message);
      delete requests[message.id];
    });
    this.port.unref();
    portcloser.register(this, this.port);
  }

  get(target: object, prop: string, receiver: unknown) {
    if (prop === 'close') //create a close() function
      return () => this.closeService();
    if (this.description.methods.find(m => m.name === prop)) {
      const func = (...args: unknown[]) => this.remotingFunc({ name: prop }, args);
      func.callWithTransferList = (transferList: TransferListItem[], ...args: unknown[]) => this.remotingFunc({ name: prop, transferList }, args);
      return func;

    }

    return undefined;
  }

  has(target: object, prop: string): boolean {
    return Boolean(this.description.methods.find(m => m.name === prop)) || prop == "close";
  }

  set(target: object, prop: string): boolean {
    throw new Error(`Cannot override service functions, trying to change property ${JSON.stringify(prop)}`);
  }

  closeService() {
    this.port.close();
  }

  async remotingFunc(method: { name: string; transferList?: TransferListItem[] }, args: unknown[]) {
    const id = ++counter;
    const deferred = createDeferred<WorkerControlLinkResponse | WorkerServiceLinkResponse>();
    this.requests[id] = deferred;
    const lock = this.refs.getLock(`call ${this.func}#${method.name}`);
    try {
      const calldata: WorkerServiceLinkRequest = {
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

/** Wraps a node worker */
export class AsyncWorker {
  private worker: Worker;
  private port: TypedMessagePort<WorkerControlLinkRequest, WorkerControlLinkResponse>;
  private requests: Record<string, DeferredPromise<WorkerControlLinkResponse | WorkerServiceLinkResponse>> = {};
  private refs: RefTracker;
  private closed = false;
  private error: Error | undefined;

  constructor() {
    const ports = createTypedMessageChannel<WorkerControlLinkRequest, WorkerControlLinkResponse>("AsyncWorker");
    this.port = ports.port1;
    const localHandlerInitData = bridge.getLocalHandlerInitDataForWorker();
    this.worker = new Worker(require.resolve("./worker_handler.ts"), {
      workerData: {
        port: ports.port2,
        localHandlerInitData
      }, transferList: [
        ports.port2 as unknown as TransferListItem,
        localHandlerInitData.port as unknown as TransferListItem
      ]
    });
    // We're sending a close over the port when this object is garbage collected
    // Make sure the port doesn't hold strong references to this object
    const requests = this.requests;
    const handlerWeakRef = new WeakRef(this);

    function rejectRequests(error: Error) {
      const handler = handlerWeakRef.deref();
      error = handler ? handler.error ??= error : error;
      for (const [key, value] of Object.entries(requests)) {
        value.reject(error);
        delete requests[key];
      }
    }

    this.worker.on("error", (error) => rejectRequests(error));
    this.worker.on("exit", (code) => {
      const error = new Error(`Worker exited with code ${code}`);
      rejectRequests(error);
    });
    this.port.on("message", (message) => {
      requests[message.id]?.resolve(message);
      delete requests[message.id];
    });
    this.refs = new RefTracker(this.worker, { initialref: false });
    this.port.unref();
    portcloser.register(this, this.port);
    initializedWorker();
  }

  private checkClosed() {
    if (this.closed)
      throw new Error(`This worker has already been closed`);
    if (this.error)
      throw this.error;
  }

  private async newReturningObject<T extends object>(isfactory: boolean, func: FunctionRef, ...params: unknown[]): Promise<ConvertWorkerServiceInterfaceToClientInterface<T>> {
    this.checkClosed();
    const options = typeof func === "string" ? { ref: func } : func;
    const id = ++counter;
    const deferred = createDeferred<WorkerControlLinkResponse>();
    this.requests[id] = deferred;
    const lock = this.refs.getLock(`instantiate ${func}`);
    try {
      this.port.postMessage({
        type: "instantiateServiceRequest",
        id,
        func: options.ref,
        params,
        isfactory
      }, options.transferList ?? []);
      const result = await deferred.promise;
      if (result.type === "instantiateServiceError")
        throw parseIPCException(result.error);
      else if (result.type === "instantiateServiceResponse") {
        registerTransferredPort(result.port, `worker servicehandler port: ${options.ref}`);
        return new Proxy({}, new WorkerServiceProxy<ConvertWorkerServiceInterfaceToClientInterface<T>>(
          result.port,
          options.ref,
          result.description,
          this.refs,
          this.requests,
          () => this.checkClosed()
        )) as ConvertWorkerServiceInterfaceToClientInterface<T>;
      } else
        throw new Error(`Got wrong response, type ${result.type}`);
    } finally {
      lock.release();
    }
  }

  async newRemoteObject<T extends object>(func: FunctionRef, ...params: unknown[]): Promise<ConvertWorkerServiceInterfaceToClientInterface<T>> {
    return this.newReturningObject(false, func, ...params);
  }

  async callFactory<T extends object>(func: FunctionRef, ...params: unknown[]): Promise<ConvertWorkerServiceInterfaceToClientInterface<T>> {
    return this.newReturningObject(true, func, ...params);
  }

  async callRemote<T = unknown>(func: FunctionRef, ...params: unknown[]): Promise<T> {
    this.checkClosed();
    const options = typeof func === "string" ? { ref: func } : func;
    const id = ++counter;
    const deferred = createDeferred<WorkerControlLinkResponse>();
    this.requests[id] = deferred;
    const lock = this.refs.getLock(`instantiate ${options.ref}`);
    try {
      this.port.postMessage({
        type: "callRequest",
        id,
        func: options.ref,
        params
      }, options.transferList ?? []);
      const result = await deferred.promise;
      if (result.type === "callError")
        throw parseIPCException(result.error);
      else if (result.type === "callResponse")
        return result.result as T;
      else
        throw new Error(`Got wrong response, type ${result.type}`);
    } finally {
      lock.release();
    }
  }

  close() {
    this.worker.terminate();
    this.closed = true;
    this.error ??= new Error(`Worker has been closed`);
    for (const req of Object.values(this.requests))
      req.reject(this.error);
    this.requests = {};
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
