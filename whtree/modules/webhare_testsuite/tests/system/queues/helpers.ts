import { cancelTask } from "@webhare/tasks";
import { beginWork, commitWork } from "@webhare/whdb/src/whdb";


export async function testCancelManagedTasks(ids: number[]) {
  await beginWork();
  const res = await cancelTask(ids);
  await commitWork();

  return res.tasksCancelled();
}
