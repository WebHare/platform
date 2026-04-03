import * as test from "@webhare/test";
import * as services from "@webhare/services";
import { dumpActiveIPCMessagePorts } from "@mod-system/js/internal/whmanager/transport";
import { runBackendService } from "@webhare/services";
import { generateRandomId, sleep } from "@webhare/std";
import type { BackendServiceProtocol } from "@webhare/services/src/backendservice";

let initialPipes = 0, initialPorts = 0;

interface ProcessUndocumented {
  getActiveResourcesInfo(): string[];
}

async function getPortCounts() {
  await new Promise(r => setTimeout(r, 5));
  const p: ProcessUndocumented = process as unknown as ProcessUndocumented;
  const res = p.getActiveResourcesInfo();
  return {
    pipes: res.filter((resourcename) => resourcename === "PipeWrap").length - initialPipes,
    ports: res.filter((resourcename) => resourcename === "MessagePort").length - initialPorts,
  };
}

async function prep() {
  //Make sure we don't count ports that are already there before we start testing. Eg under 'runtest' we'll already have 2 PipeWraps
  const initialState = await getPortCounts();
  initialPipes = initialState.pipes;
  initialPorts = initialState.ports;
}

async function testServiceState(protocol: BackendServiceProtocol) {
  const instance1 = await services.openBackendService("webhare_testsuite:controlleddemoservice", ["instance1-" + protocol], { linger: true, protocol });
  const instance2 = await services.openBackendService("webhare_testsuite:controlleddemoservice", ["instance2-" + protocol], { linger: true, protocol });
  const instance3 = await services.openBackendService("webhare_testsuite:controlleddemoservice", ["instance3-" + protocol], { linger: true, protocol });
  test.assert(!("emit" in instance1), `${protocol}: although close() is (re)defined, emit should never be visible`);

  const instance1closed = new Promise<void>(resolve => instance1.addEventListener("close", () => resolve(), { once: true }));
  const instance3closed = new Promise<void>(resolve => instance3.addEventListener("close", () => resolve(), { once: true }));

  test.assert(!('onClose' in instance2), `${protocol}: onClose is a server-side callback and shouldn't be transmitted runtime`);
  ///@ts-expect-error onClose shouldn't be there
  test.typeAssert<test.Extends<typeof instance2, { onClose: unknown }>>();

  const randomkey = "KEY" + Math.random();
  await instance1.setShared(randomkey);
  test.eq(randomkey, await instance2.getShared());
  test.eq(["instance1-" + protocol, "instance2-" + protocol, "instance3-" + protocol], await instance2.getConnections());

  instance1.close();
  await instance1closed;
  await test.wait(async () => JSON.stringify(["instance2-" + protocol, "instance3-" + protocol]) === JSON.stringify(await instance2.getConnections()));

  const closer = instance2.closeConnection("instance3-" + protocol);
  await instance3closed;

  await test.wait(async () => JSON.stringify(["instance2-" + protocol]) === JSON.stringify(await instance2.getConnections()));
  await closer;

  instance2.close();
}

async function testBasicService(protocol: BackendServiceProtocol) {
  class MyService extends services.BackendServiceConnection {
    constructor(public arg1?: string, public arg2?: string) { super(); }
    getArgs() { return [this.arg1 || "", this.arg2 || ""]; }
    whatsMyName() { return "doggie dog"; }
  }

  test.eq({ pipes: 0, ports: 0 }, await getPortCounts(), `${protocol}: initially we should have no open ports`);

  const customservicename = "webhare_testsuite:test_" + generateRandomId().toLowerCase();
  await test.throws(/Service.*is unavailable/, services.openBackendService(customservicename, [], { timeout: 100, protocol }));
  test.eq({ pipes: 0, ports: 0 }, await getPortCounts(), `${protocol}: services.openBackendService failed, should be no open ports`);

  const customservice = await runBackendService(customservicename, (arg1?: string, arg2?: string) => new MyService(arg1, arg2), { protocols: [protocol] });
  test.eq({ ports: protocol === "bridge" ? 1 : 0, pipes: protocol === "unix-socket" ? 1 : 0 }, await getPortCounts(), `${protocol}: Service opens a port`);

  const client = await services.openBackendService<MyService>(customservicename, [], { protocol });
  test.eq({ ports: protocol === "bridge" ? 2 : 0, pipes: protocol === "unix-socket" ? 3 : 0 }, await getPortCounts(), `${protocol}: openBackendService should immediately keep a reference open (and in unix we count both server & client side ports)`);
  test.eq("doggie dog", await client.whatsMyName());
  test.eq(["", ""], await client.getArgs(), `${protocol}: constructor arguments should be passed correctly`);
  client.close();

  const slowserviceconnection = services.openBackendService<any>(customservicename, ["Slow", "service"], { protocol, timeout: 3000 });
  await sleep(100); //give the connection time to fail

  const slowserviceconnected = await slowserviceconnection;
  test.eq("doggie dog", await slowserviceconnected.whatsMyName());
  test.eq(["Slow", "service"], await slowserviceconnected.getArgs(), `${protocol}: constructor arguments should be passed correctly`);
  customservice.close();
  slowserviceconnected.close();

  for (const disabledProtocol of ["bridge", "unix-socket"] satisfies BackendServiceProtocol[])
    if (protocol !== disabledProtocol)
      await test.throws(/Service.*is unavailable/, services.openBackendService(customservicename, [], { timeout: 100, protocol: disabledProtocol }));

  test.eq({ pipes: 0, ports: 0 }, await getPortCounts());
}

