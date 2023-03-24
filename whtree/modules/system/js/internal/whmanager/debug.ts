import { IPCLinkType } from "./ipc";
import { WHMProcessType as ProcessType } from "./whmanager_rpcdefs";
export { WHMProcessType as ProcessType } from "./whmanager_rpcdefs";

export type ProcessList = Array<{
  processcode: number;
  pid: number;
  type: ProcessType;
  name: string;
  parameters: Record<string, string>;
  debuggerconnected: boolean;
}>;

export enum DebugRequestType {
  enableInspector,
  getRecentLoggedItems,
}

type DebugRequest = {
  type: DebugRequestType.enableInspector;
  port: number;
  __responseKey: { type: DebugResponseType.enableInspectorResult };
} | {
  type: DebugRequestType.getRecentLoggedItems;
  __responseKey: { type: DebugResponseType.getRecentLoggedItemsResult };
};

export enum DebugResponseType {
  register,
  enableInspectorResult,
  getRecentLoggedItemsResult,
}

export type ConsoleLogItem = {
  /** Date when console function was called */
  when: Date;
  /** console function that was called (eg 'log') */
  func: string;
  /** Logged data */
  data: string;
  /** Clocation of caller */
  location: { filename: string; line: number; col: number; func: string } | null;
};

type DebugResponse = {
  type: DebugResponseType.register;
  processcode: number;
} | {
  type: DebugResponseType.enableInspectorResult;
  url: string;
} | {
  type: DebugResponseType.getRecentLoggedItemsResult;
  items: ConsoleLogItem[];
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
}

export enum DebugMgrClientLinkResponseType {
  subscribeProcessListResult,
  getProcessListResult,
  eventProcessListUpdated,
  enableInspectorResult,
  getRecentlyLoggedItemsResult,
}

export type DebugMgrClientLink = IPCLinkType<{
  // If enabled, send a `eventProcessListUpdated` message every time the process list has changed after a `getProcessList` call.
  type: DebugMgrClientLinkRequestType.subscribeProcessList;
  enable: boolean;
  __responseKey: { type: DebugMgrClientLinkResponseType.subscribeProcessListResult };
} | {
  type: DebugMgrClientLinkRequestType.getProcessList;
  __responseKey: { type: DebugMgrClientLinkResponseType.getProcessListResult };
} | {
  type: DebugMgrClientLinkRequestType.enableInspector;
  processcode: number;
  __responseKey: { type: DebugMgrClientLinkResponseType.enableInspectorResult };
} | {
  type: DebugMgrClientLinkRequestType.getRecentlyLoggedItems;
  processcode: number;
  __responseKey: { type: DebugMgrClientLinkResponseType.getRecentlyLoggedItemsResult };
}, {
  type: DebugMgrClientLinkResponseType.subscribeProcessListResult;
} | {
  type: DebugMgrClientLinkResponseType.getProcessListResult;
  processlist: ProcessList;
} | {
  type: DebugMgrClientLinkResponseType.enableInspectorResult;
  url: string;
} | {
  type: DebugMgrClientLinkResponseType.getRecentlyLoggedItemsResult;
  items: ConsoleLogItem[];
} | {
  type: DebugMgrClientLinkResponseType.eventProcessListUpdated;
}>;
