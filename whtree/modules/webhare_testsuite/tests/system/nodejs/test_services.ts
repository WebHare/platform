/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
//@webhare/services are higher level but public abstractions

import * as test from "@webhare/test";
import * as services from "@webhare/services";

//TODO move runWebHareServiceTest_* here

let serverconfig : services.WebHareBackendConfiguration | null = null;

function ensureProperPath(inpath: string) {
  test.eqMatch(/^\/.+\/$/, inpath, `Path should start and end with a slash: ${inpath}`);
  test.assert(!inpath.includes("//"), `Path should not contain duplicate slashes: ${inpath}`);
}

async function testServices() {

  if(!serverconfig)
    throw new Error("serverconfig should be set!");

  //Verify potentially higher level invoke APIs work
  test.eq(45, await services.callHareScript("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib#Add", [22, 23]));

  await test.throws(/NOSUCHFUNCTION.*not found/, services.callHareScript("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib#NoSuchFunction", []));
  await test.throws(/Custom.*Try to kill the bridge/, services.callHareScript("wh::system.whlib#ABORT", ["Try to kill the bridge through abort"]));
  test.eq(1452, await services.callHareScript("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib#MultiplyPromise", [22, 66]), "Verify promises work AND that the bridge is still there");

  //get WebHare configuration
  const whconfig = await services.callHareScript("mod::system/lib/configure.whlib#GetWebHareConfiguration",[]) as any;
  // console.log(serverconfig, whconfig);
  test.eq(whconfig.basedataroot, serverconfig.dataroot);

  ensureProperPath(serverconfig.dataroot);
  ensureProperPath(serverconfig.installationroot);

  await test.throws(/Cannot assign to read only property/, () => serverconfig!.dataroot = "I touched it");

  test.eq(await services.callHareScript("mod::system/lib/configure.whlib#GetModuleInstallationRoot", ["system"]), serverconfig.module.system.root);
  ensureProperPath(serverconfig.module.system.root);
}

//NOTE: we take an a-typical test to help ensure noone booted services before us

async function main()
{
  await test.throws(/not yet available/, () => services.getConfig());
  await services.ready();
  serverconfig = services.getConfig();

  test.run(
    [ testServices
    ], { wrdauth: false });
}

main();
