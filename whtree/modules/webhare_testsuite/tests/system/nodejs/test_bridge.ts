import * as test from "@webhare/test";
import WHBridge from "@mod-system/js/internal/bridge";

async function testIndependentserviceThings()
{
  await test.throws(/Unable to connect/, WHBridge.openService("webharedev_jsbridges:nosuchservice", [ "x" ], { timeout: 300 }));
  // TOOD?  TestEQ(true, exc EXTENDSFROM ServiceUnavailableException); - not sure if we want/desire complex exception typing in JS yet
}

async function runWebHareServiceTest_HS()
{
  test.throws(/Invalid/, WHBridge.openService("webhare_testsuite:webhareservicetest"), "HareScript version *requires* a parameter");
  await test.throws(/abort/, WHBridge.openService("webhare_testsuite:webhareservicetest", ["abort"]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- not worth writing an interface for just a test
  const serverinstance : any = await WHBridge.openService("webhare_testsuite:webhareservicetest", ["x"]);
  test.eq(42, await serverinstance.GETLUE());

  let promise = serverinstance.GETASYNCLUE();
  test.eq(42, await serverinstance.GETLUE());
  test.eq(42, await promise);

  await test.throws(/Crash/, serverinstance.CRASH());

  promise = serverinstance.GETASYNCLUE();
  const promise2 = serverinstance.GETASYNCCRASH();

  await test.throws(/Async crash/, promise2);

  test.eq({arg1:41,arg2:43}, await serverinstance.PING(41,43));
  test.eq({arg1:41,arg2:43}, await serverinstance.ASYNCPING(41,43));
}
test.run([ testIndependentserviceThings
         , runWebHareServiceTest_HS
         ], { wrdauth: false } );
