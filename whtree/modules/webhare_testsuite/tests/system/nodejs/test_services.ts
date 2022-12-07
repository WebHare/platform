//@webhare/services are higher level but public abstractions

import * as test from "@webhare/test";
import * as services from "@webhare/services";

//TODO move runWebHareServiceTest_* here

async function testServices() {

  //Verify potentially higher level invoke APIs work
  test.eq(45, await services.callHareScript("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib#Add", [22, 23]));

  await test.throws(/NOSUCHFUNCTION.*not found/, services.callHareScript("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib#NoSuchFunction", []));
  await test.throws(/Custom.*Try to kill the bridge/, services.callHareScript("wh::system.whlib#ABORT", ["Try to kill the bridge through abort"]));
  test.eq(1452, await services.callHareScript("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib#MultiplyPromise", [22, 66]), "Verify promises work AND that the bridge is still there");
}

test.run(
  [ testServices
  ], { wrdauth: false });
