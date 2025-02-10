import type { IPCLinkType } from "./ipc";
import type { WHMProcessType } from "./whmanager_rpcdefs";
import type { State as HMRState } from "../../../../../jssdk/services/src/hmrinternal";
import type { StackTraceItem } from "../util/stacktrace";
import type { ConsoleLogItem } from "@webhare/env/src/concepts";

export type ProcessList = Array<{
  pid: number;
  type: WHMProcessType;
  name: string;
  parameters: Record<string, string>;
}>;

export type PortList = Array<{
  pid: number;
  name: string;
}>;

export enum DebugRequestType {
  enableInspector,
  getRecentlyLoggedItems,
  getHMRState,
  getCodeContexts,
  getWorkers,
  getEnvironment
}

type DebugRequest = {
  type: DebugRequestType.enableInspector;
  port: number;
  __responseKey: { type: DebugResponseType.enableInspectorResult };
} | {
  type: DebugRequestType.getRecentlyLoggedItems;
  __responseKey: { type: DebugResponseType.getRecentlyLoggedItemsResult };
} | {
  type: DebugRequestType.getHMRState;
  __responseKey: { type: DebugResponseType.getHMRStateResult };
} | {
  type: DebugRequestType.getCodeContexts;
  __responseKey: { type: DebugResponseType.getCodeContextsResult };
} | {
  type: DebugRequestType.getWorkers;
  __responseKey: { type: DebugResponseType.getWorkersResult };
} | {
  type: DebugRequestType.getEnvironment;
  __responseKey: { type: DebugResponseType.getEnvironmentResult };
};

export enum DebugResponseType {
  register,
  enableInspectorResult,
  getRecentlyLoggedItemsResult,
  getHMRStateResult,
  getCodeContextsResult,
  getWorkersResult,
  getEnvironmentResult
}

type DebugResponse = {
  type: DebugResponseType.register;
  pid: number;
  workerid: string;
  workernr: number;
} | {
  type: DebugResponseType.enableInspectorResult;
  url: string;
} | {
  type: DebugResponseType.getRecentlyLoggedItemsResult;
  items: ConsoleLogItem[];
} | {
  type: DebugResponseType.getHMRStateResult;
} & HMRState | {
  type: DebugResponseType.getCodeContextsResult;
  codecontexts: Array<{
    id: string;
    title: string;
    metadata: unknown;
    trace: StackTraceItem[];
  }>;
} | {
  type: DebugResponseType.getWorkersResult;
  workers: Array<{ workernr: number; workerid: string }>;
} | {
  type: DebugResponseType.getEnvironmentResult;
  env: Record<string, string>;
};

/** Request and response are swapped here, because conceptually the
 * debugmanager makes requests, even though the individual processes
 * connect to the debugmanager port.
 */
export type DebugIPCLinkType = IPCLinkType<DebugResponse, DebugRequest>;

export enum DebugMgrClientLinkRequestType {
  subscribeProcessList,
  getProcessList,
  enableInspector,
  getRecentlyLoggedItems,
  getHMRState,
  getCodeContexts,
  getWorkers,
  getEnvironment
}

export enum DebugMgrClientLinkResponseType {
  subscribeProcessListResult,
  getProcessListResult,
  eventProcessListUpdated,
  enableInspectorResult,
  getRecentlyLoggedItemsResult,
  getHMRStateResult,
  getCodeContextsResult,
  getWorkersResult,
  getEnvironmentResult
}

