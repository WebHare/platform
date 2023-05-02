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
