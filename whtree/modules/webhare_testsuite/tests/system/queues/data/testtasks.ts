import { TaskRequest, TaskResponse, readRegistryKey } from "@webhare/services";
import { beginWork } from "@webhare/whdb";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { sleep } from "@webhare/std";

interface PingTask {
  ping: number | string;
}

export async function pingJS(req: TaskRequest<PingTask>): Promise<TaskResponse> {
  await beginWork();
  if (req.taskdata.ping === "CANCEL")
    return req.resolveByCancellation(req.taskdata, "ping=CANCEL");
  if (req.taskdata.ping === "ABORT")
    process.exit(162);
  if (req.taskdata.ping === "THROWNOW" && await readRegistryKey("webhare_testsuite.tests.taskthrownow"))
    throw new Error("PING-TASK-Throw-Now"); //TODO also verify throwing outside beginWork

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
