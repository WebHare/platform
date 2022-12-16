import * as test from "@webhare/test";
import WHBridge, { IPCLink, IPCListenerPort, IPCMessagePacket } from "@mod-system/js/internal/bridge";

async function testIPC() {
  //Attempt to connect to an nonexisting port. Verify that it keeps the bridge awake
  let out_connection = new IPCLink;
  test.eq(0, WHBridge.references);

  const out_connection_promise = out_connection.connect('webhare_testsuite:nosuchport', true);
  test.eq(1, WHBridge.references, "While the connection attempt is running, the bridge is busy");

  await test.throws(/Unable to connect to global port webhare_testsuite:nosuchport/, out_connection_promise);
  test.eq(0, WHBridge.references, "Reference should be freed as soon as the port connection failed");
  await test.throws(/Link.*already/, out_connection.connect('webhare_testsuite:testipc', true));

  //Test connect with webhare_testsuite:ipc and ping it
  const listenport = new IPCListenerPort;
  test.eq(0, WHBridge.references);

  const acceptportpromise = listenport.waitOn("accept");
  await listenport.listen('webhare_testsuite:testipc', false);

  test.eq(1, WHBridge.references);
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

  test.eq("Moi!", ((await acceptedport_msg as IPCMessagePacket).message as { bericht: string }).bericht);
  test.eq("Welkom", ((await out_connection_msg as IPCMessagePacket).message as { bericht: string }).bericht);

  test.eq(3, WHBridge.references, "By the time we've received our self initiated connection, we should have 3 refs");

  out_connection.close();
  acceptedport.close();
  listenport.close();
  test.eq(0, WHBridge.references);
}

async function testIndependentServiceThings() {

  const invokereqeuest = WHBridge.invoke("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib#Add", [22, 23]);
  test.eq(1, WHBridge.references);
  test.eq(45, await invokereqeuest);
  test.eq(0, WHBridge.references);

  await test.throws(/NOSUCHFUNCTION.*not found/, WHBridge.invoke("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib#NoSuchFunction", []));
  await test.throws(/Custom.*Try to kill the bridge/, WHBridge.invoke("wh::system.whlib#ABORT", ["Try to kill the bridge through abort"]));
  test.eq(1452, await WHBridge.invoke("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib#MultiplyPromise", [22, 66]), "Verify promises work AND that the bridge is still there");
  test.eq(0, WHBridge.references);
}

test.run([
  testIPC,
  testIndependentServiceThings
], { wrdauth: false });
