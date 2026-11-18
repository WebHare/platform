/* Messages of the HareScript debug manager's client port (wh:debugmgr, implemented by
   mod::system/scripts/internal/debugmgr.whscr). The debug manager relays 'job-*' requests to the C++ debugger in the process
   running the job (harescript/vm/hsvm_debugger.cpp).

   Not every request gets a reply: the job list and job connection results arrive as separate messages ('joblist',
   'job-connected', 'job-connectfail'), and pausing a job results in a 'job-statechange' message. Requests for jobs or
   processes that are gone are answered with 'process-gone' or 'job-disconnected'.
*/

import type { IPCMarshallableRecord } from "@mod-system/js/internal/whmanager/hsmarshalling";
import type { WebHareBlob } from "@webhare/services";

/** Name of the debug manager's client port */
export const debugManagerPortName = "wh:debugmgr";

/** Pause reasons (bitmask, in JobStatus.pausereason) */
export const PauseReason = {
  request: 1,
  breakpoint: 2,
  manualBreakpoint: 4,
  rule: 8,
  newLibraries: 16,
  debuggerTrap: 32,
  exception: 64,
} as const;

/** A process registered with the debug manager */
export interface DebugProcessInfo {
  /** Process code, used to address the process */
  processcode: bigint;
  /** Client name, eg 'webserver' or 'runscript wh::...' */
  clientname: string;
  /** OS process id (not sent by older debug managers, the processcode is the pid of native processes) */
  pid?: number | bigint;
  /** Thread id within the process: 0 for the main thread, the worker thread id for HareScript running in the WASM engine */
  threadid?: number;
}

/** A job (VM group) as listed by the debug manager */
export interface DebugJobInfo {
  groupid: string;
  script: string;
  status: string;
  creationdate: Date;
  /** Total time spent running, as a DATETIME duration */
  total_running: Date;
  authenticationrecord: IPCMarshallableRecord | null;
  /** Whether a debugger is connected to the job */
  connected: boolean;
}

/** A stack frame, as part of an extended job status */
export interface DebugStackFrame {
  filename: string;
  func: string;
  line: number;
  col: number;
  /** Code position in the library. -1 for native functions, < -1 if the frame has been unwound */
  codeptr: number;
  /** Stack position of the frame's first local variable */
  baseptr: number;
  vm?: number;
}

/** Status of a job, as sent with state changes */
export interface DebugJobStatus {
  groupid: string;
  script: string;
  /** Status as seen by the job (eg 'Running', 'WaitForMultiple') */
  status: string;
  /** Actual status ('DebugStopped' when paused by the debugger, 'Terminated' when finished) */
  realstatus: string;
  creationdate: Date;
  total_running: Date;
  pausereason: number;
  authenticationrecord: IPCMarshallableRecord | null;
  /** Stack trace, innermost frame first (only when the job is paused) */
  stacktrace?: DebugStackFrame[];
  stacksize?: number;
  statistics?: IPCMarshallableRecord;
  errors?: IPCMarshallableRecord[];
}

/** Raw variable value, as returned by job-getvariables. The type is a HareScript type id, or negative for special values */
export interface RawDebugValue {
  type: number;
  /** Id to request (more of) this value, see GetVariablesRequest */
  id: number;
  /** For strings, blobs, records, objects and arrays: total number of bytes/cells/elements */
  length?: bigint;
  /** First and last+1 items that are included in 'value' */
  min?: bigint;
  max?: bigint;
  /** For records and objects: whether it exists */
  exists?: boolean;
  /** For objects: object id, privilege status and object type names */
  objectid?: bigint;
  privileged?: boolean;
  objecttypes?: string[];
  /** Simple values: the value itself. Strings and blobs: (part of) the data. Arrays: RawDebugValue[]. Records and objects: RawDebugCell[] */
  value?: unknown;
}

/** A record cell or object member in a raw value */
export interface RawDebugCell {
  name: string;
  value: RawDebugValue;
}

/** Request for a variable. Ids for local variables are the frame's baseptr plus the variable's position (see debuginfo.ts) */
export interface GetVariablesRequest {
  id: number;
  /** First item to return */
  min?: bigint;
  /** Last+1 item to return, -1 for all */
  max?: bigint;
}

export interface DebugLibraryInfo {
  liburi: string;
  compile_id: Date;
  sourcetime: Date;
  globalvarlocation: number;
}

export interface DebugInfoResponse {
  type: "job-debuginfo";
  groupid: string;
  liburi: string;
  found: boolean;
  compile_id: Date;
  debuginfo_compressed: WebHareBlob;
  sourcemap: Array<{ codeptr: number; line: number; col: number }>;
}

/** Raw function profile, as produced by EncodeFunctionProfileData (harescript/vm/baselibs.cpp) */
export interface RawFunctionProfile {
  locations: Array<{ id: number; library: string; func: string; line: number; col: number }>;
  items: Array<{ parentlocation: number; location: number; callcount: number; totaltime: number; totaltime_callee_nr: number; selftime: number }>;
}

/** Breakpoint, as sent with job-setbreakpoints */
export interface DebugBreakpoint {
  liburi: string;
  compile_id: Date;
  codeptr: number;
  /** Only break at this stack size, -1 for any */
  stacksize: number;
  /** Manual (user set) breakpoint, as opposed to one used for stepping */
  manual: boolean;
}

/** Types of the error replies that can come back from a request */
export const errorReplyTypes = new Set(["error", "job-error", "error-notconnected", "error-notstopped", "process-gone", "job-disconnected"]);
