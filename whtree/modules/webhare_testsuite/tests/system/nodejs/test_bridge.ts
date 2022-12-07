import * as test from "@webhare/test";
import WHBridge, { IPCLink, IPCListenerPort, IPCMessagePacket } from "@mod-system/js/internal/bridge";

async function testIPC()
{
  const initialreferences = WHBridge.references;

  //Attempt to connect to an nonexisting port. Verify that it keeps the bridge awake
  let out_connection = new IPCLink;
  test.eq(initialreferences, WHBridge.references);

  const out_connection_promise = out_connection.connect('webhare_testsuite:nosuchport', true);
  test.eq(initialreferences + 1, WHBridge.references, "While the connection attempt is running, the bridge is busy");

  await test.throws(/Unable to connect to global port webhare_testsuite:nosuchport/, out_connection_promise);
  test.eq(initialreferences, WHBridge.references, "Reference should be freed as soon as the port connection failed");
  await test.throws(/Link.*already/, out_connection.connect('webhare_testsuite:testipc', true));

  //Test connect with webhare_testsuite:ipc and ping it
  const listenport = new IPCListenerPort;
  test.eq(initialreferences, WHBridge.references);

  const acceptportpromise = listenport.waitOn("accept");
  await listenport.listen('webhare_testsuite:testipc', false);

  test.eq(initialreferences + 1, WHBridge.references);
  await test.sleep(10); //verify bridge doesn't close us bcause of 'no waiters'

  out_connection = new IPCLink;
  const out_connection_msg = out_connection.waitOn("message");
  await out_connection.connect('webhare_testsuite:testipc', false);
  await out_connection.send({ bericht: "Moi!" }).promise;

  const acceptedport = await acceptportpromise as IPCLink;
  const acceptedport_msg = acceptedport.waitOn("message");
  await test.sleep(200); //try to race accept vs the message
  await acceptedport.accept();
  acceptedport.send({ bericht: "Welkom" });

  test.eq("Moi!",   ((await acceptedport_msg as IPCMessagePacket).message as { bericht:string }).bericht);
  test.eq("Welkom", ((await out_connection_msg as IPCMessagePacket).message as { bericht:string }).bericht);

  test.eq(initialreferences + 3, WHBridge.references, "By the time we've received our self initiated connection, we should have 3 refs");

  out_connection.close();
  acceptedport.close();
  listenport.close();
  test.eq(initialreferences, WHBridge.references);
}

async function testIndependentServiceThings() {
  const initialreferences = WHBridge.references;
  await test.throws(/Unable to connect/, WHBridge.openService("webharedev_jsbridges:nosuchservice", [ "x" ], { timeout: 300 }));
  test.eq(initialreferences, WHBridge.references);

  const invokereqeuest = WHBridge.invoke("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib#Add", [22, 23]);
  test.eq(initialreferences+1, WHBridge.references);
  test.eq(45, await invokereqeuest);
  test.eq(initialreferences, WHBridge.references);

  await test.throws(/NOSUCHFUNCTION.*not found/, WHBridge.invoke("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib#NoSuchFunction", []));
  await test.throws(/Custom.*Try to kill the bridge/, WHBridge.invoke("wh::system.whlib#ABORT", ["Try to kill the bridge through abort"]));
  test.eq(1452, await WHBridge.invoke("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib#MultiplyPromise", [22, 66]), "Verify promises work AND that the bridge is still there");
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

  /* TODO Do we need cross language events ?
  //RECORD deferred := CreateDeferredPromise();
  //serverinstance->AddListener("testevent", PTR deferred.resolve(#1));
  //serverinstance->EmitTestEvent([ value := 42 ]);
  //RECORD testdata := AWAIT deferred.promise;
  //TestEq([ value := 42 ], testdata); */
}

async function runWebHareServiceTest_JS()
{
  const initialreferences = WHBridge.references;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- not worth writing an interface for just a test
  const demoservice : any = test.assert(await WHBridge.openService("webhare_testsuite:demoservice"), "Fails in HS but works in JS as invalid # of arguments is not an issue for JavaScript");
  demoservice.close();

  await test.throws(/abort/, WHBridge.openService("webhare_testsuite:demoservice", ["abort"]));

  test.eq(initialreferences, WHBridge.references, "Failed and closed attempts above should not have kept a pending reference");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- not worth writing an interface for just a test
  const serverinstance : any = await WHBridge.openService("webhare_testsuite:demoservice", ["x"]);
  test.eq(42, await serverinstance.getLUE());

  let promise = serverinstance.getAsyncLUE();
  test.eq(42, await serverinstance.getLUE());
  test.eq(42, await promise);

  await test.throws(/Crash/, serverinstance.crash());

  promise = serverinstance.getAsyncLUE();
  const promise2 = serverinstance.getAsyncCrash();

  await test.throws(/Async crash/, promise2);

  test.eq({arg1:41,arg2:43}, await serverinstance.ping(41,43));
  test.eq({arg1:41,arg2:43}, await serverinstance.asyncPing(41,43));

  /* TODO reenable as event source? then it would be nicer to do it like a 'real' eventSource
  const eventwaiter = serverinstance.waitOn("testevent");
  await serverinstance.emitTestEvent({ start: 12, add: 13});
  test.eq(25, await eventwaiter);
  */

  serverinstance.close();
}

test.run([ testIPC
         , testIndependentServiceThings
         , runWebHareServiceTest_HS
         , runWebHareServiceTest_JS
         ], { wrdauth: false } );
