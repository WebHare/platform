import { IPCLinkType } from "./ipc";
import { WHMProcessType as ProcessType } from "./whmanager_rpcdefs";
export { WHMProcessType as ProcessType } from "./whmanager_rpcdefs";

export type ProcessList = Array<{
  processcode: bigint;
  pid: number;
  type: ProcessType;
  name: string;
  parameters: Record<string, string>;
  debuggerconnected: boolean;
}>;

export enum DebugRequestType {
  enableInspector,
}

type DebugRequest = {
  type: DebugRequestType.enableInspector;
  port: number;
  __responseKey: { type: DebugResponseType.enableInspectorResult };
};

export enum DebugResponseType {
  register,
  enableInspectorResult,
}

type DebugResponse = {
  type: DebugResponseType.register;
  processcode: bigint;
} | {
  type: DebugResponseType.enableInspectorResult;
  url: string;
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
}

export enum DebugMgrClientLinkResponseType {
  subscribeProcessListResult,
  getProcessListResult,
  eventProcessListUpdated,
  enableInspectorResult,
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
  processcode: bigint;
  __responseKey: { type: DebugMgrClientLinkResponseType.enableInspectorResult };
}, {
  type: DebugMgrClientLinkResponseType.subscribeProcessListResult;
} | {
  type: DebugMgrClientLinkResponseType.getProcessListResult;
  processlist: ProcessList;
} | {
  type: DebugMgrClientLinkResponseType.enableInspectorResult;
  url: string;
} | {
  type: DebugMgrClientLinkResponseType.eventProcessListUpdated;
}>;
