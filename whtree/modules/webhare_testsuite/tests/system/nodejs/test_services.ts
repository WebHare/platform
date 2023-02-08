/* eslint-disable @typescript-eslint/no-explicit-any */

import * as test from "@webhare/test";
import * as services from "@webhare/services";
import { HSVM, HSVMObject, openHSVM } from "@webhare/services/src/hsvm";

import { dumpActiveIPCMessagePorts } from "@mod-system/js/internal/whmanager/transport";
import { DemoServiceInterface } from "@mod-webhare_testsuite/js/demoservice";
import runBackendService from "@mod-system/js/internal/webhareservice";

let serverconfig: services.WebHareBackendConfiguration | null = null;

function ensureProperPath(inpath: string) {
  test.eqMatch(/^\/.+\/$/, inpath, `Path should start and end with a slash: ${inpath}`);
  test.assert(!inpath.includes("//"), `Path should not contain duplicate slashes: ${inpath}`);
}

async function testResolve() {
  await test.throws(/without a base path/, () => services.resolveResource("", "lib/emtpydesign.whlib"));

  test.eq("", services.resolveResource("mod::a/b/c/d", ""));
  test.eq("mod::a/e", services.resolveResource("mod::a/b/c/d", "/e"));
  test.eq("mod::a/b/c/e", services.resolveResource("mod::a/b/c/d", "./e"));
  test.eq("mod::a/b/e", services.resolveResource("mod::a/b/c/d", "../e"));
  test.eq("mod::a/e", services.resolveResource("mod::a/b/c/d", "../../e"));
  await test.throws(/tries to escape/, () => services.resolveResource("mod::a/b/c/d", "../../../e"));

  test.eq(true, services.isAbsoluteResource("mod::publisher/designs/emptydesign/"));
  // test.eq(true, services.isAbsoluteResource("whres::xml/xmlschema.xsd")); //TODO if we re-add support for whres::..

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
  await test.throws(/Invalid namespace 'xx'/, () => services.resolveResource("xx::a/b/c/d", "e"));
  await test.throws(/Invalid namespace 'xx'/, () => services.resolveResource("mod::publisher/designs/emptydesign/", "xx::a/b/c/d"));

  await test.throws(/tries to escape/, () => services.resolveResource("mod::publisher/designs/emptydesign/", "../../../bla.whlib"));
  await test.throws(/tries to escape/, () => services.resolveResource("site::mysite/folder/test.html", "../../bla.html"));
}

