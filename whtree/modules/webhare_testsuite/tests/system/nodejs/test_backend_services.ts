import * as test from "@webhare/test";
import * as services from "@webhare/services";
import { dumpActiveIPCMessagePorts } from "@mod-system/js/internal/whmanager/transport";
import { runBackendService } from "@webhare/services";
import { sleep } from "@webhare/std";

interface ProcessUndocumented {
  getActiveResourcesInfo(): string[];
}

async function getActiveMessagePortCount() {
  await new Promise(r => setTimeout(r, 5));
  const p: ProcessUndocumented = process as unknown as ProcessUndocumented;
  return p.getActiveResourcesInfo().filter((resourcename) => resourcename === "MessagePort").length;
}

async function testServiceState() {
  const instance1 = await services.openBackendService("webhare_testsuite:controlleddemoservice", ["instance1"], { linger: true });
  const instance2 = await services.openBackendService("webhare_testsuite:controlleddemoservice", ["instance2"], { linger: true });
  const instance3 = await services.openBackendService("webhare_testsuite:controlleddemoservice", ["instance3"], { linger: true });

  test.assert(!("emit" in instance1), "although close() is (re)defined, emit should never be visible");

  const instance1closed = new Promise<void>(resolve => instance1.addEventListener("close", () => resolve(), { once: true }));
  const instance3closed = new Promise<void>(resolve => instance3.addEventListener("close", () => resolve(), { once: true }));

  test.assert(!('onClose' in instance2), "onClose is a server-side callback and shouldn't be transmitted runtime");
  ///@ts-expect-error onClose shouldn't be there
  test.typeAssert<test.Extends<typeof instance2, { onClose: unknown }>>();

  const randomkey = "KEY" + Math.random();
  await instance1.setShared(randomkey);
  test.eq(randomkey, await instance2.getShared());
  test.eq(["instance1", "instance2", "instance3"], await instance2.getConnections());

  instance1.close();
  await instance1closed;
  await test.wait(async () => JSON.stringify(["instance2", "instance3"]) === JSON.stringify(await instance2.getConnections()));

  const closer = instance2.closeConnection("instance3");
  await instance3closed;

  await test.wait(async () => JSON.stringify(["instance2"]) === JSON.stringify(await instance2.getConnections()));
  await closer;

  instance2.close();
}

async function testDisconnects() {
  const instance1 = await services.openBackendService<any>("webhare_testsuite:demoservice", ["instance1"], { linger: true });
  const instance2 = await services.openBackendService<any>("webhare_testsuite:demoservice", ["instance2"], { linger: true });

  //Send a message to instance 1 and immediately disconnect it. then try instance 2 and see if the service got killed because we dropped the outgoing line
  const promise = instance1.getAsyncLUE(); //the demoservice should delay 50ms before responding, giving us time to kill the link..
  await sleep(1); //give the command time to be flushed
  instance1.close(); //kill the link
  await test.throws(/Request is cancelled, link was closed/, promise, `Request should throw`);

  await sleep(100); //give the demoservice time to answer. we know it's a racy test so it might give false positives..
  // verify the services stil lwork
  test.eq(42, await instance2.getAsyncLUE());
  instance2.close(); //kill the second link

  test.eq(0, await getActiveMessagePortCount());
}

async function testServiceTimeout() {
  const customservicename = "webhare_testsuite:servicetimeouttest_" + Math.random();
  await test.throws(/Service.*is unavailable/, services.openBackendService(customservicename, [], { timeout: 100 }));

  const slowserviceconnection = services.openBackendService<any>(customservicename, [], { timeout: 3000 });
  await sleep(100); //give the connection time to fail

  //set it up
  const customservice = await runBackendService(customservicename, () => new class extends services.BackendServiceConnection { whatsMyName() { return "doggie dog"; } });
  const slowserviceconnected = await slowserviceconnection;
  test.eq("doggie dog", await slowserviceconnected.whatsMyName());
  customservice.close();
  slowserviceconnected.close();

  test.eq(0, await getActiveMessagePortCount());
}

