import { convertWaitPeriodToDate, WaitPeriod } from "@webhare/std/api";
import { extendWorkToCoHSVM, getCoHSVM } from "./co-hsvm";

interface TaskResponseFinished {
  type: "finished";
  result: unknown;
}

interface TaskResponseCancelled {
  type: "cancelled";
  result: unknown;
  error: string;
}

export type TaskResponse = TaskResponseFinished | TaskResponseCancelled;


export class TaskRequest<TaskDataType, TaskResultType = unknown> {
  readonly taskdata: TaskDataType;
  readonly taskid: number;

  constructor(taskid: number, taskdata: TaskDataType) {
    this.taskid = taskid;
    this.taskdata = taskdata;
  }

  resolveByCancellation(retval: TaskResultType, error: string): TaskResponse {
    return { type: "cancelled", result: retval, error: error };
  }

  resolveByCompletion(result?: TaskResultType): TaskResponse {
    return { type: "finished", result };
  }
}

export async function scheduleTask(call: string, ...args: unknown[]) {
  const vm = await getCoHSVM();
  await extendWorkToCoHSVM();
  return await vm.loadlib("mod::system/lib/tasks.whlib").scheduleManagedTask(call, ...args) as number;
}

export async function retrieveTaskResult<T>(taskId: number, timeout: WaitPeriod, options?: {
  acceptCancel?: boolean;
  acceptTempFailure?: boolean;
  acceptTimeout?: boolean;
}) {
  options = {
    acceptCancel: false,
    acceptTempFailure: false,
    acceptTimeout: false,
    ...options
  };
  const vm = await getCoHSVM();
  const maxwait = convertWaitPeriodToDate(timeout);
  return await vm.loadlib("mod::system/lib/tasks.whlib").retrieveManagedTaskResult(taskId, maxwait, options) as T;
}
