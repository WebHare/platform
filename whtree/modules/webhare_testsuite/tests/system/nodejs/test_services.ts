/* eslint-disable @typescript-eslint/no-explicit-any */

import * as test from "@webhare/test";
import * as services from "@webhare/services";
import { HSVM, HSVMObject, openHSVM } from "@webhare/services/src/hsvm";
import { GenericLogLine } from "@webhare/services/src/logging";
import { readJSONLogLines } from "@mod-system/js/internal/logging";
import { dumpActiveIPCMessagePorts } from "@mod-system/js/internal/whmanager/transport";
import { DemoServiceInterface } from "@mod-webhare_testsuite/js/demoservice";
import runBackendService from "@mod-system/js/internal/webhareservice";
import { HareScriptVM, allocateHSVM, HareScriptBlob, isHareScriptBlob, HareScriptMemoryBlob } from "@webhare/harescript";

function ensureProperPath(inpath: string) {
  test.eq(/^\/.+\/$/, inpath, `Path should start and end with a slash: ${inpath}`);
  test.assert(!inpath.includes("//"), `Path should not contain duplicate slashes: ${inpath}`);
}

async function testResolve() {
  test.throws(/without a base path/, () => services.resolveResource("", "lib/emtpydesign.whlib"));

  test.eq("", services.resolveResource("mod::a/b/c/d", ""));
  test.eq("mod::a/e", services.resolveResource("mod::a/b/c/d", "/e"));
  test.eq("mod::a/b/c/e", services.resolveResource("mod::a/b/c/d", "./e"));
  test.eq("mod::a/b/e", services.resolveResource("mod::a/b/c/d", "../e"));
  test.eq("mod::a/e", services.resolveResource("mod::a/b/c/d", "../../e"));
  test.throws(/tries to escape/, () => services.resolveResource("mod::a/b/c/d", "../../../e"));

  test.eq(true, services.isAbsoluteResource("mod::publisher/designs/emptydesign/"));

  test.eq("mod::publisher/designs/emptydesign/lib/emptydesign.whlib", services.resolveResource("mod::publisher/designs/emptydesign/", "lib/emptydesign.whlib"));
  test.eq("mod::publisher/designs/emptydesign/lib/", services.resolveResource("mod::publisher/designs/emptydesign/", "lib/"));
  test.eq("mod::publisher/api.whlib", services.resolveResource("mod::publisher/designs/emptydesign/", "/api.whlib"));

  test.eq("site::webhare backend/design/lib/webharebackend.whlib", services.resolveResource("mod::publisher/designs/emptydesign/", "site::webhare backend/design/lib/webharebackend.whlib"));
  test.eq("mod::example/webdesigns/ws2016/src/pages/registrationform/registrationform.xml", services.resolveResource("mod::example/webdesigns/ws2016/src/pages/registrationform/registrationform.siteprl", './registrationform.xml'));
  test.eq("mod::example/webdesigns/ws2016/src/pages/registrationform/registrationform.xml#editor", services.resolveResource("mod::example/webdesigns/ws2016/src/pages/registrationform/registrationform.siteprl", './registrationform.xml#editor'));

  // TODO do we really want to be able to ignre the missing first path and return a path anyway?
  //      it seems that the base path would often be fixe and the relative path 'external' data
  //      so that we should fail *any* case where the base path is unusable?
  //test.eq("mod::example/webdesigns/ws2016/src/pages/registrationform/registrationform.xml#editor", services.resolveResource("", 'mod::example/webdesigns/ws2016/src/pages/registrationform/registrationform.xml#editor'));

  test.eq("mod::publisher/designs/emptydesign/lib/emptydesign.witty", services.resolveResource("mod::publisher/designs/emptydesign/lib/emptydesign.whlib", "emptydesign.witty"));
  // MakeAbsoluteResourcePath would return "mod::publisher/designs/emptydesign/" but without the slash makes more sense? you're referring to that directory
  test.eq("mod::publisher/designs/emptydesign", services.resolveResource("mod::publisher/designs/emptydesign/siteprl.prl", "."));

  test.eq("site::lelibel/design/customleft.siteprl", services.resolveResource("site::lelibel/design/", "/design/customleft.siteprl"));
  /* TODO unlikely for wh:: support to return
  test.eq("wh::a/", services.resolveResource("wh::a/b.whlib", "."));
  test.eq("wh::b/la/", services.resolveResource("wh::b/", "la/"));
  test.eq("wh::b/la/", services.resolveResource("wh::b/c.whlib", "la/"));
  test.eq("wh::c.whlib", services.resolveResource("wh::a/b.whlib", "/c.whlib"));
  test.eq("wh::c.whlib", services.resolveResource("wh::a/b.whlib", "../c.whlib"));

  await test.throws(/tries to escape/, () => services.resolveResource("wh::a/b.whlib", "../../c.whlib"));
  await test.throws(/tries to escape/, () => services.resolveResource("wh::a.whlib", "../../c.whlib"));
  */
  test.throws(/Invalid namespace 'xx'/, () => services.resolveResource("xx::a/b/c/d", "e"));
  test.throws(/Invalid namespace 'xx'/, () => services.resolveResource("mod::publisher/designs/emptydesign/", "xx::a/b/c/d"));

  test.throws(/tries to escape/, () => services.resolveResource("mod::publisher/designs/emptydesign/", "../../../bla.whlib"));
  test.throws(/tries to escape/, () => services.resolveResource("site::mysite/folder/test.html", "../../bla.html"));
}

