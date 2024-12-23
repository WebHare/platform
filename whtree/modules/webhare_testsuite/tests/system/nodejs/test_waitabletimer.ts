///@ts-ignore -- FIXME port waitabletimer.es to TypeScript
import { WaitableTimer } from "@mod-system/js/internal/util/waitabletimer";
import * as test from "@webhare/test";

async function testInitialState() {
  const timer = new WaitableTimer;

  //it("is not signalled according to waitSignalled", function (callback)
  {
    let fulfilled = false;
    // don't wanna wait on promise here
    void timer.waitSignalled().then(() => fulfilled = true);
    await test.sleep(10);
    test.assert(!fulfilled, "Initial state is immediately signalled according to waitSignalled");
  }

  //it("is not signalled according to waitNotSignalled", function (callback)
  {
    let fulfilled = false;
    void timer.waitNotSignalled().then(() => fulfilled = true);
    await test.sleep(10);
    test.assert(fulfilled, "Initial state is immediately signalled according to waitNotSignalled");
  }
}

async function testBasicManipulation() {
  //it("isn't immediately signalled after setting", function (callback)
  {
    const timer = new WaitableTimer;

    let fulfilled = false;
    timer.reset(20);
    // don't wanna wait on promise here
    void timer.waitSignalled().then(() => fulfilled = true);
    await test.sleep(10);
    test.assert(!fulfilled, "Is immediately fulfilled when a timer was set");
  }

  //it("becomes signalled after a time", function (callback)
  {
    const timer = new WaitableTimer;

    let fulfilled = false;
    timer.reset(10);
    // don't wanna wait on promise here
    void timer.waitSignalled().then(() => fulfilled = true);

    await test.sleep(20);
    test.assert(fulfilled, "Is not fulfulled after the timer expired");
  }

  //it("stays signalled after expiring", function (callback)
  {
    const timer = new WaitableTimer;

    let fulfilled = false;
    timer.reset(10);

    await test.sleep(20);
    // don't wanna wait on promise here
    void timer.waitSignalled().then(() => fulfilled = true);

    await test.sleep(5);
    test.assert(fulfilled, "Doesn't stay fulfilled after timer expire");
  }

  //it("becomes unsignalled after resetting", function (callback)
  {
    const timer = new WaitableTimer;

    let fulfilled = false;
    timer.reset(10);

    await test.sleep(10);

    timer.reset(10);
    // don't wanna wait on promise here
    void timer.waitSignalled().then(() => fulfilled = true);

    await test.sleep(5);
    test.assert(!fulfilled, "Doesn't stay fulfilled after timer expire");

    await test.sleep(50);
    test.assert(fulfilled, "Doesn't become signalled after reset");
  }
}

test.runTests([testInitialState, testBasicManipulation]);
