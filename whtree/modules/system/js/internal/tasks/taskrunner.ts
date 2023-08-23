import { TaskRequest, TaskResponse, broadcast } from "@webhare/services";
import { loadJSFunction } from "../resourcetools";
import { System_Managedtasks, WebHareDB } from "@mod-system/js/internal/generated/whdb/webhare";
import { WHDBBlob, commitWork, db, isWorkOpen, rollbackWork, uploadBlob } from "@webhare/whdb";
import { getStructuredTrace } from "../whmanager/ipc";

interface TaskInfo {
  queueid: string;
  tasktype: string;
  taskrunner: string;
  dbid: number;
  data: unknown;
}

async function finalizeTaskResult(taskinfo: TaskInfo, updates: Partial<System_Managedtasks>) {
  if (!isWorkOpen())
    throw new Error("Task did not open work");

  await db<WebHareDB>().updateTable("system.managedtasks").where("id", "=", taskinfo.dbid).set(updates).execute();
  await commitWork();

  broadcast("system:managedtasks.any." + taskinfo.dbid);
  broadcast("system:managedtasks." + taskinfo.tasktype + "." + taskinfo.dbid);
}

async function splitretval(data: unknown): Promise<{ shortretval: string; longretval: WHDBBlob | null }> {
  if (!data)
    return { shortretval: "", longretval: null };

  const result = JSON.stringify(data);
  if (result.length < 1000)
    return { shortretval: result, longretval: null };

  return { shortretval: "long", longretval: await uploadBlob(result) };
}

export async function executeManagedTask(taskinfo: TaskInfo, debug: boolean) {
  //TODO separate context per task, but currently we run inside a callAsync so we're isolated anyway.
  //TODO once we run inside contexts, we'll need a smarter process intercept
  process.exit = code => { throw new Error("Task attempted to abort with error code " + code); };

  try {
    const target = await loadJSFunction(taskinfo.taskrunner);
    const req = new TaskRequest<unknown>(taskinfo.dbid, taskinfo.data);
    const taskresponse = await target(req) as TaskResponse;

    switch (taskresponse.type) {
      case "finished":
        await finalizeTaskResult(taskinfo, { lasterrors: "", finished: new Date, ...await splitretval(taskresponse.result) });
        break;

      // case "failed": //TODO but not excercised by tests yet
      case "cancelled": {
        const iscancelled = taskresponse.type === "cancelled";
        await finalizeTaskResult(taskinfo, { iscancelled, lasterrors: taskresponse.error, finished: new Date, ...await splitretval(taskresponse.result) });
        break;
      }

      default:
        throw new Error(`Unrecognzized task result type ${(taskresponse as { type: string }).type}`);
    }

    return { type: "taskdone", result: taskresponse.result };
  } catch (e) {
    if (isWorkOpen())
      await rollbackWork();

    //TODO Why aren't we using IPC encoded exceptions?
    return { type: "taskfailed", error: (e as Error).message || String(e), trace: getStructuredTrace(e as Error), isfatal: false };
  }
}
