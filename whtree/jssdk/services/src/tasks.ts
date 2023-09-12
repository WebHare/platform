import { loadlib } from "@webhare/harescript";
import { convertWaitPeriodToDate, WaitPeriod } from "@webhare/std";

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
  return await loadlib("mod::system/lib/tasks.whlib").scheduleManagedTask(call, ...args) as number;
}

/** Schedule a timed task to run.
 *
    The task will be run at the specified time, or if not set, as soon as possible. If another request is made to
    run the task even earlier, or if the tasks 'runat' causes it to run, this request will be ignored (ie you cannot
    request multiple runs of a task by repeatedly calling this function)

    @param taskname - module:tag of the task
    @param options - when: When to run the task (if not set, asap)
                     allowMissing: Don't fail if the task isn't registered (yet)
*/
export async function scheduleTimedTask(taskname: string, options?: { when?: Date; allowMissing?: boolean }): Promise<void> {
  await loadlib("mod::system/lib/tasks.whlib").scheduleTimedTask(taskname, options ?? {});
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

  const maxwait = convertWaitPeriodToDate(timeout);
  return await loadlib("mod::system/lib/tasks.whlib").retrieveManagedTaskResult(taskId, maxwait, options) as T;
}
