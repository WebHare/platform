// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/tasks" {
}

export { TaskRequest, scheduleTask, scheduleTimedTask, retrieveTaskResult, cancelTask, listTasks, describeTask, retryTask, flushTasks } from "./impl.ts";
export type { TaskFunction, TaskResponse } from "./impl.ts";
