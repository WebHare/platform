import { createDeferred } from '@mod-system/js/internal/tools';

/// @ts-ignore -- not ported yet to TS
import bridge from '@mod-system/js/wh/bridge';
import * as test from '@webhare/test';

async function testConnectToBridge()
{
  //it("should fail against unknown service", async function()
  {
    await bridge.connect({ debug: false });
    await test.throws(/Unable to connect to port /, bridge.connectIPCPort('webhare_testsuite:testipc', false), "testipc shouldn't exist and connectIPCport should throw");
  }

  //it("should connect with webhare_testsuite:ipc and ping //it", async function()
  {
    const listenport = await bridge.createIPCPort('webhare_testsuite:testipc', false);
    const acceptpromise = createDeferred();
    //@ts-ignore -- FIXME revisit types as soon as we've ported bridge to ts
    listenport.on('accept', port => { acceptpromise.resolve(port); });

    const connectingport = await bridge.connectIPCPort('webhare_testsuite:testipc', false);
    const acceptedport = await acceptpromise.promise;

    const messagepromise = createDeferred();
    //@ts-ignore -- FIXME revisit types as soon as we've ported bridge to ts
    acceptedport.on('message', msg => messagepromise.resolve(msg));
    connectingport.send({ bericht: "Moi!" });
    const result = await messagepromise.promise;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FIXME fix eqMembers and restore this test
    test.eq("Moi!",(result as any)?.bericht);
  }

  //it("should test a simple invoke", async function()
  {
    const result = await bridge.invoke("mod::webhare_testsuite/lib/webservicetest.whlib", "ITakeNoParams");
    test.eq(42,result);
  }
  // it("should not mind being closed", async function()
  {
    bridge.close();
    await test.throws(/closed/, () => bridge.invoke("mod::webhare_testsuite/lib/webservicetest.whlib", "ITakeNoParams"), "bridge is closed so function should throw");
  }
}

test.run([testConnectToBridge]);