async function testDisconnects(protocol: BackendServiceProtocol) {
  let numClients = 0;

  class DisconnectingService extends services.BackendServiceConnection {
    constructor() {
      super();
      ++numClients;
    }
    async getAsyncLUE() {
      await new Promise(resolve => setTimeout(resolve, 50));
      return 42;
    }
    onClose() {
      --numClients;
    }
  }

  // debugFlags["ipc-unixsockets"] = true;
  const customservicename = "webhare_testsuite:disconnect_" + generateRandomId().toLowerCase();
  const customservice = await runBackendService(customservicename, () => new DisconnectingService, { protocols: [protocol] });

  const instance1 = await services.openBackendService<any>(customservicename, ["instance1"], { linger: true, protocol });
  const instance2 = await services.openBackendService<any>(customservicename, ["instance2"], { linger: true, protocol });
  await test.wait(() => numClients === 2, `${protocol}: Both clients should be connected and the service should see them`);

  //Send a message to instance 1 and immediately disconnect it. then try instance 2 and see if the service got killed because we dropped the outgoing line
  const promise = instance1.getAsyncLUE(); //the demoservice should delay 50ms before responding, giving us time to kill the link..
  await sleep(1); //give the command time to be flushed
  instance1.close(); //kill the link from our side
  await test.throws(/Request is cancelled, link was closed/, promise, `Request should throw`);
  await test.wait(() => numClients === 1, `${protocol}: Service should see the client has gone away`);

  await sleep(100); //give the demoservice time to answer. we know it's a racy test so it might give false positives..
  // verify the service still works
  test.eq(42, await instance2.getAsyncLUE());
  instance2.close(); //kill the second link
  await test.wait(() => numClients === 0, `${protocol}: Service should see the client has gone away`);

  customservice.close();
  test.eq({ pipes: 0, ports: 0 }, await getPortCounts());
}

async function testServiceTimeout(protocol: BackendServiceProtocol) {
  const customservicename = "webhare_testsuite:servicetimeouttest_" + Math.random();
  await test.throws(/Service.*is unavailable/, services.openBackendService(customservicename, [], { timeout: 100, protocol }));

  const slowserviceconnection = services.openBackendService<any>(customservicename, [], { timeout: 3000, protocol });
  await sleep(100); //give the connection time to fail

  //set it up
  const customservice = await runBackendService(customservicename, () => new class extends services.BackendServiceConnection { whatsMyName() { return "doggie dog"; } }, { protocols: [protocol] });
  const slowserviceconnected = await slowserviceconnection;
  test.eq("doggie dog", await slowserviceconnected.whatsMyName());
  customservice.close();
  slowserviceconnected.close();

  test.eq({ pipes: 0, ports: 0 }, await getPortCounts());
}

