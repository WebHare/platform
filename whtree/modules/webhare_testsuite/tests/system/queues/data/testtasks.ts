import { type TaskRequest, type TaskResponse, readRegistryKey, scheduleTask } from "@webhare/services";
import { beginWork } from "@webhare/whdb";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { sleep } from "@webhare/std";

interface PingTask {
  ping: number | string;
  extraping?: number;
  javascript?: boolean;
}

export async function pingJS(req: TaskRequest<PingTask>): Promise<TaskResponse> { //implements webhare_testsuite:ping_js AND webhare_testsuite:pingretry2_js
  await beginWork();
  if (req.numFailures === 1)
    return req.resolveByTemporaryFailure("Failed once!");
  if (req.taskdata.ping === "CANCEL")
    return req.resolveByCancellation({ data: req.taskdata }, "ping=CANCEL");
  if (req.taskdata.ping === "ABORT")
    process.exit(162);
  if (req.taskdata.ping === "THROWNOW" && await readRegistryKey("webhare_testsuite.tests.taskthrownow"))
    throw new Error("PING-TASK-Throw-Now"); //TODO also verify throwing outside beginWork

  if (req.taskdata.extraping)
    return req.resolveByCompletion({ pong: req.taskdata.ping, managedtaskid: req.taskid, extrataskid: await scheduleTask("webhare_testsuite:ping_js", { ping: req.taskdata.extraping }) });

  return req.resolveByCompletion({ pong: req.taskdata.ping, managedtaskid: req.taskid });
}

export async function cancellabletaskJS(req: TaskRequest<never>): Promise<TaskResponse> {
  const port = bridge.connect("webhare_testsuite:cancellable_connectport_js", { global: true });
  await sleep(20000);
  port.send({ msg: "I'm still alive" });
  await beginWork();
  return req.resolveByCompletion();
}

export async function timelimitedtaskJS(req: TaskRequest<{ sleep: number }>): Promise<TaskResponse> {
  await sleep(req.taskdata.sleep);
  await beginWork();
  return req.resolveByCompletion(req.taskdata);
}

export async function failingTaskJS(req: TaskRequest<{ temporary?: boolean; nextretry?: Date | null } | null>): Promise<TaskResponse> {
  await beginWork();

  if (req.taskdata?.temporary !== false) {
    const opts = {
      result: { type: "failedtemporarily" },
      ...(req.taskdata && "nextretry" in req.taskdata ? { nextRetry: req.taskdata.nextretry } : {})
    };
    return req.resolveByTemporaryFailure("Failure", opts);
  } else
    return req.resolveByPermanentFailure("Permanent failure", { result: { type: "failed" } });
}

export async function doubleScheduleTaskJS(req: TaskRequest<{ t: number; iters: number; stage: number }>): Promise<TaskResponse> {
  const link = bridge.connect("webhare_testsuite:doubleschedule_connectport_js", { global: true });
  await link.activate();
  link.send({ msg: `I'm alive ${req.taskdata.t}: stage ${req.taskdata.stage.toString().padStart(6, "0")}` });
  link.close();

  await beginWork();
  if (req.taskdata.stage < req.taskdata.iters) {
    // Sleep a bit after the commit
    //GetPrimary()->RegisterCommitHandler("", PTR this->GotCommit);

    for (let i = 0; i < req.taskdata.stage; i++) {
      bridge.sendEvent(`webhare_testsuite:eventpilefiller.${req.taskdata.stage}.${i}`, {});
    }

    return req.resolveByRestart(new Date(), { newData: { ...req.taskdata, stage: req.taskdata.stage + 1 } });
  } else {
    return req.resolveByCompletion({});
  }
}
