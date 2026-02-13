import type { HTTPMethod } from "@webhare/router";
import type { IPCMarshallableData, VariableType } from "./whmanager/hsmarshalling";
import type { IPCExceptionMessage, IPCLinkType } from "./whmanager/ipc";
import type { TypedMessagePort } from "./whmanager/transport";
import type { WebHareBlob } from "@webhare/services";

/// Primitive values (string, number or boolean)
export type PlainValue = string | number | boolean;

/// An object with string keys and typed values
export type KeyValueObject<T> = {
  [key: string]: T;
};

/// An array of name/value pairs
export type Properties = Array<{ name: string; value: string }>;

export interface ServiceInitMessage {
  /** arguments */
  __new: IPCMarshallableData[];
}

export type ServiceCallMessage = {
  /** invoked method */
  call: string;
  /** arguments */
  args?: IPCMarshallableData[];
  /** js encoded args */
  jsargs?: string;
};

export type ServiceCallResult = {
  /** result of invoked method */
  result: IPCMarshallableData;
};

export type WebHareServiceDescription = {
  isjs?: boolean;
  methods: Array<{
    name: string;
    signdata: {
      returntype: number;
      params: Array<{
        type: VariableType;
        has_default: boolean;
      }>;
      excessargstype: number;
    };
  }>;
};

export type ServiceEventMessage = {
  /** event name */
  event: string;
  /** event data */
  data: unknown;
};

export type WebHareServiceIPCLinkType = IPCLinkType<ServiceInitMessage | ServiceCallMessage, WebHareServiceDescription | ServiceCallResult | ServiceEventMessage>;

export interface InspectorSettings {
  url: string;
}
export type BridgeDescription = {
  /** bridge unique ID, in case a process opens multiple connections */
  instance: string;
  /** Process ID */
  pid: number;
  /** Interpreter eg node*/
  interpreter: string;
  /** And the script that's running */
  script: string;
};

export interface BridgeManagerLink {
  /** List all bridge connections */
  listConnections(): Promise<BridgeDescription[]>;
  /** Enable inspector and get its connection settings for a specific proces */
  enableInspector(instance: string): Promise<InspectorSettings | null>;
}

export interface BridgeClientLink {
  /** Enable inspector and get its connection settings for a specific proces */
  enableInspector(): Promise<InspectorSettings | null>;
}

///Internal data structure used to marshall requests from HareScript to JavaScipt. Proper routers would use WebRequest (and not have to deal with HS blobs)
export interface WebRequestInfo {
  sourceip: string;
  webserver: number;
  binding: number;
  method: HTTPMethod;
  url: string;
  headers: Record<string, string>;
  body: WebHareBlob;
}

///Internal data structure used to marshall responses from JavaScript to HareScript. Proper routers would use WebResponse (and not have to deal with HS blobs)
export interface WebResponseInfo {
  status: number;
  headers: Array<[string, string]>;
  body: WebHareBlob;
}

export type WorkerControlLinkRequest = {
  type: "close";
  gracePeriodMs: number;
} | {
  type: "instantiateServiceRequest";
  func: string;
  params: unknown[];
  id: number;
} | WorkerServiceLinkRequest;

export type WorkerControlLinkResponse = {
  type: "instantiateServiceResponse";
  id: number;
  port: TypedMessagePort<WorkerServiceLinkRequest, WorkerServiceLinkResponse>;
  description: WebHareServiceDescription;
} | {
  type: "instantiateServiceError";
  id: number;
  error: IPCExceptionMessage;
} | WorkerServiceLinkResponse;

export type WorkerServiceLinkRequest = {
  type: "callRequest";
  id: number;
  func: string;
  params: unknown[];
};

export type WorkerServiceLinkResponse = {
  type: "callResponse";
  id: number;
  result: unknown;
} | {
  type: "callError";
  id: number;
  error: IPCExceptionMessage;
};
