import * as test from "@webhare/test";
import WHBridge from "@mod-system/js/internal/bridge";

async function testIndependentserviceThings()
{
  await test.throws(/Unable to connect/, WHBridge.openService("webharedev_jsbridges:nosuchservice", [ "x" ], { timeout: 300 }));
  // TOOD?  TestEQ(true, exc EXTENDSFROM ServiceUnavailableException); - not sure if we want/desire complex exception typing in JS yet
}

async function testIPC()
{
  const initialreferences = WHBridge.references;

  //Attempt to connect to an nonexisting port. Verify that it keeps the bridge awake
  const connection = WHBridge.connectIPCPort('webhare_testsuite:nosuchport', true);
  test.eq(initialreferences + 1, WHBridge.references);

  await test.throws(/Unable to connect to global port webhare_testsuite:nosuchport/, connection);
  test.eq(initialreferences, WHBridge.references, "Reference should be freed as soon as the port connection failed");

  //Test connect with webhare_testsuite:ipc and ping it
  const listenport = await WHBridge.createIPCPort('webhare_testsuite:testipc', false);
  test.eq(initialreferences + 1, WHBridge.references);
  await test.sleep(10); //verify bridge doesn't close us bcause of 'no waiters'

  listenport.close();
  test.eq(initialreferences, WHBridge.references);
}

async function runWebHareServiceTest_HS()
{
  const initialreferences = WHBridge.references;

  await test.throws(/Invalid/, WHBridge.openService("webhare_testsuite:webhareservicetest"), "HareScript version *requires* a parameter");
  await test.throws(/abort/, WHBridge.openService("webhare_testsuite:webhareservicetest", ["abort"]));

  test.eq(initialreferences, WHBridge.references, "Failed attempts above should not have kept a pending reference");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- not worth writing an interface for just a test
  const serverinstance : any = await WHBridge.openService("webhare_testsuite:webhareservicetest", ["x"]);
  test.eq(initialreferences + 1, WHBridge.references, "WHBridge.openService should immediately keep a reference open");
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

  serverinstance.close();
  test.eq(initialreferences, WHBridge.references, "And the reference should be cleaned after close");

}
test.run([ testIndependentserviceThings
         , testIPC
         , runWebHareServiceTest_HS
         ], { wrdauth: false } );
