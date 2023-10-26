import { WorkerControlLinkRequest, WorkerControlLinkResponse, WorkerServiceLinkResponse } from "./types";
import { TypedMessagePort, createTypedMessageChannel, registerTransferredPort } from "./whmanager/transport";
import { parseIPCException } from "./whmanager/ipc";
import { Worker, TransferListItem } from "node:worker_threads";
import { DeferredPromise, createDeferred } from "@webhare/std/promises";
import { RefTracker } from "./whmanager/refs";
import bridge, { initializedWorker } from "./whmanager/bridge";
import { ConvertLocalServiceInterfaceToClientInterface, buildLocalServiceProxy } from "@webhare/services/src/localservice";

let counter = 0;

type FunctionRef = string | {
  ref: string;
  transferList?: TransferListItem[];
};

// Closes the port when the AsyncWorker goes out of scope
const portcloser = new FinalizationRegistry((port: TypedMessagePort<object, object>) => {
  port.close();
});

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

  private async newReturningObject<T extends object>(isfactory: boolean, func: FunctionRef, ...params: unknown[]): Promise<ConvertLocalServiceInterfaceToClientInterface<T>> {
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
        return buildLocalServiceProxy<T>(
          result.port,
          options.ref,
          result.description,
          this.refs,
        );
      } else
        throw new Error(`Got wrong response, type ${result.type}`);
    } finally {
      lock.release();
    }
  }

  async newRemoteObject<T extends object>(func: FunctionRef, ...params: unknown[]): Promise<ConvertLocalServiceInterfaceToClientInterface<T>> {
    return this.newReturningObject(false, func, ...params);
  }

  async callFactory<T extends object>(func: FunctionRef, ...params: unknown[]): Promise<ConvertLocalServiceInterfaceToClientInterface<T>> {
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
