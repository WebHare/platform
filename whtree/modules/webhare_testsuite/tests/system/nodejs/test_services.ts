import * as test from "@webhare/test";
import * as services from "@webhare/services";
import { importJSFunction } from "@webhare/services";
import { createVM, type HSVMObject, loadlib, type HSVMWrapper } from "@webhare/harescript";
import { sleep } from "@webhare/std";
import type { ConfigurableSubsystem } from "@mod-platform/js/configure/applyconfig";
import { parseModuleQualifiedName, toHSSnakeCase } from "@webhare/services/src/naming";
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

  test.eq("_whfscell", toHSSnakeCase("Whfscell"));
  test.throws(/cannot be unambigously converted/, () => toHSSnakeCase("_Faketoplevel"));

  test.assert(parseModuleQualifiedName("aa:aa"));
  test.assert(parseModuleQualifiedName("aa:11"));
  test.assert(parseModuleQualifiedName("a_a:a-a"));
  test.assert(parseModuleQualifiedName("a_a:a.a"));
  test.assert(parseModuleQualifiedName("a_a:a_a"));
  test.assert(parseModuleQualifiedName("11:11"));

  test.throws(/Invalid name.*/, () => parseModuleQualifiedName("a-a:a-a"));
  test.throws(/Invalid name.*/, () => parseModuleQualifiedName("a-a:a.a"));
  test.throws(/Invalid name.*/, () => parseModuleQualifiedName("a-a:a_a"));

  test.throws(/Invalid name.*/, () => parseModuleQualifiedName("a:aa"));
  test.throws(/Invalid name.*/, () => parseModuleQualifiedName("aa:a"));
  test.throws(/Invalid name.*/, () => parseModuleQualifiedName("Aa:aa"));
  test.throws(/Invalid name.*/, () => parseModuleQualifiedName("aA:aa"));
  test.throws(/Invalid name.*/, () => parseModuleQualifiedName("aa:Aa"));
  test.throws(/Invalid name.*/, () => parseModuleQualifiedName("aa:aA"));
  test.throws(/Invalid name.*/, () => parseModuleQualifiedName("_a:aa"));
  test.throws(/Invalid name.*/, () => parseModuleQualifiedName("a_:aa"));
  test.throws(/Invalid name.*/, () => parseModuleQualifiedName("aa:_a"));
  test.throws(/Invalid name.*/, () => parseModuleQualifiedName("aa:a_"));
  test.throws(/Invalid name.*/, () => parseModuleQualifiedName("aa:a."));
  test.throws(/Invalid name.*/, () => parseModuleQualifiedName("aa:a-"));
  test.throws(/Invalid name.*/, () => parseModuleQualifiedName("aa:aa:aa"));
  test.throws(/Invalid name.*/, () => parseModuleQualifiedName("system_aa:aa"));
  test.throws(/Invalid name.*/, () => parseModuleQualifiedName("wh_aa:aa"));

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

async function testMutex() {
  //Simple race of ourselves to a lock
  const lock1 = await services.lockMutex("test:mutex1");
  const lock2promise = services.lockMutex("test:mutex1");
  test.eq("No lock", await Promise.race([
    sleep(50).then(() => "No lock"),
    lock2promise.then(() => "We have a lock!")
  ]), "Give the second lock some time to block, ensure we had to wait");

  test.eq(true, services.hasMutex("test:mutex1"));
  lock1.release();
  test.eq(false, services.hasMutex("test:mutex1"));

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

test.runTests(
  [
    testServices,
    testMutex,
    testEvents,
    testHareScriptVM,
    testHareScriptVMFptrs,
    testMutexVsHareScript,
  ]);
