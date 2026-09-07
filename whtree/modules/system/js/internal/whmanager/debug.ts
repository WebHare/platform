import type { IPCLinkType } from "./ipc";
import type { WHMProcessType } from "./whmanager_rpcdefs";
import type { State as HMRState } from "../../../../../jssdk/services/src/hmrinternal";
import type { StackTraceItem } from "../util/stacktrace";
import type { ConsoleLogItem } from "@webhare/env/src/concepts";
import type { DebugFlags } from "@webhare/env/src/envbackend";

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

export const DebugRequestType = {
  enableInspector: 0,
  getRecentlyLoggedItems: 1,
  getHMRState: 2,
  getCodeContexts: 3,
  getWorkers: 4,
  getEnvironment: 5,
  toggleDebugFlags: 6,
} as const;
export type DebugRequestType = typeof DebugRequestType[keyof typeof DebugRequestType];

type DebugRequest = {
  type: typeof DebugRequestType.enableInspector;
  port: number;
  __responseKey: { type: typeof DebugResponseType.enableInspectorResult };
} | {
  type: typeof DebugRequestType.getRecentlyLoggedItems;
  __responseKey: { type: typeof DebugResponseType.getRecentlyLoggedItemsResult };
} | {
  type: typeof DebugRequestType.getHMRState;
  __responseKey: { type: typeof DebugResponseType.getHMRStateResult };
} | {
  type: typeof DebugRequestType.getCodeContexts;
  __responseKey: { type: typeof DebugResponseType.getCodeContextsResult };
} | {
  type: typeof DebugRequestType.getWorkers;
  __responseKey: { type: typeof DebugResponseType.getWorkersResult };
} | {
  type: typeof DebugRequestType.getEnvironment;
  __responseKey: { type: typeof DebugResponseType.getEnvironmentResult };
} | {
  type: typeof DebugRequestType.toggleDebugFlags;
  mode: "enable" | "disable" | "clear";
  flags: string[];
  __responseKey: { type: typeof DebugResponseType.toggleDebugFlagsResult };
};

export const DebugResponseType = {
  register: 0,
  enableInspectorResult: 1,
  getRecentlyLoggedItemsResult: 2,
  getHMRStateResult: 3,
  getCodeContextsResult: 4,
  getWorkersResult: 5,
  getEnvironmentResult: 6,
  toggleDebugFlagsResult: 7,
} as const;
export type DebugResponseType = typeof DebugResponseType[keyof typeof DebugResponseType];

type DebugResponse = {
  type: typeof DebugResponseType.register;
  pid: number;
  workerid: string;
  workernr: number;
} | {
  type: typeof DebugResponseType.enableInspectorResult;
  url: string;
} | {
  type: typeof DebugResponseType.getRecentlyLoggedItemsResult;
  items: ConsoleLogItem[];
} | {
  type: typeof DebugResponseType.getHMRStateResult;
} & HMRState | {
  type: typeof DebugResponseType.getCodeContextsResult;
  codecontexts: Array<{
    id: string;
    title: string;
    metadata: unknown;
    trace: StackTraceItem[];
  }>;
} | {
  type: typeof DebugResponseType.getWorkersResult;
  workers: Array<{ workernr: number; workerid: string }>;
} | {
  type: typeof DebugResponseType.getEnvironmentResult;
  env: Record<string, string>;
} | {
  type: typeof DebugResponseType.toggleDebugFlagsResult;
  flags: DebugFlags;
};

/** Request and response are swapped here, because conceptually the
 * debugmanager makes requests, even though the individual processes
 * connect to the debugmanager port.
 */
export type DebugIPCLinkType = IPCLinkType<DebugResponse, DebugRequest>;

