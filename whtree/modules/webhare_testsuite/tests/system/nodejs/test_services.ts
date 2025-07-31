import * as test from "@webhare/test";
import * as services from "@webhare/services";
import type { GenericLogLine } from "@webhare/services/src/logging";
import { readJSONLogLines } from "@mod-system/js/internal/logging";
import { dumpActiveIPCMessagePorts } from "@mod-system/js/internal/whmanager/transport";
import { importJSFunction, runBackendService } from "@webhare/services";
import { createVM, type HSVMObject, loadlib, type HSVMWrapper } from "@webhare/harescript";
import { addDuration, isTemporalInstant, sleep } from "@webhare/std";
import type { ConfigurableSubsystem } from "@mod-platform/js/configure/applyconfig";
import { checkModuleScopedName } from "@webhare/services/src/naming";
import { storeDiskFile } from "@webhare/system-tools";
import { rm } from "node:fs/promises";
import type { TestClass } from "./data/calls2";
import { getVersionInteger } from "@mod-system/js/internal/configuration";

function ensureProperPath(inpath: string) {
  test.eq(/^\/.+\/$/, inpath, `Path should start and end with a slash: ${inpath}`);
  test.assert(!inpath.includes("//"), `Path should not contain duplicate slashes: ${inpath}`);
}