async function runBackendServiceTest_JS() {
  await test.throws(/Service 'webharedev_jsbridges:nosuchservice' is unavailable.*/, services.openBackendService("webharedev_jsbridges:nosuchservice", ["x"], { timeout: 300, linger: true }));
  await new Promise(r => setTimeout(r, 5));
  test.eq(0, await getActiveMessagePortCount());

  test.assert(await services.openBackendService("webhare_testsuite:demoservice"), "Fails in HS but works in JS as invalid # of arguments is not an issue for JavaScript");
  test.eq(0, await getActiveMessagePortCount(), "Failed and closed attempts above should not have kept a pending reference");

  dumpActiveIPCMessagePorts();
  await test.throws(/abort/, services.openBackendService("webhare_testsuite:demoservice", ["abort"]));
  test.eq(0, await getActiveMessagePortCount(), "Failed and closed attempts above should not have kept a pending reference");

  const serverinstance = await services.openBackendService<any>("webhare_testsuite:demoservice", ["x"]);
  test.eq(42, await serverinstance.getLUE());
  test.eq(undefined, await serverinstance.voidReturn());

  test.assert(serverinstance._invisible === undefined, "Should not see _prefixed APIs");
  test.assert(serverinstance.dummy === undefined, "Should not see variables");
  test.assert(serverinstance.emit === undefined, "Should not see 'emit'");

  let promise = serverinstance.getAsyncLUE();
  test.eq(42, await serverinstance.getLUE());
  test.eq(42, await promise);

  test.eq("-1", await serverinstance.getShared(), "Verify ths instance does not see a shared controller");

  await test.throws(/Crash/, serverinstance.crash());

  promise = serverinstance.getAsyncLUE();
  const promise2 = serverinstance.getAsyncCrash();

  await test.throws(/Async crash/, promise2);

  test.eq({ arg1: 41, arg2: new Date("2024-01-01") }, await serverinstance.ping(41, new Date("2024-01-01")));
  test.eq({ arg1: 41, arg2: new Date("2024-01-01") }, await serverinstance.asyncPing(41, new Date("2024-01-01")));

  test.eq({ arg1: 45, arg2: { contact: { contactNo: "C1" } } }, await serverinstance.ping(45, { contact: { contactNo: "C1" } }));

  test.eq(0, await getActiveMessagePortCount(), "Our version of the demoservice wasn't lingering, so no references");
  serverinstance.close();
  test.eq(0, await getActiveMessagePortCount(), "and close() should have no effect");

  const secondinstance = await services.openBackendService("webhare_testsuite:demoservice", ["x"], { linger: true });
  test.eq(1, await getActiveMessagePortCount(), "With linger, we take a reference");
  secondinstance.close();
  test.eq(0, await getActiveMessagePortCount(), "and close() should drop that reference");
}

async function runBackendServiceTest_HS() {
  await test.throws(/Invalid/, services.openBackendService("webhare_testsuite:webhareservicetest"), "HareScript version *requires* a parameter");
  await test.throws(/abort/, services.openBackendService("webhare_testsuite:webhareservicetest", ["abort"]));

  test.eq(0, await getActiveMessagePortCount(), "Failed attempts above should not have kept a pending reference");

  const serverinstance: any = await services.openBackendService("webhare_testsuite:webhareservicetest", ["x"], { linger: true });
  test.eq(1, await getActiveMessagePortCount(), "services.openBackendService should immediately keep a reference open");
  test.eq(42, await serverinstance.GETLUE());

  let promise = serverinstance.GETASYNCLUE();
  test.eq(42, await serverinstance.GETLUE());
  test.eq(42, await promise);

  await test.throws(/Crash/, serverinstance.CRASH());

  promise = serverinstance.GETASYNCLUE();
  const promise2 = serverinstance.GETASYNCCRASH();

  await test.throws(/Async crash/, promise2);

  test.eq({ arg1: 41, arg2: 43 }, await serverinstance.PING(41, 43));
  test.eq({ arg1: 41, arg2: 43 }, await serverinstance.ASYNCPING(41, 43));

  //test undefined
  test.eq({ arg1: null, arg2: [0, null, null, 2, { a: 3, c: null }] }, await serverinstance.PING(undefined, [0, undefined, null, 2, { a: 3, b: undefined, c: null }]));

  serverinstance.close();
  test.eq(0, await getActiveMessagePortCount(), "And the reference should be cleaned after close");
}

async function runBackendServiceTest_Events() {
  const serviceJS = await services.openBackendService<any>("webhare_testsuite:demoservice", ["x"], { linger: true });

  const waiterJS = new Promise<number>(resolve => serviceJS.addEventListener("testevent", (evt: Event) => resolve((evt as CustomEvent<number>).detail), { once: true }));
  serviceJS.emitTestEvent({ start: 12, add: 13 }).catch(() => { }); //ignore exception usuaslly triggered by the close below (TODO is there any fix for that?)
  test.eq(25, await waiterJS);
  serviceJS.close();

  const serviceHS = await services.openBackendService<any>("webhare_testsuite:webhareservicetest", ["x"], { linger: true });

  const waiterHS = new Promise<unknown>(resolve => serviceHS.addEventListener("testevent", (evt: Event) => resolve((evt as CustomEvent<number>).detail), { once: true }));
  serviceHS.emitTestEvent({ start: 12, add: 13 }).catch(() => { }); //ignore exception usuaslly triggered by the close below (TODO is there any fix for that?)
  test.eq({ start: 12, add: 13 }, await waiterHS); //HS services not as cool to calcuate things
  serviceHS.close();
}


test.runTests(
  [
    testServiceState,
    testDisconnects,
    testServiceTimeout,
    runBackendServiceTest_JS,
    runBackendServiceTest_HS,
    runBackendServiceTest_Events,
  ]);
