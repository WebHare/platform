import { AsyncWorker } from "@mod-system/js/internal/worker";
import { loadlib } from "@webhare/harescript";
import { CodeContext } from "@webhare/services/src/codecontexts";
import * as test from "@webhare/test";
import * as v8 from "node:v8";

async function testMessagePortLeak() {
  // the portclosers used for messageports kept the port alive (and through the callbacks, a lot more)
  // this tests if the messageports for localservices and asyncworkers aren't kept alive

  async function testFunc(i: number) {
    const c = new CodeContext(`run ${i}`);
    await c.run(async () => {
      await loadlib("mod::webhare_testsuite/tests/jssdk/harescript/data/invoketarget.whlib").LockUnlockMutex();

      const w = new AsyncWorker;
      w.close();

    });
    await c.close();

  }

  const d1 = v8.queryObjects(MessagePort, { format: "count" });

  for (let i = 0; i < 100; ++i) {
    await testFunc(i);
  }

  // sleep over the async worker grace periods
  await test.sleep(2000);

  await test.triggerGarbageCollection();
  const d2 = v8.queryObjects(MessagePort, { format: "count" });

  // Expected increase: 6
  test.assert(d2 < d1 + 10, `MessagePort count increased from ${d2} to ${d1}, delta > 10`);
}

test.runTests([
  testMessagePortLeak,
]);
