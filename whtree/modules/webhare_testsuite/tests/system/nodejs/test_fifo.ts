///@ts-ignore -- FIXME port fifo.es to TypeScript
import { FIFO } from "@mod-system/js/internal/util/fifo";
import * as test from "@webhare/test";

async function testInitialState() {
  const fifo = new FIFO;

  //it("is not signalled according to waitSignalled", function (callback)
  {
    let fulfilled = false;
    // don't wanna wait on promise here
    void fifo.waitSignalled().then(() => fulfilled = true);
    await test.sleep(20);
    test.assert(!fulfilled, "Initial state is immediately signalled according to waitSignalled");
  }

  //it("is not signalled according to waitNotSignalled", function (callback)
  {
    let fulfilled = false;
    // don't wanna wait on promise here
    void fifo.waitNotSignalled().then(() => fulfilled = true);
    await test.sleep(20);
    test.assert(fulfilled, "Initial state is immediately signalled according to waitNotSignalled");
  }

  //it("does not return an element on shift", function ()
  {
    test.eq(undefined, fifo.shift());
  }
}

async function testBasicManipulation() {
  //it("returns pushed elements in fifo order", function ()
  {
    const fifo = new FIFO;
    fifo.push(1);
    fifo.push(2);

    test.eq(1, fifo.shift());
    test.eq(2, fifo.shift());
    test.eq(undefined, fifo.shift());
  }
}


async function testGoingFromNotSignalledToSignalledWhenAnElementIsPushed() {
  const fifo = new FIFO;

  //it("fulfills the wait promise", function (callback)
  {
    let fulfilled = false;
    // don't wanna wait on promise here
    void fifo.waitSignalled().then(() => fulfilled = true);
    fifo.push(1);
    await test.sleep(20);
    test.assert(fulfilled, "Previous wait promise isn't resolved on push");
  }

  //it("stays signalled after that", function (callback)
  {
    let fulfilled = false;
    // don't wanna wait on promise here
    void fifo.waitSignalled().then(() => fulfilled = true);
    await test.sleep(20);
    test.assert(fulfilled, "Wait promise is not immediately resolved when not empty");
  }
}

async function testGoingFromSignalledToNotSignalled() {
  const fifo = new FIFO;
  fifo.push(1);

  //it("fulfills the wait promise", function (callback)
  {
    let fulfilled = false;
    // don't wanna wait on promise here
    void fifo.waitNotSignalled().then(() => fulfilled = true);
    test.eq(1, fifo.shift());

    await test.sleep(20);
    test.assert(fulfilled, "Previous not-signalled wait promise isn't resolved when the fifo becomes empty");
  }

  //it("stays unsignalled after that", function (callback)
  {
    let fulfilled = false;
    // don't wanna wait on promise here
    void fifo.waitNotSignalled().then(() => fulfilled = true);

    await test.sleep(20);
    test.assert(fulfilled, "Non-signalled wait promise is resolved when the fifo is empty");
  }
}

test.runTests([testInitialState, testBasicManipulation, testGoingFromNotSignalledToSignalledWhenAnElementIsPushed, testGoingFromSignalledToNotSignalled]);
