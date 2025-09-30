import type { WorkerControlLinkRequest, WorkerControlLinkResponse, WorkerServiceLinkResponse } from "./types";
import { type TypedMessagePort, createTypedMessageChannel, registerTransferredPort } from "./whmanager/transport";
import { parseIPCException } from "./whmanager/ipc";
import { Worker, type TransferListItem } from "node:worker_threads";
import { RefTracker } from "./whmanager/refs";
import bridge, { initializedWorker } from "./whmanager/bridge";
import { type ConvertLocalServiceInterfaceToClientInterface, buildLocalServiceProxy } from "@webhare/services/src/localservice";
import EventSource from "./eventsource";

let counter = 0;
const terminationGracePeriodMs = 1000; // ms

type FunctionRef = string | {
  ref: string;
  transferList?: TransferListItem[];
};

// Closes the port when the AsyncWorker goes out of scope
const portcloser = new FinalizationRegistry((port: TypedMessagePort<object, object>) => {
  port.close();
});

type AsyncWorkerEvents = {
  // Not thrown when AsyncWorker goes out of reference and is garbage collected!
  error: Error;
};

class AsyncWorkerState {
  requests: Record<string, PromiseWithResolvers<WorkerControlLinkResponse | WorkerServiceLinkResponse>> = {};
  closed = false;
  exitCode: number | undefined;
  error: Error | undefined;
  parent: WeakRef<AsyncWorker>;

  constructor(parent: AsyncWorker) {
    this.parent = new WeakRef(parent);
  }

  setError(error: Error) {
    if (!this.error) {
      this.error = error;
      for (const [key, value] of Object.entries(this.requests)) {
        value.reject(error);
        delete this.requests[key];
      }
      // "emit" is protected, so use ["emit"] syntax
      if (!this.closed)
        this.parent.deref()?.["emit"]("error", error);
    }
  }
}

/** Wraps a node worker */
export class AsyncWorker extends EventSource<AsyncWorkerEvents> {
  private worker: Worker;
  private port: TypedMessagePort<WorkerControlLinkRequest, WorkerControlLinkResponse>;
  private state = new AsyncWorkerState(this);
  private refs: RefTracker;

  constructor() {
    super();
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
    const state = this.state;

    this.worker.on("error", (error) => {
      state.setError(error);
    });
    this.worker.on("exit", (code) => {
      state.exitCode = code;
      const error = new Error(`Worker exited with code ${code}`);
      state.setError(error);
    });
    this.port.on("message", (message) => {
      state.requests[message.id]?.resolve(message);
      delete state.requests[message.id];
    });
    this.refs = new RefTracker(this.worker, { initialref: false });
    this.port.unref();
    portcloser.register(this, this.port);
    initializedWorker();
  }

  private checkClosed() {
    if (this.state.closed)
      throw new Error(`This worker has already been closed`);
    if (this.state.error)
      throw this.state.error;
  }

  private async newReturningObject<T extends object>(func: FunctionRef, ...params: unknown[]): Promise<ConvertLocalServiceInterfaceToClientInterface<T>> {
    this.checkClosed();
    const options = typeof func === "string" ? { ref: func } : func;
    const id = ++counter;
    const deferred = Promise.withResolvers<WorkerControlLinkResponse>();
    this.state.requests[id] = deferred;
    const lock = this.refs.getLock(`instantiate ${func}`);
    try {
      this.port.postMessage({
        type: "instantiateServiceRequest",
        id,
        func: options.ref,
        params
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

  async callFactory<T extends object>(func: FunctionRef, ...params: unknown[]): Promise<ConvertLocalServiceInterfaceToClientInterface<T>> {
    return this.newReturningObject(func, ...params);
  }

  async callRemote<T = unknown>(func: FunctionRef, ...params: unknown[]): Promise<T> {
    this.checkClosed();
    const options = typeof func === "string" ? { ref: func } : func;
    const id = ++counter;
    const deferred = Promise.withResolvers<WorkerControlLinkResponse>();
    this.state.requests[id] = deferred;
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
    this.state.closed = true;
    this.state.setError(new Error(`Worker has been closed`));
    this.port.postMessage({ type: "close", gracePeriodMs: terminationGracePeriodMs });
    setTimeout(() => {
      // terminate the worker if it hasn't exited yet after closing its own port
      if (this.state.exitCode === undefined)
        void this.worker.terminate(); // async terminate
    }, terminationGracePeriodMs);
  }
}