async function testServices() {
  test.typeAssert<test.Assignable<ConfigurableSubsystem, "wrd">>();
  //@ts-expect-error -- Verify ConfigurableSubsystem is not just a string
  test.typeAssert<test.Assignable<ConfigurableSubsystem, "anything">>();

  test.assert(checkModuleScopedName("aa:aa"));
  test.assert(checkModuleScopedName("aa:11"));
  test.assert(checkModuleScopedName("a_a:a-a"));
  test.assert(checkModuleScopedName("a_a:a.a"));
  test.assert(checkModuleScopedName("a_a:a_a"));

  test.throws(/Invalid name.*/, () => checkModuleScopedName("11:11"));
  test.throws(/Invalid name.*/, () => checkModuleScopedName("a-a:a-a"));
  test.throws(/Invalid name.*/, () => checkModuleScopedName("a-a:a.a"));
  test.throws(/Invalid name.*/, () => checkModuleScopedName("a-a:a_a"));

  test.throws(/Invalid name.*/, () => checkModuleScopedName("a:aa"));
  test.throws(/Invalid name.*/, () => checkModuleScopedName("aa:a"));
  test.throws(/Invalid name.*/, () => checkModuleScopedName("Aa:aa"));
  test.throws(/Invalid name.*/, () => checkModuleScopedName("aA:aa"));
  test.throws(/Invalid name.*/, () => checkModuleScopedName("aa:Aa"));
  test.throws(/Invalid name.*/, () => checkModuleScopedName("aa:aA"));
  test.throws(/Invalid name.*/, () => checkModuleScopedName("_a:aa"));
  test.throws(/Invalid name.*/, () => checkModuleScopedName("a_:aa"));
  test.throws(/Invalid name.*/, () => checkModuleScopedName("aa:_a"));
  test.throws(/Invalid name.*/, () => checkModuleScopedName("aa:a_"));
  test.throws(/Invalid name.*/, () => checkModuleScopedName("aa:a."));
  test.throws(/Invalid name.*/, () => checkModuleScopedName("aa:a-"));
  test.throws(/Invalid name.*/, () => checkModuleScopedName("aa:aa:aa"));
  test.throws(/Invalid name.*/, () => checkModuleScopedName("system_aa:aa"));
  test.throws(/Invalid name.*/, () => checkModuleScopedName("wh_aa:aa"));

  test.assert(services.backendConfig);
  test.assert(await services.isWebHareRunning()); //But it's hard to test it returning "false" for the test framework
  test.eq(/^[\d]+\.[\d].[\d]+$/, services.backendConfig.whVersion, "Assert semantic version - and assuming we'll never want build suffixes etc in this version");
  test.assert(getVersionInteger() > 0, "Make sure getVersionInteger() doesn't fail/throw");

  //@ts-expect-error Verify invoking LoadJSFunction without a type signature is a TS error
  await importJSFunction("@webhare/services#log");

  test.eq(53, (await importJSFunction<() => number>("mod::webhare_testsuite/tests/system/nodejs/data/calls2.ts#testSync53"))());
  test.eq(58, (await importJSFunction<() => number>("mod::webhare_testsuite/tests/system/nodejs/data/calls2.ts#default"))());
  test.eq(58, (await importJSFunction<() => number>("mod::webhare_testsuite/tests/system/nodejs/data/calls2.ts"))());
  test.eq(63, (await importJSFunction<() => number>("mod::webhare_testsuite/tests/system/nodejs/data/calls-js.js#default"))());
  test.eq(63, (await importJSFunction<() => number>("mod::webhare_testsuite/tests/system/nodejs/data/calls-js.js"))());
  test.eq(67, (await importJSFunction<() => number>("mod::webhare_testsuite/tests/system/nodejs/data/calls-cjs.cjs#default"))());
  test.eq(67, (await importJSFunction<() => number>("mod::webhare_testsuite/tests/system/nodejs/data/calls-cjs.cjs"))());

  await test.throws(/is not a function but of type object/, () => importJSFunction<any>("mod::webhare_testsuite/tests/system/nodejs/data/calls2.ts#testInstance"));

  test.eq(44, (await services.importJSObject<TestClass>("mod::webhare_testsuite/tests/system/nodejs/data/calls2.ts#TestClass")).get44());
  test.eq(45, (await services.importJSObject<TestClass>("mod::webhare_testsuite/tests/system/nodejs/data/calls2.ts#TestClass", 45)).getArg());
  test.eq(59, (await services.importJSObject<TestClass>("mod::webhare_testsuite/tests/system/nodejs/data/calls2.ts#testInstance")).getArg());

  const runoncekey = await services.readRegistryKey("webhare_testsuite:tests.runoncetest");
  test.eq("TS RUNONCE!", runoncekey);

  const nope = false as boolean;
  if (nope) {
    const runoncekey2 = await services.readRegistryKey("webhare_testsuite:tests.runoncetest");
    void runoncekey2;
    test.typeAssert<test.Equals<typeof runoncekey2, string>>();
    /// @ts-expect-error -- Verify that key string is determined by the key name
    await services.writeRegistryKey("webhare_testsuite:tests.runoncetest", 10);
    /// The following should just work (unknown key)
    await services.writeRegistryKey("whatever", 10);
  }

  //get WebHare configuration
  const whconfig = await loadlib("mod::system/lib/configure.whlib").GetWebHareConfiguration();
  // console.log(services.backendConfig, whconfig);
  test.eq(whconfig.basedataroot, services.backendConfig.dataRoot);

  ensureProperPath(services.backendConfig.dataRoot);
  ensureProperPath(services.backendConfig.installationRoot);

  //@ts-expect-error TS knows the config is readonly
  test.throws(/The WebHare configuration is read-only/, () => services.backendConfig.dataRoot = "I touched it");

  test.eq(await loadlib("mod::system/lib/configure.whlib").GetModuleInstallationRoot("system") as string, services.backendConfig.module.system.root);
  ensureProperPath(services.backendConfig.module.system.root);

  //Verify loadlib supporting the new blobs
  test.eq("1234", await loadlib("wh::files.whlib").BlobToString(services.WebHareBlob.from("1234")));
  const returnblob = await loadlib("wh::files.whlib").StringToBlob("5678") as services.WebHareBlob;
  test.eq("5678", await returnblob.text());
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

async function testMutex() {
  //Simple race of ourselves to a lock
  const lock1 = await services.lockMutex("test:mutex1");
  const lock2promise = services.lockMutex("test:mutex1");
  test.eq("No lock", await Promise.race([
    sleep(50).then(() => "No lock"),
    lock2promise.then(() => "We have a lock!")
  ]), "Give the second lock some time to block, ensure we had to wait");
  lock1.release();

  const lock2 = await lock2promise;
  test.assert(lock2);

  //Test 'try' lock. Should hit the already locked mutex
  test.eq(null, await services.lockMutex("test:mutex1", { timeout: 0 }));
  test.eq(null, await services.lockMutex("test:mutex1", { timeout: 10 }));
  lock2.release();

  const lock3 = (await services.lockMutex("test:mutex1", { timeout: 10000 }));
  test.assert(lock3);
  lock3.release();

  //We should be able to get a completely free mutex even with timeout 0
  const mutex2lock = await services.lockMutex("test:mutex2", { timeout: 0 });
  test.assert(mutex2lock);
  mutex2lock.release();
}

declare module "@webhare/services" {
  interface BackendEvents {
    "webhare_testsuite:test2event.x": null;
    "webhare_testsuite:test_ts_api.param1": { param1?: number };
  }
}

async function testEvents() {
  // eslint-disable-next-line no-constant-condition -- testing typed event api
  if (true) {
    services.broadcast("webhare_testsuite:test_ts_api.unknown");
    services.broadcast("webhare_testsuite:test_ts_api.unknown", { cannot_know: 42 });

    services.broadcast("webhare_testsuite:test2event.x");
    //@ts-expect-error doesn't require a parameter
    services.broadcast("webhare_testsuite:test2event.x", { unexpected: 1 });
    services.broadcast("webhare_testsuite:test2event.x", null); //specifying null is fine too

    services.broadcast("webhare_testsuite:test_ts_api.param1", { param1: 42 });
    //@ts-expect-error badParam is incorrect
    services.broadcast("webhare_testsuite:test_ts_api.param1", { badParam: 42 });
    //@ts-expect-error missing parameter
    services.broadcast("webhare_testsuite:test_ts_api.param1");
  }

  const allevents: services.BackendEvent[] = [];

  function onEvents(events: services.BackendEvent[], subscription: services.BackendEventSubscription) {
    allevents.push(...events);
  }

  await test.throws(/Mask must be in the format module:eventname/, () => services.subscribe("testevent", onEvents));
  await test.throws(/Mask must be exact or end in '\.\*'/, () => services.subscribe("webhare_testsuite:testevent.*.mask", onEvents));
  await test.throws(/Mask must be exact or end in '\.\*'/, () => services.subscribe(["webhare_testsuite:testevent", "webhare_testsuite:testevent.*.mask"], onEvents));

  const subscription = await services.subscribe("webhare_testsuite:testevent", onEvents);
  using stream = services.subscribeToEventStream("webhare_testsuite:testevent");
  services.broadcast("webhare_testsuite:otherevent", { event: -1 });
  services.broadcast("webhare_testsuite:testevent", { event: 2 });
  test.eq({ name: "webhare_testsuite:testevent", data: { event: 2 } }, (await stream.next()).value);
  const streamNext = stream.next(); //prepare for the next event...
  await test.wait(() => allevents.length > 0);
  test.eqPartial([{ name: "webhare_testsuite:testevent", data: { event: 2 } }], allevents);

  //======= Test remote events
  using serviceJS = await services.openBackendService<any>("webhare_testsuite:demoservice", ["x"]);
  await serviceJS.emitIPCEvent("webhare_testsuite:testevent", { event: 3 });
  await test.wait(() => allevents.length > 1);
  test.eqPartial([{ name: "webhare_testsuite:testevent", data: { event: 2 } }, { name: "webhare_testsuite:testevent", data: { event: 3 } }], allevents);
  test.eq({ name: "webhare_testsuite:testevent", data: { event: 3 } }, (await streamNext).value);

  //======= Test wildcards and empty events
  allevents.splice(0, 2); //clear the array
  await subscription.setMasks(["webhare_testsuite:testevent1", "webhare_testsuite:testevent2.*"]);
  services.broadcast("webhare_testsuite:testevent2.x");
  await test.wait(() => allevents.length > 0);
  await serviceJS.emitIPCEvent("webhare_testsuite:testevent2.y", null);
  await test.wait(() => allevents.length > 1);
  test.eqPartial([{ name: "webhare_testsuite:testevent2.x", data: null }, { name: "webhare_testsuite:testevent2.y", data: null }], allevents);

  //Test 'done' events
  let streamImmediatelyDone;
  {
    using closeSoon = services.subscribeToEventStream("webhare_testsuite:testevent");
    streamImmediatelyDone = closeSoon.next();
  }

  test.eq(true, (await streamImmediatelyDone).done);
}

async function runOpenPrimary(hsvm: HSVMWrapper) {
  const database = hsvm.loadlib("mod::system/lib/database.whlib");
  const primary = await database.openPrimary();
  test.eq(1, await hsvm._getHSVM().__getNumRemoteUnmarshallables());
  test.assert(primary);

  const gotprimary = await database.getPrimary();
  test.assert(primary === gotprimary);
}

async function testHareScriptVM() {
  const hsvm = await createVM();

  await runOpenPrimary(hsvm); //split off so GC can clean up 'primary'
  await test.triggerGarbageCollection();
  await test.wait(async () => (await hsvm._getHSVM().__getNumRemoteUnmarshallables()) === 0);

  const siteapi = hsvm.loadlib("mod::publisher/lib/siteapi.whlib");
  const testsite: any = await siteapi.openSiteByName("webhare_testsuite.testsite");
  const testsiteid = await testsite.$get("id");

  const utils = hsvm.loadlib("mod::system/lib/whfs.whlib");
  const sitetype: any = await utils.openWHFSType("http://www.webhare.net/xmlns/publisher/sitesettings");
  const testsitesettings = await sitetype.getInstanceData(testsiteid);
  test.eq("webhare_testsuite:basetest", testsitesettings.sitedesign);

  //TODO verify that if the hsvm is garbagecollected associated objects are gone too on the HS side?
}

async function runPrintCallbackTest(hsvm: HSVMWrapper) {
  //Ensure we can setup simple 'callbacks' that just print placeholders
  const print_helloworld_callback = await hsvm._getHSVM().createPrintCallback(`Hello, world!`);
  const fileswhlib = hsvm.loadlib("wh::files.whlib");
  const capture_helloworld = await fileswhlib.GetPrintedAsBlob(print_helloworld_callback) as services.WebHareBlob;
  test.eq("Hello, world!", await capture_helloworld.text());
}

async function testHareScriptVMFptrs() {
  const hsvm = await createVM();

  await runPrintCallbackTest(hsvm);
  await test.triggerGarbageCollection();
  await test.wait(async () => (await hsvm._getHSVM().__getNumRemoteUnmarshallables()) === 0);

  //test invoking MACROs on OBJECTs (A MACRO cannot be used as a FUNCTION, it has no return value)
  const jsonobject = await hsvm.loadlib("wh::system.whlib").DecodeJSON('{x:42,y:43}', {}, { wrapobjects: true }) as HSVMObject;
  test.eq(undefined, await jsonobject.DeleteProp("x"));
  test.eq({ y: 43 }, await jsonobject.GetValue());

  //test invoking a MACRO directly
  test.eq(undefined, await hsvm.loadlib("wh::system.whlib").Print("Tested invoking a MACRO directly - you will see this in the console, ignore\n"));
}

interface ProcessUndocumented {
  getActiveResourcesInfo(): string[];
}

async function getActiveMessagePortCount() {
  await new Promise(r => setTimeout(r, 5));
  const p: ProcessUndocumented = process as unknown as ProcessUndocumented;
  return p.getActiveResourcesInfo().filter((resourcename) => resourcename === "MessagePort").length;
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

async function testMutexVsHareScript() {
  //Attempt to lock from HareScript and then to get that lock to ensure we're speaking the same namespace
  //We have to do this through a service to ensure we're not testing against an in-process HSVM
  const serverinstance: any = await services.openBackendService("webhare_testsuite:webhareservicetest", ["x"]);
  await serverinstance.lockMutex("test:mutex2");

  test.eq(null, await services.lockMutex("test:mutex2", { timeout: 10 }));
  const mutex2lock2promise = services.lockMutex("test:mutex2");
  await serverinstance.lockMutex("");

  const mutex2lock2 = await mutex2lock2promise;
  (await mutex2lock2).release();
}


async function readLog(name: string): Promise<GenericLogLine[]> {
  return readJSONLogLines(name, test.startTime, null);
}

async function testLogs() {
  services.log("webhare_testsuite:test", { drNick: "Hi everybody!", patientsLost: BigInt("123456678901234567890123456678901234567890") });
  services.log("webhare_testsuite:test", {
    val: "1234567890".repeat(4000),
    f: function () { console.error("Cant log this"); },
    g: function g2() { console.error("Cant log this"); },
    u: undefined,
    s: Symbol(),
    [Symbol("artist")]: "Prince", //ignored in logs currently
    tafkap: Symbol("Prince")
  });
  await loadlib("mod::system/lib/logging.whlib").LogToJSONLog("webhare_testsuite:test", { hareScript: "I can speak JSON too!" });

  const logreader = services.readLogLines("webhare_testsuite:test", { start: test.startTime, limit: new Date(Date.now() + 1) });
  const logline = await logreader.next();
  test.eqPartial({ drNick: "Hi everybody!", patientsLost: "123456678901234567890123456678901234567890" }, logline.value);
  test.assert(isTemporalInstant(logline.value["@timestamp"]));
  test.assert(logline.value["@id"], "Should have an ID");

  const hardlogline = await logreader.next();
  test.assert(isTemporalInstant(hardlogline.value["@timestamp"]));
  test.eq(/1234567890… \(40000 chars\)/, hardlogline.value.val);
  // console.log(hardlogline);

  test.eq("[function f]", hardlogline.value.f);
  test.eq("[function g2]", hardlogline.value.g);
  test.eq(undefined, hardlogline.value.u);
  test.eq("[Symbol()]", hardlogline.value.s);
  test.eq("[Symbol(Prince)]", hardlogline.value.tafkap);

  const hsline = await logreader.next();
  test.assert(isTemporalInstant(hsline.value["@timestamp"]));
  test.eq("I can speak JSON too!", hsline.value.harescript);

  test.assert((await logreader.next()).done);

  const logreader2 = services.readLogLines("webhare_testsuite:test", { start: test.startTime, continueAfter: hardlogline.value["@id"] });
  test.eq(hsline.value["@id"], (await logreader2.next()).value["@id"], "ContinueAfter should have started after 'hardlogline'");

  try { //if betatest.20241205.log exists (ie you ran this test before) it will interfere with the logreader, so delete it
    await rm(services.backendConfig.dataRoot + "log/betatest.20241205.log");
  } catch (ignore) {
  }

  // Historic files reading. First write two lines:
  await storeDiskFile(services.backendConfig.dataRoot + "log/betatest.20241204.log",
    `{ "@timestamp": "2024-12-04T12:00:00.000Z", "line": 1 }\n{ "@timestamp": "2024-12-04T13:00:00.000Z", "line": 2 }\n`, { overwrite: true });

  const logreader_1204 = services.readLogLines<{ line: number }>("webhare_testsuite:test", { start: new Date("2024-12-04"), limit: new Date("2024-12-06") });
  test.eq(1, (await logreader_1204.next()).value.line);
  const logreader_1204_line2 = await logreader_1204.next();
  test.eq(2, logreader_1204_line2.value.line);
  test.eq(true, (await logreader_1204.next()).done);

  //Try to read more lines, none there yet
  const logreader_1204b = services.readLogLines<{ line: number }>("webhare_testsuite:test", { continueAfter: logreader_1204_line2.value["@id"], limit: new Date("2024-12-06") });
  test.eq(true, (await logreader_1204b.next()).done); //shouldn't find anything yet

  //Add line on the next day
  await storeDiskFile(services.backendConfig.dataRoot + "log/betatest.20241205.log",
    `{ "@timestamp": "2024-12-05T12:00:00.000Z", "line": 3 }\n{ "@timestamp": "2024-12-05T13:00:00.000Z", "line": 4 }\n`, { overwrite: true });

  //Try to read more lines, it's there now
  const logreader_1204c = services.readLogLines<{ line: number }>("webhare_testsuite:test", { continueAfter: logreader_1204_line2.value["@id"], limit: new Date("2024-12-06") });
  test.eq(3, (await logreader_1204c.next()).value.line);

  test.throws(/Invalid/, () => services.logDebug("services_test", { x: 42 }));
  services.logDebug("webhare_testsuite:services_test", { test: 42 });
  services.logError(new Error("Broken"));
  ///@ts-ignore we explicitly want to test for the exception when passing an incorrect name
  test.throws(/Invalid log type/, () => services.logNotice("debug", "message"));
  services.logNotice("error", "Foutmelding", { data: { extra: 43 } });
  services.logNotice("info", "Ter info");

  const mydebug = (await readLog("system:debug")).filter(_ => _.source === 'webhare_testsuite:services_test');
  test.eqPartial([{ data: { test: 42 } }], mydebug);

  const mygroupid = mydebug[0].groupid;

  const mynotices = (await readLog("system:notice")).filter(_ => _.groupid === mygroupid);
  test.eqPartial([
    {
      message: 'Broken',
      browser: { name: 'nodejs' },
      type: 'script-error'
    },
    {
      data: { extra: 43 },
      message: 'Foutmelding',
      type: 'error'
    },
    {
      message: 'Ter info',
      type: 'info'
    }
  ], mynotices);

  {
    function getLogLine(ms: number, offset: number) {
      const date = addDuration(test.startTime, { milliseconds: 0 });
      return {
        line: `{"@timestamp":"${date.toISOString()}","line":${ms + 1}}\n`,
        parsed: {
          "@timestamp": date.toTemporalInstant(),
          "@id": `A${date.toISOString().split('T')[0].replaceAll("-", "")}:${offset.toString().padStart(15, '0')}`,
          line: ms + 1
        },
      };
    }

    const logParts = [
      getLogLine(0, 0),
      getLogLine(1, 51),
      getLogLine(2, 102),
    ];

    const testLog = logParts.map(_ => _.line).join('');

    {
      const logreader3 = services.readLogLines("webhare_testsuite:test", {
        start: test.startTime, limit: new Date(Date.now() + 3),
        content: testLog,
      });
      const parsed3 = await gatherAsyncIterable(logreader3);
      test.eq(logParts.map(_ => _.parsed), parsed3);

      const logreader4 = services.readLogLines("webhare_testsuite:test", {
        start: test.startTime, limit: new Date(Date.now() + 3),
        content: testLog,
        continueAfter: parsed3[0]["@id"],
      });
      const parsed4 = await gatherAsyncIterable(logreader4);
      test.eq(logParts.slice(1).map(_ => _.parsed), parsed4);

      // Test with MiniChunkBlob (streams 1 byte at a time) - no continueAfter
      const logreader5 = services.readLogLines("webhare_testsuite:test", {
        start: test.startTime, limit: new Date(Date.now() + 3),
        content: new MiniChunkBlob(testLog),
      });
      const parsed5 = await gatherAsyncIterable(logreader5);
      test.eq(logParts.map(_ => _.parsed), parsed5);

      // Test with MiniChunkBlob (streams 1 byte at a time) - continueAfter first element
      const logreader6 = services.readLogLines("webhare_testsuite:test", {
        start: test.startTime, limit: new Date(Date.now() + 3),
        content: new MiniChunkBlob(testLog),
        continueAfter: parsed3[0]["@id"],
      });
      const parsed6 = await gatherAsyncIterable(logreader6);
      test.eq(logParts.slice(1).map(_ => _.parsed), parsed6);

      // Test with MiniChunkBlob (streams 1 byte at a time) - continueAfter second element (with seeking!)
      const logreader7 = services.readLogLines("webhare_testsuite:test", {
        start: test.startTime, limit: new Date(Date.now() + 3),
        content: new MiniChunkBlob(testLog),
        continueAfter: parsed3[1]["@id"],
      });
      const parsed7 = await gatherAsyncIterable(logreader7);
      test.eq(logParts.slice(2).map(_ => _.parsed), parsed7);
    }
  }
}

async function gatherAsyncIterable<T>(itr: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of itr)
    result.push(item);
  return result;
}

// Blob that streams buffers of 1 byte at a time, useful for testing of chunk boundaries handling
class MiniChunkBlob implements Blob {
  data: Uint8Array<ArrayBuffer>;
  constructor(content: Uint8Array<ArrayBuffer> | string) {
    this.data = typeof content === "string" ? new TextEncoder().encode(content) as Uint8Array<ArrayBuffer> : content;
  }

  get size() { return this.data.length; }
  get type() { return ""; }

  stream(): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start: (controller) => {
        for (const item of this.data)
          controller.enqueue(new Uint8Array([item]));
        controller.close();
      },
    });
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.data.buffer;
  }

  async bytes(): Promise<Uint8Array> {
    return this.data.slice();
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this.data);
  }

  slice(start?: number, end?: number, contentType?: string): Blob {
    return new MiniChunkBlob(this.data.slice(start, end));
  }
}


test.runTests(
  [
    testServices,
    testServiceState,
    testMutex,
    testEvents,
    testHareScriptVM,
    testHareScriptVMFptrs,
    testDisconnects,
    testServiceTimeout,
    runBackendServiceTest_JS,
    runBackendServiceTest_HS,
    runBackendServiceTest_Events,
    testMutexVsHareScript,
    testLogs
  ]);
