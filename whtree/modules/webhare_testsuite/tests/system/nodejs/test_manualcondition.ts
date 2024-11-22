///@ts-ignore -- FIXME port manualcondition.es to TypeScript
import { ManualCondition } from "@mod-system/js/internal/util/manualcondition";
import * as test from "@webhare/test";

async function testInitialState() {
  const mc = new ManualCondition;

  //it("is not signalled according to waitSignalled", function (callback)
  {
    let fulfilled = false;
    // don't wanna wait for the promise to resolve
    void mc.waitSignalled().then(() => fulfilled = true);
    await test.sleep(20);
    test.assert(!fulfilled, "Initial state is immediately signalled according to waitSignalled");
  }

  //it("is not signalled according to waitNotSignalled", function (callback)
  {
    let fulfilled = false;
    // don't wanna wait for the promise to resolve
    void mc.waitNotSignalled().then(() => fulfilled = true);
    await test.sleep(20);
    test.assert(fulfilled, "Initial state is immediately signalled according to waitNotSignalled");
  }
}

async function testGoingFromNotSignalledToSignalled() {
  const mc = new ManualCondition;

  //it("fulfills the wait promise", function (callback)
  {
    let fulfilled = false;
    // don't wanna wait for the promise to resolve
    void mc.waitSignalled().then(() => fulfilled = true);
    mc.setSignalled(true);
    await test.sleep(20);

    test.assert(fulfilled, "Previous wait promise isn't resolved when the condition becomes signalled");
  }

  //it("stays signalled after that", function (callback)
  {
    let fulfilled = false;
    // don't wanna wait for the promise to resolve
    void mc.waitSignalled().then(() => fulfilled = true);
    await test.sleep(20);
    test.assert(fulfilled, "Wait promise isn't resolved immediately when the condition is signalled");
  }
}

async function testGoingFromSignalledToNotSignalled() {
  const mc = new ManualCondition;
  mc.setSignalled(true);

  //it("fulfills the wait promise", function (callback)
  {
    let fulfilled = false;
    // don't wanna wait for the promise to resolve
    void mc.waitNotSignalled().then(() => fulfilled = true);
    mc.setSignalled(false);
    await test.sleep(20);
    test.assert(fulfilled, "Previous non-signalled wait promise is resolved when the condition becomes unsignalled");
  }


  //it("stays unsignalled after that", function (callback)
  {
    let fulfilled = false;
    // don't wanna wait for the promise to resolve
    void mc.waitNotSignalled().then(() => fulfilled = true);
    await test.sleep(20);
    test.assert(fulfilled, "Non-signalled wait promise isn't immediately resolved when the condition is unsignalled");
  }
}

test.run([testInitialState, testGoingFromNotSignalledToSignalled, testGoingFromSignalledToNotSignalled]);
