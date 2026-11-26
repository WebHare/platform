# WebHare tasks

APIs to schedule, wait for and manage WebHare managed tasks and timed tasks.

## Managed tasks
Managed tasks are defined in a module's moduledefinition and are scheduled as part of a transaction. They are only
queued if the work commits, and are retried by the task manager until they complete or fail permanently.

```typescript
import { runInWork } from "@webhare/whdb";
import { scheduleTask, retrieveTaskResult } from "@webhare/tasks";

const taskId = await runInWork(() => scheduleTask("mymodule:mytask", { param: 42 }));
const result = await retrieveTaskResult<{ answer: number }>(taskId, { timeout: 60_000 });
```

A task implementation receives a `TaskRequest` and resolves it:

```typescript
import type { TaskRequest, TaskResponse } from "@webhare/tasks";

export async function myTask(req: TaskRequest<{ param: number }>): Promise<TaskResponse> {
  return req.resolveByCompletion({ answer: req.taskdata.param });
}
```

Other APIs: `listTasks`, `describeTask`, `cancelTask`, `retryTask` and `flushTasks` (wait for all tasks of the given types to complete).

## Timed tasks
`scheduleTimedTask` requests a timed task to run as soon as possible (or at the requested time) after the current work commits:

```typescript
import { runInWork } from "@webhare/whdb";
import { scheduleTimedTask } from "@webhare/tasks";

const scheduled = await runInWork(() => scheduleTimedTask("mymodule:mytimedtask"));
await scheduled.taskDone;
```
