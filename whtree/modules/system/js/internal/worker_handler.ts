import { type TransferListItem, workerData } from "node:worker_threads";
import type { WorkerControlLinkRequest, WorkerControlLinkResponse, WorkerServiceLinkRequest, WorkerServiceLinkResponse } from "./types";
import { describePublicInterface } from "@webhare/services/src/backendservicerunner";
import { encodeIPCException } from "./whmanager/ipc";
import { type TypedMessagePort, createTypedMessageChannel, dumpActiveIPCMessagePorts, registerTransferredPort } from "./whmanager/transport";
import { ReturnValueWithTransferList } from "@webhare/services/src/localservice";
import { importJSFunction } from "@webhare/services";
import { activateHMR } from "@webhare/services/src/hmr";
import { debugFlags } from "@webhare/env";

export type ServiceRequestFactoryFunction = (...params: unknown[]) => Promise<object> | object;
export type ServiceRequestConstructor = { new(...args: unknown[]): object };
export type CallRequestFunction = (...params: unknown[]) => unknown;

export class WorkerHandler {
  port: TypedMessagePort<WorkerControlLinkResponse, WorkerControlLinkRequest>;
  services = new Set<ServicePortHandler>;

  constructor(port: TypedMessagePort<WorkerControlLinkResponse, WorkerControlLinkRequest>) {
    this.port = port;
    registerTransferredPort(port, "async worker port");
    this.port.on("message", (message) => void this.gotMessage(message));
  }

  async gotMessage(message: WorkerControlLinkRequest) {
    switch (message.type) {
      case "close": {
        this.port.close();
        for (const service of this.services)
          service.close();
        // The following timeout won't be called if the worker auto-closes
        setTimeout(() => {
          if (debugFlags.async) {
            console.error(`WorkerHandler: worker not auto-terminating after close(), dumping active resources`);
            console.error(process.getActiveResourcesInfo());
            dumpActiveIPCMessagePorts();
          } else
            console.error(`WorkerHandler: worker not auto-terminating after close() (active resources?)`);
        }, message.gracePeriodMs * 0.9).unref();
      } break;
      case "instantiateServiceRequest": {
        try {
          const channel = createTypedMessageChannel<WorkerServiceLinkRequest, WorkerServiceLinkResponse>("WorkerHandler " + message.func);
          const serviceclass = await (await importJSFunction<ServiceRequestFactoryFunction>(message.func))(...message.params);
          if (!serviceclass || typeof serviceclass !== "object")
            throw new Error(`Factory did not return an object`);
          const description = describePublicInterface(serviceclass);
          this.port.postMessage({
            type: "instantiateServiceResponse",
            id: message.id,
            port: channel.port1,
            description
          }, [channel.port1]);

          const handler = new ServicePortHandler(channel.port2, serviceclass);
          this.services.add(handler);
          handler.onClose = () => this.services.delete(handler);
        } catch (e) {
          this.port.postMessage({
            type: "instantiateServiceError",
            id: message.id,
            error: encodeIPCException(e as Error)
          });
        }
      } break;
      case "callRequest": {
        try {
          let result = await (await importJSFunction<CallRequestFunction>(message.func))(...message.params);
          let transferList = new Array<TransferListItem>;
          if (result && typeof result === "object" && result instanceof ReturnValueWithTransferList) {
            transferList = result.transferList;
            result = await result.value;
          }
          this.port.postMessage({
            type: "callResponse",
            id: message.id,
            result
          }, transferList);
        } catch (e) {
          this.port.postMessage({
            type: "callError",
            id: message.id,
            error: encodeIPCException(e as Error)
          });
        }
      } break;
    }
  }
}

class ServicePortHandler {
  port;
  serviceclass: object;
  onClose?: () => void;
  closed = false;

  constructor(port: TypedMessagePort<WorkerServiceLinkResponse, WorkerServiceLinkRequest>, serviceclass: object) {
    this.port = port;
    registerTransferredPort(port, "worker servicehandler port");
    this.serviceclass = serviceclass;
    this.port.on("message", (message) => void this.gotMessage(message));
    this.port.on("close", () => this.close());
  }

  async gotMessage(message: WorkerServiceLinkRequest) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      let result = await ((this.serviceclass as Record<string, Function>)[message.func])(...message.params);
      let transferList = new Array<TransferListItem>;
      if (result && typeof result === "object" && result instanceof ReturnValueWithTransferList) {
        transferList = result.transferList;
        result = await result.value;
      }
      this.port.postMessage({
        type: "callResponse",
        id: message.id,
        result
      }, transferList);
    } catch (e) {
      this.port.postMessage({
        type: "callError",
        id: message.id,
        error: encodeIPCException(e as Error)
      });
    }
  }

  close() {
    if (this.closed)
      return;
    this.closed = true;
    this.port.close();
    this.onClose?.();
  }
}

activateHMR();
new WorkerHandler(workerData.port);
