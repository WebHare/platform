import { type TransferListItem, workerData } from "node:worker_threads";
import type { WorkerControlLinkRequest, WorkerControlLinkResponse, WorkerServiceLinkRequest, WorkerServiceLinkResponse } from "./types";
import { loadJSFunction } from "./resourcetools";
import { describePublicInterface } from "@webhare/services/src/backendservicerunner";
import { encodeIPCException } from "./whmanager/ipc";
import { type TypedMessagePort, createTypedMessageChannel, registerTransferredPort } from "./whmanager/transport";
import { activateHMR } from "@webhare/services/src/services";
import { ReturnValueWithTransferList } from "@webhare/services/src/localservice";

export type ServiceRequestFactoryFunction = (...params: unknown[]) => Promise<object> | object;
export type ServiceRequestConstructor = { new(...args: unknown[]): object };
export type CallRequestFunction = (...params: unknown[]) => unknown;

export class WorkerHandler {
  port: TypedMessagePort<WorkerControlLinkResponse, WorkerControlLinkRequest>;

  constructor(port: TypedMessagePort<WorkerControlLinkResponse, WorkerControlLinkRequest>) {
    this.port = port;
    registerTransferredPort(port, "async worker port");
    this.port.on("message", (message) => void this.gotMessage(message));
  }

  async gotMessage(message: WorkerControlLinkRequest) {
    switch (message.type) {
      case "instantiateServiceRequest": {
        try {
          const channel = createTypedMessageChannel<WorkerServiceLinkRequest, WorkerServiceLinkResponse>("WorkerHandler " + message.func);
          const serviceclass = message.isfactory ?
            await (await loadJSFunction<ServiceRequestFactoryFunction>(message.func))(...message.params) as object :
            new (await loadJSFunction<ServiceRequestConstructor>(message.func))(...message.params) as object;
          if (!serviceclass || typeof serviceclass !== "object")
            throw new Error(`Factory did not return an object`);
          const description = describePublicInterface(serviceclass);
          this.port.postMessage({
            type: "instantiateServiceResponse",
            id: message.id,
            port: channel.port1,
            description
          }, [channel.port1]);

          new ServicePortHandler(channel.port2, serviceclass);
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
          let result = await (await loadJSFunction<CallRequestFunction>(message.func))(...message.params);
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

  constructor(port: TypedMessagePort<WorkerServiceLinkResponse, WorkerServiceLinkRequest>, serviceclass: object) {
    this.port = port;
    registerTransferredPort(port, "worker servicehandler port");
    this.serviceclass = serviceclass;
    this.port.on("message", (message) => void this.gotMessage(message));
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
}

activateHMR();
new WorkerHandler(workerData.port);
