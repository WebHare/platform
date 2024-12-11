import * as test from "@webhare/test";
import { MessagePort, MessageChannel, isMainThread } from "node:worker_threads";
import { AsyncWorker } from "@mod-system/js/internal/worker";
import { triggerGarbageCollection } from "@webhare/test";
import { createReturnValueWithTransferList } from "@webhare/services/src/localservice";
import { RestAPIWorkerPool } from "@mod-system/js/internal/openapi/workerpool";


export class myTestClass {
  base: number;
  constructor(base: number) {
    this.base = base;
  }
  returnAplusB(b: number) {
    return this.base + b;
  }
  async returnAplusBAsync(b: number) {
    await new Promise(resolve => setTimeout(resolve, 1));
    return this.base + b;
  }
  async portTest(port: MessagePort) {
    // Receive the message from the transferred port and return it over the port
    const message = await new Promise(resolve => port.addListener("message", resolve));
    port.postMessage({ message, returned: true });
    // unref the port, so the caller can use the close event to check the worker is gone
    port.unref();

    // Create a port to return to test createReturnValueWithTransferList
    const channel = new MessageChannel();
    channel.port1.postMessage({ message: "sent" });
    channel.port1.unref();
    return createReturnValueWithTransferList({ port: channel.port2 }, [channel.port2]);
  }
}

export function myFactory(a: number) {
  return new myTestClass(a);
}

export async function myAsyncFactory(a: number) {
  return new myTestClass(a);
}

export function myTestFunc(a: number, b: number) {
  return a + b;
}

export async function myTestFuncAsync(a: number, b: number) {
  await new Promise(resolve => setTimeout(resolve, 1));
  return a + b;
}

export async function myRecursiveTest(a: number, b: number) {
  const subworker = new AsyncWorker;
  return await subworker.callRemote(`${__filename}#myTestFuncAsync`, a, b);
}

export async function throwUncaughtError() {
  setImmediate(() => { throw new Error(`Uncaught error: boem`); });
  await new Promise(resolve => setTimeout(resolve, 1000));
  return true;
}

let signalPortClosed: Promise<void>;

async function runWorkerTest() {
  const worker = new AsyncWorker;

  // Test async calls
  const r = await worker.newRemoteObject<myTestClass>(`${__filename}#myTestClass`, 10);
  test.eq(14, await r.returnAplusB(4));
  test.eq(15, await r.returnAplusBAsync(5));
  test.eq(18, await worker.callRemote(`${__filename}#myTestFunc`, 11, 7));
  test.eq(20, await worker.callRemote(`${__filename}#myTestFuncAsync`, 12, 8));
  test.eq(22, await worker.callRemote(`${__filename}#myRecursiveTest`, 13, 9));

  const r2 = await worker.callFactory<myTestClass>(`${__filename}#myFactory`, 16);
  test.eq(21, await r2.returnAplusB(5));

  const r3 = await worker.callFactory<myTestClass>(`${__filename}#myAsyncFactory`, 17);
  test.eq(23, await r3.returnAplusB(6));

  const channel = new MessageChannel;
  // Call portTest, transfer port2 to it
  const res = r.portTest.callWithTransferList([channel.port2], channel.port2);
  channel.port1.postMessage("test");
  signalPortClosed = new Promise(resolve => channel.port1.addListener("close", resolve));
  // Wait for message to return
  const returnedMessage = await test.wait(new Promise(resolve => channel.port1.addListener("message", resolve)), `Function should return a message`);
  test.eq({ message: "test", returned: true }, returnedMessage);
  const retval = await test.wait(res, `Function should return after returning the received message`);
  const portMessage = await test.wait(new Promise(resolve => retval.port.addListener("message", resolve)));
  test.eq({ message: "sent" }, portMessage);
}

async function runCleanupTest() {
  // after the worker and the remote calls go out of scope, the worker should terminate by itself
  // and the signalPort (whose counterpart port has been unref'd inside the worker) should close

  await triggerGarbageCollection();
  await test.wait(signalPortClosed, "Worker should have terminated");
}

async function workerPoolTest() {
  const pool = new RestAPIWorkerPool("test", 1, 10);
  // Worker should function as expected
  test.eq(18, await pool.runInWorker(async worker => {
    return worker.callRemote(`${__filename}#myTestFunc`, 11, 7);
  }));
  // Uncaught error should be caught and rethrown
  test.throws(/Worker exited with code 1/, async () => await pool.runInWorker(async worker => {
    return worker.callRemote(`${__filename}#throwUncaughtError`);
  }));
  test.eq(18, await pool.runInWorker(async worker => {
    return worker.callRemote(`${__filename}#myTestFunc`, 11, 7);
  }));
}

// Only run the tests in the main thread
if (isMainThread) {
  test.run([
    runWorkerTest,
    runCleanupTest,
    workerPoolTest,
  ]);
}
