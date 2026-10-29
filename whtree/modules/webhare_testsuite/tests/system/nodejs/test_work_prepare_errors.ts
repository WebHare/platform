import * as test from "@webhare/test";
import { CodeContext } from "@webhare/services/src/codecontexts";
import { query, runInWork, onFinishWork, isWorkOpen } from "@webhare/whdb";

async function commitPreparationAndRollbackFailuresRemainVisible() {
  await using context = new CodeContext("commit preparation and rollback failures");
  const preparation = new Error("Synthetic commit preparation failure");
  const rollback = new Error("Synthetic first rollback preparation failure");
  let rollbackAttempts = 0;
  await context.run(async () => {
    await test.throws(error => error instanceof AggregateError && error.errors.length === 2
      && error.errors[0] === preparation && error.errors[1] === rollback,
    () => runInWork(async () => {
      onFinishWork({
        onBeforeCommit: () => { throw preparation; },
        onBeforeRollback: () => { if (++rollbackAttempts === 1) throw rollback; },
      });
    }));
    test.assert(rollbackAttempts >= 1, "Rollback preparation was attempted");
    test.eq(false, isWorkOpen(), "The interrupted Work is fully rolled back");
    test.eq(42, (await query<{ value: number }>("SELECT 42 AS value")).rows[0].value,
      "The connection remains usable after rollback finishes");
  });
}

test.runTests([commitPreparationAndRollbackFailuresRemainVisible]);