async function testServices() {
  test.assert(services.config);

  //Verify potentially higher level invoke APIs work
  test.eq(45, await services.callHareScript("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib#Add", [22, 23]));

  await test.throws(/NOSUCHFUNCTION.*not found/, services.callHareScript("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib#NoSuchFunction", []));
  await test.throws(/Custom.*Try to kill the bridge/, services.callHareScript("wh::system.whlib#ABORT", ["Try to kill the bridge through abort"]));
  test.eq(1452, await services.callHareScript("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib#MultiplyPromise", [22, 66]), "Verify promises work AND that the bridge is still there");

  const runoncekey = await services.readRegistryKey<string>("webhare_testsuite.tests.runoncetest");
  test.eq("TS RUNONCE!", runoncekey);

  //get WebHare configuration
  const whconfig = await services.callHareScript("mod::system/lib/configure.whlib#GetWebHareConfiguration", []) as any;
  // console.log(services.config, whconfig);
  test.eq(whconfig.basedataroot, services.config.dataroot);

  ensureProperPath(services.config.dataroot);
  ensureProperPath(services.config.installationroot);

  test.throws(/The WebHare configuration is read-only/, () => { if (services.config) (services.config as any).dataroot = "I touched it"; });

  test.eq(await services.callHareScript("mod::system/lib/configure.whlib#GetModuleInstallationRoot", ["system"]) as string, services.config.module.system.root);
  ensureProperPath(services.config.module.system.root);

  //Verify callHareScript supporting the new blobs
  test.eq("1234", await services.callHareScript("wh::files.whlib#BlobToString", [new HareScriptMemoryBlob(Buffer.from("1234"))]));
  const returnblob = await services.callHareScript("wh::files.whlib#StringToBlob", ["5678"]) as HareScriptBlob;
  test.eq("5678", await returnblob.text());
}

async function testServiceState() {
  const instance1 = await services.openBackendService("webhare_testsuite:controlleddemoservice", ["instance1"], { linger: true });
  const instance2 = await services.openBackendService("webhare_testsuite:controlleddemoservice", ["instance2"], { linger: true });

  const randomkey = "KEY" + Math.random();
  await instance1.setShared(randomkey);
  test.eq(randomkey, await instance2.getShared());

  instance1.close();
  instance2.close();
}

