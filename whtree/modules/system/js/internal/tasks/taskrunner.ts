import { TaskFunction, TaskRequest, TaskResponse, WebHareBlob, broadcast } from "@webhare/services";
import { loadJSFunction } from "../resourcetools";
import { System_Managedtasks, PlatformDB } from "@mod-system/js/internal/generated/whdb/platform";
import { commitWork, db, isWorkOpen, rollbackWork, uploadBlob } from "@webhare/whdb";
import bridge from "../whmanager/bridge";
import { addDuration, pick } from "@webhare/std";
import { parseTrace } from "@webhare/js-api-tools";
import { IPCMarshallableData, encodeHSON } from "@webhare/hscompat/hson";

interface TaskInfo {
  queueid: string;
  tasktype: string;
  taskrunner: string;
  dbid: number;
  data: unknown;
}

const failreschedule = 15 * 60 * 1000;
const restartdelay = 1000;


async function finalizeTaskResult(taskinfo: TaskInfo, updates: Partial<System_Managedtasks>, { skipCancelled }: { skipCancelled?: boolean } = {}) {
  if (!isWorkOpen())
    throw new Error("Task did not open work");

  await db<PlatformDB>()
    .updateTable("system.managedtasks")
    .where("id", "=", taskinfo.dbid)
    .$call(qb => skipCancelled ? qb.where("iscancelled", "=", false) : qb)
    .set(updates)
    .execute();
  await commitWork();

  broadcast("system:managedtasks.any." + taskinfo.dbid);
  broadcast("system:managedtasks." + taskinfo.tasktype + "." + taskinfo.dbid);
}

async function splitretval(data: unknown): Promise<{ shortretval: string; longretval: WebHareBlob | null }> {
  if (!data)
    return { shortretval: "", longretval: null };

  const result = JSON.stringify(data);
  if (result.length < 1000)
    return { shortretval: result, longretval: null };

  const blob = WebHareBlob.from(result);
  await uploadBlob(blob);
  return { shortretval: "long", longretval: blob };
}

export async function executeManagedTask(taskinfo: TaskInfo, debug: boolean) {
  //TODO separate context per task, but currently we run inside a callAsync so we're isolated anyway.
  //TODO once we run inside contexts, we'll need a smarter process intercept
  process.exit = code => { throw new Error("Task attempted to abort with error code " + code); };

  try {
    const target = await loadJSFunction<TaskFunction>(taskinfo.taskrunner);
    const req = new TaskRequest<unknown>(taskinfo.dbid, taskinfo.data);
    const taskresponse = await target(req) as TaskResponse;

    switch (taskresponse.type) {
      case "finished":
        await finalizeTaskResult(taskinfo, { lasterrors: "", finished: new Date, ...await splitretval(taskresponse.result) });
        break;

      case "failed":
      case "cancelled": {
        const iscancelled = taskresponse.type === "cancelled";
        await finalizeTaskResult(taskinfo, { iscancelled, lasterrors: taskresponse.error, finished: new Date, ...await splitretval(taskresponse.result) });
        break;
      }

      case "failedtemporarily": {
        const minNextRetry = new Date(Date.now() + restartdelay);
        let nextRetry = !taskresponse.nextretry || taskresponse.nextretry.getTime() > minNextRetry.getTime() ? taskresponse.nextretry || null : minNextRetry;

        const iterations = (await db<PlatformDB>().selectFrom("system.managedtasks").select("iterations").where("id", "=", taskinfo.dbid).executeTakeFirst())?.iterations || 0;
        if (!nextRetry) {
          if (iterations >= 6)
            nextRetry = addDuration(new Date, "P1D");
          else
            nextRetry = new Date(Date.now() + (failreschedule << iterations));
        }

        await finalizeTaskResult(taskinfo, {
          nextattempt: new Date(nextRetry),
          iterations: iterations + 1,
          lasterrors: taskresponse.error,
          ...await splitretval(taskresponse.result)
        });
      } break;

      case "restart": {
        let nextRetry = new Date;
        if (taskresponse.when && taskresponse.when.getTime() > nextRetry.getTime())
          nextRetry = taskresponse.when;

        //do not restart tasks marked as cancelled (which may happen in parallel, especially in CI)
        const iterations = (await db<PlatformDB>().selectFrom("system.managedtasks").select("iterations").where("id", "=", taskinfo.dbid).executeTakeFirst())?.iterations || 0;
        await finalizeTaskResult(taskinfo, {
          nextattempt: nextRetry,
          iterations: iterations + 1,
          ...(taskresponse.newData === undefined ? {} : { taskdata: encodeHSON(taskresponse.newData as IPCMarshallableData) }),
          ...(taskresponse.auxData === undefined ? {} : { auxdata: WebHareBlob.from(encodeHSON(taskresponse.auxData as IPCMarshallableData)) }),
          lasterrors: "",
        }, { skipCancelled: true });

        if (taskresponse.newData === undefined)
          delete taskresponse.newData;
        if (taskresponse.auxData === undefined)
          delete taskresponse.auxData;
      } break;

      default:
        throw new Error(`Unrecognized task result type ${(taskresponse as { type: string }).type}`);
    }

    //result is allowed to be undefined, but IPC doesn't like that, so map that to null (DEFAULT RECORD)
    return { type: "taskdone", result: taskresponse.result ?? null };
  } catch (e) {
    if (typeof e === "string" || e instanceof Error)
      bridge.logError(e, { contextinfo: { context: "managedtask", ...pick(taskinfo, ["tasktype", "dbid"]) } });

    if (isWorkOpen())
      await rollbackWork();

    //TODO Why aren't we using IPC encoded exceptions?
    return { type: "taskfailed", error: (e as Error).message || String(e), trace: parseTrace(e as Error), isfatal: false };
  }
}