async function runBackendServiceTest_JS(protocol: BackendServiceProtocol) {
  await test.throws(/Service 'webharedev_jsbridges:nosuchservice' is unavailable.*/, services.openBackendService("webharedev_jsbridges:nosuchservice", ["x"], { timeout: 300, linger: true, protocol }));
  await new Promise(r => setTimeout(r, 5));
  test.eq({ pipes: 0, ports: 0 }, await getPortCounts());

  test.assert(await services.openBackendService("webhare_testsuite:demoservice", [], { protocol, awaitConstructor: true }), "Fails in HS but works in JS as invalid # of arguments is not an issue for JavaScript");
  test.eq({ pipes: 0, ports: 0 }, await getPortCounts(), "Failed and closed attempts above should not have kept a pending reference");

  dumpActiveIPCMessagePorts();
  //TODO test without awaitConstructor, test constructor without arguments (which doesn't trigger a RPC over unix-socket)
  await test.throws(/abort/, services.openBackendService("webhare_testsuite:demoservice", ["abort"], { protocol, awaitConstructor: true }), `${protocol}: Want to see 'abort' thrown`);
  test.eq({ pipes: 0, ports: 0 }, await getPortCounts(), "Failed and closed attempts above should not have kept a pending reference");

  const serverinstance = await services.openBackendService<any>("webhare_testsuite:demoservice", ["x"], { protocol });
  test.eq(42, await serverinstance.getLUE());
  test.eq(undefined, await serverinstance.voidReturn());

  test.assert(serverinstance._invisible === undefined, "Should not see _prefixed APIs");
  if (protocol === "bridge") { //unix-protocol just assumes everything exists
    test.assert(serverinstance.dummy === undefined, "Should not see variables");
  }
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

  test.eq({ pipes: 0, ports: 0 }, await getPortCounts(), "Our version of the demoservice wasn't lingering, so no references");
  serverinstance.close();
  test.eq({ pipes: 0, ports: 0 }, await getPortCounts(), "and close() should have no effect");

  const secondinstance = await services.openBackendService("webhare_testsuite:demoservice", ["x"], { linger: true, protocol });
  if (protocol === "bridge")
    test.eq({ pipes: 0, ports: 1 }, await getPortCounts(), "With linger, we take a reference");
  else
    test.eq({ pipes: 1, ports: 0 }, await getPortCounts(), "With linger, we take a reference");
  secondinstance.close();
  test.eq({ pipes: 0, ports: 0 }, await getPortCounts(), "and close() should drop that reference");
}

async function runBackendServiceTest_HS() {
  await test.throws(/Invalid/, services.openBackendService("webhare_testsuite:webhareservicetest"), "HareScript version *requires* a parameter");
  await test.throws(/abort/, services.openBackendService("webhare_testsuite:webhareservicetest", ["abort"]));

  test.eq({ pipes: 0, ports: 0 }, await getPortCounts(), "Failed attempts above should not have kept a pending reference");

  const serverinstance: any = await services.openBackendService("webhare_testsuite:webhareservicetest", ["x"], { linger: true });
  test.eq({ pipes: 0, ports: 1 }, await getPortCounts(), "services.openBackendService should immediately keep a reference open");
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
  test.eq({ pipes: 0, ports: 0 }, await getPortCounts(), "And the reference should be cleaned after close");
}

async function runBackendServiceTest_Events(protocol: BackendServiceProtocol) {
  const serviceJS = await services.openBackendService<any>("webhare_testsuite:demoservice", ["x"], { linger: true, protocol });

  const waiterJS = new Promise<number>(resolve => serviceJS.addEventListener("testevent", (evt: Event) => resolve((evt as CustomEvent<number>).detail), { once: true }));
  serviceJS.emitTestEvent({ start: 12, add: 13 }).catch(() => { }); //ignore exception usuaslly triggered by the close below (TODO is there any fix for that?)
  test.eq(25, await waiterJS);
  serviceJS.close();

  if (protocol === "bridge") { //unix-socket can't connect to legacy HS services. we probably won't ever really need to
    const serviceHS = await services.openBackendService<any>("webhare_testsuite:webhareservicetest", ["x"], { linger: true, protocol });

    const waiterHS = new Promise<unknown>(resolve => serviceHS.addEventListener("testevent", (evt: Event) => resolve((evt as CustomEvent<number>).detail), { once: true }));
    serviceHS.emitTestEvent({ start: 12, add: 13 }).catch(() => { }); //ignore exception usuaslly triggered by the close below (TODO is there any fix for that?)
    test.eq({ start: 12, add: 13 }, await waiterHS); //HS services not as cool to calcuate things
    serviceHS.close();
  }
}


test.runTests(
  [
    prep,
    () => testServiceState("bridge"),
    () => testServiceState("unix-socket"),
    () => testBasicService("bridge"),
    () => testBasicService("unix-socket"),
    () => testDisconnects("bridge"),
    () => testDisconnects("unix-socket"),
    () => testServiceTimeout("bridge"),
    () => testServiceTimeout("unix-socket"),
    () => runBackendServiceTest_JS("bridge"),
    () => runBackendServiceTest_JS("unix-socket"),
    runBackendServiceTest_HS,
    () => runBackendServiceTest_Events("bridge"),
    () => runBackendServiceTest_Events("unix-socket"),
  ]);