/** List of directly forwarded calls */
export const directforwards = {
  [DebugMgrClientLinkRequestType.getRecentlyLoggedItems]: { requesttype: DebugRequestType.getRecentlyLoggedItems, responsetype: DebugResponseType.getRecentlyLoggedItemsResult, clientresponsetype: DebugMgrClientLinkResponseType.getRecentlyLoggedItemsResult },
  [DebugMgrClientLinkRequestType.getHMRState]: { requesttype: DebugRequestType.getHMRState, responsetype: DebugResponseType.getHMRStateResult, clientresponsetype: DebugMgrClientLinkResponseType.getHMRStateResult },
  [DebugMgrClientLinkRequestType.getCodeContexts]: { requesttype: DebugRequestType.getCodeContexts, responsetype: DebugResponseType.getCodeContextsResult, clientresponsetype: DebugMgrClientLinkResponseType.getCodeContextsResult },
  [DebugMgrClientLinkRequestType.getWorkers]: { requesttype: DebugRequestType.getWorkers, responsetype: DebugResponseType.getWorkersResult, clientresponsetype: DebugMgrClientLinkResponseType.getWorkersResult },
  [DebugMgrClientLinkRequestType.getEnvironment]: { requesttype: DebugRequestType.getEnvironment, responsetype: DebugResponseType.getEnvironmentResult, clientresponsetype: DebugMgrClientLinkResponseType.getEnvironmentResult },
} as const;

/// Returns the matching objects in a union whose "type" property extends from T
type GetByType<T extends { type: unknown }, K> = T extends { type: K } ? T : never;

/// Constructs the types needed to declare the forward in DebugMgrClientLinkRequest, DebugMgrClientLinkResponse and to type the client message in the forwarder
type Forward<ClientRequestType extends DebugMgrClientLinkRequestType, RequestType extends DebugRequestType, ClientResponseType extends DebugMgrClientLinkResponseType> = {
  /// Request record for the DebugMgrClientLinkRequest type
  RequestTypeForLink: { type: ClientRequestType; processid: string; __responseKey: { type: ClientResponseType } } & Omit<GetByType<DebugRequest, RequestType>, "type" | "__responseKey">;
  /// Format of the message sent by the client
  Request: { type: ClientRequestType; processid: string } & Omit<GetByType<DebugRequest, RequestType>, "type" | "__responseKey">;
  /// Format of the message to return (also for DebugMgrClientLinkResponse type)
  Response: { type: ClientResponseType } & Omit<GetByType<DebugResponse, GetByType<DebugRequest, RequestType>["__responseKey"]["type"]>, "type">;
};

/** Get the forward data given a forwarded client request type */
export type ForwardByRequestType<K extends keyof typeof directforwards> = Forward<K, typeof directforwards[K]["requesttype"], typeof directforwards[K]["clientresponsetype"]>;

type ForwardLinkSpecs<K extends keyof typeof directforwards = keyof typeof directforwards> = K extends unknown ? ForwardByRequestType<K> : never;

export type DebugMgrClientLinkRequest = {
  // If enabled, send a `eventProcessListUpdated` message every time the process list has changed after a `getProcessList` call.
  type: DebugMgrClientLinkRequestType.subscribeProcessList;
  enable: boolean;
  __responseKey: { type: DebugMgrClientLinkResponseType.subscribeProcessListResult };
} | {
  type: DebugMgrClientLinkRequestType.getProcessList;
  __responseKey: { type: DebugMgrClientLinkResponseType.getProcessListResult };
} | {
  type: DebugMgrClientLinkRequestType.enableInspector;
  processid: string;
  __responseKey: { type: DebugMgrClientLinkResponseType.enableInspectorResult };
} | ForwardLinkSpecs["RequestTypeForLink"];

export type DebugMgrClientLinkResponse = {
  type: DebugMgrClientLinkResponseType.subscribeProcessListResult;
} | {
  type: DebugMgrClientLinkResponseType.getProcessListResult;
  processlist: ProcessList;
} | {
  type: DebugMgrClientLinkResponseType.eventProcessListUpdated;
} | {
  type: DebugMgrClientLinkResponseType.enableInspectorResult;
  url: string;
} | ForwardLinkSpecs["Response"];

export type DebugMgrClientLink = IPCLinkType<DebugMgrClientLinkRequest, DebugMgrClientLinkResponse>;