export const DebugMgrClientLinkRequestType = {
  subscribeProcessList: 0,
  getProcessList: 1,
  enableInspector: 2,
  getRecentlyLoggedItems: 3,
  getHMRState: 4,
  getCodeContexts: 5,
  getWorkers: 6,
  getEnvironment: 7,
  toggleDebugFlags: 8,
} as const;
type DebugMgrClientLinkRequestType = typeof DebugMgrClientLinkRequestType[keyof typeof DebugMgrClientLinkRequestType];

export const DebugMgrClientLinkResponseType = {
  subscribeProcessListResult: 0,
  getProcessListResult: 1,
  eventProcessListUpdated: 2,
  enableInspectorResult: 3,
  getRecentlyLoggedItemsResult: 4,
  getHMRStateResult: 5,
  getCodeContextsResult: 6,
  getWorkersResult: 7,
  getEnvironmentResult: 8,
  toggleDebugFlagsResult: 9,
} as const;
type DebugMgrClientLinkResponseType = typeof DebugMgrClientLinkResponseType[keyof typeof DebugMgrClientLinkResponseType];

/** List of directly forwarded calls */
export const directforwards = {
  [DebugMgrClientLinkRequestType.getRecentlyLoggedItems]: { requesttype: DebugRequestType.getRecentlyLoggedItems, responsetype: DebugResponseType.getRecentlyLoggedItemsResult, clientresponsetype: DebugMgrClientLinkResponseType.getRecentlyLoggedItemsResult } as const,
  [DebugMgrClientLinkRequestType.getHMRState]: { requesttype: DebugRequestType.getHMRState, responsetype: DebugResponseType.getHMRStateResult, clientresponsetype: DebugMgrClientLinkResponseType.getHMRStateResult },
  [DebugMgrClientLinkRequestType.getCodeContexts]: { requesttype: DebugRequestType.getCodeContexts, responsetype: DebugResponseType.getCodeContextsResult, clientresponsetype: DebugMgrClientLinkResponseType.getCodeContextsResult },
  [DebugMgrClientLinkRequestType.getWorkers]: { requesttype: DebugRequestType.getWorkers, responsetype: DebugResponseType.getWorkersResult, clientresponsetype: DebugMgrClientLinkResponseType.getWorkersResult },
  [DebugMgrClientLinkRequestType.getEnvironment]: { requesttype: DebugRequestType.getEnvironment, responsetype: DebugResponseType.getEnvironmentResult, clientresponsetype: DebugMgrClientLinkResponseType.getEnvironmentResult },
  [DebugMgrClientLinkRequestType.toggleDebugFlags]: { requesttype: DebugRequestType.toggleDebugFlags, responsetype: DebugResponseType.toggleDebugFlagsResult, clientresponsetype: DebugMgrClientLinkResponseType.toggleDebugFlagsResult },
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
  type: typeof DebugMgrClientLinkRequestType.subscribeProcessList;
  enable: boolean;
  __responseKey: { type: typeof DebugMgrClientLinkResponseType.subscribeProcessListResult };
} | {
  type: typeof DebugMgrClientLinkRequestType.getProcessList;
  __responseKey: { type: typeof DebugMgrClientLinkResponseType.getProcessListResult };
} | {
  type: typeof DebugMgrClientLinkRequestType.enableInspector;
  processid: string;
  __responseKey: { type: typeof DebugMgrClientLinkResponseType.enableInspectorResult };
} | ForwardLinkSpecs["RequestTypeForLink"];

export type DebugMgrClientLinkResponse = {
  type: typeof DebugMgrClientLinkResponseType.subscribeProcessListResult;
} | {
  type: typeof DebugMgrClientLinkResponseType.getProcessListResult;
  processlist: ProcessList;
} | {
  type: typeof DebugMgrClientLinkResponseType.eventProcessListUpdated;
} | {
  type: typeof DebugMgrClientLinkResponseType.enableInspectorResult;
  url: string;
} | ForwardLinkSpecs["Response"];

export type DebugMgrClientLink = IPCLinkType<DebugMgrClientLinkRequest, DebugMgrClientLinkResponse>;