async function testMutex() {
  //Simple race of ourselves to a lock
  const lock1 = await services.lockMutex("test:mutex1");
  const lock2promise = services.lockMutex("test:mutex1");
  test.eq("No lock", await Promise.race([
    test.sleep(50).then(() => "No lock"),
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

async function testEvents() {
  const allevents: services.BackendEvent[] = [];

  async function onEvents(events: services.BackendEvent[], subscription: services.BackendEventSubscription) {
    allevents.push(...events);
  }

  test.throws(/Mask must be in the format module:eventname/, () => services.subscribe("testevent", onEvents));
  test.throws(/Mask must be exact or end in '\.\*'/, () => services.subscribe("webhare_testsuite:testevent.*.mask", onEvents));
  test.throws(/Mask must be exact or end in '\.\*'/, () => services.subscribe(["webhare_testsuite:testevent", "webhare_testsuite:testevent.*.mask"], onEvents));

  const subscription = await services.subscribe("webhare_testsuite:testevent", onEvents);
  services.broadcast("webhare_testsuite:otherevent", { event: -1 });
  services.broadcast("webhare_testsuite:testevent", { event: 2 });
  await test.wait(() => allevents.length > 0);
  test.eq([{ name: "webhare_testsuite:testevent", data: { event: 2 } }], allevents);

  //======= Test remote events
  await services.callHareScript("wh::ipc.whlib#BroadcastEvent", ["webhare_testsuite:testevent", { event: 3 }]);
  await test.wait(() => allevents.length > 1);
  test.eq([{ name: "webhare_testsuite:testevent", data: { event: 2 } }, { name: "webhare_testsuite:testevent", data: { event: 3 } }], allevents);

  //======= Test wildcards and empty events
  allevents.splice(0, 2); //clear the array
  await subscription.setMasks(["webhare_testsuite:testevent1", "webhare_testsuite:testevent2.*"]);
  services.broadcast("webhare_testsuite:testevent2.x");
  await test.wait(() => allevents.length > 0);
  await services.callHareScript("wh::ipc.whlib#BroadcastEvent", ["webhare_testsuite:testevent2.y"]);
  await test.wait(() => allevents.length > 1);
  test.eq([{ name: "webhare_testsuite:testevent2.x", data: null }, { name: "webhare_testsuite:testevent2.y", data: null }], allevents);
}

async function runOpenPrimary(hsvm: HareScriptVM | HSVM) {
  const database = hsvm.loadlib("mod::system/lib/database.whlib");
  const primary = await database.openPrimary();
  test.eq(1, await hsvm.__getNumRemoteUnmarshallables());
  test.assert(primary);

  const gotprimary = await database.getPrimary();
  test.assert(primary === gotprimary);
}


async function testHSVM() {
  const hsvm = await openHSVM();

  await runOpenPrimary(hsvm); //split off so GC can clean up 'primaryu'
  test.triggerGarbageCollection();
  await test.wait(async () => (await hsvm.__getNumRemoteUnmarshallables()) === 0);

  const siteapi = hsvm.loadlib("mod::publisher/lib/siteapi.whlib");
  const testsite: any = await siteapi.openSiteByName("webhare_testsuite.testsite");
  const testsiteid = await testsite.get("id");

  const utils = hsvm.loadlib("mod::system/lib/whfs.whlib");
  const sitetype: any = await utils.openWHFSType("http://www.webhare.net/xmlns/publisher/sitesettings");
  const testsitesettings = await sitetype.getInstanceData(testsiteid);
  test.eq("webhare_testsuite:basetest", testsitesettings.sitedesign);

  //TODO verify that if the hsvm is garbagecollected associated objects are gone too on the HS side?
}

async function testHareScriptVM() {
  const hsvm = await allocateHSVM();

  await runOpenPrimary(hsvm); //split off so GC can clean up 'primaryu'
  test.triggerGarbageCollection();
  await test.wait(async () => (await hsvm.__getNumRemoteUnmarshallables()) === 0);

  const siteapi = hsvm.loadlib("mod::publisher/lib/siteapi.whlib");
  const testsite: any = await siteapi.openSiteByName("webhare_testsuite.testsite");
  const testsiteid = await testsite.$get("id");

  const utils = hsvm.loadlib("mod::system/lib/whfs.whlib");
  const sitetype: any = await utils.openWHFSType("http://www.webhare.net/xmlns/publisher/sitesettings");
  const testsitesettings = await sitetype.getInstanceData(testsiteid);
  test.eq("webhare_testsuite:basetest", testsitesettings.sitedesign);

  //TODO verify that if the hsvm is garbagecollected associated objects are gone too on the HS side?
  hsvm.shutdown(); //TODO can this become optional again? but we need toh have the EM PipeWaiter waitloop abort if the VM no longer has anything to do *and* is unreferenced
}

async function runPrintCallbackTest(hsvm: HareScriptVM) {
  //Ensure we can setup simple 'callbacks' that just print placeholders
  const print_helloworld_callback = await hsvm.createPrintCallback(`Hello, world!`);
  const fileswhlib = hsvm.loadlib("wh::files.whlib");
  const capture_helloworld = await fileswhlib.GetPrintedAsBlob(print_helloworld_callback) as Buffer | HareScriptBlob; //NOTE  FAALT maar kan simpelweg verwarring bij retour marshall zijn
  if (isHareScriptBlob(capture_helloworld)) //WebHare blob
    test.eq("Hello, world!", await capture_helloworld.text());
  else
    test.eq("Hello, world!", capture_helloworld.toString());
}

async function testHSVMFptrs() {
  const hsvm = await openHSVM();

  ///@ts-ignore HSVM is sufficiently API compatible to allow the test to run
  await runPrintCallbackTest(hsvm);
  test.triggerGarbageCollection();
  await test.wait(async () => (await hsvm.__getNumRemoteUnmarshallables()) === 0);

  //test invoking MACROs on OBJECTs (A MACRO cannot be used as a FUNCTION, it has no return value)
  const jsonobject = await hsvm.loadlib("wh::system.whlib").DecodeJSON('{x:42,y:43}', {}, { wrapobjects: true }) as HSVMObject;
  test.eq(undefined, await jsonobject.DeleteProp("x"));
  test.eq({ y: 43 }, await jsonobject.GetValue());

  //test invoking a MACRO directly
  test.eq(undefined, await hsvm.loadlib("wh::system.whlib").Print("Testing MACRO (expecting this to be visible in the servicemanager.log\n"));
}

async function testHareScriptVMFptrs() {
  const hsvm = await allocateHSVM();

  await runPrintCallbackTest(hsvm);
  test.triggerGarbageCollection();
  await test.wait(async () => (await hsvm.__getNumRemoteUnmarshallables()) === 0);

  //test invoking MACROs on OBJECTs (A MACRO cannot be used as a FUNCTION, it has no return value)
  const jsonobject = await hsvm.loadlib("wh::system.whlib").DecodeJSON('{x:42,y:43}', {}, { wrapobjects: true }) as HSVMObject;
  test.eq(undefined, await jsonobject.DeleteProp("x"));
  test.eq({ y: 43 }, await jsonobject.GetValue());

  //test invoking a MACRO directly
  test.eq(undefined, await hsvm.loadlib("wh::system.whlib").Print("Tested invoking a MACRO directly - you will see this in the console, ignore\n"));

  hsvm.shutdown(); //TODO can this become optional again? but we need toh have the EM PipeWaiter waitloop abort if the VM no longer has anything to do *and* is unreferenced
}

async function testResources() {
  test.assert(services.config);

  test.eq(services.config.module.system.root + "lib/database.whlib", services.toFSPath("mod::system/lib/database.whlib"));
  test.eq(services.config.module.system.root + "scripts/whcommands/reset.whscr", services.toFSPath("mod::system/scripts/whcommands/reset.whscr"));

  //Verify final slashes handling
  test.eq(services.config.module.system.root, services.toFSPath("mod::system"));
  test.eq(services.config.module.system.root, services.toFSPath("mod::system/"));
  test.eq(services.config.module.system.root + "lib", services.toFSPath("mod::system/lib"));
  test.eq(services.config.module.system.root + "lib/", services.toFSPath("mod::system/lib/"));

  test.eq(services.config.dataroot + "storage/system/xyz", services.toFSPath("storage::system/xyz"));
  test.eq(services.config.dataroot + "storage/system/xyz/", services.toFSPath("storage::system/xyz/"));
  test.eq(services.config.dataroot + "storage/system/", services.toFSPath("storage::system"));

  test.eq(/^https?:.*/, services.config.backendURL);

  const systempath = services.config.module.system.root;
  test.eq("mod::system/lib/tests/cluster.whlib", services.toResourcePath(systempath + "lib/tests/cluster.whlib"));
  test.throws(/Cannot match filesystem path/, () => services.toResourcePath("/etc"));
  test.eq(null, services.toResourcePath("/etc", { allowUnmatched: true }));

  test.throws(/^Unsupported resource path/, () => services.toFSPath("site::repository/"));
  test.eq(null, services.toFSPath("site::repository/", { allowUnmatched: true }));

  //TODO do we want still want to allow direct:: paths? test.eq("direct::/etc", services.toResourcePath("/etc", { allowdiskpath: true }));
  /* TODO do we really want to support resource paths as input ?
  test.eq("mod::system/lib/tests/cluster.whlib", services.toResourcePath("mod::system/lib/tests/cluster.whlib"));
  test.eq("site::a/b/test.whscr", services.toResourcePath("site::a/b/test.whscr"));
  */
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- not worth writing an interface for just a test
  test.assert(await services.openBackendService<DemoServiceInterface>("webhare_testsuite:demoservice"), "Fails in HS but works in JS as invalid # of arguments is not an issue for JavaScript");
  test.eq(0, await getActiveMessagePortCount(), "Failed and closed attempts above should not have kept a pending reference");

  dumpActiveIPCMessagePorts();
  await test.throws(/abort/, services.openBackendService("webhare_testsuite:demoservice", ["abort"]));
  test.eq(0, await getActiveMessagePortCount(), "Failed and closed attempts above should not have kept a pending reference");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- not worth writing an interface for just a test
  const serverinstance = await services.openBackendService("webhare_testsuite:demoservice", ["x"]);
  test.eq(42, await serverinstance.getLUE());

  test.assert(serverinstance._invisible === undefined, "Should not see _prefixed APIs");
  test.assert(serverinstance.dummy === undefined, "Should not see variables");

  let promise = serverinstance.getAsyncLUE();
  test.eq(42, await serverinstance.getLUE());
  test.eq(42, await promise);

  test.eq(-1, await serverinstance.getShared(), "Verify ths instance does not see a shared controller");

  await test.throws(/Crash/, serverinstance.crash());

  promise = serverinstance.getAsyncLUE();
  const promise2 = serverinstance.getAsyncCrash();

  await test.throws(/Async crash/, promise2);

  test.eq({ arg1: 41, arg2: 43 }, await serverinstance.ping(41, 43));
  test.eq({ arg1: 41, arg2: 43 }, await serverinstance.asyncPing(41, 43));

  test.eq({ arg1: 45, arg2: { contact: { contactNo: "C1" } } }, await serverinstance.ping(45, { contact: { contactNo: "C1" } }));

  /* TODO reenable as event source? then it would be nicer to do it like a 'real' eventSource
  const eventwaiter = serverinstance.waitOn("testevent");
  await serverinstance.emitTestEvent({ start: 12, add: 13});
  test.eq(25, await eventwaiter);
  */

  test.eq(0, await getActiveMessagePortCount(), "Our version of the demoservice wasn't lingering, so no references");
  serverinstance.close();
  test.eq(0, await getActiveMessagePortCount(), "and close() should have no effect");

  const secondinstance = await services.openBackendService("webhare_testsuite:demoservice", ["x"], { linger: true });
  test.eq(1, await getActiveMessagePortCount(), "With linger, we take a reference");
  secondinstance.close();
  test.eq(0, await getActiveMessagePortCount(), "and close() should drop that reference");
}

async function testDisconnects() {
  const instance1 = await services.openBackendService("webhare_testsuite:demoservice", ["instance1"], { linger: true });
  const instance2 = await services.openBackendService("webhare_testsuite:demoservice", ["instance2"], { linger: true });

  //Send a message to instance 1 and immediately disconnect it. then try instance 2 and see if the service got killed because we dropped the outgoing line
  const promise = instance1.getAsyncLUE(); //the demoservice should delay 50ms before responding, giving us time to kill the link..
  await test.sleep(1); //give the command time to be flushed
  instance1.close(); //kill the link
  await test.throws(/Request is cancelled, link was closed/, promise, `Request should throw`);

  await test.sleep(100); //give the demoservice time to answer. we know it's a racy test so it might give false positives..
  // verify the services stil lwork
  test.eq(42, await instance2.getAsyncLUE());
  instance2.close(); //kill the second link

  test.eq(0, await getActiveMessagePortCount());
}

async function testServiceTimeout() {
  const customservicename = "webhare_testsuite:servicetimeouttest_" + Math.random();
  test.throws(/Service.*is unavailable/, services.openBackendService(customservicename, [], { timeout: 100 }));

  const slowserviceconnection = services.openBackendService(customservicename, [], { timeout: 3000 });
  await test.sleep(100); //give the connection time to fail

  //set it up
  const customservice = await runBackendService(customservicename, () => new class { whatsMyName() { return "doggie dog"; } });
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- not worth writing an interface for just a test
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

  serverinstance.close();
  test.eq(0, await getActiveMessagePortCount(), "And the reference should be cleaned after close");

  /* TODO Do we need cross language events ?
  //RECORD deferred := CreateDeferredPromise();
  //serverinstance->AddListener("testevent", PTR deferred.resolve(#1));
  //serverinstance->EmitTestEvent([ value := 42 ]);
  //RECORD testdata := AWAIT deferred.promise;
  //TestEq([ value := 42 ], testdata); */
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
  await services.callHareScript("mod::system/lib/logging.whlib#LogToJSONLog", ["webhare_testsuite:test", { hareScript: "I can speak JSON too!" }]);

  const logreader = services.readLogLines("webhare_testsuite:test", { start: test.startTime, limit: new Date(Date.now() + 1) });
  const logline = await logreader.next();
  test.eqProps({ drNick: "Hi everybody!", patientsLost: "123456678901234567890123456678901234567890" }, logline.value);
  test.assert(logline.value["@timestamp"] instanceof Date);

  const hardlogline = await logreader.next();
  test.assert(hardlogline.value["@timestamp"] instanceof Date);
  test.eq(/1234567890… \(40000 chars\)/, hardlogline.value.val);
  // console.log(hardlogline);

  test.eq("[function f]", hardlogline.value.f);
  test.eq("[function g2]", hardlogline.value.g);
  test.eq("[undefined]", hardlogline.value.u);
  test.eq("[Symbol()]", hardlogline.value.s);
  test.eq("[Symbol(Prince)]", hardlogline.value.tafkap);

  const hsline = await logreader.next();
  test.assert(hsline.value["@timestamp"] instanceof Date);
  test.eq("I can speak JSON too!", hsline.value.harescript);

  test.assert((await logreader.next()).done);

  test.throws(/Invalid/, () => services.logDebug("services_test", { x: 42 }));
  services.logDebug("webhare_testsuite:services_test", { test: 42 });
  services.logError(new Error("Broken"));
  ///@ts-ignore we explicitly want to test for the exception when passing an incorrect name
  test.throws(/Invalid log type/, () => services.logNotice("debug", "message"));
  services.logNotice("error", "Foutmelding", { data: { extra: 43 } });
  services.logNotice("info", "Ter info");

  const mydebug = (await readLog("system:debug")).filter(_ => _.source == 'webhare_testsuite:services_test');
  test.eqProps([{ data: { test: 42 } }], mydebug);

  const mygroupid = mydebug[0].groupid;

  const mynotices = (await readLog("system:notice")).filter(_ => _.groupid == mygroupid);
  test.eqProps([
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
}

test.run(
  [
    testResolve,
    testServices,
    testServiceState,
    testMutex,
    testEvents,
    testHSVM,
    testHareScriptVM,
    testHSVMFptrs,
    testHareScriptVMFptrs,
    testResources,
    testDisconnects,
    testServiceTimeout,
    runBackendServiceTest_JS,
    runBackendServiceTest_HS,
    testMutexVsHareScript,
    testLogs
  ], { wrdauth: false });