async function testServices() {
  test.assert(serverconfig);

  //Verify potentially higher level invoke APIs work
  test.eq(45, await services.callHareScript("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib#Add", [22, 23]));

  await test.throws(/NOSUCHFUNCTION.*not found/, services.callHareScript("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib#NoSuchFunction", []));
  await test.throws(/Custom.*Try to kill the bridge/, services.callHareScript("wh::system.whlib#ABORT", ["Try to kill the bridge through abort"]));
  test.eq(1452, await services.callHareScript("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib#MultiplyPromise", [22, 66]), "Verify promises work AND that the bridge is still there");

  const installid = await services.callHareScript("mod::system/lib/configure.whlib#ReadRegistryKey", ["system.global.installationid"], { openPrimary: true }) as string;
  test.assert(installid.length > 10);

  //get WebHare configuration
  const whconfig = await services.callHareScript("mod::system/lib/configure.whlib#GetWebHareConfiguration", []) as any;
  // console.log(serverconfig, whconfig);
  test.eq(whconfig.basedataroot, serverconfig.dataroot);

  ensureProperPath(serverconfig.dataroot);
  ensureProperPath(serverconfig.installationroot);

  await test.throws(/Cannot assign to read only property/, () => { if (serverconfig) serverconfig.dataroot = "I touched it"; });

  test.eq(await services.callHareScript("mod::system/lib/configure.whlib#GetModuleInstallationRoot", ["system"]), serverconfig.module.system.root);
  ensureProperPath(serverconfig.module.system.root);
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

async function runOpenPrimary(hsvm: HSVM) {
  const database = hsvm.loadlib("mod::system/lib/database.whlib");
  const primary = await database.openPrimary();
  test.eq(1, await hsvm.__getNumRemoteUnmarshallables());
  test.assert(primary);
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

async function runPrintCallbackTest(hsvm: HSVM) {
  //Ensure we can setup simple 'callbacks' that just print placeholders
  const print_helloworld_callback = await hsvm.createPrintCallback(`Hello, world!`);
  const fileswhlib = hsvm.loadlib("wh::files.whlib");
  const capture_helloworld = await fileswhlib.GetPrintedAsBlob(print_helloworld_callback) as Buffer;
  test.eq("Hello, world!", capture_helloworld.toString());
}

async function testHSVMFptrs() {
  const hsvm = await openHSVM();

  await runPrintCallbackTest(hsvm);
  test.triggerGarbageCollection();
  await test.wait(async () => (await hsvm.__getNumRemoteUnmarshallables()) === 0);

  //test invoking MACROs on OBJECTs (A MACRO cannot be used as a FUNCTION, it has no return value)
  const jsonobject = await hsvm.loadlib("wh::system.whlib").DecodeJSON('{x:42,y:43}', {}, { wrapobjects: true }) as HSVMObject;
  test.eq(undefined, await jsonobject.DeleteProp("x"));
  test.eq({ y: 43 }, await jsonobject.GetValue());

  //test invoking a MACRO directly
  test.eq(undefined, await hsvm.loadlib("wh::system.whlib").Print("Hello, World!\n"));
}


async function testResources() {
  test.assert(serverconfig);

  test.eq(serverconfig.module.system.root + "lib/database.whlib", services.toFSPath("mod::system/lib/database.whlib"));
  test.eq(serverconfig.module.system.root + "scripts/whcommands/reset.whscr", services.toFSPath("mod::system/scripts/whcommands/reset.whscr"));

  //Verify final slashes handling
  test.eq(serverconfig.module.system.root, services.toFSPath("mod::system"));
  test.eq(serverconfig.module.system.root, services.toFSPath("mod::system/"));
  test.eq(serverconfig.module.system.root + "lib", services.toFSPath("mod::system/lib"));
  test.eq(serverconfig.module.system.root + "lib/", services.toFSPath("mod::system/lib/"));

  test.eq(serverconfig.dataroot + "storage/system/xyz", services.toFSPath("storage::system/xyz"));
  test.eq(serverconfig.dataroot + "storage/system/xyz/", services.toFSPath("storage::system/xyz/"));
  test.eq(serverconfig.dataroot + "storage/system/", services.toFSPath("storage::system"));

  test.eqMatch(/^https?:.*/, serverconfig.backendurl);

  const systempath = serverconfig.module.system.root;
  test.eq("mod::system/lib/tests/cluster.whlib", services.toResourcePath(systempath + "lib/tests/cluster.whlib"));
  await test.throws(/Cannot match filesystem path/, () => services.toResourcePath("/etc"));
  test.eq(null, services.toResourcePath("/etc", { allowUnmatched: true }));

  test.throws(/^Unsupported resource path/, () => services.toFSPath("site::repository/"));
  test.eq(null, services.toFSPath("site::repository/", { allowUnmatched: true }));

  //TODO do we want still want to allow direct:: paths? test.eq("direct::/etc", services.toResourcePath("/etc", { allowdiskpath: true }));
  /* TODO do we really want to support resource paths as input ?
  test.eq("mod::system/lib/tests/cluster.whlib", services.toResourcePath("mod::system/lib/tests/cluster.whlib"));
  test.eq("site::a/b/test.whscr", services.toResourcePath("site::a/b/test.whscr"));
  */

  /* TODO does JS have a wh:: / whres:: usecase ?
  test.eq("wh::internal/formatter.whlib", services.toResourcePath(systempath || "whlibs/internal/formatter.whlib"));
  test.eq("whres::asn1/ldap.asn1", services.toResourcePath(systempath || "whres/asn1/ldap.asn1"));
  test.eq("whres::asn1/ldap.asn1", services.toResourcePath("mod::system/whres/asn1/ldap.asn1"));
  test.eq("wh::asn1/ldap.asn1", services.toResourcePath("mod::system/whlibs/asn1/ldap.asn1"));
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

//NOTE: we take an a-typical test run approach to help ensure noone booted services before us
async function main() {
  await test.throws(/not yet available/, () => services.getConfig());
  await services.ready();
  serverconfig = services.getConfig();

  test.run(
    [
      testResolve,
      testServices,
      testServiceState,
      testEvents,
      testHSVM,
      testHSVMFptrs,
      testResources,
      testDisconnects,
      testServiceTimeout,
      runBackendServiceTest_JS,
      runBackendServiceTest_HS,
    ], { wrdauth: false });
}

main();
