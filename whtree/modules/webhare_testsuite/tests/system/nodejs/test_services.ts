/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
//@webhare/services are higher level but public abstractions

import * as test from "@webhare/test";
import * as services from "@webhare/services";
import WHBridge from "@mod-system/js/internal/bridge"; //@webhare/services should be wrapping the bridge but we need to validate the reference counter

let serverconfig: services.WebHareBackendConfiguration | null = null;

function ensureProperPath(inpath: string) {
  test.eqMatch(/^\/.+\/$/, inpath, `Path should start and end with a slash: ${inpath}`);
  test.assert(!inpath.includes("//"), `Path should not contain duplicate slashes: ${inpath}`);
}

async function testServices() {
  if (!serverconfig)
    throw new Error("serverconfig should be set!");

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

  await test.throws(/Cannot assign to read only property/, () => serverconfig!.dataroot = "I touched it");

  test.eq(await services.callHareScript("mod::system/lib/configure.whlib#GetModuleInstallationRoot", ["system"]), serverconfig.module.system.root);
  ensureProperPath(serverconfig.module.system.root);
}

async function testResources() {
  if (!serverconfig)
    throw new Error("serverconfig should be set!");

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
  //TODO do we want still want to allow direct:: paths? test.eq("direct::/etc", services.toResourcePath("/etc", [ allowdiskpath := TRUE ]));
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

async function runWebHareServiceTest_JS() {
  await test.throws(/Unable to connect/, services.openBackendService("webharedev_jsbridges:nosuchservice", ["x"], { timeout: 300 }));
  test.eq(0, WHBridge.references);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- not worth writing an interface for just a test
  const demoservice: any = test.assert(await services.openBackendService("webhare_testsuite:demoservice"), "Fails in HS but works in JS as invalid # of arguments is not an issue for JavaScript");
  demoservice.close();

  await test.throws(/abort/, services.openBackendService("webhare_testsuite:demoservice", ["abort"]));

  test.eq(0, WHBridge.references, "Failed and closed attempts above should not have kept a pending reference");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- not worth writing an interface for just a test
  const serverinstance: any = await services.openBackendService("webhare_testsuite:demoservice", ["x"]);
  test.eq(42, await serverinstance.getLUE());

  let promise = serverinstance.getAsyncLUE();
  test.eq(42, await serverinstance.getLUE());
  test.eq(42, await promise);

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

  serverinstance.close();
}

async function runWebHareServiceTest_HS() {
  await test.throws(/Invalid/, services.openBackendService("webhare_testsuite:webhareservicetest"), "HareScript version *requires* a parameter");
  await test.throws(/abort/, services.openBackendService("webhare_testsuite:webhareservicetest", ["abort"]));

  test.eq(0, WHBridge.references, "Failed attempts above should not have kept a pending reference");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- not worth writing an interface for just a test
  const serverinstance: any = await services.openBackendService("webhare_testsuite:webhareservicetest", ["x"]);
  test.eq(1, WHBridge.references, "services.openBackendService should immediately keep a reference open");
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
  test.eq(0, WHBridge.references, "And the reference should be cleaned after close");

  /* TODO Do we need cross language events ?
  //RECORD deferred := CreateDeferredPromise();
  //serverinstance->AddListener("testevent", PTR deferred.resolve(#1));
  //serverinstance->EmitTestEvent([ value := 42 ]);
  //RECORD testdata := AWAIT deferred.promise;
  //TestEq([ value := 42 ], testdata); */
}

//NOTE: we take an a-typical test to help ensure noone booted services before us

async function main() {
  await test.throws(/not yet available/, () => services.getConfig());
  await services.ready();
  serverconfig = services.getConfig();

  test.run(
    [
      testServices,
      testResources,
      runWebHareServiceTest_JS,
      runWebHareServiceTest_HS
    ], { wrdauth: false });
}

main();
