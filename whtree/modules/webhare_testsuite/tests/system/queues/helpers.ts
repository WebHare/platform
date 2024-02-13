import { cancelManagedTasks } from "@webhare/services/src/tasks";
import { beginWork, commitWork } from "@webhare/whdb/src/whdb";


export async function testCancelManagedTasks(ids: number[]) {
  await beginWork();
  const res = await cancelManagedTasks(ids);
  await commitWork();

  return res.runningTasksStopped();
}
